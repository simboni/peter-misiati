"use client";

import { useId, useMemo, useState } from "react";
import { BUSINESS, whatsappHref } from "@/lib/business";
import { WhatsAppIcon } from "@/components/ui";

/**
 * The enquiry form.
 *
 * There is no backend — this site is a static export — and there is no
 * third-party form service either, because a form that quietly emails a shared
 * inbox is not how this shop works. Orders arrive on WhatsApp, get answered on
 * WhatsApp, and stay in one thread the owner can scroll back through.
 *
 * So the form's only job is to compose a tidy message and hand it to WhatsApp.
 * The customer sees exactly what will be sent before it goes.
 */
export function EnquiryForm() {
  const [name, setName] = useState("");
  const [need, setNeed] = useState("");
  const [quantity, setQuantity] = useState("");
  const [notes, setNotes] = useState("");
  const [copied, setCopied] = useState(false);

  const fieldId = useId();

  const message = useMemo(() => {
    const lines = [`Hello ${BUSINESS.name},`, ""];
    lines.push(need.trim() ? `I would like: ${need.trim()}` : "I would like to make an enquiry.");
    if (quantity.trim()) lines.push(`Quantity / pack size: ${quantity.trim()}`);
    if (notes.trim()) lines.push(`Notes: ${notes.trim()}`);
    if (name.trim()) {
      lines.push("", `My name is ${name.trim()}.`);
    }
    return lines.join("\n");
  }, [name, need, quantity, notes]);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const href = whatsappHref(message);
    // Popup blockers can refuse the new tab; falling back keeps the enquiry alive.
    const opened = window.open(href, "_blank", "noopener,noreferrer");
    if (!opened) window.location.href = href;
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard access can be refused; the message is visible below either way.
      setCopied(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
      <h2 className="text-xl font-extrabold tracking-tight">Send an enquiry</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Fill this in and we will open WhatsApp with your message ready to send. Nothing is
        stored on this website and nothing is sent until you press send in WhatsApp.
      </p>

      <div className="mt-5 space-y-4">
        <div>
          <label htmlFor={`${fieldId}-name`} className="block text-sm font-bold">
            Your name <span className="font-semibold text-muted">(optional)</span>
          </label>
          <input
            id={`${fieldId}-name`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            className="mt-1.5 w-full rounded-xl border border-line bg-page px-4 py-3 text-base text-ink placeholder:text-muted"
            placeholder="e.g. Grace"
          />
        </div>

        <div>
          <label htmlFor={`${fieldId}-need`} className="block text-sm font-bold">
            What do you need?
          </label>
          <textarea
            id={`${fieldId}-need`}
            value={need}
            onChange={(event) => setNeed(event.target.value)}
            required
            rows={3}
            aria-describedby={`${fieldId}-need-help`}
            className="mt-1.5 w-full rounded-xl border border-line bg-page px-4 py-3 text-base text-ink placeholder:text-muted"
            placeholder="e.g. Caustic soda and SLES, or a mix kit for 20 litres of dishwashing liquid"
          />
          <p id={`${fieldId}-need-help`} className="mt-1.5 text-xs text-muted">
            List the chemicals, or just describe the product you want to make.
          </p>
        </div>

        <div>
          <label htmlFor={`${fieldId}-qty`} className="block text-sm font-bold">
            Quantity or pack size <span className="font-semibold text-muted">(optional)</span>
          </label>
          <input
            id={`${fieldId}-qty`}
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            className="mt-1.5 w-full rounded-xl border border-line bg-page px-4 py-3 text-base text-ink placeholder:text-muted"
            placeholder="e.g. 5 kg, or one 25 kg bag"
          />
        </div>

        <div>
          <label htmlFor={`${fieldId}-notes`} className="block text-sm font-bold">
            Anything else <span className="font-semibold text-muted">(optional)</span>
          </label>
          <input
            id={`${fieldId}-notes`}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            className="mt-1.5 w-full rounded-xl border border-line bg-page px-4 py-3 text-base text-ink placeholder:text-muted"
            placeholder="e.g. I am collecting today, or I need advice on the recipe"
          />
        </div>
      </div>

      {/* Nothing is sent behind the customer's back — show them the message. */}
      <div className="mt-5">
        <h3 className="text-xs font-bold uppercase tracking-[0.16em] text-muted">
          Your message
        </h3>
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-xl border border-line bg-page p-4 font-sans text-sm leading-relaxed text-ink">
          {message}
        </pre>
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="submit"
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-leaf-strong px-5 py-3 text-sm font-bold text-white hover:brightness-95"
        >
          <WhatsAppIcon />
          Open WhatsApp with this message
        </button>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-line bg-surface px-5 py-3 text-sm font-bold text-ink hover:bg-surface-2"
        >
          {copied ? "Copied" : "Copy message"}
        </button>
      </div>
      <p aria-live="polite" className="sr-only">
        {copied ? "Message copied to clipboard" : ""}
      </p>

      <p className="mt-4 text-xs leading-relaxed text-muted">
        Prefer to talk? Call {BUSINESS.phoneDisplay} — it is the same number.
      </p>
    </form>
  );
}
