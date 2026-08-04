import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentUser, requireOwner } from "@/lib/auth";
import { performRepack, repackOptions, recentRepacks, voidRepack } from "@/lib/stock-service";
import { formatQty } from "@/lib/units";
import { RepackClient, type RepackState } from "./repack-client";

export const dynamic = "force-dynamic";

async function submitRepack(_prev: RepackState, formData: FormData): Promise<RepackState> {
  "use server";

  const user = await requireOwner();

  // Pack counts arrive as `units_<itemId>`; blanks simply mean "none of this size".
  const lines: Array<{ itemId: number; units: number }> = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("units_")) continue;
    const units = Math.floor(Number(value));
    if (!Number.isFinite(units) || units <= 0) continue;
    lines.push({ itemId: Number(key.slice("units_".length)), units });
  }

  try {
    const result = performRepack({
      fromItemId: Number(formData.get("bulkItemId")),
      bulkUnits: Number(formData.get("bulkUnits")),
      lines,
      userId: user.id,
    });

    revalidatePath("/repack");
    revalidatePath("/stock");
    revalidatePath("/");

    return {
      ok:
        `Repacked ${formatQty(result.inMilli, result.unit)} of ${result.fromName} into ` +
        `${formatQty(result.outMilli, result.unit)} of packs — loss ` +
        `${formatQty(result.lossMilli, result.unit)} (${result.lossPct.toFixed(2)}%).`,
    };
  } catch (err) {
    // Every guard in the service throws with a message written for the counter.
    return { error: err instanceof Error ? err.message : "The repack could not be saved." };
  }
}

async function voidRepackAction(formData: FormData): Promise<void> {
  "use server";

  const user = await requireOwner();
  try {
    voidRepack(Number(formData.get("repackId")), user.id, String(formData.get("reason") ?? ""));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not void the repack.";
    redirect(`/repack?verr=${encodeURIComponent(message)}`);
  }
  revalidatePath("/repack");
  revalidatePath("/stock");
  redirect("/repack?voided=1");
}

export default async function RepackPage(props: {
  searchParams: Promise<{ voided?: string; verr?: string }>;
}) {
  const { voided, verr } = await props.searchParams;
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role !== "owner") redirect("/"); // raw-reagent quantities are owner-only
  const owner = user.role === "owner";

  const options = repackOptions();

  return (
    <RepackClient
      // Cost never leaves the server for an attendant's phone.
      options={owner ? options : options.map((o) => ({ ...o, costCents: 0 }))}
      recent={recentRepacks(5)}
      owner={owner}
      action={submitRepack}
      voidAction={voidRepackAction}
      voidNotice={voided ? "Repack voided. The bulk is back on the shelf and the packs removed." : undefined}
      voidError={verr}
    />
  );
}
