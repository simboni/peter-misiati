/**
 * Which version of the system is actually running.
 *
 * This exists because of a specific, expensive kind of confusion: the deploy
 * script runs, the containers restart, the smoke test passes — and the screens
 * look exactly as they did, because the build that came up is the old one. A
 * server parked on a stale image is indistinguishable from a server that is up
 * to date unless something on it can say which commit it is.
 *
 * `deploy/update.sh` writes `public/build.txt` immediately before the image is
 * built, so the stamp is baked in and travels with the build rather than being
 * read from a `.git` directory the container does not have.
 *
 * A missing or unreadable file is not an error. It means the app is running
 * from a build made some other way — a developer's laptop, a hand-run
 * `docker compose up` — and saying so plainly is more useful than a crash or a
 * confident lie.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface BuildStamp {
  /** Short commit hash, e.g. "92aab65". */
  commit: string;
  /** The branch it was built from. */
  branch: string;
  /** When the build was made, as written by the deploy script. */
  builtAt: string;
  /** The first line of the commit message — what this build is. */
  subject: string;
}

let cached: BuildStamp | null | undefined;

export function buildStamp(): BuildStamp | null {
  // Read once. The file cannot change without a new image, and this is called
  // from a screen the owner may refresh repeatedly.
  if (cached !== undefined) return cached;

  try {
    const raw = readFileSync(join(process.cwd(), "public", "build.txt"), "utf8");
    const field = (name: string) =>
      raw
        .split("\n")
        .find((l) => l.startsWith(`${name}=`))
        ?.slice(name.length + 1)
        .trim() ?? "";

    const commit = field("commit");
    cached = commit
      ? {
          commit,
          branch: field("branch"),
          builtAt: field("built"),
          subject: field("subject"),
        }
      : null;
  } catch {
    cached = null;
  }
  return cached;
}
