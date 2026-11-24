"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "./submit-button";
import { saveReminderSettingsAction, type FormState } from "@/server/actions/reminders";
import { parseSchedule } from "@/server/reminders";
import { formatAmount } from "@/server/money";

/** Turn the raw CSV into the sentence a vendor can check at a glance. */
function describe(csv: string): string {
  const steps = parseSchedule(csv);
  if (steps.length === 0) return "No reminders will be sent.";
  const parts = steps.map((s) =>
    s < 0 ? `${-s} day${s === -1 ? "" : "s"} before it's due` : s === 0 ? "on the due date" : `${s} day${s === 1 ? "" : "s"} after`,
  );
  return `We'll send ${steps.length} reminder${steps.length === 1 ? "" : "s"}: ${parts.join(", then ")}.`;
}

const PRESETS: { label: string; value: string; hint: string }[] = [
  { label: "Gentle", value: "0,7,21", hint: "Three nudges, well spaced" },
  { label: "Standard", value: "-3,0,3,7,14", hint: "A heads-up, then steady follow-up" },
  { label: "Persistent", value: "-3,0,2,5,10,15,30", hint: "For clients who need chasing" },
];

export function ReminderSettingsForm({
  remindersEnabled,
  reminderSchedule,
  reminderTone,
  reminderAutoEmail,
  reminderMinAmount,
  currency,
  emailReady,
}: {
  remindersEnabled: boolean;
  reminderSchedule: string;
  reminderTone: string;
  reminderAutoEmail: boolean;
  reminderMinAmount: number;
  currency: string;
  emailReady: boolean;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(saveReminderSettingsAction, {});
  const [on, setOn] = useState(remindersEnabled);
  const [schedule, setSchedule] = useState(reminderSchedule);

  return (
    <form action={formAction} className="card space-y-5 p-6" id="reminders">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Payment reminders</h2>
        <p className="mt-1 text-sm text-muted">
          Chase unpaid invoices without having to remember to. Every reminder carries the amount, the
          invoice number and a link to pay — and stops the moment the invoice is settled.
        </p>
      </div>

      {state.error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}
      {state.ok && (
        <p className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-700">{state.ok}</p>
      )}

      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          name="remindersEnabled"
          checked={on}
          onChange={(e) => setOn(e.target.checked)}
          className="h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-500"
        />
        Remind clients about unpaid invoices
      </label>

      <fieldset disabled={!on} className="space-y-5 disabled:opacity-50">
        <div>
          <label className="label" htmlFor="reminderSchedule">
            When to send
          </label>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setSchedule(p.value)}
                title={p.hint}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                  parseSchedule(schedule).join(",") === parseSchedule(p.value).join(",")
                    ? "bg-brand-600 text-white"
                    : "bg-canvas text-muted hover:text-ink"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <input
            id="reminderSchedule"
            name="reminderSchedule"
            className="input"
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            placeholder="-3,0,3,7,14"
          />
          <p className="mt-1 text-xs text-muted">
            Days relative to the due date — negative is before, 0 is the day itself. {describe(schedule)}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="reminderTone">
              Tone
            </label>
            <select id="reminderTone" name="reminderTone" className="input" defaultValue={reminderTone}>
              <option value="friendly">Friendly — a gentle nudge</option>
              <option value="firm">Firm — direct and businesslike</option>
              <option value="final">Final — for serious arrears</option>
            </select>
            <p className="mt-1 text-xs text-muted">
              A reminder before the due date always reads as friendly, whatever you pick here.
            </p>
          </div>

          <div>
            <label className="label" htmlFor="reminderMinAmount">
              Don&apos;t chase under ({currency})
            </label>
            <input
              id="reminderMinAmount"
              name="reminderMinAmount"
              className="input"
              inputMode="decimal"
              defaultValue={reminderMinAmount > 0 ? formatAmount(reminderMinAmount) : ""}
              placeholder="0"
            />
            <p className="mt-1 text-xs text-muted">
              Leave blank to chase every unpaid invoice, however small.
            </p>
          </div>
        </div>

        <label className="flex items-start gap-2 text-sm text-ink">
          <input
            type="checkbox"
            name="reminderAutoEmail"
            defaultChecked={reminderAutoEmail}
            className="mt-0.5 h-4 w-4 rounded border-line text-brand-600 focus:ring-brand-500"
          />
          <span>
            Send the emails automatically
            <span className="mt-0.5 block text-xs text-muted">
              Switch this off to review every reminder yourself — they&apos;ll queue up under Reminders
              instead, ready to send with one tap.
            </span>
          </span>
        </label>

        {!emailReady && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Email delivery isn&apos;t set up on this workspace yet, so nothing will send automatically.
            Your settings are saved, and the chase queue still works for WhatsApp.
          </p>
        )}
      </fieldset>

      <div className="flex justify-end">
        <SubmitButton pendingText="Saving…">Save reminders</SubmitButton>
      </div>
    </form>
  );
}
