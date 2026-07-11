import type { Metadata } from "next";
import { Inter, Poppins } from "next/font/google";
import "./globals.css";
import { site, contact } from "@/lib/cosdep";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});
const poppins = Poppins({
  variable: "--font-poppins",
  weight: ["500", "600", "700", "800"],
  subsets: ["latin"],
  display: "swap",
});

const siteUrl = `https://${site.domain}`;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: site.title,
    template: `%s | ${site.name}`,
  },
  description: site.description,
  keywords: [
    "COSDEP",
    "Community Sustainable Development Empowerment Programme",
    "agroecology Kenya",
    "organic farming Kenya",
    "food security",
    "tree planting Kenya",
    "smallholder farmers",
    "Kiambu NGO",
    "sustainable agriculture",
    "watershed conservation",
  ],
  authors: [{ name: site.fullName }],
  creator: site.fullName,
  openGraph: {
    type: "website",
    locale: "en_KE",
    url: siteUrl,
    siteName: site.name,
    title: site.title,
    description: site.description,
    images: [{ url: "/images/farmers-vegetables.jpg" }],
  },
  twitter: {
    card: "summary_large_image",
    title: site.title,
    description: site.description,
    images: ["/images/farmers-vegetables.jpg"],
  },
  robots: { index: true, follow: true },
};

const orgSchema = {
  "@context": "https://schema.org",
  "@type": "NGO",
  name: site.fullName,
  alternateName: site.name,
  url: siteUrl,
  description: site.description,
  email: contact.email,
  telephone: contact.phone,
  foundingDate: String(site.established),
  address: {
    "@type": "PostalAddress",
    addressCountry: "KE",
    addressRegion: "Kiambu County",
  },
  areaServed: "Kenya",
  sameAs: Object.values(contact.socials),
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${poppins.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-canvas">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(orgSchema) }}
        />
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
