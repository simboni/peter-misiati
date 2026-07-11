import type { MetadataRoute } from "next";
import { site, ministries } from "@/lib/site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = `https://${site.domain}`;
  const staticRoutes = [
    "",
    "/about",
    "/ministries",
    "/causes",
    "/gallery",
    "/contact",
    "/donate",
  ];
  const ministryRoutes = ministries.map((m) => `/ministries/${m.slug}`);

  return [...staticRoutes, ...ministryRoutes].map((path) => ({
    url: `${base}${path}`,
    changeFrequency: "monthly",
    priority: path === "" ? 1 : path.startsWith("/ministries/") ? 0.7 : 0.8,
  }));
}
