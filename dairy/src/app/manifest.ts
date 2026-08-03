import type { MetadataRoute } from "next";

/**
 * Installable PWA. Farmers add it to the home screen — no Play Store, no APK
 * to sideload, and updates land without anyone reinstalling anything.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Dairy Manager",
    short_name: "Dairy",
    description: "Milk, herd, feed, health and money for a working dairy farm.",
    start_url: "/",
    display: "standalone",
    background_color: "#eef1ec",
    theme_color: "#0e5a47",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
