import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Server-rendered. NOT a static export — this app needs Server Actions,
  // cookies() and Proxy, all of which output: 'export' forbids.
  serverExternalPackages: ["@electric-sql/pglite"],
  experimental: {
    // Default is 1mb; receipt photos from a phone blow straight through it.
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default nextConfig;
