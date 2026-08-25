import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, requireOwner } from "@/lib/auth";
import { listFormulas } from "@/lib/production";
import { formatQty } from "@/lib/units";
import { PageTitle, Card, Chip, Empty, inputClass, Button, Alert } from "@/components/ui";
import { NewBanner } from "@/components/wholesale-nav";

export const dynamic = "force-dynamic";

export default async function FormulasPage(props: {
  searchParams: Promise<{ q?: string }>;
}) {
  // `searchParams` is a Promise in Next.js 16 — synchronous access was removed.
  const { q } = await props.searchParams;

  // The gate runs BEFORE anything is queried. The formulas are the business:
  // if a staff session ever reached the query, the recipe would already be in
  // the response no matter what the markup below decided to show.
  try {
    await requireOwner();
  } catch {
    if (!(await currentUser())) redirect("/login");
    return (
      <div>
        <PageTitle title="Recipes" />
        <Alert tone="bad">
          The recipes are the owner&rsquo;s. Ask the owner to sign in on this phone.
        </Alert>
        <p className="mt-3 text-sm text-muted">
          Selling a recipe at the counter does not need this screen — and does not show it.
        </p>
      </div>
    );
  }

  const term = (q ?? "").trim();
  const formulas = listFormulas(term);
  const unresolved = formulas.filter((f) => f.note.trim().length > 0).length;

  return (
    // No width cap: the body of this screen is a grid of cards, not prose, so
    // a wider screen should mean more formulas at once rather than more margin.
    <div>
      <PageTitle
        title="Formulas"
        subtitle="Owner only. Every edit is saved as a new version, never over the old one."
      />

      {/* The way in to a recipe the shop does not have yet. Large and first,
          because the book was read-only until now and nobody will go looking
          for a button they have never had. */}
      <NewBanner
        href="/formulas/new"
        title="New recipe"
        blurb="Name it, list what goes in, and the counter can sell it."
        cta="Start"
      />

      {/* The search box is the one thing here that is read at reading width. */}
      <form method="get" className="mb-2.5 flex max-w-xl gap-2">
        <input
          className={inputClass}
          type="search"
          name="q"
          defaultValue={term}
          placeholder="Product or ingredient — try “magadi”"
          aria-label="Search formulas by product or ingredient"
        />
        <Button type="submit">Search</Button>
      </form>

      {term ? (
        <p className="mb-2.5 text-sm text-muted">
          {formulas.length} {formulas.length === 1 ? "formula" : "formulas"} matching{" "}
          <span className="font-bold text-ink">{term}</span>.{" "}
          <Link href="/formulas" className="font-bold text-brand">
            Clear
          </Link>
        </p>
      ) : unresolved > 0 ? (
        <div className="mb-2.5">
          <Alert tone="warn">
            {unresolved} {unresolved === 1 ? "formula has" : "formulas have"} an open question from
            the transcribed sheets. Settle these before the next mix.
          </Alert>
        </div>
      ) : null}

      {formulas.length === 0 ? (
        <Empty>
          {term ? "No formula uses that name or ingredient." : "No recipes yet — add the first one above."}
        </Empty>
      ) : (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 3xl:grid-cols-5">
          {formulas.map((f) => (
            <Link key={f.id} href={`/formulas/${f.id}`} className="block">
              <Card className="hover:bg-wash">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold">{f.name}</div>
                    <div className="mt-0.5 text-xs text-muted">
                      {f.ingredient_count} ingredients per{" "}
                      {formatQty(f.ref_size_milli, "L")} · version {f.version}
                    </div>
                  </div>
                  {f.note.trim() ? <Chip tone="warn">Check this</Chip> : <Chip tone="good">Confirmed</Chip>}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
