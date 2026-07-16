import type { MetadataRoute } from "next";

/**
 * PWA web app manifest — makes TallyPay installable (Add to Home Screen) and is
 * the source Bubblewrap / PWABuilder read to package the Android app for Play.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TallyPay — Invoicing & M-Pesa",
    short_name: "TallyPay",
    description:
      "Quotations, invoices with deposits, M-Pesa collection, receipts and reports — built for Kenya.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#059669",
    categories: ["business", "finance", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
