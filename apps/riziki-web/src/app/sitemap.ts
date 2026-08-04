import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/business";

// `output: "export"` has no server to render this on demand, so it has to be
// pinned to build time explicitly.
export const dynamic = "force-static";

/**
 * The sitemap is generated at build time and written into the static export.
 *
 * URLs carry the trailing slash because `trailingSlash: true` is what the
 * export emits; a sitemap that lists a URL the host redirects away from wastes
 * crawl budget on every entry.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return [
    {
      url: `${SITE_URL}/`,
      lastModified,
      changeFrequency: "monthly",
      priority: 1,
    },
    {
      // The catalogue is the page that earns the search traffic.
      url: `${SITE_URL}/products/`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/contact/`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/about/`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.6,
    },
  ];
}
