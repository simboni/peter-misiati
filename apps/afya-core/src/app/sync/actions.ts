"use server";

import { act } from "@/app/_components/act.ts";
import { requireUser } from "@/lib/auth.ts";
import { requirePermission } from "@/lib/access.ts";
import { get } from "@/lib/db.ts";
import { reviewConflict, markSynced, type ConflictRow } from "@/lib/sync.ts";
import {
  exchange, packOutbound, confirmPushed, applyInbound, fileTransport,
  batchPath, outboundName, TransportError,
} from "@/lib/sync-transport.ts";

/**
 * Carrying a batch, and answering for a conflict.
 *
 * Two different jobs on one screen because they are two halves of the same
 * sentence: the records clerk moves the stick, and the conflict the merge could
 * not settle is what a clinician has to read afterwards.
 */

async function operator() {
  const user = await requireUser();
  requirePermission(user.userId, "device.manage", { actorName: user.name, facilityId: user.facilityId });
  if (!user.deviceCode) {
    throw new TransportError(
      "this session is not on a registered device, and a batch has to say which device packed it — sign in from the device that is carrying the stick",
    );
  }
  return { ...user, deviceCode: user.deviceCode };
}

/** A file the operator picked. Never a path they typed: `batchPath` refuses one. */
function chosen(formData: FormData): string {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new TransportError("pick a batch to collect");
  return batchPath(name);
}

/**
 * Write what is waiting, and apply what they left, in that order.
 *
 * Push first: if anything goes wrong in the second half this device has lost
 * nothing, because its ops only stop being pending once the write succeeded.
 */
export async function exchangeAction(formData: FormData): Promise<void> {
  await act("/sync", async () => {
    const user = await operator();
    const result = exchange({
      transport: fileTransport(batchPath(outboundName(user.deviceCode)), chosen(formData)),
      deviceCode: user.deviceCode,
      facilityId: user.facilityId,
      byUserName: user.name,
    });

    // A refused batch is not an error to swallow. The operator is standing at
    // the machine holding the stick that carried it, and they are the only
    // person who can go back for a good copy.
    if (!result.sent) throw new TransportError(result.error ?? "that batch could not be written");
    if (result.refused) throw new TransportError(result.refused);
    markSynced(user.deviceCode);
  });
}

/** Write the outgoing batch and nothing else — for when there is none to collect. */
export async function writeBatchAction(): Promise<void> {
  await act("/sync", async () => {
    const user = await operator();
    const envelope = packOutbound({ deviceCode: user.deviceCode, facilityId: user.facilityId });
    // Refused rather than written. An empty batch is clutter in a folder
    // somebody has to pick the right file out of, and the screen offering the
    // button at all means it was looking at a stale page.
    if (envelope.ops.length === 0) {
      throw new TransportError("nothing of this device's is waiting, so there is no batch to write");
    }
    const transport = fileTransport(batchPath(outboundName(user.deviceCode)));

    const sent = transport.send(envelope);
    if (!sent.ok) throw new TransportError(sent.error ?? "that batch could not be written");

    // Only now. Marking on packing loses every op in a batch that never landed.
    confirmPushed(envelope, user.name);
    markSynced(user.deviceCode);
  });
}

/** Apply a batch somebody carried in, without sending anything back. */
export async function collectAction(formData: FormData): Promise<void> {
  await act("/sync", async () => {
    const user = await operator();
    const envelope = fileTransport(batchPath(outboundName(user.deviceCode)), chosen(formData)).receive();
    if (!envelope) throw new TransportError("that file could not be read as a batch");

    const applied = applyInbound({
      envelope,
      facilityId: user.facilityId,
      localDeviceCode: user.deviceCode,
      byUserName: user.name,
    });
    if (!applied.ok) throw new TransportError(applied.why);
  });
}

/**
 * Sign off a conflict the merge kept both sides of.
 *
 * A clinical conflict is two clinicians documenting the same thing, and only a
 * clinician can say which reading stands — so the permission follows the data
 * class rather than the screen.
 */
export async function reviewAction(formData: FormData): Promise<void> {
  await act("/sync?view=conflicts", async () => {
    const user = await requireUser();
    const id = Number(formData.get("id") ?? 0);
    const conflict = get<ConflictRow>(`SELECT * FROM sync_conflicts WHERE id = ?`, id);
    if (!conflict) throw new TransportError("no such conflict");

    requirePermission(
      user.userId,
      conflict.data_class === "clinical" ? "encounter.conduct" : "report.read",
      { actorName: user.name, facilityId: user.facilityId },
    );

    reviewConflict({
      id,
      byUserId: user.userId,
      byUserName: user.name,
      note: String(formData.get("note") ?? "").trim() || undefined,
    });
  });
}
