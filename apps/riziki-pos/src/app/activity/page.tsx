import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { all, get } from "@/lib/db";
import { formatDateTime } from "@/lib/units";
import { Card, Chip, Empty, PageTitle } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * The activity log — OWNER ONLY.
 *
 * Everything disputable has always been written to the append-only audit_log:
 * every sign-in, price change, void, payment, export, PIN reset. This screen
 * is simply the window onto it, newest first, in words rather than codes —
 * "who did what, when" is the question this page exists to answer at speed.
 *
 * PINs never appear here (they are never logged), and the log itself cannot
 * be edited from anywhere in the app.
 */

const PAGE = 50;

/** action code -> plain words + tone. Unknown codes fall through legibly. */
const ACTIONS: Record<string, { label: string; tone: "good" | "warn" | "bad" | "neutral" | "brand" }> = {
  login: { label: "Signed in", tone: "good" },
  login_failed: { label: "Wrong PIN at sign-in", tone: "warn" },
  void_sale: { label: "Voided a sale", tone: "bad" },
  payment_record: { label: "Recorded a payment", tone: "good" },
  invoice_issue: { label: "Issued an invoice", tone: "neutral" },
  price_changed: { label: "Changed prices", tone: "brand" },
  product_created: { label: "Added a product", tone: "brand" },
  chemical_created: { label: "Added a chemical", tone: "brand" },
  pack_size_added: { label: "Added a pack size", tone: "brand" },
  item_activated: { label: "Showed an item", tone: "neutral" },
  item_retired: { label: "Hid an item", tone: "warn" },
  batch_run: { label: "Mixed a batch", tone: "neutral" },
  batch_yield: { label: "Recorded a yield", tone: "neutral" },
  batch_void: { label: "Voided a batch", tone: "bad" },
  repack: { label: "Repacked bulk", tone: "neutral" },
  repack_void: { label: "Voided a repack", tone: "bad" },
  stocktake: { label: "Stock take", tone: "neutral" },
  adjustment: { label: "Adjusted stock", tone: "warn" },
  day_close: { label: "Closed the day", tone: "good" },
  expense_add: { label: "Entered an expense", tone: "neutral" },
  customer_create: { label: "Added a customer", tone: "neutral" },
  customer_update: { label: "Edited a customer", tone: "neutral" },
  supplier_create: { label: "Added a supplier", tone: "neutral" },
  supplier_update: { label: "Edited a supplier", tone: "neutral" },
  user_created: { label: "Added a user", tone: "brand" },
  user_renamed: { label: "Renamed a user", tone: "neutral" },
  role_changed: { label: "Changed a role", tone: "warn" },
  pin_changed: { label: "Changed own PIN", tone: "good" },
  pin_reset: { label: "Reset someone's PIN", tone: "warn" },
  setting_changed: { label: "Changed a setting", tone: "neutral" },
  printer_settings_save: { label: "Printer set up", tone: "neutral" },
  export: { label: "Exported data", tone: "warn" },
  backup: { label: "Downloaded a backup", tone: "good" },
  seed: { label: "System first set up", tone: "neutral" },
};

interface Row {
  id: number;
  at: string;
  user_name: string | null;
  action: string;
  entity: string;
  entity_id: number | null;
  detail: string | null;
}

export default async function ActivityPage(props: {
  searchParams: Promise<{ before?: string }>;
}) {
  const me = await currentUser();
  if (!me) redirect("/login");
  // Exports, voids and PIN resets are owner's business — like the rest of
  // this page. Staff have no reason to browse who did what.
  if (me.role !== "owner") redirect("/");

  const { before } = await props.searchParams;
  const beforeId = Number(before) || null;

  const rows = beforeId
    ? all<Row>(
        `SELECT a.id, a.at, u.name AS user_name, a.action, a.entity, a.entity_id, a.detail
           FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
          WHERE a.id < ? ORDER BY a.id DESC LIMIT ?`,
        beforeId,
        PAGE,
      )
    : all<Row>(
        `SELECT a.id, a.at, u.name AS user_name, a.action, a.entity, a.entity_id, a.detail
           FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
          ORDER BY a.id DESC LIMIT ?`,
        PAGE,
      );

  const total = get<{ n: number }>(`SELECT COUNT(*) AS n FROM audit_log`)?.n ?? 0;
  const oldest = rows.length ? rows[rows.length - 1].id : null;
  const hasMore = oldest !== null && (get(`SELECT 1 FROM audit_log WHERE id < ? LIMIT 1`, oldest) ? true : false);

  return (
    // No width cap: this is fifty short, self-contained entries, not prose.
    <div>
      <PageTitle
        title="Activity"
        subtitle={`Everything worth disputing, newest first — ${total.toLocaleString("en-KE")} entries and none of them editable`}
      />

      {rows.length === 0 ? (
        <Card>
          <Empty>Nothing recorded yet.</Empty>
        </Card>
      ) : (
        // Newest first still reads correctly across columns — left to right,
        // then down — and answering "who did what" means scanning many entries,
        // so a wide screen should show more of them rather than a longer margin.
        <div className="grid grid-cols-1 gap-1.5 xl:grid-cols-2 2xl:grid-cols-3 3xl:grid-cols-4">
          {rows.map((r) => {
            const a = ACTIONS[r.action] ?? { label: r.action.replaceAll("_", " "), tone: "neutral" as const };
            return (
              <Card key={r.id} className="min-w-0 !p-2.5 xl:!p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip tone={a.tone}>{a.label}</Chip>
                  <span className="text-sm font-bold">{r.user_name ?? "System"}</span>
                  <span className="ml-auto text-[11px] text-muted">{formatDateTime(r.at)}</span>
                </div>
                {/*
                  `break-words` alone was not enough. A grid item defaults to
                  min-width:auto, so the card grew to fit an unbroken string
                  rather than the string wrapping inside it — and a detail can be
                  a JSON blob with no spaces in it, which stretched this page
                  565px past the edge of a phone. `min-w-0` on the card lets it
                  shrink; `overflow-wrap: anywhere` breaks the string.
                */}
                {r.detail ? (
                  <p className="mt-1.5 text-sm text-muted [overflow-wrap:anywhere]">{r.detail}</p>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}

      {hasMore && oldest !== null ? (
        <p className="mt-3 text-center">
          <Link href={`/activity?before=${oldest}`} className="text-sm font-bold text-brand">
            Show older activity
          </Link>
        </p>
      ) : null}

      <p className="mt-5 text-xs text-muted">
        PINs are never written here — only the fact that one was changed, and by whom.
      </p>
    </div>
  );
}
