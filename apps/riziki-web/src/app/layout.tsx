import type { Metadata, Viewport } from "next";
import "./globals.css";
import { BUSINESS, SITE_URL } from "@/lib/business";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { LocalBusinessJsonLd } from "@/components/structured-data";
import { openGraphFor, twitterFor } from "@/lib/seo";

const HOME_OG_TITLE = `${BUSINESS.name} — ${BUSINESS.tagline}`;
const HOME_OG_DESCRIPTION =
  "Raw chemicals in bulk and small packs, finished cleaning products and measured mix kits. Nairobi, Kenya. Call or WhatsApp +254 723 496 434.";

export const metadata: Metadata = {
  // Static export cannot read the request host, so the canonical origin is
  // baked in. Every relative URL below resolves against it.
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${BUSINESS.name} — Industrial Chemicals Supplier in Nairobi`,
    template: `%s | ${BUSINESS.name}`,
  },
  description:
    "Industrial and detergent-making chemicals in Nairobi. Caustic soda, SLES/Ungerol, LABSA, soda ash, hypo and more — in bulk or repacked from 125 g. Finished cleaning products and mix kits. Order on WhatsApp.",
  applicationName: BUSINESS.name,
  keywords: [
    "industrial chemicals Nairobi",
    "chemical suppliers Nairobi",
    "where to buy caustic soda Kenya",
    "SLES suppliers Nairobi",
    "detergent making chemicals",
    "soap making chemicals Kenya",
    "LABSA Ufacid Nairobi",
    "soda ash Magadi supplier",
  ],
  authors: [{ name: BUSINESS.name }],
  openGraph: openGraphFor({
    title: HOME_OG_TITLE,
    description: HOME_OG_DESCRIPTION,
    path: "/",
  }),
  twitter: twitterFor({
    title: HOME_OG_TITLE,
    description: HOME_OG_DESCRIPTION,
  }),
  robots: {
    index: true,
    follow: true,
  },
  category: "business",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0e7c86" },
    { media: "(prefers-color-scheme: dark)", color: "#0c1214" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-KE">
      <body className="flex min-h-dvh flex-col">
        <LocalBusinessJsonLd />
        <a href="#main" className="skip-link rounded-lg bg-brand px-4 py-2 text-sm font-bold text-white">
          Skip to content
        </a>
        <SiteHeader />
        <main id="main" className="flex-1">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
