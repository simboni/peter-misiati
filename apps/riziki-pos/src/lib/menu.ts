/**
 * The More menu, and who may see each entry.
 *
 * Plain data in a plain module, with no `next/*` and no JSX, so the rule that
 * decides what an attendant can reach is something a test can hold. It used to
 * live inside the nav client component, where the only way to check it was to
 * sign in as somebody and look — which is how "the staff cannot reach the
 * printer" survived being fixed once and reported three more times.
 */

export interface MenuLink {
  href: string;
  label: string;
  /**
   * `short` is the rail's version of the name. The rail is 12rem on a small
   * laptop and one label — "Suppliers & purchases" — overruns that by a single
   * pixel and wraps to two lines, which makes the whole column look ragged. The
   * More grid has the room, so it keeps the full name; only the rail shortens.
   */
  short?: string;
  /**
   * What this destination needs: a permission key, or "owner" for the few
   * things only an owner may ever reach. Absent means everybody signed in.
   */
  need?: string;
}

export interface MenuGroup {
  label: string;
  links: MenuLink[];
}

/*
  Everything that is not one of the tabs.

  This is the sidebar on a laptop and the More grid on a phone, and it is where
  a destination belongs unless it is one of the six things the counter reaches
  for constantly.

  These were briefly folded into a strip of tabs inside the Stock and Reports
  screens, and that was wrong twice over: Products & prices and Recipes are not
  stock, and a strip inside a window whose every entry navigates somewhere else
  is a second navigation competing with this one. Getting between windows is
  this menu's job. A window's own controls stay inside it.
*/
export const MORE_GROUPS: MenuGroup[] = [
  {
    // Named for what these are rather than where they sit: an attendant looking
    // for the day close is looking for a job, not for a category.
    label: "Every day",
    links: [
      { href: "/day-close", label: "Day close" },
      { href: "/expenses", label: "Expenses" },
      // Open to attendants on purpose: the person who opens the shop is the
      // person who gets asked the price, and the band is what makes letting
      // them change it safe.
      { href: "/prices/history", label: "Price history", short: "Prices" },
      { href: "/sales", label: "Sales history" },
      { href: "/purchases", label: "Suppliers & purchases", short: "Purchases" },
    ],
  },
  {
    // What the shop sells and what goes into it. Neither is stock: a price is
    // not a quantity, and a recipe is a piece of writing. They sit beside Stock
    // rather than inside it.
    label: "Products & recipes",
    links: [
      { href: "/items", label: "Products & prices", short: "Products", need: "products" },
      // Beside the prices on purpose: what a thing costs to put on the shelf and
      // what the shop asks for it are two halves of one decision, and the shop
      // was only ever shown the second.
      { href: "/landed", label: "Landed cost", short: "Landed", need: "cost" },
      { href: "/formulas", label: "Recipes", need: "recipes" },
      { href: "/mix", label: "Mixing board", short: "Mixing", need: "recipes" },
    ],
  },
  {
    label: "Setup & records",
    links: [
      // Beside the activity log because both are the shop auditing itself: one
      // says who did what, the other says which of it does not look right.
      { href: "/check", label: "Worth checking", short: "Check", need: "cost" },
      { href: "/activity", label: "Activity log", need: "owner" },
      { href: "/settings", label: "Users & settings", need: "owner" },
      /*
        Open to everybody, and it always should have been.

        The page itself has never needed more than a signed-in user — it pairs
        the counter printer with THIS device and stores nothing an attendant
        may not see. Hiding it behind the owner meant whoever actually stands
        at the till could not reconnect the printer when it dropped, and had to
        fetch the owner to press a button they were allowed to press.
      */
      { href: "/settings/printer", label: "Receipt printer" },
      { href: "/pin", label: "Change my PIN" },
    ],
  },
];

/**
 * May this person see this link?
 *
 * The menu is not a security boundary — every screen checks again on the
 * server, before it reads anything — but a menu full of doors that refuse to
 * open is its own kind of lie, so it shows what this person can actually use.
 */
export function allowed(need: string | undefined, isOwner: boolean, granted: readonly string[]): boolean {
  if (!need) return true;
  if (isOwner) return true;
  if (need === "owner") return false;
  return granted.includes(need);
}
