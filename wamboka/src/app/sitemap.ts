import type { MetadataRoute } from "next";
import { nav, site } from "@/lib/data";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = `https://${site.domain}`;
  return nav.map((item) => ({
    url: `${base}${item.href}`,
    changeFrequency: "weekly",
    priority: item.href === "/" ? 1 : 0.8,
  }));
}
