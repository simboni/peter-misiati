"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatMoney } from "@/server/money";
import { SMART_QUERIES, type Hit } from "@/lib/search";

/**
 * ⌘K command palette. Hand-rolled rather than pulling in cmdk: the behaviour
 * wanted here is a few hundred lines, and owning it keeps full control of the
 * keyboard model and avoids a dependency on a 0.x package in the critical path
 * of every page.
 *
 * Two kinds of result share one list. Static entries (actions, navigation,
 * saved views) are filtered in the browser and appear instantly, with no
 * network wait. Remote hits (invoices, clients, items) arrive from /api/search
 * on a debounce. The static ones are listed first precisely because they never
 * make you wait.
 */

type StaticItem = {
  id: string;
  group: "Actions" | "Views" | "Go to";
  label: string;
  href: string;
  keywords?: string;
  icon: string;
  /** Shown right-aligned, e.g. a shortcut hint. */
  hint?: string;
};

const PLUS = "M12 5v14M5 12h14";
const ARROW = "M5 12h14M13 6l6 6-6 6";

const STATIC: StaticItem[] = [
  { id: "a-inv", group: "Actions", label: "New invoice", href: "/invoices/new", keywords: "create bill add", icon: PLUS, hint: "N then I" },
  { id: "a-quo", group: "Actions", label: "New quotation", href: "/quotations/new", keywords: "create quote estimate", icon: PLUS, hint: "N then Q" },
  { id: "a-cli", group: "Actions", label: "New client", href: "/clients/new", keywords: "create customer add", icon: PLUS, hint: "N then C" },
  { id: "a-exp", group: "Actions", label: "New expense", href: "/expenses/new", keywords: "create cost spend", icon: PLUS },
  { id: "a-itm", group: "Actions", label: "New item", href: "/items/new", keywords: "create product service", icon: PLUS },
  { id: "a-dn", group: "Actions", label: "New delivery note", href: "/delivery-notes/new", keywords: "create dispatch", icon: PLUS },

  ...SMART_QUERIES.map((s, i) => ({
    id: `v-${i}`,
    group: "Views" as const,
    label: s.label,
    href: s.href,
    keywords: s.keywords,
    icon: ARROW,
  })),

  { id: "g-dash", group: "Go to", label: "Dashboard", href: "/dashboard", keywords: "home overview", icon: ARROW, hint: "G then D" },
  { id: "g-inv", group: "Go to", label: "Invoices", href: "/invoices", keywords: "bills", icon: ARROW, hint: "G then I" },
  { id: "g-rem", group: "Go to", label: "Reminders", href: "/reminders", keywords: "chase chasing queue", icon: ARROW, hint: "G then R" },
  { id: "g-rec", group: "Go to", label: "Recurring invoices", href: "/recurring", keywords: "subscriptions retainers", icon: ARROW },
  { id: "g-quo", group: "Go to", label: "Quotations", href: "/quotations", keywords: "quotes estimates", icon: ARROW },
  { id: "g-rcp", group: "Go to", label: "Receipts", href: "/receipts", keywords: "payments received", icon: ARROW },
  { id: "g-cn", group: "Go to", label: "Credit notes", href: "/credit-notes", keywords: "refunds", icon: ARROW },
  { id: "g-exp", group: "Go to", label: "Expenses", href: "/expenses", keywords: "costs", icon: ARROW },
  { id: "g-rep", group: "Go to", label: "Reports", href: "/reports", keywords: "analytics vat tax", icon: ARROW },
  { id: "g-cli", group: "Go to", label: "Clients", href: "/clients", keywords: "customers", icon: ARROW, hint: "G then C" },
  { id: "g-itm", group: "Go to", label: "Items", href: "/items", keywords: "products services catalogue", icon: ARROW },
  { id: "g-set", group: "Go to", label: "Settings", href: "/settings", keywords: "preferences business details reminders", icon: ARROW },
];

const KIND_META: Record<Hit["kind"], { group: string; icon: string }> = {
  invoice: { group: "Invoices", icon: "M6 2h9l3 3v17l-3-2-3 2-3-2-3 2V2zM9 8h6M9 12h6M9 16h4" },
  quotation: { group: "Quotations", icon: "M6 2h8l4 4v16H6zM14 2v4h4M9 13h6M9 17h4" },
  client: { group: "Clients", icon: "M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8z" },
  item: { group: "Items", icon: "M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8" },
};

type Row =
  | { type: "header"; key: string; label: string }
  | { type: "item"; key: string; label: string; sub?: string; href: string; icon: string; right?: string };

/** Substring match over label + keywords. Cheap and predictable. */
function matches(it: StaticItem, q: string): boolean {
  if (!q) return true;
  const hay = `${it.label} ${it.keywords ?? ""}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => hay.includes(word));
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQ("");
    setHits([]);
    setActive(0);
  }, []);

  // ⌘K / Ctrl+K from anywhere, and "/" when not already typing somewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inField =
        e.target instanceof HTMLElement &&
        (e.target.tagName === "INPUT" ||
          e.target.tagName === "TEXTAREA" ||
          e.target.tagName === "SELECT" ||
          e.target.isContentEditable);

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (e.key === "/" && !inField && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Let anything on the page open it (the header's search button).
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("tp:open-palette", onOpen);
    return () => window.removeEventListener("tp:open-palette", onOpen);
  }, []);

  useEffect(() => {
    if (open) {
      // Focus after paint so the caret lands reliably on mobile too.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Debounced remote search. An aborted controller stops an older, slower
  // response from overwriting a newer one.
  useEffect(() => {
    if (!open) return;
    const query = q.trim();
    if (query.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { hits: Hit[] };
        setHits(data.hits ?? []);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setHits([]);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 160);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, open]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const statics = STATIC.filter((s) => matches(s, q));

    for (const group of ["Actions", "Views", "Go to"] as const) {
      const inGroup = statics.filter((s) => s.group === group);
      if (inGroup.length === 0) continue;
      out.push({ type: "header", key: `h-${group}`, label: group });
      for (const s of inGroup) {
        out.push({
          type: "item",
          key: s.id,
          label: s.label,
          href: s.href,
          icon: s.icon,
          right: s.hint,
        });
      }
    }

    for (const kind of ["invoice", "quotation", "client", "item"] as const) {
      const inKind = hits.filter((h) => h.kind === kind);
      if (inKind.length === 0) continue;
      out.push({ type: "header", key: `h-${kind}`, label: KIND_META[kind].group });
      for (const h of inKind) {
        out.push({
          type: "item",
          key: `${kind}-${h.id}`,
          label: h.title,
          sub: h.subtitle,
          href: h.href,
          icon: KIND_META[kind].icon,
          right: h.amount != null ? formatMoney(h.amount, h.currency ?? "KES") : undefined,
        });
      }
    }

    return out;
  }, [q, hits]);

  const items = useMemo(() => rows.filter((r): r is Extract<Row, { type: "item" }> => r.type === "item"), [rows]);

  // Keep the highlight in range as results change under it.
  useEffect(() => {
    setActive((a) => (items.length === 0 ? 0 : Math.min(a, items.length - 1)));
  }, [items.length]);

  const go = useCallback(
    (href: string) => {
      close();
      router.push(href);
    },
    [close, router],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "ArrowDown" || (e.key === "n" && e.ctrlKey)) {
      e.preventDefault();
      setActive((a) => (items.length === 0 ? 0 : (a + 1) % items.length));
      return;
    }
    if (e.key === "ArrowUp" || (e.key === "p" && e.ctrlKey)) {
      e.preventDefault();
      setActive((a) => (items.length === 0 ? 0 : (a - 1 + items.length) % items.length));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const it = items[active];
      if (it) go(it.href);
    }
  };

  // Scroll the highlighted row into view when moving by keyboard.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  let idx = -1;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 px-4 pt-[10vh] backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div className="flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        <div className="flex items-center gap-2 border-b border-line px-4">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="h-4 w-4 flex-none text-muted"
            aria-hidden
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4-4" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search invoices, clients, items — or jump to an action…"
            className="w-full bg-transparent py-3.5 text-[15px] text-ink outline-none placeholder:text-muted"
            aria-label="Search"
            autoComplete="off"
            spellCheck={false}
          />
          {loading && (
            <span className="h-4 w-4 flex-none animate-spin rounded-full border-2 border-muted border-r-transparent" />
          )}
          <kbd className="hidden flex-none rounded border border-line px-1.5 py-0.5 text-[10px] font-semibold text-muted sm:block">
            ESC
          </kbd>
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-2" role="listbox">
          {items.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted">
              {q.trim().length < 2
                ? "Type to search, or pick an action above."
                : loading
                  ? "Searching…"
                  : `Nothing matches “${q.trim()}”.`}
            </p>
          ) : (
            rows.map((r) => {
              if (r.type === "header") {
                return (
                  <p
                    key={r.key}
                    className="px-4 pb-1 pt-3 text-[11px] font-bold uppercase tracking-wide text-muted"
                  >
                    {r.label}
                  </p>
                );
              }
              idx += 1;
              const i = idx;
              const on = i === active;
              return (
                <button
                  key={r.key}
                  data-idx={i}
                  role="option"
                  aria-selected={on}
                  type="button"
                  onMouseMove={() => setActive(i)}
                  onClick={() => go(r.href)}
                  className={`flex w-full items-center gap-3 px-4 py-2 text-left ${
                    on ? "bg-brand-50" : ""
                  }`}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`h-4 w-4 flex-none ${on ? "text-brand-700" : "text-muted"}`}
                    aria-hidden
                  >
                    <path d={r.icon} />
                  </svg>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-sm font-medium ${on ? "text-brand-900" : "text-ink"}`}>
                      {r.label}
                    </span>
                    {r.sub && <span className="block truncate text-xs text-muted">{r.sub}</span>}
                  </span>
                  {r.right && (
                    <span className="flex-none whitespace-nowrap text-xs tabular-nums text-muted">{r.right}</span>
                  )}
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2 text-[11px] text-muted">
          <span className="flex items-center gap-2">
            <kbd className="rounded border border-line px-1 py-0.5 font-semibold">↑↓</kbd> move
            <kbd className="rounded border border-line px-1 py-0.5 font-semibold">↵</kbd> open
          </span>
          <span className="hidden sm:block">
            Tip: press <kbd className="rounded border border-line px-1 py-0.5 font-semibold">/</kbd> anywhere
          </span>
        </div>
      </div>
    </div>
  );
}

/** The header button that opens the palette — discoverability for the mouse. */
export function PaletteButton() {
  const [mac, setMac] = useState(false);
  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
  }, []);
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("tp:open-palette"))}
      className="flex items-center gap-2 rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-xs text-muted transition-colors hover:text-ink"
      aria-label="Search"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5" aria-hidden>
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4-4" strokeLinecap="round" />
      </svg>
      <span className="hidden sm:inline">Search</span>
      <kbd className="hidden rounded border border-line px-1 py-0.5 text-[10px] font-semibold sm:inline">
        {mac ? "⌘" : "Ctrl "}K
      </kbd>
    </button>
  );
}
