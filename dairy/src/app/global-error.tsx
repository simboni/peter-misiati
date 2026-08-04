"use client";

/**
 * The last resort — the root layout itself failed, so there is no shell, no
 * fonts and no stylesheet to rely on. Everything here is inline for that
 * reason, and there is exactly one instruction.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          margin: 0,
          padding: "2rem 1.5rem",
          color: "#1a2420",
          background: "#fbfaf7",
        }}
      >
        <h1 style={{ fontSize: "1.5rem", margin: "0 0 0.75rem" }}>The app did not start</h1>
        <p style={{ fontSize: "1rem", lineHeight: 1.5, margin: "0 0 1.5rem" }}>
          Nothing you saved has been lost. Close the app and open it again.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            minHeight: "48px",
            padding: "0 1.5rem",
            fontSize: "1rem",
            fontWeight: 600,
            color: "#fff",
            background: "#2f6f4e",
            border: 0,
            borderRadius: "0.375rem",
          }}
        >
          Try again
        </button>
        {error.digest ? (
          <p style={{ marginTop: "2rem", fontSize: "0.75rem", color: "#5b6d65" }}>
            If you report this, quote {error.digest}.
          </p>
        ) : null}
      </body>
    </html>
  );
}
