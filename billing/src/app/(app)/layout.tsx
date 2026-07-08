export const dynamic = "force-dynamic";
import { AppShell } from "@/components/app-shell";
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

  return (
    <AppShell
      orgName={org?.name ?? "Workspace"}
      userEmail={user.email}
      pro={isPro(profile?.plan)}
      isAdmin={Boolean(admin)}
      signOut={signOutAction}
    >
      {children}
    </AppShell>
  );
}
