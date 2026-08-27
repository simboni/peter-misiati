import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { stockView, stockLines } from "@/lib/stock-service";
import { StockWindow } from "./stock-window";
import { submitStocktake } from "./actions";

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

  return (
    <StockWindow
      view={safe}
      countLines={countLines}
      owner={owner}
      initialQuery={q}
      stocktakeAction={submitStocktake}
      initialPanel={panel === "count" ? "count" : "shelf"}
    />
  );
}
