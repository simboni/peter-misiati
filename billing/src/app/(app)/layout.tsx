export const dynamic = "force-dynamic";
import { AppShell } from "@/components/app-shell";
import { appShellContext } from "@/server/org";
import { signOutAction } from "@/server/actions/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { orgName, userEmail, pro, isAdmin } = await appShellContext();

  return (
    <AppShell orgName={orgName} userEmail={userEmail} pro={pro} isAdmin={isAdmin} signOut={signOutAction}>
      {children}
    </AppShell>
  );
}
