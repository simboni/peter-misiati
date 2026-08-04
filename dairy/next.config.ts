import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Server-rendered. NOT a static export — this app needs Server Actions,
  // cookies() and Proxy, all of which output: 'export' forbids.
  serverExternalPackages: ["@electric-sql/pglite"],
  experimental: {
    // Default is 1mb; receipt photos from a phone blow straight through it.
    serverActions: { bodySizeLimit: "2mb" },
    // Lets a page call `forbidden()` and render `forbidden.tsx` instead of
    // throwing into the crash boundary. Four people share one phone here, so
    // opening a page your role cannot use is an ordinary Tuesday, not an
    // error — and it must not end at "ERROR 230055567" with a Reload button
    // that reloads the same wall.
    authInterrupts: true,
  },
};

export default nextConfig;
