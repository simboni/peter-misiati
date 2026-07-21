"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Renders a support email address in a scraper-resistant way. The server-rendered
 * HTML never contains "user@domain" or a `mailto:` link — only a munged
 * "user (at) domain" string built from separate parts — so naive email
 * harvesters find nothing. After hydration it becomes a normal clickable
 * mailto link for humans. Fully accessible: the address is always readable.
 */
export function ObfuscatedEmail({
  user,
  domain,
  subject,
  className,
}: {
  user: string;
  domain: string;
  subject?: string;
  className?: string;
}) {
  const [ready, setReady] = useState(false);
  const ref = useRef<HTMLAnchorElement | HTMLSpanElement>(null);

  useEffect(() => setReady(true), []);

  if (!ready) {
    // Pre-hydration / no-JS: human-readable but not a live mailto and not the
    // literal address (bots that grep for "@" or "mailto:" get nothing useful).
    return (
      <span className={className}>
        {user}&nbsp;(at)&nbsp;{domain}
      </span>
    );
  }

  const address = `${user}@${domain}`;
  const href = `mailto:${address}${subject ? `?subject=${encodeURIComponent(subject)}` : ""}`;
  return (
    <a ref={ref as React.Ref<HTMLAnchorElement>} className={className} href={href}>
      {address}
    </a>
  );
}
