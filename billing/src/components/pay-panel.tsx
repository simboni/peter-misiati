"use client";

import { useState } from "react";
import { startInvoicePaymentAction } from "@/server/actions/pay";
import { formatMoney } from "@/server/money";

type Phase = "form" | "prompt" | "success" | "failed";

export function PayPanel({
  token,
  balanceDue,
  currency,
  clientPhone,
}: {
  token: string;
  balanceDue: number;
  currency: string;
  clientPhone?: string | null;
}) {
  const maxKes = Math.floor(balanceDue / 100);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("form");
  const [amount, setAmount] = useState(String(maxKes));
  const [phone, setPhone] = useState(clientPhone ?? "");
  const [error, setError] = useState<string | null>(null);
  const [receiptToken, setReceiptToken] = useState<string | null>(null);

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function poll(intentId: string) {
    for (let i = 0; i < 40; i++) {
      await sleep(3000);
      try {
        const res = await fetch(`/api/payments/status?intent=${intentId}`, { cache: "no-store" });
        const j = (await res.json()) as { status: string; receiptToken?: string; error?: string };
        if (j.status === "success") {
          setReceiptToken(j.receiptToken ?? null);
          setPhase("success");
          return;
        }
        if (j.status === "failed") {
          setError(j.error ?? "The payment wasn't completed.");
          setPhase("failed");
          return;
        }
      } catch {
        /* keep polling */
      }
    }
    setError("We didn't get a confirmation in time. If you were charged, it'll reflect shortly.");
    setPhase("failed");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const fd = new FormData();
    fd.set("token", token);
    fd.set("amount", amount);
    fd.set("phone", phone);
    setPhase("prompt");
    const res = await startInvoicePaymentAction({}, fd);
    if (res.error || !res.intentId) {
      setError(res.error ?? "Couldn't start the payment.");
      setPhase("failed");
      return;
    }
    poll(res.intentId);
  }

  if (!open) {
    return (
      <button className="btn-primary w-full" onClick={() => setOpen(true)}>
        Pay with M-Pesa
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-brand-200 bg-surface p-4 text-left">
      {phase === "form" && (
        <form onSubmit={submit} className="space-y-3">
          <p className="text-sm font-semibold text-ink">Pay by M-Pesa</p>
          <div>
            <label className="label" htmlFor="pp-amount">
              Amount ({currency})
            </label>
            <input
              id="pp-amount"
              className="input"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <p className="mt-1 text-xs text-muted">
              Balance {formatMoney(balanceDue, currency)} — pay in full or part.
            </p>
          </div>
          <div>
            <label className="label" htmlFor="pp-phone">
              M-Pesa phone number
            </label>
            <input
              id="pp-phone"
              className="input"
              inputMode="tel"
              placeholder="07XX XXX XXX"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <button type="submit" className="btn-primary w-full">
            Send M-Pesa prompt
          </button>
          <button type="button" className="btn-ghost btn-sm w-full" onClick={() => setOpen(false)}>
            Cancel
          </button>
        </form>
      )}

      {phase === "prompt" && (
        <div className="space-y-2 py-2 text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
          <p className="text-sm font-semibold text-ink">Check your phone</p>
          <p className="text-sm text-muted">
            Enter your M-Pesa PIN to approve the payment. This can take a few seconds…
          </p>
        </div>
      )}

      {phase === "success" && (
        <div className="space-y-3 py-2 text-center">
          <div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-brand-100 text-xl text-brand-700">
            ✓
          </div>
          <p className="text-sm font-semibold text-ink">Payment received. Thank you!</p>
          {receiptToken && (
            <a href={`/d/${receiptToken}`} className="btn-ghost btn-sm">
              View receipt
            </a>
          )}
          <button className="btn-primary btn-sm w-full" onClick={() => location.reload()}>
            Refresh invoice
          </button>
        </div>
      )}

      {phase === "failed" && (
        <div className="space-y-3 py-2 text-center">
          <p className="text-sm font-semibold text-red-700">Payment not completed</p>
          <p className="text-sm text-muted">{error}</p>
          <button
            className="btn-primary btn-sm w-full"
            onClick={() => {
              setError(null);
              setPhase("form");
            }}
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
