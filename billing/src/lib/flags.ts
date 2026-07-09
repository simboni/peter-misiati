// Simple product feature flags. Flip and redeploy to toggle.

/**
 * Online M-Pesa collection (Kopo Kopo STK push) on shared invoice links.
 * Temporarily OFF while we focus on other areas. The plumbing (config,
 * webhook, settlement) stays in place — set this back to `true` to re-enable
 * the "Pay by M-Pesa" panel on public invoices.
 */
export const MPESA_PAYMENTS_ENABLED = false;

/**
 * Server-side PDF generation (Cloudflare Browser Rendering). OFF until the
 * binding is reliably provisioned — while off, documents hide the "Download
 * PDF" button and users use the browser's rock-solid "Print / Save as PDF"
 * (which produces the same A4 document). Set to `true` once Browser Rendering
 * is enabled on the Worker.
 */
export const SERVER_PDF_ENABLED = false;

/**
 * Where free-plan vendors are pointed to arrange their own branding
 * (white-label) on invoices and emails. Change to your real support inbox.
 */
export const SUPPORT_EMAIL = "support@tallypay.co.ke";
