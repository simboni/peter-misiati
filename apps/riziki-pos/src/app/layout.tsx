import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { currentUser } from "@/lib/auth";
import { BottomNav } from "@/components/nav";

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
        <div className="mx-auto min-h-dvh max-w-lg bg-white shadow-sm">
          {user ? (
            <header className="no-print flex items-center gap-2.5 border-b border-line px-4 py-3">
              <Link
                href="/"
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand text-sm font-extrabold text-white"
              >
                RZ
              </Link>
              <div className="flex-1 leading-tight">
                <div className="text-sm font-bold">Riziki Industrial Chemicals</div>
                <div className="text-[11px] text-muted">
                  {user.name} · {user.role === "owner" ? "Owner" : "Attendant"}
                </div>
              </div>
              <Link
                href="/logout"
                className="rounded-lg border border-line px-2.5 py-1.5 text-[11px] font-bold text-muted"
              >
                Sign out
              </Link>
            </header>
          ) : null}

          <main className={user ? "px-4 pb-28 pt-4" : "px-4 py-6"}>{children}</main>

          {user ? <BottomNav isOwner={user.role === "owner"} /> : null}
        </div>
      </body>
    </html>
  );
}
