import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/db/test-db";
import * as s from "@/db/schema";
import {
  FARM_ID,
  fakeSession,
  seedEmployee,
  seedFarm,
  seedUser,
} from "@/test/factory";
import { newId } from "@/lib/ids";
import {
  HELP_TOPICS,
  helpForScreen,
  helpTopic,
  listTickets,
  listTraining,
  raiseTicketFor,
  recordTrainingFor,
  resolveTicketFor,
  supportChannels,
  untrainedStaff,
} from "./support";

async function setup() {
  const t = await createTestDb();
  await seedFarm(t.db);
  const userId = await seedUser(t.db, { role: "MANAGER", fullName: "Peter Kariuki" });
  return { ...t, session: fakeSession({ userId, role: "MANAGER" }) };
}

/** A second farm, to prove one cannot reach into the other. */
async function seedOtherFarm(db: Awaited<ReturnType<typeof createTestDb>>["db"]) {
  const otherFarmId = newId();
  await db.insert(s.farm).values({ id: otherFarmId, name: "Someone Else's Farm" });
  const employeeId = newId();
  await db.insert(s.employee).values({
    id: employeeId,
    farmId: otherFarmId,
    fullName: "Not Our Worker",
    role: "HERDSMAN",
    employmentType: "PERMANENT",
    startedOn: "2025-01-01",
  });
  const ticketUserId = newId();
  await db.insert(s.appUser).values({
    id: ticketUserId,
    farmId: otherFarmId,
    fullName: "Their Manager",
    role: "MANAGER",
    pinHash: "x",
  });
  const ticketId = newId();
  await db.insert(s.supportTicket).values({
    id: ticketId,
    farmId: otherFarmId,
    raisedBy: ticketUserId,
    message: "Their private problem",
  });
  return { otherFarmId, employeeId, ticketId };
}

describe("raising a support ticket", () => {
  it("captures the screen and sync state so nobody has to describe a bug", async () => {
    const t = await setup();
    const res = await raiseTicketFor(
      t.session,
      {
        message: "The milk screen would not save",
        screen: "/milk",
        syncState: { pending: 3, online: false },
      },
      t.db,
    );

    expect(res.ok).toBe(true);
    const [row] = await t.db.select().from(s.supportTicket).where(eq(s.supportTicket.farmId, FARM_ID));
    expect(row.message).toBe("The milk screen would not save");
    // The two things a user cannot reliably report themselves.
    expect(row.screen).toBe("/milk");
    expect(row.syncState).toEqual({ pending: 3, online: false });
    expect(row.status).toBe("OPEN");
    await t.close();
  });

  it("asks for the message and nothing else — a bug report must be one field", async () => {
    const t = await setup();
    const res = await raiseTicketFor(t.session, { message: "  " }, t.db);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("Tell us what happened.");
    expect(await t.db.select().from(s.supportTicket)).toHaveLength(0);
    await t.close();
  });

  it("replays an offline ticket without duplicating it", async () => {
    const t = await setup();
    const id = newId();
    const row = {
      id,
      farmId: FARM_ID,
      raisedBy: t.session.userId,
      message: "Sent twice on a bad line",
    };
    await t.db.insert(s.supportTicket).values(row).onConflictDoNothing();
    await t.db.insert(s.supportTicket).values(row).onConflictDoNothing();
    expect(await t.db.select().from(s.supportTicket)).toHaveLength(1);
    await t.close();
  });

  it("survives a malformed sync blob rather than losing the message", async () => {
    const t = await setup();
    // The sync snapshot is diagnostic. Losing the user's actual words because
    // the diagnostics were broken would be the wrong trade.
    const res = await raiseTicketFor(
      t.session,
      { message: "Something is wrong", syncState: undefined },
      t.db,
    );
    expect(res.ok).toBe(true);
    const [row] = await t.db.select().from(s.supportTicket);
    expect(row.message).toBe("Something is wrong");
    expect(row.syncState).toBeNull();
    await t.close();
  });
});

describe("listing and resolving tickets", () => {
  it("shows only this farm's tickets, newest first, with who raised them", async () => {
    const t = await setup();
    await seedOtherFarm(t.db);
    await raiseTicketFor(t.session, { message: "Ours" }, t.db);

    const list = await listTickets(t.session, {}, t.db);
    expect(list).toHaveLength(1);
    expect(list[0].message).toBe("Ours");
    expect(list[0].raisedByName).toBe("Peter Kariuki");
    await t.close();
  });

  it("refuses another farm's ticket the same way it refuses one that does not exist", async () => {
    const t = await setup();
    const theirs = await seedOtherFarm(t.db);

    await expect(resolveTicketFor(t.session, theirs.ticketId, t.db)).rejects.toThrow(
      "That message was not found.",
    );
    await expect(resolveTicketFor(t.session, newId(), t.db)).rejects.toThrow(
      "That message was not found.",
    );

    const [untouched] = await t.db
      .select()
      .from(s.supportTicket)
      .where(eq(s.supportTicket.id, theirs.ticketId));
    expect(untouched.status).toBe("OPEN");
    await t.close();
  });

  it("marks a ticket sorted", async () => {
    const t = await setup();
    const res = await raiseTicketFor(t.session, { message: "Fixed now" }, t.db);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    await resolveTicketFor(t.session, res.data.id, t.db);
    const [row] = await t.db.select().from(s.supportTicket).where(eq(s.supportTicket.id, res.data.id));
    expect(row.status).toBe("RESOLVED");
    expect(row.resolvedAt).not.toBeNull();
    await t.close();
  });
});

describe("support channels", () => {
  it("offers WhatsApp when a number is configured, because that is what Kenyan businesses use", () => {
    process.env.SUPPORT_PHONE = "+254 712 345 678";
    const c = supportChannels();
    expect(c.whatsappUrl).toBe("https://wa.me/254712345678");
    expect(c.responseTime).toMatch(/WhatsApp/);
    delete process.env.SUPPORT_PHONE;
  });

  it("degrades quietly when no number is set rather than showing a dead link", () => {
    delete process.env.SUPPORT_PHONE;
    expect(supportChannels().whatsappUrl).toBeNull();
  });
});

describe("training", () => {
  it("records a seminar with its attendees", async () => {
    const t = await setup();
    const a = await seedEmployee(t.db, { fullName: "Kamau Mwangi" });
    const b = await seedEmployee(t.db, { fullName: "Otieno Odhiambo" });

    const res = await recordTrainingFor(
      t.session,
      {
        title: "Clean milk production",
        kind: "SEMINAR",
        heldOn: "2026-08-12",
        trainer: "Limuru Dairy extension officer",
        attendeeEmployeeIds: [a, b],
      },
      t.db,
    );

    expect(res.ok).toBe(true);
    const list = await listTraining(t.session, t.db);
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe("Clean milk production");
    expect(list[0].attendees).toBe(2);
    await t.close();
  });

  it("posts a paid training to expenses as PENDING, like every other staff-recorded cost", async () => {
    const t = await setup();
    const res = await recordTrainingFor(
      t.session,
      { title: "Mastitis control", heldOn: "2026-08-12", costKes: 4500 },
      t.db,
    );
    expect(res.ok).toBe(true);

    const [expense] = await t.db.select().from(s.expense).where(eq(s.expense.farmId, FARM_ID));
    expect(expense.amountKes).toBe("4500.00");
    expect(expense.category).toBe("LABOUR");
    // Segregation of duties holds here too — recording is not approving.
    expect(expense.status).toBe("PENDING");
    await t.close();
  });

  it("writes no expense for a free extension visit", async () => {
    const t = await setup();
    await recordTrainingFor(t.session, { title: "Free county field day", kind: "FIELD_DAY" }, t.db);
    expect(await t.db.select().from(s.expense)).toHaveLength(0);
    await t.close();
  });

  it("records people who are not on the payroll by name", async () => {
    const t = await setup();
    await recordTrainingFor(
      t.session,
      { title: "Calf rearing", attendeeNames: ["Neighbour's son", "Grace's sister"] },
      t.db,
    );
    const list = await listTraining(t.session, t.db);
    expect(list[0].attendees).toBe(2);
    await t.close();
  });

  it("refuses another farm's employee as an attendee", async () => {
    const t = await setup();
    const theirs = await seedOtherFarm(t.db);
    await expect(
      recordTrainingFor(
        t.session,
        { title: "Hijack attempt", attendeeEmployeeIds: [theirs.employeeId] },
        t.db,
      ),
    ).rejects.toThrow("That employee was not found.");
    // Nothing was written — the check runs before any insert.
    expect(await t.db.select().from(s.trainingEvent)).toHaveLength(0);
    await t.close();
  });

  it("names the staff who have never been trained", async () => {
    const t = await setup();
    const trained = await seedEmployee(t.db, { fullName: "Kamau Mwangi" });
    await seedEmployee(t.db, { fullName: "Jane Nyambura" });
    await recordTrainingFor(
      t.session,
      { title: "Clean milk", attendeeEmployeeIds: [trained] },
      t.db,
    );

    const gap = await untrainedStaff(t.session, t.db);
    expect(gap.map((p) => p.fullName)).toEqual(["Jane Nyambura"]);
    await t.close();
  });

  it("needs a name for the training", async () => {
    const t = await setup();
    const res = await recordTrainingFor(t.session, { title: "" }, t.db);
    expect(res.ok).toBe(false);
    await t.close();
  });
});

describe("help content", () => {
  it("offers every topic in Swahili as well as English", () => {
    for (const topic of HELP_TOPICS) {
      expect(topic.titleSw.length).toBeGreaterThan(0);
      // Both languages must cover the same ground, or the Swahili user is
      // getting an abridged product.
      expect(topic.stepsSw).toHaveLength(topic.steps.length);
    }
  });

  it("finds the help for the screen the user is actually on", () => {
    expect(helpForScreen("/milk").map((t) => t.slug)).toContain("record-a-milking");
    expect(helpForScreen("/sales/round").map((t) => t.slug)).toContain("the-delivery-round");
    expect(helpForScreen("/nowhere")).toHaveLength(0);
  });

  it("explains the withdrawal lock as protecting the farm, not as a rule imposed on it", () => {
    const topic = helpTopic("treat-an-animal");
    expect(topic).toBeDefined();
    const text = topic!.steps.join(" ");
    // Framing matters: staff who read the app as surveillance produce
    // compliant, false data.
    expect(text).toMatch(/protects the whole farm/);
    expect(text).not.toMatch(/violation|forbidden|illegal/i);
  });

  it("keeps every step in plain words a herdsman would use", () => {
    for (const topic of HELP_TOPICS) {
      for (const step of topic.steps) {
        expect(step).not.toMatch(/\b(API|UUID|null|database|sync token|payload)\b/i);
      }
    }
  });
});
