import type { Metadata } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { FloatingCta } from "@/components/floating-cta";
import { site, siteUrl } from "@/lib/site";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: `${site.name} — Motor, Medical, Life & Business Insurance in Kenya`,
    template: `%s | ${site.name}`,
  },
  description: site.description,
  keywords: [
    "insurance agency Kenya",
    "insurance agency Nairobi",
    "motor insurance Kenya",
    "comprehensive car insurance Kenya",
    "medical cover Kenya",
    "health insurance Nairobi",
    "life insurance Kenya",
    "WIBA cover Kenya",
    "business insurance Kenya",
    "travel insurance Kenya",
  ],
  openGraph: {
    type: "website",
    locale: "en_KE",
    url: siteUrl,
    siteName: site.name,
    title: `${site.name} — Insurance that shows up when it matters`,
    description: site.description,
  },
  twitter: {
    card: "summary_large_image",
    title: site.name,
    description: site.description,
  },
  robots: { index: true, follow: true },
};

// schema.org InsuranceAgency — the specific type (not generic LocalBusiness).
const agencySchema = {
  "@context": "https://schema.org",
  "@type": "InsuranceAgency",
  name: site.name,
  legalName: site.legalName,
  url: siteUrl,
  logo: `${siteUrl}/icon.svg`,
  telephone: site.phoneHref,
  email: site.email,
  slogan: site.tagline,
  description: site.description,
  address: {
    "@type": "PostalAddress",
    streetAddress: site.address.street,
    addressLocality: site.address.city,
    addressCountry: "KE",
  },
  areaServed: "Kenya",
  openingHours: site.hoursSchema,
  sameAs: Object.values(site.socials),
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${jakarta.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(agencySchema) }}
        />
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
        <FloatingCta />
      </body>
    </html>
  );
}
