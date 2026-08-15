/* src-scan.js — ONE way to read this codebase's source. READ-ONLY, no dependencies.
 *
 * Owner, 2026-08-12: "each segment is a modular part... the cash drawer is one engine of code... route is one
 * engine... search is one engine, used different depending on the screen requesting the search... that's clean,
 * tunnelled architecture."
 *
 * ⚠️ THIS FILE EXISTS BECAUSE THE MEASURING TOOLS HAD THE BUG THEY MEASURE. Three of them — audit-patterns.js,
 * find-duplication.js and the modularity survey — each kept a private copy of "strip the comments and find which
 * function this line is in", and every copy had the SAME hole: a `code()` that only strips a comment opening and
 * closing on ONE line, so a line in the MIDDLE of a block comment reads as code. Both of the following were
 * measured on 2026-08-12:
 *   · audit-patterns rule I reported the sentence "billCust is not consulted here" as evidence that billCust was
 *     being consulted — two of its three findings were the rule reading its own explanation;
 *   · find-duplication reported two of my own comment paragraphs as "the same 3-statement run in 2 places",
 *     which also means its headline claim of "no repeated statement runs" was not trustworthy.
 * A tool that cries wolf gets ignored, and a tool that is quietly wrong is worse. So there is one scanner now,
 * and fixing it fixes every caller — which is the whole argument for engines, applied to the tools.
 *
 *   const S = require('./src-scan');
 *   const app = S.load('Ozark-POS.html');            // { lines, prose, offset, appJs }
 *   app.prose[i]                                      // true = line i is entirely comment/whitespace
 *   app.fnAt(i)                                       // name of the function line i sits in
 *   app.funcs()                                       // [{ name, at, from, to }] top-level declarations
 *   app.callsTo('saveDB')                             // how many real (non-prose) lines call it
 */
'use strict';
const fs = require('fs');

/* strip comments that open AND close on this line, plus a trailing // — the same rule the older tools used,
   kept because it is right for single-line cases and every caller already expects it */
const code = ln => String(ln).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/, '');

/* ⚠️ Block-comment depth, tracked across the whole file. Fails SAFE: if the scan ends still inside a comment it
   has desynced (a '/*' inside a string or regex), and it then marks NOTHING as prose — so a caller behaves
   exactly as it did before this module existed rather than silently going blind. Going quiet is the failure
   mode that matters; a false positive is merely annoying, a false negative is a rule that stopped working. */
function proseFlags(lines){
  const flags = []; let open = false;
  lines.forEach(ln => {
    let j = 0, sawCode = false;
    while (j < ln.length){
      if (open){ if (ln[j] === '*' && ln[j+1] === '/'){ open = false; j += 2; continue; } j++; continue; }
      if (ln[j] === '/' && ln[j+1] === '*'){ open = true; j += 2; continue; }
      if (ln[j] === '/' && ln[j+1] === '/') break;
      if (!/\s/.test(ln[j])) sawCode = true;
      j++;
    }
    flags.push(!sawCode);
  });
  return open ? lines.map(() => false) : flags;
}

function load(file){
  const raw = fs.readFileSync(file, 'utf8');
  let appJs = raw, offset = 1;
  if (/\.html?$/i.test(file)){
    const m = raw.match(/<script>([\s\S]*)<\/script>/);
    if (!m) throw new Error('no inline <script> in ' + file);
    appJs = m[1];
    offset = raw.slice(0, raw.indexOf(m[1])).split('\n').length;   /* so a reported line matches the real file */
  }
  const lines = appJs.split('\n');
  const prose = proseFlags(lines);

  const api = {
    file, raw, appJs, lines, prose, offset,
    at: i => i + offset,
    code,
    /* ⚠️ walks BACK to the nearest declaration, SKIPPING prose — a banner written above one function would
       otherwise be attributed to the function above THAT, which is exactly how rule I blamed billCust. */
    fnAt(i){ for (let k = i; k >= 0; k--){ if (prose[k]) continue;
      const mm = lines[k].match(/^\s*function\s+([\w$]+)/); if (mm) return mm[1]; } return '(top)'; },
    /* top-level declarations only (column 0) — the app's engines all live there */
    funcs(){
      if (api._funcs) return api._funcs;
      const out = [];
      lines.forEach((ln, i) => { if (prose[i]) return;
        const mm = ln.match(/^function\s+([\w$]+)\s*\(/); if (mm) out.push({ name: mm[1], at: api.at(i), from: i }); });
      out.forEach((f, k) => { f.to = (k + 1 < out.length) ? out[k+1].from - 1 : lines.length - 1; });
      return (api._funcs = out);
    },
    /* how many non-prose lines mention name( — includes onclick="name(…" strings, which ARE real call sites */
    callsTo(name){
      const re = new RegExp('\\b' + name.replace(/[$]/g, '\\$') + '\\s*\\(');
      let n = 0;
      lines.forEach((ln, i) => { if (prose[i]) return;
        if (/^function\s/.test(ln) && new RegExp('^function\\s+' + name + '\\s*\\(').test(ln)) return;  /* its own definition */
        if (re.test(code(ln))) n++; });
      return n;
    },
    /* the text of one function, prose removed — for asking what a function actually DOES */
    bodyOf(f){ return lines.slice(f.from, f.to + 1).filter((_, k) => !prose[f.from + k]).map(code).join('\n'); }
  };
  return api;
}

module.exports = { load, code, proseFlags };
