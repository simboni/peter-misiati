"use client";

import { Button } from "@/components/ui";

/**
 * The counter device is a phone; reaching the browser's own print menu is four
 * taps. This is one — and it is the only reason this route needs any client JS.
 *
 * THE LABEL IS NOT DECORATION. On a screen that also offers the counter
 * printer, a button saying only "Print" is the one a thumb finds first, and it
 * opens the browser's A5 dialog over the top of the thermal button so the
 * thermal button is never seen at all. That is exactly how a delivery note came
 * out of the wrong machine. Where both exist, this one says which paper it is.
 */
export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <Button variant="ghost" className="flex-1" onClick={() => window.print()}>
      {label}
    </Button>
  );
}
