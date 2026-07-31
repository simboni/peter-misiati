/**
 * Accessible FAQ accordion using native <details>/<summary> — no JS needed,
 * works in every browser, and reads correctly to screen readers.
 */
export function FaqList({
  faqs,
}: {
  faqs: { q: string; a: string }[];
}) {
  return (
    <div className="divide-y divide-paper-300 rounded-2xl border border-paper-300 bg-paper-50">
      {faqs.map((faq) => (
        <details key={faq.q} className="group px-5 py-1 open:bg-navy-50/40">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 font-display text-base font-bold text-navy-900 [&::-webkit-details-marker]:hidden">
            {faq.q}
            <span
              aria-hidden
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-paper-400 text-slate-500 transition group-open:rotate-45 group-open:border-navy-400 group-open:text-navy-600"
            >
              +
            </span>
          </summary>
          <p className="pb-5 pr-8 text-sm leading-relaxed text-slate-700">
            {faq.a}
          </p>
        </details>
      ))}
    </div>
  );
}
