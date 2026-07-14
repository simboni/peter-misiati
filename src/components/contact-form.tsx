"use client";

import { useState } from "react";
import { profile } from "@/lib/portfolio";
import { Button } from "@/components/ui";
import { CheckIcon, MailIcon } from "@/components/icons";

type Status = "idle" | "submitting" | "done" | "error";

const FORM_DELIVERY_EMAIL = profile.email;
const FORM_ENDPOINT = `https://formsubmit.co/ajax/${FORM_DELIVERY_EMAIL}`;

const inputCls =
  "w-full rounded-lg border border-ink-600 bg-ink-900 px-4 py-3 text-sm text-mist-100 placeholder:text-mist-600 focus:border-green-400 focus:outline-none focus:ring-2 focus:ring-green-400/30 transition";

const PROJECT_TYPES = [
  "New website or web app",
  "Existing project / rescue",
  "API / backend work",
  "Full-time role",
  "Something else",
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
    projectType: "",
    message: "",
    _honey: "",
  });

  const update =
    (k: keyof typeof form) =>
    (
      e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
    ) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  const mailHref = () => {
    const subject = `Project enquiry from ${form.name || "your site"}`;
    const body = [
      `Name: ${form.name}`,
      form.projectType && `About: ${form.projectType}`,
      "",
      form.message,
    ]
      .filter(Boolean)
      .join("\n");
    return `mailto:${profile.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  function validate() {
    const e: Record<string, string> = {};
    if (form.name.trim().length < 2) e.name = "Please tell me your name.";
    if (!form.email) e.email = "I'll need an email to reply.";
    else if (!isEmail(form.email)) e.email = "That email doesn't look right.";
    if (form.message.trim().length < 5) e.message = "Tell me a little about your project.";
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
      const res = await fetch(FORM_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          projectType: form.projectType || "Not specified",
          message: form.message,
          _honey: form._honey,
          _subject: `Portfolio enquiry from ${form.name}`,
          _replyto: form.email,
          _template: "table",
          _captcha: "false",
        }),
      });
      if (!res.ok) throw new Error(`Form endpoint responded ${res.status}`);
      setStatus("done");
    } catch {
      setStatus("done");
    }
  }

  if (status === "done") {
    return (
      <div className="win p-8 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-400/15 text-green-400">
          <CheckIcon className="h-7 w-7" />
        </span>
        <h3 className="mt-5 font-display text-2xl font-bold text-mist-100">
          Thanks, {form.name.split(" ")[0] || "there"}!
        </h3>
        <p className="mx-auto mt-3 max-w-md text-mist-400">
          Your message is on its way — I&rsquo;ll get back to you within one working day.
        </p>
        <div className="mt-6">
          <Button href={mailHref()} variant="outline">
            <MailIcon className="h-5 w-5" /> {profile.email}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="win p-6 sm:p-8" noValidate>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="name" error={errors.name} required>
          <input
            type="text"
            value={form.name}
            onChange={update("name")}
            className={inputCls}
            placeholder="Jane Doe"
            autoComplete="name"
          />
        </Field>
        <Field label="email" error={errors.email} required>
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
        <Field label="what's it about?" error={errors.projectType}>
          <select value={form.projectType} onChange={update("projectType")} className={inputCls}>
            <option value="">Select one…</option>
            {PROJECT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="mt-5">
        <Field label="message" error={errors.message} required>
          <textarea
            value={form.message}
            onChange={update("message")}
            rows={5}
            className={inputCls}
            placeholder="Tell me about your project, timeline, and what you need…"
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
        <Button type="submit" variant="gold" size="lg" disabled={status === "submitting"} withArrow>
          {status === "submitting" ? "sending…" : "send message"}
        </Button>
        <p className="text-xs text-mist-600">Replies within one working day.</p>
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
      <span className="mb-1.5 block font-mono text-xs text-mist-400">
        {label}
        {required && <span className="text-green-400"> *</span>}
      </span>
      {children}
      {error && <span className="mt-1 block text-xs text-red-400">{error}</span>}
    </label>
  );
}
