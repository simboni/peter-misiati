import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth.ts";
import { can } from "@/lib/access.ts";
import { getFacility, facilityCompliance, listDevices } from "@/lib/facility.ts";
import { listUsers, expiringLicences } from "@/lib/users.ts";
import { health, integrationLog, deadLetters } from "@/lib/integration.ts";
import { storageUsed } from "@/lib/documents.ts";
import { verifyAuditChain } from "@/lib/db.ts";
import { coverage as terminologyCoverage } from "@/lib/terminology.ts";
import { listPayers } from "@/lib/payers.ts";
import { CADRES, ROLES } from "@/lib/seed.ts";
import { Shell, Stat, Section, Empty, Banner } from "@/app/_components/shell.tsx";
import {
  identifiersAction, deviceAction, revokeDeviceAction, userAction, toggleUserAction,
  endpointModeAction, resolveDeadLetterAction, tariffAction,
} from "./actions.ts";

/**
 * Administration.
 *
 * The compliance flags on the dashboard are complaints; this is where they are
 * answered. A red flag with no remedy is worse than no flag, so the identifiers
 * form is first and the rest follows.
 */
export default async function AdminPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  if (!can(user.userId, "facility.configure")) redirect("/");

  const facility = getFacility(user.facilityId)!;
  const flags = facilityCompliance(user.facilityId);
  const devices = listDevices(user.facilityId);
  const staff = listUsers(user.facilityId);
  const expiring = expiringLicences(user.facilityId, 60);
  const endpoints = health();
  const dead = deadLetters();
  const log = integrationLog(undefined, 12);
  const storage = storageUsed(user.facilityId);
  const chain = verifyAuditChain();
  const catalogue = terminologyCoverage();
  const payers = listPayers();

  const modeTone: Record<string, string> = {
    live: "text-good",
    demo: "text-clock",
    disabled: "text-muted",
  };

  return (
    <Shell
      user={user}
      current="/admin"
      title="Administration"
      subtitle={`${facility.name} · KMHFL ${facility.kmhfl_code}`}
    >
      <div className="mt-5 grid gap-3 sm:grid-cols-4">
        <Stat
          label="Blocking compliance"
          value={flags.filter((f) => f.severity === "critical").length}
          tone={flags.some((f) => f.severity === "critical") ? "block" : "good"}
        />
        <Stat label="Active staff" value={staff.filter((s) => s.active).length} note={`${staff.length} total`} />
        <Stat
          label="Audit chain"
          value={chain.ok ? "Intact" : "Broken"}
          tone={chain.ok ? "good" : "block"}
          note={chain.ok ? `${chain.checked} entries` : `breaks at #${chain.failedAtId}`}
        />
        <Stat
          label="Documents held"
          value={storage.documents}
          note={`${(storage.bytes / 1_048_576).toFixed(1)} MB in the facility file`}
          tone="muted"
        />
      </div>

      {flags.length > 0 ? (
        <Section title="Answer the compliance flags">
          <ul className="flex flex-col gap-2 mb-3">
            {flags.map((f) => (
              <li key={f.key}>
                <Banner tone={f.severity === "critical" ? "block" : "clock"}>{f.message}</Banner>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Facility identifiers" note="What the facility is regulated under. Leave a field blank to keep it.">
        <form action={identifiersAction} className="bg-white border border-line rounded px-4 py-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-xs text-muted">
            SHA provider code
            <input
              name="sha"
              defaultValue={facility.sha_provider_code ?? ""}
              placeholder="Every claim is submitted under it"
              className="block w-full border border-line rounded px-2 py-1.5 text-sm bg-white mt-0.5"
            />
          </label>
          <label className="text-xs text-muted">
            KRA PIN
            <input
              name="kra"
              defaultValue={facility.kra_pin ?? ""}
              placeholder="P051234567X"
              className="block w-full border border-line rounded px-2 py-1.5 text-sm font-mono bg-white mt-0.5"
            />
          </label>
          <label className="text-xs text-muted">
            County
            <input
              name="county"
              defaultValue={facility.county}
              className="block w-full border border-line rounded px-2 py-1.5 text-sm bg-white mt-0.5"
            />
          </label>
          <label className="text-xs text-muted">
            ODPC registration
            <input
              name="odpc"
              defaultValue={facility.odpc_registration ?? ""}
              placeholder="Data controller registration"
              className="block w-full border border-line rounded px-2 py-1.5 text-sm bg-white mt-0.5"
            />
          </label>
          <label className="text-xs text-muted">
            ODPC expires
            <input
              name="odpcExpires"
              type="date"
              defaultValue={facility.odpc_expires_on ?? ""}
              className="block w-full border border-line rounded px-2 py-1.5 text-sm tnum bg-white mt-0.5"
            />
          </label>
          <div className="flex items-end">
            <button type="submit" className="bg-brand text-white font-semibold rounded px-4 py-2 text-sm">
              Save
            </button>
          </div>
        </form>
      </Section>

      <Section
        title="Integrations"
        note="Every way out of the building. A simulated answer is never mistakable for a real one."
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm bg-white border border-line rounded">
            <thead>
              <tr className="text-xs text-muted text-left">
                <th className="px-3 py-2 font-medium">Endpoint</th>
                <th className="px-3 py-2 font-medium">Mode</th>
                <th className="px-3 py-2 font-medium">Last call</th>
                <th className="px-3 py-2 font-medium text-right">Failures 24h</th>
                <th className="px-3 py-2 font-medium text-right">Dead letters</th>
                <th className="px-3 py-2 font-medium">Switch</th>
              </tr>
            </thead>
            <tbody>
              {endpoints.map((e) => (
                <tr key={e.code} className="border-t border-line">
                  <td className="px-3 py-2">
                    <span className="font-medium">{e.name}</span>
                    <span className="font-mono text-xs text-muted ml-2">{e.code}</span>
                  </td>
                  <td className={`px-3 py-2 font-semibold ${modeTone[e.mode]}`}>
                    {e.mode === "demo" ? "demo — simulated" : e.mode}
                  </td>
                  <td className="px-3 py-2 tnum text-muted">
                    {e.lastCallAt ? (
                      <>
                        {e.lastCallAt.slice(0, 16).replace("T", " ")}{" "}
                        <span className={e.lastStatus === "ok" ? "text-good" : "text-block"}>
                          {e.lastStatus}
                        </span>
                      </>
                    ) : (
                      "never"
                    )}
                  </td>
                  <td className={`px-3 py-2 text-right tnum ${e.failures24h > 0 ? "text-clock" : ""}`}>
                    {e.failures24h}
                  </td>
                  <td className={`px-3 py-2 text-right tnum ${e.deadLetters > 0 ? "text-block" : ""}`}>
                    {e.deadLetters}
                  </td>
                  <td className="px-3 py-2">
                    <form action={endpointModeAction} className="flex gap-1">
                      <input type="hidden" name="code" value={e.code} />
                      <select
                        name="mode"
                        defaultValue={e.mode}
                        className="border border-line rounded px-2 py-1 text-xs bg-white"
                      >
                        <option value="demo">demo</option>
                        <option value="live">live</option>
                        <option value="disabled">disabled</option>
                      </select>
                      <button type="submit" className="border border-line rounded px-2 py-1 text-xs font-semibold">
                        Set
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted mt-2 leading-relaxed">
          Switching to live is refused while no live adapter is registered — the alternative is a facility
          believing it is claiming when it is not. Each endpoint&apos;s live adapter arrives with its
          integration specification.
        </p>

        {dead.length > 0 ? (
          <div className="mt-3">
            <h3 className="text-xs font-semibold tracking-[0.08em] uppercase text-muted">
              Failed every retry
            </h3>
            <ul className="mt-2 flex flex-col gap-2">
              {dead.map((d) => (
                <li key={d.id} className="bg-block-soft border border-block/25 rounded px-4 py-2.5 flex flex-wrap items-baseline gap-x-3">
                  <span className="font-mono text-xs font-bold">{d.endpoint}</span>
                  <span className="text-sm">{d.operation}</span>
                  <span className="text-xs text-block">{d.last_error}</span>
                  <span className="text-xs text-muted tnum ml-auto">
                    {d.attempts} attempts · {d.queued_at.slice(0, 16).replace("T", " ")}
                  </span>
                  <form action={resolveDeadLetterAction}>
                    <input type="hidden" name="id" value={d.id} />
                    <button type="submit" className="text-xs font-semibold border border-line bg-white rounded px-3 py-1">
                      Resolved
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {log.length > 0 ? (
          <details className="mt-3">
            <summary className="text-xs text-brand cursor-pointer">Recent calls out of the building</summary>
            <table className="w-full text-sm bg-white border border-line rounded mt-2">
              <tbody>
                {log.map((l) => (
                  <tr key={l.id} className="border-t border-line first:border-t-0">
                    <td className="px-3 py-1.5 tnum text-muted">{l.at.slice(0, 19).replace("T", " ")}</td>
                    <td className="px-3 py-1.5 font-mono text-xs">{l.endpoint}</td>
                    <td className="px-3 py-1.5">{l.operation}</td>
                    <td className={`px-3 py-1.5 text-xs ${modeTone[l.mode]}`}>{l.mode}</td>
                    <td className={`px-3 py-1.5 text-xs ${l.status === "ok" ? "text-good" : "text-block"}`}>
                      {l.status}
                      {l.error ? ` — ${l.error}` : ""}
                    </td>
                    <td className="px-3 py-1.5 text-right tnum text-muted">{l.duration_ms}ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        ) : null}
      </Section>

      <Section title="Staff" note="No shared logins. Every action is attributable to a person.">
        <div className="overflow-x-auto">
          <table className="w-full text-sm bg-white border border-line rounded">
            <thead>
              <tr className="text-xs text-muted text-left">
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Username</th>
                <th className="px-3 py-2 font-medium">Cadre</th>
                <th className="px-3 py-2 font-medium">Licence</th>
                <th className="px-3 py-2 font-medium text-right">Last signed in</th>
                <th className="px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => {
                const soon = expiring.find((e) => e.user_id === s.id);
                return (
                  <tr key={s.id} className={`border-t border-line ${s.active ? "" : "opacity-50"}`}>
                    <td className="px-3 py-2 font-medium">{s.name}</td>
                    <td className="px-3 py-2 font-mono text-xs">{s.username}</td>
                    <td className="px-3 py-2 text-muted">{(s.cadre_code ?? "—").replace(/_/g, " ")}</td>
                    <td className={`px-3 py-2 tnum text-xs ${soon ? "text-clock" : "text-muted"}`}>
                      {soon
                        ? `${soon.regulator} ${soon.licence_number} — ${
                            soon.days_left < 0 ? `expired ${Math.abs(soon.days_left)}d ago` : `${soon.days_left}d left`
                          }`
                        : ""}
                    </td>
                    <td className="px-3 py-2 text-right tnum text-muted text-xs">
                      {s.last_login_at ? s.last_login_at.slice(0, 16).replace("T", " ") : "never"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <form action={toggleUserAction} className="flex gap-1 justify-end">
                        <input type="hidden" name="userId" value={s.id} />
                        <input type="hidden" name="active" value={s.active ? "0" : "1"} />
                        <input type="hidden" name="reason" value={s.active ? "Deactivated by administrator" : ""} />
                        <button type="submit" className="text-xs font-semibold border border-line rounded px-2 py-1">
                          {s.active ? "Deactivate" : "Reactivate"}
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <form action={userAction} className="mt-3 bg-white border border-line rounded px-4 py-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <label className="text-xs text-muted">
            Name
            <input name="name" required className="block w-full border border-line rounded px-2 py-1.5 text-sm bg-white mt-0.5" />
          </label>
          <label className="text-xs text-muted">
            Username
            <input name="username" required className="block w-full border border-line rounded px-2 py-1.5 text-sm font-mono bg-white mt-0.5" />
          </label>
          <label className="text-xs text-muted">
            Temporary password
            <input name="password" required minLength={10} className="block w-full border border-line rounded px-2 py-1.5 text-sm bg-white mt-0.5" />
          </label>
          <label className="text-xs text-muted">
            Cadre
            <select name="cadre" className="block w-full border border-line rounded px-2 py-1.5 text-sm bg-white mt-0.5">
              {CADRES.map((c) => (
                <option key={c.code} value={c.code}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted">
            Role
            <select name="role" className="block w-full border border-line rounded px-2 py-1.5 text-sm bg-white mt-0.5">
              {ROLES.map((r) => (
                <option key={r.code} value={r.code}>{r.name}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted">
            Regulator
            <select name="regulator" className="block w-full border border-line rounded px-2 py-1.5 text-sm bg-white mt-0.5">
              {["KMPDC", "NCK", "COC", "PPB", "KMLTTB", "SRTB", "KNDI"].map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted">
            Licence number
            <input name="licence" className="block w-full border border-line rounded px-2 py-1.5 text-sm bg-white mt-0.5" />
          </label>
          <label className="text-xs text-muted">
            Licence expires
            <input name="licenceExpires" type="date" className="block w-full border border-line rounded px-2 py-1.5 text-sm tnum bg-white mt-0.5" />
          </label>
          <div className="flex items-end">
            <button type="submit" className="bg-brand text-white font-semibold rounded px-4 py-2 text-sm">
              Add the person
            </button>
          </div>
        </form>
      </Section>

      <Section title="Devices" note="Every identifier the system mints carries its device prefix.">
        <ul className="flex flex-col gap-2">
          {devices.map((d) => (
            <li
              key={d.code}
              className={`bg-white border border-line rounded px-4 py-2.5 flex flex-wrap items-baseline gap-x-3 ${
                d.revoked_at ? "opacity-50" : ""
              }`}
            >
              <span className="font-mono text-sm font-bold">{d.code}</span>
              <span className="text-sm">{d.label}</span>
              <span className="text-xs text-muted tnum ml-auto">
                {d.revoked_at ? `revoked ${d.revoked_at.slice(0, 10)}` : `registered ${d.created_at.slice(0, 10)}`}
              </span>
              {!d.revoked_at ? (
                <form action={revokeDeviceAction} className="flex gap-1">
                  <input type="hidden" name="code" value={d.code} />
                  <input
                    name="reason"
                    required
                    placeholder="Revoke — why?"
                    className="w-36 border border-line rounded px-2 py-1 text-xs bg-white"
                  />
                  <button type="submit" className="text-xs font-semibold border border-line rounded px-2 py-1">
                    Revoke
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>

        <form action={deviceAction} className="mt-3 bg-white border border-line rounded px-4 py-3 flex flex-wrap items-end gap-2">
          <label className="text-xs text-muted">
            Code
            <input
              name="code"
              required
              maxLength={4}
              placeholder="REC2"
              className="block w-24 border border-line rounded px-2 py-1.5 text-sm font-mono uppercase bg-white"
            />
          </label>
          <label className="text-xs text-muted flex-1 min-w-[12rem]">
            Where it is
            <input name="label" required className="block w-full border border-line rounded px-2 py-1.5 text-sm bg-white" />
          </label>
          <button type="submit" className="bg-brand text-white font-semibold rounded px-4 py-2 text-sm">
            Register
          </button>
        </form>
      </Section>

      <Section title="Tariff" note="Every price records where it came from and when it takes effect.">
        <form action={tariffAction} className="bg-white border border-line rounded px-4 py-3 flex flex-wrap items-end gap-2">
          <label className="text-xs text-muted">
            Payer
            <select name="payerCode" className="block border border-line rounded px-2 py-1.5 text-sm bg-white">
              {payers.map((p) => (
                <option key={p.code} value={p.code}>{p.name}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted">
            Service code
            <input
              name="serviceCode"
              required
              placeholder="CONSULT-OP"
              className="block w-40 border border-line rounded px-2 py-1.5 text-sm font-mono uppercase bg-white"
            />
          </label>
          <label className="text-xs text-muted">
            Price (KES)
            <input
              name="price"
              type="number"
              step="0.01"
              required
              className="block w-28 border border-line rounded px-2 py-1.5 text-sm tnum bg-white"
            />
          </label>
          <label className="text-xs text-muted">
            From
            <input name="from" type="date" className="block border border-line rounded px-2 py-1.5 text-sm tnum bg-white" />
          </label>
          <label className="text-xs text-muted flex-1 min-w-[14rem]">
            Source
            <input
              name="source"
              required
              placeholder="SHA tariff schedule 2026/28"
              className="block w-full border border-line rounded px-2 py-1.5 text-sm bg-white"
            />
          </label>
          <button type="submit" className="bg-brand text-white font-semibold rounded px-4 py-2 text-sm">
            Set
          </button>
        </form>
        {catalogue.starterOnly ? (
          <div className="mt-3">
            <Banner tone="clock">
              Only {catalogue.total} ICD-11 codes are loaded. Load the full WHO release before go-live — a
              clinician who cannot find their diagnosis picks something close, and wrong codes are a named
              rejection cause.
            </Banner>
          </div>
        ) : null}
      </Section>
    </Shell>
  );
}
