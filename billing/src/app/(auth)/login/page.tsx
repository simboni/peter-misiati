import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { signInAction } from "@/server/actions/auth";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <>
      <h1 className="mb-1 text-xl font-bold text-ink">Welcome back</h1>
      <p className="mb-6 text-sm text-muted">Sign in to your billing workspace.</p>
      <AuthForm mode="login" action={signInAction} />
    </>
  );
}
