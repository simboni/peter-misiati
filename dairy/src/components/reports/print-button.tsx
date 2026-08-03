"use client";

/**
 * Print. That is the whole component.
 *
 * No PDF library ships in this app: Chrome on Android prints to PDF natively,
 * it works offline, and the printed page is the one the farm already knows how
 * to read. A PDF renderer would be a megabyte of JavaScript to reproduce a
 * button the phone already has.
 */
export function PrintButton({ label = "Print this sheet" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="no-print inline-flex items-center justify-center gap-2 rounded-md bg-brand px-5 py-3 text-base font-semibold text-white"
    >
      <span aria-hidden>🖨</span>
      {label}
    </button>
  );
}
