import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Server-rendered app (auth, SQLite database) — NOT a static export like the
  // marketing site. Self-hosted: built into a standalone Node server and run
  // in Docker behind edge-caddy.
  output: "standalone",
  outputFileTracingRoot: __dirname,
  // Serve the Android TWA Digital Asset Links from the app (see
  // app/api/assetlinks) so it never depends on Cloudflare serving a dotfile.
  async rewrites() {
    return [{ source: "/.well-known/assetlinks.json", destination: "/api/assetlinks" }];
  },
  // Security headers applied to every response. This is a billing app that
  // handles money and PII, so we lock down clickjacking, MIME sniffing, HTTPS
  // downgrade, referrer leakage and unused browser features. The CSP still
  // permits the inline bootstrap scripts Next injects and our own theme/app
  // detection scripts (script-src 'unsafe-inline'); everything external is
  // blocked, and frame-ancestors/object-src/base-uri/form-action are locked.
  async headers() {
    const csp = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline'",
      "connect-src 'self'",
      "manifest-src 'self'",
      "worker-src 'self'",
      "upgrade-insecure-requests",
    ].join("; ");
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), browsing-topics=(), interest-cohort=()",
          },
        ],
      },
    ];
  },
  experimental: {
    // Behind edge-caddy the forwarded host can differ from the request Origin,
    // which makes Next reject Server Action POSTs (every form submit — add
    // client, save settings, record payment). Allow the production host so
    // those submissions are accepted.
    serverActions: {
      allowedOrigins: ["tallypay.smp.co.ke"],
      // Logo + signature are embedded as data URLs in the settings form, which
      // can exceed the default 1MB body limit and make the save silently fail.
      bodySizeLimit: "5mb",
    },
  },
};

export default nextConfig;
