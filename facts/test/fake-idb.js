'use strict';
/* A small in-memory IndexedDB for proving store/browser.js in Node (the real one is proven in a browser too).
   Only the subset the store uses: open + upgrade, autoIncrement and out-of-line-key object stores, readonly
   getAll/get, readwrite add/put committed as ONE transaction (all or nothing), asynchronous like the real thing.
   ctl.failTx = n  → the next n readwrite transactions abort (a full disk / a quota), writing nothing.
   ctl.openError   → open() fails. The databases outlive a "reload": open the same name again and the rows are there. */
function fakeIDB() {
  const dbs = new Map();
  const ctl = { failTx: 0, openError: null, commits: 0 };
  const later = function (fn) { setTimeout(fn, 0); };
  const req = function () { return { onsuccess: null, onerror: null, result: undefined, error: null }; };
  const copy = function (v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); };
  function handle(name) {
    const d = dbs.get(name); let shut = false;   /* E88: as the real one — after close(), a new transaction throws; one begun before it still finishes */
    return {
      objectStoreNames: { contains: function (n) { return d.stores.has(n); } },
      createObjectStore: function (n, o) { d.stores.set(n, { auto: !!(o && o.autoIncrement), rows: new Map(), next: 1 }); return {}; },
      transaction: function (names, mode) {
        if (shut) throw Object.assign(new Error('The database connection is closing.'), { name: 'InvalidStateError' });
        const tx = { oncomplete: null, onerror: null, onabort: null, error: null }, staged = [];
        const fail = (mode === 'readwrite' && ctl.failTx > 0) ? (ctl.failTx--, true) : false;
        tx.objectStore = function (n) {
          const st = d.stores.get(n); if (!st) throw new Error('NotFoundError: no object store ' + n);
          return {
            add: function (v) { const r = req(); const c = copy(v); staged.push(function () { const k = st.next++; st.rows.set(k, c); r.result = k; }); return r; },
            put: function (v, k) { const r = req(); const c = copy(v); staged.push(function () { st.rows.set(k, c); r.result = k; }); return r; },
            getAll: function () { const r = req(); later(function () { r.result = Array.from(st.rows.keys()).sort(function (a, b) { return a - b; }).map(function (k) { return copy(st.rows.get(k)); }); if (r.onsuccess) r.onsuccess(); }); return r; },
            get: function (k) { const r = req(); later(function () { r.result = copy(st.rows.get(k)); if (r.onsuccess) r.onsuccess(); }); return r; }
          };
        };
        if (mode === 'readwrite') later(function () {
          if (fail) { tx.error = Object.assign(new Error('the disk is full (fake)'), { name: 'QuotaExceededError' }); if (tx.onerror) tx.onerror(); if (tx.onabort) tx.onabort(); return; }
          staged.forEach(function (f) { f(); }); ctl.commits++; if (tx.oncomplete) tx.oncomplete();
        });
        return tx;
      },
      close: function () { shut = true; }
    };
  }
  return {
    ctl: ctl, dbs: dbs,
    open: function (name, version) { const r = req(); later(function () {
      if (ctl.openError) { r.error = new Error(ctl.openError); if (r.onerror) r.onerror(); return; }
      if (!dbs.has(name)) dbs.set(name, { version: 0, stores: new Map() });
      const d = dbs.get(name); const up = d.version < version; if (up) d.version = version;
      r.result = handle(name); if (up && r.onupgradeneeded) r.onupgradeneeded(); if (r.onsuccess) r.onsuccess(); }); return r; },
    rows: function (name, store) { const d = dbs.get(name); const st = d && d.stores.get(store); return st ? Array.from(st.rows.keys()).sort(function (a, b) { return a - b; }).map(function (k) { return copy(st.rows.get(k)); }) : []; }
  };
}
function fakeLocalStorage() { const m = new Map(); return { getItem: function (k) { return m.has(k) ? m.get(k) : null; }, setItem: function (k, v) { m.set(k, String(v)); }, removeItem: function (k) { m.delete(k); }, _map: m }; }
module.exports = { fakeIDB: fakeIDB, fakeLocalStorage: fakeLocalStorage };
