import type { NextConfig } from "next";

// Static HTML export — deploys to any static host. When hosted under a
// sub-path (e.g. GitHub Pages project site), CI sets PAGES_BASE_PATH.
const basePath = process.env.PAGES_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  ...(basePath ? { basePath } : {}),
};

export default nextConfig;
