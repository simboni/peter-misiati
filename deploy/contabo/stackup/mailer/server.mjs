// StackUp → Brevo email adapter.
//
// StackUp sends outbound email as one JSON POST in Resend's shape:
//   { from: "Name <a@b>", to: "x@y" | ["x@y"], subject, text, html? }
// Brevo's API wants a different one:
//   { sender: { name, email }, to: [{ email }], subject, textContent, htmlContent }
// This translates one into the other, so StackUp's code does not change and
// the gym's Brevo account (300 emails a day on the free plan) does the sending.
//
// It listens only on StackUp's private network — no published port — and
// still requires a shared token, so nothing else on the box can send as the
// gym. No dependencies: plain Node 22.
//
//   GET  /health   {"ok":true,"configured":true}
//   POST /send     the Resend-shaped body; answers 200 when Brevo accepted it

import http from "node:http";

const PORT = Number(process.env.PORT || 8080);
const TOKEN = process.env.MAILER_TOKEN || "";
const KEY = process.env.BREVO_API_KEY || "";
// Overridable only so the tests can stand in for Brevo.
const BREVO_URL = process.env.BREVO_API_URL || "https://api.brevo.com/v3/smtp/email";
// StackUp gives up on the relay after 5 seconds; answer before it does.
const BREVO_TIMEOUT_MS = Number(process.env.BREVO_TIMEOUT_MS || 4500);
const MAX_BODY = 1024 * 1024;

const log = (...a) => console.log(new Date().toISOString(), "[mailer]", ...a);

if (!TOKEN) log("MAILER_TOKEN is not set — every send will be refused (401).");
if (!KEY) log("BREVO_API_KEY is not set — every send will be refused (503).");

/** "StackUp <no-reply@smp.co.ke>" → { name: "StackUp", email: "no-reply@smp.co.ke" } */
export function parseAddress(raw) {
  const s = String(raw ?? "").trim();
  const m = /^\s*"?([^"<]*?)"?\s*<\s*([^>\s]+@[^>\s]+)\s*>\s*$/.exec(s);
  if (m) return m[1] ? { name: m[1].trim(), email: m[2] } : { email: m[2] };
  return /^[^\s@<>]+@[^\s@<>]+$/.test(s) ? { email: s } : null;
}

/** Resend's body → Brevo's body, or an error message. */
export function toBrevo(body) {
  if (!body || typeof body !== "object") return { error: "body must be a JSON object" };
  const sender = parseAddress(body.from);
  if (!sender) return { error: `"from" is not an email address: ${JSON.stringify(body.from)}` };
  const list = Array.isArray(body.to) ? body.to : [body.to];
  const to = [];
  for (const r of list) {
    const a = parseAddress(r);
    if (!a) return { error: `"to" has something that is not an email address: ${JSON.stringify(r)}` };
    to.push(a);
  }
  if (!to.length) return { error: '"to" is empty' };
  if (!body.subject) return { error: '"subject" is missing' };
  if (!body.text && !body.html) return { error: "there is neither text nor html" };
  const out = { sender, to, subject: String(body.subject) };
  if (body.text) out.textContent = String(body.text);
  if (body.html) out.htmlContent = String(body.html);
  if (body.reply_to) {
    const r = parseAddress(Array.isArray(body.reply_to) ? body.reply_to[0] : body.reply_to);
    if (r) out.replyTo = r;
  }
  return { brevo: out };
}

const mask = (e) => String(e).replace(/^(.).*?(@.*)$/, "$1…$2");

function reply(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
}

export const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    return reply(res, 200, { ok: true, configured: Boolean(TOKEN && KEY) });
  }
  if (req.method !== "POST" || req.url !== "/send") return reply(res, 404, { error: "not found" });

  if (!TOKEN || req.headers.authorization !== `Bearer ${TOKEN}`) {
    return reply(res, 401, { error: "unauthorised" });
  }
  if (!KEY) return reply(res, 503, { error: "BREVO_API_KEY is not set" });

  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY) return reply(res, 413, { error: "too large" });
  }
  let body;
  try { body = JSON.parse(raw); } catch { return reply(res, 400, { error: "not JSON" }); }
  const t = toBrevo(body);
  if (t.error) { log("refused:", t.error); return reply(res, 400, { error: t.error }); }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), BREVO_TIMEOUT_MS);
  try {
    const r = await fetch(BREVO_URL, {
      method: "POST",
      headers: { "api-key": KEY, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(t.brevo),
      signal: ctl.signal,
    });
    const text = await r.text();
    const who = t.brevo.to.map((a) => mask(a.email)).join(", ");
    if (r.ok) {
      log(`sent → ${who}: ${t.brevo.subject}`);
      return reply(res, 200, { ok: true, id: safeJson(text)?.messageId });
    }
    // Brevo's own words, in the log where the operator will look: an
    // unverified sender, a used-up daily allowance and a wrong key all
    // look the same from StackUp's side ("relay responded 4xx").
    log(`Brevo refused (${r.status}) → ${who}: ${text.slice(0, 300)}`);
    return reply(res, r.status >= 500 ? 502 : r.status, { error: "brevo refused", status: r.status, detail: safeJson(text) ?? text.slice(0, 300) });
  } catch (e) {
    log("could not reach Brevo:", e.name === "AbortError" ? "timed out" : e.message);
    return reply(res, 504, { error: "could not reach Brevo" });
  } finally {
    clearTimeout(timer);
  }
});

function safeJson(s) { try { return JSON.parse(s); } catch { return undefined; } }

if (process.env.MAILER_NO_LISTEN !== "1") {
  server.listen(PORT, () => log(`listening on ${PORT}`));
}
