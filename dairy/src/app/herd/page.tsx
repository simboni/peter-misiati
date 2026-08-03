import { verifySession } from "@/lib/dal";
import { listHerd } from "@/server/herd";
import { PageTitle, Card, Chip, EmptyState, TextInput, Select, Num } from "@/components/ui";
import { CLASS_LABEL } from "@/lib/domain/animal";
import { ANIMAL_CLASSES, type AnimalClass } from "@/db/schema";
import { today } from "@/lib/domain/dates";

export const dynamic = "force-dynamic";

/**
 * The herd list.
 *
 * Filtering and search are a plain GET form on purpose: it works with the radio
 * off, survives a reload mid-milking, and leaves a shareable URL. There is no
 * client JavaScript on this screen at all.
 */
export default async function HerdPage({
  searchParams,
}: {
  // Next 16: searchParams is always a Promise.
  searchParams: Promise<{ q?: string; cls?: string; gone?: string }>;
}) {
  const session = await verifySession();
  const sp = await searchParams;

  const cls = ANIMAL_CLASSES.includes(sp.cls as AnimalClass) ? (sp.cls as AnimalClass) : null;
  const includeExited = sp.gone === "1";
  const asOf = today();

  const list = await listHerd(session, { asOf, cls, search: sp.q ?? null, includeExited });

  const presentClasses = ANIMAL_CLASSES.filter((c) => (list.countsByClass[c] ?? 0) > 0);

  return (
    <main className="mx-auto max-w-3xl p-4 pb-24">
      <PageTitle sub={`${list.total} animals · ${list.milkingCount} milking today`}>
        The herd
      </PageTitle>

      <form method="get" className="mb-4 space-y-3">
        <div className="flex gap-2">
          <TextInput
            name="q"
            defaultValue={sp.q ?? ""}
            placeholder="Name or tag"
            aria-label="Search by name or tag"
            autoComplete="off"
          />
          <button
            type="submit"
            className="shrink-0 rounded-md border border-line bg-surface px-4 text-base font-semibold"
          >
            <span aria-hidden>🔍</span>
            <span className="sr-only">Search</span>
          </button>
        </div>

        <div className="flex gap-2">
          <Select name="cls" defaultValue={cls ?? ""} aria-label="Filter by stage">
            <option value="">Every stage</option>
            {presentClasses.map((c) => (
              <option key={c} value={c}>
                {CLASS_LABEL[c]} ({list.countsByClass[c]})
              </option>
            ))}
          </Select>
          <label className="flex shrink-0 items-center gap-2 rounded-md border border-line bg-surface px-3 text-sm">
            <input type="checkbox" name="gone" value="1" defaultChecked={includeExited} className="h-5 w-5" />
            Left the herd
          </label>
        </div>

        <noscript>
          <button type="submit" className="rounded-md border border-line px-4 py-2 text-sm">
            Apply
          </button>
        </noscript>
      </form>

      <div className="mb-4 flex flex-wrap gap-2">
        <a
          href="/herd/new"
          className="tap inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white"
        >
          <span aria-hidden>➕</span> Add an animal
        </a>
        <a
          href="/breeding"
          className="tap inline-flex items-center gap-2 rounded-md border border-line bg-surface px-4 py-2 text-sm font-semibold"
        >
          <span aria-hidden>📅</span> Breeding board
        </a>
      </div>

      {list.rows.length === 0 ? (
        <EmptyState
          title={sp.q || cls ? "Nothing matches that." : "No animals yet."}
          hint={sp.q || cls ? "Try a different name, tag or stage." : "Add your first animal to begin."}
        />
      ) : (
        <ul className="space-y-2">
          {list.rows.map((r) => (
            <li key={r.id}>
              <a href={`/herd/${r.id}`} className="tap block">
                <Card className="hover:border-brand">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-lg font-semibold">
                        {r.name ?? r.tag}
                        {r.name ? <span className="ml-2 text-sm font-normal text-ink-3">{r.tag}</span> : null}
                      </p>
                      <p className="mt-1 text-sm text-ink-2">
                        {r.classLabel}
                        {r.classIsOverridden ? " (set by hand)" : ""}
                        {r.ageMonths != null ? ` · ${r.ageMonths} months` : ""}
                        {r.primaryBreed ? ` · ${r.primaryBreed.toLowerCase()}` : ""}
                      </p>
                      <p className="mt-1 text-sm text-ink-3">
                        {r.daysInMilk != null ? (
                          <>
                            <Num>{r.daysInMilk}</Num> days in milk
                          </>
                        ) : null}
                        {r.expectedCalvingOn ? ` · calving ${r.expectedCalvingOn}` : ""}
                        {r.latestWeightKg != null ? ` · ${r.latestWeightKg} kg` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <StatusChip status={r.reproStatus} exited={r.exited} />
                      {r.milking ? <Chip tone="brand">Milking</Chip> : null}
                    </div>
                  </div>
                </Card>
              </a>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

/** Colour and word both carry the meaning, so the row reads without the text (R9). */
function StatusChip({ status, exited }: { status: string; exited: boolean }) {
  if (exited) return <Chip tone="danger">Left the herd</Chip>;
  switch (status) {
    case "PREGNANT":
      return <Chip tone="ok">In calf</Chip>;
    case "SERVED":
      return <Chip tone="warn">Served</Chip>;
    case "DRY":
      return <Chip tone="neutral">Dry</Chip>;
    case "FRESH":
      return <Chip tone="brand">Just calved</Chip>;
    default:
      return <Chip tone="neutral">Open</Chip>;
  }
}
