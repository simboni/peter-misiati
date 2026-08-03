import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { signUpAction } from "@/server/actions/auth";

export const metadata: Metadata = { title: "Create account" };

export default function SignupPage() {
  return (
    <>
      <h1 className="mb-1 text-xl font-bold text-ink">Create your account</h1>
      <p className="mb-6 text-sm text-muted">Start invoicing in minutes. No card required.</p>
      <AuthForm mode="signup" action={signUpAction} />
    </>
  );
}
