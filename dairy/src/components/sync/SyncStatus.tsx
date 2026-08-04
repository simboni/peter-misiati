"use client";

/**
 * The sync bar. Says where the work is, in words, on every screen.
 *
 * It appears only when there is something to say. A permanent "All sent" badge
 * is noise a herdsman learns to stop reading, and the one moment it matters —
 * a milking still sitting on the phone — is the moment it must not look like
 * the wallpaper.
 *
 * Deliberately in the normal flow at the top of the page, not floating: the
 * milk sheet keeps its running total and Save button pinned to the bottom, and
 * nothing may ever sit on top of those.
 */

import { describeSyncState, explainSyncState } from "@/lib/outbox";
import { useSync } from "./SyncProvider";

export function SyncStatus() {
  const sync = useSync();
  if (!sync || sync.state.status === "synced") return null;

  const { state } = sync;
  const stuck = state.status === "stuck";
  const sending = state.status === "sending";

  const tone = stuck
    ? "border-danger bg-danger-soft"
    : sending
      ? "border-brand bg-brand-soft"
      : "border-brass bg-brass-soft";
  const mark = stuck ? "⛔" : sending ? "↑" : "✓";
  const detail = explainSyncState(state);

  return (
    <div
      role="status"
      className={`border-b-2 px-4 py-2 text-sm ${tone}`}
    >
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-3 gap-y-1">
        <span aria-hidden className="text-base">
          {mark}
        </span>
        <span className="font-semibold">{describeSyncState(state)}</span>
        {detail ? <span className="text-ink-2">{detail}</span> : null}
        {!sending ? (
          <button
            type="button"
            onClick={sync.sendNow}
            className="ml-auto rounded-md border border-line bg-surface px-3 py-1 font-semibold"
          >
            Send now
          </button>
        ) : null}
      </div>
    </div>
  );
}
