/* eslint-disable @next/next/no-img-element */
import type { OrgProfile } from "@/server/db/schema";

/**
 * Authorised-signature block rendered near the foot of a document. Uses inline
 * styles so it looks identical across the print-CSS invoice templates and the
 * Tailwind-based receipt/delivery-note/credit-note/statement documents.
 */
export function DocSignature({ profile }: { profile: OrgProfile | null }) {
  if (!profile?.showSignature || !profile.signatureUrl) return null;

  const align =
    profile.signatureAlign === "left" ? "flex-start" : profile.signatureAlign === "center" ? "center" : "flex-end";

  return (
    <div style={{ display: "flex", justifyContent: align, marginTop: 40 }} className="doc-signature">
      <div style={{ textAlign: "center", minWidth: 210 }}>
        <img
          src={profile.signatureUrl}
          alt="Signature"
          style={{ maxHeight: 70, maxWidth: 230, objectFit: "contain", margin: "0 auto 4px", display: "block" }}
        />
        <div style={{ borderTop: "1px solid #0f172a", paddingTop: 5 }}>
          {profile.signatureName && (
            <div style={{ fontWeight: 600, color: "#0f172a", fontSize: 13 }}>{profile.signatureName}</div>
          )}
          {profile.signatureTitle && (
            <div style={{ fontSize: 12, color: "#64748b" }}>{profile.signatureTitle}</div>
          )}
          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 1 }}>Authorised signature</div>
        </div>
      </div>
    </div>
  );
}
