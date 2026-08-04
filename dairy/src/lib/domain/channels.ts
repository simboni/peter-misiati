/**
 * Disposal channel constants, in a module with NO database import.
 *
 * These used to live in `db/schema.ts`. They are runtime values rather than
 * types, so `domain/milk.ts` importing them dragged `drizzle-orm/pg-core` and
 * all 328 table, column and index names across the client boundary — 56.9 KB
 * raw, 13.3 KB gzipped, on `/milk`, the screen a herdsman opens twice a day on
 * a 2G link. That is about two seconds of his morning spent downloading our
 * database schema.
 *
 * `db/schema.ts` now imports FROM here, so there is one definition and the
 * client never sees drizzle.
 */

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
