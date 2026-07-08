"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * A slim top progress bar that flashes on every route change, giving the whole
 * app a consistent "something is loading" signal. It keys off the URL so a new
 * bar animates each time the pathname or query changes.
 */
export function RouteProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [key, setKey] = useState(0);
  const [show, setShow] = useState(false);

  useEffect(() => {
    setKey((k) => k + 1);
    setShow(true);
    const t = setTimeout(() => setShow(false), 1400);
    return () => clearTimeout(t);
  }, [pathname, searchParams]);

  if (!show) return null;
  return <div key={key} className="route-progress no-print" aria-hidden />;
}
