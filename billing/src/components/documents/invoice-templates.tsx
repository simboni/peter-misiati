/* eslint-disable @next/next/no-img-element */
import { formatMoney, formatQty, formatRate } from "@/server/money";
import { fmtDate } from "@/server/queries";
import { isPro } from "@/lib/plan";
import { DEFAULT_TEMPLATE, DEFAULT_ACCENT } from "@/lib/doc-style";
import type { Invoice, InvoiceLine, Client, OrgProfile } from "@/server/db/schema";

type Issuer = { name: string; profile: OrgProfile | null };

const cssVar = (accent: string) => ({ ["--ac"]: accent }) as React.CSSProperties;

function buildVM(issuer: Issuer, invoice: Invoice, lines: InvoiceLine[], client: Client | null, payUrl?: string | null) {
  const p = issuer.profile;
  const cur = invoice.currency;
  // Custom look (logo, template, accent) is a Pro feature. On the free plan the
  // document renders the default Tally look and carries a "Powered by Tally" mark.
  const pro = isPro(p?.plan);
  return {
    poweredByTally: !pro,
    accent: pro ? p?.accentColor || DEFAULT_ACCENT : DEFAULT_ACCENT,
    template: pro ? p?.invoiceTemplate || DEFAULT_TEMPLATE : DEFAULT_TEMPLATE,
    issuerName: p?.legalName || issuer.name,
    tradeName: issuer.name,
    issuerAddr: [p?.addressLine1, p?.addressLine2, [p?.city, p?.country].filter(Boolean).join(", "), p?.phone, p?.email].filter(Boolean) as string[],
    kraPin: p?.kraPin || null,
    logoUrl: pro ? p?.logoUrl || null : null,
    bank: p?.bankDetails || null,
    footer: invoice.notes || invoice.terms || p?.invoiceFooter || null,
    isQuote: invoice.type === "quotation",
    title: invoice.type === "quotation" ? "Quotation" : "Invoice",
    number: invoice.number,
    issue: fmtDate(invoice.issueDate),
    due: fmtDate(invoice.dueDate),
    status: invoice.status,
    client,
    cur,
    lines: lines.map((l) => ({
      description: l.description,
      qty: formatQty(l.quantityMilli),
      unit: formatMoney(l.unitPrice, cur),
      vat: formatRate(l.taxRateBps),
      amount: formatMoney(l.lineSubtotal, cur),
    })),
    subtotal: formatMoney(invoice.subtotal, cur),
    discount: invoice.discountAmount > 0 ? formatMoney(invoice.discountAmount, cur) : null,
    vat: formatMoney(invoice.taxTotal, cur),
    total: formatMoney(invoice.total, cur),
    deposit: !invoice.type.includes("quot") && invoice.depositAmount > 0 ? formatMoney(invoice.depositAmount, cur) : null,
    amountPaid: !invoice.type.includes("quot") && invoice.amountPaid > 0 ? formatMoney(invoice.amountPaid, cur) : null,
    balance: !invoice.type.includes("quot") ? formatMoney(invoice.balanceDue, cur) : null,
    payUrl: payUrl || null,
  };
}
type VM = ReturnType<typeof buildVM>;

function ClientBlock({ vm }: { vm: VM }) {
  const c = vm.client;
  return (
    <>
      <p className="iv-name">{c?.name ?? "—"}</p>
      {c?.addressLine1 && <p>{c.addressLine1}</p>}
      {c?.city && <p>{c.city}</p>}
      {c?.email && <p>{c.email}</p>}
      {c?.kraPin && <p>KRA PIN: {c.kraPin}</p>}
    </>
  );
}

function LineRows({ vm, cols = 4 }: { vm: VM; cols?: number }) {
  return (
    <>
      {vm.lines.map((l, i) => (
        <tr key={i}>
          <td>{l.description}</td>
          {cols >= 4 && <td className="r num">{l.qty}</td>}
          {cols >= 3 && <td className="r num">{l.unit}</td>}
          {cols >= 4 && <td className="r num">{l.vat}%</td>}
          <td className="r num">{l.amount}</td>
        </tr>
      ))}
    </>
  );
}

function PayLink({ vm }: { vm: VM }) {
  if (!vm.payUrl) return null;
  return (
    <div className="iv-pay print-only">
      <a href={vm.payUrl} className="iv-paybtn">
        Pay this invoice online →
      </a>
      <span className="iv-payurl">{vm.payUrl}</span>
    </div>
  );
}

function Totals({ vm }: { vm: VM }) {
  return (
    <>
      <div className="row"><span>Subtotal</span><span className="num">{vm.subtotal}</span></div>
      {vm.discount && <div className="row"><span>Discount</span><span className="num">− {vm.discount}</span></div>}
      <div className="row"><span>VAT</span><span className="num">{vm.vat}</span></div>
      <div className="row grand"><span>Total ({vm.cur})</span><span className="num">{vm.total}</span></div>
      {vm.amountPaid && <div className="row"><span>Paid</span><span className="num">{vm.amountPaid}</span></div>}
      {vm.balance && <div className="row bal"><span>Balance due</span><span className="num">{vm.balance}</span></div>}
    </>
  );
}

// ---------------------------------------------------------------- templates ---
function Aria({ vm }: { vm: VM }) {
  return (
    <div className="iv-doc aria" style={cssVar(vm.accent)}>
      <div className="top">
        <div>
          <div className="brand">
            {vm.logoUrl ? <img src={vm.logoUrl} alt="" /> : null}
            <b>{vm.issuerName}</b>
          </div>
          <div className="lbl mt">{vm.isQuote ? "Quotation for" : "Billed to"}</div>
          <ClientBlock vm={vm} />
        </div>
        <div className="r">
          <div className="big">{vm.title}</div>
          <div className="meta">
            <div className="num">{vm.number}</div>
            <div>Issued {vm.issue}</div>
            {!vm.isQuote && <div>Due {vm.due}</div>}
          </div>
        </div>
      </div>
      <table>
        <thead><tr><th className="lbl">Description</th><th className="lbl r">Qty</th><th className="lbl r">Price</th><th className="lbl r">VAT</th><th className="lbl r">Amount</th></tr></thead>
        <tbody><LineRows vm={vm} /></tbody>
      </table>
      <div className="tot"><Totals vm={vm} />{vm.deposit && <div className="row dep"><span>Deposit due now</span><span className="num">{vm.deposit}</span></div>}</div>
      <Footer vm={vm} />
      <PayLink vm={vm} />
    </div>
  );
}

function Meridian({ vm }: { vm: VM }) {
  return (
    <div className="iv-doc meridian" style={cssVar(vm.accent)}>
      <div className="band">
        <div>
          <div className="brand">{vm.logoUrl ? <img src={vm.logoUrl} alt="" /> : null}<b>{vm.issuerName}</b></div>
          <div className="sub">{[vm.issuerAddr[0], vm.kraPin ? `KRA PIN ${vm.kraPin}` : null].filter(Boolean).join(" · ")}</div>
        </div>
        <div className="r"><div className="big">{vm.title.toUpperCase()}</div><div className="num">{vm.number}</div></div>
      </div>
      <div className="body">
        <div className="parties">
          <div><div className="lbl">{vm.isQuote ? "Quotation for" : "Bill to"}</div><ClientBlock vm={vm} /></div>
          <div><div className="lbl">Dates</div><p>Issued <b>{vm.issue}</b></p>{!vm.isQuote && <p>Due <b>{vm.due}</b></p>}</div>
        </div>
        <table>
          <thead><tr><th>Description</th><th className="r">Qty</th><th className="r">Price</th><th className="r">VAT</th><th className="r">Amount</th></tr></thead>
          <tbody><LineRows vm={vm} /></tbody>
        </table>
        <div className="tot"><Totals vm={vm} /></div>
        <Footer vm={vm} />
        <PayLink vm={vm} />
      </div>
    </div>
  );
}

function Vertex({ vm }: { vm: VM }) {
  return (
    <div className="iv-doc vertex" style={cssVar(vm.accent)}>
      <div className="hero">
        <div className="top">
          <div className="brand">{vm.logoUrl ? <img src={vm.logoUrl} alt="" /> : null}<b>{vm.issuerName}</b></div>
          <div className="r"><div className="big">{vm.title.toUpperCase()}</div><div className="num">{vm.number}</div></div>
        </div>
        <div className="meta">
          <div><span>{vm.isQuote ? "Quotation for" : "Billed to"}</span><b>{vm.client?.name ?? "—"}</b></div>
          <div><span>Issued</span><b>{vm.issue}</b></div>
          {!vm.isQuote && <div><span>Due</span><b>{vm.due}</b></div>}
        </div>
      </div>
      <div className="body">
        <table>
          <thead><tr><th className="lbl">Description</th><th className="lbl r">Qty</th><th className="lbl r">Price</th><th className="lbl r">VAT</th><th className="lbl r">Amount</th></tr></thead>
          <tbody><LineRows vm={vm} /></tbody>
        </table>
        <div className="split">
          {vm.deposit ? <div className="chip"><span className="lbl">Deposit due now</span><span className="num">{vm.deposit}</span></div> : <span />}
          <div className="tot"><Totals vm={vm} /></div>
        </div>
        <Footer vm={vm} />
        <PayLink vm={vm} />
      </div>
    </div>
  );
}

function Column({ vm }: { vm: VM }) {
  return (
    <div className="iv-doc column" style={cssVar(vm.accent)}>
      <div className="side">
        <div className="brand">{vm.logoUrl ? <img src={vm.logoUrl} alt="" /> : null}<b>{vm.tradeName}</b></div>
        <h4>{vm.title}</h4>
        <div className="num">{vm.number}</div>
        <div className="blk"><div className="lbl">{vm.isQuote ? "Quotation for" : "Billed to"}</div><ClientBlock vm={vm} /></div>
        <div className="blk"><div className="lbl">Dates</div><p>Issued {vm.issue}</p>{!vm.isQuote && <p>Due {vm.due}</p>}</div>
        <div className="tot"><Totals vm={vm} /></div>
      </div>
      <div className="main">
        <p className="iss">{vm.issuerName}</p>
        {vm.kraPin && <p className="muted">KRA PIN {vm.kraPin}</p>}
        <table>
          <thead><tr><th className="lbl">Description</th><th className="lbl r">Qty</th><th className="lbl r">Amount</th></tr></thead>
          <tbody>{vm.lines.map((l, i) => (<tr key={i}><td>{l.description}</td><td className="r num">{l.qty}</td><td className="r num">{l.amount}</td></tr>))}</tbody>
        </table>
        <Footer vm={vm} />
        <PayLink vm={vm} />
      </div>
    </div>
  );
}

function Boutique({ vm }: { vm: VM }) {
  return (
    <div className="iv-doc boutique" style={cssVar(vm.accent)}>
      <div className="top">
        <div className="brand">{vm.issuerName.toUpperCase()}</div>
        <div className="big">{vm.title}</div>
        <div className="rule" />
      </div>
      <div className="meta">
        <div><div className="lbl">{vm.isQuote ? "Quotation for" : "Billed to"}</div><ClientBlock vm={vm} /></div>
        <div className="r"><div className="lbl">No.</div><div className="num">{vm.number}</div>{!vm.isQuote && <div>Due {vm.due}</div>}</div>
      </div>
      <table>
        <thead><tr><th>Description</th><th className="r">Qty</th><th className="r">Amount</th></tr></thead>
        <tbody>{vm.lines.map((l, i) => (<tr key={i}><td>{l.description}</td><td className="r num">{l.qty}</td><td className="r num">{l.amount}</td></tr>))}</tbody>
      </table>
      <div className="tot"><Totals vm={vm} /></div>
      <Footer vm={vm} center />
      <PayLink vm={vm} />
    </div>
  );
}

function Footer({ vm, center }: { vm: VM; center?: boolean }) {
  if (!vm.bank && !vm.footer && !vm.kraPin) return null;
  return (
    <div className={`iv-foot${center ? " c" : ""}`}>
      {vm.bank && (<><span className="lbl">Payment details</span><p className="pre">{vm.bank}</p></>)}
      {vm.footer && <p>{vm.footer}</p>}
      {vm.kraPin && !center && <p className="muted">KRA PIN: {vm.kraPin}</p>}
    </div>
  );
}

const DOC_CSS = `
.iv-doc{max-width:820px;margin:0 auto;background:#fff;color:#0f172a;font-size:13px;line-height:1.5;
  font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.iv-doc .num{font-variant-numeric:tabular-nums;font-family:ui-monospace,Menlo,Consolas,monospace}
.iv-doc .lbl{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#94a3b8;font-weight:700}
.iv-doc .r{text-align:right}.iv-doc .mt{margin-top:20px}
.iv-doc .brand{display:flex;align-items:center;gap:9px;font-weight:800;font-size:16px}
.iv-doc .brand img{width:34px;height:34px;object-fit:contain;border-radius:6px}
.iv-doc .iv-name{font-weight:800;margin:3px 0 0}
.iv-doc table{width:100%;border-collapse:collapse}
.iv-doc .tot .row{display:flex;justify-content:space-between;padding:5px 0;color:#475569}
.iv-doc .tot .grand{border-top:2px solid #0f172a;margin-top:6px;padding-top:9px;color:#0f172a;font-weight:800;font-size:17px}
.iv-doc .tot .grand .num{color:var(--ac)}
.iv-doc .tot .bal{font-weight:700;color:#0f172a}.iv-doc .tot .bal .num{color:var(--ac)}
.iv-doc .tot .dep{color:var(--ac);font-weight:600}
.iv-foot{margin-top:26px;padding-top:16px;border-top:1px solid #eef2f7;color:#64748b;font-size:11px}
.iv-foot .pre{white-space:pre-line;margin:3px 0 8px}.iv-foot.c{border:none;text-align:center;font-style:italic}
.iv-pay{margin-top:22px}
.iv-paybtn{display:inline-block;background:var(--ac);color:#fff;text-decoration:none;font-weight:700;padding:11px 20px;border-radius:9px;font-size:13px}
.iv-payurl{display:block;margin-top:6px;color:#94a3b8;font-size:11px}

/* Aria */
.iv-doc.aria{padding:44px 44px 36px}
.aria .top{display:flex;justify-content:space-between;align-items:flex-start;gap:24px}
.aria .big{font-size:34px;font-weight:800;letter-spacing:-.03em}
.aria .meta{margin-top:8px;color:#64748b;text-align:right}.aria .meta .num{color:#0f172a;font-weight:600}
.aria table{margin-top:30px}
.aria thead th{border-bottom:1px solid #e2e8f0;padding:11px 0;text-align:left}
.aria tbody td{padding:11px 0;border-bottom:1px solid #f1f5f9}
.aria .tot{margin:18px 0 0 auto;width:56%}

/* Meridian */
.iv-doc.meridian{padding:0}
.meridian .band{padding:30px 44px;border-bottom:3px solid var(--ac);display:flex;justify-content:space-between;align-items:flex-start;gap:20px}
.meridian .sub{color:#64748b;margin-top:6px;font-size:12px}
.meridian .big{font-size:26px;font-weight:800;color:var(--ac);letter-spacing:.02em}
.meridian .band .num{color:#64748b;text-align:right}
.meridian .body{padding:26px 44px 34px}
.meridian .parties{display:flex;gap:18px}
.meridian .parties>div{flex:1;background:#f8fafc;border:1px solid #eef2f7;border-radius:9px;padding:14px 16px}
.meridian table{margin-top:20px}
.meridian thead th{background:color-mix(in srgb,var(--ac) 10%,#fff);color:#334155;padding:10px 14px;text-align:left;font-size:10px;letter-spacing:.08em;text-transform:uppercase}
.meridian tbody td{padding:11px 14px;border-bottom:1px solid #eef2f7}
.meridian .tot{margin:18px 0 0 auto;width:52%;border:1px solid #eef2f7;border-radius:9px;overflow:hidden}
.meridian .tot .row{padding:8px 14px}
.meridian .tot .grand{background:var(--ac);color:#fff;margin:0;border:none;padding:11px 14px;font-size:15px}
.meridian .tot .grand .num{color:#fff}

/* Vertex */
.iv-doc.vertex{padding:0}
.vertex .hero{background:var(--ac);color:#fff;padding:32px 44px}
.vertex .hero .top{display:flex;justify-content:space-between;align-items:flex-start}
.vertex .hero .brand{color:#fff}
.vertex .big{font-size:30px;font-weight:800;letter-spacing:-.02em}
.vertex .hero .num{color:rgba(255,255,255,.75);text-align:right}
.vertex .hero .meta{margin-top:18px;display:flex;gap:34px}
.vertex .hero .meta span{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.7)}
.vertex .hero .meta b{display:block;font-size:13px;margin-top:2px}
.vertex .body{padding:26px 44px 34px}
.vertex thead th{border-bottom:1px solid #e2e8f0;padding:11px 0;text-align:left}
.vertex tbody td{padding:11px 0;border-bottom:1px solid #f1f5f9}
.vertex .split{display:flex;justify-content:space-between;align-items:flex-end;gap:20px;margin-top:18px}
.vertex .chip{background:color-mix(in srgb,var(--ac) 12%,#fff);border-radius:10px;padding:12px 16px}
.vertex .chip .lbl{color:var(--ac)}.vertex .chip .num{color:var(--ac);font-weight:800;font-size:17px;display:block;margin-top:3px}
.vertex .tot{width:50%}

/* Column */
.iv-doc.column{display:flex;padding:0;min-height:0}
.column .side{width:37%;background:var(--ac);color:#fff;padding:32px 24px;display:flex;flex-direction:column}
.column .side .brand{color:#fff}.column .side .brand img{background:rgba(255,255,255,.15)}
.column .side h4{margin:22px 0 0;font-size:24px;letter-spacing:-.02em}
.column .side .num{opacity:.9}
.column .side .lbl{color:rgba(255,255,255,.7)}
.column .side .blk{margin-top:18px}.column .side .iv-name{font-weight:700}
.column .side .tot{margin-top:auto;padding-top:20px}
.column .side .tot .row{color:rgba(255,255,255,.9);padding:4px 0}
.column .side .tot .grand{border-top:1px solid rgba(255,255,255,.3);color:#fff;font-size:16px}
.column .side .tot .grand .num,.column .side .tot .bal .num{color:#fff}
.column .main{flex:1;padding:32px 30px;display:flex;flex-direction:column}
.column .main .iss{font-weight:800}.column .main .muted{color:#64748b}
.column table{margin-top:20px}
.column thead th{border-bottom:1px solid #e2e8f0;padding:10px 0;text-align:left}
.column tbody td{padding:10px 0;border-bottom:1px solid #f1f5f9}

/* Boutique */
.iv-doc.boutique{padding:44px 48px 34px;font-family:ui-serif,Georgia,"Times New Roman",serif;color:#1c1917}
.boutique .top{text-align:center;border-bottom:1px solid #e7e2da;padding-bottom:20px}
.boutique .brand{justify-content:center;font-weight:700;font-size:14px;letter-spacing:.05em}
.boutique .big{font-size:34px;font-weight:400;letter-spacing:.16em;text-transform:uppercase;margin-top:8px}
.boutique .rule{width:46px;height:2px;background:var(--ac);margin:11px auto 0}
.boutique .meta{display:flex;justify-content:space-between;margin-top:22px;font-family:ui-sans-serif,system-ui,Arial;color:#57534e}
.boutique table{margin-top:18px;font-family:ui-sans-serif,system-ui,Arial}
.boutique thead th{border-bottom:1px solid #1c1917;padding:9px 0;text-align:left;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#57534e}
.boutique tbody td{padding:11px 0;border-bottom:1px solid #efeae2}
.boutique .tot{margin:16px 0 0 auto;width:50%;font-family:ui-sans-serif,system-ui,Arial}
.boutique .tot .grand{border-top:1px solid var(--ac);color:#1c1917}
.boutique .iv-foot{font-family:ui-sans-serif,system-ui,Arial}

/* Powered by Tally (free plan) */
.iv-tally{max-width:820px;margin:10px auto 0;display:flex;align-items:center;justify-content:center;gap:7px;
  color:#94a3b8;font-size:11px;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
.iv-tally svg{display:block}
.iv-tally b{color:#0f172a;font-weight:800;letter-spacing:-.01em}
.iv-tally b i{color:#059669;font-style:normal}
`;

function PoweredByTally() {
  return (
    <div className="iv-tally">
      <svg width="16" height="16" viewBox="0 0 64 64" aria-hidden>
        <rect width="64" height="64" rx="17" fill="#059669" />
        <g fill="none" stroke="#fff" strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="20" y1="22" x2="20" y2="42" />
          <line x1="29" y1="22" x2="29" y2="42" />
          <path d="M36 34 L43 42 L52 22" />
        </g>
      </svg>
      <span>Powered by <b>Tally<i>Pay</i></b> — free invoicing for Kenya</span>
    </div>
  );
}

export function InvoiceDocument(props: {
  issuer: Issuer;
  invoice: Invoice;
  lines: InvoiceLine[];
  client: Client | null;
  payUrl?: string | null;
}) {
  const vm = buildVM(props.issuer, props.invoice, props.lines, props.client, props.payUrl);
  const T =
    vm.template === "aria" ? Aria
    : vm.template === "meridian" ? Meridian
    : vm.template === "vertex" ? Vertex
    : vm.template === "boutique" ? Boutique
    : Column;
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: DOC_CSS }} />
      <T vm={vm} />
      {vm.poweredByTally && <PoweredByTally />}
    </>
  );
}
