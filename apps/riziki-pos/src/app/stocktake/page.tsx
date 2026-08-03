import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentUser, requireUser } from "@/lib/auth";
import { performStocktake, stockLines } from "@/lib/stock-service";
import { formatKes } from "@/lib/units";
import { StocktakeClient, type StocktakeState } from "./stocktake-client";

export const dynamic = "force-dynamic";

async function submitStocktake(_prev: StocktakeState, formData: FormData): Promise<StocktakeState> {
  "use server";

  const user = await requireUser();

  const counts: Array<{ itemId: number; countedUnits: number }> = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("count_")) continue;
    const text = String(value).trim();
    if (text === "") continue;
    const countedUnits = Number(text);
    if (!Number.isFinite(countedUnits)) continue;
    counts.push({ itemId: Number(key.slice("count_".length)), countedUnits });
  }

  try {
    const result = performStocktake({
      counts,
      reason: String(formData.get("reason") ?? ""),
      userId: user.id,
    });

    revalidatePath("/stocktake");
    revalidatePath("/stock");
    revalidatePath("/");

    // Only the owner is told what the shrinkage was worth.
    const value = user.role === "owner" ? ` (${formatKes(result.varianceCents)} at cost)` : "";
    return {
      ok: `Posted ${result.posted} adjustment${result.posted === 1 ? "" : "s"} from ${result.countedItems} counted items${value}.`,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "The stock take could not be posted." };
  }
}

export default async function StocktakePage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  const owner = user.role === "owner";

  const lines = stockLines();

  return (
    <StocktakeClient
      // Staff count the shelf; they never see what it is worth.
      lines={owner ? lines : lines.map((l) => ({ ...l, costCents: 0, valueCents: 0 }))}
      owner={owner}
      action={submitStocktake}
    />
  );
}
