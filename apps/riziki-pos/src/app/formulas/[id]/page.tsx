import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentUser, requireOwner } from "@/lib/auth";
import {
  salesUsingVersion,
  formulaById,
  currentVersion,
  versionById,
  versionsOf,
  formulaItems,
  listChemicals,
  createFormulaVersion,
  renameFormula,
} from "@/lib/production";
import { formatQty, fromMilli, toMilli, formatDateTime } from "@/lib/units";
import {
  PageTitle,
  Card,
  Chip,
  Alert,
  SectionLabel,
  TableWrap,
  Th,
  Td,
  LinkButton,
  Empty,
} from "@/components/ui";
import { formulaBundles, saveBundles, BundleError } from "@/lib/bundles";
import { batchSizes } from "@/lib/bundle-input";
import { listProducts } from "@/lib/catalog";
import { OutputForm } from "./output-form";
import { EditFormulaForm, type SaveState } from "./edit-form";
import BundleForm from "./bundle-form";
import { saveFormulaBundles } from "./bundle-action";

export const dynamic = "force-dynamic";

/**
 * Save an edited recipe.
 *
 * Note what this does NOT do: it never touches the version being edited. A
 * batch mixed last week points at that row, and its cost and composition have
 * to keep telling the truth.
 *
 * The name is the exception, and it is not an exception to that rule so much as
 * outside it: what the shop calls a product is not part of the record of what
 * went into a mix, so a rename rewrites no version and forks none. It is done
 * first because it is the likelier refusal — another recipe already has the
 * name — and doing it first means a refused rename leaves nothing else written.
 */
async function saveFormula(_prev: SaveState, formData: FormData): Promise<SaveState> {
  "use server";

  const formulaId = Number(formData.get("formulaId"));
  let outcome: { version: number; corrected: boolean; unchanged: boolean };

  try {
    const owner = await requireOwner();

    renameFormula(formulaId, String(formData.get("name") ?? ""), owner.id);

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

    outcome = createFormulaVersion({
      formulaId,
      refSizeMilli: toMilli(refLitres),
      refUnit: formData.get("batchUnit") === "kg" ? "kg" : "L",
      steps: String(formData.get("steps") ?? "").trim(),
      note: String(formData.get("note") ?? "").trim(),
      items,
      userId: owner.id,
    });

    // The batch price, from the box under the quantity it is a price for.
    // Merged with any other sizes rather than replacing them — see `batchSizes`.
    saveBundles(
      { formulaId },
      batchSizes(formulaBundles(formulaId), refLitres, formData.get("batchPrice")),
    );
  } catch (err) {
    if (err instanceof BundleError) return { error: err.message };
    return { error: err instanceof Error ? err.message : "Could not save the formula." };
  }

  revalidatePath(`/formulas/${formulaId}`);
  revalidatePath("/formulas");
  // Outside the catch: redirect works by throwing, and swallowing it would
  // leave the owner staring at a form that had already saved.
  redirect(
    `/formulas/${formulaId}?saved=${outcome.version}` +
      `&how=${outcome.unchanged ? "unchanged" : outcome.corrected ? "corrected" : "forked"}`,
  );
}

export default async function FormulaDetailPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ v?: string; edit?: string; saved?: string; how?: string }>;
}) {
  // `params` and `searchParams` are Promises in Next.js 16.
  const { id } = await props.params;
  const { v, edit, saved, how } = await props.searchParams;

  // Gate before a single ingredient is read.
  try {
    await requireOwner();
  } catch {
    if (!(await currentUser())) redirect("/login");
    return (
      <div>
        <PageTitle title="Formula" />
        <Alert tone="bad">The recipes are the owner’s.</Alert>
      </div>
    );
  }

  const formulaId = Number(id);
  const formula = formulaById(formulaId);
  if (!formula) {
    return (
      <div>
        <PageTitle title="Formula" />
        <Empty>That formula does not exist.</Empty>
        <LinkButton href="/formulas">Back to formulas</LinkButton>
      </div>
    );
  }

  const versions = versionsOf(formulaId);
  const current = currentVersion(formulaId);
  const shown = (v ? versionById(Number(v)) : current) ?? current;

  if (!shown || shown.formula_id !== formulaId) {
    return (
      <div>
        <PageTitle title={formula.name} />
        <Empty>This formula has no recorded version yet.</Empty>
      </div>
    );
  }

  const items = formulaItems(shown.id);
  const bundles = formulaBundles(formulaId);

  /*
    What this recipe could be told to make.

    Anything active in the catalogue except the chemicals this very recipe is
    made OF — offering those would invite a mix that eats itself, which the
    library refuses anyway; leaving them out means the refusal is never needed.
  */
  const ingredientChemicals = new Set(items.map((i) => i.chemical_id));
  const outputChoices = listProducts()
    .filter((p) => p.active === 1 && !(p.chemical_id && ingredientChemicals.has(p.chemical_id)))
    .map((p) => ({ id: p.id, name: p.name, unit: p.canonical_unit }));
  const outputName =
    outputChoices.find((c) => c.id === formula.output_item_id)?.name ??
    listProducts().find((p) => p.id === formula.output_item_id)?.name ??
    null;
  const editing = edit === "1";

  if (editing) {
    return (
      <div>
        <PageTitle
          title={`Edit ${formula.name}`}
          subtitle={`Editing from version ${shown.version}`}
        />
        <EditFormulaForm
          action={saveFormula}
          formulaId={formulaId}
          name={formula.name}
          batchUnit={shown.ref_unit}
          // Seeded from the size that matches the batch, so the box under the
          // quantity shows the price it is already selling at rather than blank.
          batchPrice={(() => {
            const at = formulaBundles(formulaId).find(
              (b) => b.sizeMilli === shown.ref_size_milli,
            );
            return at ? String(at.priceCents / 100) : "";
          })()}
          chemicals={listChemicals()}
          refLitres={String(fromMilli(shown.ref_size_milli))}
          steps={shown.steps}
          note={shown.note}
          rows={items.map((i) => ({
            chemicalId: i.chemical_id,
            qty: String(fromMilli(i.qty_milli)),
          }))}
          everSold={salesUsingVersion(shown.id) > 0}
          cancelHref={`/formulas/${formulaId}`}
        />
      </div>
    );
  }

  const steps = shown.steps.split("\n").map((s) => s.trim()).filter(Boolean);

  return (
    <div>
      <PageTitle
        title={formula.name}
        subtitle={`Version ${shown.version} · quantities per ${formatQty(shown.ref_size_milli, shown.ref_unit)}`}
      />

      {/* What the save actually did, rather than one sentence for all three
          outcomes. An owner who opened this recipe to fix its name was being
          told his ingredients had been rewritten and an old version kept — two
          things that had not happened. */}
      {saved ? (
        <div className="mb-2.5">
          <Alert tone="good">
            {how === "unchanged"
              ? `Saved. The recipe itself is unchanged, so version ${saved} stands as it was.`
              : how === "corrected"
                ? `Version ${saved} corrected. Nothing has been sold on it, so it was rewritten where it stood rather than forked.`
                : `Saved as version ${saved}. The previous version is kept exactly as it was.`}
          </Alert>
        </div>
      ) : null}

      {!shown.is_current ? (
        <div className="mb-2.5">
          <Alert tone="warn">
            This is version {shown.version}, superseded by version {current?.version}. It is shown
            because it was sold against.{" "}
            <Link href={`/formulas/${formulaId}`} className="font-bold underline">
              Show the current version
            </Link>
          </Alert>
        </div>
      ) : null}

      {/*
        How this recipe reaches the customer.

        First, above the sizes, because it decides whether the sizes below are
        used at all: a recipe mixed in advance is sold as the product it makes,
        and the sizes that matter are that product's, set on Products & prices.
      */}
      {shown.is_current ? (
        <div className="mb-3 max-w-3xl">
          <details open={formula.output_item_id !== null}>
            <summary className="cursor-pointer text-sm font-bold text-brand-dark">
              {formula.output_item_id
                ? `Mixed in advance — makes ${outputName ?? "a product"}`
                : "Mixed to order — billed at the counter"}{" "}
              ▾
            </summary>
            <Card className="mt-2">
              <OutputForm
                formulaId={formulaId}
                outputItemId={formula.output_item_id}
                choices={outputChoices}
              />
            </Card>
          </details>
        </div>
      ) : null}

      {/*
        The sizes this is sold in.

        Under the recipe rather than beside it, because the recipe is what the
        product IS and the sizes are how it is sold — and only the current
        version carries them: an old version is on screen to be read, not
        priced.

        Hidden entirely when the recipe is mixed in advance: those sizes price
        a mix the counter no longer sells, and leaving the form on screen would
        invite somebody to set prices that nothing reads.
      */}
      {shown.is_current && formula.output_item_id === null ? (
        <div className="mb-3 max-w-3xl">
          <details open={bundles.length > 0}>
            <summary className="cursor-pointer text-sm font-bold text-brand-dark">
              Sold in{bundles.length ? ` ${bundles.length} size${bundles.length === 1 ? "" : "s"}` : " — set the sizes"} ▾
            </summary>
            <Card className="mt-2">
              <BundleForm
                formulaId={formulaId}
                unit={shown.ref_unit}
                bundles={bundles.map((b) => ({
                  size: String(b.sizeMilli / 1000),
                  price: String(b.priceCents / 100),
                  floor: b.floorCents ? String(b.floorCents / 100) : "",
                }))}
                action={saveFormulaBundles}
              />
            </Card>
          </details>
        </div>
      ) : null}

      {shown.note.trim() ? (
        <div className="mb-2.5">
          <Alert tone="warn">
            <span className="block text-[11px] font-bold uppercase tracking-[0.1em]">
              Open question from the sheet
            </span>
            <span className="mt-1 block font-medium">{shown.note}</span>
          </Alert>
        </div>
      ) : null}

      {/* The two halves of a mixing sheet — what goes in, and in what order.
          They are read together, so once there is width they sit together
          rather than pushing the steps a screen below the quantities. */}
      <div className="lg:grid lg:grid-cols-12 lg:items-start lg:gap-x-4 xl:gap-x-5 2xl:gap-x-6">
        <div className="lg:col-span-6 xl:col-span-5">
          <SectionLabel>Ingredients per {formatQty(shown.ref_size_milli, shown.ref_unit)}</SectionLabel>
          {items.length ? (
            <TableWrap>
              <thead>
                <tr>
                  <Th>Chemical</Th>
                  <Th align="right">Quantity</Th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id}>
                    <Td>{i.chemical_name}</Td>
                    <Td align="right">{formatQty(i.qty_milli, i.canonical_unit)}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          ) : (
            <Empty>No ingredients recorded on this version.</Empty>
          )}
        </div>

        <div className="lg:col-span-6 xl:col-span-7">
          <SectionLabel>Mixing steps</SectionLabel>
          <Card>
            {steps.length ? (
              <ol className="list-decimal space-y-1.5 pl-5 text-sm">
                {steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted">
                No steps written down yet — add them so anyone can mix this.
              </p>
            )}
          </Card>
        </div>
      </div>

      <div className="mt-3 flex gap-2 xl:mt-4">
        <LinkButton href={`/formulas/${formulaId}?edit=1${v ? `&v=${v}` : ""}`} variant="primary">
          Edit recipe
        </LinkButton>
      </div>

      <SectionLabel>Version history</SectionLabel>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {versions.map((ver) => (
          <Card key={ver.id} className={ver.id === shown.id ? "border-brand" : ""}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-bold">
                  Version {ver.version}{" "}
                  <span className="font-normal text-muted">
                    · per {formatQty(ver.ref_size_milli, ver.ref_unit)}
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-muted">
                  {formatDateTime(ver.created_at)} ·{" "}
                  {ver.use_count === 0
                    ? "never sold on"
                    : `sold on ${ver.use_count} ${ver.use_count === 1 ? "time" : "times"}`}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                {ver.is_current ? <Chip tone="good">Current</Chip> : <Chip>Superseded</Chip>}
                {ver.id === shown.id ? null : (
                  <Link
                    href={`/formulas/${formulaId}?v=${ver.id}`}
                    className="text-xs font-bold text-brand"
                  >
                    View
                  </Link>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>

      <div className="mt-3">
        <Link href="/formulas" className="text-sm font-bold text-brand">
          ← All recipes
        </Link>
      </div>
    </div>
  );
}
