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
  // Installable-app metadata (PWA / Play).
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "TallyPay", statusBarStyle: "default" },
  // Served from /public (static) rather than the src/app file convention so the
  // 70 KiB PNG stays out of the Cloudflare Worker bundle (3 MiB compressed cap).
  icons: {
    icon: "/icon.svg",
    apple: "/apple-icon.png",
  },
  openGraph: {
    title: "TallyPay — Invoicing & M-Pesa payments for Kenya",
    description:
      "Quotations, invoices with deposits, M-Pesa collection, receipts and reports — built for Kenya.",
    siteName: "TallyPay",
    type: "website",
    images: [{ url: "/opengraph-image.png", width: 1200, height: 630, alt: "TallyPay" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "TallyPay — Invoicing & M-Pesa payments for Kenya",
    images: ["/opengraph-image.png"],
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
        {/* Self-heal after a deploy: if the app opens with a stale bundle and a
            code chunk 404s (which would otherwise show a blank screen), reload
            once to fetch the fresh build. Loop-guarded to 1 reload / 12s. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var K='tp:chunkReload';function chunk(m){m=String(m||'');return /ChunkLoadError|Loading chunk|Loading CSS chunk|Importing a module script failed|dynamically imported module/i.test(m);}function heal(m){if(!chunk(m))return;var last=0;try{last=parseInt(sessionStorage.getItem(K)||'0',10);}catch(e){}var now=Date.now();if(now-last<12000)return;try{sessionStorage.setItem(K,String(now));}catch(e){}location.reload();}window.addEventListener('error',function(e){var t=e&&e.target;if(t&&(t.tagName==='SCRIPT'||t.tagName==='LINK')){var u=t.src||t.href||'';if(u.indexOf('/_next/')>-1)heal('Loading chunk failed');return;}heal(e&&e.message);},true);window.addEventListener('unhandledrejection',function(e){var r=e&&e.reason;heal(r&&(r.message||r));});}catch(e){}})();",
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
