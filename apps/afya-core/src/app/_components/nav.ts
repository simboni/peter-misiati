/**
 * The navigation, as a hospital is actually organised.
 *
 * TWO LEVELS, AND ONLY ONE OPEN AT A TIME. The first level is a department —
 * the part of the building somebody works in. The second is the screens inside
 * it. A flat list of thirty-six links is not a menu, it is an inventory: it
 * makes a large system look like a long list rather than a deep one, and the
 * thing somebody needs is never the thing they can see.
 *
 * WHICH SECTION IS OPEN COMES FROM THE URL, NOT FROM STATE. The section
 * containing the current screen is the one expanded; every other one is
 * collapsed to a single line. No client JavaScript, no remembered state to go
 * stale, and a link somebody pastes to a colleague opens the same way it did
 * for them. Clicking a collapsed section navigates to its first screen, which
 * is what opens it — so the menu is never a thing you have to open before you
 * can use it.
 *
 * `permission` is ANY-OF. Seeing a worklist is not doing the work on it: an
 * administrator supervising the pharmacy gets the screen and no action buttons,
 * because the rule belongs on the action, not on the door.
 */

export interface NavLink {
  href: string;
  label: string;
  /** Any one of these opens it. Absent means everyone signed in. */
  permission?: string[];
  /** Which live count to show beside it, if any. */
  badge?: BadgeKey;
}

export interface NavSection {
  /** Stable key, used to decide which section the current URL belongs to. */
  key: string;
  title: string;
  /** The path this section leads to when its title is clicked. */
  href: string;
  /**
   * The count shown on the collapsed title — the one number that would make
   * somebody open this section. Null for sections where no single number does.
   */
  badge?: BadgeKey;
  links: NavLink[];
}

export type BadgeKey =
  | "waiting"
  | "counter"
  | "bench"
  | "unread"
  | "beds"
  | "owed"
  | "claims"
  | "preauth"
  | "etims"
  | "notifiable"
  | "deadLetters"
  | "unsettled"
  | "defaulters"
  | "antenatal"
  | "casualty"
  | "incidents"
  | "referrals"
  | "loopBroken"
  | "theatre"
  | "theatreBlocked"
  | "imaging"
  | "imagingCritical"
  | "requisitions"
  | "lateOrders"
  | "queriedInvoices"
  | "alerts";

export const NAV: NavSection[] = [
  {
    key: "today",
    title: "Today",
    href: "/",
    links: [],
  },
  {
    key: "patients",
    title: "Patients",
    href: "/patients",
    links: [
      { href: "/patients", label: "Find a patient", permission: ["patient.read"] },
      { href: "/patients/new", label: "Register a patient", permission: ["patient.register"] },
    ],
  },
  {
    key: "frontdesk",
    title: "Front desk",
    href: "/queue",
    badge: "waiting",
    links: [
      { href: "/queue", label: "Waiting list", permission: ["queue.manage"], badge: "waiting" },
      { href: "/appointments", label: "Appointments", permission: ["queue.manage"] },
    ],
  },
  {
    key: "casualty",
    title: "Casualty",
    href: "/casualty",
    badge: "casualty",
    links: [
      { href: "/casualty", label: "The board", permission: ["patient.read"], badge: "casualty" },
      { href: "/casualty?view=incidents", label: "Mass casualty", permission: ["patient.read"], badge: "incidents" },
      { href: "/casualty?view=log", label: "Log", permission: ["patient.read"] },
    ],
  },
  {
    key: "inpatient",
    title: "Wards & theatre",
    href: "/ward",
    badge: "beds",
    links: [
      { href: "/ward", label: "Bed board", permission: ["patient.read"], badge: "beds" },
      { href: "/ward?view=charts", label: "Drug charts", permission: ["patient.read"] },
      { href: "/theatre", label: "Theatre list", permission: ["patient.read"], badge: "theatre" },
      { href: "/theatre?view=running", label: "In theatre", permission: ["patient.read"], badge: "theatreBlocked" },
      { href: "/theatre?view=log", label: "Theatre log", permission: ["patient.read"] },
    ],
  },
  {
    key: "maternity",
    title: "Maternity & child health",
    href: "/maternity",
    badge: "antenatal",
    links: [
      { href: "/maternity", label: "Antenatal clinic", permission: ["patient.read"], badge: "antenatal" },
      { href: "/maternity?view=births", label: "Deliveries & births", permission: ["patient.read"] },
      { href: "/maternity?view=postnatal", label: "Postnatal follow-up", permission: ["patient.read"] },
      { href: "/maternity?view=immunisation", label: "Immunisation", permission: ["patient.read"] },
    ],
  },
  {
    key: "diagnostics",
    title: "Diagnostics",
    href: "/laboratory",
    badge: "bench",
    links: [
      { href: "/laboratory", label: "Laboratory bench", permission: ["lab.result.release", "report.read"], badge: "bench" },
      { href: "/laboratory?view=unread", label: "Results to acknowledge", permission: ["patient.read"], badge: "unread" },
      { href: "/radiology", label: "Imaging worklist", permission: ["patient.read"], badge: "imaging" },
      { href: "/radiology?view=critical", label: "Critical findings", permission: ["patient.read"], badge: "imagingCritical" },
      { href: "/radiology?view=log", label: "Imaging log", permission: ["patient.read"] },
    ],
  },
  {
    key: "programmes",
    title: "Programme registers",
    href: "/programmes",
    badge: "defaulters",
    links: [
      { href: "/programmes", label: "The registers", permission: ["patient.read"] },
      { href: "/programmes?view=defaulters", label: "Not come back", permission: ["patient.read"], badge: "defaulters" },
      { href: "/programmes?view=cohorts", label: "Cohort report", permission: ["patient.read"] },
    ],
  },
  {
    key: "referrals",
    title: "Referrals",
    href: "/referrals",
    badge: "referrals",
    links: [
      { href: "/referrals", label: "Out", permission: ["patient.read"], badge: "referrals" },
      { href: "/referrals?view=in", label: "In", permission: ["patient.read"] },
      { href: "/referrals?view=awaiting", label: "Never came back", permission: ["patient.read"], badge: "loopBroken" },
      { href: "/referrals?view=log", label: "Log", permission: ["patient.read"] },
    ],
  },
  {
    key: "pharmacy",
    title: "Pharmacy & stores",
    href: "/pharmacy",
    badge: "counter",
    links: [
      { href: "/pharmacy", label: "Dispensing counter", permission: ["dispense.perform", "report.read"], badge: "counter" },
      { href: "/stock", label: "Stock position", permission: ["report.read"] },
      { href: "/stock?view=receive", label: "Take delivery", permission: ["report.read"] },
      { href: "/stock?view=expiry", label: "Expiring stock", permission: ["report.read"] },
      { href: "/stock?view=reorder", label: "Reorder report", permission: ["report.read"] },
      { href: "/stock?view=controlled", label: "Controlled register", permission: ["report.read"] },
      { href: "/procurement", label: "Requisitions", permission: ["report.read"], badge: "requisitions" },
      { href: "/procurement?view=orders", label: "Purchase orders", permission: ["report.read"], badge: "lateOrders" },
      { href: "/procurement?view=invoices", label: "Invoices & matching", permission: ["report.read"], badge: "queriedInvoices" },
      { href: "/procurement?view=suppliers", label: "Suppliers", permission: ["report.read"] },
    ],
  },
  {
    key: "money",
    title: "Money",
    href: "/payments",
    badge: "owed",
    links: [
      { href: "/payments", label: "Till & payments", permission: ["payment.receive"], badge: "owed" },
      { href: "/invoices", label: "Invoices", permission: ["report.read", "billing.charge"] },
      { href: "/invoices?view=etims", label: "eTIMS queue", permission: ["report.read"], badge: "etims" },
      { href: "/claims", label: "Claims", permission: ["claim.prepare", "report.read"], badge: "claims" },
      { href: "/claims?view=preauth", label: "Pre-authorisations", permission: ["preauth.request", "report.read"], badge: "preauth" },
      { href: "/remittance", label: "Remittance", permission: ["claim.prepare", "report.read"], badge: "unsettled" },
      { href: "/remittance?view=taxonomy", label: "Why claims fail", permission: ["claim.prepare", "report.read"] },
    ],
  },
  {
    key: "reports",
    title: "Reports",
    href: "/reports",
    badge: "notifiable",
    links: [
      { href: "/reports", label: "MOH returns", permission: ["report.read"] },
      { href: "/reports?view=notifiable", label: "Notifiable diseases", permission: ["report.read"], badge: "notifiable" },
      { href: "/reports?view=revenue", label: "Revenue & leakage", permission: ["report.read"] },
      { href: "/reports?view=activity", label: "Clinical activity", permission: ["report.read"] },
    ],
  },
  {
    key: "admin",
    title: "Administration",
    href: "/admin",
    badge: "deadLetters",
    links: [
      { href: "/admin", label: "Facility & compliance", permission: ["facility.configure", "user.manage"] },
      { href: "/admin?view=staff", label: "Staff & licences", permission: ["user.manage"] },
      { href: "/admin?view=tariffs", label: "Services & tariffs", permission: ["facility.configure"] },
      { href: "/admin?view=integrations", label: "Integrations", permission: ["facility.configure"], badge: "deadLetters" },
      { href: "/audit", label: "Audit log", permission: ["audit.read", "facility.configure"] },
    ],
  },
];

/** The sections a user may see, with the links they may see inside each. */
export function navFor(granted: string[]): NavSection[] {
  const allowed = new Set(granted);
  return NAV.map((section) => ({
    ...section,
    links: section.links.filter(
      (link) => !link.permission || link.permission.some((p) => allowed.has(p)),
    ),
  })).filter(
    // A section with a destination but no visible links is still worth showing
    // (Today has none by design); one whose links have all been filtered away
    // is not.
    (section) => section.links.length > 0 || section.key === "today",
  );
}

/**
 * Which section the current path belongs to.
 *
 * Matched on the path alone, ignoring the query, so every view of a screen
 * keeps the same section open — moving between the casualty board and the
 * casualty log should not make the menu jump.
 */
export function sectionFor(current: string): string {
  const path = current.split("?")[0];
  // Longest matching href wins, so /patients/new does not match /patients
  // before it matches its own section, and / only matches itself.
  let best: { key: string; length: number } | null = null;
  for (const section of NAV) {
    for (const candidate of [section.href, ...section.links.map((l) => l.href)]) {
      const candidatePath = candidate.split("?")[0];
      const matches = candidatePath === "/" ? path === "/" : path.startsWith(candidatePath);
      if (matches && (!best || candidatePath.length > best.length)) {
        best = { key: section.key, length: candidatePath.length };
      }
    }
  }
  return best?.key ?? "today";
}
