import Image from "next/image";
import Link from "next/link";

/**
 * The official KEYSA logo (full-colour artwork, includes the wordmark and
 * association name). Sits on a white plate so the black lettering stays
 * visible on the dark theme.
 */
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="group inline-flex items-center">
      <span className="inline-flex items-center rounded-xl bg-white px-2.5 py-1.5 ring-1 ring-ink-600 transition-shadow group-hover:shadow-md">
        <Image
          src="/keysa-logo.png"
          alt="KEYSA — Kenya Youth Support Association, home"
          width={184}
          height={79}
          priority
          className={compact ? "h-8 w-auto" : "h-10 w-auto"}
        />
      </span>
    </Link>
  );
}
