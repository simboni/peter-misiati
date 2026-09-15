/**
 * The navigation, as a hospital is actually organised.
 *
 * Grouped by the part of the building the work happens in, not by the module
 * that implements it — a receptionist does not think "M13", they think "the
 * front desk". The groups are the departments a facility already has, so
 * somebody who has worked a counter can find things without being taught.
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

export interface NavGroup {
  title: string;
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
  | "alerts";

export const NAV: NavGroup[] = [
  {
    title: "Front desk",
    links: [
      { href: "/", label: "Today" },
      { href: "/queue", label: "Waiting list", permission: ["queue.manage"], badge: "waiting" },
      { href: "/appointments", label: "Appointments", permission: ["queue.manage"] },
      { href: "/patients", label: "Find a patient", permission: ["patient.read"] },
      { href: "/patients/new", label: "Register a patient", permission: ["patient.register"] },
    ],
  },
  {
    title: "Clinical",
    links: [
      { href: "/ward", label: "Ward & beds", permission: ["patient.read"], badge: "beds" },
      { href: "/ward?view=charts", label: "Drug charts", permission: ["patient.read"] },
      { href: "/laboratory", label: "Laboratory bench", permission: ["lab.result.release", "report.read"], badge: "bench" },
      { href: "/laboratory?view=unread", label: "Results to acknowledge", permission: ["patient.read"], badge: "unread" },
    ],
  },
  {
    title: "Pharmacy & stores",
    links: [
      { href: "/pharmacy", label: "Dispensing counter", permission: ["dispense.perform", "report.read"], badge: "counter" },
      { href: "/stock", label: "Stock position", permission: ["report.read"] },
      { href: "/stock?view=receive", label: "Take delivery", permission: ["report.read"] },
      { href: "/stock?view=expiry", label: "Expiring stock", permission: ["report.read"] },
      { href: "/stock?view=reorder", label: "Reorder report", permission: ["report.read"] },
      { href: "/stock?view=controlled", label: "Controlled register", permission: ["report.read"] },
    ],
  },
  {
    title: "Money",
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
    title: "Reports",
    links: [
      { href: "/reports", label: "MOH returns", permission: ["report.read"] },
      { href: "/reports?view=notifiable", label: "Notifiable diseases", permission: ["report.read"], badge: "notifiable" },
      { href: "/reports?view=revenue", label: "Revenue & leakage", permission: ["report.read"] },
      { href: "/reports?view=clinical", label: "Clinical activity", permission: ["report.read"] },
    ],
  },
  {
    title: "Administration",
    links: [
      { href: "/admin", label: "Facility & compliance", permission: ["facility.configure"] },
      { href: "/admin?view=staff", label: "Staff & licences", permission: ["user.manage"] },
      { href: "/admin?view=devices", label: "Devices", permission: ["device.manage"] },
      { href: "/admin?view=integrations", label: "Integrations", permission: ["facility.configure"], badge: "deadLetters" },
      { href: "/admin?view=tariffs", label: "Tariffs & services", permission: ["tariff.manage"] },
      { href: "/audit", label: "Audit log", permission: ["audit.read"] },
    ],
  },
];

/** The links this person may open, groups with nothing in them dropped. */
export function navFor(granted: string[]): NavGroup[] {
  return NAV.map((group) => ({
    ...group,
    links: group.links.filter((l) => !l.permission || l.permission.some((p) => granted.includes(p))),
  })).filter((group) => group.links.length > 0);
}
