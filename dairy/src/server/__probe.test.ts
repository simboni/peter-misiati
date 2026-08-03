import { describe, it, expect, vi } from "vitest";
import { fakeSession } from "@/test/factory";

const H = vi.hoisted(() => ({ session: null as any }));
vi.mock("@/lib/session", async () => ({ readSessionCookie: async () => H.session }));

describe("probe2", () => {
  it("react cache does not stick across calls", async () => {
    const { verifySession } = await import("@/lib/dal");
    H.session = fakeSession({ farmId: "aaa" });
    expect((await verifySession()).farmId).toBe("aaa");
    H.session = fakeSession({ farmId: "bbb" });
    expect((await verifySession()).farmId).toBe("bbb");
  });
});
