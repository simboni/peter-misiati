"use client";

import { useRef } from "react";

/**
 * Quantity field with − and + controls.
 *
 * Typing "3" into a bare text box is fine on a laptop and miserable on the
 * phone most Kenyan SMEs actually invoice from: it summons the keyboard,
 * covers half the form, and one fat-fingered tap puts 33 on the invoice.
 * Tapping a button is faster, and wrong numbers on a bill cost real money.
 *
 * Deliberately NOT <input type="number">. That brings tiny native spinners
 * that are unusable on touch, lets the scroll wheel silently change a value
 * the user is only scrolling past, and reports an empty string for anything
 * it considers invalid — so a half-typed "1." vanishes as you type it. This
 * stays a text input and does the arithmetic itself.
 */

const DECIMALS = 3; // parseQty stores thousandths, so never offer more

/** Round away binary float noise: 0.1 + 0.2 must read as 0.3, not 0.30000000000000004. */
function tidy(n: number): string {
  const r = Math.round(n * 10 ** DECIMALS) / 10 ** DECIMALS;
  return String(r);
}

export function QuantityInput({
  value,
  onChange,
  min = 0,
  step = 1,
  "aria-label": ariaLabel = "Quantity",
}: {
  value: string;
  onChange: (next: string) => void;
  min?: number;
  step?: number;
  "aria-label"?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const current = (): number => {
    const n = parseFloat(String(value).replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
  };

  const bump = (delta: number) => {
    const next = Math.max(min, current() + delta);
    onChange(tidy(next));
  };

  const btn =
    "grid h-9 w-9 flex-none place-items-center rounded-lg border border-line bg-canvas text-ink " +
    "transition-transform active:scale-90 disabled:opacity-40 disabled:active:scale-100 " +
    "hover:bg-surface-2 select-none";

  const atMin = current() <= min;

  return (
    <div className="flex items-stretch gap-1">
      <button
        type="button"
        onClick={() => bump(-step)}
        disabled={atMin}
        aria-label="Decrease quantity"
        tabIndex={-1}
        className={btn}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-4 w-4" aria-hidden>
          <path d="M5 12h14" strokeLinecap="round" />
        </svg>
      </button>

      <input
        ref={inputRef}
        className="input min-w-0 flex-1 text-center tabular-nums"
        inputMode="decimal"
        value={value}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
        // Leaving the field empty or nonsense should settle on something
        // valid rather than silently billing zero of the item.
        onBlur={() => {
          const raw = String(value).trim();
          if (raw === "" || !Number.isFinite(parseFloat(raw.replace(/,/g, "")))) {
            onChange(String(Math.max(min, 1)));
          } else {
            onChange(tidy(Math.max(min, current())));
          }
        }}
        onKeyDown={(e) => {
          // Arrow keys step the value, the way every spinner on earth does.
          if (e.key === "ArrowUp") {
            e.preventDefault();
            bump(step);
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            bump(-step);
          }
        }}
      />

      <button
        type="button"
        onClick={() => bump(step)}
        aria-label="Increase quantity"
        tabIndex={-1}
        className={btn}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-4 w-4" aria-hidden>
          <path d="M12 5v14M5 12h14" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
