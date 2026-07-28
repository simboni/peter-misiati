import type { Metadata } from "next";
import { moneyTrail } from "@/lib/data";
import { SectionHead, SourceChips, StatusBadge } from "@/components/ui";

export const metadata: Metadata = {
  title: "Money Trail — Bumula NG-CDF",
  description:
    "Bumula Constituency's NG-CDF money, on a public ledger: allocations per financial year, spending priorities, audit posture and the open-books pledge.",
};

export default function MoneyPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-16">
      <SectionHead
        kicker="Money Trail"
        title="Public money, public ledger"
        lede={moneyTrail.explainer}
      />

      {/* ------------------------------------------------- allocations table */}
      <section className="mt-12">
        <h3 className="font-mono text-[11px] tracking-[0.2em] text-ink-600 uppercase">
          NG-CDF allocations to Bumula, by financial year
        </h3>
        <div className="mt-4 overflow-x-auto rounded-xl border border-paper-600 bg-paper-800">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-paper-600 font-mono text-[11px] tracking-wide text-ink-600 uppercase">
                <th className="px-5 py-3 font-medium">FY</th>
                <th className="px-5 py-3 font-medium">Allocation</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Note & source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-paper-600">
              {moneyTrail.allocations.map((a) => (
                <tr key={a.fy} className="align-top">
                  <td className="px-5 py-4 font-mono font-medium text-ink-200">{a.fy}</td>
                  <td
                    className={`px-5 py-4 font-mono ${
                      a.status === "pending" ? "text-ink-500 italic" : "font-medium text-green-600"
                    }`}
                  >
                    {a.amount}
                  </td>
                  <td className="px-5 py-4">
                    <StatusBadge status={a.status} />
                  </td>
                  <td className="max-w-md px-5 py-4">
                    <p className="text-ink-400">{a.note}</p>
                    <div className="mt-2">
                      <SourceChips sources={a.sources} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 font-mono text-[11px] text-ink-600">
          &ldquo;Awaiting official figure&rdquo; is deliberate: this ledger prints numbers only
          when they can be traced to an official schedule. No source, no figure.
        </p>
      </section>

      {/* ------------------------------------------------ spending priorities */}
      <section className="mt-16">
        <h3 className="font-mono text-[11px] tracking-[0.2em] text-ink-600 uppercase">
          Where the money goes
        </h3>
        <div className="mt-4 grid gap-5 lg:grid-cols-3">
          {moneyTrail.spendPriorities.map((p) => (
            <div key={p.area} className="rounded-lg border border-paper-600 bg-paper-800 p-6">
              <div className="flex items-start justify-between gap-3">
                <h4 className="font-display text-lg font-semibold text-ink-100">{p.area}</h4>
                <StatusBadge status={p.status} />
              </div>
              <p className="mt-2 text-sm leading-relaxed text-ink-400">{p.detail}</p>
              <div className="mt-3">
                <SourceChips sources={p.sources} />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* -------------------------------------------------------- audit note */}
      <section className="mt-16 rounded-xl border border-paper-600 bg-paper-850 p-8">
        <h3 className="font-display text-xl font-semibold text-ink-100">
          The auditors get the last word
        </h3>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-400">{moneyTrail.auditNote}</p>
      </section>

      {/* ------------------------------------------------- open-books pledge */}
      <section className="mt-16">
        <SectionHead
          kicker="Standing commitment"
          title="The open-books pledge"
          lede="Four commitments this record is held to — line-items, not adjectives."
        />
        <ol className="mt-8 grid gap-4 sm:grid-cols-2">
          {moneyTrail.openBooksPledge.map((p, i) => (
            <li
              key={i}
              className="flex items-start gap-4 rounded-lg border border-paper-600 bg-paper-800 p-5"
            >
              <span className="font-mono text-2xl font-medium text-green-600">
                {String(i + 1).padStart(2, "0")}
              </span>
              <p className="pt-1 text-sm leading-relaxed text-ink-300">{p}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
