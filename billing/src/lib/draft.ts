/**
 * Local draft storage for the document editors.
 *
 * Why this exists: a vendor typed a twenty-line invoice, the network dropped,
 * and every keystroke was gone. Everything in the editor lived in React state
 * and nowhere else, so a failed save — or a reload, or a closed tab — took the
 * lot. The server cannot help here; by definition it is the thing that is not
 * reachable. The work has to be on the device.
 *
 * localStorage rather than IndexedDB: a draft is a few kilobytes of text, the
 * synchronous API means a snapshot cannot lose a race with a page unload, and
 * there is no schema to migrate. Every access is wrapped, because localStorage
 * throws in private mode and in an iframe with third-party storage blocked —
 * losing drafts is bad, but crashing the editor over them is worse.
 */

export const DRAFT_VERSION = 1;

export type DraftLine = {
  itemId: string;
  title: string;
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
};

export type Draft = {
  v: number;
  savedAt: number;
  clientId: string;
  currency: string;
  discountType: string;
  discountValue: string;
  depositType: string;
  depositValue: string;
  showMore: boolean;
  lines: DraftLine[];
  /** The uncontrolled inputs: issueDate, dueDate, notes, terms. */
  fields: Record<string, string>;
};

/** One key per document, so editing two invoices cannot cross-contaminate. */
export function draftKey(type: string, id?: string | null): string {
  return `tp:draft:${type}:${id ?? "new"}`;
}

/** Drafts older than this are ignored — stale work is worse than none. */
export const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function saveDraft(key: string, draft: Omit<Draft, "v" | "savedAt">): boolean {
  try {
    const payload: Draft = { ...draft, v: DRAFT_VERSION, savedAt: Date.now() };
    localStorage.setItem(key, JSON.stringify(payload));
    return true;
  } catch {
    // Private mode, quota, or storage blocked. The editor keeps working.
    return false;
  }
}

export function loadDraft(key: string): Draft | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    if (!d || d.v !== DRAFT_VERSION || !Array.isArray(d.lines)) return null;
    if (Date.now() - d.savedAt > DRAFT_MAX_AGE_MS) {
      clearDraft(key);
      return null;
    }
    return d;
  } catch {
    return null;
  }
}

export function clearDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* nothing to do */
  }
}

/**
 * Whether a draft holds anything worth offering back. A pristine editor
 * autosaves too, and offering to restore an empty form is just noise.
 */
export function draftHasContent(d: Draft): boolean {
  if (d.clientId) return true;
  if (d.fields.notes?.trim()) return true;
  return d.lines.some(
    (l) => l.title.trim() !== "" || l.description.trim() !== "" || (l.unitPrice.trim() !== "" && l.unitPrice.trim() !== "0"),
  );
}

/** "14:32" — enough to recognise, short enough for a status line. */
export function draftTime(ms: number): string {
  try {
    return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

/** "2 minutes ago", for the restore banner. */
export function draftAgo(ms: number): string {
  const secs = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
