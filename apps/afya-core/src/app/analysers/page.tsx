import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth.ts";
import { can } from "@/lib/access.ts";
import {
  analyserSummary, listAnalysers, getAnalyser, mappingsFor,
  messagesFor, qcFor, heldReadings, worklist, worklistAstm,
} from "@/lib/analysers.ts";
import { formatValue } from "@/lib/laboratory.ts";
import { Shell, Stat, Section, Empty, Views } from "@/app/_components/shell.tsx";
import { receiveAction, resolveAction, analyserAction, mapAction } from "./actions.ts";

/**
 * The analyser bench.
 *
 * The held list leads, because a reading the interface could not file is the
 * only thing on this screen that needs a person, and it is somebody's blood.
 */

const FIELD = "w-full border border-line rounded px-2 py-1.5 text-sm";
const LABEL = "block text-xs text-muted mb-1";

/** Control characters do not survive a browser round trip, so frames are shown escaped. */
const readable = (raw: string) =>
  raw.replace(/\x02/g, "<STX>").replace(/\x03/g, "<ETX>").replace(/\r/g, "\n").replace(/\n+/g, "\n").trim();

export default async function AnalysersPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; a?: string; error?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  if (!can(user.userId, "lab.result.release") && !can(user.userId, "report.read")) redirect("/");

  const params = await searchParams;
  const view = params.view ?? "held";
  const configuring = can(user.userId, "facility.configure");

  const summary = analyserSummary(user.facilityId);
  const analysers = listAnalysers(user.facilityId);
  const held = heldReadings(user.facilityId);
  const pending = worklist(user.facilityId);

  const open = params.a ? getAnalyser(params.a) : undefined;
  const openMappings = open ? mappingsFor(open.code) : [];
  const openMessages = open ? messagesFor(open.code, 15) : [];
  const openQc = open ? qcFor(open.code, 15) : [];

  return (
    <Shell
      user={user}
      current="/analysers"
      error={params.error}
      title={
        open ? open.name
        : view === "worklist" ? "Analyser worklist"
        : view === "setup" ? "Analysers & mappings"
        : "Readings needing a person"
      }
      subtitle={
        view === "held" && !open
          ? "Nothing here was discarded. A reading the interface could not file is somebody's blood, and the usual cause is a barcode typed wrong at the bench."
          : undefined
      }
    >
      <Views
        current={open ? "setup" : view}
        views={[
          { key: "held", label: "Held", href: "/analysers" },
          { key: "worklist", label: "Worklist", href: "/analysers?view=worklist" },
          { key: "setup", label: "Analysers", href: "/analysers?view=setup" },
        ]}
      />

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <Stat
          label="Held readings"
          value={summary.held}
          tone={summary.held > 0 ? "block" : "good"}
          note={summary.topReason ? `most often: ${summary.topReason}` : "nothing waiting"}
        />
        <Stat label="Filed in 30 days" value={summary.filed} note={`${summary.messages} messages`} />
        <Stat
          label="Rejected frames"
          value={summary.rejectedFrames}
          tone={summary.rejectedFrames > 0 ? "clock" : "good"}
          note={`${summary.qcRuns} control runs`}
        />
        <Stat
          label="Analysers"
          value={`${summary.live}/${summary.analysers}`}
          tone={summary.live === 0 ? "clock" : summary.silent.length > 0 ? "clock" : "good"}
          note={
            summary.live === 0
              ? "all in demo mode — no driver is written"
              : summary.silent.length > 0
                ? `${summary.silent.length} silent for a day`
                : "all talking"
          }
        />
      </div>

      {summary.live === 0 ? (
        <p className="mt-4 text-xs bg-clock-soft border border-clock/25 text-clock rounded px-3 py-2">
          No serial port is opened and no listener is bound. What is here is the part worth getting right
          and testable without a machine: the frame checking, the parsing, the code and unit mapping, and
          the rules about what must never be filed. The transport is a driver that has not been written,
          and which analyser a laboratory buys decides what it has to do.
        </p>
      ) : null}

      {/* ==================================================== held */}
      {view === "held" && !open ? (
        <Section title="Readings the interface could not file">
          {held.length === 0 ? (
            <Empty>Everything the analysers sent was filed.</Empty>
          ) : (
            <div className="space-y-3">
              {held.map((row) => (
                <div key={row.id} className="bg-white border border-line rounded p-3">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-medium text-sm">{row.analyte || row.their_code}</span>
                    <span className="text-sm">{row.value_text} {row.unit}</span>
                    <span className="text-xs text-muted">
                      {row.analyser_code} · barcode {row.specimen_ref || "none in the message"} ·{" "}
                      {row.created_at.slice(0, 16).replace("T", " ")}
                    </span>
                  </div>
                  <p className="text-sm text-block mt-1">{row.reason}</p>

                  <form action={resolveAction} className="mt-3 grid gap-2 sm:grid-cols-5 items-end">
                    <input type="hidden" name="exceptionId" value={row.id} />
                    <div className="sm:col-span-2">
                      <label className={LABEL}>It belongs to specimen</label>
                      <input name="specimenId" className={FIELD} placeholder="the barcode on the tube" />
                    </div>
                    <div className="sm:col-span-2">
                      <label className={LABEL}>Or discard, and why</label>
                      <input name="discardReason" className={FIELD} placeholder="Control run under a patient barcode" />
                    </div>
                    <button className="bg-brand text-white text-sm rounded px-3 py-1.5">Resolve</button>
                  </form>
                </div>
              ))}
            </div>
          )}
        </Section>
      ) : null}

      {/* ================================================ worklist */}
      {view === "worklist" && !open ? (
        <>
          <Section title="Collected and not yet resulted" note="What an analyser that can ask would be told to run. Stat first.">
            {pending.length === 0 ? (
              <Empty>Nothing is waiting on the bench.</Empty>
            ) : (
              <div className="bg-white border border-line rounded overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-muted border-b border-line">
                    <tr>
                      <th className="px-3 py-2">Specimen</th>
                      <th className="px-2 py-2">Patient</th>
                      <th className="px-2 py-2">Ordered</th>
                      <th className="px-2 py-2">Collected</th>
                      <th className="px-2 py-2">Priority</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pending.map((entry) => (
                      <tr key={entry.specimenId} className="border-b border-line last:border-0">
                        <td className="px-3 py-2 font-mono text-xs">{entry.specimenId}</td>
                        <td className="px-2 py-2">
                          <Link href={`/patients/${entry.patientMrn}`} className="text-brand hover:underline">
                            {entry.patientMrn}
                          </Link>
                        </td>
                        <td className="px-2 py-2">{entry.serviceName}</td>
                        <td className="px-2 py-2 text-muted whitespace-nowrap">
                          {entry.collectedAt.slice(0, 16).replace("T", " ")}
                        </td>
                        <td className={`px-2 py-2 ${entry.priority === "stat" ? "text-block" : "text-muted"}`}>
                          {entry.priority}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {analysers.length > 0 ? (
            <Section title="As the analyser would be sent it" note="Built here rather than in a driver, so the record layout is testable without a machine on the other end.">
              <pre className="bg-white border border-line rounded p-3 text-xs overflow-x-auto whitespace-pre-wrap">
                {readable(worklistAstm(user.facilityId, analysers[0].code))}
              </pre>
            </Section>
          ) : null}
        </>
      ) : null}

      {/* =================================================== setup */}
      {view === "setup" && !open ? (
        <>
          <Section title="Analysers">
            {analysers.length === 0 ? (
              <Empty>No analyser is connected.</Empty>
            ) : (
              <div className="bg-white border border-line rounded overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-muted border-b border-line">
                    <tr>
                      <th className="px-3 py-2">Code</th>
                      <th className="px-2 py-2">Analyser</th>
                      <th className="px-2 py-2">Protocol</th>
                      <th className="px-2 py-2">Where</th>
                      <th className="px-2 py-2">Last heard</th>
                      <th className="px-2 py-2">Mode</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysers.map((analyser) => (
                      <tr key={analyser.code} className="border-b border-line last:border-0">
                        <td className="px-3 py-2">
                          <Link href={`/analysers?a=${analyser.code}`} className="text-brand hover:underline">
                            {analyser.code}
                          </Link>
                        </td>
                        <td className="px-2 py-2">{analyser.name}</td>
                        <td className="px-2 py-2 text-muted uppercase">{analyser.protocol}</td>
                        <td className="px-2 py-2 text-muted">{analyser.connection || "—"}</td>
                        <td className="px-2 py-2 text-muted whitespace-nowrap">
                          {analyser.last_seen_at ? analyser.last_seen_at.slice(0, 16).replace("T", " ") : "never"}
                        </td>
                        <td className="px-2 py-2">
                          {analyser.mode === "live" ? (
                            <span className="text-good">live</span>
                          ) : (
                            <span className="text-clock">demo</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {configuring ? (
            <Section title="Connect an analyser">
              <form action={analyserAction} className="bg-white border border-line rounded p-3 grid gap-3 sm:grid-cols-5 items-end">
                <div>
                  <label className={LABEL}>Code</label>
                  <input name="code" required className={FIELD} placeholder="CHEM2" />
                </div>
                <div className="sm:col-span-2">
                  <label className={LABEL}>Name</label>
                  <input name="name" required className={FIELD} placeholder="Chemistry analyser" />
                </div>
                <div>
                  <label className={LABEL}>Protocol</label>
                  <select name="protocol" className={FIELD}>
                    <option value="astm">ASTM E1381/E1394</option>
                    <option value="hl7">HL7 v2 ORU</option>
                  </select>
                </div>
                <button className="bg-brand text-white text-sm rounded px-3 py-1.5">Register</button>
                <div className="sm:col-span-2">
                  <label className={LABEL}>Make and model</label>
                  <div className="flex gap-2">
                    <input name="make" className={FIELD} />
                    <input name="model" className={FIELD} />
                  </div>
                </div>
                <div className="sm:col-span-3">
                  <label className={LABEL}>Where it is plugged in</label>
                  <input name="connection" className={FIELD} placeholder="RS-232, bench 2" />
                </div>
              </form>
            </Section>
          ) : null}
        </>
      ) : null}

      {/* ============================================ one analyser */}
      {open ? (
        <>
          <Section title={`${open.code} · ${open.name}`}>
            <div className="bg-white border border-line rounded p-3 text-sm">
              <p className="text-muted">
                {open.protocol.toUpperCase()}
                {open.make ? ` · ${open.make} ${open.model}` : ""}
                {open.connection ? ` · ${open.connection}` : ""}
              </p>
              <p className="mt-1">
                {open.mode === "live" ? <span className="text-good">live</span> : <span className="text-clock">demo mode</span>}
                <span className="text-muted">
                  {" "}· last heard{" "}
                  {open.last_seen_at ? open.last_seen_at.slice(0, 16).replace("T", " ") : "never"}
                </span>
              </p>
              <p className="mt-2">
                <Link href="/analysers?view=setup" className="text-brand text-sm hover:underline">← all analysers</Link>
              </p>
            </div>
          </Section>

          <Section
            title="Test codes"
            note="What the machine calls a test and what this system calls it. Without a conversion factor, a result in a different unit is held rather than guessed at."
          >
            <div className="bg-white border border-line rounded overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-muted border-b border-line">
                  <tr>
                    <th className="px-3 py-2">Their code</th>
                    <th className="px-2 py-2">Our analyte</th>
                    <th className="px-2 py-2">Their unit</th>
                    <th className="px-2 py-2 text-right">Factor</th>
                  </tr>
                </thead>
                <tbody>
                  {openMappings.map((mapping) => (
                    <tr key={mapping.id} className="border-b border-line last:border-0">
                      <td className="px-3 py-2 font-mono text-xs">{mapping.their_code}</td>
                      <td className="px-2 py-2">{mapping.analyte}</td>
                      <td className="px-2 py-2 text-muted">{mapping.their_unit || "—"}</td>
                      <td className={`px-2 py-2 text-right ${mapping.factor === null ? "text-block" : ""}`}>
                        {mapping.factor === null ? "none — results held" : mapping.factor}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {configuring ? (
              <form action={mapAction} className="mt-3 bg-white border border-line rounded p-3 grid gap-3 sm:grid-cols-5 items-end">
                <input type="hidden" name="analyserCode" value={open.code} />
                <div>
                  <label className={LABEL}>Their code</label>
                  <input name="theirCode" required className={FIELD} placeholder="GLU" />
                </div>
                <div>
                  <label className={LABEL}>Our analyte</label>
                  <input name="analyte" required className={FIELD} placeholder="GLUCOSE" />
                </div>
                <div>
                  <label className={LABEL}>Their unit</label>
                  <input name="theirUnit" className={FIELD} placeholder="mmol/L" />
                </div>
                <div>
                  <label className={LABEL}>Multiply by</label>
                  <input name="factor" type="number" step="any" min="0" className={FIELD} placeholder="1" />
                </div>
                <button className="bg-brand text-white text-sm rounded px-3 py-1.5">Map</button>
              </form>
            ) : null}
          </Section>

          <Section title="Take a message" note="What a driver would hand over. On a machine in demo mode, paste or generate one.">
            <form action={receiveAction} className="bg-white border border-line rounded p-3 grid gap-3">
              <input type="hidden" name="analyserCode" value={open.code} />
              <div>
                <label className={LABEL}>The message, as it came off the wire</label>
                <textarea
                  name="raw"
                  required
                  rows={4}
                  className={`${FIELD} font-mono`}
                  placeholder={
                    open.protocol === "astm"
                      ? "R|1|^^^GLU|5.5|mmol/L||N||F"
                      : "OBX|1|NM|HGB^Haemoglobin||11.2|g/dL|||||F"
                  }
                />
              </div>
              <div>
                <button className="bg-brand text-white text-sm rounded px-3 py-1.5">Take it</button>
              </div>
            </form>
          </Section>

          <Section title="Messages" note="Kept verbatim. Six months later the question is what the machine actually said.">
            {openMessages.length === 0 ? (
              <Empty>Nothing has come off this analyser.</Empty>
            ) : (
              <div className="space-y-2">
                {openMessages.map((message) => (
                  <div key={message.id} className="bg-white border border-line rounded p-3">
                    <p className="text-sm">
                      <span className="text-muted">{message.received_at.slice(0, 16).replace("T", " ")}</span>{" "}
                      <span
                        className={
                          message.status === "accepted" ? "text-good"
                          : message.status === "rejected" ? "text-block"
                          : "text-clock"
                        }
                      >
                        {message.status}
                      </span>
                      <span className="text-muted">
                        {" "}· {message.results} filed{message.held > 0 ? `, ${message.held} held` : ""}
                      </span>
                    </p>
                    {message.note ? <p className="text-xs text-block mt-1">{message.note}</p> : null}
                    <pre className="mt-2 text-[11px] text-muted overflow-x-auto whitespace-pre-wrap">
                      {readable(message.raw)}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {openQc.length > 0 ? (
            <Section title="Quality control" note="A control is not a patient. These never reach anybody's record.">
              <div className="bg-white border border-line rounded overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-muted border-b border-line">
                    <tr>
                      <th className="px-3 py-2">Run</th>
                      <th className="px-2 py-2">Control</th>
                      <th className="px-2 py-2">Analyte</th>
                      <th className="px-2 py-2 text-right">Reading</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openQc.map((row) => (
                      <tr key={row.id} className="border-b border-line last:border-0">
                        <td className="px-3 py-2 text-muted whitespace-nowrap">
                          {row.run_at.slice(0, 16).replace("T", " ")}
                        </td>
                        <td className="px-2 py-2">{row.control_ref}</td>
                        <td className="px-2 py-2">{row.analyte}</td>
                        <td className="px-2 py-2 text-right">{formatValue(row.value_milli, row.unit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-muted">
                Readings only. No target, no tolerance and no Westgard rules — a laboratory running its own QC
                programme needs all three, and none of them is here.
              </p>
            </Section>
          ) : null}
        </>
      ) : null}
    </Shell>
  );
}
