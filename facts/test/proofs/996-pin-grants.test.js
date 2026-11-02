'use strict';
/* =====================================================================================================================
 * §996 · 11/1 — THE HUB'S PIN PASS, ON ITS OWN: hub/pingrant.js, what it promises to whoever runs a hub
 * Owner, 11/1: "we are trying to build a modular system so nobody has to spend the money to do this work again... copy, paste,
 * customize". hub/pingrant.js is the hub's half of the PIN double check (E30): a PIN the HUB checked earns one person on one tablet a
 * signed pass, and the privileged facts they write travel with it. The shop's suite proves it through its whole hub; these proofs pin
 * the file itself, with a clock and a secret of their own, so Custom POS can run them on the copy it imports (rollout step 3).
 * Nothing here is the shop's own: the whole file is exported.
 * ===================================================================================================================== */
const H = require('../harness');
const PG996 = require('../../hub/pingrant');
const staff996 = require('../../core/staff');

/* @proof — a hub's grants on a clock of the proof's own: { g (grantsFor), at(ms) sets the time, told (the alerts) } */
function hub996(secret) {
  const o = { t: 1800000000000, told: [] };
  o.g = PG996.grantsFor({ secret: secret || 'proof-996', now: function () { return o.t; }, alert: function (a) { o.told.push(a); } });
  o.at = function (ms) { o.t = ms; };
  return o;
}
/* @proof — the hub's staff fold with the people given ({id, pin?, active?}), each PIN kept as the record the tablets keep */
function staffOf996(people) {
  const byId = new Map();
  people.forEach(function (p) { byId.set(p.id, { id: p.id, active: p.active !== false, pin: p.pin ? staff996.pinRecordSync(p.pin) : null }); });
  return { byId: byId };
}
/* @proof — one PIN typed on a tablet, checked by the hub (core/staff.js's own hash) */
function typed996(h, station, emp, pin, staff) { return h.g.check(station, emp, pin, staff, staff996.pinHash, staff996.pinIter); }

H.section('996 · 11/1 — THE HUB\'S PIN PASS, ON ITS OWN: hub/pingrant.js — a PIN the hub checked earns one person on one tablet a signed pass for 30 minutes; the privileged facts they write travel with it');

const PEOPLE996 = staffOf996([{ id: 'e1', pin: '4821' }, { id: 'e2', pin: '1357' }, { id: 'gone', pin: '2468', active: false }, { id: 'nopin' }]);

H.testAsync('a good PIN earns a pass naming that person on that tablet, for 30 minutes; a fact they date inside it passes; the same pass from another tablet, for someone else, with its signature or its end changed, or signed by another hub is refused, each in its own words — negative control: a person who left, or has no PIN, earns nothing', async function () {
  const h = hub996(), r = await typed996(h, 'tab-1', 'e1', '4821', PEOPLE996);
  H.ok(r.ok && r.grant.emp === 'e1' && r.grant.station === 'tab-1', 'a pass for e1 on tab-1');
  H.eq(r.grant.exp - h.t, PG996.TTL_MS, 'for 30 minutes');
  H.eq(r.grant.since, h.t, 'begun at the PIN');
  H.eq(h.g.verify(r.grant, 'tab-1', 'e1', h.t + 60000), null, 'a fact dated a minute later passes');
  H.eq(h.g.verify(r.grant, 'tab-2', 'e1', h.t), 'a PIN grant from another tablet', 'another tablet');
  H.eq(h.g.verify(r.grant, 'tab-1', 'e2', h.t), 'a PIN grant for someone else', 'someone else');
  H.eq(h.g.verify(Object.assign({}, r.grant, { sig: r.grant.sig.replace(/^./, function (c) { return c === 'a' ? 'b' : 'a'; }) }), 'tab-1', 'e1', h.t), 'a PIN grant the hub did not sign', 'its signature changed');
  H.eq(h.g.verify(Object.assign({}, r.grant, { exp: r.grant.exp + 3600000 }), 'tab-1', 'e1', h.t), 'a PIN grant the hub did not sign', 'its end moved later');
  H.eq(hub996('another-hub').g.verify(r.grant, 'tab-1', 'e1', h.t), 'a PIN grant the hub did not sign', 'another hub\'s secret');
  H.eq(h.g.verify(null, 'tab-1', 'e1', h.t), 'no PIN grant from the hub', 'no pass at all');
  const left = await typed996(h, 'tab-1', 'gone', '2468', PEOPLE996), none = await typed996(h, 'tab-1', 'nopin', '', PEOPLE996);
  H.ok(!left.ok && !none.ok && left.refused === 'no active employee with a PIN by that id' && none.refused === left.refused, 'negative control: nobody who left, and nobody without a PIN, earns a pass');
});

H.testAsync('time: a fact dated after the pass ended is refused; one dated inside it still arrives up to 2 hours after the end (a tablet that was offline), never later; a pass is renewed without the PIN while it is good, keeping its start, up to 12 hours from the PIN; a risky door takes only a PIN typed in the last 30 minutes — negative control: the renewed pass a risky door refuses still carries a privileged fact', async function () {
  const h = hub996(), t0 = h.t, g = (await typed996(h, 'tab-1', 'e1', '4821', PEOPLE996)).grant;
  H.eq(h.g.verify(g, 'tab-1', 'e1', g.exp + 1), 'the PIN grant had ended before this was done', 'dated after the end');
  h.at(g.exp + PG996.GRACE_MS - 1);
  H.eq(h.g.verify(g, 'tab-1', 'e1', g.exp - 1), null, 'dated inside, arriving 2 hours after the end less a moment: passes');
  h.at(g.exp + PG996.GRACE_MS + 1);
  H.eq(h.g.verify(g, 'tab-1', 'e1', g.exp - 1), 'the PIN grant ended more than 2 hours ago', 'arriving later: refused');
  h.at(g.exp + 1);
  H.eq(h.g.renew(g, 'tab-1').refused, 'the PIN grant has ended — the PIN again, please', 'an ended pass is not renewed');
  h.at(t0 + 25 * 60000);
  const r1 = h.g.renew(g, 'tab-1');
  H.ok(r1.ok && r1.grant.since === t0 && r1.grant.exp === h.t + PG996.TTL_MS, 'renewed while good: 30 more minutes, the same start');
  H.eq(h.g.renew(g, 'tab-2').refused, 'a PIN grant from another tablet', 'only on its own tablet');
  let k = r1.grant, n = 0; while (h.t + 25 * 60000 - t0 <= h.g.MAX_SESSION_MS) { h.at(h.t + 25 * 60000); const r = h.g.renew(k, 'tab-1'); H.ok(r.ok, 'renewed at ' + Math.round((h.t - t0) / 60000) + ' minutes'); k = r.grant; n++; }
  H.ok(h.g.MAX_SESSION_MS === 12 * 3600000 && n >= 26, 'renewed every 25 minutes for 12 hours (' + n + ' times) — a limit read as nothing would have run no loop at all');
  h.at(t0 + h.g.MAX_SESSION_MS + 1);
  H.eq(h.g.renew(k, 'tab-1').refused, 'twelve hours since the PIN — the PIN again, please', '12 hours from the PIN: the PIN again');
  const h2 = hub996(), d = (await typed996(h2, 'tab-1', 'e1', '4821', PEOPLE996)).grant;
  H.eq(h2.g.door(d, 'tab-1'), null, 'a risky door opens on a fresh PIN');
  h2.at(h2.t + 25 * 60000); const d2 = h2.g.renew(d, 'tab-1').grant; h2.at(h2.t + 6 * 60000);
  H.eq(h2.g.door(d2, 'tab-1'), 'the PIN was entered more than 30 minutes ago', 'a renewed pass 31 minutes after the PIN opens no risky door');
  H.eq(h2.g.verify(d2, 'tab-1', 'e1', h2.t), null, 'negative control: that same pass still carries a privileged fact');
});

H.testAsync('wrong PINs: five on one tablet for one person lock that pair for 15 minutes (even the right PIN waits), the owner is told once, another tablet is not locked, and after 15 minutes the right PIN works — negative control: four wrong PINs and then the right one earn a pass, nothing locked or told', async function () {
  const h = hub996();
  for (let i = 0; i < 4; i++) H.eq((await typed996(h, 'tab-1', 'e1', '0000', PEOPLE996)).refused, 'wrong PIN', 'wrong PIN ' + (i + 1));
  const ok4 = await typed996(h, 'tab-1', 'e1', '4821', PEOPLE996);
  H.ok(ok4.ok && h.told.length === 0, 'negative control: four wrong and then the right one earn a pass; nobody is told');
  for (let i = 0; i < 5; i++) await typed996(h, 'tab-1', 'e1', '0000', PEOPLE996);
  const locked = await typed996(h, 'tab-1', 'e1', '4821', PEOPLE996);
  H.ok(!locked.ok && /too many wrong PINs for this person on this tablet/.test(locked.refused) && locked.retryMs > 0, 'locked: even the right PIN waits — ' + locked.refused);
  await typed996(h, 'tab-1', 'e1', '0000', PEOPLE996);
  H.eq(h.told.length, 1, 'the owner is told once');
  H.eq(h.told[0].kind, 'pin-locked', 'as a locked PIN');
  H.ok((await typed996(h, 'tab-2', 'e1', '4821', PEOPLE996)).ok, 'another tablet for the same person is not locked');
  h.at(h.t + h.g.LOCK_MS + 1);
  H.ok((await typed996(h, 'tab-1', 'e1', '4821', PEOPLE996)).ok, 'after 15 minutes the right PIN works');
});

/* ── exported by the v2 exporter: the whole of the private suite's §996. */
H.done();
