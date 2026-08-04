import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/business";

// Same reason as the sitemap: nothing renders this at request time.
export const dynamic = "force-static";

/**
 * Nothing here is private and there is no server, so everything is crawlable.
 * The sitemap pointer is the part that matters — it is how a brand-new domain
 * gets found without waiting to be linked from somewhere else.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
