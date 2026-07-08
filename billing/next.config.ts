import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Server-rendered app (auth, D1 database) — NOT a static export like the
  // marketing site. Deployed to Cloudflare Workers via @opennextjs/cloudflare.
  outputFileTracingRoot: __dirname,
  experimental: {
    // Behind Cloudflare's custom-domain proxy the forwarded host can differ
    // from the request Origin, which makes Next reject Server Action POSTs
    // (every form submit — add client, save settings, record payment). Allow
    // the production hosts so those submissions are accepted.
    serverActions: {
      allowedOrigins: [
        "tallypay.co.ke",
        "www.tallypay.co.ke",
        "billing-platform.misiatipeter.workers.dev",
      ],
    },
  },
};

export default nextConfig;

// Give `next dev` access to the Cloudflare bindings (D1, etc.) defined in
// wrangler.jsonc, so local development mirrors production.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
