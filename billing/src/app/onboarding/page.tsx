export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { OnboardingForm } from "@/components/onboarding-form";
import { getSession } from "@/server/org";
import { getDb, schema } from "@/server/db";
import { eq } from "drizzle-orm";
import { signOutAction } from "@/server/actions/auth";

export const metadata: Metadata = { title: "Set up your business" };

export default async function OnboardingPage() {
  const session = await getSession();
  if (!session?.user) redirect("/login");

  // Already has an org? Go straight to the app.
  const db = await getDb();
  const existing = await db
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(eq(schema.member.userId, session.user.id))
    .limit(1);
  if (existing.length > 0) redirect("/dashboard");

  return (
    <div className="min-h-screen px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex items-center justify-between">
          <Brand />
          <form action={signOutAction}>
            <button className="text-sm text-muted hover:text-ink">Sign out</button>
          </form>
        </div>
        <div className="card p-6 sm:p-8">
          <h1 className="mb-1 text-2xl font-bold text-ink">Tell us about your business</h1>
          <p className="mb-6 text-sm text-muted">
            This appears on your invoices, receipts and delivery notes. You can change it anytime in
            Settings.
          </p>
          <OnboardingForm />
        </div>
      </div>
    </div>
  );
}
