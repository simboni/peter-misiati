import type { NextConfig } from "next";

// Static HTML export — the finished site deploys to any static host
// (Vercel, Cloudflare Pages, cPanel/Apache, GitHub Pages). If the client's
// host serves the site from a sub-path, set PAGES_BASE_PATH in CI.
const basePath = process.env.PAGES_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  // This app lives inside the peter-misiati repo; pin the workspace root so
  // Turbopack doesn't infer it from the outer lockfile.
  turbopack: { root: __dirname },
  ...(basePath ? { basePath } : {}),
};

export default nextConfig;
