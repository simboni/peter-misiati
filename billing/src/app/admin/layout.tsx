export const dynamic = "force-dynamic";
import Link from "next/link";
import { requireAdmin } from "@/server/admin";
import { AdminNav } from "@/components/admin/admin-nav";
import { signOutAction } from "@/server/actions/auth";

export const metadata = { title: "Admin · Tally" };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, isSuper } = await requireAdmin();

  return (
    <div className="min-h-screen bg-canvas lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="hidden bg-slate-900 text-white lg:flex lg:flex-col">
        <div className="border-b border-slate-800 px-5 py-4">
          <Link href="/admin" className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-500 font-extrabold text-slate-900">
              T
            </span>
            <span className="font-bold tracking-tight">Tally Admin</span>
          </Link>
          <p className="mt-1 text-[11px] uppercase tracking-wider text-slate-400">
            {isSuper ? "Super admin" : "Platform admin"}
          </p>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <AdminNav isSuper={isSuper} />
        </div>
        <div className="border-t border-slate-800 p-4">
          <p className="truncate text-sm font-semibold">{user.name}</p>
          <p className="truncate text-xs text-slate-400">{user.email}</p>
          <div className="mt-3 flex gap-2">
            <Link href="/dashboard" className="btn-ghost btn-sm flex-1 !border-slate-700 !bg-slate-800 !text-slate-200 hover:!bg-slate-700">
              My workspace
            </Link>
            <form action={signOutAction} className="flex-1">
              <button className="btn-ghost btn-sm w-full !border-slate-700 !bg-slate-800 !text-slate-200 hover:!bg-slate-700">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="flex items-center justify-between bg-slate-900 px-4 py-3 text-white lg:hidden">
        <Link href="/admin" className="flex items-center gap-2 font-bold">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-brand-500 text-sm font-extrabold text-slate-900">
            T
          </span>
          Tally Admin
        </Link>
        <Link href="/dashboard" className="text-sm text-slate-300">
          Workspace
        </Link>
      </div>
      <div className="overflow-x-auto bg-slate-900 px-2 pb-2 text-white lg:hidden">
        <div className="min-w-max">
          <AdminNav isSuper={isSuper} />
        </div>
      </div>

      <main className="min-w-0 p-4 sm:p-6 lg:p-8">{children}</main>
    </div>
  );
}
