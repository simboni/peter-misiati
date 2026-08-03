import { NextResponse, type NextRequest } from "next/server";
import { decrypt, SESSION_COOKIE_NAME } from "@/lib/session";

/**
 * Proxy — what used to be `middleware.ts` before Next.js 16 renamed it.
 * It runs on the Node runtime and the runtime option cannot be configured.
 *
 * This is an OPTIMISTIC check only. It reads the session cookie and never
 * touches the database, because Proxy runs on every request including
 * prefetches. The real authorisation boundary is the Data Access Layer in
 * src/lib/dal.ts, which every Server Action calls first.
 */

const PUBLIC_PATHS = ["/login"];

export default async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path.startsWith(p));

  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await decrypt(token);

  if (!isPublic && !session?.userId) {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }
  if (isPublic && session?.userId) {
    return NextResponse.redirect(new URL("/", req.nextUrl));
  }
  return NextResponse.next();
}

export const config = {
  /**
   * Without a matcher Proxy runs on every request including `_next/static`,
   * which would block CSS and images behind the auth redirect.
   *
   * Note: Server Functions are POSTs to the route that uses them, so narrowing
   * this matcher can silently remove Proxy coverage from actions. The DAL check
   * inside each action is what actually protects them.
   */
  matcher: ["/((?!api|_next/static|_next/image|icon-.*\\.png|manifest\\.webmanifest|favicon\\.ico).*)"],
};
