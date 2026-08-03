"use server";

import { requireOrg } from "@/server/org";
import { savePushToken } from "@/server/push";

/** Called by the native app after it obtains an FCM device token. */
export async function savePushTokenAction(token: string, platform: string): Promise<void> {
  if (!token) return;
  const { db, organizationId, userId } = await requireOrg();
  await savePushToken(db, { organizationId, userId, token, platform: platform || "android" });
}
