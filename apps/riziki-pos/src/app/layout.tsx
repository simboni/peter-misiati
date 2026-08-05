import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { currentUser } from "@/lib/auth";
import { BottomNav } from "@/components/nav";
import OfflineStatus from "@/components/offline-status";
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

  return (
    <html lang="en">
      <body className="min-h-dvh">
        <RegisterSW />
        <div className="mx-auto min-h-dvh max-w-lg">
          {user ? (
            <header className="no-print header-deep relative flex items-center gap-3 px-4 py-3 text-white">
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

          <main className={user ? "px-4 pb-32 pt-5" : "px-4 py-6"}>{children}</main>

          {user ? <BottomNav isOwner={user.role === "owner"} /> : null}
        </div>
      </body>
    </html>
  );
}
