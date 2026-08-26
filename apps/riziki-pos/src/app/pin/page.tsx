import { redirect } from "next/navigation";
import { currentUser, requireUser } from "@/lib/auth";
import { changePin, UserError } from "@/lib/users";
import { Alert, Button, Card, Field, PageTitle, inputClass } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * Change your own PIN — any signed-in user, not just the owner.
 *
 * Before this existed an attendant's only route to a new PIN was asking the
 * owner, which in practice meant saying the new PIN out loud across the counter.
 * A PIN two people know is not a PIN.
 *
 * The user id comes from the session, never from the form: this screen can only
 * ever change the PIN of the person actually holding the phone.
 */
async function changeMyPin(formData: FormData): Promise<void> {
  "use server";
  const me = await requireUser();
  try {
    changePin({
      userId: me.id,
      newPin: String(formData.get("newPin") ?? ""),
      currentPin: String(formData.get("currentPin") ?? ""),
      byUserId: me.id,
    });
  } catch (e) {
    const message = e instanceof UserError ? e.message : "That did not work. Please try again.";
    redirect(`/pin?err=${encodeURIComponent(message)}`);
  }
  // The change signs every session out, this one included; land on the login
  // screen deliberately instead of letting the next click bounce there.
  redirect("/login");
}

export default async function PinPage(props: { searchParams: Promise<{ err?: string }> }) {
  const { err } = await props.searchParams;
  const me = await currentUser();
  if (!me) redirect("/login");

  return (
    <div className="mx-auto max-w-sm">
      <PageTitle
        title="Change my PIN"
        subtitle={`Signed in as ${me.name}. You'll sign in again with the new PIN.`}
      />

      {err ? (
        <div className="mb-3">
          <Alert tone="bad">{err}</Alert>
        </div>
      ) : null}

      <Card>
        <form action={changeMyPin} className="space-y-3">
          <Field label="Current PIN">
            <input
              className={inputClass}
              type="password"
              name="currentPin"
              inputMode="numeric"
              autoComplete="off"
              required
            />
          </Field>
          <Field label="New PIN" hint="Four digits. Not 1234, 0000 or four the same.">
            <input
              className={inputClass}
              type="password"
              name="newPin"
              inputMode="numeric"
              autoComplete="off"
              required
            />
          </Field>
          <Button type="submit" className="w-full">
            Change PIN and sign out
          </Button>
        </form>
      </Card>

      <p className="mt-4 text-xs text-muted">
        Forgotten your PIN entirely? The owner can reset it from Users & settings.
      </p>
    </div>
  );
}
