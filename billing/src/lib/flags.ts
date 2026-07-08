// Simple product feature flags. Flip and redeploy to toggle.

/**
 * Online M-Pesa collection (Kopo Kopo STK push) on shared invoice links.
 * Temporarily OFF while we focus on other areas. The plumbing (config,
 * webhook, settlement) stays in place — set this back to `true` to re-enable
 * the "Pay by M-Pesa" panel on public invoices.
 */
export const MPESA_PAYMENTS_ENABLED = false;
