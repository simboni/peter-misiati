/**
 * Customers, credit and invoicing.
 *
 * The one rule that shapes this whole file: **a customer's balance is never
 * stored**. It is always `SUM(total_cents - paid_cents)` over their completed
 * sales. A stored balance column drifts the first time a payment is recorded
 * twice or a sale is voided, and then the debtors report — the report the owner
 * trusts most — quietly starts lying.
 *
 * Nothing here imports from `next/*`, so the arithmetic can be unit-tested
 * directly under Node.
 */

import { all, get, run, tx, audit, db } from "./db.ts";
import { formatKes, formatDate } from "./units.ts";

// --------------------------------------------------------------- the shop

/**
 * Printed on invoices. Env-overridable so the shop can put its real KRA PIN and
 * phone in without a code change — the PIN in particular is what eTIMS will
 * need on every fiscalised invoice.
 */
export const BUSINESS = {
  name: "Riziki Industrial Chemicals",
  address: process.env.RIZIKI_ADDRESS ?? "Nairobi, Kenya",
  phone: process.env.RIZIKI_PHONE ?? "",
  kraPin: process.env.RIZIKI_KRA_PIN ?? "",
};

// ------------------------------------------------------------- migration

/**
 * eTIMS invoices carry the *buyer's* KRA PIN, so customers need somewhere to
 * keep it. `schema.sql` is owned by another module, so the column is added here
 * idempotently instead — SQLite's ALTER TABLE ... ADD COLUMN is cheap and the
 * PRAGMA check makes re-running a no-op.
 */
let migrated = false;

export function ensureCreditSchema(): void {
  if (migrated) return;
  db(); // schema.sql must have run before we can alter anything

  const cols = all<{ name: string }>(`PRAGMA table_info(customers)`);
  if (!cols.some((c) => c.name === "kra_pin")) {
    run(`ALTER TABLE customers ADD COLUMN kra_pin TEXT NOT NULL DEFAULT ''`);
  }
  migrated = true;
}

// --------------------------------------------------------------- customers

export type CustomerKind = "retail" | "wholesale";

export interface Customer {
  id: number;
  name: string;
  phone: string;
  kind: CustomerKind;
  credit_limit_cents: number;
  kra_pin: string;
  active: number;
}

export interface CustomerInput {
  name: string;
  phone?: string;
  kind?: CustomerKind;
  creditLimitCents?: number;
  kraPin?: string;
}

export function listCustomers(): Customer[] {
  ensureCreditSchema();
  return all<Customer>(`SELECT * FROM customers WHERE active = 1 ORDER BY name`);
}

export function getCustomer(id: number): Customer | undefined {
  ensureCreditSchema();
  return get<Customer>(`SELECT * FROM customers WHERE id = ?`, id);
}

function cleanInput(input: CustomerInput) {
  const name = input.name.trim();
  if (!name) throw new Error("A customer needs a name.");

  const limit = input.creditLimitCents ?? 0;
  if (!Number.isInteger(limit) || limit < 0) {
    throw new Error("The credit limit must be a whole number of cents, zero or more.");
  }
  return {
    name,
    phone: (input.phone ?? "").trim(),
    kind: (input.kind ?? "retail") as CustomerKind,
    limit,
    kraPin: (input.kraPin ?? "").trim().toUpperCase(),
  };
}

export function createCustomer(input: CustomerInput, userId?: number | null): number {
  ensureCreditSchema();
  const c = cleanInput(input);
  const { lastInsertRowid } = run(
    `INSERT INTO customers (name, phone, kind, credit_limit_cents, kra_pin) VALUES (?, ?, ?, ?, ?)`,
    c.name,
    c.phone,
    c.kind,
    c.limit,
    c.kraPin,
  );
  audit(userId ?? null, "customer_create", "customer", lastInsertRowid, c.name);
  return lastInsertRowid;
}

export function updateCustomer(id: number, input: CustomerInput, userId?: number | null): void {
  ensureCreditSchema();
  const c = cleanInput(input);
  const { changes } = run(
    `UPDATE customers SET name = ?, phone = ?, kind = ?, credit_limit_cents = ?, kra_pin = ? WHERE id = ?`,
    c.name,
    c.phone,
    c.kind,
    c.limit,
    c.kraPin,
    id,
  );
  if (!changes) throw new Error(`unknown customer ${id}`);
  audit(userId ?? null, "customer_update", "customer", id, c.name);
}

// ----------------------------------------------------------------- ageing

/**
 * How long the oldest unpaid sale has been outstanding decides the bucket.
 * The bands match how the owner already talks about debts: this week, this
 * month, and "these ones I have to go and see".
 */
export type AgeBand = "none" | "fresh" | "mid" | "old";

export const AGE_FRESH_DAYS = 7;
export const AGE_MID_DAYS = 30;

export const AGE_LABEL: Record<AgeBand, string> = {
  none: "Clear",
  fresh: "0–7 days",
  mid: "8–30 days",
  old: "30+ days",
};

/** `Chip` tones — red is reserved for 30+, which is the row he must act on. */
export const AGE_TONE: Record<AgeBand, "good" | "neutral" | "warn" | "bad"> = {
  none: "good",
  fresh: "neutral",
  mid: "warn",
  old: "bad",
};

/** SQLite writes `datetime('now')` as "YYYY-MM-DD HH:MM:SS" in UTC. */
export function parseAt(iso: string): Date {
  return new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
}

/** Whole days between a sale and now. Never negative — clock skew is not debt. */
export function ageDays(iso: string, now: Date = new Date()): number {
  const ms = now.getTime() - parseAt(iso).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

export function ageBand(days: number): AgeBand {
  if (days <= AGE_FRESH_DAYS) return "fresh";
  if (days <= AGE_MID_DAYS) return "mid";
  return "old";
}

// ---------------------------------------------------------------- balances

export interface DebtorRow {
  id: number;
  name: string;
  phone: string;
  kind: CustomerKind;
  credit_limit_cents: number;
  balance_cents: number;
  oldest_at: string;
  open_sales: number;
  days: number;
  band: AgeBand;
}

/**
 * The debtors book, biggest balance first.
 *
 * Filtering to `total_cents > paid_cents` gives the same total as summing every
 * completed sale (settled sales contribute zero) while also handing us the
 * oldest *unpaid* sale for the ageing bucket in the same pass.
 */
export function debtors(now: Date = new Date()): DebtorRow[] {
  ensureCreditSchema();
  const rows = all<Omit<DebtorRow, "days" | "band">>(
    `SELECT c.id, c.name, c.phone, c.kind, c.credit_limit_cents,
            SUM(s.total_cents - s.paid_cents) AS balance_cents,
            MIN(s.at)                         AS oldest_at,
            COUNT(*)                          AS open_sales
       FROM customers c
       JOIN sales s ON s.customer_id = c.id
      WHERE s.status = 'completed' AND s.total_cents > s.paid_cents
      GROUP BY c.id
      ORDER BY balance_cents DESC, c.name`,
  );
  return rows.map((r) => {
    const days = ageDays(r.oldest_at, now);
    return { ...r, days, band: ageBand(days) };
  });
}

/** Everything the shop is owed, across every customer. */
export function totalOwed(): number {
  const row = get<{ owed: number }>(
    `SELECT COALESCE(SUM(s.total_cents - s.paid_cents), 0) AS owed
       FROM sales s
      WHERE s.status = 'completed' AND s.total_cents > s.paid_cents`,
  );
  return row?.owed ?? 0;
}

/** Derived, always. There is deliberately no `customers.balance_cents`. */
export function balanceOf(customerId: number): number {
  const row = get<{ owed: number }>(
    `SELECT COALESCE(SUM(s.total_cents - s.paid_cents), 0) AS owed
       FROM sales s
      WHERE s.customer_id = ? AND s.status = 'completed'`,
    customerId,
  );
  return row?.owed ?? 0;
}

export interface CustomerSale {
  id: number;
  at: string;
  invoice_no: string | null;
  total_cents: number;
  paid_cents: number;
  status: "completed" | "voided";
  tier: "retail" | "wholesale";
  note: string;
}

export function customerSales(customerId: number, limit = 200): CustomerSale[] {
  return all<CustomerSale>(
    `SELECT id, at, invoice_no, total_cents, paid_cents, status, tier, note
       FROM sales
      WHERE customer_id = ?
      ORDER BY at DESC, id DESC
      LIMIT ?`,
    customerId,
    limit,
  );
}

export interface OpenSale {
  id: number;
  at: string;
  invoice_no: string | null;
  total_cents: number;
  paid_cents: number;
  due_cents: number;
}

/** Unpaid sales, oldest first — the order a payment is applied in. */
export function openSales(customerId: number): OpenSale[] {
  return all<OpenSale>(
    `SELECT id, at, invoice_no, total_cents, paid_cents,
            (total_cents - paid_cents) AS due_cents
       FROM sales
      WHERE customer_id = ? AND status = 'completed' AND total_cents > paid_cents
      ORDER BY at ASC, id ASC`,
    customerId,
  );
}

/** True when the customer's derived balance has passed the agreed limit. */
export function isOverLimit(customer: Pick<Customer, "credit_limit_cents">, balanceCents: number): boolean {
  return customer.credit_limit_cents > 0 && balanceCents > customer.credit_limit_cents;
}

// ---------------------------------------------------------------- payments

export type PaymentMethod = "cash" | "mpesa" | "credit";

export interface PaymentInput {
  customerId: number;
  amountCents: number;
  method: PaymentMethod;
  mpesaCode?: string | null;
  userId?: number | null;
}

export interface Allocation {
  saleId: number;
  invoiceNo: string | null;
  amountCents: number;
  clearedSale: boolean;
}

/**
 * Record a payment against a customer's debt, oldest sale first.
 *
 * Oldest-first is not a preference, it is how the shop already settles: the
 * customer says "here is 3,000 off my account", not "3,000 against the invoice
 * from the 14th". Anything left over rolls onto the next unpaid sale.
 *
 * The insert and the `paid_cents` updates share one transaction so a payment
 * can never be half-applied.
 */
export function recordPayment(input: PaymentInput): Allocation[] {
  const { customerId, amountCents, method } = input;
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error("A payment must be a whole number of cents, greater than zero.");
  }

  return tx(() => {
    const open = all<OpenSale>(
      `SELECT id, at, invoice_no, total_cents, paid_cents,
              (total_cents - paid_cents) AS due_cents
         FROM sales
        WHERE customer_id = ? AND status = 'completed' AND total_cents > paid_cents
        ORDER BY at ASC, id ASC`,
      customerId,
    );

    let left = amountCents;
    const parts: Allocation[] = [];

    for (const sale of open) {
      if (left <= 0) break;
      const take = Math.min(sale.due_cents, left);

      // The M-Pesa code is uniquely indexed so one SMS cannot pay twice. When a
      // single transfer settles several sales the later rows carry a suffixed
      // code: still searchable when reconciling the statement, still unable to
      // collide with someone re-entering the bare code.
      const code = input.mpesaCode
        ? parts.length === 0
          ? input.mpesaCode
          : `${input.mpesaCode}#${parts.length + 1}`
        : null;

      run(
        `INSERT INTO payments (sale_id, method, amount_cents, mpesa_code, user_id) VALUES (?, ?, ?, ?, ?)`,
        sale.id,
        method,
        take,
        code,
        input.userId ?? null,
      );
      run(`UPDATE sales SET paid_cents = paid_cents + ? WHERE id = ?`, take, sale.id);

      parts.push({
        saleId: sale.id,
        invoiceNo: sale.invoice_no,
        amountCents: take,
        clearedSale: take === sale.due_cents,
      });
      left -= take;
    }

    // Refusing the overpayment (rather than parking it) keeps every balance
    // derivable from sales alone; a credit note would need its own ledger.
    if (left > 0) {
      throw new Error(
        `That is ${formatKes(left)} more than this customer owes. Record only what settles the account.`,
      );
    }

    audit(
      input.userId ?? null,
      "payment_record",
      "customer",
      customerId,
      `${formatKes(amountCents)} by ${method} across ${parts.length} sale(s)`,
    );
    return parts;
  });
}

// ---------------------------------------------------------------- invoices

export const INVOICE_PREFIX = "INV-";

/**
 * Allocate the sale's invoice number the first time an invoice is issued.
 *
 * Sequential and gapless is what KRA expects of a fiscal document, so the
 * number is handed out on first issue rather than at sale time — a quick cash
 * sale that never gets printed does not burn a number.
 */
export function issueInvoiceNo(saleId: number, userId?: number | null): string {
  return tx(() => {
    const sale = get<{ invoice_no: string | null }>(`SELECT invoice_no FROM sales WHERE id = ?`, saleId);
    if (!sale) throw new Error(`unknown sale ${saleId}`);
    if (sale.invoice_no) return sale.invoice_no;

    const row = get<{ n: number | null }>(
      `SELECT MAX(CAST(substr(invoice_no, ?) AS INTEGER)) AS n
         FROM sales WHERE invoice_no LIKE ?`,
      INVOICE_PREFIX.length + 1,
      INVOICE_PREFIX + "%",
    );
    const no = INVOICE_PREFIX + String((row?.n ?? 0) + 1).padStart(5, "0");

    run(`UPDATE sales SET invoice_no = ? WHERE id = ?`, no, saleId);
    audit(userId ?? null, "invoice_issue", "sale", saleId, no);
    return no;
  });
}

export interface InvoiceSale {
  id: number;
  at: string;
  invoice_no: string | null;
  tier: "retail" | "wholesale";
  total_cents: number;
  paid_cents: number;
  status: "completed" | "voided";
  note: string;
  customer_id: number | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_kra_pin: string | null;
  user_name: string | null;
}

export interface InvoiceLine {
  id: number;
  name_snapshot: string;
  units: number;
  qty_milli: number;
  unit_price_cents: number;
  line_total_cents: number;
  canonical_unit: string | null;
}

export interface InvoiceTender {
  method: PaymentMethod;
  amount_cents: number;
  codes: string | null;
}

export interface Invoice {
  sale: InvoiceSale;
  lines: InvoiceLine[];
  tenders: InvoiceTender[];
  balanceCents: number;
}

export function getInvoice(saleId: number): Invoice | undefined {
  ensureCreditSchema();

  const sale = get<InvoiceSale>(
    `SELECT s.id, s.at, s.invoice_no, s.tier, s.total_cents, s.paid_cents, s.status, s.note,
            s.customer_id,
            c.name AS customer_name, c.phone AS customer_phone, c.kra_pin AS customer_kra_pin,
            u.name AS user_name
       FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
       LEFT JOIN users u     ON u.id = s.user_id
      WHERE s.id = ?`,
    saleId,
  );
  if (!sale) return undefined;

  // Prices come from the snapshot columns only. `items` is joined for the unit
  // symbol — never for money, or reprinting an old invoice would show today's
  // price.
  const lines = all<InvoiceLine>(
    `SELECT sl.id, sl.name_snapshot, sl.units, sl.qty_milli,
            sl.unit_price_cents, sl.line_total_cents,
            i.canonical_unit
       FROM sale_lines sl
       LEFT JOIN items i ON i.id = sl.item_id
      WHERE sl.sale_id = ?
      ORDER BY sl.id`,
    saleId,
  );

  const tenders = all<InvoiceTender>(
    `SELECT method, SUM(amount_cents) AS amount_cents,
            GROUP_CONCAT(mpesa_code, ', ') AS codes
       FROM payments
      WHERE sale_id = ?
      GROUP BY method
      ORDER BY method`,
    saleId,
  );

  return { sale, lines, tenders, balanceCents: sale.total_cents - sale.paid_cents };
}

// --------------------------------------------------------------- WhatsApp

/**
 * Kenyan numbers get typed every which way — 0722…, +254 722…, 722…. wa.me
 * wants bare international digits, so normalise before building the link.
 */
export function waPhone(phone: string): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("254")) return digits;
  if (digits.startsWith("0")) return "254" + digits.slice(1);
  if (digits.length === 9) return "254" + digits; // 7xxxxxxxx as written on a card
  return digits;
}

/**
 * A wa.me deep link. The shop already chases debts on WhatsApp, so a reminder
 * that opens pre-typed is one tap instead of five.
 * Returns a share-only link (no recipient) when there is no usable number.
 */
export function waLink(phone: string, message: string): string {
  const to = waPhone(phone);
  const text = encodeURIComponent(message);
  return to.length >= 11 ? `https://wa.me/${to}?text=${text}` : `https://wa.me/?text=${text}`;
}

export function reminderMessage(name: string, balanceCents: number, oldestAt?: string): string {
  const since = oldestAt ? ` The oldest unpaid sale is from ${formatDate(oldestAt)}.` : "";
  return (
    `Hello ${name}, this is ${BUSINESS.name}. ` +
    `Your account balance is ${formatKes(balanceCents)}.${since} ` +
    `Kindly settle when you can. Asante.`
  );
}

export function invoiceMessage(inv: Invoice): string {
  const no = inv.sale.invoice_no ?? `Sale #${inv.sale.id}`;
  const who = inv.sale.customer_name ? `Hello ${inv.sale.customer_name}, ` : "";
  return (
    `${who}here is invoice ${no} from ${BUSINESS.name} dated ${formatDate(inv.sale.at)}. ` +
    `Total ${formatKes(inv.sale.total_cents)}, paid ${formatKes(inv.sale.paid_cents)}, ` +
    `balance ${formatKes(inv.balanceCents)}. Asante.`
  );
}
