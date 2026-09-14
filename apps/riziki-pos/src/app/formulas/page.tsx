import Link from "next/link";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { currentUser, requireOwner } from "@/lib/auth";
import { listFormulas, setFormulaHidden } from "@/lib/production";
import { formatQty } from "@/lib/units";
import { PageTitle, Chip, Empty, inputClass, Button, Alert, TableWrap, Th, Td } from "@/components/ui";
import { NewBanner, Pager } from "@/components/section-nav";

export const dynamic = "force-dynamic";

/** Recipes are read one at a time; twenty is more than anybody scans past. */
const PER_PAGE = 20;

/**
 * Take a recipe off the counter, or put it back.
 *
 * Owner only, like everything on this screen: the gate is on the server, not on
 * whether the button was drawn.
 */
async function toggleHidden(formData: FormData) {
  "use server";

  const owner = await requireOwner();
  setFormulaHidden(Number(formData.get("formulaId")), formData.get("hide") === "1", owner.id);
  refresh();
}

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

      {/*
        What hiding does, said once where the switch is.

        Without this the word is ambiguous — hidden from whom? — and an owner
        who read it as "deleted" would never use it.
      */}
      <p className="mb-3 max-w-2xl text-sm text-muted">
        A hidden recipe stays here and on the mixing board; it is only taken off the counter, so
        nobody can sell it by tapping it and no customer sees it named on a screen.
      </p>

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
              <Th align="right">At the counter</Th>
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
                <Td align="right">{formatQty(f.ref_size_milli, f.ref_unit)}</Td>
                <Td align="right">{f.ingredient_count}</Td>
                <Td align="right" className="text-muted">
                  v{f.version}
                </Td>
                <Td>
                  {f.note.trim() ? <Chip tone="warn">Check this</Chip> : <Chip tone="good">Confirmed</Chip>}
                </Td>
                {/*
                  Hidden, and the way back.

                  One cell doing both jobs: it says where the recipe stands and
                  the button changes it, so there is nothing to go and find. A
                  recipe mixed in advance is never offered at the counter
                  anyway — it is sold as the product it makes — and saying so
                  is better than a switch that would appear to do nothing.
                */}
                <Td align="right">
                  {f.output_item_id !== null ? (
                    <span className="text-[11px] text-muted">mixed in advance</span>
                  ) : (
                    <form action={toggleHidden} className="flex items-center justify-end gap-2">
                      <input type="hidden" name="formulaId" value={f.id} />
                      <input type="hidden" name="hide" value={f.hidden ? "0" : "1"} />
                      {f.hidden ? <Chip tone="neutral">Hidden</Chip> : null}
                      <Button type="submit" variant="ghost">
                        {f.hidden ? "Show it" : "Hide it"}
                      </Button>
                    </form>
                  )}
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
