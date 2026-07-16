"use client";

import { useCallback, useEffect, useState } from "react";
import { BrandMark, APP_NAME } from "@/components/brand";

/**
 * PWA install UX. TallyPay is an installable web app, so "getting the app" is a
 * one-tap install straight from the browser — no store, no download file.
 *
 * - Android/Chrome/Edge fire `beforeinstallprompt`, which we stash early (see the
 *   inline script in the root layout) and replay on click via `prompt()`.
 * - iOS Safari has no such API, so we detect it and show the manual
 *   Share → "Add to Home Screen" steps instead.
 * - When already running installed (standalone display-mode) we render nothing.
 */

type BipEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

declare global {
  interface Window {
    __tpInstallEvent?: BipEvent | null;
  }
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS Safari
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const iOSDevice = /iPad|iPhone|iPod/.test(ua);
  // iPadOS 13+ reports as Mac; sniff touch support to catch it.
  const iPadOS = /Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1;
  return iOSDevice || iPadOS;
}

type InstallState = {
  /** The native prompt is available and can be replayed on click. */
  ready: boolean;
  /** iOS — no native prompt; show manual instructions. */
  ios: boolean;
  /** Already installed / running standalone — hide everything. */
  installed: boolean;
  /** Fire the native install prompt. Returns true if the user accepted. */
  promptInstall: () => Promise<boolean>;
};

function useInstall(): InstallState {
  const [ready, setReady] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    setInstalled(isStandalone());
    setIos(isIOS());
    // The event may already have been captured by the layout script.
    if (window.__tpInstallEvent) setReady(true);

    const onReady = () => setReady(Boolean(window.__tpInstallEvent));
    const onInstalled = () => {
      setReady(false);
      setInstalled(true);
    };
    window.addEventListener("tp:installready", onReady);
    window.addEventListener("tp:installed", onInstalled);
    return () => {
      window.removeEventListener("tp:installready", onReady);
      window.removeEventListener("tp:installed", onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    const evt = window.__tpInstallEvent;
    if (!evt) return false;
    await evt.prompt();
    const choice = await evt.userChoice.catch(() => ({ outcome: "dismissed" as const }));
    window.__tpInstallEvent = null;
    setReady(false);
    return choice.outcome === "accepted";
  }, []);

  return { ready, ios, installed, promptInstall };
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <rect x="7" y="3" width="10" height="18" rx="2" />
      <path d="M11 18h2" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="inline h-4 w-4 align-text-bottom">
      <path d="M12 16V4M8 8l4-4 4 4" />
      <path d="M6 12v6a2 2 0 002 2h8a2 2 0 002-2v-6" />
    </svg>
  );
}

/** iOS "Add to Home Screen" instruction card. */
function IosSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-6 text-ink shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <BrandMark size={28} />
          <p className="font-bold">Install {APP_NAME}</p>
        </div>
        <p className="mt-3 text-sm text-slate-600">Add {APP_NAME} to your home screen — it opens full-screen, just like an app.</p>
        <ol className="mt-4 space-y-3 text-sm">
          <li className="flex gap-3">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-bold text-brand-700">1</span>
            <span>Tap the <b>Share</b> button <ShareIcon /> in Safari&apos;s toolbar.</span>
          </li>
          <li className="flex gap-3">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-bold text-brand-700">2</span>
            <span>Scroll down and tap <b>Add to Home Screen</b>.</span>
          </li>
          <li className="flex gap-3">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-bold text-brand-700">3</span>
            <span>Tap <b>Add</b> — the {APP_NAME} icon appears on your home screen.</span>
          </li>
        </ol>
        <button onClick={onClose} className="btn-primary mt-6 w-full py-2.5">Got it</button>
      </div>
    </div>
  );
}

/**
 * Inline "Install app" button. Renders only when install is actually possible
 * (native prompt ready, or iOS where we can show manual steps). On desktop
 * browsers without the prompt it renders nothing so we never show a dead button.
 */
export function InstallButton({ className = "" }: { className?: string }) {
  const { ready, ios, installed, promptInstall } = useInstall();
  const [showIos, setShowIos] = useState(false);

  if (installed) return null;
  if (!ready && !ios) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => (ios ? setShowIos(true) : void promptInstall())}
        className={className || "btn-ghost btn-sm gap-1.5"}
      >
        <PhoneIcon /> Install app
      </button>
      {showIos && <IosSheet onClose={() => setShowIos(false)} />}
    </>
  );
}

const DISMISS_KEY = "tp:install-dismissed";

/**
 * Dismissible bottom banner inviting the visitor to install the app. Shows once
 * install is available and stays hidden after the user dismisses it or installs.
 */
export function InstallBanner() {
  const { ready, ios, installed, promptInstall } = useInstall();
  const [dismissed, setDismissed] = useState(true);
  const [showIos, setShowIos] = useState(false);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  const close = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  if (installed || dismissed) return null;
  if (!ready && !ios) return null;

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4">
        <div className="mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-line bg-white p-3 shadow-[0_12px_40px_-12px_rgba(2,44,34,0.35)]">
          <BrandMark size={38} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-ink">Install {APP_NAME}</p>
            <p className="truncate text-xs text-slate-600">Add it to your phone — opens full-screen, works offline.</p>
          </div>
          <button
            onClick={() => (ios ? setShowIos(true) : void promptInstall().then((ok) => ok && close()))}
            className="btn-primary btn-sm shrink-0"
          >
            Install
          </button>
          <button onClick={close} aria-label="Dismiss" className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      </div>
      {showIos && <IosSheet onClose={() => setShowIos(false)} />}
    </>
  );
}
