"use client";

/**
 * Taking a supplier off the list.
 *
 * Two situations wear one control, and telling them apart is most of the point.
 *
 * A supplier nothing points at is a line somebody typed — a duplicate, a
 * misspelling, an entry made while trying the system out. It asks once and then
 * goes. Without this the list keeps every experiment forever, and the one thing
 * this screen exists for ("who do I ring") gets slower every month.
 *
 * A supplier with deliveries against them cannot go: every one of those rows is
 * filed under this name, and the screen prints "Supplier not recorded" where
 * the link is missing. There the control is Hide instead — off the list, out of
 * the delivery form, name intact on the history — and it says why.
 *
 * The confirmation is the button changing rather than a dialog. This sits in a
 * table of suppliers and a modal over it loses the thread of which row was
 * being answered for; "Delete" becoming "Tap again" keeps the question next to
 * the name it is about.
 */

import { useEffect, useState } from "react";
import { deleteSupplierAction, setSupplierHiddenAction } from "./actions";

export default function RemoveSupplier({
  supplierId,
  name,
  /** What is keeping them on the list, or null when nothing is. */
  held,
  hidden,
}: {
  supplierId: number;
  name: string;
  held: string | null;
  hidden: boolean;
}) {
  const [armed, setArmed] = useState(false);

  // Disarms itself. A half-pressed Delete left sitting on the screen is a trap
  // for whoever picks the laptop up next.
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [armed]);

  if (hidden) {
    return (
      <form action={setSupplierHiddenAction}>
        <input type="hidden" name="supplierId" value={supplierId} />
        <input type="hidden" name="hidden" value="0" />
        <button
          type="submit"
          className="inline-flex min-h-11 items-center whitespace-nowrap rounded-full px-3 text-xs font-bold text-brand hover:bg-brand-soft xl:min-h-9"
        >
          Show again
        </button>
      </form>
    );
  }

  if (held) {
    return (
      <form action={setSupplierHiddenAction}>
        <input type="hidden" name="supplierId" value={supplierId} />
        <input type="hidden" name="hidden" value="1" />
        <button
          type="submit"
          title={`${name} has ${held}, so the record has to stay. Hiding takes them off the list and out of the delivery form.`}
          className="inline-flex min-h-11 items-center whitespace-nowrap rounded-full px-3 text-xs font-bold text-muted hover:bg-wash hover:text-ink xl:min-h-9"
        >
          Hide
        </button>
      </form>
    );
  }

  return (
    <form action={deleteSupplierAction}>
      <input type="hidden" name="supplierId" value={supplierId} />
      <button
        type={armed ? "submit" : "button"}
        onClick={(e) => {
          if (!armed) {
            e.preventDefault();
            setArmed(true);
          }
        }}
        className={`inline-flex min-h-11 items-center whitespace-nowrap rounded-full px-3 text-xs font-bold transition-colors xl:min-h-9 ${
          armed ? "bg-bad text-white" : "text-muted hover:bg-bad-soft hover:text-bad"
        }`}
      >
        {armed ? "Tap again" : "Delete"}
      </button>
    </form>
  );
}
