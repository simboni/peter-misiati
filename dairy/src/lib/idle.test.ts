/**
 * The idle rules, which protect attribution on a shared phone.
 *
 * `IDLE_TIMEOUT_SECONDS` was exported from this module from the first commit
 * and read by nothing: sessions ran the full twelve hours, so every record
 * after 5am was attributed to whoever signed in first. These tests exist so
 * that cannot quietly become true again.
 */
import { describe, it, expect } from "vitest";
import { isServerIdle, SERVER_IDLE_SECONDS, IDLE_TIMEOUT_SECONDS } from "./idle";
import type { SessionPayload } from "./session";

const NOW = Date.UTC(2026, 7, 4, 5, 30);

function session(over: Partial<SessionPayload> = {}): SessionPayload {
  return {
    userId: "11111111-1111-4111-8111-111111111111",
    farmId: "22222222-2222-4222-8222-222222222222",
    role: "HERDSMAN",
    fullName: "Kamau Njoroge",
    language: "en",
    expiresAt: NOW + 12 * 60 * 60 * 1000,
    lastSeenAt: NOW,
    ...over,
  };
}

describe("server-side idle", () => {
  it("trusts a session the server saw a moment ago", () => {
    expect(isServerIdle(session(), NOW + 30_000)).toBe(false);
  });

  it("still trusts one at the very edge of the window", () => {
    expect(isServerIdle(session(), NOW + SERVER_IDLE_SECONDS * 1000)).toBe(false);
  });

  it("stops trusting a phone left on a bench", () => {
    expect(isServerIdle(session(), NOW + SERVER_IDLE_SECONDS * 1000 + 1)).toBe(true);
  });

  /**
   * The field is new. Everyone signed in across a deploy carries a token
   * without it, and bouncing all of them to the PIN pad mid-milking would be a
   * worse bug than the one being fixed.
   */
  it("does not bounce a session minted before the stamp existed", () => {
    expect(isServerIdle(session({ lastSeenAt: undefined }), NOW + 86_400_000)).toBe(false);
  });

  /**
   * The device window is short because it can see that nobody is touching the
   * screen. The server window is long because it cannot — entering a milking
   * makes no requests at all, so a 60-second server window would sign a man out
   * mid-sheet.
   */
  it("gives the server a far longer rope than the device", () => {
    expect(SERVER_IDLE_SECONDS).toBeGreaterThan(IDLE_TIMEOUT_SECONDS * 10);
  });
});
