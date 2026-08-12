import { readFileSync, writeFileSync } from "node:fs";
const fonts = readFileSync("fonts-inline.css", "utf8");
const base  = readFileSync("base.css", "utf8");
const qr    = JSON.parse(readFileSync("qr.json", "utf8"));

const WA = "+254 706 289 514";
const SITE = "smp-developers.com";

const lockup = (badge = "10+ yrs · 100+ projects") => `
  <div class="top">
    <div class="mark">&lt;/&gt;</div>
    <div>
      <div class="brand">~/<span class="dim">smp</span>-developers</div>
      <div class="brand-sub">SMP · SIMBONI MISIATI PETER</div>
    </div>
    ${badge ? `<div class="badge">${badge}</div>` : ""}
  </div>`;

const foot = (cta = "Message me →", extra = "") => `
  <div class="foot">
    <div class="lines">
      ${extra}
      <div><span class="k">whatsapp</span> <span class="v">${WA}</span></div>
      <div><span class="k">see the work</span> <span class="v">${SITE}</span></div>
    </div>
    <div class="cta">${cta}</div>
  </div>`;

/* ------------------------------------------------------------------ cards */
const cards = [];

/* 1 — the digital business card: the one that replaces the paper one. */
cards.push({ id: "card-01-business", w: 1080, h: 1080, html: `
  ${lockup()}
  <div style="margin-top:52px">
    <div class="kicker">// software engineer · nairobi &amp; bungoma</div>
    <h1 style="margin-top:16px;font-size:106px">Peter <span class="accent">Misiati</span></h1>
    <div style="font-size:34px;color:var(--muted);margin-top:20px;line-height:1.4">
      I build the software your organisation<br>runs on — end to end.
    </div>
  </div>
  <div style="display:flex;gap:40px;align-items:flex-end;margin-top:44px">
    <div style="flex:1">
      <div class="chips">
        <span class="chip on" style="font-size:25px">Systems &amp; ERP</span>
        <span class="chip">Websites</span>
        <span class="chip">Fintech · M-Pesa</span>
        <span class="chip">E-learning</span>
        <span class="chip">Mobile apps</span>
      </div>
      <div style="font-family:var(--mono);font-size:27px;line-height:1.8;margin-top:36px">
        <div><span style="color:var(--mint)">tel  </span><span style="color:#fff">${WA}</span></div>
        <div><span style="color:var(--mint)">mail </span><span style="color:#fff">info@smp-developers.com</span></div>
        <div><span style="color:var(--mint)">web  </span><span style="color:#fff">${SITE}</span></div>
      </div>
    </div>
    <div style="flex:none;text-align:center">
      <div style="background:#fff;border-radius:22px;padding:20px;width:272px;height:272px">
        <div style="width:232px;height:232px">${qr.wa}</div>
      </div>
      <div style="font-family:var(--mono);font-size:18px;color:var(--mint-dim);margin-top:14px;letter-spacing:.06em">
        SCAN → CHAT
      </div>
    </div>
  </div>
  <div class="foot">
    <div class="lines">
      <div><span class="k">based in</span> <span class="v">Nairobi &amp; Bungoma, Kenya</span></div>
      <div><span class="k">status</span> <span class="v">Available for freelance &amp; consulting</span></div>
    </div>
    <div class="cta">Let's talk →</div>
  </div>` });

/* 2 — the menu: what you can actually buy. Copy is the site's own. */
const services = [
  ["01", "Web apps &amp; systems", "ERP, microfinance, admin dashboards — the software your organisation runs on."],
  ["02", "Custom websites", "Fast, modern sites for business, NGO, political &amp; personal brands."],
  ["03", "Fintech &amp; M-Pesa", "SACCO systems, payments, savings &amp; investment tools with M-Pesa built in."],
  ["04", "SaaS &amp; dashboards", "Multi-tenant products and data dashboards, built to scale."],
  ["05", "E-learning &amp; LMS", "Online courses, learning platforms and training tools that teach at scale."],
  ["06", "Mobile apps &amp; consulting", "Android &amp; iOS apps, plus strategy from first idea to launch."],
];
cards.push({ id: "card-02-services", w: 1080, h: 1080, html: `
  ${lockup()}
  <div style="margin-top:40px">
    <div class="kicker">// what i build</div>
    <h1 class="sm" style="margin-top:14px">Six things, <span class="accent">done properly.</span></h1>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:24px">
    ${services.map(([n, t, d]) => `<div class="tile" style="padding:22px 26px"><div class="n">${n}</div><h3>${t}</h3><p>${d}</p></div>`).join("")}
  </div>
  ${foot("Message me →")}` });

/* 3 — proof. Every name here is a real project in the portfolio. */
cards.push({ id: "card-03-proof", w: 1080, h: 1080, html: `
  ${lockup("")}
  <div style="margin-top:46px">
    <div class="kicker">// the receipts</div>
    <h1 class="sm" style="margin-top:14px">Ten years of<br><span class="accent">shipped work.</span></h1>
  </div>
  <div style="display:flex;gap:16px;margin-top:38px">
    ${[["10+", "years building"], ["100+", "projects shipped"], ["13", "full case studies"]]
      .map(([v, l]) => `<div class="tile" style="flex:1;text-align:center;padding:28px 18px">
        <div style="font-family:var(--display);font-size:72px;font-weight:700;color:var(--mint);letter-spacing:-.03em">${v}</div>
        <div style="font-size:21px;color:var(--muted);margin-top:6px">${l}</div></div>`).join("")}
  </div>
  <div style="margin-top:34px;display:flex;flex-direction:column;gap:20px">
    ${[["NGO &amp; mission", "COSDEP Kenya · Canossian Sisters · Talitha Kum"],
       ["Business &amp; hospitality", "Zuri Place Resort · Fit Generations · Misiati &amp; Associates"],
       ["Fintech &amp; systems", "TallyPay · Naveedex · StackUp · 64 Theatre"],
       ["Public figures", "Dr. Dennis Wamalwa · Misiati MC"]]
      .map(([k, v]) => `<div>
        <div style="font-family:var(--mono);font-size:19px;color:var(--mint);letter-spacing:.1em;text-transform:uppercase">${k}</div>
        <div style="font-size:27px;color:var(--white);font-weight:600;margin-top:6px">${v}</div></div>`).join("")}
  </div>
  ${foot("See the work →")}` });

/* 4 — the freshest case study, and the most concrete: the shop system. */
cards.push({ id: "card-04-riziki", w: 1080, h: 1080, html: `
  ${lockup("case study · 2026")}
  <div style="margin-top:40px">
    <div class="kicker">// riziki industrial chemicals</div>
    <h1 class="sm" style="margin-top:14px">A whole factory,<br><span class="accent">one system.</span></h1>
    <div class="lede" style="margin-top:18px;max-width:36ch">
      Detergent mixing, repacking, stock, credit and the daily cash count — replacing paper books.
    </div>
  </div>
  <div style="display:flex;align-items:center;gap:10px;margin-top:32px;font-family:var(--mono);font-size:21px">
    ${["DELIVERY", "REPACK", "MIX", "SELL", "MONEY"].map((s, i) => `
      ${i ? `<span style="color:var(--mint)">→</span>` : ""}
      <span style="border:1.5px solid var(--line-firm);border-radius:999px;padding:10px 16px;color:${i === 3 ? "#04140c" : "var(--text)"};background:${i === 3 ? "var(--mint)" : "rgba(16,23,18,.8)"};font-weight:700">${s}</span>`).join("")}
  </div>
  <div style="display:flex;flex-direction:column;gap:18px;margin-top:32px">
    ${[["Recipes that stay secret", "Formulas are versioned and owner-only — staff never see them."],
       ["Stock that can't be fudged", "Every movement is an append-only ledger entry, not an edit."],
       ["Cash, M-Pesa and credit on one bill", "Split payments, debt limits and ageing, the way the shop already trades."],
       ["Keeps selling with no network", "The counter phone works offline and syncs when the line comes back."]]
      .map(([t, s]) => `<div class="rowitem"><div class="tick">✓</div><div><div class="t">${t}</div><div class="s">${s}</div></div></div>`).join("")}
  </div>
  ${foot("Build mine →")}` });

/* 5 — fintech credibility, straight from the TallyPay case study. */
cards.push({ id: "card-05-tallypay", w: 1080, h: 1080, html: `
  ${lockup("case study · tallypay.co.ke")}
  <div style="margin-top:44px">
    <div class="kicker">// fintech · m-pesa</div>
    <h1 class="sm" style="margin-top:14px">Get paid without<br>the <span class="accent">paperwork.</span></h1>
  </div>
  <div style="display:flex;align-items:stretch;gap:14px;margin-top:40px">
    ${[["QUOTE", "what you'll charge"], ["INVOICE", "deposit, balance, VAT"], ["RECEIPT", "issued automatically"]]
      .map(([t, s], i) => `
      ${i ? `<div style="align-self:center;color:var(--mint);font-size:40px;font-family:var(--mono)">›</div>` : ""}
      <div class="tile" style="flex:1;text-align:center">
        <div style="font-family:var(--mono);font-size:26px;font-weight:700;color:var(--mint);letter-spacing:.06em">${t}</div>
        <div style="font-size:21px;color:var(--muted);margin-top:8px">${s}</div>
      </div>`).join("")}
  </div>
  <div style="display:flex;flex-direction:column;gap:18px;margin-top:38px">
    ${[["M-Pesa collection built in", "STK push straight to the customer's phone, receipted the moment it clears."],
       ["Money handled correctly", "Integer cents and basis-point VAT, unit-tested — not floating-point guesswork."],
       ["One workspace per business", "Multi-tenant SaaS with a white-label Pro tier and an admin console."]]
      .map(([t, s]) => `<div class="rowitem"><div class="tick">✓</div><div><div class="t">${t}</div><div class="s">${s}</div></div></div>`).join("")}
  </div>
  ${foot("Talk fintech →")}` });

/* 6 — how to start. Offer terms are the ones already approved in the ad copy. */
cards.push({ id: "card-06-start", w: 1080, h: 1080, html: `
  ${lockup()}
  <div style="margin-top:40px">
    <div class="kicker">// how it works</div>
    <h1 class="sm" style="margin-top:14px">From chat to live<br>in <span class="accent">one week.</span></h1>
  </div>
  <div style="display:flex;gap:12px;margin-top:30px">
    <span class="chip on">from KES 20,000</span>
    <span class="chip">free domain + hosting · 1 year</span>
    <span class="chip">unlimited changes</span>
  </div>
  <div style="display:flex;flex-direction:column;gap:16px;margin-top:32px">
    ${[["1", "You WhatsApp me", "Tell me what the business does. No forms, no meetings to book."],
       ["2", "You get a quote and a date", "A fixed price and a delivery day, before anything starts."],
       ["3", "You watch it being built", "A live link from day one — you see progress, not promises."],
       ["4", "You get the keys", "Domain, hosting, admin dashboard and training. You own all of it."]]
      .map(([n, t, s]) => `<div class="rowitem">
        <div class="tick" style="border-radius:999px;font-family:var(--mono)">${n}</div>
        <div><div class="t">${t}</div><div class="s">${s}</div></div></div>`).join("")}
  </div>
  ${foot("Start now →")}` });

/* ------------------------------------------------------- stories (1080×1920) */
const story = (id, kicker, h1, body, cta) => ({ id, w: 1080, h: 1920, story: true, html: `
  ${lockup()}
  <div style="margin-top:120px">
    <div class="kicker" style="font-size:28px">${kicker}</div>
    <h1 style="font-size:118px;margin-top:22px">${h1}</h1>
  </div>
  <div style="margin-top:70px">${body}</div>
  <div style="margin-top:auto">
    <div class="rule"></div>
    <div style="font-family:var(--mono);font-size:30px;line-height:1.7">
      <div><span style="color:var(--mint)">whatsapp</span> <span style="color:#fff">${WA}</span></div>
      <div><span style="color:var(--mint)">see the work</span> <span style="color:#fff">${SITE}</span></div>
    </div>
    <div class="cta" style="margin:36px 0 0;display:inline-block;font-size:38px;padding:26px 46px">${cta}</div>
  </div>` });

cards.push(story("story-01-card", "// software engineer · kenya", 'Peter<br><span class="accent">Misiati</span>',
  `<div style="font-size:38px;color:var(--muted);line-height:1.45;max-width:26ch">I build the software your organisation runs on — systems, websites and fintech, shipped end to end.</div>
   <div style="display:flex;gap:44px;align-items:center;margin-top:64px">
     <div style="background:#fff;border-radius:26px;padding:22px;width:290px;height:290px"><div style="width:246px;height:246px">${qr.wa}</div></div>
     <div>
       <div style="font-family:var(--mono);font-size:26px;color:var(--mint-dim);letter-spacing:.08em">SCAN TO CHAT</div>
       <div class="chips" style="margin-top:22px;max-width:420px">
         <span class="chip" style="font-size:26px">Systems</span>
         <span class="chip" style="font-size:26px">Websites</span>
         <span class="chip" style="font-size:26px">M-Pesa</span>
         <span class="chip" style="font-size:26px">Apps</span>
       </div>
     </div>
   </div>`, "Let's talk →"));

cards.push(story("story-02-offer", "// custom business websites", 'A site that gets you <span class="accent">found.</span>',
  `<div style="display:flex;gap:14px;flex-wrap:wrap">
     <span class="chip on" style="font-size:32px;padding:16px 28px">from KES 20,000</span>
     <span class="chip" style="font-size:32px;padding:16px 28px">ready in 1 week</span>
   </div>
   <div style="display:flex;flex-direction:column;gap:26px;margin-top:56px">
     ${[["Free domain + hosting", "A full year — you own it all"],
        ["Your own dashboard", "Update the site and blog yourself"],
        ["Online booking built in", "Turn visitors into bookings"],
        ["Unlimited changes", "Until it is exactly right"]]
       .map(([t, s]) => `<div class="rowitem"><div class="tick" style="width:54px;height:54px;font-size:28px">✓</div>
         <div><div class="t" style="font-size:40px">${t}</div><div class="s" style="font-size:28px">${s}</div></div></div>`).join("")}
   </div>`, "Message me →"));

cards.push(story("story-03-riziki", "// case study", 'A whole factory, <span class="accent">one system.</span>',
  `<div style="font-size:36px;color:var(--muted);line-height:1.45;max-width:27ch">Riziki Industrial Chemicals — mixing, repacking, stock, credit and the daily cash count, off paper and into one system.</div>
   <div style="display:flex;flex-direction:column;gap:26px;margin-top:58px">
     ${[["Recipes stay secret", "Versioned formulas, owner-only"],
        ["Stock cannot be fudged", "An append-only ledger, never an edit"],
        ["Cash + M-Pesa + credit", "Split on one bill, like the shop trades"],
        ["Sells with no network", "Offline at the counter, syncs later"]]
       .map(([t, s]) => `<div class="rowitem"><div class="tick" style="width:54px;height:54px;font-size:28px">✓</div>
         <div><div class="t" style="font-size:40px">${t}</div><div class="s" style="font-size:28px">${s}</div></div></div>`).join("")}
   </div>`, "Build mine →"));

const html = `<!doctype html><meta charset="utf-8"><title>SMP cards</title>
<style>${fonts}\n${base}</style>
<body>${cards.map(c => `<div class="card${c.story ? " story" : ""}" id="${c.id}">${c.html}</div>`).join("\n")}</body>`;

writeFileSync("cards.html", html);
writeFileSync("manifest.json", JSON.stringify(cards.map(({ id, w, h }) => ({ id, w, h })), null, 1));
console.log(`cards.html written — ${cards.length} cards, ${(html.length / 1024 / 1024).toFixed(2)} MB`);
