export const dynamic = "force-dynamic";
import { requireAdmin } from "@/server/admin";
import { AdminShell } from "@/components/admin/admin-shell";
import { signOutAction } from "@/server/actions/auth";

export const metadata = { title: "Admin · TallyPay" };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, isSuper } = await requireAdmin();

  return (
    <AdminShell user={{ name: user.name, email: user.email }} isSuper={isSuper} signOut={signOutAction}>
      {children}
    </AdminShell>
  );
}
