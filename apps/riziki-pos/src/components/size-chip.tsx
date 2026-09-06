"use client";

/**
 * One size, as a tappable square.
 *
 * Written for the counter and now used by the mixing board as well, because
 * both screens ask the same question in the same words: how many of this size?
 * The counter asks it of a customer's bill and the mixing board asks it of a
 * batch, but the hand does the same thing either way — tap to add one, tap the
 * badge to take them all off — and a shop that has learnt the gesture once
 * should not have to learn it twice.
 *
 * Tapping adds. There is no minus, and no long press: the badge says how many
 * are already counted, so nobody has to count their own taps, and clearing four
 * at once is what somebody who tapped four times by mistake actually wants. A
 * long press would be worse than useless here — the phone is handled with wet
 * hands beside a drum, and a sustained touch is exactly the gesture a wet
 * capacitive screen loses halfway through.
 */

export function SizeChip({
  size,
  price,
  per,
  count,
  onPick,
  onRemove,
  /** What the badge and the label call the pile being built. */
  noun = "the bill",
}: {
  size: string;
  price: string;
  per?: string | null;
  count: number;
  onPick: () => void;
  /** This size off the pile. Absent when there is none of it on there. */
  onRemove?: () => void;
  noun?: string;
}) {
  return (
    /*
      The chip is a button, so the badge that undoes it cannot live inside it —
      it is laid over the corner instead, which is where it already was.
    */
    <div className="relative">
      <button
        type="button"
        onClick={onPick}
        /*
          Said properly for a screen reader.

          The badge sits in the corner visually but comes first in the reading
          order, so without this the chip announced itself as "times two, twenty
          kilogrammes, KES 8,800" — the count before the thing it counts. This
          says what the tap will do, then what is already counted.
        */
        aria-label={
          `Add ${size} for ${price}` + (count > 0 ? ` — ${count} already on ${noun}` : "")
        }
        className={`flex min-h-[4.5rem] w-full flex-col items-start justify-center rounded-2xl px-3 py-2 text-left ring-1 ring-inset transition-colors ${
          count > 0
            ? "bg-brand text-white ring-brand"
            : "bg-brand-soft text-brand-deep ring-brand/25 hover:ring-brand/60"
        }`}
      >
        {/* Only the size makes room for the badge, not the whole chip: the price
            sits on the line below it, and padding the chip pushed "KES 4,000"
            into three lines to clear something that was never beside it. */}
        <span className={`text-[15px] font-extrabold ${count > 0 ? "pr-11" : ""}`}>{size}</span>
        <span className={`mt-0.5 text-[14px] font-bold tnum ${count > 0 ? "" : "text-ink"}`}>
          {price}
        </span>
        {per ? (
          <span className={`text-[11px] tnum ${count > 0 ? "text-white/75" : "text-muted"}`}>
            {per}
          </span>
        ) : null}
      </button>

      {/*
        The count, and the way back off.

        Tapping the chip is how this says "one more", and that is the whole
        rhythm of both screens — so undoing has to be its own target, not a long
        press or a second mode. Everything of this size goes at once: whoever
        tapped four times by mistake wants the four gone, and four is what the
        badge is showing them.
      */}
      {count > 0 && onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`${count} × ${size} on ${noun} — tap to take them off`}
          title={`Take the ${size} off ${noun}`}
          className="absolute right-1.5 top-1.5 flex h-5 items-center gap-0.5 rounded-full bg-white pl-1.5 pr-1 text-[11px] font-extrabold text-brand-deep tnum hover:bg-bad hover:text-white"
        >
          ×{count}
          <span aria-hidden className="text-[12px] leading-none opacity-60">
            ✕
          </span>
        </button>
      ) : null}
    </div>
  );
}
