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
  invoiceTemplate: text("invoice_template").notNull().default("column"),
  accentColor: text("accent_color").notNull().default("#0e9f6e"),
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
    description: text("description").notNull(),
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

// Convenience row types
export type Invoice = typeof invoice.$inferSelect;
export type InvoiceLine = typeof invoiceLine.$inferSelect;
export type Client = typeof client.$inferSelect;
export type Item = typeof item.$inferSelect;
export type Payment = typeof payment.$inferSelect;
export type DeliveryNote = typeof deliveryNote.$inferSelect;
export type OrgProfile = typeof orgProfile.$inferSelect;
