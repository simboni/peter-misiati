"use client";

import { useEffect } from "react";
import { isNativeApp, nativePlatform } from "@/lib/native";
import { savePushTokenAction } from "@/server/actions/push";

/**
 * Registers the installed app for push notifications and saves the FCM device
 * token. Native-only and fully defensive — if the plugin or Firebase config
 * isn't present it simply does nothing (never affects the web or app loading).
 */
export function PushRegistration() {
  useEffect(() => {
    if (!isNativeApp()) return;
    let cancelled = false;
    const handles: Array<{ remove: () => void }> = [];

    (async () => {
      try {
        const { PushNotifications } = await import("@capacitor/push-notifications");
        let perm = await PushNotifications.checkPermissions();
        if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
          perm = await PushNotifications.requestPermissions();
        }
        if (perm.receive !== "granted") return;

        handles.push(
          await PushNotifications.addListener("registration", (t) => {
            if (!cancelled) void savePushTokenAction(t.value, nativePlatform()).catch(() => {});
          }),
        );
        handles.push(await PushNotifications.addListener("registrationError", () => {}));
        await PushNotifications.register();
      } catch {
        /* plugin unavailable or Firebase not configured — no push on this build */
      }
    })();

    return () => {
      cancelled = true;
      for (const h of handles) {
        try {
          h.remove();
        } catch {
          /* ignore */
        }
      }
    };
  }, []);

  return null;
}
