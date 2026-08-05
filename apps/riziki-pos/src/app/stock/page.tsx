import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { stockView } from "@/lib/stock-service";
import { StockClient } from "./stock-client";

export const dynamic = "force-dynamic";

export default async function StockPage(props: {
  searchParams: Promise<{ q?: string }>;
}) {
  // `q` lets the home screen's low-stock rows land here pre-searched.
  const { q = "" } = await props.searchParams;
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

  return <StockClient view={safe} owner={owner} initialQuery={q} />;
}
