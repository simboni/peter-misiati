/**
 * Export.
 *
 * Deliberately a plain `<a download>` per report and one big one for
 * everything. No modal, no "request an export and we will email it", no
 * account-manager gate — vendor lock-in is the second-biggest documented
 * failure in this market and "you can leave whenever you want" is the
 * differentiator a competitor cannot copy without cannibalising itself.
 */
import { Card } from "@/components/ui";

export function ExportLink({
  name,
  label,
  query = "",
}: {
  name: string;
  label: string;
  query?: string;
}) {
  return (
    <a
      href={`/reports/export/${name}${query}`}
      download
      className="tap inline-flex items-center gap-2 rounded-md border border-line bg-surface px-4 py-3 text-sm font-medium hover:border-brand"
    >
      <span aria-hidden>⬇</span>
      {label}
    </a>
  );
}

export function FullExportCard() {
  return (
    <Card className="border-brand">
      <h2 className="text-lg font-semibold">
        <span aria-hidden className="mr-2">📦</span>
        Take your data with you
      </h2>
      <p className="mt-1 text-sm text-ink-2">
        Every animal, every milking, every shilling — as a spreadsheet file that opens on any phone.
        It is your farm&rsquo;s record. You can leave whenever you want, and nothing here is designed
        to stop you.
      </p>
      <div className="mt-4">
        <ExportLink name="all" label="Download everything (CSV)" />
      </div>
    </Card>
  );
}
