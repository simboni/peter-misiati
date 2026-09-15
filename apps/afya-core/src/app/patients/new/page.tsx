import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth.ts";
import { check, explain } from "@/lib/access.ts";
import { Shell, Banner } from "@/app/_components/shell.tsx";
import RegisterForm from "./form";

export default async function NewPatientPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const decision = check(user.userId, "patient.register");

  return (
    <Shell
      user={user}
      current="/patients/new"
      title="Register a patient"
      subtitle="A national ID or SHA number makes this person findable forever. Without one, a phone number is the next best thing."
    >
      {!decision.allowed ? (
        <div className="mt-5">
          <Banner tone="block">{explain(decision)}</Banner>
        </div>
      ) : (
        <div className="max-w-xl">
          <RegisterForm />
        </div>
      )}
    </Shell>
  );
}
