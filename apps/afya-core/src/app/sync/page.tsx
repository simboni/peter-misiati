import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth.ts";
import { can } from "@/lib/access.ts";
import { pendingPush, syncStatus, openConflicts, compareOps, type ConflictRow } from "@/lib/sync.ts";
import {
  transportSummary, listBatches, outboundName, outboundPrefix, batchFolder, MAX_BATCH_OPS,
  type BatchFile,
} from "@/lib/sync-transport.ts";
import { Shell, Stat, Section, Empty, Views, Banner } from "@/app/_components/shell.tsx";
import { exchangeAction, writeBatchAction, collectAction, reviewAction } from "./actions.ts";

/**
 * The sync screen.
 *
 * The engine underneath has been complete for a long time and had nowhere to be
 * pressed, which made it the one module a clinic could not actually operate: an
 * offline-first system whose operator cannot see what is waiting to leave, or
 * put a stick in, is offline-first only in the source code.
 *
 * Arranged around the two questions somebody actually has. Before the drive to
 * the sub-county office: what have we not sent? After it: what came back that
 * the merge could not settle on its own?
 */

const FIELD = "w-full border border-line rounded px-2 py-1.5 text-sm";

function when(value: string | null): string {
  return value ? value.slice(0, 16).replace("T", " ") : "—";
}

/** Which fields an operation touched, without saying what they now say. */
function fieldsOf(payload: string): string {
  try {
    const keys = Object.keys(JSON.parse(payload) as Record<string, unknown>);
    return keys.length ? keys.join(", ") : "nothing";
  } catch {
    return "unreadable";
  }
}

function size(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`;
}

const CLASS_NOTE: Record<string, string> = {
  clinical: "both versions kept — a clinician says which stands",
  ledger: "the server figure stands; the variance is recorded, never dropped",
  demographic: "the later value won, field by field",
  identifier: "both numbers keep resolving — the one on the patient's slip must",
};

function Batch({ file, mine }: { file: BatchFile; mine: boolean }) {
  return (
    <div className="bg-white border border-line rounded p-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-medium text-sm">{file.name}</span>
        {mine ? <span className="text-xs text-muted">what this device left</span> : null}
        {file.problem ? (
          <span className="text-xs text-block">{file.problem}</span>
        ) : (
          <span className="text-xs text-muted">
            from {file.from} · {file.ops} operation{file.ops === 1 ? "" : "s"} · packed {when(file.sentAt)}
          </span>
        )}
        <span className="ml-auto text-xs text-muted tnum">
          {size(file.sizeBytes)} · {when(file.modifiedAt)}
        </span>
      </div>
      {file.digest ? (
        <p className="text-xs text-muted mt-1 font-mono break-all">digest {file.digest.slice(0, 32)}…</p>
      ) : null}

      {mine || file.problem ? (
        <p className="text-xs text-muted mt-2">
          {mine
            ? "Carry this one out, and delete it once the other end has it. Nothing here is overwritten, so an undelivered batch stays where it is."
            : "Nothing here can be collected from it. Go back for a good copy rather than applying half of one."}
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          <form action={exchangeAction}>
            <input type="hidden" name="name" value={file.name} />
            <button className="bg-brand text-white text-sm rounded px-3 py-1.5">
              Send ours and take theirs
            </button>
          </form>
          <form action={collectAction}>
            <input type="hidden" name="name" value={file.name} />
            <button className="bg-white border border-line text-sm rounded px-3 py-1.5 hover:border-brand">
              Take theirs only
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function Conflict({ conflict, mayResolve }: { conflict: ConflictRow; mayResolve: boolean }) {
  return (
    <div className="bg-white border border-line rounded p-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-medium text-sm">
          {conflict.entity} {conflict.entity_id}
        </span>
        {conflict.field ? <span className="text-xs text-muted">on {conflict.field}</span> : null}
        <span className={`text-xs ${conflict.data_class === "clinical" ? "text-block" : "text-muted"}`}>
          {conflict.data_class}
        </span>
        <span className="ml-auto text-xs text-muted">seen {when(conflict.detected_at)}</span>
      </div>
      <p className="text-sm text-muted mt-1">{CLASS_NOTE[conflict.data_class]}</p>
      <p className="text-xs text-muted mt-1 font-mono break-all">
        kept {conflict.kept_op_id} · other {conflict.other_op_id} · {conflict.resolution}
      </p>

      {mayResolve ? (
        <form action={reviewAction} className="mt-2 flex flex-wrap gap-2 items-end">
          <input type="hidden" name="id" value={conflict.id} />
          <div className="flex-1 min-w-60">
            <label className="block text-xs text-muted mb-1">What you decided, and why</label>
            <input name="note" className={FIELD} placeholder="read both, the ward note stands" />
          </div>
          <button className="bg-brand text-white text-sm rounded px-3 py-1.5">Sign it off</button>
        </form>
      ) : (
        <p className="text-xs text-clock mt-2">
          {conflict.data_class === "clinical"
            ? "Two people documented this. Only somebody who may conduct a consultation can say which reading stands."
            : "Somebody who may read reports has to sign this one off."}
        </p>
      )}
    </div>
  );
}

export default async function SyncPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; error?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  if (!can(user.userId, "device.manage") && !can(user.userId, "report.read")) redirect("/");

  const params = await searchParams;
  const view = params.view ?? "exchange";

  const summary = transportSummary(user.facilityId);
  const status = user.deviceCode ? syncStatus(user.deviceCode) : null;
  const conflicts = openConflicts("all");
  const clinical = conflicts.filter((c) => c.data_class === "clinical");
  const waiting = pendingPush().sort(compareOps);
  const files = listBatches();
  const minePrefix = user.deviceCode ? outboundPrefix(user.deviceCode) : "\u0000";
  const nextName = user.deviceCode ? outboundName(user.deviceCode) : "";
  // A device pushes its own work and nobody else's, so the facility total and
  // the number that would go into this device's batch are different figures and
  // saying either one twice would be a lie about the other.
  const byDevice = [...waiting.reduce((map, op) => map.set(op.device_code, (map.get(op.device_code) ?? 0) + 1), new Map<string, number>())]
    .sort((a, b) => b[1] - a[1]);
  const mineWaiting = user.deviceCode ? (byDevice.find(([code]) => code === user.deviceCode)?.[1] ?? 0) : 0;
  const mayCarry = can(user.userId, "device.manage") && Boolean(user.deviceCode);
  // An operation's payload is the clinical content itself — a complaint, an
  // examination, an assessment. Carrying the stick is not a reason to read it,
  // so somebody without a right to open a record sees which fields moved and
  // not what they say.
  const mayReadContent = can(user.userId, "patient.read");

  return (
    <Shell
      user={user}
      // Two of these views have their own nav entry, so the sidebar follows the
      // one being looked at rather than always reading as the first.
      current={view === "conflicts" ? "/sync?view=conflicts" : "/sync"}
      error={params.error}
      title={
        view === "waiting" ? "Waiting to be sent"
        : view === "conflicts" ? "Conflicts the merge kept both sides of"
        : "Sync"
      }
      subtitle={
        view === "exchange"
          ? "A clinic with no line keeps working and sends later. This is where later happens: a file on a stick, written here and read at the other end."
          : undefined
      }
    >
      <Views
        current={view}
        views={[
          { key: "exchange", label: "Carry a batch", href: "/sync" },
          { key: "waiting", label: "Waiting to be sent", href: "/sync?view=waiting" },
          { key: "conflicts", label: "Conflicts", href: "/sync?view=conflicts" },
        ]}
      />

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <Stat
          label="Waiting to be sent"
          value={summary.waiting}
          // Amber only once the oldest thing waiting is over a day old. A
          // clinic that has been offline since breakfast has a large number
          // here and is working exactly as designed.
          tone={
            summary.oldestWaiting && Date.now() - Date.parse(summary.oldestWaiting) > 86_400_000
              ? "clock"
              : "ink"
          }
          note={
            summary.oldestWaiting
              ? `across ${byDevice.length} device${byDevice.length === 1 ? "" : "s"} · oldest ${when(summary.oldestWaiting)}`
              : "everything has been acknowledged"
          }
          href="/sync?view=waiting"
        />
        <Stat
          label="This device"
          value={status ? status.deviceCode : "—"}
          note={status ? `clock ${status.clock} · last sync ${when(status.lastSyncedAt)}` : "not a registered device"}
        />
        <Stat
          label="Batches taken in"
          value={summary.batchesApplied}
          note={`${summary.batchesRefused} refused`}
          tone={summary.batchesRefused > 0 ? "clock" : "ink"}
        />
        <Stat
          label="Conflicts to answer"
          value={conflicts.length}
          tone={clinical.length > 0 ? "block" : conflicts.length > 0 ? "clock" : "good"}
          note={`${clinical.length} clinical`}
          href="/sync?view=conflicts"
        />
      </div>

      {view === "exchange" ? (
        <>
          {summary.lastRefusal ? (
            <div className="mt-4">
              <Banner tone="clock">The last batch refused: {summary.lastRefusal}</Banner>
            </div>
          ) : null}

          {!mayCarry ? (
            <div className="mt-4">
              <Banner tone="info">
                {user.deviceCode
                  ? "You can see what is waiting. Carrying a batch is a device operation, and this account does not do those."
                  : "This session is not on a registered device. A batch has to say which device packed it, so it has to be written from one."}
              </Banner>
            </div>
          ) : null}

          <Section
            title="The folder"
            note={`${batchFolder()} — in a real deployment this is where the stick mounts. A batch is only ever picked from what is in it; there is nowhere to type a path.`}
          >
            {files.length === 0 ? (
              <Empty>Nothing in the folder. Write this device&rsquo;s batch below and carry it out.</Empty>
            ) : (
              <div className="space-y-3">
                {files.map((file) => (
                  <Batch key={file.name} file={file} mine={file.name.startsWith(minePrefix)} />
                ))}
              </div>
            )}
          </Section>

          {mayCarry ? (
            <Section
              title="Write this device&rsquo;s batch"
              note="Nothing is marked sent until the file has actually been written, and a new batch never overwrites an older one — packing marks those operations sent, so writing over a stick that has not been delivered would destroy the only copy. Deleting the ones that arrived is the operator's job."
            >
              <form action={writeBatchAction} className="bg-white border border-line rounded p-3">
                <p className="text-sm">
                  {mineWaiting === 0
                    ? "Nothing of this device's is waiting, so there is no batch to write."
                    : `${mineWaiting} of this device's operation${mineWaiting === 1 ? "" : "s"} would go into ${nextName}.`}
                </p>
                {summary.waiting > mineWaiting ? (
                  <p className="text-xs text-clock mt-1">
                    The other {summary.waiting - mineWaiting}{" "}belong to other devices. A device carries
                    its own work and nobody else&rsquo;s, so those go out from the machines that did them.
                  </p>
                ) : null}
                {mineWaiting > 0 ? (
                  <button className="mt-2 bg-brand text-white text-sm rounded px-3 py-1.5">Write it</button>
                ) : null}
              </form>
            </Section>
          ) : null}

          <Section
            title="What each device is holding"
            note="A batch says which device packed it, and a device packs only its own work — so a machine nobody signs in on is a machine whose work never leaves."
          >
            {byDevice.length === 0 ? (
              <Empty>Every device has had its work acknowledged.</Empty>
            ) : (
              <div className="bg-white border border-line rounded divide-y divide-line">
                {byDevice.map(([code, count]) => (
                  <div key={code} className="px-3 py-2 text-sm flex flex-wrap items-baseline gap-2">
                    <span className="font-medium">{code}</span>
                    {code === user.deviceCode ? <span className="text-xs text-muted">this one</span> : null}
                    <span className="ml-auto tnum">{count}</span>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="What this will and will not do">
            <div className="bg-white border border-line rounded divide-y divide-line text-sm">
              <p className="px-3 py-2">
                A batch is refused whole if it does not match its own digest. Half a batch applied in order
                looks exactly like a complete one until the missing half arrives and cannot be placed.
              </p>
              <p className="px-3 py-2">
                A batch from a device this facility never registered is refused: device registration is what
                makes an identifier minted offline unique.
              </p>
              <p className="px-3 py-2">
                At most {MAX_BATCH_OPS.toLocaleString()}{" "}operations in one batch, and a clock no real
                device could have reached is refused rather than accepted — it would move this device&rsquo;s clock
                there permanently.
              </p>
              <p className="px-3 py-2 text-muted">
                ⚠️ A batch taken in updates the operation log and not yet the patient record. The merge works
                out what each field should now be; writing that back into patients, encounters and the rest is
                per-module work that has not been done. Rule 26.14.
              </p>
              <p className="px-3 py-2 text-muted">
                ⚠️ A batch is not signed or encrypted. Its digest catches a file that arrived torn; it does not
                catch one that was deliberately rewritten, and anybody who picks the stick up can read every
                operation on it. Rule 26.11.
              </p>
              <p className="px-3 py-2 text-muted">
                ⚠️ There is no network sync. The hub a clinic would push to has not been specified, so the
                only transport that works is the file. That is not a placeholder — it is what a clinic two
                hours from the sub-county office actually uses.
              </p>
            </div>
          </Section>
        </>
      ) : null}

      {view === "waiting" ? (
        <Section
          title="Operations this facility has not had acknowledged"
          note={
            "In the order every device agrees on: the clock first, the device code to break the tie. Nothing is deleted once it has been sent — the log is the record of what a device did, and a device that has forgotten cannot answer for itself." +
            (mayReadContent
              ? ""
              : " You are seeing which fields each operation touched and not what they say, because carrying a batch is not a reason to read a consultation.")
          }
        >
          {waiting.length === 0 ? (
            <Empty>Everything this facility has done has been acknowledged somewhere else.</Empty>
          ) : (
            <div className="bg-white border border-line rounded divide-y divide-line">
              {waiting.slice(0, 50).map((op) => (
                <div key={op.op_id} className="px-3 py-2 text-sm flex flex-wrap gap-x-3 gap-y-1">
                  <span className="tnum text-xs text-muted w-20">
                    {op.device_code} {op.lamport}
                  </span>
                  <span className="font-medium">
                    {op.entity} {op.entity_id}
                  </span>
                  <span className="text-xs text-muted">{op.data_class}</span>
                  <span className="text-xs text-muted">{op.actor_name}</span>
                  <span className="ml-auto text-xs text-muted tnum">{when(op.at)}</span>
                  <p className="w-full text-xs text-muted font-mono break-all">
                    {mayReadContent ? op.payload : fieldsOf(op.payload)}
                  </p>
                </div>
              ))}
            </div>
          )}
          {waiting.length > 50 ? (
            <p className="mt-2 text-xs text-muted">
              {waiting.length - 50}{" "}more, not listed. This view is here to show that nothing was
              dropped, not to be read end to end — a batch carries 500 at a time, so this goes in parts
              anyway.
            </p>
          ) : null}
        </Section>
      ) : null}

      {view === "conflicts" ? (
        <Section
          title="Both versions were kept"
          note="Nothing here was lost. The merge settles what it can from the data class alone and stops where it would have to guess — which is exactly the point at which a person should be looking."
        >
          {conflicts.length === 0 ? (
            <Empty>Nothing is waiting on a person.</Empty>
          ) : (
            <div className="space-y-3">
              {conflicts.map((conflict) => (
                <Conflict
                  key={conflict.id}
                  conflict={conflict}
                  mayResolve={can(
                    user.userId,
                    conflict.data_class === "clinical" ? "encounter.conduct" : "report.read",
                  )}
                />
              ))}
            </div>
          )}
        </Section>
      ) : null}
    </Shell>
  );
}
