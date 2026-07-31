import type { MetadataRoute } from "next";
import { products } from "@/lib/products";
import { siteUrl } from "@/lib/site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const staticPages = ["", "products/", "quote/", "claims/", "about/", "faq/", "contact/"].map(
    (path) => ({
      url: `${siteUrl}/${path}`,
      changeFrequency: "monthly" as const,
      priority: path === "" ? 1 : path === "quote/" ? 0.9 : 0.7,
    }),
  );
  const productPages = products.map((p) => ({
    url: `${siteUrl}/products/${p.slug}/`,
    changeFrequency: "monthly" as const,
    priority: 0.8,
  }));
  return [...staticPages, ...productPages];
}
