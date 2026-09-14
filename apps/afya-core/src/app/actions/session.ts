"use server";

/**
 * Sign-in and sign-out.
 *
 * The cookie is httpOnly and sameSite=lax: a session token that JavaScript can
 * read is a session token an injected script can post to someone else, and this
 * one opens health records.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signIn, signOut } from "@/lib/users.ts";
import { getSettingNumber } from "@/lib/facility.ts";
import { SESSION_COOKIE } from "@/lib/auth.ts";

export type SignInState = { error?: string };

export async function signInAction(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const facilityId = Number(formData.get("facilityId") ?? 1);
  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");
  const deviceCode = String(formData.get("deviceCode") ?? "").trim() || undefined;

  let token: string;
  try {
    const result = signIn({ facilityId, username, password, deviceCode });
    token = result.token;
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Sign-in failed." };
  }

  const minutes = getSettingNumber("session_timeout_minutes", 30);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: minutes * 60,
    // Set over TLS in production; left off locally so the login works on http.
    secure: process.env.NODE_ENV === "production",
  });

  redirect("/");
}

export async function signOutAction(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) signOut(token);
  jar.delete(SESSION_COOKIE);
  redirect("/sign-in");
}
