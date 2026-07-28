"use client";

import { useState } from "react";
import { site } from "@/lib/keysa";
import { ArrowRightIcon } from "@/components/icons";

const topics = [
  "General enquiry",
  "I want to donate",
  "Partnership / sponsorship",
  "Volunteering / mentoring",
  "Media / press",
] as const;

/**
 * Static-host friendly contact form: composes a structured email in the
 * visitor's own mail client via mailto:. No backend required.
 */
export function ContactForm() {
  const [name, setName] = useState("");
  const [topic, setTopic] = useState<string>(topics[0]);
  const [message, setMessage] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const subject = encodeURIComponent(`[${topic}] Message from ${name || "the KEYSA website"}`);
    const body = encodeURIComponent(`${message}\n\n— ${name}`);
    window.location.href = `mailto:${site.email}?subject=${subject}&body=${body}`;
  }

  const inputCls =
    "w-full rounded-xl border border-ink-600 bg-ink-900 px-4 py-3 text-sm text-mist-100 placeholder:text-mist-600 outline-none transition-colors focus:border-green-400";

  return (
    <form onSubmit={handleSubmit} className="win p-6 sm:p-8">
      <div className="grid gap-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-mist-200">Your name</span>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Wanjiru"
              className={inputCls}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-mist-200">Topic</span>
            <select
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              className={inputCls}
            >
              {topics.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-mist-200">Message</span>
          <textarea
            required
            rows={6}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Tell us how we can help — or how you'd like to help."
            className={inputCls}
          />
        </label>
        <button
          type="submit"
          className="inline-flex items-center justify-center gap-2 rounded-full bg-green-400 px-6 py-3 text-sm font-semibold text-on-accent transition-colors hover:bg-green-500"
        >
          Compose email
          <ArrowRightIcon className="h-4 w-4" />
        </button>
        <p className="text-xs leading-relaxed text-mist-500">
          This opens your email app with the message pre-filled, addressed to{" "}
          <span className="text-mist-400">{site.email}</span> — so you always keep a copy
          in your own outbox.
        </p>
      </div>
    </form>
  );
}
