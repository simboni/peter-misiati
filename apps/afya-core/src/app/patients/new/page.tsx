import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth.ts";
import { check, explain } from "@/lib/access.ts";
import RegisterForm from "./form";

export default async function NewPatientPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const decision = check(user.userId, "patient.register");
  if (!decision.allowed) {
    return (
      <main className="max-w-xl mx-auto px-5 py-10">
        <Link href="/patients" className="text-xs text-brand underline underline-offset-2">← Find a patient</Link>
        <p className="mt-4 bg-block-soft border border-block/25 text-block rounded px-4 py-3 text-sm font-medium">
          {explain(decision)}
        </p>
      </main>
    );
  }

  return (
    <main className="max-w-xl mx-auto px-5 py-8">
      <Link href="/patients" className="text-xs text-brand underline underline-offset-2">← Find a patient</Link>
      <h1 className="text-2xl font-bold tracking-tight mt-2">Register a patient</h1>
      <p className="text-sm text-muted mt-2 leading-relaxed">
        A national ID or SHA number makes this person findable forever. Without one, a phone number is the
        next best thing.
      </p>
      <RegisterForm />
    </main>
  );
}
