import type { HerdRow } from "@/server/herd";
import type { AnimalOption } from "@/components/breeding/form-kit";

/**
 * The animal picker is the first tap on every breeding screen, so it is built
 * once here: females only, calves and weaners left out, and each option carries
 * the one line of context that stops the wrong cow being chosen.
 */
export function pickerOptions(rows: HerdRow[]): AnimalOption[] {
  return rows
    .filter((r) => r.sex === "F" && r.cls !== "CALF" && r.cls !== "WEANER" && !r.exited)
    .map((r) => ({
      id: r.id,
      label: r.name ? `${r.name} (${r.tag})` : r.tag,
      detail: detailFor(r),
    }));
}

/** Cows who can plausibly calve: anyone in calf, served, or already milking. */
export function calvingCandidates(rows: HerdRow[]): AnimalOption[] {
  return pickerOptions(
    rows.filter(
      (r) => r.reproStatus === "PREGNANT" || r.reproStatus === "SERVED" || r.reproStatus === "DRY" || r.parity > 0,
    ),
  );
}

/** Cows who can be dried off: in milk and carrying a calf. */
export function dryOffCandidates(rows: HerdRow[]): AnimalOption[] {
  return pickerOptions(rows.filter((r) => r.daysInMilk != null || r.reproStatus === "PREGNANT"));
}

export function bullOptions(rows: HerdRow[]): AnimalOption[] {
  return rows
    .filter((r) => r.sex === "M" && !r.exited && (r.cls === "BULL" || r.cls === "BULL_CALF"))
    .map((r) => ({ id: r.id, label: r.name ? `${r.name} (${r.tag})` : r.tag }));
}

function detailFor(r: HerdRow): string {
  const bits: string[] = [r.classLabel.toLowerCase()];
  if (r.daysInMilk != null) bits.push(`${r.daysInMilk} d in milk`);
  if (r.reproStatus === "PREGNANT" && r.expectedCalvingOn) bits.push(`calving ${r.expectedCalvingOn}`);
  else if (r.reproStatus === "SERVED" && r.lastServiceOn) bits.push(`served ${r.lastServiceOn}`);
  return bits.join(", ");
}
