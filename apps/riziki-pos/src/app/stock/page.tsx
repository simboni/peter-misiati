import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { stockView, stockLines, } from "@/lib/stock-service";
import { madeProducts, recentMakes } from "@/lib/making";
import { stockOf } from "@/lib/db";
import { StockWindow } from "./stock-window";
import { submitStocktake, makeBatchAction } from "./actions";

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
    What the shop makes rather than buys.

    Owner-only for the same reason the count sheet is: what goes into a
    dilution and what comes out of it is the ratio, and an attendant who could
    read it could work out what the shop pays for the concentrate. Nearly
    always empty — two products in this catalogue are made, the rest are bought
    — and the Make tab does not appear at all when it is.
  */
  const makeChoices = owner
    ? madeProducts().map((c) => ({
        toItemId: c.toItemId,
        toName: c.toName,
        toUnit: c.toUnit,
        fromName: c.fromName,
        fromUnit: c.fromUnit,
        inQty: c.inMilli / 1000,
        outQty: c.outMilli / 1000,
        fromOnHandMilli: c.fromOnHandMilli,
        toOnHandMilli: stockOf(c.toItemId),
      }))
    : [];

  const madeRecently = owner
    ? recentMakes(12).map((b) => ({
        id: b.id,
        at: b.at,
        fromName: b.from_name,
        fromUnit: b.from_unit,
        inMilli: b.in_milli,
        toName: b.to_name,
        toUnit: b.to_unit,
        outMilli: b.out_milli,
        userName: b.user_name,
      }))
    : [];

  return (
    <StockWindow
      view={safe}
      countLines={countLines}
      owner={owner}
      initialQuery={q}
      stocktakeAction={submitStocktake}
      initialPanel={panel === "count" ? "count" : panel === "make" ? "make" : "shelf"}
      makeChoices={makeChoices}
      recentMakes={madeRecently}
      makeAction={makeBatchAction}
    />
  );
}
