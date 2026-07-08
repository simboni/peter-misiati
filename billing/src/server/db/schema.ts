import { sqliteTable, text, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// Conventions
//   • Money  -> integer MINOR units (KES cents). Never floats.
//   • VAT    -> basis points (1600 = 16.00%).
//   • Qty    -> integer THOUSANDTHS (2.5 => 2500) to allow fractional hours/qty.
//   • Dates  -> stored as unix-ms integers (Drizzle `timestamp_ms` <-> JS Date).
//   • IDs    -> random UUID strings.
// ---------------------------------------------------------------------------

const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" }).$defaultFn(() => new Date()).notNull();
const updatedAt = () =>
  integer("updated_at", { mode: "timestamp_ms" })
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date())
    .notNull();

// ===========================================================================
// better-auth core tables (field property keys MUST match better-auth fieldNames)
// ===========================================================================
export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  // Platform (cross-tenant) admin flags. Regular vendors have both false.
  // superAdmin can appoint/remove admins and change platform money settings;
  // platformAdmin can run day-to-day ops. Bootstrapped from OWNER_EMAILS.
  isPlatformAdmin: integer("is_platform_admin", { mode: "boolean" }).notNull().default(false),
  isSuperAdmin: integer("is_super_admin", { mode: "boolean" }).notNull().default(false),
  disabled: integer("disabled", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  // added by the organization plugin
  activeOrganizationId: text("active_organization_id"),
});

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

// ===========================================================================
// better-auth organization plugin tables
// ===========================================================================
export const organization = sqliteTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  metadata: text("metadata"),
});

export const member = sqliteTable(
  "member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("member_org_idx").on(t.organizationId), index("member_user_idx").on(t.userId)],
);

export const invitation = sqliteTable("invitation", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role"),
  status: text("status").notNull().default("pending"),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  inviterId: text("inviter_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

// ===========================================================================
// Business tables — every row scoped by organizationId (the vendor/tenant)
// ===========================================================================
export const orgProfile = sqliteTable("org_profile", {
  id: id(),
  organizationId: text("organization_id")
    .notNull()
    .unique()
    .references(() => organization.id, { onDelete: "cascade" }),
  legalName: text("legal_name"),
  kraPin: text("kra_pin"),
  vatRegistered: integer("vat_registered", { mode: "boolean" }).notNull().default(false),
  defaultVatRateBps: integer("default_vat_rate_bps").notNull().default(1600),
  currency: text("currency").notNull().default("KES"),
  email: text("email"),
  phone: text("phone"),
  addressLine1: text("address_line1"),
  addressLine2: text("address_line2"),
  city: text("city"),
  country: text("country").notNull().default("Kenya"),
  logoUrl: text("logo_url"),
  bankDetails: text("bank_details"),
  invoiceFooter: text("invoice_footer"),
  // Document look: which layout + accent colour the vendor's documents use.
  // Only applied on the paid (white-label) plan; free documents render the
  // default Tally look and carry a "Powered by Tally" mark.
  invoiceTemplate: text("invoice_template").notNull().default("column"),
  accentColor: text("accent_color").notNull().default("#0e9f6e"),
  // Subscription plan. "free" = Tally-branded, customization locked.
  // "pro" = white-label: own logo, template & colour, no Tally mark.
  plan: text("plan").notNull().default("free"),
  planRequestedAt: integer("plan_requested_at", { mode: "timestamp" }),
  planActivatedAt: integer("plan_activated_at", { mode: "timestamp" }),
  // Optional per-seat price override (whole KES) set by an admin for this vendor.
  planPriceOverrideKes: integer("plan_price_override_kes"),
  // Admin-controlled account state. A suspended workspace is blocked from the app.
  suspended: integer("suspended", { mode: "boolean" }).notNull().default(false),
  adminNote: text("admin_note"),
  // Per-vendor M-Pesa (Kopo Kopo). Secrets are stored AES-GCM encrypted.
  // When disabled/empty, the platform-level env credentials are used instead.
  kopokopoEnabled: integer("kopokopo_enabled", { mode: "boolean" }).notNull().default(false),
  kopokopoBaseUrl: text("kopokopo_base_url"),
  kopokopoTill: text("kopokopo_till"),
  kopokopoClientId: text("kopokopo_client_id"),
  kopokopoClientSecretEnc: text("kopokopo_client_secret_enc"),
  kopokopoApiKeyEnc: text("kopokopo_api_key_enc"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const numberSequence = sqliteTable(
  "number_sequence",
  {
    id: id(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    docType: text("doc_type").notNull(), // invoice | quotation | receipt | delivery_note
    prefix: text("prefix").notNull(),
    nextNumber: integer("next_number").notNull().default(1),
    padding: integer("padding").notNull().default(4),
  },
  (t) => [uniqueIndex("seq_org_doctype_idx").on(t.organizationId, t.docType)],
);

export const client = sqliteTable(
  "client",
  {
    id: id(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    contactPerson: text("contact_person"),
    email: text("email"),
    phone: text("phone"),
    kraPin: text("kra_pin"),
    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    city: text("city"),
    country: text("country"),
    currency: text("currency").notNull().default("KES"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("client_org_idx").on(t.organizationId)],
);

export const item = sqliteTable(
  "item",
  {
    id: id(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    unitPrice: integer("unit_price").notNull().default(0), // minor units
    unit: text("unit").notNull().default("unit"),
    taxRateBps: integer("tax_rate_bps").notNull().default(1600),
    kind: text("kind").notNull().default("service"), // service | good
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("item_org_idx").on(t.organizationId)],
);

export const invoice = sqliteTable(
  "invoice",
  {
    id: id(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => client.id),
    number: text("number").notNull(),
    type: text("type").notNull().default("invoice"), // invoice | quotation
    status: text("status").notNull().default("draft"),
    // draft | sent | partial | paid | overdue | void   (quotation: draft|sent|accepted|declined)
    issueDate: integer("issue_date", { mode: "timestamp_ms" }).notNull(),
    dueDate: integer("due_date", { mode: "timestamp_ms" }),
    currency: text("currency").notNull().default("KES"),
    notes: text("notes"),
    terms: text("terms"),
    // discount
    discountType: text("discount_type"), // percent | fixed | null
    discountValue: integer("discount_value").notNull().default(0), // bps if percent, minor units if fixed
    // deposit / downpayment requested
    depositType: text("deposit_type").notNull().default("none"), // none | percent | fixed
    depositValue: integer("deposit_value").notNull().default(0),
    depositAmount: integer("deposit_amount").notNull().default(0), // computed required deposit
    // computed money (minor units)
    subtotal: integer("subtotal").notNull().default(0),
    discountAmount: integer("discount_amount").notNull().default(0),
    taxTotal: integer("tax_total").notNull().default(0),
    total: integer("total").notNull().default(0),
    amountPaid: integer("amount_paid").notNull().default(0),
    // Total of credit notes applied against this invoice (reduces what is owed).
    creditedAmount: integer("credited_amount").notNull().default(0),
    balanceDue: integer("balance_due").notNull().default(0),
    shareToken: text("share_token").notNull().unique(),
    convertedFromId: text("converted_from_id"), // quotation this invoice was created from
    sentAt: integer("sent_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("invoice_org_idx").on(t.organizationId),
    index("invoice_client_idx").on(t.clientId),
    uniqueIndex("invoice_org_number_idx").on(t.organizationId, t.number),
  ],
);

export const invoiceLine = sqliteTable(
  "invoice_line",
  {
    id: id(),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoice.id, { onDelete: "cascade" }),
    itemId: text("item_id").references(() => item.id),
    // Item/service name (the line's headline). Nullable for pre-existing rows,
    // where the description doubled as the name.
    title: text("title"),
    description: text("description").notNull(), // optional detail beneath the name
    quantityMilli: integer("quantity_milli").notNull().default(1000), // thousandths
    unitPrice: integer("unit_price").notNull().default(0), // minor units
    taxRateBps: integer("tax_rate_bps").notNull().default(0),
    lineSubtotal: integer("line_subtotal").notNull().default(0),
    taxAmount: integer("tax_amount").notNull().default(0),
    lineTotal: integer("line_total").notNull().default(0),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("invoice_line_invoice_idx").on(t.invoiceId)],
);

export const payment = sqliteTable(
  "payment",
  {
    id: id(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoice.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => client.id),
    number: text("number").notNull(), // receipt number
    amount: integer("amount").notNull(), // minor units
    method: text("method").notNull().default("cash"), // cash|mpesa|bank|cheque|card|other
    reference: text("reference"),
    paidAt: integer("paid_at", { mode: "timestamp_ms" }).notNull(),
    kind: text("kind").notNull().default("partial"), // deposit|partial|balance|full
    note: text("note"),
    // provenance: null = recorded manually; "kopokopo" = collected via M-Pesa STK push
    provider: text("provider"),
    providerRef: text("provider_ref"),
    shareToken: text("share_token").notNull().unique(),
    createdAt: createdAt(),
  },
  (t) => [
    index("payment_org_idx").on(t.organizationId),
    index("payment_invoice_idx").on(t.invoiceId),
    uniqueIndex("payment_org_number_idx").on(t.organizationId, t.number),
  ],
);

// Online payment attempt (M-Pesa STK push). Kept separate from `payment` so the
// ledger only ever counts money actually received: an intent becomes a real
// payment (receipt) once the provider confirms success.
export const paymentIntent = sqliteTable(
  "payment_intent",
  {
    id: id(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoice.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => client.id),
    amount: integer("amount").notNull(), // minor units requested
    phone: text("phone").notNull(),
    provider: text("provider").notNull().default("kopokopo"),
    providerRef: text("provider_ref"), // provider resource id / status URL
    status: text("status").notNull().default("pending"), // pending|success|failed|canceled
    errorMessage: text("error_message"),
    paymentId: text("payment_id"), // the payment created on success
    mpesaReference: text("mpesa_reference"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("pi_org_idx").on(t.organizationId),
    index("pi_invoice_idx").on(t.invoiceId),
    index("pi_provider_ref_idx").on(t.providerRef),
  ],
);

export const deliveryNote = sqliteTable(
  "delivery_note",
  {
    id: id(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => client.id),
    invoiceId: text("invoice_id").references(() => invoice.id),
    number: text("number").notNull(),
    deliveryDate: integer("delivery_date", { mode: "timestamp_ms" }).notNull(),
    status: text("status").notNull().default("draft"), // draft | delivered
    receivedBy: text("received_by"),
    notes: text("notes"),
    shareToken: text("share_token").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("dn_org_idx").on(t.organizationId),
    uniqueIndex("dn_org_number_idx").on(t.organizationId, t.number),
  ],
);

export const deliveryNoteLine = sqliteTable(
  "delivery_note_line",
  {
    id: id(),
    deliveryNoteId: text("delivery_note_id")
      .notNull()
      .references(() => deliveryNote.id, { onDelete: "cascade" }),
    itemId: text("item_id").references(() => item.id),
    description: text("description").notNull(),
    quantityMilli: integer("quantity_milli").notNull().default(1000),
    unit: text("unit").notNull().default("unit"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("dn_line_dn_idx").on(t.deliveryNoteId)],
);

// ---------------------------------------------------------------- expenses

/** Business costs — the spend side of the books, for P&L reporting. */
export const expense = sqliteTable(
  "expense",
  {
    id: id(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    expenseDate: integer("expense_date", { mode: "timestamp_ms" }).notNull(),
    category: text("category"), // Rent, Transport, Supplies, Salaries…
    payee: text("payee"), // supplier / who it was paid to
    description: text("description").notNull(),
    amount: integer("amount").notNull().default(0), // gross, minor units
    taxAmount: integer("tax_amount").notNull().default(0), // input VAT, minor units
    method: text("method").notNull().default("cash"), // cash|mpesa|bank|cheque|card|other
    reference: text("reference"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("expense_org_idx").on(t.organizationId), index("expense_date_idx").on(t.expenseDate)],
);

// --------------------------------------------------------------- credit notes

/**
 * A credit note reduces what a client owes — for returned goods, an overcharge,
 * a cancellation or a correction. It carries VAT-aware line items (so output VAT
 * is reversed correctly) and its own numbering (CN-####). When applied to an
 * invoice it lowers that invoice's balance; it can also record that cash was
 * refunded to the client.
 */
export const creditNote = sqliteTable(
  "credit_note",
  {
    id: id(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => client.id),
    invoiceId: text("invoice_id").references(() => invoice.id), // optional link
    number: text("number").notNull(),
    issueDate: integer("issue_date", { mode: "timestamp_ms" }).notNull(),
    currency: text("currency").notNull().default("KES"),
    reason: text("reason"),
    notes: text("notes"),
    // computed money (minor units)
    subtotal: integer("subtotal").notNull().default(0),
    taxTotal: integer("tax_total").notNull().default(0),
    total: integer("total").notNull().default(0),
    // whether this credit reduced the linked invoice's balance
    appliedToInvoice: integer("applied_to_invoice", { mode: "boolean" }).notNull().default(false),
    // optional cash refund record
    refunded: integer("refunded", { mode: "boolean" }).notNull().default(false),
    refundMethod: text("refund_method"), // cash|mpesa|bank|cheque|card|other
    refundReference: text("refund_reference"),
    shareToken: text("share_token").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("cn_org_idx").on(t.organizationId),
    index("cn_invoice_idx").on(t.invoiceId),
    uniqueIndex("cn_org_number_idx").on(t.organizationId, t.number),
  ],
);

export const creditNoteLine = sqliteTable(
  "credit_note_line",
  {
    id: id(),
    creditNoteId: text("credit_note_id")
      .notNull()
      .references(() => creditNote.id, { onDelete: "cascade" }),
    title: text("title"),
    description: text("description").notNull(),
    quantityMilli: integer("quantity_milli").notNull().default(1000),
    unitPrice: integer("unit_price").notNull().default(0),
    taxRateBps: integer("tax_rate_bps").notNull().default(0),
    lineSubtotal: integer("line_subtotal").notNull().default(0),
    taxAmount: integer("tax_amount").notNull().default(0),
    lineTotal: integer("line_total").notNull().default(0),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("cn_line_idx").on(t.creditNoteId)],
);

// ---------------------------------------------------------- recurring invoices

/**
 * A recurring-invoice schedule (a.k.a. retainer / subscription template). It is
 * NOT itself an invoice — on each due date it spawns a real `invoice` row from
 * its stored template + lines, then advances `nextRunDate`. Generation is a
 * catch-up run (see server/recurring.ts) triggered when the vendor opens the app.
 */
export const recurringInvoice = sqliteTable(
  "recurring_invoice",
  {
    id: id(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => client.id),
    title: text("title"), // optional label, e.g. "Monthly retainer"
    frequency: text("frequency").notNull().default("monthly"), // weekly|monthly|quarterly|yearly
    interval: integer("interval").notNull().default(1), // every N frequency units
    startDate: integer("start_date", { mode: "timestamp_ms" }).notNull(),
    nextRunDate: integer("next_run_date", { mode: "timestamp_ms" }).notNull(),
    endDate: integer("end_date", { mode: "timestamp_ms" }), // optional stop date
    maxOccurrences: integer("max_occurrences"), // optional stop after N
    occurrences: integer("occurrences").notNull().default(0), // generated so far
    dueDays: integer("due_days").notNull().default(0), // invoice due N days after issue
    autoSend: integer("auto_send", { mode: "boolean" }).notNull().default(false),
    status: text("status").notNull().default("active"), // active|paused|ended
    // Invoice template fields (mirror the invoice row).
    currency: text("currency").notNull().default("KES"),
    notes: text("notes"),
    terms: text("terms"),
    discountType: text("discount_type"),
    discountValue: integer("discount_value").notNull().default(0),
    depositType: text("deposit_type").notNull().default("none"),
    depositValue: integer("deposit_value").notNull().default(0),
    lastRunAt: integer("last_run_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("recur_org_idx").on(t.organizationId),
    index("recur_next_idx").on(t.nextRunDate),
  ],
);

export const recurringInvoiceLine = sqliteTable(
  "recurring_invoice_line",
  {
    id: id(),
    recurringInvoiceId: text("recurring_invoice_id")
      .notNull()
      .references(() => recurringInvoice.id, { onDelete: "cascade" }),
    itemId: text("item_id").references(() => item.id),
    title: text("title"),
    description: text("description").notNull(),
    quantityMilli: integer("quantity_milli").notNull().default(1000),
    unitPrice: integer("unit_price").notNull().default(0),
    taxRateBps: integer("tax_rate_bps").notNull().default(0),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("recur_line_idx").on(t.recurringInvoiceId)],
);

// ------------------------------------------------------------- platform admin

/**
 * Single-row platform configuration, editable from the admin console. Secrets
 * are AES-GCM encrypted. Env values are used only as a fallback when a field
 * here is unset, so the app can run with everything managed from the UI.
 */
export const platformSettings = sqliteTable("platform_settings", {
  id: text("id").primaryKey().default("singleton"),
  // Pricing for the Pro (white-label) plan.
  pricePerSeatKes: integer("price_per_seat_kes").notNull().default(1000),
  currency: text("currency").notNull().default("KES"),
  // Platform-fallback M-Pesa (Kopo Kopo) account. Used when a vendor hasn't set
  // their own. Secrets encrypted at rest.
  kopokopoEnabled: integer("kopokopo_enabled", { mode: "boolean" }).notNull().default(false),
  kopokopoBaseUrl: text("kopokopo_base_url"),
  kopokopoTill: text("kopokopo_till"),
  kopokopoClientId: text("kopokopo_client_id"),
  kopokopoClientSecretEnc: text("kopokopo_client_secret_enc"),
  kopokopoApiKeyEnc: text("kopokopo_api_key_enc"),
  // Email (Resend).
  resendApiKeyEnc: text("resend_api_key_enc"),
  resendFrom: text("resend_from"),
  updatedAt: updatedAt(),
});

/** Append-only log of admin actions, for accountability. */
export const adminAuditLog = sqliteTable(
  "admin_audit_log",
  {
    id: id(),
    actorUserId: text("actor_user_id").notNull(),
    actorEmail: text("actor_email").notNull(),
    action: text("action").notNull(), // e.g. plan.activate, admin.promote, config.update
    targetType: text("target_type"), // organization | user | settings
    targetId: text("target_id"),
    targetLabel: text("target_label"),
    detail: text("detail"), // short human-readable summary
    createdAt: createdAt(),
  },
  (t) => [index("audit_created_idx").on(t.createdAt)],
);

// Convenience row types
export type Invoice = typeof invoice.$inferSelect;
export type InvoiceLine = typeof invoiceLine.$inferSelect;
export type Client = typeof client.$inferSelect;
export type Item = typeof item.$inferSelect;
export type Payment = typeof payment.$inferSelect;
export type PaymentIntent = typeof paymentIntent.$inferSelect;
export type DeliveryNote = typeof deliveryNote.$inferSelect;
export type Expense = typeof expense.$inferSelect;
export type RecurringInvoice = typeof recurringInvoice.$inferSelect;
export type RecurringInvoiceLine = typeof recurringInvoiceLine.$inferSelect;
export type CreditNote = typeof creditNote.$inferSelect;
export type CreditNoteLine = typeof creditNoteLine.$inferSelect;
export type OrgProfile = typeof orgProfile.$inferSelect;
export type User = typeof user.$inferSelect;
export type Organization = typeof organization.$inferSelect;
export type PlatformSettings = typeof platformSettings.$inferSelect;
export type AdminAuditLog = typeof adminAuditLog.$inferSelect;
