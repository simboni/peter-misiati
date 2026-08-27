import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentUser, requireOwner } from "@/lib/auth";
import { createFormula, listChemicals } from "@/lib/production";
import { toMilli } from "@/lib/units";
import { saveBundles, BundleError } from "@/lib/bundles";
import { batchSizes } from "@/lib/bundle-input";
import { PageTitle, Alert } from "@/components/ui";
import { EditFormulaForm, type SaveState } from "../[id]/edit-form";

export const dynamic = "force-dynamic";

/**
 * Write down a recipe the shop did not have.
 *
 * The recipe book could be corrected and never added to, which is the wrong way
 * round for a shop whose trade is inventing mixes: every new product had to be
 * asked for and typed in by somebody with the database open.
 *
 * The form is the editor's, told it is making something new — see
 * `EditFormulaForm`. Same ingredient rows, same rules, one screen to keep right.
 *
 * The price for a batch is asked for on the same screen, under the quantity it
 * is a price for, and saved with the recipe. A mixed product with no price can
 * only be billed by adding up its chemicals, and the shop sells Carwash Shampoo
 * as a 20 L for a round number, not as a sum.
 */
async function saveNewFormula(_prev: SaveState, formData: FormData): Promise<SaveState> {
  "use server";

  let formulaId: number;
  try {
    const owner = await requireOwner();

    const refLitres = Number(formData.get("refLitres"));
    if (!Number.isFinite(refLitres) || refLitres <= 0) {
      return { error: "Enter the reference batch size in litres." };
    }

    const chemicalIds = formData.getAll("chemicalId").map((v) => Number(v));
    const quantities = formData.getAll("qty").map((v) => Number(v));
    const items = chemicalIds
      .map((chemicalId, i) => ({
        chemicalId,
        qtyMilli: Number.isFinite(quantities[i]) ? toMilli(quantities[i]) : 0,
      }))
      .filter((row) => row.chemicalId > 0 && row.qtyMilli > 0);

    if (!items.length) {
      return { error: "Give at least one ingredient a quantity above zero." };
    }

    ({ formulaId } = createFormula({
      name: String(formData.get("name") ?? ""),
      refSizeMilli: toMilli(refLitres),
      refUnit: formData.get("batchUnit") === "kg" ? "kg" : "L",
      steps: String(formData.get("steps") ?? "").trim(),
      note: String(formData.get("note") ?? "").trim(),
      items,
      userId: owner.id,
    }));

    // A separate transaction on purpose: `tx` does not nest, and a recipe
    // without its price is recoverable — the recipe's own Sizes form sets it —
    // whereas a price with no recipe is not.
    saveBundles({ formulaId }, batchSizes([], refLitres, formData.get("batchPrice")));
  } catch (err) {
    if (err instanceof BundleError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "The recipe could not be saved." };
  }

  // Outside the try: `redirect` reports itself by throwing, and a catch around
  // it turns a saved recipe into "could not be saved". See AGENTS.md.
  revalidatePath("/formulas");
  revalidatePath("/sell");
  redirect(`/formulas/${formulaId}`);
}

export default async function NewFormulaPage() {
  try {
    await requireOwner();
  } catch {
    if (!(await currentUser())) redirect("/login");
    return (
      <div>
        <PageTitle title="New recipe" />
        <Alert tone="bad">The recipes are the owner’s. Ask the owner to sign in on this phone.</Alert>
      </div>
    );
  }

  const chemicals = listChemicals();

  if (!chemicals.length) {
    return (
      <div>
        <PageTitle title="New recipe" />
        <Alert tone="warn">
          There are no chemicals to build a recipe out of yet. Add them on Products & prices
          first — a recipe is a list of things the shop already stocks.
        </Alert>
      </div>
    );
  }

  return (
    <div>
      <PageTitle
        title="New recipe"
        subtitle="What it makes, what goes in it, and how it is mixed."
      />

      <EditFormulaForm
        action={saveNewFormula}
        isNew
        formulaId={0}
        chemicals={chemicals}
        refLitres="20"
        steps=""
        note=""
        // One row to start, so the first thing on screen is an ingredient
        // waiting for a quantity rather than an empty box and a "+" to find.
        rows={[{ chemicalId: chemicals[0].id, qty: "" }]}
        cancelHref="/formulas"
        everSold={false}
      />
    </div>
  );
}
