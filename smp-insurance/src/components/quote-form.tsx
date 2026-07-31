"use client";

import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { ProductIcon, WhatsAppIcon, CheckIcon, PhoneIcon } from "@/components/icons";
import { products, getProduct } from "@/lib/products";
import { site, waLink } from "@/lib/site";

/**
 * Three-step quote request (multi-step forms convert ~3x better than long
 * single forms). The site is statically hosted, so on submit we compose a
 * structured request and hand it to the channel Kenyans actually use:
 * WhatsApp first, with email and phone as fallbacks. Every field asked here
 * is one the agent genuinely needs to produce a quote.
 */

type Field =
  | { kind: "select"; id: string; label: string; options: string[] }
  | { kind: "text"; id: string; label: string; placeholder?: string; inputMode?: "numeric" | "text" }
  | { kind: "textarea"; id: string; label: string; placeholder?: string };

const detailFields: Record<string, Field[]> = {
  motor: [
    { kind: "text", id: "vehicle", label: "Vehicle make & model", placeholder: "e.g. Toyota Axio 2017" },
    { kind: "text", id: "value", label: "Estimated value (KES)", placeholder: "e.g. 1,200,000", inputMode: "numeric" },
    { kind: "select", id: "use", label: "Vehicle use", options: ["Private", "Commercial (own goods)", "PSV (matatu / taxi)", "Boda boda / tuk tuk"] },
    { kind: "select", id: "cover", label: "Cover level", options: ["Comprehensive", "Third Party, Fire & Theft", "Third Party Only", "Not sure — advise me"] },
  ],
  medical: [
    { kind: "select", id: "type", label: "Who is the cover for?", options: ["Myself", "My family", "My company / staff"] },
    { kind: "text", id: "people", label: "Number of people & ages", placeholder: "e.g. 2 adults (34, 31), 2 kids (6, 3)" },
    { kind: "select", id: "inpatient", label: "Inpatient limit you have in mind", options: ["KES 500,000", "KES 1M", "KES 2M", "KES 3M+", "Not sure — advise me"] },
    { kind: "select", id: "outpatient", label: "Outpatient cover?", options: ["Yes", "No", "Not sure"] },
  ],
  life: [
    { kind: "select", id: "goal", label: "Main goal", options: ["Protect my family's income", "Education plan for my children", "Savings with cover", "Mortgage / loan protection"] },
    { kind: "text", id: "age", label: "Your age", placeholder: "e.g. 35", inputMode: "numeric" },
    { kind: "text", id: "budget", label: "Monthly budget (KES)", placeholder: "e.g. 5,000", inputMode: "numeric" },
  ],
  "personal-accident": [
    { kind: "text", id: "occupation", label: "Occupation", placeholder: "e.g. Electrician" },
    { kind: "select", id: "type", label: "Individual or group?", options: ["Individual", "Family", "Group / team"] },
  ],
  wiba: [
    { kind: "text", id: "business", label: "Nature of business", placeholder: "e.g. Restaurant, construction, school" },
    { kind: "text", id: "staff", label: "Number of employees", placeholder: "e.g. 12", inputMode: "numeric" },
  ],
  business: [
    { kind: "text", id: "business", label: "Nature of business", placeholder: "e.g. Hardware shop, clinic, workshop" },
    { kind: "textarea", id: "covers", label: "What would you like covered?", placeholder: "e.g. Stock & premises against fire and burglary, staff WIBA, cash in transit" },
  ],
  home: [
    { kind: "select", id: "type", label: "Do you own or rent?", options: ["Own", "Rent"] },
    { kind: "text", id: "value", label: "Rough value of contents (KES)", placeholder: "e.g. 800,000", inputMode: "numeric" },
  ],
  travel: [
    { kind: "text", id: "destination", label: "Destination(s)", placeholder: "e.g. Germany (Schengen visa)" },
    { kind: "text", id: "dates", label: "Travel dates", placeholder: "e.g. 10–24 Sept" },
    { kind: "text", id: "travellers", label: "Number of travellers", placeholder: "e.g. 2", inputMode: "numeric" },
  ],
  agriculture: [
    { kind: "select", id: "type", label: "What are you insuring?", options: ["Crops", "Livestock", "Greenhouse", "Mixed farm"] },
    { kind: "text", id: "details", label: "Brief details", placeholder: "e.g. 5 acres maize, Uasin Gishu / 8 dairy cows, Nyeri" },
  ],
  pensions: [
    { kind: "select", id: "type", label: "For yourself or your staff?", options: ["Individual pension plan", "Umbrella scheme for my staff"] },
    { kind: "text", id: "amount", label: "Monthly contribution in mind (KES)", placeholder: "e.g. 10,000", inputMode: "numeric" },
  ],
};

const inputCls =
  "w-full rounded-xl border border-paper-400 bg-paper-50 px-4 py-3 text-base text-slate-900 placeholder:text-slate-400 focus:border-navy-500 focus:outline-none";

const labelCls = "mb-1.5 block text-sm font-bold text-navy-900";

export function QuoteForm() {
  const searchParams = useSearchParams();
  const preselected = searchParams?.get("product") ?? "";
  const validPreselect = getProduct(preselected)?.slug ?? "";

  const [step, setStep] = useState(validPreselect ? 2 : 1);
  const [product, setProduct] = useState(validPreselect);
  const [details, setDetails] = useState<Record<string, string>>({});
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [channel, setChannel] = useState("WhatsApp");
  const [error, setError] = useState("");

  const selected = getProduct(product);
  const fields = useMemo(() => detailFields[product] ?? [], [product]);

  const message = useMemo(() => {
    if (!selected) return "";
    const lines = [
      `Hello SMP Insurance, I'd like a quote.`,
      ``,
      `*Product:* ${selected.name}`,
      ...fields
        .filter((f) => details[f.id])
        .map((f) => `*${f.label}:* ${details[f.id]}`),
      ``,
      `*Name:* ${name}`,
      `*Phone:* ${phone}`,
      `*Preferred contact:* ${channel}`,
    ];
    return lines.join("\n");
  }, [selected, fields, details, name, phone, channel]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || phone.trim().length < 9) {
      setError("Please add your name and a valid phone number so we can send your quote.");
      return;
    }
    setError("");
    setStep(4);
  };

  return (
    <div className="mx-auto max-w-2xl">
      {/* Progress */}
      {step < 4 ? (
        <div className="mb-8">
          <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-500">
            <span className={step >= 1 ? "text-navy-700" : ""}>1 · Product</span>
            <span className={step >= 2 ? "text-navy-700" : ""}>2 · Details</span>
            <span className={step >= 3 ? "text-navy-700" : ""}>3 · Contact</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-paper-300">
            <div
              className="h-full rounded-full bg-cta-500 transition-all duration-300"
              style={{ width: `${(step / 3) * 100}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Takes about 2 minutes · {site.quotePromise.toLowerCase()}
          </p>
        </div>
      ) : null}

      {/* Step 1 — product picker */}
      {step === 1 ? (
        <fieldset>
          <legend className="font-display text-xl font-bold text-slate-900">
            What would you like to insure?
          </legend>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {products.map((p) => (
              <button
                key={p.slug}
                type="button"
                onClick={() => {
                  setProduct(p.slug);
                  setDetails({});
                  setStep(2);
                }}
                className={`flex min-h-[104px] flex-col items-center justify-center gap-2 rounded-2xl border p-4 text-center transition ${
                  product === p.slug
                    ? "border-navy-500 bg-navy-50"
                    : "border-paper-300 bg-paper-50 hover:border-navy-400 hover:bg-navy-50/50"
                }`}
              >
                <ProductIcon name={p.icon} className="h-7 w-7 text-navy-600" />
                <span className="text-sm font-bold leading-tight text-navy-900">
                  {p.navLabel}
                </span>
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}

      {/* Step 2 — product details */}
      {step === 2 && selected ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setStep(3);
          }}
        >
          <div className="flex items-center gap-3">
            <ProductIcon name={selected.icon} className="h-8 w-8 text-navy-600" />
            <h2 className="font-display text-xl font-bold text-slate-900">
              {selected.name}
            </h2>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            A few details so we can quote accurately. Not sure about something?
            Leave it blank — we&apos;ll sort it out together.
          </p>
          <div className="mt-6 space-y-5">
            {fields.map((f) => (
              <div key={f.id}>
                <label htmlFor={`f-${f.id}`} className={labelCls}>
                  {f.label}
                </label>
                {f.kind === "select" ? (
                  <select
                    id={`f-${f.id}`}
                    className={inputCls}
                    value={details[f.id] ?? ""}
                    onChange={(e) =>
                      setDetails((d) => ({ ...d, [f.id]: e.target.value }))
                    }
                  >
                    <option value="">Select…</option>
                    {f.options.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : f.kind === "textarea" ? (
                  <textarea
                    id={`f-${f.id}`}
                    rows={3}
                    className={inputCls}
                    placeholder={f.placeholder}
                    value={details[f.id] ?? ""}
                    onChange={(e) =>
                      setDetails((d) => ({ ...d, [f.id]: e.target.value }))
                    }
                  />
                ) : (
                  <input
                    id={`f-${f.id}`}
                    type="text"
                    inputMode={f.inputMode}
                    className={inputCls}
                    placeholder={f.placeholder}
                    value={details[f.id] ?? ""}
                    onChange={(e) =>
                      setDetails((d) => ({ ...d, [f.id]: e.target.value }))
                    }
                  />
                )}
              </div>
            ))}
          </div>
          <div className="mt-8 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="rounded-xl px-4 py-3 text-sm font-bold text-slate-500 transition hover:text-navy-900"
            >
              ← Change product
            </button>
            <button
              type="submit"
              className="inline-flex items-center rounded-xl bg-navy-900 px-6 py-3.5 font-display text-base font-bold text-white transition hover:bg-navy-800"
            >
              Continue →
            </button>
          </div>
        </form>
      ) : null}

      {/* Step 3 — contact */}
      {step === 3 && selected ? (
        <form onSubmit={submit}>
          <h2 className="font-display text-xl font-bold text-slate-900">
            Where do we send your quote?
          </h2>
          <div className="mt-6 space-y-5">
            <div>
              <label htmlFor="q-name" className={labelCls}>
                Your name
              </label>
              <input
                id="q-name"
                type="text"
                autoComplete="name"
                required
                className={inputCls}
                placeholder="e.g. Wanjiku Kamau"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="q-phone" className={labelCls}>
                Phone number
              </label>
              <input
                id="q-phone"
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                required
                className={inputCls}
                placeholder="e.g. 0712 345 678"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <div>
              <span className={labelCls}>How should we contact you?</span>
              <div className="flex flex-wrap gap-2">
                {["WhatsApp", "Phone call", "SMS"].map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setChannel(c)}
                    className={`rounded-xl border px-5 py-2.5 text-sm font-bold transition ${
                      channel === c
                        ? "border-navy-500 bg-navy-50 text-navy-900"
                        : "border-paper-400 bg-paper-50 text-slate-500 hover:border-navy-400"
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {error ? (
            <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-bad-500">
              {error}
            </p>
          ) : null}
          <div className="mt-8 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="rounded-xl px-4 py-3 text-sm font-bold text-slate-500 transition hover:text-navy-900"
            >
              ← Back
            </button>
            <button
              type="submit"
              className="inline-flex items-center rounded-xl bg-cta-500 px-6 py-3.5 font-display text-base font-bold text-navy-950 shadow-lg shadow-cta-500/25 transition hover:bg-cta-400"
            >
              Get my quote
            </button>
          </div>
        </form>
      ) : null}

      {/* Step 4 — send it */}
      {step === 4 && selected ? (
        <div className="text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-good-500/10 text-good-600">
            <CheckIcon className="h-7 w-7" />
          </span>
          <h2 className="mt-4 font-display text-2xl font-bold text-slate-900">
            {name.split(" ")[0]}, your request is ready
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-500">
            Send it with one tap and our team will come back with quotes —{" "}
            {site.quotePromise.toLowerCase()}, {site.hours.split("·")[0].trim()}.
          </p>
          <div className="mx-auto mt-6 max-w-md rounded-2xl border border-paper-300 bg-paper-200 p-4 text-left text-sm text-slate-700">
            <pre className="whitespace-pre-wrap font-sans">{message.replaceAll("*", "")}</pre>
          </div>
          <div className="mx-auto mt-6 flex max-w-md flex-col gap-3">
            <a
              href={waLink(message)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#25D366] px-6 py-4 font-display text-base font-bold text-[#073b1c] shadow-lg shadow-[#25D366]/25 transition hover:brightness-105"
            >
              <WhatsAppIcon className="h-5 w-5" /> Send via WhatsApp
            </a>
            <a
              href={`mailto:${site.email}?subject=${encodeURIComponent(
                `Quote request — ${selected.name}`,
              )}&body=${encodeURIComponent(message.replaceAll("*", ""))}`}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-paper-400 bg-paper-50 px-6 py-3.5 font-display text-sm font-bold text-navy-900 transition hover:border-navy-400"
            >
              Send by email instead
            </a>
            <a
              href={`tel:${site.phoneHref}`}
              className="inline-flex items-center justify-center gap-2 text-sm font-bold text-navy-600 hover:text-navy-500"
            >
              <PhoneIcon className="h-4 w-4" /> Prefer to talk? Call {site.phone}
            </a>
          </div>
          <button
            type="button"
            onClick={() => {
              setStep(1);
              setProduct("");
              setDetails({});
            }}
            className="mt-8 text-xs font-semibold text-slate-400 hover:text-slate-500"
          >
            Start another request
          </button>
        </div>
      ) : null}
    </div>
  );
}
