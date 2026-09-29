"use client";

import type { ReactNode } from "react";

/**
 * The search box, the chips and the pager — for a list that filters in the browser.
 *
 * WHY THESE EXIST BESIDE `ListToolbar` AND `Pager`. Those two are forms and
 * links: they put the filter in the URL, which is right for a list the server
 * pages through, because the back button then works and a filtered list can be
 * sent to somebody. Stock is not that list. Every item is already in the
 * browser — it has to be, so the counter can flick between the shelf and a
 * half-typed stock take without losing either — and filtering it through the
 * server would put a page load between typing a letter and seeing the answer.
 *
 * So the behaviour is different and the appearance must not be. The shop learns
 * one thing: a box at the top narrows the list, chips beside it cut it down,
 * numbers at the bottom say how much there is. Stock had all three and each one
 * looked like something else — an unlabelled box with no button, a pair of bare
 * Back/Next buttons — which is why it read as having none of them.
 */

export function ClientSearch({
  value,
  onChange,
  placeholder,
  label,
  children,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  label: string;
  /** Anything that belongs on the same row — a tab switch, a count. */
  children?: ReactNode;
}) {
  return (
    <div className="no-print mb-2 flex gap-2">
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        autoComplete="off"
        className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-white px-3 text-sm xl:min-h-10"
      />
      {/*
        No Search button, because there is nothing to submit — the list narrows
        as you type. Clear takes its place so the row keeps the same shape as
        every other search on the app, and so there is a way out of a search on
        a phone without selecting the text.
      */}
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          className="flex min-h-11 shrink-0 items-center rounded-xl px-3 text-sm font-bold text-muted hover:bg-wash xl:min-h-10"
        >
          Clear
        </button>
      ) : null}
      {children}
    </div>
  );
}

export interface ClientFilter {
  key: string;
  label: string;
  count?: number;
}

export function ClientChips({
  filters,
  current,
  onPick,
}: {
  filters: ClientFilter[];
  current: string;
  onPick: (key: string) => void;
}) {
  if (!filters.length) return null;
  return (
    <div className="no-print mb-3 flex flex-wrap gap-1.5">
      {filters.map((f) => (
        <button
          key={f.key}
          type="button"
          onClick={() => onPick(f.key)}
          aria-pressed={current === f.key}
          className={`flex min-h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-bold transition-colors ${
            current === f.key
              ? "bg-brand text-white"
              : "bg-white text-muted ring-1 ring-inset ring-line hover:text-ink"
          }`}
        >
          {f.label}
          {typeof f.count === "number" ? (
            <span className={current === f.key ? "text-white/70 tnum" : "text-muted tnum"}>
              {f.count}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

export function ClientPager({
  page,
  pages,
  total,
  noun,
  plural,
  note,
  onGo,
}: {
  page: number;
  pages: number;
  total: number;
  noun: string;
  plural?: string;
  /** A second line, where the count needs explaining. */
  note?: string;
  onGo: (page: number) => void;
}) {
  const step = "flex min-h-11 items-center rounded-xl px-4 text-sm font-bold xl:min-h-10";
  return (
    <div className="no-print mt-4 flex items-center gap-2">
      <span className="text-[12px] font-semibold text-muted tnum">
        {total} {total === 1 ? noun : (plural ?? `${noun}s`)}
        {pages > 1 ? ` · page ${page} of ${pages}` : ""}
        {note ? <span className="block font-normal">{note}</span> : null}
      </span>
      <div className="ml-auto flex gap-2">
        {page > 1 ? (
          <button
            type="button"
            onClick={() => onGo(page - 1)}
            className={`${step} bg-white text-brand-dark ring-1 ring-inset ring-line`}
          >
            ← Back
          </button>
        ) : null}
        {page < pages ? (
          <button
            type="button"
            onClick={() => onGo(page + 1)}
            className={`${step} bg-white text-brand-dark ring-1 ring-inset ring-line`}
          >
            Next →
          </button>
        ) : null}
      </div>
    </div>
  );
}
