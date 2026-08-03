"use client";

/**
 * The alert list.
 *
 * Every row is one person, one animal, one action, one deadline — and it can
 * only be dismissed with an OUTCOME. There is deliberately no bare "×": a
 * dismissal that carries no reason teaches the system nothing, and a system
 * that cannot tell a done job from a wrong alert cannot report the only number
 * worth reporting.
 */
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

export interface AlertRow {
  id: string;
  kind: string;
  animalId: string | null;
  animalName: string | null;
  action: string;
  dueLabel: string;
  daysOverdue: number;
  severity: "INFO" | "WARN" | "CRITICAL";
}

export type ResolveResult =
  | { ok: true; data: { id: string; outcome: string; message: string }; message?: string }
  | { ok: false; error: string };

export type ResolveAction = (
  prev: ResolveResult | null,
  formData: FormData,
) => Promise<ResolveResult>;

const OUTCOMES: Array<{ value: string; label: string; icon: string; tone: string }> = [
  { value: "DONE", label: "Done", icon: "✓", tone: "border-ok text-ok" },
  { value: "NOT_NEEDED", label: "Not needed", icon: "–", tone: "border-line text-ink-2" },
  { value: "WRONG", label: "Wrong", icon: "!", tone: "border-danger text-danger" },
  { value: "SNOOZED", label: "Not yet", icon: "⏰", tone: "border-brass text-brass" },
];

function OutcomeButton({ value, label, icon, tone }: (typeof OUTCOMES)[number]) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="outcome"
      value={value}
      disabled={pending}
      className={`inline-flex items-center gap-1 rounded border px-3 py-2 text-xs font-medium disabled:opacity-50 ${tone}`}
    >
      <span aria-hidden>{icon}</span>
      {label}
    </button>
  );
}

export function AlertList({
  alerts,
  action,
  heldBack = 0,
}: {
  alerts: AlertRow[];
  action: ResolveAction;
  heldBack?: number;
}) {
  const [state, formAction] = useActionState<ResolveResult | null, FormData>(action, null);

  return (
    <div className="space-y-3">
      {state && !state.ok ? (
        <p className="rounded-md border-l-4 border-danger bg-danger-soft px-3 py-2 text-sm" role="alert">
          {state.error}
        </p>
      ) : null}
      {state?.ok ? (
        <p className="rounded-md border-l-4 border-brand bg-brand-soft px-3 py-2 text-sm" role="status">
          <span aria-hidden className="mr-2">✓</span>
          {state.data.message}
        </p>
      ) : null}

      {alerts.map((a) => {
        const border =
          a.severity === "CRITICAL"
            ? "border-danger"
            : a.severity === "WARN"
              ? "border-brass"
              : "border-line";
        return (
          <div key={a.id} className={`rounded-lg border-l-4 ${border} border-y border-r border-line bg-surface p-3`}>
            <p className="font-medium">{a.action}</p>
            <p className="mt-1 text-xs text-ink-3">
              {a.animalName ? `${a.animalName} · ` : ""}
              {a.dueLabel}
            </p>
            <form action={formAction} className="mt-3 flex flex-wrap gap-2">
              <input type="hidden" name="alertId" value={a.id} />
              {OUTCOMES.map((o) => (
                <OutcomeButton key={o.value} {...o} />
              ))}
            </form>
          </div>
        );
      })}

      {heldBack > 0 ? (
        <p className="rounded-md border border-dashed border-line px-3 py-2 text-sm text-ink-3">
          {heldBack} more {heldBack === 1 ? "job is" : "jobs are"} waiting behind these. Clear some
          and they come forward — a list longer than a day&rsquo;s work stops being read.
        </p>
      ) : null}
    </div>
  );
}
