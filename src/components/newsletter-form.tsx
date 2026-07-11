"use client";

import { useState } from "react";
import { contact } from "@/lib/site";
import { ArrowRightIcon, CheckIcon } from "@/components/icons";

/**
 * No-backend newsletter capture via FormSubmit — emails each subscriber to the
 * Province inbox. The first submission triggers a one-time activation email.
 */
export function NewsletterForm() {
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <div className="flex items-center gap-3 rounded-full border border-gold-400/40 bg-terra-900/40 px-5 py-3.5 text-sm text-cream-100">
        <CheckIcon className="h-5 w-5 text-gold-300" />
        Thank you for subscribing — we&rsquo;ll be in touch.
      </div>
    );
  }

  return (
    <form
      action={`https://formsubmit.co/${contact.email}`}
      method="POST"
      onSubmit={() => setDone(true)}
      className="flex w-full flex-col gap-3 sm:flex-row"
    >
      <input type="hidden" name="_subject" value="New newsletter subscriber" />
      <input type="text" name="_honey" className="hidden" tabIndex={-1} autoComplete="off" />
      <input type="hidden" name="_template" value="table" />
      <label className="sr-only" htmlFor="newsletter-email">
        Email address
      </label>
      <input
        id="newsletter-email"
        type="email"
        name="email"
        required
        placeholder="Your email address"
        className="min-w-0 flex-1 rounded-full border border-terra-700 bg-terra-900/50 px-5 py-3.5 text-sm text-cream-50 placeholder:text-cream-200/50 focus:border-gold-400 focus:outline-none focus:ring-2 focus:ring-gold-400/40"
      />
      <button
        type="submit"
        className="group/btn inline-flex items-center justify-center gap-2 rounded-full bg-gold-400 px-6 py-3.5 text-sm font-semibold text-terra-900 transition-colors hover:bg-gold-300"
      >
        Subscribe
        <ArrowRightIcon className="h-4 w-4 transition-transform group-hover/btn:translate-x-0.5" />
      </button>
    </form>
  );
}
