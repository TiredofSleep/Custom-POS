// Pure-Node test for the standalone payments service (sim provider — no processor, CI-safe).
process.env.PAY_PROVIDER = 'sim';
process.env.PAY_KEY = 'testkey';
const http = require('http');
const { server } = require('../payments/pay-server.js');

function call(method, path, body, headers){
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const port = server.address().port;
    const opts = { method, host:'127.0.0.1', port, path, headers: Object.assign({ 'Content-Type':'application/json' }, headers||{}) };
    if (data) opts.headers['Content-Length'] = Buffer.byteLength(data);
    const r = http.request(opts, (res) => { let b=''; res.on('data',d=>b+=d); res.on('end',()=>{ let j=null; try{ j=JSON.parse(b);}catch(_){} resolve({ status:res.statusCode, json:j }); }); });
    if (data) r.write(data); r.end();
  });
}
const AUTH = { Authorization: 'Bearer testkey' };

(async () => {
  let ok = true;
  const assert = (name, cond) => { console.log((cond?'✓':'✗')+' '+name); if(!cond) ok=false; };
  await new Promise(r => server.listen(0, '127.0.0.1', r));

  const health = await call('GET', '/health');
  assert('health reports the sim provider', health.status===200 && health.json.ok===true && health.json.provider==='sim');

  const noauth = await call('POST', '/charge', { amountCents:1000, token:'tok_abcd' });   // no bearer
  assert('charge without the key is rejected (401)', noauth.status===401);

  const badreq = await call('POST', '/charge', { amountCents:1000 }, AUTH);               // missing token
  assert('charge validates its input (400 on missing token)', badreq.status===400);

  const charge = await call('POST', '/charge', { amountCents:1250, token:'tok_abcd', cvv:'123' }, AUTH);
  assert('charge approves + returns a ref, brand, last4', charge.status===200 && charge.json.status==='approved' && !!charge.json.ref && !!charge.json.brand && charge.json.last4==='1250' && charge.json.cvv==='M');

  const decline = await call('POST', '/charge', { amountCents:1013, token:'tok_abcd' }, AUTH);   // 1013 % 100 == 13
  assert('charge declines the demo $_.13 amount', decline.status===200 && decline.json.status==='declined');

  const refund = await call('POST', '/refund', { ref: charge.json.ref, amountCents:500 }, AUTH);
  assert('partial refund returns a refunded ref', refund.status===200 && refund.json.status==='refunded' && /-R$/.test(refund.json.ref));

  const voided = await call('POST', '/void', { ref: charge.json.ref }, AUTH);
  assert('void returns a voided ref', voided.status===200 && voided.json.status==='voided' && /-V$/.test(voided.json.ref));

  const inq = await call('GET', '/inquire/' + encodeURIComponent(charge.json.ref), null, AUTH);
  assert('inquire returns a status', inq.status===200 && inq.json.status==='approved');

  const tok = await call('GET', '/tokenizer');
  assert('tokenizer endpoint returns an embed config', tok.status===200 && !!tok.json.url);

  const term = await call('POST', '/terminal/charge', { amountCents:2000 }, AUTH);
  assert('card-present terminal charge works (sim)', term.status===200 && term.json.status==='approved');

  await new Promise(r => server.close(r));
  console.log('\n' + (ok ? 'ALL PASS' : 'FAIL'));
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
