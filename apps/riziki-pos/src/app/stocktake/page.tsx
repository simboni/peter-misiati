import { redirect } from "next/navigation";

/**
 * The stock take lives inside the Stock window now.
 *
 * It was a separate address, which meant "Stock" and "Stock take" were two
 * entries in the main menu for one job, and getting between them cost a page
 * load in the middle of counting a shelf. Kept as a redirect because the link
 * is in the till's overdraw message, and in whatever anybody bookmarked.
 */
export default function StocktakeRoute() {
  redirect("/stock?panel=count");
}
