"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getAuth } from "@/server/auth";

export type FormState = { error?: string };

function isDuplicateUser(e: unknown): boolean {
  const msg = messageFrom(e).toLowerCase();
  const code =
    e && typeof e === "object" && "body" in e
      ? String((e as { body?: { code?: string } }).body?.code ?? "").toUpperCase()
      : "";
  return code.includes("USER_ALREADY_EXISTS") || msg.includes("already exists") || msg.includes("already registered");
}

function messageFrom(e: unknown): string {
  if (e && typeof e === "object" && "body" in e) {
    const body = (e as { body?: { message?: string } }).body;
    if (body?.message) return body.message;
  }
  if (e instanceof Error) return e.message;
  return "Something went wrong. Please try again.";
}

export async function signUpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!name || !email || !password) return { error: "All fields are required." };
  if (password.length < 8) return { error: "Password must be at least 8 characters." };

  const auth = await getAuth();
  try {
    await auth.api.signUpEmail({ body: { name, email, password }, headers: await headers() });
  } catch (e) {
    // Don't echo the library's "User already exists" — that turns sign-up into
    // an oracle for which emails are registered. Return a uniform message for
    // the duplicate case; surface other (e.g. validation) errors as-is.
    if (isDuplicateUser(e)) {
      return { error: "We couldn't create an account with those details. Try signing in instead." };
    }
    return { error: messageFrom(e) };
  }
  redirect("/onboarding");
}

export async function signInAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Email and password are required." };

  const auth = await getAuth();
  try {
    await auth.api.signInEmail({ body: { email, password }, headers: await headers() });
  } catch (e) {
    return { error: messageFrom(e) };
  }
  redirect("/dashboard");
}

export async function signOutAction() {
  const auth = await getAuth();
  try {
    await auth.api.signOut({ headers: await headers() });
  } catch {
    // ignore
  }
  redirect("/login");
}
