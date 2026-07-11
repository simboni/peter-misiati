import type { Testimonial } from "@/lib/cosdep";
import { QuoteIcon } from "@/components/icons";

/** Initials for the avatar tile. */
function initials(name: string) {
  return name.slice(0, 1).toUpperCase();
}

/** A farmer testimonial card. */
export function TestimonialCard({ testimonial }: { testimonial: Testimonial }) {
  return (
    <figure className="card relative flex h-full flex-col p-8">
      <QuoteIcon className="h-9 w-9 text-leaf-500/60" />
      <blockquote className="mt-4 flex-1 text-lg leading-relaxed text-ink-700 text-pretty">
        {testimonial.quote}
      </blockquote>
      <figcaption className="mt-6 flex items-center gap-3 border-t border-sand-200 pt-5">
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-forest-100 font-display text-lg font-bold text-forest-700">
          {initials(testimonial.name)}
        </span>
        <span className="flex flex-col leading-tight">
          <span className="font-display font-bold text-ink-900">
            {testimonial.name}
          </span>
          <span className="text-sm text-ink-500">{testimonial.role}</span>
        </span>
      </figcaption>
    </figure>
  );
}
