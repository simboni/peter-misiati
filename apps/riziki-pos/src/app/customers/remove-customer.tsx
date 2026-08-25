"use client";

/**
 * Taking a customer off the books.
 *
 * One button, two outcomes, and the button says which one it is before it is
 * pressed. A name typed twice this morning is rubbish and goes; a name with
 * eleven sales behind it is hidden instead, because every one of those invoices
 * still has to lead back to a person. Telling the owner "removed" in both cases
 * would be a lie in one of them.
 *
 * The confirmation is the button changing rather than a dialog — the same as
 * clearing the cart and deleting a product, so the gesture means the same thing
 * everywhere in the app.
 */

import { useEffect, useState } from "react";
import { removeCustomerAction } from "./actions";

export default function RemoveCustomer({
  customerId,
  name,
  /** What is keeping the row, or null when nothing is. */
  held,
}: {
  customerId: number;
  name: string;
  held: string | null;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [armed]);

  const verb = held ? "Hide" : "Delete";

  return (
    <form action={removeCustomerAction} className="mt-3 border-t border-line pt-3">
      <input type="hidden" name="customerId" value={customerId} />
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
        {armed ? `Tap again to ${verb.toLowerCase()} ${name}` : `${verb} this customer`}
      </button>

      <p className="mt-2 text-[11px] text-muted">
        {held
          ? `${name} has ${held} behind them, so the record stays and only stops being offered at the counter — every invoice has to keep leading back to somebody.`
          : `Nothing points at ${name}, so the record goes for good.`}
      </p>
    </form>
  );
}
