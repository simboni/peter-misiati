export const dynamic = "force-dynamic";
import { Brand } from "@/components/brand";
import { SidebarNav } from "@/components/sidebar-nav";
import { requireOrg, getOrg } from "@/server/org";
import { signOutAction } from "@/server/actions/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { db, organizationId, user } = await requireOrg();
  const org = await getOrg(db, organizationId);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[260px_1fr]">
      {/* Sidebar */}
      <aside className="no-print hidden border-r border-line bg-white lg:flex lg:flex-col">
        <div className="border-b border-line px-5 py-4">
          <Brand href="/dashboard" />
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <SidebarNav />
        </div>
        <div className="border-t border-line p-4">
          <p className="truncate text-sm font-semibold text-ink">{org?.name ?? "Workspace"}</p>
          <p className="truncate text-xs text-muted">{user.email}</p>
          <form action={signOutAction} className="mt-3">
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
          <SidebarNav />
        </div>
      </div>

      {/* Main */}
      <main className="min-w-0 p-4 sm:p-6 lg:p-8">{children}</main>
    </div>
  );
}
