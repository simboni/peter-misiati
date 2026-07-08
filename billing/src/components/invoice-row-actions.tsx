"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { deleteInvoiceAction } from "@/server/actions/invoices";

const MENU_W = 200;

export function InvoiceRowActions({
  id,
  shareToken,
  canPay,
  kind = "invoice",
}: {
  id: string;
  shareToken: string;
  canPay: boolean;
  kind?: "invoice" | "quotation";
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const base = kind === "quotation" ? "/quotations" : "/invoices";

  // Position the menu next to the trigger in viewport coords. Opens downward,
  // but flips upward when there isn't room below (e.g. rows near the page
  // bottom on mobile), and is clamped so it never runs off-screen.
  const place = useCallback(() => {
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    const vh = window.innerHeight;
    const margin = 8;
    const gap = 6;
    const menuH = menuRef.current?.offsetHeight || 260; // measured once mounted, else estimate
    const left = Math.max(margin, Math.min(b.right - MENU_W, window.innerWidth - MENU_W - margin));

    const spaceBelow = vh - b.bottom - margin;
    const spaceAbove = b.top - margin;
    const openUp = spaceBelow < menuH && spaceAbove > spaceBelow;

    let top = openUp ? b.top - menuH - gap : b.bottom + gap;
    top = Math.max(margin, Math.min(top, vh - menuH - margin));
    setCoords({ top, left });
  }, []);

  // Place after the menu mounts (so we can measure its real height), then again
  // on the next frame in case content/layout settled.
  useLayoutEffect(() => {
    if (!open) return;
    place();
    const r = requestAnimationFrame(place);
    return () => cancelAnimationFrame(r);
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const reposition = () => place();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", reposition);
    // capture scroll from any container so the menu re-tracks the trigger
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, place]);

  const item = "flex items-center gap-2 px-3 py-2 text-sm text-ink hover:bg-canvas w-full text-left";

  return (
    <div className="flex justify-end">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Actions"
        aria-haspopup="menu"
        aria-expanded={open}
        className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-canvas hover:text-ink"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
          <circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" />
        </svg>
      </button>

      {open && coords &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{
              position: "fixed",
              top: coords.top,
              left: coords.left,
              width: MENU_W,
              maxHeight: "calc(100vh - 16px)",
              overflowY: "auto",
            }}
            className="z-[70] overflow-hidden rounded-xl border border-line bg-white py-1 shadow-xl"
          >
            <Link href={`${base}/${id}`} className={item} onClick={() => setOpen(false)}>
              <Ic d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z M12 9a3 3 0 100 6 3 3 0 000-6z" /> View
            </Link>
            <Link href={`${base}/${id}/edit`} className={item} onClick={() => setOpen(false)}>
              <Ic d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" /> Edit
            </Link>
            {canPay && (
              <Link href={`${base}/${id}#record-payment`} className={item} onClick={() => setOpen(false)}>
                <Ic d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" /> Record payment
              </Link>
            )}
            <a href={`/d/${shareToken}`} target="_blank" rel="noreferrer" className={item} onClick={() => setOpen(false)}>
              <Ic d="M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1" /> Open share link
            </a>
            <div className="my-1 border-t border-line" />
            <form
              action={deleteInvoiceAction}
              onSubmit={(e) => {
                if (!confirm(`Delete this ${kind}? This can't be undone.`)) e.preventDefault();
                else setOpen(false);
              }}
            >
              <input type="hidden" name="id" value={id} />
              <button type="submit" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50">
                <Ic d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /> Delete
              </button>
            </form>
          </div>,
          document.body,
        )}
    </div>
  );
}

function Ic({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 flex-none">
      <path d={d} />
    </svg>
  );
}
