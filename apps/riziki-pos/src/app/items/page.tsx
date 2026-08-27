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
import { fromCents, formatKes, formatQty, type SizeUnit } from "@/lib/units";
import { Alert, Button, Card, PageTitle } from "@/components/ui";
import { stockOf } from "@/lib/db";
import { ListToolbar, Pager } from "@/components/section-nav";
import { itemBundles, saveBundles, BundleError } from "@/lib/bundles";
import { parseBundleRows } from "@/lib/bundle-input";
import PriceForm from "./price-form";
import DeleteProduct from "./delete-product";
import AddProductForm, { type AddProductState } from "./add-product-form";

// Prices and the catalogue change here; never serve a cached copy.
export const dynamic = "force-dynamic";

/**
 * Rows per page.
 *
 * Twenty, not fifteen: every row here is a closed `<details>` one line high
 * until it is opened, so twenty of them still fit a laptop screen, and pricing
 * a delivery usually means touching several chemicals whose names sit near
 * each other.
 */
const PER_PAGE = 20;

type ItemFilter = "all" | "unpriced" | "hidden";

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

/**
 * Add a chemical, and the sizes it is sold in, on one save.
 *
 * It answers back rather than redirecting on a refusal — see `AddProductForm`.
 * A form that has just been walked through in two steps must not be emptied
 * because the floor was typed above the ceiling.
 */
async function addProduct(
  _prev: AddProductState,
  formData: FormData,
): Promise<AddProductState> {
  "use server";
  let itemId: number;
  try {
    const by = await guard();
    itemId = createProduct({
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
    // A separate transaction on purpose: `tx` does not nest, and the product
    // existing without its sizes is a recoverable state — the row's own Bundles
    // fold sets them — whereas a size with no product is not.
    saveBundles({ itemId }, parseBundleRows(formData.get("bundles")));
  } catch (e) {
    if (e instanceof CatalogError || e instanceof BundleError) return { error: e.message };
    return { error: "That did not work. Please try again." };
  }

  // Outside the catch: `redirect` reports itself by throwing. See AGENTS.md.
  revalidatePath("/items");
  revalidatePath("/sell");
  redirect(`/items?added=${itemId}`);
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
          name={item.name}
          aliases={item.aliases ?? ""}
          unit={item.canonical_unit}
          container={item.size_milli / 1000}
          containerLabel={item.unit_label}
          isChemical={Boolean(item.chemical_id)}
          price={fromCents(item.price_cents)}
          floor={fromCents(item.floor_cents)}
          ceiling={fromCents(item.ceiling_cents)}
          reorder={reorderUnits}
          onHandMilli={stockOf(item.id)}
          bundles={itemBundles(item.id).map((b) => ({
            size: String(b.sizeMilli / 1000),
            price: String(b.priceCents / 100),
            floor: b.floorCents ? String(b.floorCents / 100) : "",
          }))}
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
  searchParams: Promise<{
    err?: string;
    moved?: string;
    packs?: string;
    unpriced?: string;
    q?: string;
    state?: string;
    page?: string;
  }>;
}) {
  const { err, moved, packs, unpriced, q = "", state, page: pageParam } = await props.searchParams;
  const me = await currentUser();
  if (!me) redirect("/login");
  // Prices, floors and the raw-chemical list all sit here; staff never see it.
  if (me.role !== "owner") redirect("/");

  const products = listProducts();
  const pending = pendingUnitPricing();
  const unpricedCount = products.filter((p) => p.active && p.price_cents === 0).length;

  /*
    Search and paging over the catalogue.

    A hundred rows is a scroll, and pricing is not a job anybody does a hundred
    rows at a time — it is done one chemical at a time, the one a supplier just
    put a new price on. So the search box is the way in, and "No price yet" is
    a filter because that is the one list the owner does work straight down.

    The paging is by URL rather than in the browser: opening a row and saving a
    price re-renders the page from the server, and a page number held in React
    state would be lost every time a price was saved.
  */
  const filter: ItemFilter = (["unpriced", "hidden"] as const).includes(state as never)
    ? (state as ItemFilter)
    : "all";
  const needle = q.trim().toLowerCase();
  const matching = products
    .filter((p) => !needle || `${p.name} ${p.aliases ?? ""}`.toLowerCase().includes(needle))
    .filter((p) =>
      filter === "unpriced"
        ? p.active && p.price_cents === 0
        : filter === "hidden"
          ? !p.active
          : true,
    );

  const pages = Math.max(1, Math.ceil(matching.length / PER_PAGE));
  const page = Math.min(Math.max(1, Number(pageParam) || 1), pages);
  const shown = matching.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const listParams = { ...(q ? { q } : {}), ...(filter !== "all" ? { state: filter } : {}) };

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

      <div className="mt-5 max-w-4xl">
        <ListToolbar
          action="/items"
          q={q}
          placeholder="Search a product or chemical…"
          current={filter}
          filters={[
            { key: "all", label: "Everything", count: products.length },
            { key: "unpriced", label: "No price yet", count: unpricedCount },
            { key: "hidden", label: "Hidden", count: products.filter((p) => !p.active).length },
          ]}
        />
      </div>

      {/* One list. See `ProductRow` for why this is not a grid of cards. */}
      <div className="max-w-4xl overflow-hidden rounded-2xl bg-white shadow-card ring-1 ring-ink/5">
        {shown.length ? (
          shown.map((i) => <ProductRow key={i.id} item={i} />)
        ) : (
          <p className="px-3 py-6 text-center text-sm text-muted">
            {needle || filter !== "all"
              ? "Nothing matches that."
              : "Nothing on the list yet. Add the first one below."}
          </p>
        )}
      </div>

      <div className="max-w-4xl">
        <Pager
          action="/items"
          page={page}
          pages={pages}
          total={matching.length}
          noun="item"
          order="list"
          params={listParams}
        />
      </div>

      <h2 className="mb-2 mt-5 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted after:h-px after:flex-1 after:bg-line after:content-['']">
        Add something
      </h2>

      {/* Two steps, one save — see `AddProductForm`. Everything is still set
          here in one go: a thing added without a price is a thing the counter
          cannot sell, and the sizes it comes in are part of that price. */}
      <Card className="max-w-4xl">
        <AddProductForm action={addProduct} />
      </Card>

      <p className="mt-5 max-w-4xl text-xs text-muted">
        Every price change and new product is recorded against your name.
      </p>
    </div>
  );
}
