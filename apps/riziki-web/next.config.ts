import type { NextConfig } from "next";

// The public website is a pure static export: no database, no sessions, no
// server actions. Orders arrive by phone and WhatsApp, so nothing here needs a
// running Node process — which lets the shop host it on the cheapest tier
// available (or a plain CDN bucket) and keeps it fast on a 3G phone.
const nextConfig: NextConfig = {
  output: "export",
  // Static hosts serve `/products/index.html` for `/products/`. Emitting
  // directory-style URLs means links keep working without host-side rewrites.
  trailingSlash: true,
  images: {
    // `output: "export"` has no image optimiser at request time.
    unoptimized: true,
  },
  // This app sits inside the portfolio repo, which has its own lockfile. Pin the
  // root so Turbopack doesn't guess the parent directory.
  turbopack: { root: import.meta.dirname },
};

export default nextConfig;
