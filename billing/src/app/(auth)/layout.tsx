export const dynamic = "force-dynamic";
import { Brand } from "@/components/brand";
import { getSession } from "@/server/org";
import { redirect } from "next/navigation";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (session?.user) redirect("/dashboard");

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="mb-8">
        <Brand />
      </div>
      <div className="card w-full max-w-md p-6 sm:p-8">{children}</div>
      <p className="mt-6 text-center text-xs text-muted">
        Built for freelancers &amp; small businesses in Kenya — VAT &amp; KRA PIN ready.
      </p>
    </div>
  );
}
