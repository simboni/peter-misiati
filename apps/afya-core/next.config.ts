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

  /**
   * Who may reach the dev server's own assets.
   *
   * Next blocks cross-origin requests to dev-only endpoints (hot reload, the
   * error overlay) unless the origin is listed. That default is right — a dev
   * server on an open wifi is otherwise reachable by anything on the network —
   * but it means a demonstration on a phone or a client's laptop over the
   * clinic wifi fails with a warning and no hot reload.
   *
   * So: the private ranges a LAN actually hands out, which is the only place a
   * demonstration ever runs from. This is DEVELOPMENT ONLY — `next start` does
   * not apply it, and nothing here loosens anything in production.
   *
   * A machine on a range not listed (a tethered phone, a hotel network) can add
   * its address with AFYA_DEV_ORIGIN=<ip> without editing this file.
   */
  allowedDevOrigins: [
    "10.*.*.*",
    "172.16.*.*", "172.17.*.*", "172.18.*.*", "172.19.*.*",
    "172.2*.*.*", "172.30.*.*", "172.31.*.*",
    "192.168.*.*",
    ...(process.env.AFYA_DEV_ORIGIN ? [process.env.AFYA_DEV_ORIGIN] : []),
  ],
};

export default nextConfig;
