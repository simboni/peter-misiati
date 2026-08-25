import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { currentUser, requireOwner } from "@/lib/auth";
import {
  listProducts,
  setItemActive,
  deletableReason,
  createProduct,
  adoptUnitPricing,
  pendingUnitPricing,
  CatalogError,
  type AdminItem,
} from "@/lib/catalog";
import { fromCents, formatKes, formatQty, SIZE_UNITS, type SizeUnit } from "@/lib/units";
import { Alert, Button, Card, Chip, Field, PageTitle, inputClass } from "@/components/ui";
import PriceForm from "./price-form";
import DeleteProduct from "./delete-product";

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

/* Saving prices lives in ./actions, called from ./price-form — a refused price
   has to come back to the row it was typed in. See the note in that file. */

async function toggleActive(formData: FormData): Promise<void> {
  "use server";
  const by = await guard();
  try {
    setItemActive(Number(formData.get("itemId")), formData.get("active") === "1", by);
  } catch (e) {
    redirectWith(e);
  }
  revalidatePath("/items");
  revalidatePath("/sell");
}

async function addProduct(formData: FormData): Promise<void> {
  "use server";
  const by = await guard();
  try {
    createProduct({
      name: String(formData.get("name") ?? ""),
      unit: (formData.get("unit") as SizeUnit) ?? "kg",
      aliases: String(formData.get("aliases") ?? ""),
      containerValue: Number(formData.get("container") ?? 0),
      containerLabel: String(formData.get("containerLabel") ?? "unit"),
      price: Number(formData.get("price") ?? 0),
      floor: Number(formData.get("floor") ?? 0),
      ceiling: Number(formData.get("ceiling") ?? 0),
      byUserId: by,
    });
  } catch (e) {
    redirectWith(e);
  }
  revalidatePath("/items");
  revalidatePath("/sell");
}

/**
 * Move the catalogue onto per-unit pricing.
 *
 * This used to be a script somebody had to run in a terminal, which is a fine
 * thing to ask of a developer and no thing at all to ask of a shop. Until it has
 * run, no chemical has a price per kilogram, so the counter refuses every recipe
 * with "cannot be billed" and nobody on the floor can tell why. It is a button
 * now, on the screen where prices live, with the numbers stated before it is
 * pressed.
 *
 * Still deliberate, still owner-only, and still safe to press twice: it prices
 * what is unpriced, pours pack stock back into the container it came out of as
 * a matching pair of ledger movements, and retires the pack rows without
 * deleting the sales that point at them.
 */
async function adoptPricing(): Promise<void> {
  "use server";
  const by = await guard();
  let report;
  // `redirect` reports itself by throwing, so it has to stand outside the catch
  // — inside it, a migration that worked perfectly comes back as "that did not
  // work" and the owner presses the button again looking for a change that has
  // already happened.
  try {
    report = adoptUnitPricing(by);
  } catch (e) {
    redirectWith(e);
  }
  revalidatePath("/items");
  revalidatePath("/sell");
  redirect(
    `/items?moved=${report.priced.length}&packs=${report.packsRetired}` +
      `&unpriced=${encodeURIComponent(report.unpriced.join(", "))}`,
  );
}

// -------------------------------------------------------------------- views

/**
 * The unit a size is typed in.
 *
 * Offered wherever a size is asked for, because "500 ml" is what the label says
 * and "0.5 litres" is what the database wanted.
 */
function UnitSelect({ name, value }: { name: string; value?: string }) {
  return (
    <select className={inputClass} name={name} defaultValue={value ?? SIZE_UNITS[0]?.key}>
      {SIZE_UNITS.map((u) => (
        <option key={u.key} value={u.key}>
          {u.label}
        </option>
      ))}
    </select>
  );
}

/**
 * One row per thing the shop sells.
 *
 * A list, not a grid of cards. Sixty items as cards is six screens of scrolling
 * to answer "what does Ungerol cost", and the answer is four characters wide —
 * so the row states name, unit, price and band on one line, and the editor only
 * exists once you open it.
 */
function ProductRow({ item }: { item: AdminItem }) {
  const weighed = item.price_basis === "unit";
  const per = weighed ? `per ${item.canonical_unit}` : "each";
  const reorderUnits = weighed
    ? item.reorder_level_milli / 1000
    : item.size_milli > 0
      ? item.reorder_level_milli / item.size_milli
      : 0;

  return (
    <details className={`group border-t border-line first:border-t-0 ${item.active ? "" : "opacity-60"}`}>
      <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2.5 hover:bg-wash/60">
        {/* The name takes the whole first line on a phone.
            Sharing one line with the unit, the band and the price left it about
            thirty pixels, and a list where every row reads "1 L…", "20 …", "A…"
            is not a list of products — you cannot tell which row you are about
            to edit. From `sm` up there is room for all four side by side. */}
        <span className="min-w-0 flex-1 basis-full truncate text-sm font-bold sm:basis-0">
          {item.name}
          {item.active ? null : <span className="ml-2 text-[11px] font-semibold text-bad">hidden</span>}
        </span>

        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
          {per}
        </span>

        {/* The band beside the price, because the price on its own does not say
            how far it may be argued — which is the question the counter asks. */}
        <span className="shrink-0 text-[11px] text-muted tnum">
          {item.floor_cents > 0 ? formatKes(item.floor_cents) : "no floor"}
          {" – "}
          {item.ceiling_cents > 0 ? formatKes(item.ceiling_cents) : "no ceiling"}
        </span>

        <span
          className={`w-28 shrink-0 text-right text-sm font-extrabold tnum ${
            item.price_cents > 0 ? "text-brand-deep" : "text-warn"
          }`}
        >
          {item.price_cents > 0 ? formatKes(item.price_cents) : "no price"}
        </span>
      </summary>

      <div className="px-3 pb-3">
        <PriceForm
          itemId={item.id}
          per={per}
          reorderHint={
            weighed
              ? `When less than this many ${item.canonical_unit} are left.`
              : `When fewer than this many ${item.unit_label}s are left.`
          }
          price={fromCents(item.price_cents)}
          floor={fromCents(item.floor_cents)}
          ceiling={fromCents(item.ceiling_cents)}
          reorder={reorderUnits}
        />

        {/* Hiding is a twice-a-year act; it lives inside the editor, in quiet
            ghost dress — red is for the moment of destruction, not the menu. */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <form action={toggleActive}>
            <input type="hidden" name="itemId" value={item.id} />
            <input type="hidden" name="active" value={item.active ? "0" : "1"} />
            <Button type="submit" variant="ghost">
              {item.active ? "Hide from the counter" : "Show on the counter"}
            </Button>
          </form>

          {/* Offered only where it is actually possible. A Delete that is going
              to be refused is worse than no Delete: it invites the owner to
              press it, then explains why they should not have. `deletableReason`
              asks the same question the service will ask, so the button and the
              rule can never disagree. */}
          <DeleteProduct itemId={item.id} name={item.name} held={deletableReason(item.id)} />
        </div>

        <p className="mt-2 text-[11px] text-muted">
          Arrives as {formatQty(item.size_milli, item.canonical_unit)} {item.unit_label}s
          {item.aliases ? ` · also called ${item.aliases}` : ""}
        </p>
      </div>
    </details>
  );
}

export default async function ItemsPage(props: {
  searchParams: Promise<{ err?: string; moved?: string; packs?: string; unpriced?: string }>;
}) {
  const { err, moved, packs, unpriced } = await props.searchParams;
  const me = await currentUser();
  if (!me) redirect("/login");
  // Prices, floors and the raw-chemical list all sit here; staff never see it.
  if (me.role !== "owner") redirect("/");

  const products = listProducts();
  const pending = pendingUnitPricing();
  const unpricedCount = products.filter((p) => p.active && p.price_cents === 0).length;

  return (
    <div>
      <PageTitle
        title="Products & prices"
        subtitle="One price for each thing, and how far it may be argued. Changed here or at the till."
      />

      {err ? (
        <div className="mb-3 max-w-4xl">
          <Alert tone="bad">{err}</Alert>
        </div>
      ) : null}

      {moved ? (
        <div className="mb-3 max-w-4xl">
          <Alert tone="good">
            <strong>
              {moved} chemical{moved === "1" ? "" : "s"} now priced per unit
            </strong>
            {packs && packs !== "0" ? `, ${packs} pack sizes retired` : ""}. The counter can sell any
            quantity of them, and a recipe adds up in full.
            {unpriced ? (
              <span className="mt-1 block font-semibold">
                No price could be worked out for {unpriced} — there was no priced pack to go on. Set
                those below before selling them.
              </span>
            ) : null}
          </Alert>
        </div>
      ) : null}

      {/*
        The one thing on this screen that has to be done before anything else
        works. Shown only while there is something to do, and gone for good once
        it is done.
      */}
      {pending.chemicals > 0 ? (
        <div className="mb-3 max-w-4xl rounded-2xl bg-warn-soft p-4 ring-1 ring-inset ring-warn/30">
          <p className="text-sm font-bold text-warn">
            {pending.chemicals} chemical{pending.chemicals === 1 ? " is" : "s are"} still priced by
            the pack.
          </p>
          <p className="mt-1.5 text-sm leading-relaxed">
            The counter sells chemicals by the kilogram now — any quantity, weighed out of the
            container. Until these move across they have no price per kilogram, so the till says
            “cannot be billed” when a recipe asks for them.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Pressing this works each price out from the pack you were already selling nearest one
            kilogram, pours the{" "}
            <span className="font-bold text-ink">{formatQty(pending.stockMilli, "kg")}</span> sitting
            in {pending.packRows} pack sizes back into the containers it came from, and hides those
            pack sizes. Nothing is deleted and no stock is created or lost — past sales still read
            exactly as they did.
          </p>
          <form action={adoptPricing} className="mt-3">
            <Button type="submit">Move {pending.chemicals} chemicals to per-unit pricing</Button>
          </form>
        </div>
      ) : null}

      {unpricedCount > 0 ? (
        <div className="mb-3 max-w-4xl">
          <Alert tone="warn">
            <strong>
              {unpricedCount} item{unpricedCount === 1 ? " has" : "s have"} no price.
            </strong>{" "}
            The counter shows {unpricedCount === 1 ? "it" : "them"} as “No price set” and
            will not sell {unpricedCount === 1 ? "it" : "them"} — open the row and put a number in.
          </Alert>
        </div>
      ) : null}

      <div className="max-w-4xl space-y-2.5">
        <div className="rounded-2xl bg-white p-4 shadow-card ring-1 ring-ink/5">
          <p className="text-sm leading-relaxed">
            <strong>Every price is per unit</strong> — per kilogram, per litre, per piece. The
            customer names a quantity and pays for exactly that.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            The band is what makes handing the counter a price safe. An attendant may agree anything
            between “never below” and “never beyond”; outside it, the sale
            stops until you type your PIN. Every change lands in{" "}
            <Link href="/prices/history" className="font-bold text-brand">
              Price history
            </Link>{" "}
            with a name on it.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            You never type what a chemical <em>cost</em> you. That comes from what you actually paid
            on the{" "}
            <Link href="/purchases" className="font-bold text-brand">
              Purchases
            </Link>{" "}
            screen, so the profit figures stay honest.
          </p>
        </div>
      </div>

      <h2 className="mb-2 mt-5 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted after:h-px after:flex-1 after:bg-line after:content-['']">
        {products.length} item{products.length === 1 ? "" : "s"}
      </h2>

      {/* One list. See `ProductRow` for why this is not a grid of cards. */}
      <div className="max-w-4xl overflow-hidden rounded-2xl bg-white shadow-card ring-1 ring-ink/5">
        {products.length ? (
          products.map((i) => <ProductRow key={i.id} item={i} />)
        ) : (
          <p className="px-3 py-6 text-center text-sm text-muted">
            Nothing on the list yet. Add the first one below.
          </p>
        )}
      </div>

      <h2 className="mb-2 mt-5 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted after:h-px after:flex-1 after:bg-line after:content-['']">
        Add something
      </h2>

      {/* One form, everything set here — see `createProduct`. A thing added
          without a price is a thing the counter cannot sell, and the old two
          forms let that happen by making pricing a separate errand. */}
      <Card className="max-w-4xl">
        <form action={addProduct} className="space-y-3">
          <div className="grid gap-2.5 sm:grid-cols-2">
            <Field label="Name" hint="What the counter will see.">
              <input className={inputClass} name="name" required placeholder="e.g. Caustic Soda" />
            </Field>
            <Field label="Other names it's known by" hint="Comma separated. Helps search find it.">
              <input className={inputClass} name="aliases" placeholder="soda ash, magadi" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            <Field label="Sold by" hint="The unit the price is per.">
              <UnitSelect name="unit" value="kg" />
            </Field>
            <Field label="Container holds" hint="What one drum or bag holds, in the unit above.">
              <input
                className={inputClass}
                type="number"
                name="container"
                min="0"
                step="any"
                required
                placeholder="25"
              />
            </Field>
            <Field label="Container is called" hint="drum, bag, jerrican…">
              <input className={inputClass} name="containerLabel" defaultValue="drum" />
            </Field>
            <Field label="Price per unit" hint="What one kilogram, litre or piece sells for.">
              <input
                className={inputClass}
                type="number"
                name="price"
                min="0"
                step="any"
                required
                placeholder="50"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-2.5 lg:max-w-md">
            <Field label="Never below" hint="Under this needs your PIN.">
              <input className={inputClass} type="number" name="floor" min="0" step="any" placeholder="40" />
            </Field>
            <Field label="Never beyond" hint="Over this needs your PIN.">
              <input className={inputClass} type="number" name="ceiling" min="0" step="any" placeholder="60" />
            </Field>
          </div>

          <Button type="submit" className="w-full sm:w-auto">
            Add it
          </Button>
        </form>
      </Card>

      <p className="mt-5 max-w-4xl text-xs text-muted">
        Every price change and new product is recorded against your name.
      </p>
    </div>
  );
}
