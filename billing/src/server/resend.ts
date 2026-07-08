import { getDb } from "./db";
import { platformResendConfig } from "./platform";

/** Send a transactional email via Resend. No-op-safe when no key is configured. */
export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  replyTo?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const cfg = await platformResendConfig(await getDb());
  if (!cfg) return { ok: false, error: "Email delivery isn't set up yet (no Resend key)." };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: cfg.from,
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
      ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
    }),
  });
  if (!res.ok) return { ok: false, error: `Email failed to send (${res.status}).` };
  return { ok: true };
}

/** Branded HTML for a shared document email. */
export function documentEmailHtml(opts: {
  businessName: string;
  docLabel: string; // "Invoice INV-0001"
  clientName: string;
  amountLine: string; // "Balance due: KES 46,400.00"
  url: string;
  canPay: boolean;
  footer?: string | null;
}): string {
  const btn = opts.canPay ? "Pay this invoice" : "View document";
  return `<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
  <div style="max-width:560px;margin:0 auto;padding:28px 20px">
    <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;padding:28px">
      <p style="margin:0 0 4px;font-size:13px;color:#64748b">${escape(opts.businessName)}</p>
      <h1 style="margin:0 0 14px;font-size:20px">${escape(opts.docLabel)}</h1>
      <p style="margin:0 0 8px;font-size:15px">Hi ${escape(opts.clientName)},</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.5">Please find your ${escape(opts.docLabel.toLowerCase())} below. <strong>${escape(opts.amountLine)}</strong></p>
      <a href="${opts.url}" style="display:inline-block;background:#059669;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:10px;font-size:15px">${btn}</a>
      <p style="margin:16px 0 0;font-size:13px;color:#64748b">Or open this link: <a href="${opts.url}" style="color:#047857">${opts.url}</a></p>
      ${opts.footer ? `<p style="margin:20px 0 0;padding-top:16px;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8;white-space:pre-line">${escape(opts.footer)}</p>` : ""}
    </div>
    <p style="text-align:center;margin:16px 0 0;font-size:12px;color:#94a3b8">Sent via TallyPay</p>
  </div></body></html>`;
}

function escape(s: string): string {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] || c);
}
