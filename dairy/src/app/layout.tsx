import type { Metadata, Viewport } from "next";
import "./globals.css";
import { optionalSession } from "@/lib/dal";
import { sendOutboxEntryAction } from "@/lib/sync-actions";
import { RegisterServiceWorker } from "@/components/sync/RegisterServiceWorker";
import { SyncProvider } from "@/components/sync/SyncProvider";
import { SyncStatus } from "@/components/sync/SyncStatus";

export const metadata: Metadata = {
  title: "Dairy Manager",
  description: "Milk, herd, feed, health and money for a working dairy farm.",
  manifest: "/manifest.webmanifest",
  // iOS never reads the manifest and looks for this file by name.
  appleWebApp: { capable: true, title: "Dairy", statusBarStyle: "default" },
  icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#0e5a47",
  width: "device-width",
  initialScale: 1,
  // Zoom stays enabled deliberately: some users will need it, and disabling it
  // to make an app "feel native" is an accessibility failure.
  maximumScale: 5,
};

/**
 * The layout is where the offline half of the app is switched on.
 *
 * Both pieces have to live above every screen, not on the milk sheet:
 *
 *   - The service worker, so reloading or navigating without a signal shows the
 *     app rather than Chrome's dinosaur.
 *   - The outbox flusher, so a milking saved on the phone still goes to the
 *     office after the herdsman has walked away from the milk screen. Before
 *     this, `flush()` existed and nothing on earth called it.
 *
 * The session is read here rather than passed down because a Server Action can
 * only be handed to a client component from the server, and `farmId` is what
 * lets the milk sheet show the SAME reference code offline that the office will
 * see when the batch lands.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Never `verifySession` here: the layout also renders /login, and redirecting
  // out of a layout would make signing in impossible.
  const session = await optionalSession();

  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <SyncProvider
          farmId={session?.farmId ?? null}
          userId={session?.userId ?? null}
          send={sendOutboxEntryAction}
        >
          <RegisterServiceWorker />
          <SyncStatus />
          {children}
        </SyncProvider>
      </body>
    </html>
  );
}
