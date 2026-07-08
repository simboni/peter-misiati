import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "TallyPay — Invoicing & M-Pesa payments for Kenya",
    template: "%s · TallyPay",
  },
  description:
    "TallyPay: simple multi-vendor billing — quotations, invoices with deposits, M-Pesa collection, receipts, delivery notes and reports. Built for Kenya (VAT, KRA PIN).",
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
