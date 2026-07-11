import type { MetadataRoute } from "next";
import { site } from "@/lib/cosdep";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = `https://${site.domain}`;
  const routes = [
    "",
    "/about",
    "/programs",
    "/projects",
    "/get-involved",
    "/contact",
  ];

  return routes.map((path) => ({
    url: `${base}${path}`,
    changeFrequency: "monthly",
    priority: path === "" ? 1 : 0.8,
  }));
}
