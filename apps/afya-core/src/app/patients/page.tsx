import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth.ts";
import { can } from "@/lib/access.ts";
import { findCandidates } from "@/lib/patients.ts";

/**
 * Patient search.
 *
 * Shows why each result matched. A person choosing between two records needs the
 * reason, not a number — "same phone number" is actionable, "82%" is not.
 *
 * Next.js 16: searchParams is a Promise.
 */
export default async function PatientsPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const params = await props.searchParams;
  const q = typeof params.q === "string" ? params.q.trim() : "";

  // One box, because reception types whatever the patient says: a name, a phone
  // number or an ID. Splitting it into five fields is how a queue backs up.
  const looksNumeric = /^[\d+\s-]+$/.test(q) && q.replace(/\D/g, "").length >= 7;
  const [givenName, familyName] = looksNumeric ? ["", ""] : q.split(/\s+/);

  const results = q
    ? findCandidates({
        facilityId: user.facilityId,
        nationalId: looksNumeric ? q : null,
        shaNumber: looksNumeric ? q : null,
        phone: looksNumeric ? q : null,
        givenName: givenName || undefined,
        familyName: familyName || givenName || undefined,
      })
    : [];

  return (
    <main className="max-w-3xl mx-auto px-5 py-8">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <Link href="/" className="text-xs text-brand underline underline-offset-2">← Dashboard</Link>
          <h1 className="text-2xl font-bold tracking-tight mt-2">Find a patient</h1>
        </div>
        {can(user.userId, "patient.register") ? (
          <Link href="/patients/new" className="bg-brand text-white text-sm font-semibold rounded px-4 py-2.5">
            Register new
          </Link>
        ) : null}
      </div>

      <form className="mt-5 flex gap-2">
        <input
          id="q"
          name="q"
          defaultValue={q}
          placeholder="Name, phone number, national ID or SHA number"
          className="flex-1 border border-line rounded px-3 py-2.5 bg-white"
        />
        <button type="submit" className="border border-brand text-brand font-semibold rounded px-4 py-2.5">
          Search
        </button>
      </form>

      {q ? (
        results.length === 0 ? (
          <p className="mt-6 text-sm text-muted">
            Nothing matches “{q}”.{" "}
            {can(user.userId, "patient.register") ? (
              <Link href="/patients/new" className="text-brand underline underline-offset-2">Register a new patient</Link>
            ) : null}
          </p>
        ) : (
          <ul className="mt-6 flex flex-col gap-2">
            {results.map((c) => (
              <li key={c.patient.mrn}>
                <Link
                  href={`/patients/${encodeURIComponent(c.patient.mrn)}`}
                  className="block bg-white border border-line rounded px-4 py-3 hover:border-brand"
                >
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-semibold">
                      {c.patient.given_name} {c.patient.family_name}
                    </span>
                    <span className="text-xs text-muted tnum">{c.patient.mrn}</span>
                    <span
                      className={`ml-auto text-xs font-semibold tnum px-2 py-0.5 rounded ${
                        c.definite ? "bg-good-soft text-good" : "bg-brand-soft text-brand"
                      }`}
                    >
                      {c.definite ? "Exact" : `${c.score}%`}
                    </span>
                  </div>
                  <div className="text-sm text-muted mt-1 tnum">
                    {[
                      c.patient.sex,
                      c.patient.date_of_birth
                        ? `b. ${c.patient.date_of_birth}${c.patient.dob_estimated ? " (est.)" : ""}`
                        : null,
                      c.patient.phone,
                      c.patient.village || c.patient.county,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                  <div className="text-xs text-muted mt-1">{c.reasons.join(", ")}</div>
                </Link>
              </li>
            ))}
          </ul>
        )
      ) : (
        <p className="mt-6 text-sm text-muted leading-relaxed">
          Search before registering. A patient with two records has their visit history split in half, and a
          payer sees two different people.
        </p>
      )}
    </main>
  );
}
