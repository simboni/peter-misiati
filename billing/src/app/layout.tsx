import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Billing — Invoicing for freelancers & small businesses",
    template: "%s · Billing",
  },
  description:
    "Simple multi-vendor billing: quotations, invoices with deposits, receipts, delivery notes and reports. Built for Kenya (VAT, KRA PIN).",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
