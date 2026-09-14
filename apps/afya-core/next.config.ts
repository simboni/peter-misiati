import type { NextConfig } from "next";

// Afya Core is a server application: it holds the facility's records, enforces
// the licence and MFA rules server-side, and maintains a hash-chained audit log
// in transactions. (The portfolio at the repo root is a separate, statically
// exported site.)
const nextConfig: NextConfig = {
  // node:sqlite is a built-in; keep it external so Turbopack doesn't bundle it.
  serverExternalPackages: ["node:sqlite"],
  // This app sits inside the portfolio repo, which has its own lockfile. Pin the
  // root so Turbopack doesn't guess the parent directory.
  turbopack: { root: import.meta.dirname },
};

export default nextConfig;
