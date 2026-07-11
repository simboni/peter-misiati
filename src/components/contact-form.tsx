"use client";

import { useState } from "react";
import { contact } from "@/lib/site";
import { Button } from "@/components/ui";
import { CheckIcon } from "@/components/icons";

const inputCls =
  "w-full rounded-xl border border-line-strong bg-cream-50 px-4 py-3 text-sm text-ink-900 placeholder:text-ink-400 focus:border-terra-400 focus:outline-none focus:ring-2 focus:ring-terra-400/30";

const subjects = [
  "General enquiry",
  "Volunteering",
  "Support a cause / donate",
  "Prayer request",
  "Retreats & spiritual direction",
] as const;

/**
 * Contact form posting to FormSubmit — emails each enquiry to the Province
 * inbox with no backend. The first submission triggers a one-time activation.
 */
export function ContactForm() {
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <div className="card flex flex-col items-center gap-4 px-8 py-14 text-center">
        <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-sage-500/12 text-sage-600">
          <CheckIcon className="h-7 w-7" />
        </span>
        <h3 className="font-display text-2xl font-semibold text-ink-900">Message received</h3>
        <p className="max-w-sm text-ink-600">
          Thank you for reaching out. A Sister will reply to you as soon as possible. May God
          bless you.
        </p>
      </div>
    );
  }

  return (
    <form
      action={`https://formsubmit.co/${contact.email}`}
      method="POST"
      onSubmit={() => setSent(true)}
      className="card grid gap-5 p-6 sm:p-8"
    >
      <input type="hidden" name="_subject" value="New enquiry from the website" />
      <input type="hidden" name="_template" value="table" />
      <input type="text" name="_honey" className="hidden" tabIndex={-1} autoComplete="off" />

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Full name" htmlFor="name">
          <input id="name" name="name" required placeholder="Jane Doe" className={inputCls} />
        </Field>
        <Field label="Email" htmlFor="email">
          <input
            id="email"
            type="email"
            name="email"
            required
            placeholder="you@example.com"
            className={inputCls}
          />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Phone (optional)" htmlFor="phone">
          <input id="phone" name="phone" placeholder="+254 …" className={inputCls} />
        </Field>
        <Field label="I'm writing about" htmlFor="subject">
          <select id="subject" name="subject" defaultValue="" required className={inputCls}>
            <option value="" disabled>
              Choose a topic
            </option>
            {subjects.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Message" htmlFor="message">
        <textarea
          id="message"
          name="message"
          required
          rows={5}
          placeholder="How can we help?"
          className={`${inputCls} resize-y`}
        />
      </Field>

      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-ink-500">
          Your details are only used to reply to your message.
        </p>
        <Button type="submit" variant="primary" size="lg" withArrow>
          Send message
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink-800">{label}</span>
      {children}
    </label>
  );
}
