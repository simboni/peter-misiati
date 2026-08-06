import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import "./globals.css";
import { currentUser } from "@/lib/auth";
import { BottomNav } from "@/components/nav";
import OfflineStatus from "@/components/offline-status";
import OfflineNotice from "@/components/offline-notice";
import RegisterSW from "@/components/register-sw";
import { signOut } from "@/app/actions/session";

export const metadata: Metadata = {
  title: "Riziki POS",
  description: "Riziki Industrial Chemicals — mixing, stock and point of sale",
};

export const viewport: Viewport = {
  themeColor: "#0e7c86",
  width: "device-width",
  initialScale: 1,
};

// The shop's data changes on every sale; never serve a cached shell.
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();

  // Read here rather than in the browser so the rail is already the right width
  // on the first paint. A rail that renders wide and then snaps shut reads as a
  // fault, and on a counter screen that is the last impression to give.
  const rail = (await cookies()).get("riziki_rail")?.value === "mini" ? "mini" : "wide";

  return (
    <html lang="en" data-rail={rail}>
      <body className="min-h-dvh">
        <RegisterSW />
        {/* Phone: centered column under the band. Desktop (lg+): a fixed left
            rail takes over navigation and the content anchors beside it. The
            rail's width is one CSS variable, so collapsing it moves both. */}
        <div className="min-h-dvh lg:pl-[var(--rail-w)] lg:transition-[padding] lg:duration-200">
          {user ? (
            <header className="no-print header-deep relative flex items-center gap-3 px-4 py-3 text-white md:px-6 lg:px-10">
              <Link
                href="/"
                className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10 text-sm font-extrabold tracking-wide text-white ring-1 ring-inset ring-white/25"
              >
                RZ
              </Link>
              <div className="flex-1 leading-tight">
                <div className="text-sm font-bold">Riziki Industrial Chemicals</div>
                <div className="text-[11px] font-medium text-frost">
                  {user.name} · {user.role === "owner" ? "Owner" : "Attendant"}
                </div>
              </div>
              <OfflineStatus />
              <form action={signOut}>
                <button
                  type="submit"
                  className="flex min-h-11 items-center rounded-full px-3.5 text-[11px] font-bold text-frost ring-1 ring-inset ring-white/30"
                >
                  Sign out
                </button>
              </form>
              <span aria-hidden className="brand-thread absolute inset-x-0 bottom-0 h-[3px]" />
            </header>
          ) : null}

          <main
            className={
              user
                ? "mx-auto w-full max-w-lg px-4 pb-32 pt-5 md:max-w-3xl md:px-6 md:pt-6 lg:mx-0 lg:max-w-6xl lg:px-10 lg:pb-16 lg:pt-8 xl:max-w-7xl 2xl:max-w-[100rem]"
                : "mx-auto w-full max-w-lg px-4 py-6"
            }
          >
            {user ? <OfflineNotice /> : null}
            {children}
          </main>

          {user ? <BottomNav isOwner={user.role === "owner"} rail={rail} /> : null}
        </div>
      </body>
    </html>
  );
}
