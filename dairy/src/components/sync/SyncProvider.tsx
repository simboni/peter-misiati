"use client";

/**
 * The thing that actually drains the outbox.
 *
 * Before this existed, a milk sheet saved with no signal was written to
 * IndexedDB and stayed there: nothing in the app ever called `flush()`. The
 * chip said "Saved on phone (1 waiting)" and it was a lie. A herdsman who
 * loses one milking goes back to the notebook and does not come back.
 *
 * It lives in the root layout so it keeps working after the herdsman leaves the
 * milk screen — the whole point is that he does not have to sit and watch it.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  flush,
  pending,
  requestPersistentStorage,
  retryNow,
  startAutoFlush,
  summarise,
  type OutboxEntry,
  type SyncState,
} from "@/lib/outbox";
import type { OutboxSendResult } from "@/lib/sync-actions";

type SendAction = (kind: string, payload: unknown) => Promise<OutboxSendResult>;

interface SyncContextValue {
  state: SyncState;
  /** How many writes are on the phone and not yet in the office. */
  waiting: number;
  /**
   * The farm this phone is signed in to, or null when nobody is. The milk sheet
   * needs it to derive the same receipt code the server will.
   */
  farmId: string | null;
  /** Send everything now, ignoring the retry schedule. */
  sendNow: () => void;
  /** Re-read the queue after a save, so the chip is honest immediately. */
  refresh: () => void;
}

const SyncContext = createContext<SyncContextValue | null>(null);

/** Null outside a provider — callers degrade rather than crash. */
export function useSync(): SyncContextValue | null {
  return useContext(SyncContext);
}

export function SyncProvider({
  farmId,
  userId,
  send,
  children,
}: {
  farmId: string | null;
  /** Only used to notice that a different person picked up the phone. */
  userId: string | null;
  send: SendAction;
  children: React.ReactNode;
}) {
  const [state, setState] = useState<SyncState>({ status: "synced" });
  const [waiting, setWaiting] = useState(0);

  // The Server Action identity changes on every server render; the flusher must
  // not be torn down and restarted each time, or the interval never elapses.
  const sendRef = useRef(send);
  sendRef.current = send;

  const apply = useCallback((s: SyncState) => {
    setState(s);
    setWaiting("waiting" in s ? s.waiting : 0);
  }, []);

  const refresh = useCallback(() => {
    void pending()
      .then((q) => apply(summarise(q)))
      .catch(() => {
        /* No IndexedDB at all — private mode, an old browser. Say nothing. */
      });
  }, [apply]);

  const sender = useCallback(async (entry: OutboxEntry) => {
    const result = await sendRef.current(entry.kind, entry.payload);
    if (result.ok) return;
    // Nobody signed in is not this entry's fault. Throwing keeps it queued;
    // the attempt counter is what eventually stops the app trying, and a
    // signed-out phone would otherwise burn the whole retry budget in an hour.
    throw new Error(result.error ?? "Not sent.");
  }, []);

  useEffect(() => {
    if (!farmId) {
      // Signed out. Anything queued stays exactly where it is.
      refresh();
      return;
    }

    // Ask the browser to treat the queue as durable rather than as cache it may
    // drop under storage pressure.
    void requestPersistentStorage();

    const stop = startAutoFlush((entry) => sender(entry), { onState: apply });
    return stop;
  }, [farmId, sender, apply, refresh]);

  // A different person picking up the same phone must not be shown the pages
  // cached for the last one. Four people share one handset here.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const KEY = "dairy:last-user";
    const previous = window.localStorage.getItem(KEY);
    if (userId && previous && previous !== userId) {
      navigator.serviceWorker?.controller?.postMessage({ type: "clear-pages" });
    }
    if (userId) window.localStorage.setItem(KEY, userId);
  }, [userId]);

  const sendNow = useCallback(() => {
    void retryNow()
      .then(() => flush((entry) => sender(entry), { onState: apply }))
      .catch(() => refresh());
  }, [sender, apply, refresh]);

  const value = useMemo(
    () => ({ state, waiting, farmId, sendNow, refresh }),
    [state, waiting, farmId, sendNow, refresh],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}
