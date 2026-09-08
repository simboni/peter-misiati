import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { stockView, stockLines } from "@/lib/stock-service";
import { StockWindow } from "./stock-window";
import { submitStocktake } from "./actions";
import { borrowed } from "@/lib/borrowing";
import { formatQty } from "@/lib/units";
import { Alert } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * The Stock window: what is on the shelf, and counting it.
 *
 * Both panels are fetched here and swapped in the browser, so the switch costs
 * nothing and a half-typed stock take survives a glance at what the book says.
 * See `StockWindow`.
 */
export default async function StockPage(props: {
  searchParams: Promise<{ q?: string; panel?: string }>;
}) {
  // `q` lets the home screen's low-stock rows land here pre-searched, and
  // `panel` lets anything that used to link to /stocktake open on the count.
  const { q = "", panel } = await props.searchParams;
  const user = await currentUser();
  if (!user) redirect("/login");
  const owner = user.role === "owner";

  const view = stockView();

  // Two things are stripped here rather than merely hidden in the UI, because a
  // client component receives its props as serialised JSON — whatever reaches
  // this object reaches the attendant's phone:
  //   - cost/value (never staff-visible), and
  //   - the raw-reagent quantities themselves. An attendant who could read each
  //     reagent's on-hand amount before and after a production run would recover
  //     the formula ratios by subtraction. Staff see finished goods and
  //     packaging — what they sell — never the chemicals a recipe is built from.
  const safe = owner
    ? view
    : {
        ...view,
        totalValueCents: 0,
        reagents: [],
        finished: view.finished.map((l) => ({ ...l, costCents: 0, valueCents: 0 })),
        packaging: view.packaging.map((l) => ({ ...l, costCents: 0, valueCents: 0 })),
      };

  // Same reasoning for the count sheet: an attendant never receives it at all,
  // rather than receiving it and being shown no tab.
  const countLines = owner ? stockLines() : [];

  /*
    What has been sold that the shop did not have.

    A negative count IS the debt to the yard next door, in the unit the debt is
    in — so this is not a separate ledger, it is the shelf read the other way
    round. It sits above the shelf rather than inside it because it is an errand
    rather than a figure: somebody has to walk over with it, or put it on the
    next order.
  */
  const owing = borrowed();

  return (
    <>
      {owing.length ? (
        <div className="mb-4 max-w-3xl">
          <Alert tone="warn">
            <span className="font-bold">Fetched from next door and not yet replaced:</span>{" "}
            {owing
              .map((b) => `${formatQty(b.owedMilli, b.unit)} of ${b.name}`)
              .join(", ")}
            . Recording the delivery settles it — the count comes back up on its own.
          </Alert>
        </div>
      ) : null}
    <StockWindow
      view={safe}
      countLines={countLines}
      owner={owner}
      initialQuery={q}
      stocktakeAction={submitStocktake}
      initialPanel={panel === "count" ? "count" : "shelf"}
    />
    </>
  );
}
