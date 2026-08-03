import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { stockView } from "@/lib/stock-service";
import { StockClient } from "./stock-client";

export const dynamic = "force-dynamic";

export default async function StockPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const owner = user.role === "owner";

  const view = stockView();

  // Cost is stripped here rather than merely hidden in the UI: a client component
  // receives its props as serialised JSON, so an attendant's phone must never be
  // sent the figures in the first place.
  const safe = owner
    ? view
    : {
        ...view,
        totalValueCents: 0,
        reagents: view.reagents.map((g) => ({
          ...g,
          valueCents: 0,
          lines: g.lines.map((l) => ({ ...l, costCents: 0, valueCents: 0 })),
        })),
        finished: view.finished.map((l) => ({ ...l, costCents: 0, valueCents: 0 })),
        packaging: view.packaging.map((l) => ({ ...l, costCents: 0, valueCents: 0 })),
      };

  return <StockClient view={safe} owner={owner} />;
}
