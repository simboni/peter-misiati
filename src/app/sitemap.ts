import type { MetadataRoute } from "next";
import { articles, programs, projects, site } from "@/lib/keysa";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const staticRoutes = [
    "",
    "/about/",
    "/programs/",
    "/projects/",
    "/donate/",
    "/get-involved/",
    "/news/",
    "/contact/",
  ].map((path) => ({
    url: `${site.url}${path}`,
    changeFrequency: "monthly" as const,
    priority: path === "" ? 1 : path === "/donate/" ? 0.9 : 0.7,
  }));

  const programRoutes = programs.map((p) => ({
    url: `${site.url}/programs/${p.slug}/`,
    changeFrequency: "monthly" as const,
    priority: 0.8,
  }));

  const projectRoutes = projects.map((p) => ({
    url: `${site.url}/projects/${p.slug}/`,
    changeFrequency: "monthly" as const,
    priority: 0.8,
  }));

  const articleRoutes = articles.map((a) => ({
    url: `${site.url}/news/${a.slug}/`,
    changeFrequency: "yearly" as const,
    priority: 0.5,
  }));

  return [...staticRoutes, ...programRoutes, ...projectRoutes, ...articleRoutes];
}
