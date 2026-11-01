// hub.js has no login of its own, so one bad GET must never stop the hub: a malformed % escape or a NUL byte in a path used to
// throw inside the request handler and kill the process (every register's sync with it). A path that walks up into a SIBLING
// folder whose name merely starts like the hub's own (app -> appx) slipped past the old startsWith check and was served.
// This runs a copy of hub.js in its own temp folder (app/, with a sibling appx/) as a child process, so a crash shows as a dead child.
const os = require('os'), fs = require('fs'), path = require('path'), http = require('http'), net = require('net');
const { spawn } = require('child_process');

let ok = true;
function assert(name, cond){ console.log((cond?'✓':'✗')+' '+name); if(!cond) ok=false; }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cphub-'));
const app = path.join(tmp, 'app'), sib = path.join(tmp, 'appx');
fs.mkdirSync(app); fs.mkdirSync(sib);
fs.copyFileSync(path.join(__dirname, '..', 'hub.js'), path.join(app, 'hub.js'));
fs.writeFileSync(path.join(app, 'builder.html'), 'HELLO-BUILDER');
fs.writeFileSync(path.join(sib, 'secret.txt'), 'SIBLING-SECRET');

function freePort(){ return new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); }); }
function get(port, p){ return new Promise(r => {
  const req = http.request({ host:'127.0.0.1', port, path:p, method:'GET' }, res => { let b=''; res.on('data', d => b += d); res.on('end', () => r({ status:res.statusCode, body:b })); });
  req.on('error', e => r({ status:0, body:'', err:e.code })); req.setTimeout(4000, () => req.destroy()); req.end(); }); }
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  // each group gets a live hub: if the one before it died, a fresh copy is started, so every check stands on its own
  let child = null, port = 0, stderr = '';
  async function live(){
    if (child && child.exitCode === null && (await get(port, '/api/health')).status === 200) return true;
    port = await freePort();
    child = spawn(process.execPath, [path.join(app, 'hub.js')], { env: { ...process.env, PORT:String(port), DATA:path.join(tmp, 'data', 'db.json') }, stdio:['ignore','ignore','pipe'] });
    child.stderr.on('data', d => stderr += d);
    for (let i = 0; i < 50; i++) { await wait(100); if ((await get(port, '/api/health')).status === 200) return true; }
    return false;
  }
  const alive = async () => child.exitCode === null && (await get(port, '/api/health')).status === 200;
  assert('the hub copy starts and answers /api/health', await live());

  const badEscape = await get(port, '/%E0%A4%A');
  assert('a malformed % escape in a page path is a 400, not a crash', badEscape.status === 400);
  assert('the hub is still alive after it', await alive());

  await live();
  const badBlob = await get(port, '/api/blob/%E0%A4%A');
  assert('a malformed % escape in a blob ref is a 400', badBlob.status === 400);
  assert('the hub is still alive after that', await alive());

  await live();
  const nul = await get(port, '/a%00b.html');
  assert('a NUL byte in a path is a 400', nul.status === 400);
  assert('the hub is still alive after that too', await alive());

  await live();
  const sibling = await get(port, '/..%2Fappx%2Fsecret.txt');
  assert("a path into a sibling folder named like the hub's own is refused (403)", sibling.status === 403);
  assert("and the sibling's file is never served", sibling.body.indexOf('SIBLING-SECRET') < 0);
  const up2 = await get(port, '/../../etc/passwd');
  assert('a plain walk up out of the folder is not served either', up2.status !== 200);

  await live();
  const home = await get(port, '/');
  assert('the builder still loads at /', home.status === 200 && home.body === 'HELLO-BUILDER');
  const named = await get(port, '/builder.html');
  assert('and by its own name', named.status === 200 && named.body === 'HELLO-BUILDER');

  assert("no crash was written to the hub's error output", !/Error|throw/i.test(stderr));
  child.kill();
  await wait(200);
  try { fs.rmSync(tmp, { recursive:true, force:true }); } catch(e){}
  console.log('\n'+(ok?'ALL PASS':'FAIL'));
  process.exit(ok ? 0 : 1);
})();
