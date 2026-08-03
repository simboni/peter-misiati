import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      // Server Components import "server-only" as a guard; under Vitest that
      // module has nothing to guard, so it resolves to a no-op.
      "server-only": resolve(__dirname, "./src/test/server-only-stub.ts"),
    },
  },
  // Tests are node-side domain and database logic; Tailwind's PostCSS plugin
  // has nothing to do here and only breaks the run if it is picked up.
  css: { postcss: { plugins: [] } },
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    testTimeout: 30_000,
  },
});
