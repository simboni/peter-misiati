export const dynamic = "force-dynamic";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { SidebarNav } from "@/components/sidebar-nav";
import { requireOrg, getOrg, getOrgProfile } from "@/server/org";
import { getAdminContext } from "@/server/admin";
import { isPro } from "@/lib/plan";
import { signOutAction } from "@/server/actions/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { db, organizationId, user } = await requireOrg();
  const [org, profile, admin] = await Promise.all([
    getOrg(db, organizationId),
    getOrgProfile(db, organizationId),
    getAdminContext(),
  ]);
  const pro = isPro(profile?.plan);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[260px_1fr]">
      {/* Sidebar */}
      <aside className="no-print hidden border-r border-line bg-white lg:flex lg:flex-col">
        <div className="border-b border-line px-5 py-4">
          <Brand href="/dashboard" />
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <SidebarNav pro={pro} />
        </div>
        <div className="border-t border-line p-4">
          <p className="truncate text-sm font-semibold text-ink">{org?.name ?? "Workspace"}</p>
          <p className="truncate text-xs text-muted">{user.email}</p>
          {admin && (
            <Link
              href="/admin"
              className="mt-3 flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
            >
              ◆ Admin console
            </Link>
          )}
          <form action={signOutAction} className="mt-2">
            <button className="btn-ghost btn-sm w-full">Sign out</button>
          </form>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="no-print flex items-center justify-between border-b border-line bg-white px-4 py-3 lg:hidden">
        <Brand href="/dashboard" />
        <form action={signOutAction}>
          <button className="text-sm text-muted">Sign out</button>
        </form>
      </div>
      <div className="no-print overflow-x-auto border-b border-line bg-white px-2 py-2 lg:hidden">
        <div className="min-w-max">
          <SidebarNav pro={pro} />
        </div>
      </div>

      {/* Main */}
      <main className="min-w-0 p-4 sm:p-6 lg:p-8">
        {!pro && (
          <Link
            href="/upgrade"
            className="no-print mb-5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 transition-colors hover:bg-brand-100/70"
          >
            <span className="text-sm text-brand-800">
              <b>You’re on the free plan.</b> Your invoices carry Tally branding — upgrade to make
              the app your own.
            </span>
            <span className="btn-primary btn-sm whitespace-nowrap">Make it yours →</span>
          </Link>
        )}
        {children}
      </main>
    </div>
  );
}
