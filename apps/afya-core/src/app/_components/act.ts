import { redirect } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";

/**
 * Run a server action and put its refusal on the screen.
 *
 * The domain modules refuse things with sentences written to be read by the
 * person who has to fix them — "that batch expires on 2026-01-04, it must not
 * be taken into stock", not "constraint violation". Letting those throw wastes
 * the work: React redacts a server error's message in production, and the user
 * gets a blank failure page instead of the one thing that would help.
 *
 * So every refusal comes back on the URL and the page renders it. Deliberately
 * not `useActionState`, which would make every one of these screens a client
 * component to carry a string.
 */
export async function act(path: string, work: () => void | Promise<void>): Promise<void> {
  try {
    await work();
  } catch (err) {
    // `redirect()` throws by design; it must not be caught and reported.
    if (isRedirectError(err)) throw err;
    const message = err instanceof Error ? err.message : "That did not work.";
    redirect(`${path}?error=${encodeURIComponent(message)}`);
  }
  redirect(path);
}
