import type { Metadata } from "next";
import { BUSINESS } from "@/lib/business";

/**
 * Page-level `openGraph` replaces the parent's object wholesale rather than
 * merging into it, so a page that sets only a title silently loses the site
 * name, locale, type and preview image. Every page builds its object through
 * here instead, which is also the only place the card image is named.
 */
export const OG_IMAGE = {
  url: "/og.png",
  width: 1200,
  height: 630,
  alt: `${BUSINESS.name} — ${BUSINESS.tagline}`,
};

export function openGraphFor({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  /** Site-relative, with the trailing slash the export emits. */
  path: string;
}): Metadata["openGraph"] {
  return {
    type: "website",
    siteName: BUSINESS.name,
    locale: "en_KE",
    url: path,
    title,
    description,
    images: [OG_IMAGE],
  };
}

export function twitterFor({
  title,
  description,
}: {
  title: string;
  description: string;
}): Metadata["twitter"] {
  return {
    card: "summary_large_image",
    title,
    description,
    images: [OG_IMAGE.url],
  };
}
