"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { matchOptions, type PickerOption } from "@/lib/picker-match";

export { matchOptions, type PickerOption };

/**
 * A dropdown with a search box inside it.
 *
 * WHY. A native `<select>` is the right instrument for four options and the
 * wrong one for fifty-eight. The shop's catalogue is fifty-eight and growing,
 * and whoever is booking a delivery or writing a recipe line already knows the
 * name they want — they should be able to type it rather than scroll a list
 * hunting for it. On a counter phone that scroll is worse again: the native
 * wheel shows four entries at a time and has no way to jump.
 *
 * This started as the item picker on the wholesale builder, where it plainly
 * worked. It is here because it is not about items: suppliers, customers,
 * chemicals and products all have the same problem, and five near-copies of a
 * combobox is five places for the keyboard handling to rot.
 *
 * WORKS IN A PLAIN FORM. Given a `name`, it writes a hidden input, so a server
 * action reads it exactly as it read the `<select>` it replaced. Nothing else
 * about the form has to change.
 *
 * WHAT IT DELIBERATELY IS NOT. Not a fetch-as-you-type. The whole list is
 * already on the page — it is a few hundred rows of names at most — and a
 * picker that needs the network is a picker that stops working in a shop whose
 * connection comes and goes.
 */

export function Picker({
  options,
  value,
  onChange,
  name,
  label,
  placeholder = "Search…",
  empty = "Nothing to choose from.",
  allowNone = false,
  noneLabel = "Not chosen",
  disabled = false,
  className = "",
}: {
  options: PickerOption[];
  value: string | number | null;
  onChange?: (value: string | number | null) => void;
  /** Post the chosen value under this name, as a `<select>` would. */
  name?: string;
  /** For screen readers, and what the closed button says it is for. */
  label: string;
  placeholder?: string;
  empty?: string;
  /** Offer a "nothing chosen" row — for a filter, or an optional field. */
  allowNone?: boolean;
  noneLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const chosen = options.find((o) => String(o.value) === String(value ?? ""));

  // Clicking anywhere else is the ordinary way to abandon a dropdown.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const matches = useMemo(() => matchOptions(options, query), [options, query]);
  const rows: Array<PickerOption | null> = allowNone ? [null, ...matches] : matches;

  // Keep the highlighted row on screen when it is reached by keyboard.
  useEffect(() => {
    if (!open) return;
    list.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function choose(option: PickerOption | null) {
    onChange?.(option ? option.value : null);
    setQuery("");
    setOpen(false);
  }

  return (
    <div ref={box} className={`relative ${className}`}>
      {name ? <input type="hidden" name={name} value={value ?? ""} /> : null}

      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setOpen((v) => !v);
          setActive(0);
        }}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-line bg-white px-3 text-left text-sm font-semibold text-ink disabled:opacity-50 xl:min-h-10"
      >
        <span className={`min-w-0 flex-1 truncate ${chosen ? "" : "text-muted"}`}>
          {chosen ? chosen.label : allowNone ? noneLabel : placeholder}
        </span>
        {chosen?.trailing ? (
          <span className="shrink-0 text-[12px] font-bold text-brand-dark tnum">{chosen.trailing}</span>
        ) : null}
        <span aria-hidden className="shrink-0 text-muted">
          ▾
        </span>
      </button>

      {open ? (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-line bg-white shadow-lift">
          <input
            autoFocus
            type="search"
            className="w-full border-b border-line px-3 py-2.5 text-sm outline-none"
            placeholder={placeholder}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, rows.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (rows.length) choose(rows[active] ?? null);
              } else if (e.key === "Escape") {
                e.preventDefault();
                setOpen(false);
              }
            }}
            aria-label={`Search ${label.toLowerCase()}`}
          />

          <ul ref={list} role="listbox" aria-label={label} className="max-h-72 overflow-y-auto">
            {rows.length ? (
              rows.map((o, k) => (
                <li key={o ? String(o.value) : "__none"} role="option" aria-selected={k === active}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(k)}
                    onClick={() => choose(o)}
                    className={`flex w-full items-baseline gap-2 px-3 py-2 text-left ${
                      k === active ? "bg-brand-soft" : ""
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block truncate text-[13px] font-bold ${
                          o ? "text-ink" : "text-muted"
                        }`}
                      >
                        {o ? o.label : noneLabel}
                      </span>
                      {o?.hint ? (
                        <span className="block truncate text-[11px] text-muted">{o.hint}</span>
                      ) : null}
                    </span>
                    {o?.trailing ? (
                      <span className="shrink-0 text-[12px] font-bold text-brand-dark tnum">
                        {o.trailing}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))
            ) : (
              <li className="px-3 py-4 text-center text-sm text-muted">
                Nothing matches “{query}”.
              </li>
            )}
          </ul>

          {matches.length >= 60 ? (
            <p className="border-t border-line px-3 py-1.5 text-[11px] text-muted">
              Showing the first 60 — keep typing to narrow it.
            </p>
          ) : (
            <p className="border-t border-line px-3 py-1.5 text-[11px] text-muted">
              {options.length === 0 ? empty : `${matches.length} of ${options.length}`}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The same picker, driving a plain GET form — for a filter rather than a field.
 *
 * Submits on choice, so a filter behaves the way a filter should: pick a
 * supplier and the list is filtered, with the choice in the URL where it can be
 * bookmarked, shared, and undone with the browser's back button.
 */
export function PickerFilter({
  options,
  value,
  name,
  label,
  placeholder,
  noneLabel = "Everything",
  hidden = {},
  action,
}: {
  options: PickerOption[];
  value: string | number | null;
  name: string;
  label: string;
  placeholder?: string;
  noneLabel?: string;
  /** Other query parameters to carry through, so filters compose. */
  hidden?: Record<string, string>;
  action: string;
}) {
  const form = useRef<HTMLFormElement>(null);
  const [picked, setPicked] = useState<string | number | null>(value ?? null);

  return (
    <form ref={form} method="get" action={action}>
      {Object.entries(hidden).map(([k, v]) =>
        v ? <input key={k} type="hidden" name={k} value={v} /> : null,
      )}
      <Picker
        options={options}
        value={picked}
        name={name}
        label={label}
        placeholder={placeholder}
        allowNone
        noneLabel={noneLabel}
        onChange={(next) => {
          setPicked(next);
          // The hidden input has to hold the new value before the submit, and
          // React writes it on the next render — hence the tick.
          setTimeout(() => form.current?.requestSubmit(), 0);
        }}
      />
      <noscript>
        <button type="submit" className="mt-1 text-xs font-bold text-brand">
          Apply
        </button>
      </noscript>
    </form>
  );
}
