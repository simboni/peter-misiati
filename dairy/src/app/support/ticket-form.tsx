"use client";

import { useActionState, useEffect, useState } from "react";
import { raiseTicketAction } from "./actions";
import { Button, Field, Receipt } from "@/components/ui";
import { count } from "@/lib/outbox";

/**
 * The bug report is one field.
 *
 * Everything else a support engineer needs — which screen, how many writes are
 * waiting, whether the phone was online — is captured silently, because a user
 * on a 2G link in a milking shed cannot be expected to describe their own sync
 * state, and asking them to is how you get empty tickets.
 */
export function TicketForm({ language }: { language: "en" | "sw" }) {
  const sw = language === "sw";
  const [state, formAction, pending] = useActionState(raiseTicketAction, null);
  const [context, setContext] = useState({ screen: "", syncState: "" });

  useEffect(() => {
    void (async () => {
      let waiting = 0;
      try {
        waiting = await count();
      } catch {
        // No IndexedDB (private mode, old WebView). Not worth failing over.
      }
      setContext({
        screen: window.location.pathname,
        syncState: JSON.stringify({
          waiting,
          online: navigator.onLine,
          at: new Date().toISOString(),
        }),
      });
    })();
  }, []);

  if (state?.ok) {
    return (
      <Receipt
        title={sw ? "Tumepokea ujumbe wako" : "We have your message"}
        lines={[
          sw
            ? "Tutakujibu kwenye WhatsApp au simu."
            : "We will come back to you on WhatsApp or by phone.",
        ]}
      />
    );
  }

  return (
    <form action={formAction} className="grid gap-3">
      <input type="hidden" name="screen" value={context.screen} />
      <input type="hidden" name="syncState" value={context.syncState} />

      <Field
        label={sw ? "Nini kilitokea?" : "What happened?"}
        hint={
          sw
            ? "Andika kwa maneno yako. Tutajua ulikuwa kwenye skrini gani."
            : "In your own words. We can already see which screen you were on."
        }
        error={state && !state.ok ? state.error : undefined}
      >
        <textarea
          name="message"
          rows={4}
          required
          className="w-full rounded-md border border-line bg-surface px-3 py-2 text-base"
        />
      </Field>

      <Button type="submit" disabled={pending}>
        {pending ? (sw ? "Inatuma…" : "Sending…") : sw ? "Tuma" : "Send"}
      </Button>
    </form>
  );
}
