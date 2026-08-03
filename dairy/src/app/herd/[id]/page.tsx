import { notFound } from "next/navigation";
import { verifySession } from "@/lib/dal";
import { getAnimal, recordWeight, recordExit } from "@/server/herd";
import { PageTitle, Card, Chip, EmptyState, SoftWarning } from "@/components/ui";
import { WeightForm } from "@/components/herd/weight-form";
import { ExitForm } from "@/components/herd/exit-form";
import { WeightHistory } from "@/components/herd/weight-history";
import { today } from "@/lib/domain/dates";
import { num } from "@/lib/money";

export const dynamic = "force-dynamic";

/**
 * The digital cow card.
 *
 * One page per animal: who she is, what she has done, what she is owed. This is
 * the screen the animal passport PDF is printed from, and the reason a farm
 * bothers keeping the register clean at all.
 */
export default async function AnimalPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await verifySession();
  const { id } = await params; // Next 16: params is always a Promise.
  const card = await getAnimal(session, id);
  if (!card) notFound();

  const a = card.animal;
  const who = a.name ?? a.tag;
  const asOf = today();

  return (
    <main className="mx-auto max-w-3xl p-4 pb-24">
      <a href="/herd" className="mb-3 inline-block text-sm text-ink-2">
        <span aria-hidden>←</span> The herd
      </a>

      {/* ---------- Header ---------- */}
      <PageTitle
        sub={
          <>
            {a.name ? `${a.tag} · ` : ""}
            {card.classLabel}
            {card.ageMonths != null ? ` · ${card.ageMonths} months` : ""}
            {a.breedComposition ? ` · ${a.breedComposition}` : a.primaryBreed ? ` · ${a.primaryBreed.toLowerCase()}` : ""}
          </>
        }
      >
        {who}
      </PageTitle>

      {card.exit ? (
        <div className="mb-4">
          <SoftWarning
            message={`${who} left the herd on ${card.exit.exitDate} — ${card.exit.reason.toLowerCase()}.`}
          />
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-2">
        <StatusChip status={card.reproStatus} />
        {card.daysInMilk != null ? <Chip tone="brand">{card.daysInMilk} days in milk</Chip> : null}
        <Chip tone="neutral">{card.facts.parity === 0 ? "Never calved" : `${card.facts.parity} calvings`}</Chip>
        {a.classOverride ? <Chip tone="warn">Stage set by hand</Chip> : null}
        {a.dobEstimated ? <Chip tone="neutral">Age estimated</Chip> : null}
      </div>

      {/* ---------- What needs doing ---------- */}
      {card.openAlerts.length > 0 ? (
        <Card className="mb-4">
          <h2 className="text-lg font-semibold">What she needs</h2>
          <ul className="mt-3 space-y-2">
            {card.openAlerts.slice(0, 8).map((al) => (
              <li key={al.id} className="flex gap-3 text-sm">
                <span aria-hidden>
                  {al.severity === "CRITICAL" ? "🔴" : al.severity === "WARN" ? "🟠" : "🟢"}
                </span>
                <span className="min-w-0">
                  <span className="tabular-nums text-ink-3">{al.dueOn}</span> — {al.action}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* ---------- Parentage and offspring ---------- */}
      <Card className="mb-4">
        <h2 className="text-lg font-semibold">Family</h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-ink-3">Mother</dt>
            <dd>
              {card.dam ? (
                <a className="underline" href={`/herd/${card.dam.id}`}>
                  {card.dam.name ?? card.dam.tag}
                </a>
              ) : (
                "Not recorded"
              )}
            </dd>
          </div>
          <div>
            <dt className="text-ink-3">Father</dt>
            <dd>
              {card.sire ? (
                <a className="underline" href={`/herd/${card.sire.id}`}>
                  {card.sire.name ?? card.sire.tag}
                </a>
              ) : (
                a.sireStrawCode ?? "Not recorded"
              )}
            </dd>
          </div>
          <div>
            <dt className="text-ink-3">Born</dt>
            <dd>{a.dateOfBirth ?? "Not recorded"}</dd>
          </div>
          <div>
            <dt className="text-ink-3">Joined the herd</dt>
            <dd>
              {a.enteredHerdOn} · {a.origin.toLowerCase()}
            </dd>
          </div>
        </dl>

        {card.offspring.length > 0 ? (
          <>
            <h3 className="mt-4 text-sm font-semibold">Her calves</h3>
            <ul className="mt-2 flex flex-wrap gap-2">
              {card.offspring.map((o) => (
                <li key={o.id}>
                  <a href={`/herd/${o.id}`} className="tap inline-flex rounded border border-line px-3 py-1 text-sm">
                    {o.name ?? o.tag}
                    <span className="ml-2 text-ink-3">{o.dateOfBirth}</span>
                  </a>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </Card>

      {/* ---------- Her first year ---------- */}
      {card.schedule.length > 0 ? (
        <Card className="mb-4">
          <h2 className="text-lg font-semibold">Her first year</h2>
          <ol className="mt-3 space-y-2 text-sm">
            {card.schedule.map((i) => (
              <li key={i.routine} className="flex gap-3">
                <span aria-hidden>
                  {i.severity === "CRITICAL" ? "🔴" : i.severity === "WARN" ? "🟠" : "🟢"}
                </span>
                <span>
                  <span className="tabular-nums text-ink-3">{i.dueOn}</span> — {i.label}
                  {i.windowClosesOn ? (
                    <span className="text-ink-3"> (window closes {i.windowClosesOn})</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        </Card>
      ) : null}

      {/* ---------- Lactations ---------- */}
      <Card className="mb-4">
        <h2 className="text-lg font-semibold">Lactations</h2>
        {card.lactations.length === 0 ? (
          <p className="mt-2 text-sm text-ink-3">She has not calved yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="text-left text-ink-3">
                <tr>
                  <th className="pb-2 font-medium">#</th>
                  <th className="pb-2 font-medium">Calved</th>
                  <th className="pb-2 font-medium">Length</th>
                  <th className="pb-2 font-medium">Litres</th>
                  <th className="pb-2 font-medium">Peak</th>
                  <th className="pb-2 font-medium">Interval</th>
                  <th className="pb-2 font-medium">Services</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {card.lactations.map((l) => (
                  <tr key={l.number} className="border-t border-line">
                    <td className="py-2">{l.number}</td>
                    <td className="py-2">{l.calvedOn}</td>
                    <td className="py-2">
                      {l.ongoing ? `${l.daysSoFar} d so far` : `${l.lengthDays} d`}
                    </td>
                    <td className="py-2">{l.recordedDays ? l.totalLitres.toFixed(1) : "—"}</td>
                    <td className="py-2">{l.peakDailyLitres ? l.peakDailyLitres.toFixed(1) : "—"}</td>
                    <td className="py-2">
                      {l.calvingIntervalDays != null ? (
                        <span className={l.calvingIntervalDays > 400 ? "text-danger" : undefined}>
                          {l.calvingIntervalDays} d
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-2">{l.servicesToConceive ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ---------- Breeding history ---------- */}
      <Card className="mb-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Breeding</h2>
          <a
            href={`/breeding/service?animalId=${a.id}`}
            className="tap inline-flex rounded-md border border-line px-3 py-2 text-sm font-semibold"
          >
            Record a service
          </a>
        </div>

        {card.services.length === 0 && card.calvings.length === 0 ? (
          <p className="mt-2 text-sm text-ink-3">Nothing recorded yet.</p>
        ) : (
          <ul className="mt-3 space-y-3 text-sm">
            {[...card.calvings].reverse().map((c) => (
              <li key={c.id} className="border-t border-line pt-3 first:border-0 first:pt-0">
                <p className="font-medium">
                  <span aria-hidden className="mr-2">
                    🐄
                  </span>
                  Calved {c.calvedOn}
                </p>
                <p className="text-ink-2">
                  {c.outcomes.map((o) => outcomeWord(o.outcome, o.calfSex)).join(", ") || "Outcome not recorded"}
                  {c.calvingEase ? ` · ease ${c.calvingEase} of 5` : ""}
                  {c.retainedPlacenta ? " · retained placenta" : ""}
                  {c.milkFever ? " · milk fever" : ""}
                </p>
              </li>
            ))}
            {[...card.services].reverse().map((r) => (
              <li key={r.id} className="border-t border-line pt-3">
                <p className="font-medium">
                  <span aria-hidden className="mr-2">
                    💉
                  </span>
                  Served {r.servedOn} · {r.serviceType}
                  {r.strawCode ? ` · straw ${r.strawCode}` : ""}
                </p>
                <p className="text-ink-2">
                  {r.expectedCalvingOn ? `Calving expected ${r.expectedCalvingOn}. ` : ""}
                  {r.returnInterpretationDays != null
                    ? `${r.returnInterpretationDays} days after the service before it.`
                    : ""}
                </p>
              </li>
            ))}
            {[...card.pregnancyChecks].reverse().map((p) => (
              <li key={p.id} className="border-t border-line pt-3">
                <p className="font-medium">
                  <span aria-hidden className="mr-2">
                    🩺
                  </span>
                  Checked {p.checkedOn} —{" "}
                  {p.result === "POSITIVE" ? "in calf" : p.result === "NEGATIVE" ? "not in calf" : "not clear"}
                </p>
              </li>
            ))}
            {[...card.dryOffs].reverse().map((d) => (
              <li key={d.id} className="border-t border-line pt-3">
                <p className="font-medium">
                  <span aria-hidden className="mr-2">
                    🌾
                  </span>
                  Dried off {d.driedOn}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ---------- Health ---------- */}
      <Card className="mb-4">
        <h2 className="text-lg font-semibold">Health</h2>
        {card.healthEvents.length === 0 ? (
          <p className="mt-2 text-sm text-ink-3">Nothing recorded yet.</p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {card.healthEvents.slice(0, 12).map((h) => (
              <li key={h.id} className="border-t border-line pt-2 first:border-0 first:pt-0">
                <span className="tabular-nums text-ink-3">{h.occurredOn}</span> —{" "}
                {h.diagnosis ?? h.signs ?? h.eventType.toLowerCase().replace(/_/g, " ")}
                {h.milkClearAt ? (
                  <span className="ml-2 font-medium text-danger">
                    milk withheld to {String(h.milkClearAt).slice(0, 10)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ---------- Weights and body condition ---------- */}
      <Card className="mb-4">
        <h2 className="text-lg font-semibold">Weight and condition</h2>
        {card.weights.length === 0 ? (
          <EmptyState title="Never weighed." hint="A tape round the heart girth is enough." />
        ) : (
          <WeightHistory
            rows={card.weights.map((w) => ({
              observedOn: w.observedOn,
              weightKg: w.weightKg != null ? num(w.weightKg) : null,
              bcs: w.bcs != null ? num(w.bcs) : null,
              method: w.method,
            }))}
          />
        )}

        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-semibold">Weigh her now</summary>
          <div className="mt-3">
            <WeightForm
              action={recordWeight}
              animalId={a.id}
              animalName={who}
              today={asOf}
              lastWeightKg={
                card.weights.length ? num(card.weights[card.weights.length - 1].weightKg) : null
              }
              lastWeightOn={card.weights.length ? card.weights[card.weights.length - 1].observedOn : null}
            />
          </div>
        </details>
      </Card>

      {/* ---------- Leaving the herd ---------- */}
      {!card.exit ? (
        <Card>
          <details>
            <summary className="cursor-pointer text-sm font-semibold text-ink-2">
              {who} has left the herd
            </summary>
            <div className="mt-3">
              <ExitForm action={recordExit} animalId={a.id} animalName={who} today={asOf} />
            </div>
          </details>
        </Card>
      ) : null}

      <p className="mt-6 text-center text-xs text-ink-3">
        Everything above is worked out from her records. Nothing here is typed in by hand.
      </p>
    </main>
  );
}

function outcomeWord(outcome: string, sex: "F" | "M" | null): string {
  const which = sex === "M" ? "bull calf" : sex === "F" ? "heifer calf" : "calf";
  switch (outcome) {
    case "LIVE":
      return `live ${which}`;
    case "STILLBIRTH":
      return `stillborn ${which}`;
    case "DIED_UNDER_24H":
      return `${which} died within a day`;
    case "ABORTION":
      return "aborted";
    default:
      return outcome.toLowerCase();
  }
}

function StatusChip({ status }: { status: string }) {
  switch (status) {
    case "PREGNANT":
      return <Chip tone="ok">In calf</Chip>;
    case "SERVED":
      return <Chip tone="warn">Served, waiting</Chip>;
    case "DRY":
      return <Chip tone="neutral">Dry</Chip>;
    case "FRESH":
      return <Chip tone="brand">Just calved</Chip>;
    default:
      return <Chip tone="neutral">Open</Chip>;
  }
}
