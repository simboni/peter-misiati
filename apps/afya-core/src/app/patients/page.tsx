import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth.ts";
import { can } from "@/lib/access.ts";
import { searchPatients } from "@/lib/patients.ts";
import { Shell } from "@/app/_components/shell.tsx";

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
  //
  // This uses `searchPatients`, not the duplicate matcher: a receptionist typing
  // a name is looking for that person, not for possible duplicates, and the
  // duplicate rules deliberately refuse a name-only match.
  const results = q ? searchPatients({ facilityId: user.facilityId, query: q }) : [];

  return (
    <Shell
      user={user}
      current="/patients"
      title="Find a patient"
      subtitle="Name, file number, national ID, SHA number or telephone."
      actions={
        can(user.userId, "patient.register") ? (
          <Link href="/patients/new" className="bg-brand text-white text-sm font-semibold rounded px-4 py-2">
            Register new
          </Link>
        ) : null
      }
    >

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
            {results.map((p) => (
              <li key={p.mrn}>
                <Link
                  href={`/patients/${encodeURIComponent(p.mrn)}`}
                  className="block bg-white border border-line rounded px-4 py-3 hover:border-brand"
                >
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-semibold">
                      {p.given_name} {p.family_name}
                    </span>
                    <span className="text-xs text-muted tnum ml-auto">{p.mrn}</span>
                  </div>
                  <div className="text-sm text-muted mt-1 tnum">
                    {[
                      p.sex,
                      p.date_of_birth ? `b. ${p.date_of_birth}${p.dob_estimated ? " (est.)" : ""}` : null,
                      p.phone,
                      p.national_id ? `ID ${p.national_id}` : null,
                      p.village || p.county,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
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
    </Shell>
  );
}
