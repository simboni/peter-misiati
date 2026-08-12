import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import HandbookFrame from "@/components/handbook-frame";

export const dynamic = "force-dynamic";

export const metadata = { title: "My handbook · Riziki POS" };

/**
 * The handbook, inside the app.
 *
 * It is framed rather than rendered into the page. The document is standalone —
 * it styles bare `body`, `h1`, `p`, `section` and `a` selectors, and carries its
 * own contents rail and scripts — so dropping its markup into this app would
 * have its stylesheet reach straight into the till screens. A frame is its own
 * document: the handbook keeps its layout, the POS keeps its own, and neither
 * can style the other.
 *
 * The frame is sized to the space under the header and above the phone's tab
 * bar so the page itself never scrolls. Two scrollbars for one document is a
 * mess to use with a thumb, and the handbook's contents rail sticks to the top
 * of the frame, which only works if the frame is what scrolls.
 *
 * Attendants get a copy with the owner-only screens cut out of it, not merely
 * hidden — see `@/lib/handbook`.
 */
export default async function HandbookPage() {
  const user = await currentUser();
  if (!user) redirect("/login");

  const view = user.role === "owner" ? "owner" : "staff";

  return (
    // Cancels the padding `main` puts around every other screen, so the
    // handbook gets the whole panel rather than a column in the middle of it.
    <div className="-mx-4 -mb-32 -mt-5 md:-mx-6 md:-mt-6 lg:-mx-10 lg:-mb-16 lg:-mt-8">
      <HandbookFrame src={`/handbook/doc/${view}`} />
    </div>
  );
}
