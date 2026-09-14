import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth.ts";
import { listFacilities } from "@/lib/facility.ts";
import SignInForm from "./form";

export default async function SignInPage() {
  if (await currentUser()) redirect("/");

  const facilities = listFacilities();

  return (
    <main className="min-h-dvh grid place-items-center px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-7">
          <div className="text-[11px] font-semibold tracking-[0.16em] uppercase text-muted">Afya Core</div>
          <h1 className="text-2xl font-bold tracking-tight mt-1">Sign in</h1>
          <p className="text-sm text-muted mt-2 leading-relaxed">
            Use your own account. Accounts are never shared — every record you open is recorded against
            the person who opened it.
          </p>
        </div>
        <SignInForm facilities={facilities.map((f) => ({ id: f.id, name: f.name }))} />
      </div>
    </main>
  );
}
