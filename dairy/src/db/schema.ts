/**
 * Dairy Management System — database schema.
 *
 * Principles this schema encodes (see docs/dairy/05-data-model.md):
 *   P1  Store events, derive state. Animal class is a view, never a column.
 *   P2  Client generates the UUID, so `onConflictDoNothing` makes an offline
 *       double-flush harmless.
 *   P3  Append-only for high-volume capture; corrections are new rows.
 *   P4  farmId on every table, filtered in every query. RLS is the second lock.
 *   P5  Reference data is versioned with effective dates.
 *   P6  Money is numeric, never float. Drizzle returns numeric as string.
 *   P8  Units are never implicit: quantity + unit + unitWeightKg, always.
 */
import {
  pgTable,
  text,
  uuid,
  date,
  timestamp,
  boolean,
  numeric,
  integer,
  smallint,
  jsonb,
  unique,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ */
/* Domain unions — single source of truth, re-exported by lib/domain   */
/* ------------------------------------------------------------------ */

export const ROLES = ["OWNER", "MANAGER", "HERDSMAN", "RIDER", "VET", "ACCOUNTANT"] as const;
export type Role = (typeof ROLES)[number];

export const ANIMAL_CLASSES = [
  "CALF", "WEANER", "HEIFER", "BULLING_HEIFER", "SERVED_HEIFER", "INCALF_HEIFER",
  "SPRINGER", "FIRST_CALVER", "LACTATING_COW", "DRY_COW", "MATURE_COW",
  "CULL_COW", "BULL", "BULL_CALF", "STEER",
] as const;
export type AnimalClass = (typeof ANIMAL_CLASSES)[number];

export const REPRO_STATUSES = ["OPEN", "SERVED", "PREGNANT", "FRESH", "DRY"] as const;
export type ReproStatus = (typeof REPRO_STATUSES)[number];

export const SESSIONS = ["MORNING", "NOON", "EVENING"] as const;
export type MilkingSession = (typeof SESSIONS)[number];

export const DISPOSAL_CHANNELS = [
  "COOP", "PROCESSOR", "INSTITUTION", "HOUSEHOLD", "SHOP", "MILK_ATM",
  "HOME_CONSUMPTION", "CALF_FEEDING", "STAFF_RATION",
  "SPOILAGE", "REJECTED", "WITHHELD_TREATMENT", "WITHHELD_COLOSTRUM",
] as const;
export type DisposalChannel = (typeof DISPOSAL_CHANNELS)[number];

/** Channels that bring money in. Everything else is valued but unpaid, or a loss. */
export const REVENUE_CHANNELS = [
  "COOP", "PROCESSOR", "INSTITUTION", "HOUSEHOLD", "SHOP", "MILK_ATM",
] as const;
/** Channels that must be blocked while an animal is under milk withdrawal. */
export const SALEABLE_CHANNELS = REVENUE_CHANNELS;
export const LOSS_CHANNELS = [
  "SPOILAGE", "REJECTED", "WITHHELD_TREATMENT", "WITHHELD_COLOSTRUM",
] as const;

export const CUSTOMER_TYPES = [
  "COOP", "PROCESSOR", "INSTITUTION", "HOUSEHOLD", "SHOP", "MILK_ATM",
] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

export const PAYMENT_TERMS = [
  "CASH", "DAILY", "WEEKLY", "FORTNIGHTLY", "MONTHLY", "NET_30", "NET_60", "NET_90",
] as const;
export type PaymentTerms = (typeof PAYMENT_TERMS)[number];

export const FEED_CATEGORIES = ["FODDER", "CONCENTRATE", "MINERAL", "WATER", "OTHER"] as const;
export type FeedCategory = (typeof FEED_CATEGORIES)[number];

export const ANIMAL_GROUPS = ["LACTATING", "DRY", "HEIFERS", "CALVES", "BULLS", "ALL"] as const;
export type AnimalGroup = (typeof ANIMAL_GROUPS)[number];

export const EXPENSE_CATEGORIES = [
  "FEEDS", "LABOUR", "VETERINARY", "BREEDING", "MILK_MARKETING", "UTILITIES",
  "MACHINERY", "COOLING", "RENT", "LOAN", "INSURANCE", "BEDDING", "LICENCES",
  "MANURE", "TRANSPORT", "LIVESTOCK", "OTHER",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const PAYMENT_METHODS = ["CASH", "MPESA", "BANK", "COOP_CHECKOFF", "CREDIT", "CHEQUE"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Who we buy from and who provides services. Shared so all modules agree. */
export const COUNTERPARTY_TYPES = [
  "AGROVET", "FEED_MILLER", "HAY", "AI_PROVIDER", "VET", "PARAVET",
  "TRANSPORTER", "TRANSPORT_HIRE", "COOP", "PROCESSOR", "BROKER",
  "SACCO", "LABOUR", "OTHER",
] as const;
export type CounterpartyType = (typeof COUNTERPARTY_TYPES)[number];

/** Who bought the animal. Drives the price record, and differs by channel. */
export const TRADE_COUNTERPARTY_KINDS = [
  "FARMER", "BROKER", "COOP", "BUTCHERY", "KMC", "OTHER",
] as const;
export type TradeCounterpartyKind = (typeof TRADE_COUNTERPARTY_KINDS)[number];

/* ------------------------------------------------------------------ */
/* Foundation                                                          */
/* ------------------------------------------------------------------ */

export const farm = pgTable("farm", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  county: text("county"),
  systemType: text("system_type").$type<"ZERO_GRAZING" | "SEMI_INTENSIVE" | "OPEN_GRAZING">()
    .notNull().default("ZERO_GRAZING"),
  /** 2 or 3. Changeable over time — historical records keep their own session. */
  milkingSessions: smallint("milking_sessions").notNull().default(2),
  currency: text("currency").notNull().default("KES"),
  /**
   * Legal determinant, not a preference: raw milk may be sold direct to
   * neighbouring consumers in RURAL areas only. See docs 02 §2.7.
   */
  areaClass: text("area_class").$type<"RURAL" | "URBAN">().notNull().default("RURAL"),
  memberNo: text("member_no"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const appUser = pgTable("app_user", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull().references(() => farm.id),
  fullName: text("full_name").notNull(),
  photoUrl: text("photo_url"),
  phone: text("phone"),
  /** scrypt(pin, salt) — never the PIN itself. */
  pinHash: text("pin_hash").notNull(),
  role: text("role").$type<Role>().notNull(),
  language: text("language").$type<"en" | "sw">().notNull().default("en"),
  active: boolean("active").notNull().default(true),
}, (t) => [index("app_user_farm_idx").on(t.farmId, t.active)]);

/**
 * Versioned reference data. One pattern, many uses — milk prices, wage minima,
 * gestation constants, the CBK base rate, feed rules. Historical records must
 * keep the value that applied at the time, so nothing here is ever updated in
 * place; a new row supersedes with a later effectiveFrom.
 */
export const referenceValue = pgTable("reference_value", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").references(() => farm.id),
  kind: text("kind").notNull(),
  key: text("key").notNull(),
  valueNumeric: numeric("value_numeric", { precision: 14, scale: 4 }),
  valueText: text("value_text"),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
  source: text("source"),
}, (t) => [index("refval_lookup_idx").on(t.farmId, t.kind, t.key, t.effectiveFrom)]);

export const auditEntry = pgTable("audit_entry", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  tableName: text("table_name").notNull(),
  rowId: uuid("row_id").notNull(),
  action: text("action").$type<"INSERT" | "UPDATE" | "DELETE" | "APPROVE">().notNull(),
  actorId: uuid("actor_id").notNull().references(() => appUser.id),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  before: jsonb("before"),
  after: jsonb("after"),
}, (t) => [index("audit_row_idx").on(t.farmId, t.tableName, t.rowId)]);

/**
 * The M-Pesa pattern: every save produces a short, speakable reference code and
 * a rendered plain-language line, stored so it never changes even if the
 * underlying record is later corrected.
 */
export const receipt = pgTable("receipt", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  refCode: text("ref_code").notNull(),
  kind: text("kind").notNull(),
  summary: text("summary").notNull(),
  actorId: uuid("actor_id").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  payload: jsonb("payload"),
}, (t) => [
  unique("receipt_ref_uq").on(t.farmId, t.refCode),
  index("receipt_recent_idx").on(t.farmId, t.at),
]);

/* ------------------------------------------------------------------ */
/* M1 — Herd                                                           */
/* ------------------------------------------------------------------ */

export const animal = pgTable("animal", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull().references(() => farm.id),
  tag: text("tag").notNull(),
  name: text("name"),
  sex: text("sex").$type<"F" | "M">().notNull(),
  breedComposition: text("breed_composition"),
  /** Drives gestation length. Falls back to the 283-day Kenyan default. */
  primaryBreed: text("primary_breed"),
  dateOfBirth: date("date_of_birth"),
  dobEstimated: boolean("dob_estimated").notNull().default(false),
  sireId: uuid("sire_id").references((): AnyPgColumn => animal.id),
  damId: uuid("dam_id").references((): AnyPgColumn => animal.id),
  sireStrawCode: text("sire_straw_code"),
  origin: text("origin").$type<"BORN" | "PURCHASED" | "GIFT" | "DONATION">().notNull(),
  enteredHerdOn: date("entered_herd_on").notNull(),
  purchasePriceKes: numeric("purchase_price_kes", { precision: 14, scale: 2 }),
  klbaRegNo: text("klba_reg_no"),
  photoUrl: text("photo_url"),
  /** ONLY for bought-in animals whose history we don't have. Wins over derivation. */
  classOverride: text("class_override").$type<AnimalClass>(),
  castrated: boolean("castrated").notNull().default(false),
  notes: text("notes"),
}, (t) => [
  unique("animal_tag_uq").on(t.farmId, t.tag),
  index("animal_farm_idx").on(t.farmId),
]);

export const animalExit = pgTable("animal_exit", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  animalId: uuid("animal_id").notNull().references(() => animal.id),
  exitDate: date("exit_date").notNull(),
  reason: text("reason")
    .$type<"SOLD" | "DIED" | "SLAUGHTERED" | "CULLED" | "STOLEN" | "LOST">().notNull(),
  cause: text("cause"),
  valueKes: numeric("value_kes", { precision: 14, scale: 2 }),
  counterpartyId: uuid("counterparty_id"),
  // What actually drove the price in a Kenyan market
  classAtExit: text("class_at_exit").$type<AnimalClass>(),
  weightKg: numeric("weight_kg", { precision: 8, scale: 2 }),
  monthsPregnant: numeric("months_pregnant", { precision: 3, scale: 1 }),
  dailyYieldAtSaleL: numeric("daily_yield_at_sale_l", { precision: 6, scale: 2 }),
  daysInMilkAtSale: integer("days_in_milk_at_sale"),
  counterpartyKind: text("counterparty_kind").$type<TradeCounterpartyKind>(),
  paymentMethod: text("payment_method").$type<PaymentMethod>(),
  recordedBy: uuid("recorded_by").notNull(),
}, (t) => [
  index("animal_exit_idx").on(t.farmId, t.animalId),
  /** An animal leaves the herd once. Makes a replayed offline flush safe in
   *  the database rather than only in application code. */
  unique("animal_exit_uq").on(t.farmId, t.animalId),
]);

export const weightObservation = pgTable("weight_observation", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  animalId: uuid("animal_id").notNull().references(() => animal.id),
  observedOn: date("observed_on").notNull(),
  weightKg: numeric("weight_kg", { precision: 8, scale: 2 }),
  method: text("method").$type<"SCALE" | "HEART_GIRTH" | "ESTIMATE">(),
  /** 1.00–5.00 in 0.25 steps. A dated observation, never a static attribute. */
  bcs: numeric("bcs", { precision: 3, scale: 2 }),
  recordedBy: uuid("recorded_by").notNull(),
}, (t) => [index("weight_animal_idx").on(t.farmId, t.animalId, t.observedOn)]);

/* ------------------------------------------------------------------ */
/* M2 — Breeding                                                       */
/* ------------------------------------------------------------------ */

export const heatObservation = pgTable("heat_observation", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  animalId: uuid("animal_id").notNull().references(() => animal.id),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  sign: text("sign").$type<
    "STANDING" | "MOUNTING_OTHERS" | "MUCUS" | "RESTLESS" | "SWOLLEN_VULVA" | "YIELD_DROP"
  >(),
  recordedBy: uuid("recorded_by").notNull(),
}, (t) => [index("heat_animal_idx").on(t.farmId, t.animalId, t.observedAt)]);

export const service = pgTable("service", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  animalId: uuid("animal_id").notNull().references(() => animal.id),
  servedOn: date("served_on").notNull(),
  serviceType: text("service_type").$type<"AI" | "NATURAL" | "ET">().notNull(),
  semenType: text("semen_type").$type<"CONVENTIONAL" | "SEXED">(),
  strawCode: text("straw_code"),
  strawBatch: text("straw_batch"),
  sireBreed: text("sire_breed"),
  bullId: uuid("bull_id").references((): AnyPgColumn => animal.id),
  inseminatorId: uuid("inseminator_id"),
  serviceNumber: smallint("service_number").notNull().default(1),
  costKes: numeric("cost_kes", { precision: 14, scale: 2 }),
  costSettledBy: text("cost_settled_by").$type<"CASH" | "CREDIT" | "COOP_CHECKOFF">(),
  // Derived at insert so the calendar stays stable even if constants change later
  expectedReturnOn: date("expected_return_on"),
  pdDueOn: date("pd_due_on"),
  expectedCalvingOn: date("expected_calving_on"),
  recordedBy: uuid("recorded_by").notNull(),
}, (t) => [
  index("service_animal_idx").on(t.farmId, t.animalId, t.servedOn),
  index("service_edd_idx").on(t.farmId, t.expectedCalvingOn),
]);

export const pregnancyCheck = pgTable("pregnancy_check", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  serviceId: uuid("service_id").references(() => service.id),
  animalId: uuid("animal_id").notNull().references(() => animal.id),
  checkedOn: date("checked_on").notNull(),
  method: text("method")
    .$type<"PALPATION" | "ULTRASOUND" | "PROGESTERONE" | "PAG" | "NON_RETURN">().notNull(),
  result: text("result").$type<"POSITIVE" | "NEGATIVE" | "INCONCLUSIVE">().notNull(),
  monthsPregnant: numeric("months_pregnant", { precision: 3, scale: 1 }),
  performedBy: uuid("performed_by"),
  costKes: numeric("cost_kes", { precision: 14, scale: 2 }),
  expenseId: uuid("expense_id"),
  recordedBy: uuid("recorded_by").notNull(),
}, (t) => [index("pd_animal_idx").on(t.farmId, t.animalId, t.checkedOn)]);

export const calving = pgTable("calving", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  damId: uuid("dam_id").notNull().references(() => animal.id),
  serviceId: uuid("service_id").references(() => service.id),
  calvedOn: date("calved_on").notNull(),
  /** 1 unassisted · 2 easy pull · 3 hard pull · 4 vet assisted · 5 caesarean */
  calvingEase: smallint("calving_ease"),
  numberBorn: smallint("number_born").notNull().default(1),
  /** Flag if the placenta is not passed within 6–12 hours. */
  retainedPlacenta: boolean("retained_placenta").notNull().default(false),
  milkFever: boolean("milk_fever").notNull().default(false),
  assistedBy: uuid("assisted_by"),
  notes: text("notes"),
  recordedBy: uuid("recorded_by").notNull(),
}, (t) => [index("calving_dam_idx").on(t.farmId, t.damId, t.calvedOn)]);

export const calvingOutcome = pgTable("calving_outcome", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  calvingId: uuid("calving_id").notNull().references(() => calving.id),
  outcome: text("outcome")
    .$type<"LIVE" | "STILLBIRTH" | "DIED_UNDER_24H" | "ABORTION">().notNull(),
  calfSex: text("calf_sex").$type<"F" | "M">(),
  birthWeightKg: numeric("birth_weight_kg", { precision: 6, scale: 2 }),
  /** The CALF record this created, when the outcome was LIVE. */
  animalId: uuid("animal_id").references(() => animal.id),
});

export const dryOff = pgTable("dry_off", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  animalId: uuid("animal_id").notNull().references(() => animal.id),
  driedOn: date("dried_on").notNull(),
  method: text("method").$type<"ABRUPT" | "GRADUAL">(),
  /** Dry cow therapy sets its own long withdrawal — see healthEvent. */
  dryCowTherapyProductId: uuid("dry_cow_therapy_product_id"),
  recordedBy: uuid("recorded_by").notNull(),
}, (t) => [index("dryoff_animal_idx").on(t.farmId, t.animalId, t.driedOn)]);

/* ------------------------------------------------------------------ */
/* M4 — Customers, routes, standing orders, ledger                     */
/* ------------------------------------------------------------------ */

export const deliveryRoute = pgTable("delivery_route", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  name: text("name").notNull(),
  riderId: uuid("rider_id").references(() => appUser.id),
  session: text("session").$type<MilkingSession>(),
});

export const customer = pgTable("customer", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull().references(() => farm.id),
  name: text("name").notNull(),
  customerType: text("customer_type").$type<CustomerType>().notNull(),
  institutionKind: text("institution_kind")
    .$type<"SCHOOL" | "HOSPITAL" | "HOTEL" | "RESTAURANT" | "COLLEGE" | "OTHER">(),
  phone: text("phone"),
  location: text("location"),
  /** LEGAL DETERMINANT — raw milk direct sale is a rural-area permission. */
  areaClass: text("area_class").$type<"RURAL" | "URBAN">().notNull().default("RURAL"),
  /** LICENSING BOUNDARY — our vehicle likely needs a milk carriage permit. */
  fulfilment: text("fulfilment")
    .$type<"GATE_COLLECTION" | "DELIVERED">().notNull().default("DELIVERED"),
  routeId: uuid("route_id").references(() => deliveryRoute.id),
  paymentTerms: text("payment_terms").$type<PaymentTerms>().notNull().default("CASH"),
  settlementDay: smallint("settlement_day"),
  creditLimitKes: numeric("credit_limit_kes", { precision: 14, scale: 2 }),
  contractRef: text("contract_ref"),
  kraPin: text("kra_pin"),
  requiresInvoice: boolean("requires_invoice").notNull().default(false),
  requiresDeliveryNote: boolean("requires_delivery_note").notNull().default(false),
  agpoCategory: text("agpo_category").$type<"YOUTH" | "WOMEN" | "PWD">(),
  // Counterparty risk runs both ways — New KCC once owed farmers KES 300m
  avgDaysToPay: numeric("avg_days_to_pay", { precision: 6, scale: 1 }),
  worstDaysToPay: integer("worst_days_to_pay"),
  active: boolean("active").notNull().default(true),
  suspendedReason: text("suspended_reason"),
  startedOn: date("started_on"),
  endedOn: date("ended_on"),
}, (t) => [index("customer_farm_idx").on(t.farmId, t.customerType, t.active)]);

/**
 * "Mama Njeri takes 2 L every morning." This is what makes the delivery round
 * two taps instead of forty — the sheet generates from here, prefilled.
 */
export const standingOrder = pgTable("standing_order", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  customerId: uuid("customer_id").notNull().references(() => customer.id),
  routeId: uuid("route_id").references(() => deliveryRoute.id),
  litres: numeric("litres", { precision: 6, scale: 2 }).notNull(),
  session: text("session").$type<MilkingSession>().notNull(),
  /** ISO weekdays 1=Mon … 7=Sun. Schools stop at weekends. */
  daysOfWeek: smallint("days_of_week").array().notNull(),
  rateKesPerLitre: numeric("rate_kes_per_litre", { precision: 8, scale: 2 }),
  activeFrom: date("active_from").notNull(),
  activeTo: date("active_to"),
  /** School holidays, customer travelling. Pause, never delete. */
  pausedFrom: date("paused_from"),
  pausedTo: date("paused_to"),
}, (t) => [index("standing_order_idx").on(t.farmId, t.session, t.customerId)]);

/**
 * Price swings ~40% intra-year (KES 80 → 50–60 in two months on a rain glut),
 * so price is effective-dated, never a column on customer.
 * Resolution: customer override → channel default → farm default.
 */
export const priceList = pgTable("price_list", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  scope: text("scope").$type<"CHANNEL" | "CUSTOMER">().notNull(),
  customerType: text("customer_type").$type<CustomerType>(),
  customerId: uuid("customer_id").references(() => customer.id),
  rateKesPerLitre: numeric("rate_kes_per_litre", { precision: 8, scale: 2 }).notNull(),
  minLitres: numeric("min_litres", { precision: 8, scale: 2 }),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
  reason: text("reason"),
  setBy: uuid("set_by").notNull(),
}, (t) => [index("price_lookup_idx").on(t.farmId, t.scope, t.effectiveFrom)]);

/* ------------------------------------------------------------------ */
/* M3 — Milk                                                           */
/* ------------------------------------------------------------------ */

/** APPEND ONLY. The highest-volume table in the system. */
export const milkRecord = pgTable("milk_record", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  animalId: uuid("animal_id").notNull().references(() => animal.id),
  recordedOn: date("recorded_on").notNull(),
  session: text("session").$type<MilkingSession>().notNull(),
  litres: numeric("litres", { precision: 6, scale: 2 }).notNull(),
  saleable: boolean("saleable").notNull().default(true),
  notSaleableReason: text("not_saleable_reason").$type<"COLOSTRUM" | "WITHDRAWAL">(),
  /** Out of range: warned, saved anyway, queued for the manager. Never rejected. */
  flagged: boolean("flagged").notNull().default(false),
  flagReason: text("flag_reason"),
  /** Corrections are new rows, not updates. */
  supersedesId: uuid("supersedes_id").references((): AnyPgColumn => milkRecord.id),
  recordedBy: uuid("recorded_by").notNull(),
  approvedBy: uuid("approved_by"),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  syncedAt: timestamp("synced_at", { withTimezone: true }),
}, (t) => [
  index("milk_day_idx").on(t.farmId, t.recordedOn, t.animalId),
  index("milk_animal_idx").on(t.farmId, t.animalId, t.recordedOn),
]);

export const milkDisposal = pgTable("milk_disposal", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  disposedOn: date("disposed_on").notNull(),
  session: text("session").$type<MilkingSession>(),
  channel: text("channel").$type<DisposalChannel>().notNull(),
  customerId: uuid("customer_id").references(() => customer.id),
  /**
   * Optional per-animal provenance. Bulk deliveries leave this null, but the
   * Produce Traceability and Recall Regulations 2021 require answering "which
   * animals contributed to which delivery" — so a withheld or single-cow
   * disposal records the source.
   */
  animalId: uuid("animal_id").references(() => animal.id),
  litres: numeric("litres", { precision: 8, scale: 2 }).notNull(),
  /** Imputed at market price for home use, calves and staff ration. */
  rateKesPerLitre: numeric("rate_kes_per_litre", { precision: 8, scale: 2 }),
  valueKes: numeric("value_kes", { precision: 14, scale: 2 }),
  settlement: text("settlement")
    .$type<"CASH" | "MPESA" | "CREDIT" | "COOP_CHECKOFF" | "NONE">(),
  // Quality, per bulk delivery
  butterfatPct: numeric("butterfat_pct", { precision: 4, scale: 2 }),
  proteinPct: numeric("protein_pct", { precision: 4, scale: 2 }),
  snfPct: numeric("snf_pct", { precision: 4, scale: 2 }),
  lactometerReading: numeric("lactometer_reading", { precision: 6, scale: 4 }),
  alcoholTest: text("alcohol_test").$type<"PASS" | "FAIL">(),
  accepted: boolean("accepted"),
  /**
   * Coded, never free text. Farm losses: spillage 30–38%, spoilage 19–25%,
   * calves 22%, adulteration rejection 13.5%. You cannot fix what you cannot group.
   */
  lossReason: text("loss_reason").$type<
    "SPILLAGE" | "SPOILAGE" | "SOURED" | "ADULTERATION" | "NON_COLLECTION"
    | "FAILED_ALCOHOL" | "FAILED_LACTOMETER" | "ORGANOLEPTIC" | "OTHER"
  >(),
  deliveryNoteNo: text("delivery_note_no"),
  deliveredBy: uuid("delivered_by"),
  recordedBy: uuid("recorded_by").notNull(),
}, (t) => [
  index("disposal_day_idx").on(t.farmId, t.disposedOn),
  index("disposal_customer_idx").on(t.farmId, t.customerId, t.disposedOn),
]);

export const milkStatement = pgTable("milk_statement", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  customerId: uuid("customer_id").notNull().references(() => customer.id),
  memberNo: text("member_no"),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  /** What the CO-OP says. The whole point is comparing it with what we recorded. */
  coopLitres: numeric("coop_litres", { precision: 10, scale: 2 }).notNull(),
  rateKesPerLitre: numeric("rate_kes_per_litre", { precision: 8, scale: 2 }),
  qualityBonusKes: numeric("quality_bonus_kes", { precision: 14, scale: 2 }).default("0"),
  grossPayKes: numeric("gross_pay_kes", { precision: 14, scale: 2 }).notNull(),
  /** County cess, capped at 0.5% of farm gate. */
  cessKes: numeric("cess_kes", { precision: 14, scale: 2 }).default("0"),
  netPayKes: numeric("net_pay_kes", { precision: 14, scale: 2 }).notNull(),
  paidOn: date("paid_on"),
  paymentMethod: text("payment_method"),
  recordedBy: uuid("recorded_by").notNull(),
}, (t) => [index("statement_period_idx").on(t.farmId, t.periodStart)]);

export const milkStatementDeduction = pgTable("milk_statement_deduction", {
  id: uuid("id").primaryKey(),
  /** P4 — a join is not a tenancy boundary, and RLS cannot follow one. */
  farmId: uuid("farm_id").notNull(),
  statementId: uuid("statement_id").notNull().references(() => milkStatement.id),
  deductionType: text("deduction_type").$type<
    "AI" | "FEEDS" | "VET" | "ADVANCE" | "SACCO_LOAN" | "SHARES"
    | "TRANSPORT" | "MEMBERSHIP" | "OTHER"
  >().notNull(),
  description: text("description"),
  amountKes: numeric("amount_kes", { precision: 14, scale: 2 }).notNull(),
  balanceRemainingKes: numeric("balance_remaining_kes", { precision: 14, scale: 2 }),
  /** The reconciliation link. An unmatched deduction is the finding. */
  matchedExpenseId: uuid("matched_expense_id"),
});

/** APPEND ONLY. The running tab. */
export const customerLedgerEntry = pgTable("customer_ledger_entry", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  customerId: uuid("customer_id").notNull().references(() => customer.id),
  entryDate: date("entry_date").notNull(),
  entryType: text("entry_type")
    .$type<"DELIVERY" | "PAYMENT" | "ADJUSTMENT" | "WRITE_OFF" | "OPENING_BALANCE">().notNull(),
  litres: numeric("litres", { precision: 8, scale: 2 }),
  rateKesPerLitre: numeric("rate_kes_per_litre", { precision: 8, scale: 2 }),
  debitKes: numeric("debit_kes", { precision: 14, scale: 2 }).notNull().default("0"),
  creditKes: numeric("credit_kes", { precision: 14, scale: 2 }).notNull().default("0"),
  milkDisposalId: uuid("milk_disposal_id").references(() => milkDisposal.id),
  paymentMethod: text("payment_method").$type<PaymentMethod>(),
  mpesaRef: text("mpesa_ref"),
  note: text("note"),
  recordedBy: uuid("recorded_by").notNull(),
  /** Payments recorded by staff are PENDING until a manager approves. */
  approvedBy: uuid("approved_by"),
}, (t) => [index("ledger_customer_idx").on(t.farmId, t.customerId, t.entryDate)]);

/** An LPO is borrowable collateral in Kenya, so it is a first-class object. */
export const purchaseOrder = pgTable("purchase_order", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  customerId: uuid("customer_id").notNull().references(() => customer.id),
  lpoNumber: text("lpo_number").notNull(),
  issuedOn: date("issued_on"),
  expiresOn: date("expires_on"),
  valueKes: numeric("value_kes", { precision: 14, scale: 2 }),
  litresCommitted: numeric("litres_committed", { precision: 10, scale: 2 }),
  status: text("status")
    .$type<"OPEN" | "FULFILLED" | "EXPIRED" | "CANCELLED">().notNull().default("OPEN"),
});

export const salesInvoice = pgTable("sales_invoice", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  customerId: uuid("customer_id").notNull().references(() => customer.id),
  invoiceNo: text("invoice_no").notNull(),
  issuedOn: date("issued_on").notNull(),
  periodStart: date("period_start"),
  periodEnd: date("period_end"),
  totalLitres: numeric("total_litres", { precision: 10, scale: 2 }),
  subtotalKes: numeric("subtotal_kes", { precision: 14, scale: 2 }).notNull(),
  taxKes: numeric("tax_kes", { precision: 14, scale: 2 }).default("0"),
  totalKes: numeric("total_kes", { precision: 14, scale: 2 }).notNull(),
  dueOn: date("due_on"),
  status: text("status").$type<
    "DRAFT" | "ISSUED" | "PART_PAID" | "PAID" | "OVERDUE" | "WRITTEN_OFF"
  >().notNull().default("ISSUED"),
  lpoId: uuid("lpo_id").references(() => purchaseOrder.id),
  /** Institutional buyers need a compliant invoice to claim the expense. */
  etimsRef: text("etims_ref"),
}, (t) => [
  unique("invoice_no_uq").on(t.farmId, t.invoiceNo),
  index("invoice_due_idx").on(t.farmId, t.status, t.dueOn),
]);

/* ------------------------------------------------------------------ */
/* M5 — Feed                                                           */
/* ------------------------------------------------------------------ */

export const feedItem = pgTable("feed_item", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  name: text("name").notNull(),
  category: text("category").$type<FeedCategory>().notNull(),
  dmPct: numeric("dm_pct", { precision: 5, scale: 2 }),
  cpPct: numeric("cp_pct", { precision: 5, scale: 2 }),
  defaultUnit: text("default_unit").notNull(),
  /** NEVER null for BAG / BALE / informal units. A bale is 12–25 kg. */
  defaultUnitWeightKg: numeric("default_unit_weight_kg", { precision: 8, scale: 3 }),
  homeGrown: boolean("home_grown").notNull().default(false),
}, (t) => [index("feed_item_farm_idx").on(t.farmId, t.category)]);

export const feedPurchase = pgTable("feed_purchase", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  feedItemId: uuid("feed_item_id").notNull().references(() => feedItem.id),
  supplierId: uuid("supplier_id"),
  purchasedOn: date("purchased_on").notNull(),
  quantity: numeric("quantity", { precision: 10, scale: 3 }).notNull(),
  unit: text("unit").notNull(),
  /** The trap, closed. Cost accuracy is won or lost here. */
  unitWeightKg: numeric("unit_weight_kg", { precision: 8, scale: 3 }).notNull(),
  unitPriceKes: numeric("unit_price_kes", { precision: 14, scale: 2 }).notNull(),
  totalCostKes: numeric("total_cost_kes", { precision: 14, scale: 2 }).notNull(),
  expenseId: uuid("expense_id"),
  recordedBy: uuid("recorded_by").notNull(),
}, (t) => [index("feed_purchase_idx").on(t.farmId, t.feedItemId, t.purchasedOn)]);

/** APPEND ONLY. */
export const feedIssue = pgTable("feed_issue", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  feedItemId: uuid("feed_item_id").notNull().references(() => feedItem.id),
  issuedOn: date("issued_on").notNull(),
  animalGroup: text("animal_group").$type<AnimalGroup>(),
  /** Optional per-animal capture. Defaults to groups — farms won't sustain per-cow. */
  animalId: uuid("animal_id").references(() => animal.id),
  quantity: numeric("quantity", { precision: 10, scale: 3 }).notNull(),
  unit: text("unit").notNull(),
  unitWeightKg: numeric("unit_weight_kg", { precision: 8, scale: 3 }).notNull(),
  animalsFed: smallint("animals_fed"),
  recordedBy: uuid("recorded_by").notNull(),
}, (t) => [index("feed_issue_idx").on(t.farmId, t.issuedOn, t.feedItemId)]);

export const fodderProduction = pgTable("fodder_production", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  plotName: text("plot_name"),
  /** Links the harvest into the feed store, so home-grown fodder is costed. */
  feedItemId: uuid("feed_item_id").references(() => feedItem.id),
  crop: text("crop").notNull(),
  areaAcres: numeric("area_acres", { precision: 8, scale: 3 }),
  plantedOn: date("planted_on"),
  harvestedOn: date("harvested_on"),
  quantity: numeric("quantity", { precision: 10, scale: 3 }),
  unit: text("unit"),
  unitWeightKg: numeric("unit_weight_kg", { precision: 8, scale: 3 }),
  inputCostKes: numeric("input_cost_kes", { precision: 14, scale: 2 }),
});

/* ------------------------------------------------------------------ */
/* M6 — Health                                                         */
/* ------------------------------------------------------------------ */

/**
 * The drug master. Withdrawal periods live HERE, taken from the product's
 * approved label — never a hard-coded drug lookup, because no Kenyan national
 * withdrawal table exists and the label is the legally operative number.
 */
export const product = pgTable("product", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id"),
  name: text("name").notNull(),
  activeIngredient: text("active_ingredient"),
  productType: text("product_type").$type<
    "ANTIBIOTIC" | "VACCINE" | "DEWORMER" | "ACARICIDE" | "NSAID"
    | "INTRAMAMMARY" | "MINERAL" | "HORMONE" | "OTHER"
  >().notNull(),
  milkWithdrawalDays: smallint("milk_withdrawal_days"),
  meatWithdrawalDays: smallint("meat_withdrawal_days"),
  /** Provenance is the legal defence. 'PCPB label, 2026'. */
  labelSource: text("label_source"),
  notForLactating: boolean("not_for_lactating").notNull().default(false),
}, (t) => [index("product_farm_idx").on(t.farmId, t.productType)]);

/** APPEND ONLY. */
export const healthEvent = pgTable("health_event", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  animalId: uuid("animal_id").notNull().references(() => animal.id),
  eventType: text("event_type").$type<
    "OBSERVATION" | "TREATMENT" | "VACCINATION" | "DEWORMING" | "DIPPING"
    | "HOOF_TRIM" | "DISBUDDING" | "CMT" | "DIAGNOSIS"
  >().notNull(),
  occurredOn: date("occurred_on").notNull(),
  signs: text("signs"),
  diagnosis: text("diagnosis"),
  /**
   * The routine code — 'S19', 'FMD', 'DIP', 'DEWORM'. Load-bearing: once-for-life
   * enforcement counts prior doses by this, and inferring it from free-text
   * diagnosis would let a typo hand a heifer a second S19 shot.
   */
  routine: text("routine"),
  /**
   * Explicit rather than inferred from route + notForLactating. Dry cow therapy
   * clears at infusion + 30 days OR calving + 96 hours, whichever is later, and
   * that rule needs to be findable rather than deduced.
   */
  isDryCowTherapy: boolean("is_dry_cow_therapy").notNull().default(false),
  productId: uuid("product_id").references(() => product.id),
  batchNo: text("batch_no"),
  expiry: date("expiry"),
  dose: text("dose"),
  route: text("route").$type<
    "IM" | "IV" | "SC" | "PO" | "INTRAMAMMARY" | "TOPICAL" | "INTRAUTERINE"
  >(),
  /** For intramammary: {'LF','RF','LH','RH'} */
  quartersTreated: text("quarters_treated").array(),
  durationDays: smallint("duration_days"),
  treatmentEndOn: date("treatment_end_on"),
  /** Computed at insert from the product + treatment end. The hard block. */
  milkClearAt: timestamp("milk_clear_at", { withTimezone: true }),
  meatClearAt: date("meat_clear_at"),
  cmtScore: text("cmt_score").$type<"N" | "T" | "1" | "2" | "3">(),
  performedByUser: uuid("performed_by_user"),
  performedByExt: uuid("performed_by_ext"),
  costKes: numeric("cost_kes", { precision: 14, scale: 2 }),
  costSettledBy: text("cost_settled_by").$type<"CASH" | "CREDIT" | "COOP_CHECKOFF">(),
  outcome: text("outcome").$type<"RECOVERED" | "CHRONIC" | "CULLED" | "DIED" | "ONGOING">(),
  followUpOn: date("follow_up_on"),
  expenseId: uuid("expense_id"),
  recordedBy: uuid("recorded_by").notNull(),
}, (t) => [
  index("health_animal_idx").on(t.farmId, t.animalId, t.occurredOn),
  index("health_withdrawal_idx").on(t.farmId, t.milkClearAt),
]);

export const routineSchedule = pgTable("routine_schedule", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  routine: text("routine").notNull(),
  firstDoseMinAgeDays: integer("first_dose_min_age_days"),
  firstDoseMaxAgeDays: integer("first_dose_max_age_days"),
  boosterIntervalDays: integer("booster_interval_days"),
  sexRestriction: text("sex_restriction").$type<"F" | "M">(),
  /** S19 brucellosis and ECF-ITM are both once-for-life. Needs hard validation. */
  onceInLifetime: boolean("once_in_lifetime").notNull().default(false),
});

/* ------------------------------------------------------------------ */
/* M8 — People                                                         */
/* ------------------------------------------------------------------ */

export const employee = pgTable("employee", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  appUserId: uuid("app_user_id").references(() => appUser.id),
  fullName: text("full_name").notNull(),
  nationalId: text("national_id"),
  kraPin: text("kra_pin"),
  nssfNo: text("nssf_no"),
  shaNo: text("sha_no"),
  phone: text("phone"),
  role: text("role").notNull(),
  employmentType: text("employment_type")
    .$type<"PERMANENT" | "TERM" | "CASUAL">().notNull(),
  startedOn: date("started_on").notNull(),
  endedOn: date("ended_on"),
  basicWageKes: numeric("basic_wage_kes", { precision: 14, scale: 2 }),
  wagePeriod: text("wage_period").$type<"MONTHLY" | "DAILY">(),
  /** Else a 15% housing allowance is due on the basic wage. */
  housingProvided: boolean("housing_provided").notNull().default(true),
  nextOfKin: text("next_of_kin"),
}, (t) => [index("employee_farm_idx").on(t.farmId, t.employmentType)]);

export const attendance = pgTable("attendance", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  employeeId: uuid("employee_id").notNull().references(() => employee.id),
  workedOn: date("worked_on").notNull(),
  days: numeric("days", { precision: 3, scale: 2 }).notNull().default("1"),
  recordedBy: uuid("recorded_by").notNull(),
}, (t) => [unique("attendance_uq").on(t.employeeId, t.workedOn)]);

export const payrollRun = pgTable("payroll_run", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  periodMonth: date("period_month").notNull(),
  status: text("status").$type<"DRAFT" | "APPROVED" | "PAID">().notNull().default("DRAFT"),
  approvedBy: uuid("approved_by"),
  totalGrossKes: numeric("total_gross_kes", { precision: 14, scale: 2 }),
  totalNetKes: numeric("total_net_kes", { precision: 14, scale: 2 }),
  paidOn: date("paid_on"),
}, (t) => [unique("payroll_period_uq").on(t.farmId, t.periodMonth)]);

export const payslip = pgTable("payslip", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  payrollRunId: uuid("payroll_run_id").notNull().references(() => payrollRun.id),
  employeeId: uuid("employee_id").notNull().references(() => employee.id),
  daysWorked: numeric("days_worked", { precision: 5, scale: 2 }),
  basicKes: numeric("basic_kes", { precision: 14, scale: 2 }).notNull(),
  housingAllowKes: numeric("housing_allow_kes", { precision: 14, scale: 2 }).default("0"),
  grossKes: numeric("gross_kes", { precision: 14, scale: 2 }).notNull(),
  nssfTier1Kes: numeric("nssf_tier1_kes", { precision: 14, scale: 2 }).default("0"),
  nssfTier2Kes: numeric("nssf_tier2_kes", { precision: 14, scale: 2 }).default("0"),
  shifKes: numeric("shif_kes", { precision: 14, scale: 2 }).default("0"),
  housingLevyKes: numeric("housing_levy_kes", { precision: 14, scale: 2 }).default("0"),
  taxableKes: numeric("taxable_kes", { precision: 14, scale: 2 }),
  payeBeforeReliefKes: numeric("paye_before_relief_kes", { precision: 14, scale: 2 }).default("0"),
  personalReliefKes: numeric("personal_relief_kes", { precision: 14, scale: 2 }).default("2400"),
  /** Often ZERO for a herdsman. The common case, and it must be right. */
  payeKes: numeric("paye_kes", { precision: 14, scale: 2 }).default("0"),
  advancesKes: numeric("advances_kes", { precision: 14, scale: 2 }).default("0"),
  otherDeductionsKes: numeric("other_deductions_kes", { precision: 14, scale: 2 }).default("0"),
  milkRationKes: numeric("milk_ration_kes", { precision: 14, scale: 2 }).default("0"),
  netKes: numeric("net_kes", { precision: 14, scale: 2 }).notNull(),
  // Employer cost, computed and reported but not deducted from net
  employerNssfKes: numeric("employer_nssf_kes", { precision: 14, scale: 2 }).default("0"),
  employerShifKes: numeric("employer_shif_kes", { precision: 14, scale: 2 }).default("0"),
  employerHousingLevyKes: numeric("employer_housing_levy_kes", { precision: 14, scale: 2 }).default("0"),
  paidOn: date("paid_on"),
  paymentMethod: text("payment_method"),
  mpesaRef: text("mpesa_ref"),
}, (t) => [unique("payslip_uq").on(t.payrollRunId, t.employeeId)]);

export const leaveRecord = pgTable("leave_record", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  employeeId: uuid("employee_id").notNull().references(() => employee.id),
  leaveType: text("leave_type").$type<
    "ANNUAL" | "SICK_FULL" | "SICK_HALF" | "MATERNITY" | "PATERNITY" | "UNPAID"
  >().notNull(),
  fromDate: date("from_date").notNull(),
  toDate: date("to_date").notNull(),
  days: numeric("days", { precision: 5, scale: 2 }).notNull(),
  recordedBy: uuid("recorded_by"),
  approvedBy: uuid("approved_by"),
});

/* ------------------------------------------------------------------ */
/* M9 — Money                                                          */
/* ------------------------------------------------------------------ */

/**
 * Who we BUY from and who provides services. `customer` is who we SELL milk to.
 * A co-operative is legitimately both, linked by customerId.
 */
export const counterparty = pgTable("counterparty", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  name: text("name").notNull(),
  customerId: uuid("customer_id").references(() => customer.id),
  types: text("types").array().$type<CounterpartyType[]>().notNull(),
  providerKind: text("provider_kind").$type<
    "FARM_STAFF" | "AI_TECH" | "PARAVET" | "VET" | "COOP_VET" | "COUNTY"
  >(),
  kvbRegNo: text("kvb_reg_no"),
  phone: text("phone"),
  paymentTerms: text("payment_terms"),
  creditBalanceKes: numeric("credit_balance_kes", { precision: 14, scale: 2 }).default("0"),
}, (t) => [index("counterparty_farm_idx").on(t.farmId)]);

export const expense = pgTable("expense", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  incurredOn: date("incurred_on").notNull(),
  category: text("category").$type<ExpenseCategory>().notNull(),
  description: text("description"),
  counterpartyId: uuid("counterparty_id").references(() => counterparty.id),
  amountKes: numeric("amount_kes", { precision: 14, scale: 2 }).notNull(),
  paymentMethod: text("payment_method").$type<PaymentMethod>(),
  mpesaRef: text("mpesa_ref"),
  voucherNo: text("voucher_no"),
  attachmentUrl: text("attachment_url"),
  /** Staff entries do not move a report until a manager approves. */
  status: text("status").$type<"PENDING" | "APPROVED" | "VOID">().notNull().default("PENDING"),
  recordedBy: uuid("recorded_by").notNull(),
  approvedBy: uuid("approved_by"),
}, (t) => [index("expense_idx").on(t.farmId, t.incurredOn, t.category)]);

export const income = pgTable("income", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  receivedOn: date("received_on").notNull(),
  source: text("source")
    .$type<"MILK" | "ANIMAL_SALE" | "MANURE" | "FODDER" | "OTHER">().notNull(),
  description: text("description"),
  counterpartyId: uuid("counterparty_id").references(() => counterparty.id),
  customerId: uuid("customer_id").references(() => customer.id),
  amountKes: numeric("amount_kes", { precision: 14, scale: 2 }).notNull(),
  paymentMethod: text("payment_method").$type<PaymentMethod>(),
  mpesaRef: text("mpesa_ref"),
  status: text("status").$type<"PENDING" | "APPROVED" | "VOID">().notNull().default("PENDING"),
  recordedBy: uuid("recorded_by").notNull(),
  approvedBy: uuid("approved_by"),
}, (t) => [index("income_idx").on(t.farmId, t.receivedOn, t.source)]);

/** Imported CSV. Reconcile every evening, while errors are still fixable. */
export const mpesaStatementLine = pgTable("mpesa_statement_line", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  receiptNo: text("receipt_no").notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
  details: text("details"),
  paidInKes: numeric("paid_in_kes", { precision: 14, scale: 2 }),
  withdrawnKes: numeric("withdrawn_kes", { precision: 14, scale: 2 }),
  balanceKes: numeric("balance_kes", { precision: 14, scale: 2 }),
  transactionStatus: text("transaction_status"),
  otherPartyInfo: text("other_party_info"),
  matchedExpenseId: uuid("matched_expense_id").references(() => expense.id),
  matchedIncomeId: uuid("matched_income_id").references(() => income.id),
}, (t) => [unique("mpesa_receipt_uq").on(t.farmId, t.receiptNo)]);

/* ------------------------------------------------------------------ */
/* Compliance, training, support                                       */
/* ------------------------------------------------------------------ */

/** Food handler certificates are valid SIX months — too short for an annual check. */
export const complianceDocument = pgTable("compliance_document", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  docType: text("doc_type").$type<
    "KDB_PERMIT" | "MILK_TRANSPORT_PERMIT" | "COUNTY_BUSINESS_PERMIT"
    | "FOOD_HANDLER_CERT" | "TAX_COMPLIANCE_CERT" | "AGPO_CERT"
    | "MILK_BAR_LICENCE" | "COOLING_FACILITY_PERMIT"
  >().notNull(),
  referenceNo: text("reference_no"),
  holderEmployeeId: uuid("holder_employee_id").references(() => employee.id),
  issuedOn: date("issued_on"),
  expiresOn: date("expires_on").notNull(),
  costKes: numeric("cost_kes", { precision: 14, scale: 2 }),
  documentUrl: text("document_url"),
}, (t) => [index("compliance_expiry_idx").on(t.farmId, t.expiresOn)]);

export const trainingEvent = pgTable("training_event", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  title: text("title").notNull(),
  kind: text("kind").$type<"SEMINAR" | "ON_FARM" | "ONLINE" | "FIELD_DAY">(),
  heldOn: date("held_on"),
  trainer: text("trainer"),
  topic: text("topic"),
  costKes: numeric("cost_kes", { precision: 14, scale: 2 }),
  materialsUrl: text("materials_url"),
  expenseId: uuid("expense_id").references(() => expense.id),
});

export const trainingAttendance = pgTable("training_attendance", {
  id: uuid("id").primaryKey(),
  trainingEventId: uuid("training_event_id").notNull().references(() => trainingEvent.id),
  employeeId: uuid("employee_id").references(() => employee.id),
  attendeeName: text("attendee_name"),
});

export const supportTicket = pgTable("support_ticket", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  raisedBy: uuid("raised_by").notNull().references(() => appUser.id),
  raisedAt: timestamp("raised_at", { withTimezone: true }).notNull().defaultNow(),
  /** Captured automatically so nobody has to describe a bug. */
  screen: text("screen"),
  syncState: jsonb("sync_state"),
  message: text("message").notNull(),
  status: text("status").notNull().default("OPEN"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

/** Alerts. One person, one animal, one action, one deadline. */
export const alert = pgTable("alert", {
  id: uuid("id").primaryKey(),
  farmId: uuid("farm_id").notNull(),
  kind: text("kind").notNull(),
  animalId: uuid("animal_id").references(() => animal.id),
  customerId: uuid("customer_id").references(() => customer.id),
  employeeId: uuid("employee_id").references(() => employee.id),
  assignedRole: text("assigned_role").$type<Role>(),
  action: text("action").notNull(),
  dueOn: date("due_on").notNull(),
  severity: text("severity").$type<"INFO" | "WARN" | "CRITICAL">().notNull().default("INFO"),
  /** Dismissal carries an outcome, which feeds back into accuracy. */
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  outcome: text("outcome"),
  resolvedBy: uuid("resolved_by"),
  dedupeKey: text("dedupe_key").notNull(),
}, (t) => [
  unique("alert_dedupe_uq").on(t.farmId, t.dedupeKey),
  index("alert_due_idx").on(t.farmId, t.dueOn, t.resolvedAt),
]);
