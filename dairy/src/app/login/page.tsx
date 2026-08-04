import { db } from "@/db";
import * as s from "@/db/schema";
import { eq } from "drizzle-orm";
import { PinPad } from "./pin-pad";

export const dynamic = "force-dynamic";

/**
 * The person picker.
 *
 * Photos first, names second, no typing until a face has been tapped. This is
 * the screen four herdsmen share on one phone through a 5am milking.
 */
export default async function LoginPage({
  searchParams,
}: {
  // Next 16: searchParams is always a promise.
  searchParams: Promise<{ idle?: string }>;
}) {
  const { idle } = await searchParams;
  // Single-tenant sign-in for now: one farm per deployment. The schema is
  // multi-tenant throughout, so adding a farm chooser here is the only change
  // needed when the second customer arrives.
  const [theFarm] = await db.select().from(s.farm).limit(1);

  if (!theFarm) {
    return (
      <main className="mx-auto max-w-md p-6">
        <h1 className="text-xl font-semibold">No farm set up yet</h1>
        <p className="mt-2 text-sm text-ink-2">
          Run <code className="font-mono">npm run db:seed</code> to create the demo farm.
        </p>
      </main>
    );
  }

  const staff = await db
    .select({
      id: s.appUser.id,
      fullName: s.appUser.fullName,
      photoUrl: s.appUser.photoUrl,
      role: s.appUser.role,
    })
    .from(s.appUser)
    .where(eq(s.appUser.farmId, theFarm.id));

  return (
    <main className="mx-auto max-w-md p-6">
      <header className="mb-6">
        <p className="font-mono text-xs uppercase tracking-widest text-brass">{theFarm.name}</p>
        <h1 className="mt-1 text-2xl font-semibold">Who are you?</h1>
        {idle ? (
          <p className="mt-2 rounded-md border border-line bg-paper p-3 text-sm text-ink-2">
            The phone was put down for a while, so it came back here. Nothing you saved was
            lost — tap your face and carry on.
          </p>
        ) : null}
      </header>
      <PinPad staff={staff.filter((u) => u.id)} />
    </main>
  );
}
