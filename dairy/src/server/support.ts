import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db as defaultDb } from "@/db";
import * as s from "@/db/schema";
import {
  actionError,
  actionOk,
  assertOwned,
  type ActionResult,
  type Session,
} from "@/lib/dal";
import { newId } from "@/lib/ids";
import { num } from "@/lib/money";
import { today, type ISODate } from "@/lib/domain/dates";

/**
 * M12 — Support and training.
 *
 * Two jobs the market study says are worth more than they look.
 *
 * Support, because the single most damning review in the whole competitive
 * teardown was "they are really helpful when trying to sell it to you but
 * aftercare is zero", while "available technical support" ranks among the most
 * important adoption criteria. In-country, in-language support is the moat
 * against foreign SaaS — none of it can service a farm in Nyandarua.
 *
 * Training, because technology alone does not move the needle. Mercy Corps,
 * after reaching 16 million smallholders: "the technology itself will only get
 * us so far." Digital Green's tenfold cost-effectiveness rests on human
 * mediation. DigiCow's most-praised feature is pre-recorded vernacular audio.
 */

type Db = typeof defaultDb;

/* ---------------------------------------------------------------- */
/* Support                                                           */
/* ---------------------------------------------------------------- */

const TicketInput = z.object({
  message: z.string().trim().min(1, "Tell us what happened."),
  /** Captured automatically — nobody should have to describe where they were. */
  screen: z.string().trim().optional(),
  /** Also automatic: pending writes, last sync, online state. */
  syncState: z.record(z.unknown()).optional(),
});

export type TicketInput = z.infer<typeof TicketInput>;

export async function raiseTicketFor(
  session: Session,
  input: TicketInput,
  db: Db = defaultDb,
): Promise<ActionResult<{ id: string }>> {
  const parsed = TicketInput.safeParse(input);
  if (!parsed.success) {
    return actionError("Tell us what happened.", parsed.error.flatten().fieldErrors);
  }

  const id = newId();
  await db
    .insert(s.supportTicket)
    .values({
      id,
      farmId: session.farmId,
      raisedBy: session.userId,
      screen: parsed.data.screen ?? null,
      syncState: parsed.data.syncState ?? null,
      message: parsed.data.message,
      status: "OPEN",
    })
    .onConflictDoNothing();

  return actionOk(
    { id },
    "Thank you. We have your message and will come back to you.",
  );
}

export async function listTickets(
  session: Session,
  opts: { status?: "OPEN" | "RESOLVED"; limit?: number } = {},
  db: Db = defaultDb,
) {
  const where = opts.status
    ? and(eq(s.supportTicket.farmId, session.farmId), eq(s.supportTicket.status, opts.status))
    : eq(s.supportTicket.farmId, session.farmId);

  return db
    .select({
      id: s.supportTicket.id,
      message: s.supportTicket.message,
      screen: s.supportTicket.screen,
      status: s.supportTicket.status,
      raisedAt: s.supportTicket.raisedAt,
      raisedByName: s.appUser.fullName,
    })
    .from(s.supportTicket)
    .leftJoin(s.appUser, eq(s.appUser.id, s.supportTicket.raisedBy))
    .where(where)
    .orderBy(desc(s.supportTicket.raisedAt))
    .limit(opts.limit ?? 50);
}

export async function resolveTicketFor(
  session: Session,
  ticketId: string,
  db: Db = defaultDb,
): Promise<ActionResult<{ id: string }>> {
  const [ticket] = await db
    .select()
    .from(s.supportTicket)
    .where(eq(s.supportTicket.id, ticketId));
  assertOwned(ticket, session, "message");

  await db
    .update(s.supportTicket)
    .set({ status: "RESOLVED", resolvedAt: new Date() })
    .where(and(eq(s.supportTicket.id, ticketId), eq(s.supportTicket.farmId, session.farmId)));

  return actionOk({ id: ticketId }, "Marked as sorted.");
}

/**
 * Support channels. WhatsApp first, because that is the channel Kenyan
 * businesses actually use, and a published response time because vague
 * availability is what "aftercare is zero" feels like from the inside.
 */
export interface SupportChannels {
  whatsappUrl: string | null;
  phone: string | null;
  responseTime: string;
}

export function supportChannels(): SupportChannels {
  const phone = process.env.SUPPORT_PHONE ?? null;
  return {
    whatsappUrl: phone ? `https://wa.me/${phone.replace(/[^0-9]/g, "")}` : null,
    phone,
    responseTime: "We answer WhatsApp within a few hours on working days.",
  };
}

/* ---------------------------------------------------------------- */
/* Training                                                          */
/* ---------------------------------------------------------------- */

const TrainingInput = z.object({
  title: z.string().trim().min(1, "Give the training a name."),
  kind: z.enum(["SEMINAR", "ON_FARM", "ONLINE", "FIELD_DAY"]).optional(),
  heldOn: z.string().optional(),
  trainer: z.string().trim().optional(),
  topic: z.string().trim().optional(),
  costKes: z.coerce.number().min(0).optional(),
  materialsUrl: z.string().trim().optional(),
  attendeeEmployeeIds: z.array(z.string().uuid()).optional(),
  attendeeNames: z.array(z.string().trim()).optional(),
});

export type TrainingInput = z.infer<typeof TrainingInput>;

export async function recordTrainingFor(
  session: Session,
  input: TrainingInput,
  db: Db = defaultDb,
): Promise<ActionResult<{ id: string; expenseId: string | null }>> {
  const parsed = TrainingInput.safeParse(input);
  if (!parsed.success) {
    return actionError("Check the highlighted fields.", parsed.error.flatten().fieldErrors);
  }
  const d = parsed.data;

  // Attendees must belong to this farm. Zod checked the shape of the uuid; it
  // cannot know whose employee it is.
  const employeeIds = d.attendeeEmployeeIds ?? [];
  for (const employeeId of employeeIds) {
    const [emp] = await db.select().from(s.employee).where(eq(s.employee.id, employeeId));
    assertOwned(emp, session, "employee");
  }

  const id = newId();
  let expenseId: string | null = null;

  // A paid seminar is a real farm cost. It lands PENDING like every other
  // staff-recorded expense — nothing moves a report until a manager approves.
  if (d.costKes && d.costKes > 0) {
    expenseId = newId();
    await db
      .insert(s.expense)
      .values({
        id: expenseId,
        farmId: session.farmId,
        incurredOn: d.heldOn ?? today(),
        category: "LABOUR",
        description: `Training: ${d.title}`,
        amountKes: d.costKes.toFixed(2),
        status: "PENDING",
        recordedBy: session.userId,
      })
      .onConflictDoNothing();
  }

  await db
    .insert(s.trainingEvent)
    .values({
      id,
      farmId: session.farmId,
      title: d.title,
      kind: d.kind ?? null,
      heldOn: d.heldOn ?? null,
      trainer: d.trainer ?? null,
      topic: d.topic ?? null,
      costKes: d.costKes != null ? d.costKes.toFixed(2) : null,
      materialsUrl: d.materialsUrl ?? null,
      expenseId,
    })
    .onConflictDoNothing();

  const attendance = [
    ...employeeIds.map((employeeId) => ({
      id: newId(),
      trainingEventId: id,
      employeeId,
      attendeeName: null,
    })),
    ...(d.attendeeNames ?? []).map((attendeeName) => ({
      id: newId(),
      trainingEventId: id,
      employeeId: null,
      attendeeName,
    })),
  ];
  if (attendance.length) {
    await db.insert(s.trainingAttendance).values(attendance).onConflictDoNothing();
  }

  return actionOk(
    { id, expenseId },
    `Recorded "${d.title}"${attendance.length ? ` for ${attendance.length} people` : ""}.`,
  );
}

export async function listTraining(session: Session, db: Db = defaultDb) {
  const events = await db
    .select()
    .from(s.trainingEvent)
    .where(eq(s.trainingEvent.farmId, session.farmId))
    .orderBy(desc(s.trainingEvent.heldOn));

  const counts = await db
    .select({
      trainingEventId: s.trainingAttendance.trainingEventId,
      attendees: sql<number>`count(*)::int`,
    })
    .from(s.trainingAttendance)
    .innerJoin(s.trainingEvent, eq(s.trainingEvent.id, s.trainingAttendance.trainingEventId))
    .where(eq(s.trainingEvent.farmId, session.farmId))
    .groupBy(s.trainingAttendance.trainingEventId);

  const byEvent = new Map(counts.map((c) => [c.trainingEventId, c.attendees]));
  return events.map((e) => ({
    ...e,
    attendees: byEvent.get(e.id) ?? 0,
    costKes: num(e.costKes),
  }));
}

/** Who on the farm has never been to a training. The gap worth closing. */
export async function untrainedStaff(session: Session, db: Db = defaultDb) {
  const staff = await db
    .select({ id: s.employee.id, fullName: s.employee.fullName, role: s.employee.role })
    .from(s.employee)
    .where(and(eq(s.employee.farmId, session.farmId), sql`${s.employee.endedOn} is null`));

  const attended = await db
    .select({ employeeId: s.trainingAttendance.employeeId })
    .from(s.trainingAttendance)
    .innerJoin(s.trainingEvent, eq(s.trainingEvent.id, s.trainingAttendance.trainingEventId))
    .where(eq(s.trainingEvent.farmId, session.farmId));

  const seen = new Set(attended.map((a) => a.employeeId).filter(Boolean));
  return staff.filter((p) => !seen.has(p.id));
}

/* ---------------------------------------------------------------- */
/* Help content                                                      */
/* ---------------------------------------------------------------- */

export interface HelpTopic {
  slug: string;
  screen: string;
  title: string;
  titleSw: string;
  steps: string[];
  stepsSw: string[];
  /** Audio matters more than translation: text is unusable for first-time
   *  low-literacy users, and DigiCow's vernacular voice notes are its
   *  most-praised feature. */
  audioUrl?: string;
}

export const HELP_TOPICS: HelpTopic[] = [
  {
    slug: "record-a-milking",
    screen: "/milk",
    title: "Record a milking",
    titleSw: "Kuandika maziwa",
    steps: [
      "Tap MILK on the home screen.",
      "Each cow already shows yesterday's litres. If it is the same today, leave it.",
      "Change only the cows that are different.",
      "A locked row means her milk cannot be sold yet — the reason is on the row.",
      "Tap SAVE. You will get a receipt with a code, even with no network.",
    ],
    stepsSw: [
      "Gusa MAZIWA kwenye skrini ya kwanza.",
      "Kila ng'ombe ameonyeshwa lita za jana. Kama ni sawa leo, achana nayo.",
      "Badilisha tu ng'ombe walio tofauti.",
      "Mstari uliofungwa maana yake maziwa yake hayawezi kuuzwa bado — sababu iko hapo.",
      "Gusa HIFADHI. Utapata risiti na nambari, hata bila mtandao.",
    ],
  },
  {
    slug: "record-a-service",
    screen: "/breeding",
    title: "Record a service",
    titleSw: "Kuandika kupandwa",
    steps: [
      "Tap BREEDING, then the cow.",
      "Enter the date, whether it was AI or a bull, and the straw code.",
      "The app immediately shows you when to watch for a return to heat, when the pregnancy check is due, and when she should calve.",
      "It will remind you before each one.",
    ],
    stepsSw: [
      "Gusa UZAZI, kisha chagua ng'ombe.",
      "Weka tarehe, kama ni AI au fahali, na nambari ya mbegu.",
      "Programu itakuonyesha mara moja lini kuangalia kama atarudia joto, lini kupima mimba, na lini atazaa.",
      "Itakukumbusha kabla ya kila moja.",
    ],
  },
  {
    slug: "treat-an-animal",
    screen: "/health",
    title: "Treat an animal",
    titleSw: "Kutibu mnyama",
    steps: [
      "Tap HEALTH, then the animal.",
      "Choose the medicine you actually used. The waiting time comes from that medicine's label.",
      "The app tells you the exact date her milk can be sold again.",
      "Until then her row on the milking sheet is locked. This protects the whole farm — one cow's milk can spoil a whole load.",
    ],
    stepsSw: [
      "Gusa AFYA, kisha chagua mnyama.",
      "Chagua dawa uliyotumia. Muda wa kusubiri unatoka kwenye lebo ya dawa hiyo.",
      "Programu itakuambia tarehe kamili maziwa yake yanaweza kuuzwa tena.",
      "Hadi wakati huo mstari wake umefungwa. Hii inalinda shamba lote — maziwa ya ng'ombe mmoja yanaweza kuharibu mzigo mzima.",
    ],
  },
  {
    slug: "the-delivery-round",
    screen: "/sales/round",
    title: "Do the delivery round",
    titleSw: "Kupeleka maziwa kwa wateja",
    steps: [
      "Tap DELIVERY. Today's customers are already listed with their usual litres.",
      "Change only what is different, or skip anyone who is away.",
      "If a customer owes too much, you will see a warning before you deliver, not after.",
      "Record cash or M-Pesa as you go, or leave it on their account.",
    ],
    stepsSw: [
      "Gusa KUPELEKA. Wateja wa leo wameorodheshwa na lita zao za kawaida.",
      "Badilisha tu kilicho tofauti, au ruka aliyesafiri.",
      "Kama mteja anadaiwa sana, utaonywa kabla ya kumpelekea, si baada.",
      "Andika pesa taslimu au M-Pesa hapohapo, au acha kwenye deni lake.",
    ],
  },
];

export function helpForScreen(screen: string): HelpTopic[] {
  return HELP_TOPICS.filter((t) => screen.startsWith(t.screen));
}

export function helpTopic(slug: string): HelpTopic | undefined {
  return HELP_TOPICS.find((t) => t.slug === slug);
}
