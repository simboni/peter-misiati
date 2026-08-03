import { ImageResponse } from "next/og";
import { BUSINESS } from "@/lib/business";

/**
 * The link-preview card, rendered once at build time into `out/og.png`.
 *
 * This is a route handler rather than the `opengraph-image` file convention on
 * purpose: that convention exports a file with no extension, and a plain static
 * host serves an extensionless file as `application/octet-stream`, which
 * WhatsApp and Facebook refuse to render. Naming the segment `og.png` makes the
 * export land on disk as a real `.png`.
 */
export const dynamic = "force-static";

export const size = { width: 1200, height: 630 };

export function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          background: "#0e7c86",
          color: "#ffffff",
          padding: "80px",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "24px",
            fontSize: 34,
            fontWeight: 700,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 84,
              height: 84,
              borderRadius: 24,
              background: "#5a9c2f",
              fontSize: 38,
              fontWeight: 700,
            }}
          >
            RZ
          </div>
          {BUSINESS.name}
        </div>

        <div
          style={{
            marginTop: 48,
            fontSize: 76,
            fontWeight: 700,
            lineHeight: 1.1,
            letterSpacing: "-2px",
          }}
        >
          {BUSINESS.tagline}
        </div>

        <div style={{ marginTop: 32, fontSize: 33, color: "#c9e6e8" }}>
          Bulk &amp; repacked chemicals · Finished cleaners · Mix kits
        </div>

        <div
          style={{
            marginTop: 44,
            display: "flex",
            alignItems: "center",
            gap: 20,
            fontSize: 38,
            fontWeight: 700,
          }}
        >
          <div
            style={{
              display: "flex",
              background: "#5a9c2f",
              borderRadius: 16,
              padding: "14px 28px",
            }}
          >
            {BUSINESS.phoneDisplay}
          </div>
          <div style={{ display: "flex", fontSize: 30, color: "#c9e6e8" }}>
            {BUSINESS.city}, {BUSINESS.country}
          </div>
        </div>
      </div>
    ),
    size,
  );
}
