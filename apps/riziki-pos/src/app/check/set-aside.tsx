"use client";

/**
 * "I have dealt with this."
 *
 * Deliberately not the loudest thing on the row. The first answer to a finding
 * is to go and fix it, and almost every one of them then disappears by itself;
 * this is for the ones that do not, and for the judgements a check cannot make
 * — a delivery note that says the odd container really was odd, a price the
 * owner has decided is right.
 *
 * It asks why, and does not insist. The reason is the only part of a dismissal
 * that will mean anything in six months, so there is a box for it, but an owner
 * standing at a counter will not always fill it in and refusing them would just
 * train them to type a full stop.
 */

import { useActionState, useState } from "react";
import { setAsideAction, bringBackAction, type CheckState } from "./actions";

const EMPTY: CheckState = {};

export function SetAside({ keyName, said }: { keyName: string; said: string }) {
  const [state, action, pending] = useActionState(setAsideAction, EMPTY);
  const [asking, setAsking] = useState(false);

  if (state.ok) {
    return <p className="mt-2 text-[12px] font-semibold text-good">{state.ok}</p>;
  }

  if (!asking) {
    return (
      <div className="mt-2">
        {state.error ? (
          <p className="mb-1 text-[12px] font-semibold text-bad">{state.error}</p>
        ) : null}
        <button
          type="button"
          onClick={() => setAsking(true)}
          className="min-h-9 rounded-full border border-line px-3 text-[12px] font-bold text-muted hover:border-muted hover:text-ink"
        >
          I have corrected this
        </button>
      </div>
    );
  }

  return (
    <form action={action} className="mt-2 rounded-xl border border-line bg-wash p-2.5">
      <input type="hidden" name="key" value={keyName} />
      {/* The words it is being dismissed about. If they change, it comes back. */}
      <input type="hidden" name="said" value={said} />
      <label className="block text-[11px] font-bold uppercase tracking-[0.1em] text-muted">
        What did you do? <span className="font-semibold normal-case tracking-normal">Optional</span>
      </label>
      <input
        name="note"
        autoComplete="off"
        placeholder="Checked the delivery note — the drum really was 5 kg"
        className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-2.5 text-sm"
      />
      <p className="mt-1.5 text-[11px] text-muted">
        It leaves the list while it goes on saying this. If the figures move, it comes back saying
        what it then says.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending}
          className="min-h-9 rounded-full bg-brand px-3.5 text-[12px] font-bold text-white hover:bg-brand-dark disabled:opacity-60"
        >
          {pending ? "Setting aside…" : "Set it aside"}
        </button>
        <button
          type="button"
          onClick={() => setAsking(false)}
          className="min-h-9 rounded-full px-3 text-[12px] font-bold text-muted hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/** The other direction, from the list of what has been set aside. */
export function BringBack({ keyName }: { keyName: string }) {
  const [state, action, pending] = useActionState(bringBackAction, EMPTY);
  if (state.ok) return <span className="text-[12px] font-semibold text-good">{state.ok}</span>;
  return (
    <form action={action}>
      <input type="hidden" name="key" value={keyName} />
      <button
        type="submit"
        disabled={pending}
        className="min-h-8 rounded-full border border-line px-2.5 text-[11px] font-bold text-muted hover:border-muted hover:text-ink disabled:opacity-60"
      >
        {pending ? "…" : "Put it back"}
      </button>
    </form>
  );
}
