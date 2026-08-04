"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import * as s from "@/db/schema";
import {
  clearPinAttempts,
  createSession,
  destroySession,
  pinAttempt,
  verifyPin,
} from "@/lib/session";
import { actionError, actionOk, guard, type ActionResult } from "@/lib/dal";

/**
 * Sign-in for a shared phone.
 *
 * Only about half of rural Kenyans personally own the handset they use, and
 * 11% use one they do not own — so the design target is four herdsmen sharing
 * one phone through a milking without a single entry landing under the wrong
 * name. Hence a person picker plus a 4-digit PIN, and never an email and
 * password: "login restrictions" are a named cause of death for field
 * deployments across Africa, and a password reset over a 2G link loses the user
 * permanently.
 */

/** The picker. Photos and names only — no identifiers a stranger could use. */
export async function listStaffForPicker(farmId: string) {
  return db
    .select({
      id: s.appUser.id,
      fullName: s.appUser.fullName,
      photoUrl: s.appUser.photoUrl,
      role: s.appUser.role,
    })
    .from(s.appUser)
    .where(and(eq(s.appUser.farmId, farmId), eq(s.appUser.active, true)));
}

export async function signIn(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ userId: string }>> {
  return guard(async () => {
    const userId = String(formData.get("userId") ?? "");
    const pin = String(formData.get("pin") ?? "");

    if (!userId) return actionError("Choose who you are first.");
    if (!/^\d{4}$/.test(pin)) return actionError("Your PIN is four numbers.");

    const gate = pinAttempt(userId);
    if (!gate.allowed) {
      return actionError(
        `Too many tries. Wait ${gate.retryInSeconds} seconds, then try again.`,
      );
    }

    const user = await db.query.appUser.findFirst({
      where: and(eq(s.appUser.id, userId), eq(s.appUser.active, true)),
    });
    // Same message whether the user is missing or the PIN is wrong — telling
    // them apart lets someone enumerate the staff list.
    if (!user || !(await verifyPin(pin, user.pinHash))) {
      return actionError("That PIN is not right. Try again.");
    }

    clearPinAttempts(userId);
    await createSession({
      userId: user.id,
      farmId: user.farmId,
      role: user.role,
      fullName: user.fullName,
      language: user.language,
    });

    // Go straight to the task grid. Returning a success state instead left the
    // user staring at the keypad they had just completed, with the cookie set
    // and nothing to show for it — the session existed but the screen did not
    // move. `guard` re-throws redirect digests, so this passes through it.
    redirect("/");
  });
}

/**
 * Back to the picker. Called after each save and on idle, because a session
 * left open on a shared phone is how one herdsman's milking ends up recorded
 * against another's name.
 */
export async function signOut(): Promise<void> {
  await destroySession();
  redirect("/login");
}
