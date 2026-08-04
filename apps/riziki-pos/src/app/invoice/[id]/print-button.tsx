"use client";

import { Button } from "@/components/ui";

/**
 * The counter device is a phone; reaching the browser's own print menu is four
 * taps. This is one — and it is the only reason this route needs any client JS.
 */
export function PrintButton() {
  return (
    <Button variant="ghost" className="flex-1" onClick={() => window.print()}>
      Print
    </Button>
  );
}
