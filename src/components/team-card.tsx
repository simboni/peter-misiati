import Image from "next/image";
import type { TeamMember } from "@/lib/keysa";
import { LinkedInIcon } from "@/components/icons";

/**
 * Collapsible leadership card: closed by default, showing portrait, name,
 * role and a two-line teaser; expands to the full bio + LinkedIn.
 * Built on native <details>/<summary> — accessible, zero JS.
 */
export function TeamCard({ member }: { member: TeamMember }) {
  return (
    <details className="group h-full rounded-2xl border border-ink-600 bg-ink-800 transition-colors open:border-green-400/40">
      <summary className="cursor-pointer list-none p-7 [&::-webkit-details-marker]:hidden">
        <div className="flex items-center gap-4">
          {member.photo ? (
            <Image
              src={member.photo}
              alt={`Portrait of ${member.name}`}
              width={112}
              height={112}
              className="h-16 w-16 shrink-0 rounded-full border border-ink-600 object-cover"
            />
          ) : (
            <span
              aria-hidden
              className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-green-400 font-display text-lg font-bold text-on-accent"
            >
              {member.initials}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-lg font-bold leading-tight text-mist-100">
              {member.name}
            </h3>
            <p className="mt-1 text-xs font-semibold text-green-400">{member.role}</p>
          </div>
          <span
            aria-hidden
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-ink-500 text-mist-400 transition-transform group-open:rotate-45"
          >
            +
          </span>
        </div>
        {/* Teaser — hidden once expanded */}
        <p className="mt-4 line-clamp-2 text-sm leading-relaxed text-mist-400 group-open:hidden">
          {member.bio[0]}
        </p>
        <span className="mt-3 inline-block text-xs font-semibold text-green-400 group-open:hidden">
          Read full bio
        </span>
      </summary>

      <div className="px-7 pb-7">
        <div className="space-y-3 border-t border-ink-600 pt-5 text-sm leading-relaxed text-mist-400">
          {member.bio.map((p) => (
            <p key={p.slice(0, 40)}>{p}</p>
          ))}
        </div>
        {member.linkedin && (
          <a
            href={member.linkedin}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-5 inline-flex items-center gap-2 rounded-full border border-ink-500 px-4 py-2 text-xs font-semibold text-mist-300 transition-colors hover:border-green-400 hover:text-mist-100"
          >
            <LinkedInIcon className="h-4 w-4" />
            LinkedIn profile
          </a>
        )}
      </div>
    </details>
  );
}
