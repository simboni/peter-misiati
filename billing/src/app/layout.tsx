import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import "./globals.css";
import { RouteProgress } from "@/components/route-progress";
import { RegisterSW } from "@/components/register-sw";

const SITE_URL = process.env.BETTER_AUTH_URL ?? "https://tallypay.co.ke";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "TallyPay — Invoicing & M-Pesa payments for Kenya",
    template: "%s · TallyPay",
  },
  description:
    "TallyPay: simple multi-vendor billing — quotations, invoices with deposits, M-Pesa collection, receipts, delivery notes and reports. Built for Kenya (VAT, KRA PIN).",
  applicationName: "TallyPay",
  // Installable-app metadata (PWA / Play via TWA).
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "TallyPay", statusBarStyle: "default" },
  openGraph: {
    title: "TallyPay — Invoicing & M-Pesa payments for Kenya",
    description:
      "Quotations, invoices with deposits, M-Pesa collection, receipts and reports — built for Kenya.",
    siteName: "TallyPay",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#059669",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply the saved theme before first paint to avoid a flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('tp:theme');if(t&&t!=='light')document.documentElement.setAttribute('data-theme',t);}catch(e){}",
          }}
        />
        {/* Inside the native app, mark the document early so the bottom-tab app
            chrome paints immediately (no flash of the website layout). */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var C=window.Capacitor;if(C&&C.isNativePlatform&&C.isNativePlatform())document.documentElement.setAttribute('data-app','native');}catch(e){}",
          }}
        />
      </head>
      <body>
        <RegisterSW />
        <Suspense fallback={null}>
          <RouteProgress />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
