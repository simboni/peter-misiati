import type { Metadata } from "next";
import Link from "next/link";
import { constituency } from "@/lib/data";
import { FactRow, SectionHead } from "@/components/ui";

export const metadata: Metadata = {
  title: "Bumula — Constituency Delivery",
  description:
    "What the mandate delivered at home: education results, bursaries and scholarships in Bumula Constituency, Bungoma County — each entry sourced and statused.",
};

export default function BumulaPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-16">
      <SectionHead
        kicker={`${constituency.name} · ${constituency.county}`}
        title="Delivery at home"
        lede={`${constituency.registeredContext} The entries below are the constituency record to date — education-led, as the money trail shows — with project-level line-items to follow as official schedules are transcribed.`}
      />

      <ul className="mt-12 space-y-4">
        {constituency.delivery.map((d, i) => (
          <FactRow key={i} {...d} />
        ))}
      </ul>

      <div className="mt-12 rounded-xl border border-paper-600 bg-paper-850 p-8">
        <h3 className="font-display text-xl font-semibold text-ink-100">
          Where are the project line-items?
        </h3>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-400">
          In the ledger, being transcribed. Every NG-CDF project in Bumula — school, classroom,
          chief&rsquo;s office — will be listed with its location, budget and completion status,
          sourced from the constituency office&rsquo;s published schedules and reconciled against
          the Auditor-General&rsquo;s findings. Until an entry can carry a source, it stays off
          this page. See the{" "}
          <Link href="/money/" className="font-medium text-green-600 hover:underline">
            Money Trail
          </Link>{" "}
          for the allocations those projects draw on.
        </p>
      </div>
    </div>
  );
}
