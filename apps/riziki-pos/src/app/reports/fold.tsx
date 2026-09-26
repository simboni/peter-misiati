"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * A section of the report that folds away, and stays folded.
 *
 * WHY. The dashboard answers the ninety-second question — what came in today,
 * how the period compares, what needs fixing, which way it is going. Everything
 * under that is a different kind of looking: the day ledger, the discounts, the
 * dead stock, the whole book. All of it earns its place, and all of it at once
 * is four screens of scrolling past what you did not come for.
 *
 * So the dashboard stays open and the rest folds, each one labelled and each
 * one carrying a line of what is inside it, so the owner can tell whether to
 * open it without opening it. "Day by day · 26 days · best 7 Sept" is often the
 * whole answer.
 *
 * WHY IT REMEMBERS. An owner who opens Discounts every morning should not have
 * to open it every morning. What is open is kept in this browser, per section,
 * per device — which is the right place for it: it is a preference of the
 * person holding the phone, not a fact about the shop, and it has no business
 * in the database or in anybody else's session.
 *
 * HOW, without a hydration mismatch. The server renders the section with its
 * default state and never guesses what the browser remembers. On mount the
 * stored state is applied to the DOM node directly — `el.open = true` — rather
 * than through React state, so React never renders two different trees for the
 * same markup and there is nothing to reconcile. Storage is wrapped in
 * try/catch throughout: a private window, or a browser with site data blocked,
 * throws on the first read, and a report that will not open because of a
 * remembered preference would be a poor trade.
 */
export function Fold({
  id,
  anchor,
  title,
  hint,
  defaultOpen = false,
  force = false,
  children,
}: {
  /** Stable key for what is remembered. Changing it forgets the preference. */
  id: string;
  /** DOM id, for the links on the watch list that point straight at it. */
  anchor?: string;
  title: string;
  /** One line of what is inside, shown while it is shut. */
  hint?: string;
  defaultOpen?: boolean;
  /** "Open every section" — open, and do not remember this one. */
  force?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const key = `riziki.reports.fold.${id}`;

  useEffect(() => {
    if (force) return;
    const el = ref.current;
    if (!el) return;
    try {
      const saved = localStorage.getItem(key);
      if (saved === "open") el.open = true;
      else if (saved === "shut") el.open = false;
    } catch {
      // No storage: the default stands. Nothing here is worth an error for.
    }
  }, [key, force]);

  function remember() {
    if (force) return;
    try {
      localStorage.setItem(key, ref.current?.open ? "open" : "shut");
    } catch {
      // Same again: a preference nobody can save is a preference nobody loses.
    }
  }

  return (
    <details
      id={anchor}
      ref={ref}
      open={defaultOpen || force}
      onToggle={remember}
      className="group mt-5 xl:mt-6"
    >
      {/* Styled as the ruled section label the rest of the app uses, so the
          page reads as one document that folds rather than a stack of widgets.
          The whole bar is the control: a chevron alone is a target nobody on a
          phone hits first time. */}
      <summary className="flex cursor-pointer list-none flex-col py-1 [&::-webkit-details-marker]:hidden">
        <span className="flex w-full items-center gap-2.5">
          <span
            aria-hidden
            className="shrink-0 text-[10px] text-brand transition-transform duration-150 group-open:rotate-90"
          >
            ▶
          </span>
          <h2 className="min-w-0 flex-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted sm:flex-none sm:tracking-[0.18em]">
            {title}
          </h2>
          <span aria-hidden className="hidden h-px flex-1 bg-line sm:block" />
          {hint ? (
            // Below `sm` this line has no room; it moves under the title
            // instead, where a phone has width to spare.
            <span className="inline max-w-[48%] truncate text-right text-[11px] font-medium text-muted max-sm:hidden group-open:hidden">
              {hint}
            </span>
          ) : null}
          <span className="shrink-0 text-[11px] font-bold text-brand group-open:hidden">Open</span>
          <span className="hidden shrink-0 text-[11px] font-bold text-brand group-open:inline">
            Hide
          </span>
        </span>
        {hint ? (
          <span className="block pl-5 text-[11px] font-medium text-muted sm:hidden group-open:hidden">
            {hint}
          </span>
        ) : null}
      </summary>
      <div className="mt-2 xl:mt-2.5">{children}</div>
    </details>
  );
}
