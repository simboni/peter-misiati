import type { NextConfig } from "next";

// The POS is a server application: it holds the shop's database, enforces the
// owner/staff split server-side and posts stock movements in transactions.
// (The portfolio at the repo root is a separate, statically-exported site.)
const nextConfig: NextConfig = {
  // node:sqlite is a built-in; keep it external so Turbopack doesn't try to bundle it.
  serverExternalPackages: ["node:sqlite"],
  // This app sits inside the portfolio repo, which has its own lockfile. Pin the
  // root so Turbopack doesn't guess the parent directory.
  turbopack: { root: import.meta.dirname },
};

export default nextConfig;
