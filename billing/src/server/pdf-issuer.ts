import type { OrgProfile } from "./db/schema";

/**
 * Build the lean issuer object passed to the client-side PDF builder — only the
 * display fields a document needs, never the vendor's encrypted secrets.
 */
export function pdfIssuer(name: string, profile: OrgProfile | null) {
  return {
    name,
    profile: profile
      ? {
          legalName: profile.legalName,
          kraPin: profile.kraPin,
          addressLine1: profile.addressLine1,
          addressLine2: profile.addressLine2,
          city: profile.city,
          country: profile.country,
          phone: profile.phone,
          email: profile.email,
          bankDetails: profile.bankDetails,
          invoiceFooter: profile.invoiceFooter,
          accentColor: profile.accentColor,
          plan: profile.plan,
        }
      : null,
  };
}
