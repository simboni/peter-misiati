"use client";

/**
 * The bar at the top of a two-step form.
 *
 * Two screens exist that ask for a thing and then ask what sizes it is sold in
 * — a new chemical, and a new recipe. Both were one long form, and both grew a
 * bundle editor at the bottom that an owner adding his first product scrolled
 * past without seeing. Splitting them in two puts the sizes in front of him
 * instead of below him.
 *
 * This is only the header. The steps themselves stay mounted in one `<form>`
 * and are hidden rather than unmounted, so nothing typed on step one is lost
 * on the way to step two and back, and everything posts together on one save.
 *
 * A finished step is clickable; a step ahead is not — going forward is the
 * button at the bottom of the step, because that is where the validation is.
 */

export interface Step {
  /** "Details", "Sizes" — one word if it can be. */
  label: string;
  /** What the step is for, under the label on a wide screen. */
  hint?: string;
}

export function Steps({
  steps,
  current,
  onGo,
}: {
  steps: Step[];
  /** Zero-based. */
  current: number;
  /** Called when a completed step is clicked. */
  onGo: (index: number) => void;
}) {
  return (
    <ol className="mb-3 flex items-stretch gap-2" aria-label="Steps">
      {steps.map((s, i) => {
        const done = i < current;
        const here = i === current;
        return (
          <li key={s.label} className="min-w-0 flex-1">
            <button
              type="button"
              onClick={() => (done ? onGo(i) : undefined)}
              disabled={!done}
              aria-current={here ? "step" : undefined}
              className={
                "flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors " +
                (here
                  ? "border-brand bg-brand-soft"
                  : done
                    ? "border-line bg-white hover:bg-wash"
                    : "border-line bg-wash opacity-60")
              }
            >
              <span
                className={
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold " +
                  (here ? "bg-brand text-white" : done ? "bg-good text-white" : "bg-line text-muted")
                }
              >
                {done ? "✓" : i + 1}
              </span>
              <span className="min-w-0">
                <span
                  className={
                    "block truncate text-[13px] font-bold " + (here ? "text-brand-dark" : "text-ink")
                  }
                >
                  {s.label}
                </span>
                {s.hint ? (
                  <span className="hidden truncate text-[11px] text-muted sm:block">{s.hint}</span>
                ) : null}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
