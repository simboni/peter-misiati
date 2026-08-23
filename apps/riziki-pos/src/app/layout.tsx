import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { currentUser } from "@/lib/auth";
import { BottomNav, MenuDrawer } from "@/components/nav";
import OfflineStatus from "@/components/offline-status";
import AppHeader from "@/components/app-header";
import OfflineNotice from "@/components/offline-notice";
import RegisterSW from "@/components/register-sw";
import { signOut } from "@/app/actions/session";
import { markSrc } from "@/lib/brand";

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
  const logo = markSrc();
  const user = await currentUser();

  return (
    <html lang="en">
      <body className="min-h-dvh">
        <RegisterSW />
        {/* Nothing is reserved down the side any more: the menu is a drawer
            over the page, so every screen gets the full width. */}
        <div className="min-h-dvh">
          {user ? (
            <AppHeader
              menu={<MenuDrawer isOwner={user.role === "owner"} />}
              status={<OfflineStatus />}
            >
              <Link href="/" className="flex shrink-0 items-center" aria-label="Home">
                {logo ? (
                  /* A light plate behind it: the emblem's flask is drawn in
                     white with a dark outline, and on this dark green header
                     the glass would disappear into the background. */
                  <img
                    src={logo}
                    alt=""
                    aria-hidden="true"
                    className="h-10 w-10 rounded-xl bg-white object-contain p-1"
                  />
                ) : (
                  <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10 text-sm font-extrabold tracking-wide text-white ring-1 ring-inset ring-white/25">
                    RZ
                  </span>
                )}
              </Link>
              <div className="flex-1 leading-tight">
                <div className="text-sm font-bold">Riziki Industrial Chemicals</div>
                <div className="text-[11px] font-medium text-frost">
                  {user.name} · {user.role === "owner" ? "Owner" : "Attendant"}
                </div>
              </div>
              <form action={signOut}>
                <button
                  type="submit"
                  className="flex min-h-11 items-center rounded-full px-3.5 text-[11px] font-bold text-frost ring-1 ring-inset ring-white/30"
                >
                  Sign out
                </button>
              </form>
            </AppHeader>
          ) : null}

          <main
            className={
              user
                ? "mx-auto w-full max-w-lg px-4 pb-32 pt-5 md:max-w-3xl md:px-6 md:pt-6 lg:mx-0 lg:max-w-none lg:px-5 lg:pb-10 lg:pt-6 xl:px-6 2xl:px-8"
                : "mx-auto w-full max-w-lg px-4 py-6"
            }
          >
            {user ? <OfflineNotice /> : null}
            {children}
          </main>

          {user ? <BottomNav isOwner={user.role === "owner"} /> : null}
        </div>
      </body>
    </html>
  );
}
