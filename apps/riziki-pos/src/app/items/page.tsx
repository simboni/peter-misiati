import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { currentUser, requireOwner } from "@/lib/auth";
import {
  listFinished,
  listPackaging,
  listChemicals,
  updatePricing,
  setItemActive,
  createFinished,
  createChemical,
  addPackSize,
  CatalogError,
  type AdminItem,
} from "@/lib/catalog";
import { fromCents, formatQty, SIZE_UNITS, type SizeUnit } from "@/lib/units";
import {
  Alert,
  Button,
  Card,
  Chip,
  Field,
  PageTitle,
  SectionLabel,
  inputClass,
} from "@/components/ui";

// Prices and the catalogue change here; never serve a cached copy.
export const dynamic = "force-dynamic";

async function guard(): Promise<number> {
  const owner = await requireOwner();
  return owner.id;
}

/**
 * Show a service error back on this screen instead of crashing the owner out to
 * Next's raw error page. Same reasoning as the settings screen: a mistyped price
 * should not eject you from the app.
 */
function redirectWith(e: unknown): never {
  const message = e instanceof CatalogError ? e.message : "That did not work. Please try again.";
  redirect(`/items?err=${encodeURIComponent(message)}`);
}

// ------------------------------------------------------------------ actions

async function savePricing(formData: FormData): Promise<void> {
  "use server";
  const by = await guard();
  try {
    updatePricing({
      itemId: Number(formData.get("itemId")),
      retail: Number(formData.get("retail") ?? 0),
      wholesale: Number(formData.get("wholesale") ?? 0),
      floor: Number(formData.get("floor") ?? 0),
      reorderUnits: Number(formData.get("reorder") ?? 0),
      byUserId: by,
    });
  } catch (e) {
    redirectWith(e);
  }
  revalidatePath("/items");
}

async function toggleActive(formData: FormData): Promise<void> {
  "use server";
  const by = await guard();
  try {
    setItemActive(Number(formData.get("itemId")), formData.get("active") === "1", by);
  } catch (e) {
    redirectWith(e);
  }
  revalidatePath("/items");
}

async function addFinished(formData: FormData): Promise<void> {
  "use server";
  const by = await guard();
  try {
    createFinished({
      name: String(formData.get("name") ?? ""),
      unit: (formData.get("unit") as SizeUnit) ?? "L",
      sizeValue: Number(formData.get("size") ?? 0),
      unitLabel: String(formData.get("label") ?? "bottle"),
      retail: Number(formData.get("retail") ?? 0),
      wholesale: Number(formData.get("wholesale") ?? 0),
      byUserId: by,
    });
  } catch (e) {
    redirectWith(e);
  }
  revalidatePath("/items");
}

async function addChemical(formData: FormData): Promise<void> {
  "use server";
  const by = await guard();

  // Pack sizes are typed as a list — "500 ml, 1 L, 5 L" — because that is how
  // the shop says them. Each entry carries its own unit; a number with no unit
  // takes the chemical's own.
  const unit = (formData.get("unit") as SizeUnit) ?? "kg";
  const packSizes = String(formData.get("packs") ?? "")
    .split(",")
    .map((raw) => {
      const m = /^\s*([\d.]+)\s*(g|kg|ml|l|pcs)?\s*$/i.exec(raw);
      if (!m) return null;
      const value = Number(m[1]);
      if (!Number.isFinite(value) || value <= 0) return null;
      const typed = (m[2] ?? unit).toLowerCase();
      const key = (typed === "l" ? "L" : typed) as SizeUnit;
      return { value, unit: key };
    })
    .filter((x): x is { value: number; unit: SizeUnit } => x !== null);

  try {
    createChemical({
      name: String(formData.get("name") ?? ""),
      unit,
      aliases: String(formData.get("aliases") ?? ""),
      bulkSizeValue: Number(formData.get("bulk") ?? 0),
      bulkLabel: String(formData.get("bulkLabel") ?? "unit"),
      packSizes,
      byUserId: by,
    });
  } catch (e) {
    redirectWith(e);
  }
  revalidatePath("/items");
}

async function addPack(formData: FormData): Promise<void> {
  "use server";
  const by = await guard();
  try {
    addPackSize(
      Number(formData.get("chemicalId")),
      Number(formData.get("size") ?? 0),
      (formData.get("sizeUnit") as SizeUnit) ?? "kg",
      by,
    );
  } catch (e) {
    redirectWith(e);
  }
  revalidatePath("/items");
}

// -------------------------------------------------------------------- views

/**
 * The unit a size is typed in.
 *
 * Offered everywhere a size is asked for, because "500 ml" is what the label
 * says and "0.5 litres" is what the database wanted. `only` narrows the list
 * when the answer is already fixed — a pack of a chemical measured in litres
 * can be ml or L, and nothing else.
 */
function UnitSelect({ name, value, only }: { name: string; value?: string; only?: "kg" | "L" | "pcs" }) {
  const options = only ? SIZE_UNITS.filter((u) => u.canonical === only) : SIZE_UNITS;
  return (
    <select className={inputClass} name={name} defaultValue={value ?? options[0]?.key}>
      {options.map((u) => (
        <option key={u.key} value={u.key}>
          {u.label}
        </option>
      ))}
    </select>
  );
}

/** A price-and-reorder editor, shared by finished products and packs. */
function PriceForm({ item }: { item: AdminItem }) {
  const reorderUnits = item.size_milli > 0 ? item.reorder_level_milli / item.size_milli : 0;
  return (
    <form action={savePricing} className="mt-2.5 space-y-2.5">
      <input type="hidden" name="itemId" value={item.id} />
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Retail price" hint="What a walk-in pays.">
          <input
            className={inputClass}
            type="number"
            name="retail"
            min="0"
            step="any"
            defaultValue={fromCents(item.retail_cents)}
          />
        </Field>
        <Field label="Wholesale price" hint="What a trade buyer pays.">
          <input
            className={inputClass}
            type="number"
            name="wholesale"
            min="0"
            step="any"
            defaultValue={fromCents(item.wholesale_cents)}
          />
        </Field>
        <Field label="Never below" hint="An attendant cannot go under this without your PIN.">
          <input
            className={inputClass}
            type="number"
            name="floor"
            min="0"
            step="any"
            defaultValue={fromCents(item.floor_cents)}
          />
        </Field>
        <Field label="Warn me at" hint={`When stock drops to this many ${item.unit_label}s.`}>
          <input
            className={inputClass}
            type="number"
            name="reorder"
            min="0"
            step="any"
            defaultValue={Number(reorderUnits.toFixed(3))}
          />
        </Field>
      </div>
      <Button type="submit" className="w-full">
        Save prices
      </Button>
    </form>
  );
}

function ItemCard({ item, sizeText }: { item: AdminItem; sizeText: string }) {
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold">{item.name}</span>
        <Chip tone="neutral">{sizeText}</Chip>
        {item.active ? null : <Chip tone="bad">Hidden</Chip>}
      </div>
      <div className="mt-0.5 text-xs text-muted">
        Retail {fromCents(item.retail_cents).toLocaleString("en-KE")} · Wholesale{" "}
        {fromCents(item.wholesale_cents).toLocaleString("en-KE")}
      </div>

      <details className="mt-2.5">
        <summary className="cursor-pointer text-sm font-bold text-brand-dark">
          Prices and limits
        </summary>
        <PriceForm item={item} />
        {/* Hiding is a twice-a-year act; it lives inside the editor, in quiet
            ghost dress — red is for the moment of destruction, not the menu. */}
        <form action={toggleActive} className="mt-2.5">
          <input type="hidden" name="itemId" value={item.id} />
          <input type="hidden" name="active" value={item.active ? "0" : "1"} />
          <Button type="submit" variant="ghost">
            {item.active ? "Hide from the counter" : "Show on the counter"}
          </Button>
        </form>
      </details>
    </Card>
  );
}

export default async function ItemsPage(props: {
  searchParams: Promise<{ err?: string }>;
}) {
  const { err } = await props.searchParams;
  const me = await currentUser();
  if (!me) redirect("/login");
  // Prices, floors and the raw-chemical list all sit here; staff never see it.
  if (me.role !== "owner") redirect("/");

  const finished = listFinished();
  const packaging = listPackaging();
  const chemicals = listChemicals();

  return (
    <div>
      <PageTitle
        title="What the shop sells"
        subtitle="Add products and pack sizes here. For a price that has just moved, use Prices for today."
      />

      {err ? (
        <div className="mb-3">
          <Alert tone="bad">{err}</Alert>
        </div>
      ) : null}

      {/*
        Three sentences saying what this screen is and is not.

        The client got lost here, and the reason was that the screen did four
        jobs without saying so: it listed products, added products, set prices
        and set floors, with "finished", "canonical unit" and "reorder level"
        for labels. The words are plainer now, and the job that happens daily —
        changing a price — has its own screen, which this one points at rather
        than competing with.
      */}
      <div className="max-w-4xl space-y-2.5">
        <div className="rounded-2xl bg-white p-4 shadow-card ring-1 ring-ink/5">
          <p className="text-sm leading-relaxed">
            <strong>This screen is for the list itself</strong> — adding something new, adding
            another pack size, or hiding something you no longer sell.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            To change a price that has moved, use{" "}
            <Link href="/prices" className="font-bold text-brand">
              Prices for today
            </Link>
            . It is one list, one box per price, and an attendant can do it. The prices here are
            for setting up something new.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            You never type what a chemical <em>cost</em> you. That comes from what you actually
            paid on the{" "}
            <Link href="/purchases" className="font-bold text-brand">
              Purchases
            </Link>{" "}
            screen, so the profit figures stay honest.
          </p>
        </div>
      </div>

      <SectionLabel>Products we mix and bottle</SectionLabel>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 3xl:grid-cols-5">
        {finished.length === 0 ? (
          <p className="text-sm text-muted">Nothing yet. Add your first one below — handwash, bleach, shampoo and so on.</p>
        ) : (
          finished.map((i) => (
            <ItemCard
              key={i.id}
              item={i}
              // formatQty, not raw division: a 500 ml bottle was labelled
              // "0.5 L bottle" here while its own name said 500 ml, which is
              // exactly the kind of small disagreement that makes a screen feel
              // untrustworthy.
              sizeText={`${formatQty(i.size_milli, i.canonical_unit)} ${i.unit_label}`}
            />
          ))
        )}
      </div>

      <SectionLabel>Add a product we mix</SectionLabel>
      <Card className="max-w-2xl">
        <form action={addFinished} className="space-y-3">
          <Field label="Name">
            <input className={inputClass} name="name" required placeholder="e.g. Thick Bleach" />
          </Field>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="How much is in one" hint="e.g. 500, then choose ml.">
              <input
                className={inputClass}
                type="number"
                name="size"
                min="0"
                step="any"
                required
                placeholder="500"
              />
            </Field>
            <Field label="Measured in">
              <UnitSelect name="unit" value="ml" />
            </Field>
          </div>
          <Field label="What it comes in" hint="The word the counter will see: bottle, jerrican, tub.">
            <input className={inputClass} name="label" defaultValue="bottle" />
          </Field>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Retail price" hint="What a walk-in pays.">
              <input className={inputClass} type="number" name="retail" min="0" step="any" required />
            </Field>
            <Field label="Wholesale price" hint="What a trade buyer pays.">
              <input className={inputClass} type="number" name="wholesale" min="0" step="any" required />
            </Field>
          </div>
          <Button type="submit" className="w-full">
            Add product
          </Button>
        </form>
      </Card>

      <SectionLabel>Chemicals, and the sizes we sell them in</SectionLabel>
      <div className="grid items-start gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 3xl:grid-cols-5">
        {chemicals.map((chem) => {
          const packs = chem.items.filter((i) => i.kind === "pack");
          return (
            <Card key={chem.id}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold">{chem.name}</span>
                <Chip tone="neutral">{chem.canonical_unit}</Chip>
                {chem.active ? null : <Chip tone="bad">Hidden</Chip>}
              </div>

              {packs.length > 0 ? (
                <div className="mt-2.5 space-y-2.5">
                  {packs.map((p) => (
                    <details key={p.id} className="rounded-xl border border-line px-3 py-2">
                      <summary className="cursor-pointer text-sm font-semibold">
                        {formatQty(p.size_milli, p.canonical_unit)} — retail{" "}
                        {fromCents(p.retail_cents).toLocaleString("en-KE")}
                        {p.active ? "" : " (hidden)"}
                      </summary>
                      <PriceForm item={p} />
                      <form action={toggleActive} className="mt-2.5">
                        <input type="hidden" name="itemId" value={p.id} />
                        <input type="hidden" name="active" value={p.active ? "0" : "1"} />
                        <Button type="submit" variant="ghost">
                          {p.active ? "Hide this size" : "Show this size"}
                        </Button>
                      </form>
                    </details>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-xs text-muted">Sold only by the whole drum so far. Add a smaller size below.</p>
              )}

              <details className="mt-2.5">
                <summary className="cursor-pointer text-sm font-bold text-brand">
                  Add a size we sell it in
                </summary>
                <form action={addPack} className="mt-2.5 space-y-2.5">
                  <input type="hidden" name="chemicalId" value={chem.id} />
                  <div className="grid grid-cols-2 gap-2.5">
                    <Field label="How much">
                      <input
                        className={inputClass}
                        type="number"
                        name="size"
                        min="0"
                        step="any"
                        required
                        placeholder={chem.canonical_unit === "kg" ? "500" : "500"}
                      />
                    </Field>
                    <Field label="In">
                      <UnitSelect
                        name="sizeUnit"
                        only={chem.canonical_unit}
                        value={chem.canonical_unit === "kg" ? "g" : chem.canonical_unit === "L" ? "ml" : "pcs"}
                      />
                    </Field>
                  </div>
                  <Button type="submit" className="w-full">Add this size</Button>
                </form>
              </details>
            </Card>
          );
        })}
      </div>

      <SectionLabel>Add a chemical we buy in</SectionLabel>
      <Card className="max-w-2xl">
        <form action={addChemical} className="space-y-3">
          <Field label="Name">
            <input className={inputClass} name="name" required placeholder="e.g. Perfume Green Apple" />
          </Field>
          <Field label="Other names it&rsquo;s known by" hint="Comma separated. Helps search find it.">
            <input className={inputClass} name="aliases" placeholder="fragrance, scent" />
          </Field>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="How big is the drum or bag" hint="What one container holds when it arrives.">
              <input
                className={inputClass}
                type="number"
                name="bulk"
                min="0"
                step="any"
                required
                placeholder="25"
              />
            </Field>
            <Field label="Measured in">
              <UnitSelect name="unit" value="kg" />
            </Field>
          </div>
          <Field label="Bulk container" hint="drum, bag, jerrican…">
            <input className={inputClass} name="bulkLabel" defaultValue="drum" />
          </Field>
          <Button type="submit" className="w-full">
            Add chemical
          </Button>
        </form>
      </Card>

      {packaging.length > 0 ? (
        <>
          <SectionLabel>Packaging</SectionLabel>
          <div className="grid items-start gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 3xl:grid-cols-5">
            {packaging.map((i) => (
              <ItemCard key={i.id} item={i} sizeText={i.unit_label} />
            ))}
          </div>
        </>
      ) : null}

      <p className="mt-5 text-xs text-muted">
        Every price change and new product is recorded against your name.
      </p>
    </div>
  );
}
