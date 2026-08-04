#!/usr/bin/env node
/**
 * Uptime + SSL/domain-expiry monitor for every live system in the portfolio.
 *
 * Designed to run on GitHub Actions (see .github/workflows/uptime-monitor.yml).
 * It checks each site and EXITS NON-ZERO if anything is wrong — a failed
 * scheduled run makes GitHub email the repo owner, which is your alert. It also
 * writes a readable table to the Actions job summary.
 *
 * Problems it flags:
 *   • site DOWN (no HTTPS response, or a 5xx)
 *   • TLS certificate expiring within SSL_WARN_DAYS
 *   • domain registration expiring within DOMAIN_WARN_DAYS (WHOIS, best-effort)
 *
 * Runs anywhere with Node 18+. No npm dependencies. `whois` is optional (the
 * workflow installs it); without it the domain column is skipped.
 *
 * Keep SITES in sync with the `live:` links in src/lib/portfolio.ts.
 */
import https from "node:https";
import tls from "node:tls";
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const SSL_WARN_DAYS = 21;
const DOMAIN_WARN_DAYS = 30;
const TIMEOUT_MS = 15000;

const SITES = [
  "www.stackup.co.ke",
  "naveedex.com",
  "tallypay.co.ke",
  "fitgenerationsgym.com",
  "misiatiassociates.co.ke",
  "facilitator-misiati.onrender.com",
  "zuriplaceresort.com",
  "cosdepkenya.org",
  "canossiansistersneafrica.org",
  "talithakumraht.org",
  "www.commrdrdenniswamalwa.co.ke",
  "smp-developers.com",
];

const daysFromNow = (date) => Math.floor((date.getTime() - Date.now()) / 86_400_000);

/** HTTP status over HTTPS (resolves 0 on timeout / connection error). */
function httpStatus(host) {
  return new Promise((resolve) => {
    const req = https.request(
      {
        host,
        port: 443,
        method: "GET",
        path: "/",
        timeout: TIMEOUT_MS,
        headers: { "user-agent": "smp-monitor/1 (+github-actions)" },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve(0);
    });
    req.on("error", () => resolve(0));
    req.end();
  });
}

/** Days until the TLS certificate expires (null if it can't be read). */
function sslDaysLeft(host) {
  return new Promise((resolve) => {
    const socket = tls.connect(
      { host, port: 443, servername: host, timeout: TIMEOUT_MS },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        resolve(cert && cert.valid_to ? daysFromNow(new Date(cert.valid_to)) : null);
      },
    );
    socket.on("timeout", () => {
      socket.destroy();
      resolve(null);
    });
    socket.on("error", () => resolve(null));
  });
}

/** Days until domain registration expires via WHOIS (null if unavailable). */
function domainDaysLeft(host) {
  const domain = host.replace(/^www\./, "");
  try {
    const out = execFileSync("whois", [domain], { timeout: 20_000, encoding: "utf8" });
    const m = out.match(
      /(?:Registry Expiry Date|Expiry Date|Expiration Date|paid-till|Renewal date)[:\s]*([0-9T:\-/.Zz ]+)/i,
    );
    if (!m) return null;
    const d = new Date(m[1].trim());
    return Number.isNaN(d.getTime()) ? null : daysFromNow(d);
  } catch {
    return null; // whois not installed, blocked, or unparseable TLD (e.g. some .co.ke)
  }
}

const rows = [];
const problems = [];

for (const host of SITES) {
  const [code, ssl] = await Promise.all([httpStatus(host), sslDaysLeft(host)]);
  const dom = domainDaysLeft(host);

  const up = (code >= 200 && code < 400) || code === 401 || code === 403;
  if (!up) problems.push(`DOWN — ${host} (HTTP ${code || "no connection"})`);
  if (ssl !== null && ssl <= SSL_WARN_DAYS)
    problems.push(`SSL expiring — ${host} in ${ssl} day(s)`);
  if (dom !== null && dom <= DOMAIN_WARN_DAYS)
    problems.push(`DOMAIN expiring — ${host} in ${dom} day(s)`);

  rows.push({
    host,
    http: up ? `UP ${code}` : `DOWN ${code || ""}`.trim(),
    ssl: ssl ?? "?",
    dom: dom ?? "n/a",
  });
}

// Human-readable table to the console / Actions log.
const line = (a, b, c, d) =>
  console.log(`${a.padEnd(34)} ${String(b).padEnd(14)} ${String(c).padEnd(9)} ${d}`);
console.log("");
line("DOMAIN", "HTTP", "SSL(d)", "DOMAIN(d)");
console.log("-".repeat(72));
for (const r of rows) line(r.host, r.http, r.ssl, r.dom);
console.log("");

// Rich table in the GitHub Actions job summary.
if (process.env.GITHUB_STEP_SUMMARY) {
  let md = "## Uptime & expiry monitor\n\n";
  md += problems.length
    ? `### 🔴 ${problems.length} problem(s) detected\n${problems.map((p) => `- ${p}`).join("\n")}\n\n`
    : `### ✅ All ${rows.length} systems healthy\n\n`;
  md += "| Domain | HTTP | SSL days | Domain days |\n|---|---|---|---|\n";
  md += rows.map((r) => `| ${r.host} | ${r.http} | ${r.ssl} | ${r.dom} |`).join("\n") + "\n";
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s) detected — failing the run to trigger an alert:`);
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}
console.log(`All ${rows.length} systems healthy.`);
