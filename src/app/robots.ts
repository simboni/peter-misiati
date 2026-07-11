import type { MetadataRoute } from "next";
import { site } from "@/lib/cosdep";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  const base = `https://${site.domain}`;
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${base}/sitemap.xml`,
  };
}
