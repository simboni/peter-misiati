import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, requireOwner } from "@/lib/auth";
import { listFormulas } from "@/lib/production";
import { formatQty } from "@/lib/units";
import { PageTitle, Card, Chip, Empty, inputClass, Button, Alert, TableWrap, Th, Td } from "@/components/ui";
import { NewBanner, Pager } from "@/components/section-nav";

export const dynamic = "force-dynamic";

/** Recipes are read one at a time; twenty is more than anybody scans past. */
const PER_PAGE = 20;

export default async function FormulasPage(props: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  // `searchParams` is a Promise in Next.js 16 — synchronous access was removed.
  const { q, page: pageParam } = await props.searchParams;

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
          The recipes are the owner’s. Ask the owner to sign in on this phone.
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

  const page = Math.max(1, Number(pageParam) || 1);
  const pages = Math.max(1, Math.ceil(formulas.length / PER_PAGE));
  const current = Math.min(page, pages);
  const shown = formulas.slice((current - 1) * PER_PAGE, current * PER_PAGE);

  return (
    // No width cap: the body of this screen is a grid of cards, not prose, so
    // a wider screen should mean more formulas at once rather than more margin.
    <div>
      <PageTitle
        title="Recipes"
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
        /*
          A list, not tiles. The question asked here is "which recipe" — you run
          an eye down a column of names looking for one — and a grid of cards
          makes that a search of the whole screen instead of one line.
        */
        <TableWrap>
          <thead>
            <tr>
              <Th>Recipe</Th>
              <Th align="right">Makes</Th>
              <Th align="right">Ingredients</Th>
              <Th align="right">Version</Th>
              <Th>Standing</Th>
            </tr>
          </thead>
          <tbody>
            {shown.map((f) => (
              <tr key={f.id} className="hover:bg-wash/50">
                <Td>
                  <Link href={`/formulas/${f.id}`} className="font-bold text-ink">
                    {f.name}
                  </Link>
                </Td>
                <Td align="right">{formatQty(f.ref_size_milli, "L")}</Td>
                <Td align="right">{f.ingredient_count}</Td>
                <Td align="right" className="text-muted">
                  v{f.version}
                </Td>
                <Td>
                  {f.note.trim() ? <Chip tone="warn">Check this</Chip> : <Chip tone="good">Confirmed</Chip>}
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}

      <Pager
        action="/formulas"
        order="list"
        page={current}
        pages={pages}
        total={formulas.length}
        noun="recipe"
        params={term ? { q: term } : {}}
      />
    </div>
  );
}
