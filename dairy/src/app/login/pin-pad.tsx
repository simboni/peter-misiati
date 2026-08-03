"use client";

import { useActionState, useState } from "react";
import { signIn } from "@/server/auth";
import { Button } from "@/components/ui";

type Staff = { id: string; fullName: string; photoUrl: string | null; role: string };

const ROLE_ICON: Record<string, string> = {
  OWNER: "🧑‍🌾",
  MANAGER: "📋",
  HERDSMAN: "🥛",
  RIDER: "🛵",
  VET: "💉",
  ACCOUNTANT: "🧮",
};

/**
 * Tap a face, then four digits on a big keypad.
 *
 * The keypad is deliberately custom rather than a text input: a numeric
 * keyboard on a cheap Android is small, inconsistent between launchers, and
 * often covers the field it is filling.
 */
export function PinPad({ staff }: { staff: Staff[] }) {
  const [chosen, setChosen] = useState<Staff | null>(null);
  const [pin, setPin] = useState("");
  const [state, formAction, pending] = useActionState(signIn, null);

  if (!chosen) {
    return (
      <ul className="grid grid-cols-2 gap-3">
        {staff.map((u) => (
          <li key={u.id}>
            <button
              onClick={() => setChosen(u)}
              className="tap flex w-full flex-col items-center gap-2 rounded-lg border border-line bg-surface p-5 hover:border-brand"
            >
              {u.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={u.photoUrl} alt="" className="h-16 w-16 rounded-full object-cover" />
              ) : (
                <span aria-hidden className="text-4xl">
                  {ROLE_ICON[u.role] ?? "👤"}
                </span>
              )}
              <span className="text-center text-base font-semibold leading-tight">
                {u.fullName}
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="userId" value={chosen.id} />
      <input type="hidden" name="pin" value={pin} />

      <div className="flex items-center justify-between rounded-lg border border-line bg-surface p-3">
        <span className="font-semibold">{chosen.fullName}</span>
        <button
          type="button"
          onClick={() => {
            setChosen(null);
            setPin("");
          }}
          className="text-sm underline"
        >
          Not you?
        </button>
      </div>

      <div className="flex justify-center gap-3" aria-label={`${pin.length} of 4 digits entered`}>
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={`h-4 w-4 rounded-full border-2 ${
              i < pin.length ? "border-brand bg-brand" : "border-line"
            }`}
          />
        ))}
      </div>

      {state && !state.ok ? (
        <p role="alert" className="text-center text-sm font-medium text-danger">
          {state.error}
        </p>
      ) : null}

      <div className="grid grid-cols-3 gap-2">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <Key key={d} label={d} onPress={() => setPin((p) => (p + d).slice(0, 4))} />
        ))}
        <Key label="←" onPress={() => setPin((p) => p.slice(0, -1))} />
        <Key label="0" onPress={() => setPin((p) => (p + "0").slice(0, 4))} />
        <div />
      </div>

      <Button type="submit" disabled={pin.length !== 4 || pending} className="w-full">
        {pending ? "Checking…" : "Enter"}
      </Button>
    </form>
  );
}

function Key({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <button
      type="button"
      onClick={onPress}
      className="tap rounded-lg border border-line bg-surface py-4 text-2xl font-semibold hover:bg-paper"
    >
      {label}
    </button>
  );
}
