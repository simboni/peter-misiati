/**
 * Draft storage — the safety net that stops a dropped network eating a
 * half-typed invoice. The rules worth pinning are the ones that decide
 * whether someone's work comes back or quietly does not.
 */

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  clearDraft,
  draftAgo,
  draftHasContent,
  draftKey,
  DRAFT_MAX_AGE_MS,
  loadDraft,
  saveDraft,
  type Draft,
} from "../src/lib/draft";

// A minimal localStorage, since these tests run in node.
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}

declare global {
  // eslint-disable-next-line no-var
  var localStorage: Storage;
}

beforeEach(() => {
  globalThis.localStorage = new MemStorage() as unknown as Storage;
});

const line = (over: Partial<Draft["lines"][number]> = {}) => ({
  itemId: "",
  title: "",
  description: "",
  quantity: "1",
  unitPrice: "",
  taxRate: "",
  ...over,
});

const body = (over: Partial<Omit<Draft, "v" | "savedAt">> = {}): Omit<Draft, "v" | "savedAt"> => ({
  clientId: "",
  currency: "KES",
  discountType: "",
  discountValue: "",
  depositType: "none",
  depositValue: "",
  showMore: false,
  lines: [line()],
  fields: {},
  ...over,
});

test("keys are per document, so two invoices cannot overwrite each other", () => {
  assert.equal(draftKey("invoice", null), "tp:draft:invoice:new");
  assert.equal(draftKey("invoice", "abc"), "tp:draft:invoice:abc");
  assert.notEqual(draftKey("invoice", "abc"), draftKey("quotation", "abc"));
  assert.notEqual(draftKey("invoice", "abc"), draftKey("invoice", "xyz"));
});

test("a saved draft round-trips with every line intact", () => {
  const k = draftKey("invoice", null);
  const lines = Array.from({ length: 20 }, (_, i) =>
    line({ title: `Line ${i + 1}`, unitPrice: String(1000 + i) }),
  );
  assert.equal(saveDraft(k, body({ lines, clientId: "c1" })), true);

  const back = loadDraft(k);
  assert.ok(back, "draft should come back");
  assert.equal(back.lines.length, 20);
  assert.equal(back.lines[0].title, "Line 1");
  assert.equal(back.lines[19].title, "Line 20");
  assert.equal(back.lines[19].unitPrice, "1019");
  assert.equal(back.clientId, "c1");
});

test("the uncontrolled fields survive too", () => {
  const k = draftKey("invoice", null);
  saveDraft(k, body({ fields: { issueDate: "2026-03-01", dueDate: "2026-03-31", notes: "Pay by M-Pesa", terms: "30 days" } }));
  const back = loadDraft(k)!;
  assert.equal(back.fields.dueDate, "2026-03-31");
  assert.equal(back.fields.notes, "Pay by M-Pesa");
});

test("a missing draft is null, not a crash", () => {
  assert.equal(loadDraft("tp:draft:invoice:nothing-here"), null);
});

test("corrupt or foreign data is ignored rather than thrown", () => {
  const k = draftKey("invoice", null);
  localStorage.setItem(k, "{not json");
  assert.equal(loadDraft(k), null);
  localStorage.setItem(k, JSON.stringify({ v: 999, savedAt: Date.now(), lines: [] }));
  assert.equal(loadDraft(k), null, "a future version is not readable");
  localStorage.setItem(k, JSON.stringify({ v: 1, savedAt: Date.now() }));
  assert.equal(loadDraft(k), null, "no lines array");
});

test("a stale draft is dropped, and dropped for good", () => {
  const k = draftKey("invoice", null);
  saveDraft(k, body({ lines: [line({ title: "Ancient" })] }));
  const raw = JSON.parse(localStorage.getItem(k)!);
  raw.savedAt = Date.now() - DRAFT_MAX_AGE_MS - 1000;
  localStorage.setItem(k, JSON.stringify(raw));

  assert.equal(loadDraft(k), null, "too old to offer back");
  assert.equal(localStorage.getItem(k), null, "and cleaned up, not left to rot");
});

test("clearing removes it", () => {
  const k = draftKey("invoice", null);
  saveDraft(k, body({ clientId: "c1" }));
  assert.ok(loadDraft(k));
  clearDraft(k);
  assert.equal(loadDraft(k), null);
});

test("an empty form is not worth offering back", () => {
  const empty = { ...body(), v: 1, savedAt: Date.now() } as Draft;
  assert.equal(draftHasContent(empty), false);

  // Any one of these makes it real work.
  assert.equal(draftHasContent({ ...empty, clientId: "c1" }), true, "a chosen client counts");
  assert.equal(
    draftHasContent({ ...empty, lines: [line({ title: "Laundry" })] }),
    true,
    "a typed title counts",
  );
  assert.equal(
    draftHasContent({ ...empty, lines: [line({ description: "Express" })] }),
    true,
    "a typed description counts",
  );
  assert.equal(
    draftHasContent({ ...empty, lines: [line({ unitPrice: "2500" })] }),
    true,
    "a typed price counts",
  );
  assert.equal(
    draftHasContent({ ...empty, fields: { notes: "call first" } }),
    true,
    "typed notes count",
  );
  assert.equal(
    draftHasContent({ ...empty, lines: [line({ unitPrice: "0" })] }),
    false,
    "a zero price is not content",
  );
});

test("storage being unavailable degrades quietly", () => {
  // Private mode: every access throws. The editor must keep working.
  globalThis.localStorage = {
    getItem() {
      throw new Error("denied");
    },
    setItem() {
      throw new Error("denied");
    },
    removeItem() {
      throw new Error("denied");
    },
  } as unknown as Storage;

  assert.equal(saveDraft("k", body()), false, "reports failure rather than throwing");
  assert.equal(loadDraft("k"), null);
  assert.doesNotThrow(() => clearDraft("k"));
});

test("draftAgo reads like a person wrote it", () => {
  const now = Date.now();
  assert.equal(draftAgo(now), "just now");
  assert.equal(draftAgo(now - 60_000), "1 minute ago");
  assert.equal(draftAgo(now - 120_000), "2 minutes ago");
  assert.equal(draftAgo(now - 3_600_000), "1 hour ago");
  assert.equal(draftAgo(now - 86_400_000), "1 day ago");
});
