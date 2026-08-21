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
import { fromCents, formatQty } from "@/lib/units";
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
      unit: (formData.get("unit") as "kg" | "L" | "pcs") ?? "L",
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
  const packSizes = String(formData.get("packs") ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  try {
    createChemical({
      name: String(formData.get("name") ?? ""),
      unit: (formData.get("unit") as "kg" | "L" | "pcs") ?? "kg",
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
    addPackSize(Number(formData.get("chemicalId")), Number(formData.get("size") ?? 0), by);
  } catch (e) {
    redirectWith(e);
  }
  revalidatePath("/items");
}

// -------------------------------------------------------------------- views

/** A price-and-reorder editor, shared by finished products and packs. */
function PriceForm({ item }: { item: AdminItem }) {
  const reorderUnits = item.size_milli > 0 ? item.reorder_level_milli / item.size_milli : 0;
  return (
    <form action={savePricing} className="mt-2.5 space-y-2.5">
      <input type="hidden" name="itemId" value={item.id} />
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Retail price">
          <input
            className={inputClass}
            type="number"
            name="retail"
            min="0"
            step="any"
            defaultValue={fromCents(item.retail_cents)}
          />
        </Field>
        <Field label="Wholesale price">
          <input
            className={inputClass}
            type="number"
            name="wholesale"
            min="0"
            step="any"
            defaultValue={fromCents(item.wholesale_cents)}
          />
        </Field>
        <Field label="Floor price" hint="Lowest an attendant may go without an owner PIN.">
          <input
            className={inputClass}
            type="number"
            name="floor"
            min="0"
            step="any"
            defaultValue={fromCents(item.floor_cents)}
          />
        </Field>
        <Field label="Reorder level" hint={`In ${item.unit_label}s.`}>
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
        <summary className="cursor-pointer text-sm font-bold text-brand-dark">Edit prices</summary>
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
        title="Products &amp; prices"
        subtitle="Add what the shop sells and change prices yourself — no developer needed"
      />

      {err ? (
        <div className="mb-3">
          <Alert tone="bad">{err}</Alert>
        </div>
      ) : null}

      {/* Prose keeps a reading-width cap; the catalogue grids below do not. */}
      <div className="max-w-4xl">
        <Alert tone="brand">
          A chemical&rsquo;s cost is never typed here — it comes from what you actually paid on the
          Purchases screen. You set only the selling prices.
        </Alert>
      </div>

      <SectionLabel>Finished products</SectionLabel>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 3xl:grid-cols-5">
        {finished.length === 0 ? (
          <p className="text-sm text-muted">Nothing yet. Add your first bottled product below.</p>
        ) : (
          finished.map((i) => (
            <ItemCard
              key={i.id}
              item={i}
              sizeText={`${Number((i.size_milli / 1000).toFixed(3))} ${i.canonical_unit} ${i.unit_label}`}
            />
          ))
        )}
      </div>

      <SectionLabel>Add a finished product</SectionLabel>
      <Card className="max-w-2xl">
        <form action={addFinished} className="space-y-3">
          <Field label="Name">
            <input className={inputClass} name="name" required placeholder="e.g. Thick Bleach" />
          </Field>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Size">
              <input
                className={inputClass}
                type="number"
                name="size"
                min="0"
                step="any"
                required
                placeholder="1"
              />
            </Field>
            <Field label="Unit">
              <select className={inputClass} name="unit" defaultValue="L">
                <option value="L">Litres</option>
                <option value="kg">Kilograms</option>
                <option value="pcs">Pieces</option>
              </select>
            </Field>
          </div>
          <Field label="Container" hint="What one unit comes in.">
            <input className={inputClass} name="label" defaultValue="bottle" />
          </Field>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Retail price">
              <input className={inputClass} type="number" name="retail" min="0" step="any" required />
            </Field>
            <Field label="Wholesale price">
              <input className={inputClass} type="number" name="wholesale" min="0" step="any" required />
            </Field>
          </div>
          <Button type="submit" className="w-full">
            Add product
          </Button>
        </form>
      </Card>

      <SectionLabel>Chemicals &amp; repack sizes</SectionLabel>
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
                <p className="mt-2 text-xs text-muted">No resale pack sizes yet.</p>
              )}

              <details className="mt-2.5">
                <summary className="cursor-pointer text-sm font-bold text-brand">
                  Add a pack size
                </summary>
                <form action={addPack} className="mt-2.5 flex items-end gap-2.5">
                  <input type="hidden" name="chemicalId" value={chem.id} />
                  <div className="flex-1">
                    <Field label={`Size in ${chem.canonical_unit}`}>
                      <input
                        className={inputClass}
                        type="number"
                        name="size"
                        min="0"
                        step="any"
                        required
                        placeholder="0.5"
                      />
                    </Field>
                  </div>
                  <Button type="submit">Add</Button>
                </form>
              </details>
            </Card>
          );
        })}
      </div>

      <SectionLabel>Add a chemical</SectionLabel>
      <Card>
        <form action={addChemical} className="space-y-3">
          <Field label="Name">
            <input className={inputClass} name="name" required placeholder="e.g. Perfume Green Apple" />
          </Field>
          <Field label="Other names it&rsquo;s known by" hint="Comma separated. Helps search find it.">
            <input className={inputClass} name="aliases" placeholder="fragrance, scent" />
          </Field>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Bulk size">
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
            <Field label="Unit">
              <select className={inputClass} name="unit" defaultValue="kg">
                <option value="kg">Kilograms</option>
                <option value="L">Litres</option>
                <option value="pcs">Pieces</option>
              </select>
            </Field>
          </div>
          <Field label="Bulk container" hint="drum, bag, jerrican…">
            <input className={inputClass} name="bulkLabel" defaultValue="drum" />
          </Field>
          <Field
            label="Repack sizes"
            hint="Comma separated, in the unit above. e.g. 20, 5, 1, 0.5"
          >
            <input className={inputClass} name="packs" placeholder="20, 5, 1, 0.5" />
          </Field>
          <Button type="submit" className="w-full">
            Add chemical
          </Button>
        </form>
      </Card>

      {packaging.length > 0 ? (
        <>
          <SectionLabel>Packaging</SectionLabel>
          <div className="space-y-2.5">
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
