import { redirect } from "next/navigation";

/**
 * There is one Customers section now, and this is not it.
 *
 * Wholesale had its own customer list and the main navigation had another, and
 * between them they answered "does this person owe us" twice — from different
 * queries, which is two chances to disagree. A wholesale buyer and a walk-in
 * who took something on credit are the same person to this shop.
 *
 * Kept as a redirect rather than deleted: the link is in the wholesale spine,
 * and in whatever anybody bookmarked.
 */
export default function WholesaleCustomersRoute() {
  redirect("/customers");
}
