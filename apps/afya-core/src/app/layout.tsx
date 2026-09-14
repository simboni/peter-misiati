import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Afya Core",
  description: "Kenya-compliant hospital management system",
};

export const viewport: Viewport = {
  themeColor: "#252f7a",
  width: "device-width",
  initialScale: 1,
};

// The facility's data changes with every encounter; never serve a cached shell.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
