/**
 * Bridge to native (Capacitor) capabilities. TallyPay's native apps load the
 * live site, so this code runs both in a normal browser and inside the app —
 * every helper degrades gracefully when a capability isn't present.
 *
 * Plugin modules are imported dynamically inside handlers so they never touch
 * the server bundle and add nothing to the initial web payload.
 */

type Cap = { isNativePlatform?: () => boolean; getPlatform?: () => string };

function cap(): Cap | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { Capacitor?: Cap }).Capacitor;
}

/** True only when running inside the installed native app (not the web browser). */
export function isNativeApp(): boolean {
  const c = cap();
  return !!(c && typeof c.isNativePlatform === "function" && c.isNativePlatform());
}

/** "ios" | "android" | "web" */
export function nativePlatform(): string {
  const c = cap();
  return c?.getPlatform?.() ?? "web";
}

/** Whether a share sheet is available (native app, or a browser with Web Share). */
export function canShare(): boolean {
  if (isNativeApp()) return true;
  return typeof navigator !== "undefined" && typeof (navigator as Navigator).share === "function";
}

/**
 * Open the OS share sheet. Uses the native Capacitor plugin inside the app and
 * the Web Share API in a browser. Returns true if the sheet opened, false if no
 * share mechanism exists (caller can then fall back to copy-link).
 */
export async function share(opts: { title?: string; text?: string; url?: string }): Promise<boolean> {
  if (isNativeApp()) {
    try {
      const { Share } = await import("@capacitor/share");
      await Share.share({
        title: opts.title,
        text: opts.text,
        url: opts.url,
        dialogTitle: opts.title,
      });
      return true;
    } catch {
      // fall through to web share
    }
  }
  try {
    const nav = navigator as Navigator;
    if (typeof nav.share === "function") {
      await nav.share({ title: opts.title, text: opts.text, url: opts.url });
      return true;
    }
  } catch {
    // user cancelled, or unsupported — treat as "not shared"
  }
  return false;
}
