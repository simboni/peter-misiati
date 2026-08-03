"use server";

import { redirect } from "next/navigation";
import { clearSessionCookie } from "@/lib/auth";

/**
 * Signing out must be a POST action, never a GET link.
 *
 * As a link it was reachable by prefetch — Next's router, a browser, or a
 * scanner fetching the URL would silently destroy the session, and the
 * attendant would be thrown back to the PIN screen mid-sale for no visible
 * reason. A GET must never change state.
 */
export async function signOut() {
  await clearSessionCookie();
  redirect("/login");
}
