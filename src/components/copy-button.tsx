"use client";

import { useState } from "react";

/** Copies a short string (e.g. an email address) with inline feedback. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable — the value is visible on the page anyway */
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-1.5 rounded-full border border-ink-500 px-3 py-1 text-xs font-medium text-mist-400 transition-colors hover:border-green-400 hover:text-mist-100"
      aria-label={`Copy ${label}`}
    >
      {copied ? "Copied ✓" : "Copy"}
    </button>
  );
}
