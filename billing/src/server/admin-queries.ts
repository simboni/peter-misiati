import { and, count, desc, eq, gte, isNotNull, ne, sum } from "drizzle-orm";
import { schema, type DB } from "./db";
import { platformPricePerSeatKes } from "./platform";

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

/** Map orgId -> seat (member) count. */
async function seatMap(db: DB): Promise<Map<string, number>> {
  const rows = await db
    .select({ orgId: schema.member.organizationId, c: count() })
    .from(schema.member)
    .groupBy(schema.member.organizationId);
  return new Map(rows.map((r) => [r.orgId, Number(r.c)]));
}

export type PlatformStats = Awaited<ReturnType<typeof platformStats>>;

/** Headline numbers across every workspace. */
export async function platformStats(db: DB) {
  const [orgs, pros, suspended, pending, signups7, signups30, invAgg, collectedAgg, price, seats] =
    await Promise.all([
      db.select({ c: count() }).from(schema.organization),
      db.select({ c: count() }).from(schema.orgProfile).where(eq(schema.orgProfile.plan, "pro")),
      db.select({ c: count() }).from(schema.orgProfile).where(eq(schema.orgProfile.suspended, true)),
      db
        .select({ c: count() })
        .from(schema.orgProfile)
        .where(and(isNotNull(schema.orgProfile.planRequestedAt), ne(schema.orgProfile.plan, "pro"))),
      db.select({ c: count() }).from(schema.organization).where(gte(schema.organization.createdAt, daysAgo(7))),
      db.select({ c: count() }).from(schema.organization).where(gte(schema.organization.createdAt, daysAgo(30))),
      db
        .select({ c: count(), gmv: sum(schema.invoice.total) })
        .from(schema.invoice)
        .where(eq(schema.invoice.type, "invoice")),
      db.select({ collected: sum(schema.payment.amount) }).from(schema.payment),
      platformPricePerSeatKes(db),
      seatMap(db),
    ]);

  // MRR = per pro-org (override or default price) × seats.
  const proOrgs = await db
    .select({ orgId: schema.orgProfile.organizationId, override: schema.orgProfile.planPriceOverrideKes })
    .from(schema.orgProfile)
    .where(eq(schema.orgProfile.plan, "pro"));
  const mrrKes = proOrgs.reduce(
    (acc, o) => acc + (o.override ?? price) * Math.max(1, seats.get(o.orgId) ?? 1),
    0,
  );

  const vendors = Number(orgs[0]?.c ?? 0);
  const proCount = Number(pros[0]?.c ?? 0);
  return {
    vendors,
    pro: proCount,
    free: vendors - proCount,
    suspended: Number(suspended[0]?.c ?? 0),
    pendingRequests: Number(pending[0]?.c ?? 0),
    signups7: Number(signups7[0]?.c ?? 0),
    signups30: Number(signups30[0]?.c ?? 0),
    invoices: Number(invAgg[0]?.c ?? 0),
    gmv: Number(invAgg[0]?.gmv ?? 0), // minor units (cents)
    collected: Number(collectedAgg[0]?.collected ?? 0), // minor units
    mrrKes, // whole KES / month
    pricePerSeatKes: price,
  };
}

export type VendorRow = Awaited<ReturnType<typeof listVendors>>[number];

/** Every workspace with the numbers an admin scans: plan, seats, GMV, activity. */
export async function listVendors(db: DB) {
  const [orgs, profiles, seats, owners, invAgg, payAgg] = await Promise.all([
    db.select().from(schema.organization),
    db.select().from(schema.orgProfile),
    seatMap(db),
    // owner email per org
    db
      .select({ orgId: schema.member.organizationId, email: schema.user.email })
      .from(schema.member)
      .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
      .where(eq(schema.member.role, "owner")),
    db
      .select({
        orgId: schema.invoice.organizationId,
        c: count(),
        gmv: sum(schema.invoice.total),
      })
      .from(schema.invoice)
      .where(eq(schema.invoice.type, "invoice"))
      .groupBy(schema.invoice.organizationId),
    db
      .select({ orgId: schema.payment.organizationId, collected: sum(schema.payment.amount) })
      .from(schema.payment)
      .groupBy(schema.payment.organizationId),
  ]);

  const profByOrg = new Map(profiles.map((p) => [p.organizationId, p]));
  const ownerByOrg = new Map(owners.map((o) => [o.orgId, o.email]));
  const invByOrg = new Map(invAgg.map((r) => [r.orgId, r]));
  const payByOrg = new Map(payAgg.map((r) => [r.orgId, Number(r.collected ?? 0)]));

  return orgs
    .map((org) => {
      const p = profByOrg.get(org.id);
      const inv = invByOrg.get(org.id);
      return {
        orgId: org.id,
        name: org.name,
        createdAt: org.createdAt,
        ownerEmail: ownerByOrg.get(org.id) ?? null,
        plan: p?.plan ?? "free",
        suspended: p?.suspended ?? false,
        requested: Boolean(p?.planRequestedAt),
        priceOverride: p?.planPriceOverrideKes ?? null,
        seats: seats.get(org.id) ?? 1,
        invoices: Number(inv?.c ?? 0),
        gmv: Number(inv?.gmv ?? 0),
        collected: payByOrg.get(org.id) ?? 0,
      };
    })
    .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
}

/** Full picture of one workspace for the drill-in page. */
export async function getVendorDetail(db: DB, orgId: string) {
  const [orgRows, profRows, members, recentInvoices, recentPayments] = await Promise.all([
    db.select().from(schema.organization).where(eq(schema.organization.id, orgId)).limit(1),
    db.select().from(schema.orgProfile).where(eq(schema.orgProfile.organizationId, orgId)).limit(1),
    db
      .select({
        memberId: schema.member.id,
        role: schema.member.role,
        userId: schema.user.id,
        name: schema.user.name,
        email: schema.user.email,
        isAdmin: schema.user.isPlatformAdmin,
        isSuper: schema.user.isSuperAdmin,
      })
      .from(schema.member)
      .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
      .where(eq(schema.member.organizationId, orgId)),
    db
      .select()
      .from(schema.invoice)
      .where(eq(schema.invoice.organizationId, orgId))
      .orderBy(desc(schema.invoice.createdAt))
      .limit(8),
    db
      .select()
      .from(schema.payment)
      .where(eq(schema.payment.organizationId, orgId))
      .orderBy(desc(schema.payment.createdAt))
      .limit(8),
  ]);
  if (!orgRows[0]) return null;
  return {
    org: orgRows[0],
    profile: profRows[0] ?? null,
    members,
    recentInvoices,
    recentPayments,
  };
}

/** All platform users with a membership count and admin flags. */
export async function listUsers(db: DB) {
  const [users, memberCounts] = await Promise.all([
    db.select().from(schema.user).orderBy(desc(schema.user.createdAt)),
    db
      .select({ userId: schema.member.userId, c: count() })
      .from(schema.member)
      .groupBy(schema.member.userId),
  ]);
  const byUser = new Map(memberCounts.map((m) => [m.userId, Number(m.c)]));
  return users.map((u) => ({ ...u, workspaces: byUser.get(u.id) ?? 0 }));
}

/** Recent payments across all tenants, with workspace + invoice context. */
export async function listPaymentsFeed(db: DB, limit = 60) {
  return db
    .select({
      id: schema.payment.id,
      number: schema.payment.number,
      amount: schema.payment.amount,
      method: schema.payment.method,
      kind: schema.payment.kind,
      paidAt: schema.payment.paidAt,
      provider: schema.payment.provider,
      orgName: schema.organization.name,
      invoiceNumber: schema.invoice.number,
    })
    .from(schema.payment)
    .leftJoin(schema.organization, eq(schema.organization.id, schema.payment.organizationId))
    .leftJoin(schema.invoice, eq(schema.invoice.id, schema.payment.invoiceId))
    .orderBy(desc(schema.payment.paidAt))
    .limit(limit);
}

/** Recent M-Pesa payment intents across all tenants (for monitoring failures). */
export async function listIntentsFeed(db: DB, limit = 60) {
  return db
    .select({
      id: schema.paymentIntent.id,
      amount: schema.paymentIntent.amount,
      phone: schema.paymentIntent.phone,
      status: schema.paymentIntent.status,
      provider: schema.paymentIntent.provider,
      errorMessage: schema.paymentIntent.errorMessage,
      createdAt: schema.paymentIntent.createdAt,
      orgName: schema.organization.name,
      invoiceNumber: schema.invoice.number,
    })
    .from(schema.paymentIntent)
    .leftJoin(schema.organization, eq(schema.organization.id, schema.paymentIntent.organizationId))
    .leftJoin(schema.invoice, eq(schema.invoice.id, schema.paymentIntent.invoiceId))
    .orderBy(desc(schema.paymentIntent.createdAt))
    .limit(limit);
}

/** Most recent admin actions. */
export async function listAudit(db: DB, limit = 80) {
  return db.select().from(schema.adminAuditLog).orderBy(desc(schema.adminAuditLog.createdAt)).limit(limit);
}

/** Pending Pro upgrade requests (requested but not yet on Pro). */
export async function listUpgradeRequests(db: DB) {
  const rows = await db
    .select({
      orgId: schema.orgProfile.organizationId,
      requestedAt: schema.orgProfile.planRequestedAt,
      name: schema.organization.name,
    })
    .from(schema.orgProfile)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.orgProfile.organizationId))
    .where(and(isNotNull(schema.orgProfile.planRequestedAt), ne(schema.orgProfile.plan, "pro")))
    .orderBy(desc(schema.orgProfile.planRequestedAt));
  const seats = await seatMap(db);
  return rows.map((r) => ({ ...r, seats: seats.get(r.orgId) ?? 1 }));
}
