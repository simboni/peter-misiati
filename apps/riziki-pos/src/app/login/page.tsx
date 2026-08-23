import { redirect } from "next/navigation";
import { authenticate, createSession, setSessionCookie, currentUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { seed } from "@/lib/seed";
import { Card, Field, inputClass, Button, Alert } from "@/components/ui";
import { logoSrc } from "@/lib/brand";

export const dynamic = "force-dynamic";

async function signIn(formData: FormData) {
  "use server";

  const userId = Number(formData.get("userId"));
  const pin = String(formData.get("pin") ?? "");

  const user = authenticate(userId, pin);
  if (!user) redirect("/login?error=1");

  const token = createSession(user.id);
  await setSessionCookie(token);
  redirect("/");
}

export default async function LoginPage(props: {
  searchParams: Promise<{ error?: string }>;
}) {
  // `searchParams` is a Promise in Next.js 16 — synchronous access was removed.
  const { error } = await props.searchParams;

  if (await currentUser()) redirect("/");

  // First run on a fresh machine: load the shop's chemicals, formulas and stock.
  seed();
  // Ordered by id so the list is stable: the owner is the first account created,
  // and staff added later append to the end rather than reshuffling the dropdown
  // under someone who signs in by muscle memory.
  const users = all<{ id: number; name: string; role: string }>(
    `SELECT id, name, role FROM users WHERE active = 1 ORDER BY id`,
  );

  const logo = logoSrc();

  return (
    <div className="mx-auto max-w-sm py-8">
      <div className="mb-6 text-center">
        {logo ? (
          <img
            src={logo}
            alt="Riziki Industrial Chemicals"
            className="mx-auto mb-3 h-20 w-auto max-w-[15rem] object-contain"
          />
        ) : (
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-lg font-extrabold text-white">
            RZ
          </div>
        )}
        <h1 className="text-xl font-bold">Riziki Industrial Chemicals</h1>
        <p className="mt-0.5 text-sm text-muted">Sign in to the shop system</p>
      </div>

      <Card>
        <form action={signIn} className="space-y-4">
          {error ? <Alert tone="bad">Wrong PIN. Please try again.</Alert> : null}

          <Field label="Who are you?">
            <select name="userId" className={inputClass} defaultValue={users[0]?.id}>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.role === "owner" ? "Owner" : "Attendant"})
                </option>
              ))}
            </select>
          </Field>

          <Field label="PIN" hint="Each person has their own PIN so every sale is recorded against them.">
            <input
              className={inputClass}
              type="password"
              name="pin"
              inputMode="numeric"
              autoComplete="off"
              placeholder="••••"
              required
            />
          </Field>

          <Button type="submit" className="w-full">
            Sign in
          </Button>
        </form>
      </Card>

      <p className="mt-4 text-center text-xs text-muted">
        Demo PINs — Owner <span className="font-bold">1234</span>, Attendant{" "}
        <span className="font-bold">1111</span>. Change these before the shop goes live.
      </p>
      <p className="mt-3 text-center text-[11px] text-muted">
        System by{" "}
        <a
          href="https://smp-developers.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="font-bold text-brand-dark"
        >
          SMP Developers Limited
        </a>
      </p>
    </div>
  );
}
