#!/usr/bin/env node
/* @seo @publish — tell IndexNow search engines (Bing, Yandex, Seznam, Naver…) which pages changed, so they re-read them now
   instead of whenever they next crawl. The key is PUBLIC by design: IndexNow proves you own the site by fetching
   https://<host>/<key>.txt, which the Pages workflow publishes. Google does not use IndexNow (it reads the sitemap and
   Search Console's "Request indexing"), so this is the Bing side of getting found.
   usage:  node tools/indexnow.js                 → every <loc> in sitemap.xml
           node tools/indexnow.js /single-pc.html → just those paths */
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

const HOST = 'custompos.org';
const KEY = '0d8cbe071e79fcbb9507176cfb254f5a';

/* @seo — the URLs to announce: the paths given on the command line, else every page the sitemap lists */
function urlsToSend(argv) {
  if (argv.length) return argv.map(p => 'https://' + HOST + (p.startsWith('/') ? p : '/' + p));
  const xml = fs.readFileSync(path.join(__dirname, '..', 'sitemap.xml'), 'utf8');
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim());
}

/* @seo @publish — one POST to the shared IndexNow endpoint; any participating engine shares it with the others */
function send(urlList) {
  const body = JSON.stringify({ host: HOST, key: KEY, keyLocation: 'https://' + HOST + '/' + KEY + '.txt', urlList });
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: 'api.indexnow.org', path: '/indexnow', method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) } },
      res => { let t = ''; res.on('data', d => t += d); res.on('end', () => resolve({ status: res.statusCode, text: t })); });
    req.on('error', reject); req.end(body);
  });
}

if (require.main === module) {
  const urls = urlsToSend(process.argv.slice(2));
  send(urls).then(r => {
    /* 200 = accepted · 202 = accepted, key check pending · 400/403/422 = something is wrong (the key file not live yet, a URL off this host) */
    console.log('IndexNow ' + r.status + ' for ' + urls.length + ' URL(s)' + (r.text ? ' — ' + r.text.slice(0, 200) : ''));
    process.exit(r.status === 200 || r.status === 202 ? 0 : 1);
  }).catch(e => { console.log('IndexNow request failed: ' + e.message); process.exit(1); });
}
module.exports = { urlsToSend, HOST, KEY };
