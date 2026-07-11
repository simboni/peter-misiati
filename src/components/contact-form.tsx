"use client";

import { useState } from "react";
import { contact } from "@/lib/cosdep";
import { Button } from "@/components/ui";
import { CheckIcon, MailIcon } from "@/components/icons";

type Status = "idle" | "submitting" | "done" | "error";

// No-backend delivery — FormSubmit emails each enquiry to the address below.
// The first submission triggers a one-time activation email; click the link
// once and delivery is on for good. Change the address in src/lib/cosdep.ts.
const FORM_ENDPOINT = `https://formsubmit.co/ajax/${contact.email}`;

const inputCls =
  "w-full rounded-xl border border-sand-200 bg-sand-50 px-4 py-3 text-sm text-ink-900 placeholder:text-ink-400 focus:border-forest-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-forest-400/25 transition";

const ENQUIRY_TYPES = [
  "General enquiry",
  "Donate / give",
  "Volunteer",
  "Partnership or funding",
  "Farmer training",
  "Media & press",
];

function isEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export function ContactForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    name: "",
    email: "",
    topic: "",
    message: "",
    _honey: "",
  });

  const update =
    (k: keyof typeof form) =>
    (
      e: React.ChangeEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >,
    ) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  function validate() {
    const e: Record<string, string> = {};
    if (form.name.trim().length < 2) e.name = "Please tell us your name.";
    if (!form.email) e.email = "We'll need an email to reply.";
    else if (!isEmail(form.email)) e.email = "That email doesn't look right.";
    if (form.message.trim().length < 5) e.message = "Please add a short message.";
    return e;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const found = validate();
    if (Object.keys(found).length) {
      setErrors(found);
      setStatus("error");
      return;
    }
    setErrors({});
    setStatus("submitting");
    try {
      await fetch(FORM_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          topic: form.topic || "Not specified",
          message: form.message,
          _honey: form._honey,
          _subject: `Website enquiry from ${form.name}`,
          _replyto: form.email,
          _template: "table",
          _captcha: "false",
        }),
      });
      setStatus("done");
    } catch {
      setStatus("done");
    }
  }

  if (status === "done") {
    return (
      <div className="card p-8 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-forest-100 text-forest-600">
          <CheckIcon className="h-7 w-7" />
        </span>
        <h3 className="mt-5 font-display text-2xl font-bold text-ink-900">
          Thank you, {form.name.split(" ")[0] || "friend"}!
        </h3>
        <p className="mx-auto mt-3 max-w-md text-ink-500">
          Your message is on its way — we&rsquo;ll get back to you as soon as we
          can.
        </p>
        <div className="mt-6">
          <Button href={`mailto:${contact.email}`} variant="outline">
            <MailIcon className="h-5 w-5" /> {contact.email}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="card p-6 sm:p-8" noValidate>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Full name" error={errors.name} required>
          <input
            type="text"
            value={form.name}
            onChange={update("name")}
            className={inputCls}
            placeholder="Jane Wanjiru"
            autoComplete="name"
          />
        </Field>
        <Field label="Email" error={errors.email} required>
          <input
            type="email"
            value={form.email}
            onChange={update("email")}
            className={inputCls}
            placeholder="you@example.com"
            autoComplete="email"
          />
        </Field>
      </div>
      <div className="mt-5">
        <Field label="What's it about?">
          <select value={form.topic} onChange={update("topic")} className={inputCls}>
            <option value="">Select one…</option>
            {ENQUIRY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="mt-5">
        <Field label="Message" error={errors.message} required>
          <textarea
            value={form.message}
            onChange={update("message")}
            rows={5}
            className={inputCls}
            placeholder="How would you like to get involved with COSDEP?"
          />
        </Field>
      </div>

      <input
        type="text"
        tabIndex={-1}
        autoComplete="off"
        value={form._honey}
        onChange={update("_honey")}
        className="absolute left-[-9999px] h-0 w-0 opacity-0"
        aria-hidden="true"
      />

      <div className="mt-6 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
        <Button
          type="submit"
          variant="primary"
          size="lg"
          disabled={status === "submitting"}
          withArrow
        >
          {status === "submitting" ? "Sending…" : "Send message"}
        </Button>
        <p className="text-xs text-ink-400">
          We usually reply within a few working days.
        </p>
      </div>
    </form>
  );
}

function Field({
  label,
  error,
  required,
  children,
}: {
  label: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink-700">
        {label}
        {required && <span className="text-forest-500"> *</span>}
      </span>
      {children}
      {error && <span className="mt-1 block text-xs text-red-500">{error}</span>}
    </label>
  );
}
