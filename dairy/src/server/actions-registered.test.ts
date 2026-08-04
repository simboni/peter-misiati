/**
 * A guard against the worst class of bug this codebase has produced: code that
 * compiles, type-checks, passes 1,185 unit tests, and cannot save anything.
 *
 * A module that carries inline `"use server"` functions is silently skipped by
 * the Turbopack server-action transform if it also contains a bare
 * `export { someImportedBinding };`. No error, no warning — the actions simply
 * never get IDs, and every POST to them returns
 * `404 Server Action not found`.
 *
 * Three modules had exactly that line: `milk.ts`, `sales.ts` and `reports.ts`.
 * The result was that the farm could not record a milking or sell a litre,
 * while every test in the suite stayed green, because unit tests call the
 * functions directly and never go through the action dispatcher.
 *
 * So this test reads the source. It is crude on purpose — a static check is the
 * only thing that catches a compile-time transform that fails silently.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SERVER_DIR = join(process.cwd(), "src/server");

const modules = readdirSync(SERVER_DIR)
  .filter((f) => f.endsWith(".ts") && !f.includes(".test."))
  .map((f) => ({ name: f, source: readFileSync(join(SERVER_DIR, f), "utf8") }))
  .filter((m) => /^\s*"use server";\s*$/m.test(m.source));

/**
 * `export { a, b };` with no `from` clause. `export { a } from "./x"` is fine —
 * it is the bare form, re-exporting a binding this module imported, that trips
 * the transform.
 */
const BARE_REEXPORT = /^\s*export\s*\{[^}]*\}\s*;\s*$/m;

describe("every module with Server Actions can actually register them", () => {
  it("finds the action modules at all (the test is not vacuously passing)", () => {
    expect(modules.length).toBeGreaterThan(5);
  });

  it.each(modules.map((m) => m.name))(
    "%s has no bare re-export, which would silently unregister all its actions",
    (name) => {
      const m = modules.find((x) => x.name === name)!;
      const match = m.source.match(BARE_REEXPORT);
      expect(
        match?.[0]?.trim() ?? null,
        `${name} contains a bare re-export. Turbopack will skip this module's ` +
          `"use server" functions entirely and every POST to them will 404. ` +
          `Export the binding from its own module and import it directly instead.`,
      ).toBeNull();
    },
  );
});
