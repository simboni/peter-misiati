#!/usr/bin/env node
/**
 * Reset a user's password directly against the database.
 *
 * For when someone (usually you) can't get in and there's no email delivery
 * configured for the normal forgot-password flow.
 *
 * It uses better-auth's OWN hashPassword, so the stored value is in exactly
 * the format the login path verifies. Writing a hand-rolled scrypt hash here
 * would look right and never authenticate.
 *
 * Run it INSIDE the container, which already has DATABASE_URL set:
 *
 *   docker cp reset-password.mjs tallypay:/tmp/
 *   docker exec -e EMAIL=you@example.com -e NEWPW='your-new-password' \
 *     tallypay node /tmp/reset-password.mjs
 *
 * Only the `credential` (email + password) account is touched. Sessions are
 * left alone, so anyone already signed in stays signed in.
 */
import { hashPassword } from "better-auth/crypto";
import { createClient } from "@libsql/client";

const email = (process.env.EMAIL || "").trim();
const pw = process.env.NEWPW || "";

if (!email || !pw) {
  console.error("Set both EMAIL and NEWPW, e.g.\n" +
    "  docker exec -e EMAIL=you@example.com -e NEWPW='secret123' tallypay node /tmp/reset-password.mjs");
  process.exit(1);
}
if (pw.length < 8) {
  console.error("Password must be at least 8 characters (the app enforces this too).");
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set — are you running this inside the container?");
  process.exit(1);
}

const db = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });

const found = await db.execute({
  sql: "select id, email from user where lower(email) = lower(?)",
  args: [email],
});
if (found.rows.length === 0) {
  console.error(`No user with email ${email}.`);
  process.exit(1);
}
const userId = found.rows[0].id;

const accounts = await db.execute({
  sql: "select id from account where user_id = ? and provider_id = 'credential'",
  args: [userId],
});

const hash = await hashPassword(pw);

if (accounts.rows.length === 0) {
  // Signed up through a provider that left no password row — create one so
  // email+password login works from now on.
  await db.execute({
    sql: `insert into account (id, account_id, provider_id, user_id, password, created_at, updated_at)
          values (?, ?, 'credential', ?, ?, ?, ?)`,
    args: [crypto.randomUUID(), userId, userId, hash, Date.now(), Date.now()],
  });
  console.log(`Created a credential account for ${email} and set the password.`);
} else {
  const r = await db.execute({
    sql: "update account set password = ? where user_id = ? and provider_id = 'credential'",
    args: [hash, userId],
  });
  console.log(`Password updated for ${email} (${r.rowsAffected} row(s)).`);
}

console.log("Sign in at https://tallypay.smp.co.ke/login");
