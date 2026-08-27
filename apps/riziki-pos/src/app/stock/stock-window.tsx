"use client";

/**
 * The Stock window.
 *
 * Everything about stock in one place, which means two things and no more: what
 * is on the shelf, and counting it. A price is not a quantity and a recipe is a
 * piece of writing — those live beside this window in the menu, not inside it.
 *
 * The two panels swap here rather than being two addresses. Going from the
 * shelf to a stock take is not leaving one window for another; it is the same
 * work seen a second way, and it should not cost a page load. Both panels are
 * already in the browser, so the switch is instant and the counter can flick
 * between "what does the book say" and "what did I just count" while standing
 * at the shelf with a drum in one hand.
 *
 * The tabs are the only navigation in here, and they navigate nothing: there
 * was briefly a strip across the top whose every entry took you out of Stock
 * altogether, which is the menu's job and not a window's.
 */

import { useState } from "react";
import { PageTitle } from "@/components/ui";
import { StockClient } from "./stock-client";
import { StocktakeClient, type StocktakeState } from "@/app/stocktake/stocktake-client";
import type { StockView, StockLine } from "@/lib/stock-service";

type Panel = "shelf" | "count";

export function StockWindow({
  view,
  countLines,
  owner,
  initialQuery = "",
  stocktakeAction,
  initialPanel = "shelf",
}: {
  view: StockView;
  countLines: StockLine[];
  owner: boolean;
  initialQuery?: string;
  stocktakeAction: (state: StocktakeState, formData: FormData) => Promise<StocktakeState>;
  initialPanel?: Panel;
}) {
  const [panel, setPanel] = useState<Panel>(initialPanel);

  // A stock take reads raw-chemical quantities off the shelf, and those numbers
  // are how a recipe could be worked out by subtraction — so an attendant never
  // gets the tab, and the server never sends them the rows behind it.
  const canCount = owner;

  return (
    <div>
      <PageTitle
        title="Stock"
        subtitle={
          panel === "shelf"
            ? `${view.itemCount} items across the shop`
            : "Count the shelf, then post the difference"
        }
      />

      {canCount ? (
        <div
          role="tablist"
          aria-label="Stock"
          className="no-print mb-4 flex gap-1 rounded-2xl bg-wash p-1 ring-1 ring-inset ring-line"
        >
          {(
            [
              ["shelf", "On the shelf"],
              ["count", "Stock take"],
            ] as Array<[Panel, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={panel === key}
              onClick={() => setPanel(key)}
              className={`flex min-h-11 flex-1 items-center justify-center rounded-xl px-4 text-sm font-bold transition-colors xl:min-h-9 ${
                panel === key ? "bg-white text-brand-deep shadow-card" : "text-muted hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {/*
        Both panels stay mounted, hidden rather than unmounted.

        A stock take is forty numbers typed one at a time off a shelf. Unmounting
        it to glance at what the book says would throw every one of them away,
        and the person doing it would find that out at the end.
      */}
      <div hidden={panel !== "shelf"}>
        <StockClient view={view} owner={owner} initialQuery={initialQuery} />
      </div>

      {canCount ? (
        <div hidden={panel !== "count"}>
          <StocktakeClient lines={countLines} owner={owner} action={stocktakeAction} heading={false} />
        </div>
      ) : null}

    </div>
  );
}
