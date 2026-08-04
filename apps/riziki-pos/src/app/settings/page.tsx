import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import Link from "next/link";
import { currentUser, requireOwner } from "@/lib/auth";
import {
  listUsers,
  usersOnDemoPin,
  createUser,
  changePin,
  setActive,
  setRole,
  getSetting,
  setSetting,
  UserError,
} from "@/lib/users";
import { formatDateTime, formatKes, toCents, fromCents } from "@/lib/units";
import {
  Alert,
  Button,
  Card,
  Chip,
  Field,
  PageTitle,
  SectionLabel,
  inputClass,
} from "@/components/ui";

export const dynamic = "force-dynamic";

type State = { error?: string; ok?: string };

async function guard(): Promise<number> {
  const owner = await requireOwner();
  return owner.id;
}

async function addAttendant(formData: FormData): Promise<void> {
  "use server";
  const by = await guard();
  try {
    createUser({
      name: String(formData.get("name") ?? ""),
      pin: String(formData.get("pin") ?? ""),
      role: formData.get("role") === "owner" ? "owner" : "staff",
      byUserId: by,
    });
  } catch (e) {
    redirectWith(e);
  }
  revalidatePath("/settings");
}

async function updatePin(formData: FormData): Promise<void> {
  "use server";
  const by = await guard();
  try {
    changePin({
      userId: Number(formData.get("userId")),
      newPin: String(formData.get("newPin") ?? ""),
      currentPin: String(formData.get("currentPin") ?? "") || undefined,
      byUserId: by,
    });
  } catch (e) {
    redirectWith(e);
  }
  revalidatePath("/settings");
}

async function toggleActive(formData: FormData): Promise<void> {
  "use server";
  const by = await guard();
  try {
    setActive({
      userId: Number(formData.get("userId")),
      active: formData.get("active") === "1",
      byUserId: by,
    });
  } catch (e) {
    redirectWith(e);
  }
  revalidatePath("/settings");
}

async function updateRole(formData: FormData): Promise<void> {
  "use server";
  const by = await guard();
  try {
    setRole({
      userId: Number(formData.get("userId")),
      role: formData.get("role") === "owner" ? "owner" : "staff",
      byUserId: by,
    });
  } catch (e) {
    redirectWith(e);
  }
  revalidatePath("/settings");
}

async function saveShop(formData: FormData): Promise<void> {
  "use server";
  const by = await guard();
  setSetting("shop_name", String(formData.get("shop_name") ?? ""), by);
  setSetting("shop_phone", String(formData.get("shop_phone") ?? ""), by);
  setSetting("shop_kra_pin", String(formData.get("shop_kra_pin") ?? ""), by);
  const float = Number(formData.get("cash_float") ?? 0);
  setSetting("cash_float_cents", String(Number.isFinite(float) ? toCents(float) : 0), by);
  revalidatePath("/settings");
  revalidatePath("/day-close");
}

/**
 * Show a service error as a message on the page, not as a crash.
 *
 * This used to `throw`, which in a server action renders Next's raw error page
 * and dumps the owner out of the app — on the exact screen whose own banner
 * tells them to change their PIN, and exactly when they fumble it. Redirecting
 * back with the message keeps them on the screen with their bearings.
 */
function redirectWith(e: unknown): never {
  const message = e instanceof UserError ? e.message : "That did not work. Please try again.";
  redirect(`/settings?err=${encodeURIComponent(message)}`);
}

export default async function SettingsPage(props: {
  searchParams: Promise<{ err?: string }>;
}) {
  const { err } = await props.searchParams;
  const me = await currentUser();
  if (!me) {
    return <Alert tone="bad">Please sign in.</Alert>;
  }
  if (me.role !== "owner") {
    return (
      <div>
        <PageTitle title="Users &amp; settings" />
        <Alert tone="bad">
          Only the owner can manage accounts. Ask the owner to sign in on this phone.
        </Alert>
      </div>
    );
  }

  const users = listUsers();
  const demo = usersOnDemoPin();
  const shopName = getSetting("shop_name", "Riziki Industrial Chemicals");
  const shopPhone = getSetting("shop_phone", "+254 723 496 434");
  const kraPin = getSetting("shop_kra_pin", "");
  const floatCents = Number(getSetting("cash_float_cents", "0")) || 0;

  return (
    <div>
      <PageTitle
        title="Users &amp; settings"
        subtitle="Who can use the system, and the details that appear on an invoice"
      />

      {err ? (
        <div className="mb-3">
          <Alert tone="bad">{err}</Alert>
        </div>
      ) : null}

      {demo.length > 0 ? (
        <Alert tone="bad">
          <strong>Change the starting PINs before the shop opens.</strong>{" "}
          {demo.map((u) => u.name).join(" and ")}{" "}
          {demo.length === 1 ? "still opens" : "still open"} with the PIN the system shipped
          with, which anyone who has seen a demo already knows.
        </Alert>
      ) : null}

      <SectionLabel>People</SectionLabel>
      <div className="space-y-2.5">
        {users.map((u) => (
          <Card key={u.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold">{u.name}</span>
                  <Chip tone={u.role === "owner" ? "brand" : "neutral"}>
                    {u.role === "owner" ? "Owner" : "Attendant"}
                  </Chip>
                  {u.active ? null : <Chip tone="bad">Switched off</Chip>}
                  {u.active && u.demo_pin ? <Chip tone="warn">Starting PIN</Chip> : null}
                  {u.id === me.id ? <Chip tone="good">You</Chip> : null}
                </div>
                <div className="mt-0.5 text-xs text-muted">
                  {u.last_login ? `Last signed in ${formatDateTime(u.last_login)}` : "Never signed in"}
                </div>
              </div>
            </div>

            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-bold text-brand">
                Change PIN
              </summary>
              <form action={updatePin} className="mt-2.5 space-y-2.5">
                <input type="hidden" name="userId" value={u.id} />
                {u.id === me.id ? (
                  <Field label="Your current PIN">
                    <input
                      className={inputClass}
                      type="password"
                      name="currentPin"
                      inputMode="numeric"
                      autoComplete="off"
                      required
                    />
                  </Field>
                ) : null}
                <Field
                  label="New PIN"
                  hint="Four digits. Not 1234, 0000 or four the same."
                >
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
                  {u.id === me.id ? "Change my PIN" : `Reset ${u.name}'s PIN`}
                </Button>
              </form>
            </details>

            {u.id === me.id ? null : (
              <div className="mt-2.5 flex flex-wrap gap-2">
                <form action={toggleActive}>
                  <input type="hidden" name="userId" value={u.id} />
                  <input type="hidden" name="active" value={u.active ? "0" : "1"} />
                  <Button type="submit" variant={u.active ? "danger" : "ghost"}>
                    {u.active ? "Switch off" : "Switch back on"}
                  </Button>
                </form>
                <form action={updateRole}>
                  <input type="hidden" name="userId" value={u.id} />
                  <input type="hidden" name="role" value={u.role === "owner" ? "staff" : "owner"} />
                  <Button type="submit" variant="ghost">
                    Make {u.role === "owner" ? "an attendant" : "an owner"}
                  </Button>
                </form>
              </div>
            )}
          </Card>
        ))}
      </div>

      <SectionLabel>Add someone</SectionLabel>
      <Card>
        <form action={addAttendant} className="space-y-3">
          <Field label="Name">
            <input className={inputClass} name="name" required placeholder="e.g. Grace" />
          </Field>
          <Field label="Starting PIN" hint="They can change it themselves once they sign in.">
            <input
              className={inputClass}
              type="password"
              name="pin"
              inputMode="numeric"
              autoComplete="off"
              required
            />
          </Field>
          <Field label="What can they do?">
            <select className={inputClass} name="role" defaultValue="staff">
              <option value="staff">Attendant — sell, stock and mix</option>
              <option value="owner">Owner — everything, including formulas and profit</option>
            </select>
          </Field>
          <Button type="submit" className="w-full">
            Add to the system
          </Button>
        </form>
      </Card>

      <SectionLabel>Shop details</SectionLabel>
      <Card>
        <form action={saveShop} className="space-y-3">
          <Field label="Business name" hint="Printed at the top of every invoice.">
            <input className={inputClass} name="shop_name" defaultValue={shopName} />
          </Field>
          <Field label="Phone">
            <input className={inputClass} name="shop_phone" defaultValue={shopPhone} />
          </Field>
          <Field label="KRA PIN" hint="Needed on an invoice once eTIMS is switched on.">
            <input className={inputClass} name="shop_kra_pin" defaultValue={kraPin} placeholder="P000000000X" />
          </Field>
          <Field
            label="Cash float in the drawer"
            hint="The money kept in the drawer for change. Day close expects to find it there, so leave it at 0 if you do not keep one."
          >
            <input
              className={inputClass}
              type="number"
              name="cash_float"
              min="0"
              step="any"
              defaultValue={floatCents ? fromCents(floatCents) : 0}
            />
          </Field>
          <p className="text-xs text-muted">
            Currently expecting {formatKes(floatCents)}{" "}
            in the drawer before the day&rsquo;s takings.
          </p>
          <Button type="submit" className="w-full">
            Save
          </Button>
        </form>
      </Card>

      <p className="mt-5 text-xs text-muted">
        Every change here is recorded against your name. PINs are never stored or written to
        that record — only the fact that one was changed.{" "}
        <Link href="/settings/printer" className="font-bold text-brand">
          Printer setup →
        </Link>
      </p>
    </div>
  );
}
