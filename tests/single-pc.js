/* single-pc.js — the Single-PC Edition (single-pc/ozark-pos-single-pc.html) is truly standalone, and its landing page
   (single-pc.html) tells the truth to people and to search engines.
   1. Opened from disk (file://): every request is recorded; the only one allowed is the file itself. No console
      error, no page error; the app boots to its home screen and the "Single-PC Edition" marker is visible.
   2. Served over http:// (what a hosted copy at custompos.org is): the server logs every hit and must see exactly
      one — the page. No /api call, no service worker. (v1 syncs whenever it is served over http(s); this edition
      must not.)
   3. The landing page: both buttons point at the file (one with a download attribute), the FAQ structured data is
      the visible FAQ word for word, canonical is set, no console error, no sideways scroll on a phone. */
'use strict';
const { chromium } = require('playwright-core');
const http = require('http'), fs = require('fs'), path = require('path'), { pathToFileURL } = require('url');
const WIN_CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const EXE = process.env.CHROMIUM_EXE || (fs.existsSync(WIN_CHROME) ? WIN_CHROME : '/opt/pw-browsers/chromium-1194/chrome-linux/chrome');
const ROOT = path.resolve(__dirname, '..');
const APP_REL = 'single-pc/ozark-pos-single-pc.html';
const APP = path.join(ROOT, APP_REL);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json', '.md': 'text/markdown' };

/* a static server that writes down every request it is asked for */
function serve(log) {
  return new Promise(r => {
    const s = http.createServer((rq, rs) => {
      log.push(rq.method + ' ' + rq.url);
      const f = path.join(ROOT, decodeURIComponent(rq.url.split('?')[0]));
      if (!f.startsWith(ROOT)) { rs.statusCode = 403; return rs.end(); }
      fs.readFile(f, (e, b) => { if (e) { rs.statusCode = 404; return rs.end('nf'); } rs.setHeader('Content-Type', TYPES[path.extname(f)] || 'application/octet-stream'); rs.end(b); });
    });
    s.listen(0, '127.0.0.1', () => r(s));
  });
}

/* open the app in a fresh context, record everything, let its timers run, and read the home screen */
async function bootApp(b, url) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
  const reqs = [], errors = [];
  ctx.on('request', q => { const u = q.url(); if (!/^(data|blob):/i.test(u)) reqs.push(u); });
  const p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  p.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await p.goto(url);
  await p.waitForSelector('#app .tile, #app button', { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(4000);   /* sync loops, print-helper pings and backup timers would have fired by now */
  const app = await p.locator('#app').innerText();
  const hasPill = (await p.locator('.spc-pill').count()) > 0;
  const r = {
    reqs, errors,
    home: /Quick/.test(app) && /Pickup/.test(app) && /Assemble/.test(app),
    banner: /Single-PC Edition/.test(app) && /only in this browser, on this computer/.test(app),
    pill: hasPill && await p.locator('.spc-pill').isVisible(),
    pillText: hasPill ? (await p.locator('.spc-pill').innerText()).trim() : '',
    refused: await p.evaluate(() => window.SINGLE_PC_REFUSED),
    syncOff: await p.evaluate(() => typeof syncOn === 'function' ? syncOn() === false : null),
    sw: await p.evaluate(async () => { try { return navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : 0; } catch (e) { return 0; } })
  };
  /* the marker opens the About box, which names where data lives and the sample PINs */
  r.about = false;
  if (r.pill) {
    await p.locator('.spc-pill').click();
    await p.waitForTimeout(300);
    const about = await p.locator('#modalRoot').innerText();
    r.about = /Where your data lives/.test(about) && /1234/.test(about) && /no one-click restore/i.test(about);
  }
  await ctx.close();
  return r;
}

(async () => {
  if (!fs.existsSync(APP)) { console.error('missing ' + APP_REL); process.exit(1); }
  const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });

  /* 1 — from disk */
  const fileUrl = pathToFileURL(APP).href;
  const d = await bootApp(b, fileUrl);
  const diskOthers = d.reqs.filter(u => u !== fileUrl);

  /* 2 — over http, the way a hosted copy runs */
  const log = []; const server = await serve(log); const port = server.address().port;
  const httpUrl = `http://127.0.0.1:${port}/${APP_REL}`;
  const h = await bootApp(b, httpUrl);
  const appHits = log.slice();
  const httpOthers = h.reqs.filter(u => u !== httpUrl);
  const apiHits = appHits.filter(l => /\/api\//.test(l));

  /* 3 — the landing page */
  log.length = 0;
  const ctx = await b.newContext({ viewport: { width: 1200, height: 900 } });
  const p = await ctx.newPage(); const lerr = [];
  p.on('console', m => { if (m.type() === 'error') lerr.push(m.text()); });
  p.on('pageerror', e => lerr.push('pageerror: ' + e.message));
  await p.goto(`http://127.0.0.1:${port}/single-pc.html`);
  const L = await p.evaluate(() => {
    const norm = s => String(s || '').replace(/\s+/g, ' ').trim();
    const blocks = [...document.querySelectorAll('script[type="application/ld+json"]')].map(s => JSON.parse(s.textContent));
    const flat = blocks.flatMap(x => Array.isArray(x) ? x : [x]);
    const faq = flat.find(x => x['@type'] === 'FAQPage');
    const app = flat.find(x => x['@type'] === 'SoftwareApplication');
    const ld = faq ? faq.mainEntity.map(q => [norm(q.name), norm(q.acceptedAnswer.text)]) : [];
    const vis = [...document.querySelectorAll('.faq details')].map(d => [norm(d.querySelector('summary').textContent), norm(d.querySelector('p').textContent)]);
    const dl = document.getElementById('dl'), tr = document.getElementById('try');
    return {
      faqSame: ld.length > 0 && JSON.stringify(ld) === JSON.stringify(vis), faqCount: ld.length, visCount: vis.length,
      appLd: !!app && app.offers && app.offers.price === '0' && /single-pc\/ozark-pos-single-pc\.html$/.test(app.downloadUrl) && /MIT/.test(app.license),
      canonical: (document.querySelector('link[rel=canonical]') || {}).href === 'https://custompos.org/single-pc.html',
      title: document.title, desc: (document.querySelector('meta[name=description]') || {}).content || '',
      og: !!document.querySelector('meta[property="og:title"]') && !!document.querySelector('meta[name="twitter:card"]'),
      dlHref: dl && dl.getAttribute('href'), dlAttr: dl && dl.hasAttribute('download'),
      tryHref: tr && tr.getAttribute('href'), tryText: tr && tr.textContent.trim(), dlText: dl && dl.textContent.trim(),
      pins: /Owner 1234/.test(document.body.innerText) && /Front Counter 1111/.test(document.body.innerText),
      restore: /no one-click restore/i.test(document.body.innerText)
    };
  });
  const fileServed = await new Promise(r => http.get(`http://127.0.0.1:${port}/${L.dlHref}`, rs => { r(rs.statusCode); rs.resume(); }).on('error', () => r(0)));
  await p.setViewportSize({ width: 360, height: 780 });
  const noHScroll = await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  await ctx.close();
  await b.close(); server.close();

  const ok = {
    diskNoRequests: diskOthers.length === 0,
    diskNoErrors: d.errors.length === 0,
    diskHome: d.home && d.banner,
    diskMarker: d.pill && /Single-PC Edition/.test(d.pillText) && d.about,
    httpOnlyThePage: appHits.length === 1 && appHits[0] === 'GET /' + APP_REL && httpOthers.length === 0,
    httpNoApi: apiHits.length === 0,
    httpNoErrors: h.errors.length === 0,
    httpHomeAndMarker: h.home && h.banner && h.pill,
    httpSyncOffNoSW: h.syncOff === true && h.sw === 0,
    landingFaqMatches: L.faqSame,
    landingLd: L.appLd && L.canonical && L.og && /Single-PC|One File, One PC/i.test(L.title) && L.desc.length > 50 && L.desc.length <= 200,
    landingButtons: L.dlHref === APP_REL && L.dlAttr && L.tryHref === APP_REL && /Try it in your browser/.test(L.tryText) && /Download the file/.test(L.dlText) && fileServed === 200,
    landingHonest: L.pins && L.restore,
    landingNoErrors: lerr.length === 0,
    landingMobile: noHScroll
  };

  console.log('\n=== RESULTS ===');
  console.log('from disk: no request except the file itself:', ok.diskNoRequests, diskOthers.length ? diskOthers : '');
  console.log('from disk: 0 console / page errors:', ok.diskNoErrors, d.errors.length ? d.errors : '');
  console.log('from disk: boots to the home screen with the single-PC banner:', ok.diskHome);
  console.log('from disk: "Single-PC Edition" marker visible, opens the About box (data, PINs, restore):', ok.diskMarker);
  console.log('over http: the server saw exactly one request, the page:', ok.httpOnlyThePage, appHits);
  console.log('over http: no /api request:', ok.httpNoApi);
  console.log('over http: 0 console / page errors:', ok.httpNoErrors, h.errors.length ? h.errors : '');
  console.log('over http: home screen + marker:', ok.httpHomeAndMarker);
  console.log('over http: syncOn() is false and no service worker registered:', ok.httpSyncOffNoSW);
  console.log('network calls the guard refused (disk / http):', d.refused, '/', h.refused);
  console.log('landing: FAQ structured data is the visible FAQ word for word (' + L.faqCount + '/' + L.visCount + '):', ok.landingFaqMatches);
  console.log('landing: SoftwareApplication (free, MIT, downloadUrl), canonical, OG/Twitter, title + description:', ok.landingLd);
  console.log('landing: Download (download attr) + Try buttons point at the file, which is served:', ok.landingButtons);
  console.log('landing: sample PINs and the no-restore limit are stated:', ok.landingHonest);
  console.log('landing: 0 console errors:', ok.landingNoErrors, lerr.length ? lerr : '');
  console.log('landing: no horizontal scroll at 360px:', ok.landingMobile);
  process.exit(Object.values(ok).every(Boolean) ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
