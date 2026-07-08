/* gen-landing.js — generate per-trade SEO landing pages into the repo root.
   Run: node tools/gen-landing.js   (also run by the Pages workflow so they stay fresh)
   Each page targets "<trade> POS" search intent and links straight into the builder
   pre-loaded with that trade's template (builder.html?trade=<tmpl>). Data-driven:
   add a trade to TRADES and re-run to publish a new landing page. */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const OG = 'https://custompos.org/og.png';
const ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%231f6feb'/%3E%3Crect x='9' y='9' width='14' height='14' rx='3' fill='white'/%3E%3C/svg%3E";

const TRADES = [
  { slug:'restaurant', tmpl:'bistro', name:'Restaurant', h1:'Restaurant POS',
    title:'Free Restaurant POS Software',
    kw:'restaurant POS, free restaurant POS software, restaurant point of sale, POS for restaurants, table service POS, kitchen display system, KDS, split check POS',
    sub:'A point-of-sale built for dine-in service — floor plan, coursing, kitchen display, split checks and tips — that you download and own. No subscription, no per-terminal fees.',
    feats:[['Floor plan & tables','Seat guests, track tables by section, watch turn times at a glance.'],
      ['Coursing & KDS','Fire apps, entrées and desserts in order; tickets bump on the kitchen display.'],
      ['Split the check','Evenly or by item, mixed tenders, with tip presets built in.'],
      ['Auto kitchen routing','One order fans out to the line, cold station and bar on its own.'],
      ['Tips pooled fairly','Split by hours worked and transparent to the whole team.'],
      ['Close with confidence','Z-report, labor %, and a cash-drawer count every night.']] },
  { slug:'retail', tmpl:'retail', name:'Retail Store', h1:'Retail POS',
    title:'Free Retail POS Software',
    kw:'retail POS, free retail POS software, retail point of sale, POS for small retail, inventory POS, barcode POS, gift card POS',
    sub:'Ring up stock fast, scan barcodes, track inventory, sell gift cards and reward regulars — in a POS you download once and own forever. No monthly fee.',
    feats:[['Scan & sell','Barcode scan and instant search for big catalogs.'],
      ['Live inventory','Stock counts, low/out flags and reorder points.'],
      ['Gift cards & loyalty','Sell gift cards and reward repeat customers automatically.'],
      ['Discounts & coupons','Percent or dollar off, coupon codes at the register.'],
      ['House accounts & A/R','Let trusted customers run a tab with aging.'],
      ['Own your data','Everything on your machine, exportable any time.']] },
  { slug:'salon', tmpl:'salon', name:'Salon & Spa', h1:'Salon POS',
    title:'Free Salon & Spa POS Software',
    kw:'salon POS, free salon POS software, spa POS, salon point of sale, appointment POS, commission POS, tip POS, booking software',
    sub:'Book appointments, check clients in, pay out commission and tips, and run the front desk — in a salon POS you download and own. No subscription, ever.',
    feats:[['Appointments','Book and check in clients, keep the chair full.'],
      ['Commission by stylist','Track performers and pay commission automatically.'],
      ['Tips made easy','Preset tips, pooled fairly by hours worked.'],
      ['Time clock & schedule','PIN clock-in, a weekly grid, and a worker portal.'],
      ['Client profiles','Remember "the usual" and reward loyalty.'],
      ['Retail too','Sell product alongside services from one register.']] },
  { slug:'repair-shop', tmpl:'repair', name:'Repair Shop', h1:'Repair Shop POS',
    title:'Free Repair Shop POS Software',
    kw:'repair shop POS, free repair POS software, phone repair POS, computer repair POS, repair point of sale, ticketing POS, deposit POS',
    sub:'Take intakes, quote and collect a deposit, move jobs from bench to ready, and text customers when it is done — in a repair POS you download and own.',
    feats:[['Intake to ready','Diagnose → repair → ready shelf, tracked on a job board.'],
      ['Quotes & deposits','Estimate the job and collect a deposit up front.'],
      ['Ready-to-pickup texts','Auto-text customers the moment a job is done.'],
      ['Waivers & flags','Attach data-loss waivers and condition notes per job.'],
      ['Job board','See every open ticket and how long it has been in shop.'],
      ['Own it forever','One file, your data, no lock-in or monthly bill.']] },
  { slug:'dry-cleaner', tmpl:'cleaner', name:'Dry Cleaner', h1:'Dry Cleaner POS',
    title:'Free Dry Cleaner & Laundry POS Software',
    kw:'dry cleaner POS, free dry cleaning POS software, laundry POS, dry cleaning point of sale, garment tracking POS, SPOT alternative, wash and fold POS',
    sub:'Tag garments, assemble and rack orders, promise a date, run house accounts, and text customers when it is ready — a dry-clean & laundry POS you download and own. A modern, free alternative to legacy systems.',
    feats:[['Tag → assemble → rack','Detail each piece, assemble the order, rack it for pickup.'],
      ['Promise dates','Due-date timers so nothing is late or lost.'],
      ['House accounts & A/R','Commercial accounts with aging and statements.'],
      ['Customer tracker','A sanitized status page customers can check themselves.'],
      ['Ready texts','Auto-text when an order is racked and ready.'],
      ['Built in a real plant','Battle-tested at a working two-location cleaner.']] },
  { slug:'jewelry', tmpl:'retail', name:'Jewelry Store', h1:'Jewelry Store POS',
    title:'Free Jewelry Store POS Software',
    kw:'jewelry POS, free jewelry store POS software, jewelry point of sale, jeweler POS, layaway POS, repair intake POS, high-value inventory POS',
    sub:'Sell high-value pieces, track each item, take deposits and layaway, and remember your best customers — in a jewelry POS you download and own. No subscription.',
    feats:[['Per-item tracking','Every piece scanned and tracked by barcode.'],
      ['Deposits & layaway','Take a deposit and carry a balance to close later.'],
      ['Repairs & custom work','Intake jobs, quote, and text when ready.'],
      ['Customer profiles','Remember tastes, sizes and past purchases.'],
      ['Gift cards & loyalty','Sell gift cards and reward loyal buyers.'],
      ['Your data, secured','Local-first, exportable, nothing held hostage.']] },
];

function ld(t){
  return JSON.stringify([
    { "@context":"https://schema.org","@type":"SoftwareApplication",
      "name":"customPOS — "+t.h1,"applicationCategory":"BusinessApplication",
      "applicationSubCategory":t.name+" point-of-sale software",
      "operatingSystem":"Web browser (Chrome, Windows, macOS, Linux, Android, iOS)",
      "url":"https://custompos.org/"+t.slug+".html","downloadUrl":"https://custompos.org/app.html",
      "description":t.sub,"license":"https://opensource.org/licenses/MIT","isAccessibleForFree":true,
      "offers":{"@type":"Offer","price":"0","priceCurrency":"USD"},
      "featureList":t.feats.map(f=>f[0]),
      "publisher":{"@type":"Organization","name":"customPOS","url":"https://custompos.org/"} },
    { "@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[
      {"@type":"ListItem","position":1,"name":"customPOS","item":"https://custompos.org/"},
      {"@type":"ListItem","position":2,"name":t.h1,"item":"https://custompos.org/"+t.slug+".html"} ] }
  ]);
}

const CSS = `*{box-sizing:border-box}body{margin:0;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--ink);background:var(--bg)}
:root{--brand:#1f6feb;--bg:#0f1115;--card:#1b1f28;--line:#272b33;--ink:#e6e9ef;--dim:#9aa4b2}
@media(prefers-color-scheme:light){:root{--bg:#f6f8fb;--card:#fff;--line:#e3e8ef;--ink:#12161d;--dim:#5b6675}}
a{color:var(--brand);text-decoration:none}a:hover{text-decoration:underline}
.wrap{max-width:1000px;margin:0 auto;padding:0 20px}
header.nav{position:sticky;top:0;z-index:10;backdrop-filter:blur(8px);background:color-mix(in srgb,var(--bg) 82%,transparent);border-bottom:1px solid var(--line)}
header.nav .wrap{display:flex;align-items:center;gap:14px;height:56px}
.brand{font-weight:800;letter-spacing:-.02em;font-size:18px}.brand .dot{display:inline-block;width:11px;height:11px;border-radius:3px;background:var(--brand);margin-right:8px}
.spacer{flex:1}
.btn{display:inline-block;padding:11px 18px;border-radius:10px;border:1px solid var(--line);font-weight:600;cursor:pointer;background:var(--card);color:var(--ink)}
.btn.primary{background:var(--brand);border-color:var(--brand);color:#fff}.btn.big{padding:15px 26px;font-size:17px}
.hero{padding:64px 0 34px;text-align:center}
.hero h1{font-size:clamp(32px,6vw,52px);line-height:1.06;letter-spacing:-.03em;margin:0 0 16px}
.hero h1 .g{background:linear-gradient(90deg,var(--brand),#7aa2ff);-webkit-background-clip:text;background-clip:text;color:transparent}
.hero p{font-size:clamp(17px,2.5vw,20px);color:var(--dim);max-width:660px;margin:0 auto 26px}
.cta{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
.tag{display:inline-block;font-size:12.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#2ea043;margin-bottom:14px}
section{padding:46px 0;border-top:1px solid var(--line)}
section h2{font-size:clamp(23px,4vw,31px);letter-spacing:-.02em;margin:0 0 22px;text-align:center}
.grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(260px,1fr))}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px}
.card h3{margin:0 0 6px;font-size:16.5px}.card p{margin:0;color:var(--dim);font-size:14.5px}
.pill{display:inline-block;font-size:13px;color:var(--dim);border:1px solid var(--line);border-radius:999px;padding:5px 13px;margin:4px}
.free{text-align:center;color:var(--dim);max-width:640px;margin:0 auto}
footer{padding:40px 0 60px;border-top:1px solid var(--line);color:var(--dim);font-size:14px;text-align:center}`;

function page(t){
  const feats = t.feats.map(f=>`<div class="card"><h3>${f[0]}</h3><p>${f[1]}</p></div>`).join('\n    ');
  const others = TRADES.filter(x=>x.slug!==t.slug).map(x=>`<a class="pill" href="${x.slug}.html">${x.name}</a>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t.title} — Build &amp; Own It | customPOS</title>
<meta name="description" content="${t.sub}">
<meta name="keywords" content="${t.kw}, free POS, open source POS, no subscription POS, own your POS">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
<link rel="canonical" href="https://custompos.org/${t.slug}.html">
<meta name="theme-color" content="#1f6feb">
<link rel="icon" href="${ICON}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="customPOS">
<meta property="og:url" content="https://custompos.org/${t.slug}.html">
<meta property="og:title" content="${t.title} — free, and yours to keep">
<meta property="og:description" content="${t.sub}">
<meta property="og:image" content="${OG}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${t.title} — customPOS">
<meta name="twitter:description" content="${t.sub}">
<meta name="twitter:image" content="${OG}">
<script type="application/ld+json">${ld(t)}</script>
<style>${CSS}</style>
</head>
<body>
<header class="nav"><div class="wrap">
  <a class="brand" href="/"><span class="dot"></span>customPOS</a>
  <span class="spacer"></span>
  <a href="pos.html">Live demo</a>
  <a class="btn primary" href="builder.html?trade=${t.tmpl}">Build yours</a>
</div></header>

<div class="wrap">
  <div class="hero">
    <div class="tag">Free · open source · yours to keep</div>
    <h1>${t.h1} that's <span class="g">free and yours to keep</span></h1>
    <p>${t.sub}</p>
    <div class="cta">
      <a class="btn primary big" href="builder.html?trade=${t.tmpl}">Build my ${t.name} POS</a>
      <a class="btn big" href="pos.html">See the live demo</a>
    </div>
  </div>
</div>

<section><div class="wrap">
  <h2>Built for a ${t.name.toLowerCase()}</h2>
  <div class="grid">
    ${feats}
  </div>
</div></section>

<section><div class="wrap">
  <h2>Free software, forever</h2>
  <p class="free">The software is <b>$0</b> — no subscription, no per-terminal fee, no upsell. Download one self-contained file, run it in any browser, and it keeps working even offline. Card processing (optional) is the only place we earn, and it is a fee you already pay. <a href="/">How it works →</a></p>
</div></section>

<section><div class="wrap" style="text-align:center">
  <h2>Ready to own your ${t.name.toLowerCase()} POS?</h2>
  <div class="cta"><a class="btn primary big" href="builder.html?trade=${t.tmpl}">Build my ${t.name} POS</a><a class="btn big" href="pos.html">Try the demo first</a></div>
  <div style="margin-top:26px">Other trades: ${others}</div>
</div></section>

<footer><div class="wrap">
  <p>customPOS — a free, open-source POS builder for any business. MIT-licensed.</p>
  <p style="margin-top:6px"><a href="/">Home</a> · <a href="builder.html?guided">Guided setup</a> · <a href="https://github.com/TiredofSleep/Custom-POS">Source on GitHub</a></p>
</div></footer>
</body>
</html>
`;
}

let wrote=[];
for(const t of TRADES){ const f=path.join(ROOT, t.slug+'.html'); fs.writeFileSync(f, page(t)); wrote.push(t.slug+'.html'); }
console.log('generated landing pages:', wrote.join(', '));
