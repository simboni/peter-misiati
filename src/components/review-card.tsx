import type { Testimonial } from "@/lib/portfolio";
import { SpotlightCard } from "@/components/spotlight-card";
import { QuoteIcon, StarIcon, ExternalLinkIcon } from "@/components/icons";

/** Initials for the avatar tile, e.g. "Why clients choose SMP" -> "WC". */
function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

/** A single client review, rendered as a card that links to its source when provided. */
export function ReviewCard({ review }: { review: Testimonial }) {
  const rating = review.rating ?? 5;
  const linked = Boolean(review.link);

  return (
    <SpotlightCard
      className={`group relative flex h-full flex-col rounded-xl border border-ink-600 bg-ink-800 p-6 transition-all duration-300 hover:-translate-y-1 hover:border-green-400/50 hover:shadow-[0_20px_50px_-30px_rgba(0,0,0,0.8)] sm:p-7 ${
        linked ? "cursor-pointer" : ""
      }`}
    >
      <div className="flex items-center justify-between">
        <QuoteIcon className="h-7 w-7 text-green-400/70" />
        <div className="flex gap-0.5" aria-label={`${rating} out of 5 stars`}>
          {Array.from({ length: 5 }).map((_, i) => (
            <StarIcon
              key={i}
              className={`h-4 w-4 ${i < rating ? "text-green-400" : "text-ink-500"}`}
            />
          ))}
        </div>
      </div>

      <blockquote className="mt-4 flex-1 text-base leading-relaxed text-mist-200">
        {review.quote}
      </blockquote>

      <div className="mt-6 flex items-center gap-3 border-t border-ink-600 pt-5">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-green-400/30 bg-ink-700 font-mono text-sm font-semibold text-green-400">
          {initials(review.author)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-display font-semibold text-mist-100">
            {review.author}
          </div>
          <div className="truncate font-mono text-xs text-mist-500">
            {review.title}
          </div>
        </div>

        {linked && (
          <a
            href={review.link}
            target="_blank"
            rel="noopener noreferrer"
            className="relative z-10 inline-flex shrink-0 items-center gap-1.5 font-mono text-xs text-green-400 transition-colors hover:text-green-300"
          >
            <ExternalLinkIcon className="h-3.5 w-3.5" />
            {review.source ? `on ${review.source}` : "read review"}
            {/* Stretch the link over the whole card so it's all clickable. */}
            <span className="absolute inset-0 -z-10" aria-hidden="true" />
          </a>
        )}
      </div>
    </SpotlightCard>
  );
}
