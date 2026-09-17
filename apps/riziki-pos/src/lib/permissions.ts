/**
 * What one person may see and do, beyond what their role gives them.
 *
 * Its own file, with no `next/*` import, for two reasons: these rules can be
 * unit-tested under plain Node, and a screen, a server action and a script can
 * all ask the same question without one of them dragging the request context in
 * behind it.
 */

import type { User } from "./db.ts";

/*
  WHAT ONE PERSON MAY SEE, BEYOND WHAT THEIR ROLE GIVES THEM.

  The shop has two roles and they are the floor and the ceiling: an attendant
  sells, an owner sees everything. That covers a shop of two people and stops
  covering it the moment there is a third — a manager who records the deliveries
  and counts the stock, but has no business knowing what a drum of Ungerol cost.

  So: named permissions, granted per person by an owner, on top of the
  attendant's role. Six of them, fixed. Not a free-form list of screens, because
  a permission system nobody can hold in their head is one that gets ticked
  wholesale to make a complaint go away.

  THE RULES THAT KEEP IT HONEST:

    - An OWNER passes every check by being an owner. Permissions cannot be
      taken away from one, and ticking boxes on an owner does nothing. The
      account that grants permissions must not be one that can be crippled.
    - Accounts, roles, permissions, the activity log, the exports and the
      backup stay OWNER ONLY, always. They are not on this list and cannot be
      granted: they are how an owner watches everything below.
    - Every check runs on the SERVER before the data is read, exactly as the
      role checks always have. A permission that only hides a menu item is not
      a permission.
*/
export const PERMISSIONS = [
  {
    key: "cost",
    label: "Cost prices and profit",
    detail: "Reports, margins, what the shop paid. The figures an owner keeps to himself.",
  },
  {
    key: "recipes",
    label: "Recipes and the mixing board",
    detail: "What goes into each mix, and mixing a batch. This is the formula itself.",
  },
  {
    key: "products",
    label: "Products and prices",
    detail: "Change a shelf price, a floor, a ceiling, a size. Not the cost.",
  },
  {
    key: "purchases",
    label: "Record deliveries",
    detail: "Enter what arrived from a supplier, and what it cost.",
  },
  {
    key: "stocktake",
    label: "Count the stock",
    detail: "The count sheet, the chemicals on the shelf, and where a count came from.",
  },
  {
    key: "void",
    label: "Void a sale",
    detail: "Cancel a sale that was rung up wrong. The record keeps both entries.",
  },
] as const;

export type Permission = (typeof PERMISSIONS)[number]["key"];

/** The keys, for validating what a form sends back. */
export function isPermission(v: string): v is Permission {
  return PERMISSIONS.some((p) => p.key === v);
}

/** What this person has been granted by name, ignoring their role. */
export function grantedTo(user: Pick<User, "permissions">): Permission[] {
  return (user.permissions ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is Permission => isPermission(s));
}

/**
 * May this person do this?
 *
 * An owner always may. Anybody else may if it was granted to them by name.
 */
export function can(user: Pick<User, "role" | "permissions"> | null, permission: Permission): boolean {
  if (!user) return false;
  if (user.role === "owner") return true;
  return grantedTo(user).includes(permission);
}

