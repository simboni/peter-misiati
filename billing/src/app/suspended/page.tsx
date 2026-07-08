import { signOutAction } from "@/server/actions/auth";

export const metadata = { title: "Account suspended" };

export default function SuspendedPage() {
  return (
    <div className="grid min-h-screen place-items-center bg-canvas p-6">
      <div className="card max-w-md p-8 text-center">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-red-50 text-2xl">
          ⏸
        </div>
        <h1 className="text-xl font-bold text-ink">Your workspace is paused</h1>
        <p className="mt-2 text-sm text-muted">
          This workspace has been temporarily suspended by the platform. If you think this is a
          mistake, please contact support and we’ll get you back up and running.
        </p>
        <form action={signOutAction} className="mt-6">
          <button className="btn-ghost btn-sm">Sign out</button>
        </form>
      </div>
    </div>
  );
}
