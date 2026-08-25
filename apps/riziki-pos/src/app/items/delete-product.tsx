"use client";

/**
 * Removing a product from the catalogue.
 *
 * Two different situations wear one button here, and telling them apart is most
 * of the point:
 *
 * A row that has never traded is a typo — added twice, or with the name spelled
 * wrong — and the owner should be able to clear it out. It asks once and then
 * goes.
 *
 * A row that has been sold, stocked, quoted or bought cannot go without leaving
 * a line on somebody's invoice pointing at nothing. There the control is not a
 * button at all: it states what is holding the row and points at Hide, which is
 * the thing that actually wants doing.
 *
 * The confirmation is the button changing rather than a dialog. This screen is
 * a long list of collapsible rows and a modal over it loses the thread of which
 * row was being edited; "Delete" becoming "Tap again to delete" keeps the
 * question next to its answer.
 */

import { useEffect, useState } from "react";
import { deleteProductAction } from "./actions";

export default function DeleteProduct({
  itemId,
  name,
  /** What is keeping it in the catalogue, or null when nothing is. */
  held,
}: {
  itemId: number;
  name: string;
  held: string | null;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [armed]);

  if (held) {
    return (
      <span className="text-[11px] leading-snug text-muted">
        Cannot be deleted — it has {held}. Hide it instead.
      </span>
    );
  }

  return (
    <form action={deleteProductAction}>
      <input type="hidden" name="itemId" value={itemId} />
      <button
        type={armed ? "submit" : "button"}
        onClick={(e) => {
          if (!armed) {
            e.preventDefault();
            setArmed(true);
          }
        }}
        className={`inline-flex min-h-12 items-center justify-center rounded-full px-5 text-sm font-bold transition-colors ${
          armed ? "bg-bad text-white" : "text-muted hover:bg-bad-soft hover:text-bad"
        }`}
      >
        {armed ? `Tap again to delete ${name}` : "Delete"}
      </button>
    </form>
  );
}
