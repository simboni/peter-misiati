"use server";

/**
 * Setting a finding aside, and bringing it back.
 *
 * In its own file rather than inline on the page: an action declared beside a
 * helper carries that helper across the wire and falls over on the first click
 * with an error that points at the props. Module scope is referenced, not
 * captured.
 *
 * Neither of these touches a price, a cost or a quantity. They change what the
 * screen shows and nothing else, which is why a screen that "never fixes
 * anything" can still carry them.
 */

import { revalidatePath } from "next/cache";
import { currentUser, can } from "@/lib/auth";
import { dismiss, restore } from "@/lib/dismissals";

export interface CheckState {
  ok?: string;
  error?: string;
}

export async function setAsideAction(_prev: CheckState, form: FormData): Promise<CheckState> {
  const user = await currentUser();
  if (!user || !can(user, "cost")) return { error: "Only the owner can set a finding aside." };

  const key = String(form.get("key") ?? "").trim();
  const said = String(form.get("said") ?? "").trim();
  const note = String(form.get("note") ?? "").trim();
  if (!key || !said) return { error: "Nothing to set aside." };

  dismiss(key, said, user.id, note);
  revalidatePath("/check");
  revalidatePath("/reports");
  return { ok: "Set aside. It comes back if the figures change." };
}

export async function bringBackAction(_prev: CheckState, form: FormData): Promise<CheckState> {
  const user = await currentUser();
  if (!user || !can(user, "cost")) return { error: "Only the owner can do that." };

  const key = String(form.get("key") ?? "").trim();
  if (!key) return { error: "Nothing to bring back." };

  restore(key, user.id);
  revalidatePath("/check");
  revalidatePath("/reports");
  return { ok: "Back on the list." };
}
