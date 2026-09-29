/**
 * What a typed word finds in a dropdown.
 *
 * Its own file, away from the component, for one reason: this is the part that
 * can be wrong without anything looking wrong. A picker that matches only the
 * visible label cannot find Ungerol when the counter types "sles", which is the
 * name they actually say — and nobody would report that as a bug, they would
 * just go back to scrolling.
 */

export interface PickerOption {
  value: string | number;
  label: string;
  /** A second line under the label: a size, a phone number, what it is. */
  hint?: string;
  /** Right-aligned, for a price or a quantity. */
  trailing?: string;
  /**
   * Extra words that should match without being shown — a chemical's other
   * name, a customer's old phone number, a supplier's initials.
   */
  search?: string;
}

/**
 * Every typed word must appear somewhere, in any order.
 *
 * Not a fuzzy match and not a prefix match. Fuzzy finds things nobody asked
 * for, which at a counter means picking the wrong chemical; prefix-only fails
 * on "20 kg jerrican", which is how half the catalogue is named. Word-contains
 * is what people expect from a search box and what they get here.
 *
 * The cut at the end matters: a panel that lists two hundred rows is the scroll
 * this was built to replace.
 */
export function matchOptions(options: PickerOption[], query: string, limit = 60): PickerOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return options.slice(0, limit);
  const words = q.split(/\s+/);
  return options
    .filter((o) => {
      const hay = `${o.label} ${o.hint ?? ""} ${o.search ?? ""}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .slice(0, limit);
}

/** One line in an open dropdown, in the order it is drawn. */
export type PickerRow =
  | { kind: "none" }
  | { kind: "option"; option: PickerOption }
  | { kind: "action" };

/**
 * What an open dropdown shows, given what has been typed.
 *
 * Its own function because of the bug it exists to prevent. The "add a new
 * customer" row used to be an option like any other, so the search filtered it
 * — and typing the name of somebody who is not on file left "nothing matches"
 * and no way to put them on file, which is the one moment that row is wanted.
 *
 * The rule is one line and it is the whole point: **the action is never
 * filtered.** It is appended after whatever the search left, so it is there on
 * an empty box, there on a match, and there on no match at all.
 */
export function pickerRows(
  options: PickerOption[],
  query: string,
  opts: { allowNone?: boolean; hasAction?: boolean; limit?: number } = {},
): PickerRow[] {
  const matches = matchOptions(options, query, opts.limit);
  return [
    ...(opts.allowNone ? [{ kind: "none" } as PickerRow] : []),
    ...matches.map((option) => ({ kind: "option", option }) as PickerRow),
    ...(opts.hasAction ? [{ kind: "action" } as PickerRow] : []),
  ];
}
