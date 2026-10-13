/* claude-spotlight.js — the "Built with Claude" page (built-with-claude.html) and its spotlight band on the home page
   tell the truth, link only to things that exist, and carry nothing private.
   1. The page loads over http with 0 console / page errors; title, description, canonical, OG/Twitter and a WebPage
      block are set; the FAQ structured data is the visible FAQ word for word (with a negative control: change one
      visible answer and the comparison must fail).
   2. Every internal link on the page and on the home page's band resolves to a file in the repo that the Pages
      workflow publishes (a page not on its copy list 404s live), and every #anchor names an element that exists.
   3. The line "Claude is made by Anthropic. customPOS is independent and not affiliated with Anthropic." is on the
      page and on the home page; no image or inline SVG on the page (no logos).
   4. PII guard over the page and the band: no phone-shaped number, no e-mail except example.com, no ticket- or
      tag-shaped number, no IP-shaped number (which also catches any hostname built from an IP), none of the listed
      words. Words that would point at the shop's own systems are NOT written in this public file, not even hashed
      (a hash of a short word can be reversed by guessing): a machine that has them keeps them, one per line, in
      tests/private-words.local.txt, which .gitignore keeps out of git, and the guard adds them when the file is there.
      Negative control: the same guard flags a planted fake phone, e-mail, ticket, tag, IP and word.
   5. The numbers agree with each other: the day-by-day chart sums to the commit count, and the home page's band
      shows the same figures as the page.
   6. No sideways scroll at 320px or 360px. The owner's request is always shown; Claude's lines wait, hidden, while the
      terminal is below the fold, and animate in once it is scrolled into view; with reduced motion they are all visible
      at once and never hidden.
   7. Found: in the sitemap, on the Pages copy list, in the footer of every trade page and of single-pc.html. */
'use strict';
const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path');
const WIN_CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const EXE = process.env.CHROMIUM_EXE || (fs.existsSync(WIN_CHROME) ? WIN_CHROME : '/opt/pw-browsers/chromium-1194/chrome-linux/chrome');
const ROOT = path.resolve(__dirname, '..');
const PAGE = 'built-with-claude.html';
const LINE = 'Claude is made by Anthropic. customPOS is independent and not affiliated with Anthropic.';
const TRADES = ['restaurant', 'retail', 'salon', 'repair-shop', 'dry-cleaner', 'jewelry'];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.xml': 'application/xml', '.md': 'text/markdown' };

/* words that must never reach a public page. Only words that are already public in this repo are written here, plus a
   made-up control word ("planted-host-word") that the negative control plants. Anything that would point at the shop's own
   systems lives only in tests/private-words.local.txt (git-ignored), never in this file. */
const FORBIDDEN = ['hub.env', '/opt/', 'merchid', 'planted-host-word'];
const LOCAL_WORDS_FILE = path.join(__dirname, 'private-words.local.txt');
const LOCAL_WORDS = fs.existsSync(LOCAL_WORDS_FILE)
  ? fs.readFileSync(LOCAL_WORDS_FILE, 'utf8').split(/\r?\n/).map(w => w.trim().toLowerCase()).filter(w => w && !w.startsWith('#'))
  : [];
function piiGuard(text) {
  const hits = [];
  const phone = text.match(/(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g); if (phone) hits.push('phone: ' + phone.join(', '));
  const mails = (text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).filter(m => !/@example\.com$/i.test(m)); if (mails.length) hits.push('email: ' + mails.join(', '));
  const ticket = text.match(/\b\d-\d{2}-\d{2}-\d{2}-\d{4}\b/g); if (ticket) hits.push('ticket-shaped: ' + ticket.join(', '));
  const longnum = text.match(/(?<![\d#%])\d{7,}(?!\d)/g); if (longnum) hits.push('tag-shaped number: ' + longnum.join(', '));
  const ip = text.match(/\b\d{1,3}(?:[.-]\d{1,3}){3}\b/g); if (ip) hits.push('IP-shaped: ' + ip.join(', '));
  const low = text.toLowerCase();
  for (const w of FORBIDDEN) if (low.includes(w)) hits.push('forbidden word: ' + w);
  LOCAL_WORDS.forEach((w, i) => { if (low.includes(w)) hits.push('a word from the local private list (line ' + (i + 1) + ')'); });
  return hits;
}

/* the files the Pages workflow copies into the published site */
function published() {
  const yml = fs.readFileSync(path.join(ROOT, '.github/workflows/pages.yml'), 'utf8');
  const set = new Set(['app.html', 'index.html']);
  for (const line of yml.split(/\r?\n/)) {
    const m = line.trim().match(/^cp\s+(.+)$/); if (!m) continue;
    for (const tok of m[1].split(/\s+/)) if (/\.(html|png|md|xml|txt)$/.test(tok) || tok === 'single-pc/LICENSE') set.add(tok);
  }
  return set;
}

function serve() {
  return new Promise(r => {
    const s = http.createServer((rq, rs) => {
      let u = decodeURIComponent(rq.url.split('?')[0].split('#')[0]); if (u === '/') u = '/index.html';
      const f = path.join(ROOT, u);
      if (!f.startsWith(ROOT)) { rs.statusCode = 403; return rs.end(); }
      fs.readFile(f, (e, b) => { if (e) { rs.statusCode = 404; return rs.end('nf'); } rs.setHeader('Content-Type', TYPES[path.extname(f)] || 'application/octet-stream'); rs.end(b); });
    });
    s.listen(0, '127.0.0.1', () => r(s));
  });
}

/* read a page's links, FAQ, JSON-LD, stats and text, from inside the browser */
const READ = (scope) => {
  const norm = s => String(s || '').replace(/\s+/g, ' ').trim();
  const root = scope ? document.querySelector(scope) : document;
  const blocks = [...document.querySelectorAll('script[type="application/ld+json"]')].map(s => JSON.parse(s.textContent));
  const flat = blocks.flatMap(x => Array.isArray(x) ? x : [x]);
  const faq = flat.find(x => x['@type'] === 'FAQPage');
  const ld = faq ? faq.mainEntity.map(q => [norm(q.name), norm(q.acceptedAnswer.text)]) : [];
  const vis = [...document.querySelectorAll('.faq details')].map(d => [norm(d.querySelector('summary').textContent), norm(d.querySelector('p').textContent)]);
  const links = root ? [...root.querySelectorAll('a[href]')].map(a => a.getAttribute('href')) : [];
  const ids = [...document.querySelectorAll('[id]')].map(e => e.id);
  const stats = {}; if (root) root.querySelectorAll('[data-stat]').forEach(e => { const v = e.querySelector('.val, dt'); stats[e.dataset.stat] = (norm(v && v.textContent).match(/\d[\d,]*/g) || []).join('|'); });
  const bars = [...document.querySelectorAll('.bars .bar')].map(b => Number(getComputedStyle(b).getPropertyValue('--v')));
  return {
    ld, vis, links, ids, stats, bars, types: flat.map(x => x['@type']),
    title: document.title, desc: (document.querySelector('meta[name=description]') || {}).content || '',
    canonical: (document.querySelector('link[rel=canonical]') || {}).href || '',
    og: !!document.querySelector('meta[property="og:title"]') && !!document.querySelector('meta[property="og:image"]') && !!document.querySelector('meta[name="twitter:card"]'),
    text: norm(document.body.innerText), html: root ? root.outerHTML || document.documentElement.outerHTML : '',
    imgs: document.querySelectorAll('img').length, svgs: document.querySelectorAll('svg').length
  };
};

(async () => {
  const server = await serve(); const port = server.address().port; const base = `http://127.0.0.1:${port}/`;
  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
  const errors = [];
  const open = async (url, opts = {}) => {
    const ctx = await b.newContext(Object.assign({ viewport: { width: 1280, height: 900 } }, opts));
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(url + ': ' + m.text()); });
    p.on('pageerror', e => errors.push(url + ': pageerror: ' + e.message));
    await p.goto(url); return { ctx, p };
  };

  /* 1 — the page */
  const { ctx, p } = await open(base + PAGE);
  const P = await p.evaluate(READ, null);
  const pageHtml = fs.readFileSync(path.join(ROOT, PAGE), 'utf8');
  const faqSame = P.ld.length >= 6 && JSON.stringify(P.ld) === JSON.stringify(P.vis);
  /* negative control: one changed word in a visible answer must break the match */
  await p.evaluate(() => { const el = document.querySelector('.faq details p'); el.textContent = el.textContent.replace('Yes.', 'Maybe.'); });
  const P2 = await p.evaluate(READ, null);
  const faqControl = JSON.stringify(P2.ld) !== JSON.stringify(P2.vis);

  /* 6 — phone widths */
  const widths = {};
  for (const w of [320, 360]) { await p.setViewportSize({ width: w, height: 780 }); widths[w] = await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1); }
  await ctx.close();
  const LINES = () => [...document.querySelectorAll('.convo .hand, .term .ln')].map(l => ({ o: getComputedStyle(l).opacity, a: getComputedStyle(l).animationName }));
  const BUBBLE = () => getComputedStyle(document.querySelector('.convo .bubble')).opacity === '1';
  const rm = await open(base + PAGE, { reducedMotion: 'reduce' });
  const reduced = (await rm.p.evaluate(LINES)).every(l => l.o === '1' && l.a === 'none') && await rm.p.evaluate(BUBBLE);
  await rm.ctx.close();
  /* a short window, so the visual starts below the fold: the lines wait hidden and are not animating yet */
  const mo = await open(base + PAGE, { reducedMotion: 'no-preference', viewport: { width: 1280, height: 480 } });
  await mo.p.waitForTimeout(400);
  const before = await mo.p.evaluate(LINES);
  const waits = before.length === 5 && before.every(l => l.o === '0' && l.a === 'none') && await mo.p.evaluate(BUBBLE);
  await mo.p.evaluate(() => document.querySelector('.convo').scrollIntoView({ block: 'center' }));
  await mo.p.waitForFunction(() => document.querySelector('.convo').classList.contains('play'), null, { timeout: 3000 }).catch(() => {});
  const playing = (await mo.p.evaluate(LINES)).filter(l => l.a === 'rise').length === 4;
  await mo.p.waitForTimeout(3600);
  const shown = (await mo.p.evaluate(LINES)).every(l => l.o === '1');
  await mo.ctx.close();
  const animated = waits && playing && shown;

  /* the home page's band */
  const home = await open(base);
  const H = await home.p.evaluate(READ, 'section.spot');
  const homeAll = await home.p.evaluate(READ, null);
  await home.p.setViewportSize({ width: 320, height: 780 });
  const home320 = await home.p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  await home.ctx.close();
  await b.close(); server.close();

  /* 2 — links */
  const pub = published();
  const bad = [];
  const check = (href, ids, where) => {
    if (/^(https?:|mailto:|tel:)/i.test(href)) { if (/^https?:\/\/(127\.|localhost)/i.test(href)) bad.push(where + ' local link ' + href); return; }
    if (href.startsWith('#')) { if (!ids.includes(href.slice(1))) bad.push(where + ' missing anchor ' + href); return; }
    let f = href.split('#')[0].split('?')[0].replace(/^\//, ''); if (f === '') f = 'index.html';
    if (!fs.existsSync(path.join(ROOT, f))) bad.push(where + ' no such file ' + href);
    else if (!pub.has(f)) bad.push(where + ' not published by pages.yml ' + href);
  };
  P.links.forEach(h => check(h, P.ids, PAGE));
  homeAll.links.forEach(h => check(h, homeAll.ids, 'index.html'));
  /* negative control: the checker must flag a missing file, a missing anchor and an unpublished file */
  const realBad = bad.length;
  check('no-such-page.html', [], 'control'); check('#no-such-anchor', [], 'control'); check('run-tests.js', [], 'control');
  const linkControl = bad.length - realBad === 3; bad.length = realBad;

  /* 4 — PII guard, and its negative control */
  const piiPage = piiGuard(pageHtml);
  const piiBand = piiGuard(H.html);
  const planted = piiGuard('call (501) 555-0100 or write to someone@mail.invalid; served from a planted-host-word at 192.0.2.7; tag 12345678; ticket 9-99-99-99-9999');
  const piiControl = ['phone:', 'email:', 'ticket-shaped:', 'tag-shaped', 'IP-shaped:', 'forbidden word: planted-host-word'].every(k => planted.some(h => h.includes(k)));
  /* and, when this machine has the local list, its first word planted in text must be flagged (the word itself is never printed) */
  const localControl = LOCAL_WORDS.length === 0 || piiGuard('served from ' + LOCAL_WORDS[0] + ' tonight').some(h => h.includes('local private list'));

  /* 5 — the numbers agree */
  const barSum = P.bars.reduce((a, v) => a + v, 0);
  const sameStats = ['commits', 'days', 'proofs', 'builds'].every(k => H.stats[k] && H.stats[k] === P.stats[k]);

  /* 7 — found */
  const sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  const inSitemap = /<loc>https:\/\/custompos\.org\/built-with-claude\.html<\/loc><lastmod>2026-10-12<\/lastmod>/.test(sitemap);
  const footers = TRADES.concat('single-pc').filter(t => !fs.readFileSync(path.join(ROOT, t + '.html'), 'utf8').includes('href="built-with-claude.html"'));
  const genHasIt = fs.readFileSync(path.join(ROOT, 'tools/gen-landing.js'), 'utf8').includes('href="built-with-claude.html"');

  const ok = {
    noErrors: errors.length === 0,
    meta: /Claude/.test(P.title) && P.title.length <= 70 && P.desc.length > 60 && P.desc.length <= 200 && P.canonical === 'https://custompos.org/' + PAGE && P.og && P.types.includes('WebPage') && P.types.includes('BreadcrumbList'),
    faqMatches: faqSame,
    faqControl,
    linksResolve: bad.length === 0,
    linkControl,
    onPublishList: pub.has(PAGE),
    independenceLine: P.text.includes(LINE) && homeAll.text.includes(LINE),
    noLogos: P.imgs === 0 && P.svgs === 0,
    piiClean: piiPage.length === 0 && piiBand.length === 0,
    piiControl: piiControl && localControl,
    chartSumsToCommits: barSum === 94 && P.stats.commits === '94' && P.bars.length === 12,
    homeBand: !!H.html && H.links.includes(PAGE) && /as of Oct 12, 2026/i.test(H.text) && sameStats,
    noHScroll: widths[320] && widths[360] && home320,
    reducedMotion: reduced && animated,
    found: inSitemap && footers.length === 0 && genHasIt && homeAll.links.includes(PAGE)
  };

  console.log('\n=== RESULTS ===');
  console.log('0 console / page errors (page, reduced motion, home):', ok.noErrors, errors.length ? errors : '');
  console.log('title, description, canonical, OG/Twitter, WebPage + BreadcrumbList:', ok.meta, JSON.stringify(P.title), P.desc.length + ' chars');
  console.log('FAQ structured data is the visible FAQ word for word (' + P.ld.length + '/' + P.vis.length + '):', ok.faqMatches);
  console.log('negative control: one changed visible word breaks the FAQ match:', ok.faqControl);
  console.log('every internal link resolves to a published file / an existing anchor (' + (P.links.length + homeAll.links.length) + ' links):', ok.linksResolve, bad.length ? bad : '');
  console.log('negative control: the checker flags a missing file, a missing anchor and an unpublished file:', ok.linkControl);
  console.log('the page is on the Pages copy list:', ok.onPublishList);
  console.log('the non-affiliation line is on the page and the home page:', ok.independenceLine);
  console.log('no images or inline SVG on the page (no logos):', ok.noLogos);
  console.log('PII guard clean (page + home band), with ' + LOCAL_WORDS.length + ' words from the local private list' + (LOCAL_WORDS.length ? '' : ' (no local list on this machine)') + ':', ok.piiClean, piiPage.concat(piiBand).length ? piiPage.concat(piiBand) : '');
  console.log('negative control: the guard flags a planted phone, e-mail, ticket, tag, IP and word' + (LOCAL_WORDS.length ? ', and a planted word from the local list' : '') + ':', ok.piiControl, planted);
  console.log('the day-by-day chart sums to the commit count (94):', ok.chartSumsToCommits, barSum);
  console.log('home band links the page, is dated, and shows the page\'s figures:', ok.homeBand, JSON.stringify(H.stats));
  console.log('no horizontal scroll at 320 / 360 (page) and 320 (home):', ok.noHScroll, JSON.stringify(widths), home320);
  console.log('reduced motion shows every line at once; otherwise they wait below the fold, then animate in when scrolled to:', ok.reducedMotion, JSON.stringify({ reduced, waits, playing, shown }));
  console.log('in the sitemap, linked from home, every trade page and single-pc.html, and from the generator:', ok.found, footers.length ? 'missing on: ' + footers : '');
  process.exit(Object.values(ok).every(Boolean) ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
