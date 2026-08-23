import { redirect } from "next/navigation";

/**
 * The debts screen, kept as a signpost rather than a screen.
 *
 * It used to list who owed what. That was the same money the invoice list
 * already held — a debt is an invoice that has been part paid or not paid — and
 * keeping both meant two totals that could drift apart, which at a counter is
 * worse than having one that is merely inconvenient to reach.
 *
 * The route stays because it is bookmarked, printed on nothing but likely typed
 * from memory, and linked from older screens; it now lands on the same question
 * it always answered.
 */
export default async function WholesaleDebtsPage() {
  redirect("/wholesale/invoices?state=owing");
}
