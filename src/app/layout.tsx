import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { site } from "@/lib/keysa";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const space = Space_Grotesk({
  variable: "--font-space",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: site.title,
    template: `%s | ${site.shortName}`,
  },
  description: site.description,
  keywords: [
    "KEYSA",
    "Kenya Youth Support Association",
    "youth empowerment Kenya",
    "NGO Kakamega County",
    "youth NGO Kenya",
    "TVET scholarships Kenya",
    "youth sports Kenya",
    "climate action Kenya",
    "donate youth Kenya",
    "Matungu Constituency",
  ],
  authors: [{ name: site.name }],
  creator: site.name,
  openGraph: {
    type: "website",
    locale: "en_KE",
    url: site.url,
    siteName: site.name,
    title: site.title,
    description: site.description,
  },
  twitter: {
    card: "summary_large_image",
    title: site.title,
    description: site.description,
  },
  robots: { index: true, follow: true },
};

const ngoSchema = {
  "@context": "https://schema.org",
  "@type": "NGO",
  name: site.name,
  alternateName: site.shortName,
  url: site.url,
  email: site.email,
  logo: `${site.url}/keysa-logo.png`,
  foundingDate: String(site.founded),
  description: site.description,
  address: {
    "@type": "PostalAddress",
    addressLocality: "Matungu Constituency",
    addressRegion: "Kakamega County",
    addressCountry: "KE",
  },
  areaServed: ["Bungoma County", "Kakamega County", "Busia County", "Nairobi County"],
  keywords:
    "youth empowerment, education, TVET, sports, talents, technology, financial literacy, community development, climate action",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${space.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-ink-900">
        {/* Apply the stored theme before first paint (default: light). */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('keysa-theme');if(t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();",
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(ngoSchema) }}
        />
        <SiteHeader />
        <main id="main" className="flex-1">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
