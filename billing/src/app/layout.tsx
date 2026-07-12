import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import { RouteProgress } from "@/components/route-progress";

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
  openGraph: {
    title: "TallyPay — Invoicing & M-Pesa payments for Kenya",
    description:
      "Quotations, invoices with deposits, M-Pesa collection, receipts and reports — built for Kenya.",
    siteName: "TallyPay",
    type: "website",
  },
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
      </head>
      <body>
        <Suspense fallback={null}>
          <RouteProgress />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
