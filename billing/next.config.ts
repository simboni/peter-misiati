import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Server-rendered app (auth, D1 database) — NOT a static export like the
  // marketing site. Deployed to Cloudflare Workers via @opennextjs/cloudflare.
  outputFileTracingRoot: __dirname,
  // Serve the Android TWA Digital Asset Links from the app (see
  // app/api/assetlinks) so it never depends on Cloudflare serving a dotfile.
  async rewrites() {
    return [{ source: "/.well-known/assetlinks.json", destination: "/api/assetlinks" }];
  },
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
      // Logo + signature are embedded as data URLs in the settings form, which
      // can exceed the default 1MB body limit and make the save silently fail.
      bodySizeLimit: "5mb",
    },
  },
};

export default nextConfig;

// Give `next dev` access to the Cloudflare bindings (D1, etc.) defined in
// wrangler.jsonc, so local development mirrors production.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
