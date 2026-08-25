import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { all, get } from "@/lib/db";
import { formatDateTime } from "@/lib/units";
import { Card, Chip, Empty, PageTitle } from "@/components/ui";
import { SectionNav, REPORT_SECTIONS, ListToolbar, Pager } from "@/components/section-nav";

export const dynamic = "force-dynamic";

/**
 * The activity log — OWNER ONLY.
 *
 * Everything disputable has always been written to the append-only audit_log:
 * every sign-in, price change, void, payment, export, PIN reset. This screen is
 * the window onto it, newest first, in words rather than codes — "who did what,
 * when" is the question it exists to answer at speed.
 *
 * It was a grid of cards, which is the wrong shape for it. A card is for a thing
 * you act on; a log entry is a line you scan past on the way to the one you are
 * looking for, and forty of them as cards is four screens of scrolling for what
 * a list says in one. So: one line each, columns that align down the page, and
 * the detail on the same row unless it is long.
 *
 * Paging is by page number rather than "show older". A cursor is fine for
 * infinite scroll and useless for the actual job — an owner checking last
 * Tuesday wants to jump, not to press "older" nine times — and it cannot say
 * how many pages there are.
 *
 * PINs never appear here (they are never logged), and the log cannot be edited
 * from anywhere in the app.
 */

const SIZES = [50, 100, 200] as const;
const DEFAULT_SIZE = 50;

type Group = "money" | "prices" | "stock" | "people" | "system";

const GROUP_LABEL: Record<Group, string> = {
  money: "Money",
  prices: "Prices",
  stock: "Stock",
  people: "People",
  system: "System",
};

/**
 * Action code → plain words, a tone, and which of five things it is about.
 *
 * The grouping is what makes the log usable: "was anything voided this week"
 * and "who has been changing prices" are the two questions actually asked of
 * it, and both are unanswerable in a single stream of everything.
 */
const ACTIONS: Record<
  string,
  { label: string; tone: "good" | "warn" | "bad" | "neutral" | "brand"; group: Group }
> = {
  login: { label: "Signed in", tone: "good", group: "people" },
  login_failed: { label: "Wrong PIN at sign-in", tone: "warn", group: "people" },
  void_sale: { label: "Voided a sale", tone: "bad", group: "money" },
  payment_record: { label: "Recorded a payment", tone: "good", group: "money" },
  invoice_issue: { label: "Issued an invoice", tone: "neutral", group: "money" },
  price_changed: { label: "Changed a price", tone: "brand", group: "prices" },
  price_discount: { label: "Gave a discount", tone: "warn", group: "prices" },
  price_uplift: { label: "Charged above the asking price", tone: "warn", group: "prices" },
  price_override_below_floor: { label: "Sold below the floor", tone: "bad", group: "prices" },
  price_override_above_ceiling: { label: "Sold above the ceiling", tone: "bad", group: "prices" },
  product_created: { label: "Added a product", tone: "brand", group: "stock" },
  item_deleted: { label: "Deleted a product", tone: "bad", group: "stock" },
  chemical_created: { label: "Added a chemical", tone: "brand", group: "stock" },
  pack_size_added: { label: "Added a pack size", tone: "brand", group: "stock" },
  item_activated: { label: "Showed an item", tone: "neutral", group: "stock" },
  item_retired: { label: "Hid an item", tone: "warn", group: "stock" },
  formula_new: { label: "Added a recipe", tone: "brand", group: "stock" },
  formula_version: { label: "Changed a recipe", tone: "brand", group: "stock" },
  batch_run: { label: "Mixed a batch", tone: "neutral", group: "stock" },
  batch_yield: { label: "Recorded a yield", tone: "neutral", group: "stock" },
  batch_void: { label: "Voided a batch", tone: "bad", group: "stock" },
  repack: { label: "Repacked bulk", tone: "neutral", group: "stock" },
  repack_void: { label: "Voided a repack", tone: "bad", group: "stock" },
  stocktake: { label: "Stock take", tone: "neutral", group: "stock" },
  adjustment: { label: "Adjusted stock", tone: "warn", group: "stock" },
  day_close: { label: "Closed the day", tone: "good", group: "money" },
  expense_add: { label: "Entered an expense", tone: "neutral", group: "money" },
  customer_create: { label: "Added a customer", tone: "neutral", group: "people" },
  customer_update: { label: "Edited a customer", tone: "neutral", group: "people" },
  customer_hidden: { label: "Hid a customer", tone: "warn", group: "people" },
  customer_deleted: { label: "Deleted a customer", tone: "bad", group: "people" },
  customer_restored: { label: "Restored a customer", tone: "neutral", group: "people" },
  supplier_create: { label: "Added a supplier", tone: "neutral", group: "people" },
  supplier_update: { label: "Edited a supplier", tone: "neutral", group: "people" },
  quote_new: { label: "Raised a quotation", tone: "neutral", group: "money" },
  quote_edit: { label: "Edited a quotation", tone: "neutral", group: "money" },
  quote_status: { label: "Moved a quotation along", tone: "neutral", group: "money" },
  quote_invoiced: { label: "Turned a quote into an invoice", tone: "good", group: "money" },
  user_created: { label: "Added a user", tone: "brand", group: "people" },
  user_renamed: { label: "Renamed a user", tone: "neutral", group: "people" },
  role_changed: { label: "Changed a role", tone: "warn", group: "people" },
  pin_changed: { label: "Changed own PIN", tone: "good", group: "people" },
  pin_reset: { label: "Reset someone's PIN", tone: "warn", group: "people" },
  setting_changed: { label: "Changed a setting", tone: "neutral", group: "system" },
  printer_settings_save: { label: "Printer set up", tone: "neutral", group: "system" },
  export: { label: "Exported data", tone: "warn", group: "system" },
  backup: { label: "Downloaded a backup", tone: "good", group: "system" },
  seed: { label: "System first set up", tone: "neutral", group: "system" },
};

function describe(action: string) {
  return (
    ACTIONS[action] ?? {
      label: action.replaceAll("_", " "),
      tone: "neutral" as const,
      group: "system" as Group,
    }
  );
}

/** The action codes in one group, for the SQL filter. */
function codesIn(group: Group): string[] {
  return Object.entries(ACTIONS)
    .filter(([, a]) => a.group === group)
    .map(([code]) => code);
}

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
  searchParams: Promise<{ q?: string; state?: string; page?: string; size?: string }>;
}) {
  const me = await currentUser();
  if (!me) redirect("/login");
  // Exports, voids and PIN resets are the owner's business, like the rest of
  // this page. Staff have no reason to browse who did what.
  if (me.role !== "owner") redirect("/");

  const { q = "", state, page: pageParam, size: sizeParam } = await props.searchParams;
  const group = (["money", "prices", "stock", "people", "system"] as const).includes(state as never)
    ? (state as Group)
    : null;
  const size = SIZES.includes(Number(sizeParam) as never) ? Number(sizeParam) : DEFAULT_SIZE;
  const page = Math.max(1, Number(pageParam) || 1);

  /*
    Filtering happens in SQL, not in the page.

    The log is the one table that only ever grows — a year of trading is tens of
    thousands of rows — and reading all of them to show fifty is the kind of
    thing that works in a demo and stops working in month four.
  */
  const where: string[] = [];
  const params: Array<string | number> = [];

  if (group) {
    const codes = codesIn(group);
    where.push(`a.action IN (${codes.map(() => "?").join(", ")})`);
    params.push(...codes);
  }
  if (q.trim()) {
    where.push(`(a.detail LIKE ? OR u.name LIKE ? OR a.entity LIKE ?)`);
    const like = `%${q.trim()}%`;
    params.push(like, like, like);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const total =
    get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ${clause}`,
      ...params,
    )?.n ?? 0;

  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(page, pages);

  const rows = all<Row>(
    `SELECT a.id, a.at, u.name AS user_name, a.action, a.entity, a.entity_id, a.detail
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
       ${clause}
      ORDER BY a.id DESC LIMIT ? OFFSET ?`,
    ...params,
    size,
    (current - 1) * size,
  );

  // Counts on the chips, over the search but not over the group — a chip that
  // says how many are in it stops being useful the moment it counts only what
  // is already selected.
  const searchOnly: string[] = [];
  const searchParams2: string[] = [];
  if (q.trim()) {
    searchOnly.push(`(a.detail LIKE ? OR u.name LIKE ? OR a.entity LIKE ?)`);
    const like = `%${q.trim()}%`;
    searchParams2.push(like, like, like);
  }
  const searchClause = searchOnly.length ? `WHERE ${searchOnly.join(" AND ")}` : "";
  const countFor = (g: Group) => {
    const codes = codesIn(g);
    const sql =
      `SELECT COUNT(*) AS n FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ` +
      `${searchClause}${searchClause ? " AND" : "WHERE"} a.action IN (${codes.map(() => "?").join(", ")})`;
    return get<{ n: number }>(sql, ...searchParams2, ...codes)?.n ?? 0;
  };
  const allCount =
    get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ${searchClause}`,
      ...searchParams2,
    )?.n ?? 0;

  const keep: Record<string, string> = {
    ...(q ? { q } : {}),
    ...(group ? { state: group } : {}),
    ...(size !== DEFAULT_SIZE ? { size: String(size) } : {}),
  };

  return (
    <div>
      <PageTitle
        title="Activity log"
        subtitle={`Everything worth disputing, newest first — ${total.toLocaleString("en-KE")} ${
          total === 1 ? "entry" : "entries"
        }, none of them editable`}
      />
      <SectionNav sections={REPORT_SECTIONS} current="/activity" label="Reports" />

      <ListToolbar
        action="/activity"
        q={q}
        placeholder="Search a name, a product, a note…"
        current={group ?? "all"}
        extra={size !== DEFAULT_SIZE ? { size: String(size) } : undefined}
        filters={[
          { key: "all", label: "Everything", count: allCount },
          ...(["money", "prices", "stock", "people", "system"] as Group[]).map((g) => ({
            key: g,
            label: GROUP_LABEL[g],
            count: countFor(g),
          })),
        ]}
      />

      {rows.length === 0 ? (
        <Card>
          <Empty>
            {q || group ? "Nothing recorded matches that." : "Nothing recorded yet."}
          </Empty>
        </Card>
      ) : (
        /*
          A list, not a table element.

          A table would need horizontal scroll on a phone to keep four columns,
          and the fourth — the detail — is the one that has to be readable. So
          the row is a flex line that wraps: time and person stay together on
          the left, the label holds its own column from `sm` up, and the detail
          takes whatever is left, dropping to its own line when there is none.
        */
        <div className="overflow-hidden rounded-2xl bg-white shadow-card ring-1 ring-ink/5">
          {rows.map((r, i) => {
            const a = describe(r.action);
            return (
              <div
                key={r.id}
                className={`flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2 ${
                  i % 2 ? "bg-wash/40" : ""
                }`}
              >
                <span className="w-[7.5rem] shrink-0 text-[11px] text-muted tnum">
                  {formatDateTime(r.at)}
                </span>
                <span className="w-24 shrink-0 truncate text-[13px] font-bold">
                  {r.user_name ?? "System"}
                </span>
                <span className="shrink-0">
                  <Chip tone={a.tone}>{a.label}</Chip>
                </span>
                {/*
                  `min-w-0` and `overflow-wrap: anywhere`: a detail can be a
                  string with no spaces in it, and without both the row grows to
                  fit rather than the text wrapping inside it — which pushed this
                  page hundreds of pixels past the edge of a phone.
                */}
                {r.detail ? (
                  <span className="min-w-0 flex-1 basis-full text-[13px] text-muted [overflow-wrap:anywhere] sm:basis-0">
                    {r.detail}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <Pager
        action="/activity"
        page={current}
        pages={pages}
        total={total}
        noun="entry"
        params={keep}
      />

      {/* How many at a time. Fifty is right for a scan; two hundred is right
          when somebody is looking for one thing and does not know its date. */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
          Per page
        </span>
        {SIZES.map((n) => {
          const p = new URLSearchParams({ ...keep });
          p.delete("page");
          if (n === DEFAULT_SIZE) p.delete("size");
          else p.set("size", String(n));
          const href = p.toString() ? `/activity?${p}` : "/activity";
          return (
            <a
              key={n}
              href={href}
              aria-current={n === size ? "true" : undefined}
              className={`flex min-h-9 items-center rounded-full px-3 text-[13px] font-bold ${
                n === size
                  ? "bg-brand text-white"
                  : "bg-white text-muted ring-1 ring-inset ring-line hover:text-ink"
              }`}
            >
              {n}
            </a>
          );
        })}
      </div>

      <p className="mt-5 text-xs text-muted">
        PINs are never written here — only the fact that one was changed, and by whom.
      </p>
    </div>
  );
}
