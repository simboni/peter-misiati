/**
 * Search types and saved views shared by the browser and the server.
 *
 * Lives in lib/ rather than server/ on purpose: the ⌘K palette is a Client
 * Component, and importing these from server/search.ts would pull Drizzle and
 * the libSQL client into the browser bundle.
 */

export type Hit = {
  kind: "invoice" | "quotation" | "client" | "item";
  id: string;
  title: string;
  subtitle: string;
  href: string;
  /** Minor units, for the ones that carry money. */
  amount?: number;
  currency?: string;
  status?: string;
};

/**
 * Saved views the palette offers as one-tap filters, phrased the way the
 * blueprint asked for — "unpaid" should be something you can type and get.
 * `unpaid` is resolved server-side as sent/partial/overdue with a balance
 * still owed; the rest are stored statuses.
 */
export const SMART_QUERIES: { label: string; href: string; keywords: string }[] = [
  { label: "Unpaid invoices", href: "/invoices?status=unpaid", keywords: "unpaid outstanding owed owing money" },
  { label: "Overdue invoices", href: "/invoices?status=overdue", keywords: "overdue late arrears" },
  { label: "Needs chasing", href: "/reminders", keywords: "chase chasing reminders remind follow up" },
  { label: "Part-paid invoices", href: "/invoices?status=partial", keywords: "partial part paid deposit balance" },
  { label: "Paid invoices", href: "/invoices?status=paid", keywords: "paid settled complete" },
  { label: "Draft invoices", href: "/invoices?status=draft", keywords: "draft unsent unfinished" },
];
