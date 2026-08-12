import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const metadata = { title: "My handbook · Riziki POS" };

/**
 * The handbook, taking over the screen.
 *
 * It is still a screen of this app — same session, same role rules — but it is
 * not squeezed into the space the till screens leave behind. Reading is the
 * whole task here, and a document read on a phone through a slot between a
 * header and a tab bar is a document nobody reads. So the app's chrome gets out
 * of the way and one link brings it back.
 *
 * A fixed panel rather than a route group with its own root layout: the second
 * root layout would mean moving all twenty-odd existing routes into a group to
 * get one page out of the shared one. This is the same result in eight lines,
 * and being server-rendered it covers the chrome in the first paint — nothing
 * flashes into view and then vanishes.
 *
 * Because the panel is `fixed inset-0`, the frame inside it gets the exact
 * remaining height from flexbox. Nothing has to measure anything.
 *
 * The document is framed, not inlined: it styles bare `body`, `h1`, `p`,
 * `section` and `a` selectors, and inlining it would have its stylesheet reach
 * into the till screens. Attendants are served a copy with the owner-only
 * screens cut out of it, not merely hidden — see `@/lib/handbook`.
 */
export default async function HandbookPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  const view = user.role === "owner" ? "owner" : "staff";

  return (
    // The id is what the stylesheet looks for to fold the app's own header and
    // nav away while this is on screen.
    <div
      id="handbook-takeover"
      className="fixed inset-0 z-50 flex flex-col bg-white pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]"
    >
      <div className="header-deep relative flex items-center px-3 py-2 text-white md:px-4">
        <Link
          href="/"
          className="flex min-h-11 items-center gap-2 rounded-full px-3.5 text-xs font-bold text-frost ring-1 ring-inset ring-white/30 transition-colors hover:bg-white/10 hover:text-white"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M15 5l-7 7 7 7" />
          </svg>
          Back to app
        </Link>
        <span aria-hidden className="brand-thread absolute inset-x-0 bottom-0 h-[3px]" />
      </div>

      <iframe
        src={`/handbook/doc/${view}`}
        title="My handbook"
        // min-h-0 so the frame is allowed to shrink inside the flex column
        // instead of pushing its own content height out past the screen.
        className="min-h-0 w-full flex-1 border-0 bg-white"
      />
    </div>
  );
}
