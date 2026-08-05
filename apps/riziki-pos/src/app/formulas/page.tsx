import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, requireOwner } from "@/lib/auth";
import { listFormulas } from "@/lib/production";
import { formatQty } from "@/lib/units";
import { PageTitle, Card, Chip, Empty, inputClass, Button, Alert } from "@/components/ui";

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
        <PageTitle title="Formulas" />
        <Alert tone="bad">
          The recipes are the owner&rsquo;s. Ask the owner to sign in on this phone.
        </Alert>
        <p className="mt-3 text-sm text-muted">
          You can still mix from a formula without seeing it — open{" "}
          <Link href="/batch" className="font-bold text-brand">
            Batch
          </Link>{" "}
          and pick the product.
        </p>
      </div>
    );
  }

  const term = (q ?? "").trim();
  const formulas = listFormulas(term);
  const unresolved = formulas.filter((f) => f.note.trim().length > 0).length;

  return (
    <div className="lg:max-w-4xl">
      <PageTitle
        title="Formulas"
        subtitle="Owner only. Every edit is saved as a new version, never over the old one."
      />

      <form method="get" className="mb-3 flex gap-2">
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
        <p className="mb-3 text-sm text-muted">
          {formulas.length} {formulas.length === 1 ? "formula" : "formulas"} matching{" "}
          <span className="font-bold text-ink">{term}</span>.{" "}
          <Link href="/formulas" className="font-bold text-brand">
            Clear
          </Link>
        </p>
      ) : unresolved > 0 ? (
        <div className="mb-3">
          <Alert tone="warn">
            {unresolved} {unresolved === 1 ? "formula has" : "formulas have"} an open question from
            the transcribed sheets. Settle these before the next mix.
          </Alert>
        </div>
      ) : null}

      {formulas.length === 0 ? (
        <Empty>No formula uses that name or ingredient.</Empty>
      ) : (
        <div className="space-y-2">
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
