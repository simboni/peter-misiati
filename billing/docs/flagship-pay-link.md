# Flagship: the invoice that pays itself (Pay-Link workflow)

> Status: **planned** — do NOT build until online payments resume.
> Gate: `MPESA_PAYMENTS_ENABLED` in `src/lib/flags.ts` (currently `false`).
> Reference mockup: the marketing hero card — a compact invoice summary with a
> full-width **“Pay with M‑Pesa”** button and a **“Paid ✓”** state, “Powered by
> TallyPay” beneath. That look is the north star for the client’s pay view.

## The one-line vision
A vendor **shares a link**. The client opens it, **sees the invoice**, and
**pays by M‑Pesa in one tap** — no app, no login, no back-and-forth. The receipt
is generated automatically. This is the product’s hero moment.

## Client experience (what the shared link opens — `/d/[token]`)
Match the mockup’s clarity:
1. **Header** — vendor logo + business name + KRA PIN · `INVOICE` + number ·
   status pill (`Paid ✓` in brand green once settled).
2. **Line items** with amounts, then **VAT (16%)**, then a bold **Total** in the
   accent colour (exactly like the mockup).
3. **Primary action = “Pay with M‑Pesa”** — full-width brand-green button.
   - Tapping it opens the phone-number entry → triggers the STK push → shows a
     “Check your phone…” progress state → on success flips to **Paid ✓** and
     offers the receipt.
   - Show it whenever `type === invoice && status !== void && balanceDue > 0`.
4. **States**
   - *Due:* button reads “Pay KES {balanceDue} with M‑Pesa”.
   - *Partly paid:* show “Balance due: KES …”, button pays the balance; allow a
     custom/part amount (existing PayPanel already supports this).
   - *Paid:* hide the button, show the `Paid ✓` pill and a “Download receipt”
     link.
5. Keep the **full A4 document** below the summary for trust — the mockup card is
   the “above the fold” summary; a **sticky bottom Pay bar** keeps the CTA in
   view as they scroll the details. (Full details + one obvious CTA = converts.)

## Sharing — consolidate, and kill one option
Today the share bar has: **Share PDF · Print/Save as PDF · Copy link ·
WhatsApp · Email**. That’s too many verbs for a client-facing bar. Reorganise
around two intents:

- **“Share pay link”** (primary, brand) → sends the pay link. Kenya-first, so
  **WhatsApp** is the default; on mobile use the native share sheet so it also
  covers SMS/Telegram/copy. This is the flagship action.
- **“Share PDF”** (secondary) → the document as a file (already built).

**Kill: the standalone “Copy link” button.** It’s the weakest verb and is fully
covered by the native share sheet / WhatsApp. (Alternative if we’d rather keep
Copy: kill standalone **Email** instead — WhatsApp dominates in Kenya. Decide at
build time; recommendation is to drop Copy link.)

Net client-facing bar when payments are on: **Share pay link · Share PDF**
(+ Print/Save as PDF stays for the vendor’s own use).

## Build checklist (when we resume)
- [ ] Flip `MPESA_PAYMENTS_ENABLED = true` once Kopo Kopo is verified live
      (Settings → Payments → **Test connection** must pass).
- [ ] Restyle the `/d/[token]` invoice branch to lead with the mockup-style
      summary + a **sticky “Pay with M‑Pesa” bar** (reuse `PayPanel`,
      `startInvoicePaymentAction`, `/api/payments/status`, the webhook).
- [ ] Replace the current share bar with **Share pay link** (native share /
      WhatsApp) + **Share PDF**; remove the standalone **Copy link** button.
- [ ] Add the `Paid ✓` and partial-balance states to the pay view.
- [ ] Confirm the auto-generated receipt is one tap away after payment.

## Pieces that already exist (reuse, don’t rebuild)
- `src/components/pay-panel.tsx` — phone entry + STK push + status polling.
- `src/server/actions/pay.ts` — `startInvoicePaymentAction` (public, token-scoped).
- `src/server/kopokopo.ts`, `src/server/payments-config.ts` — STK push + per-vendor config.
- `src/app/api/mpesa/kopokopo/route.ts` — webhook (HMAC-verified) → `settleIntent`.
- `src/app/api/payments/status/route.ts` — poll fallback.
- `src/app/d/[token]/page.tsx` — the public document page (where the pay view lives).
