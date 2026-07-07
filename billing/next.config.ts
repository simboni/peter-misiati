import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Server-rendered app (auth, D1 database) — NOT a static export like the
  // marketing site. Deployed to Cloudflare Workers via @opennextjs/cloudflare.
  outputFileTracingRoot: __dirname,
};

export default nextConfig;

// Give `next dev` access to the Cloudflare bindings (D1, etc.) defined in
// wrangler.jsonc, so local development mirrors production.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
