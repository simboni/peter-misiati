import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dairy Manager",
  description: "Milk, herd, feed, health and money for a working dairy farm.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#0e5a47",
  width: "device-width",
  initialScale: 1,
  // Zoom stays enabled deliberately: some users will need it, and disabling it
  // to make an app "feel native" is an accessibility failure.
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
