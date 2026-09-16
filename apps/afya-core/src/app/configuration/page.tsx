import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth.ts";
import { can } from "@/lib/access.ts";
import {
  allSettings, outstanding, configSummary, historyFor, LOCKED, HARD_CODED,
  type SettingState,
} from "@/lib/configuration.ts";
import { Shell, Stat, Section, Empty, Views } from "@/app/_components/shell.tsx";
import { applyAction, resetAction, reviewAction } from "./actions.ts";

/**
 * The configuration studio.
 *
 * Built around the review rather than the change, because most of what the
 * clinical review register asks for is not a different number — it is a named
 * person saying the seeded one is right, and nowhere else in this system can
 * record that.
 */

const FIELD = "w-full border border-line rounded px-2 py-1.5 text-sm";
const LABEL = "block text-xs text-muted mb-1";

const STATUS_LABEL: Record<string, { text: string; tone: string }> = {
  default: { text: "nobody has confirmed this", tone: "text-clock" },
  reviewed: { text: "reviewed and signed off", tone: "text-good" },
  changed_unreviewed: { text: "changed, not yet signed off", tone: "text-clock" },
  review_stale: { text: "the sign-off was for a different value", tone: "text-block" },
  changed: { text: "changed", tone: "text-ink" },
};

function Setting({ state }: { state: SettingState }) {
  const { definition } = state;
  const status = STATUS_LABEL[state.status];
  const history = historyFor(definition.key, 5);

  return (
    <div className="bg-white border border-line rounded p-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-medium text-sm">{definition.name}</span>
        <span className="text-lg font-semibold">{state.value}</span>
        {definition.unit ? <span className="text-xs text-muted">{definition.unit}</span> : null}
        {definition.clinical ? <span className="text-xs text-block">clinical</span> : null}
        <span className={`text-xs ${status.tone}`}>{status.text}</span>
        <span className="ml-auto text-xs text-muted">rule {definition.rule}</span>
      </div>
      <p className="text-sm text-muted mt-1">{definition.explains}</p>
      <p className="text-xs text-muted mt-1">
        The code says {definition.fallback}
        {state.isDefault ? "" : ` · the facility has it at ${state.value}`} · should be confirmed by{" "}
        {definition.reviewer.toLowerCase()}
      </p>

      {state.reviewedBy ? (
        <p className="text-xs text-good mt-1">
          {state.reviewedBy.name}
          {state.reviewedBy.role ? `, ${state.reviewedBy.role}` : ""} on {state.reviewedBy.at.slice(0, 10)}
          {state.reviewedBy.source ? ` — ${state.reviewedBy.source}` : ""}
          {state.reviewedBy.note ? ` (${state.reviewedBy.note})` : ""}
        </p>
      ) : null}
      {state.setBy ? (
        <p className="text-xs text-muted mt-1">
          Set by {state.setBy.name} on {state.setBy.at.slice(0, 10)} — {state.setBy.reason}
          {state.setBy.source ? ` · ${state.setBy.source}` : ""}
        </p>
      ) : null}

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <form action={reviewAction} className="border border-line rounded p-2">
          <p className="text-xs font-medium mb-2">Confirm it as it is</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className={LABEL}>Who read it</label>
              <input name="reviewerName" required className={FIELD} placeholder="their name" />
            </div>
            <div>
              <label className={LABEL}>Their role</label>
              <input name="reviewerRole" className={FIELD} placeholder={definition.reviewer} />
            </div>
            <div className="sm:col-span-2">
              <label className={LABEL}>
                {definition.clinical ? "What it was checked against (required)" : "Source, if any"}
              </label>
              <input name="source" required={definition.clinical} className={FIELD} />
            </div>
          </div>
          <input type="hidden" name="key" value={definition.key} />
          <button className="mt-2 bg-brand text-white text-sm rounded px-3 py-1.5">Sign it off</button>
        </form>

        <form action={applyAction} className="border border-line rounded p-2">
          <p className="text-xs font-medium mb-2">Or change it</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className={LABEL}>New value</label>
              <input
                name="value"
                required
                type={definition.type === "text" ? "text" : "number"}
                step={definition.type === "decimal" ? "any" : "1"}
                min={definition.min}
                max={definition.max}
                defaultValue={state.value}
                className={FIELD}
              />
            </div>
            <div>
              <label className={LABEL}>Why</label>
              <input name="reason" required className={FIELD} />
            </div>
            <div className="sm:col-span-2">
              <label className={LABEL}>
                {definition.clinical ? "Source it comes from (required)" : "Source, if any"}
              </label>
              <input
                name="source"
                required={definition.clinical}
                className={FIELD}
                placeholder={definition.clinical ? "a document, not a person" : ""}
              />
            </div>
          </div>
          <input type="hidden" name="key" value={definition.key} />
          <div className="mt-2 flex gap-2">
            <button className="bg-white border border-line text-sm rounded px-3 py-1.5 hover:border-brand">
              Change it
            </button>
          </div>
        </form>
      </div>

      {!state.isDefault ? (
        <form action={resetAction} className="mt-2 flex flex-wrap gap-2 items-end">
          <input type="hidden" name="key" value={definition.key} />
          <div className="flex-1 min-w-60">
            <label className={LABEL}>Put it back to {definition.fallback} — why</label>
            <input name="reason" required className={FIELD} />
          </div>
          <button className="bg-white border border-line text-sm rounded px-3 py-1.5 hover:border-block">
            Reset
          </button>
        </form>
      ) : null}

      {history.length > 0 ? (
        <details className="mt-2">
          <summary className="text-xs text-muted cursor-pointer">What it used to be</summary>
          <div className="mt-1 space-y-1">
            {history.map((row) => (
              <p key={row.id} className="text-xs text-muted">
                {row.happened_at.slice(0, 10)} · {row.kind}
                {row.kind === "changed" ? ` ${row.old_value} → ${row.new_value}` : ` at ${row.new_value}`} ·{" "}
                {row.actor_name}
                {row.source ? ` · ${row.source}` : ""}
                {row.reason ? ` — ${row.reason}` : ""}
              </p>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

export default async function ConfigurationPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; error?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  if (!can(user.userId, "facility.configure")) redirect("/");

  const params = await searchParams;
  const view = params.view ?? "outstanding";

  const summary = configSummary();
  const waiting = outstanding();
  const settings = allSettings();

  return (
    <Shell
      user={user}
      current="/configuration"
      error={params.error}
      title={
        view === "all" ? "Every setting"
        : view === "fixed" ? "What cannot be changed here"
        : "Waiting to be confirmed"
      }
      subtitle={
        view === "outstanding"
          ? "Most of these are not wrong. They are numbers nobody has confirmed, and a named person saying so is what the clinical review register is actually asking for."
          : undefined
      }
    >
      <Views
        current={view}
        views={[
          { key: "outstanding", label: "To confirm", href: "/configuration" },
          { key: "all", label: "Every setting", href: "/configuration?view=all" },
          { key: "fixed", label: "Fixed in the code", href: "/configuration?view=fixed" },
        ]}
      />

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <Stat
          label="Signed off"
          value={`${summary.reviewed}/${summary.settings}`}
          tone={summary.reviewed === summary.settings ? "good" : "clock"}
          note={`${summary.changed} changed from the code`}
        />
        <Stat
          label="Clinical, unconfirmed"
          value={summary.clinicalUnreviewed}
          tone={summary.clinicalUnreviewed > 0 ? "block" : "good"}
          note="each is a threshold a clinician should read"
        />
        <Stat
          label="Stale sign-offs"
          value={summary.stale}
          tone={summary.stale > 0 ? "block" : "good"}
          note="the value moved after somebody vouched for it"
        />
        <Stat
          label="Fixed in the code"
          value={`${summary.locked} + ${summary.hardCoded}`}
          note="deliberately locked, and not yet configurable"
        />
      </div>

      {view === "outstanding" ? (
        <Section title="Waiting to be confirmed">
          {waiting.length === 0 ? (
            <Empty>Everything on this list has somebody's name against it.</Empty>
          ) : (
            <div className="space-y-3">
              {waiting.map((state) => (
                <Setting key={state.definition.key} state={state} />
              ))}
            </div>
          )}
        </Section>
      ) : null}

      {view === "all" ? (
        <Section title="Every setting a facility owns" note="Deliberately short. A settings screen listing two hundred keys is one nobody reads.">
          <div className="space-y-3">
            {settings.map((state) => (
              <Setting key={state.definition.key} state={state} />
            ))}
          </div>
        </Section>
      ) : null}

      {view === "fixed" ? (
        <>
          <Section
            title="Locked on purpose"
            note="A facility asking whether these can be turned off deserves to be told no, and why, on a screen rather than by nobody."
          >
            <div className="bg-white border border-line rounded divide-y divide-line">
              {LOCKED.map((locked) => (
                <div key={locked.name} className="px-3 py-2 text-sm">
                  <p className="font-medium">{locked.name}</p>
                  <p className="text-muted">{locked.why}</p>
                  <p className="text-xs text-muted">{locked.where}</p>
                </div>
              ))}
            </div>
          </Section>

          <Section
            title="Not yet configurable"
            note="Named rather than implied away. Each is a constant in the code that the review register asks a facility to own."
          >
            <div className="bg-white border border-line rounded divide-y divide-line">
              {HARD_CODED.map((item) => (
                <div key={item.name} className="px-3 py-2 text-sm flex flex-wrap gap-2">
                  <span>{item.name}</span>
                  <span className="text-xs text-muted">{item.where}</span>
                  <span className="ml-auto text-xs text-muted">rule {item.rule}</span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">
              A studio that implied more was configurable than is would be worse than one that says so.{" "}
              <Link href="/admin" className="text-brand hover:underline">Facility settings</Link> holds the
              identifiers and the integration modes; this screen holds the thresholds.
            </p>
          </Section>
        </>
      ) : null}
    </Shell>
  );
}
