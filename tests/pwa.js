const { chromium } = require('playwright-core');
const url = ('file://' + require('path').resolve(__dirname, '..', 'pos.html'));
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FLOW = {
  flowId:"pwa", label:"PWA Shop", topology:"linear",
  branding:{ name:"Zesty Grill", brandColor:"#cc3311" },
  endpoints:{ customer:{persist:false}, payment:{tenders:["cash"], closeGate:"balanceLE0" } },
  catalog:[ {id:"w", name:"Widget", price:10, category:"retail", path:[] } ],
  stations:[ {id:"reg", type:"central", label:"Register", view:{money:true} } ]
};
(async () => {
  const errors = [];
  const b = await chromium.launch({ executablePath: EXE, args:['--no-sandbox'] });
  const ctx = await b.newContext(); const p = await ctx.newPage();
  p.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
  p.on('pageerror', e => errors.push('pageerror: '+e.message));
  await p.addInitScript(f => { window.CUSTOMPOS_FLOW = f; }, FLOW);
  await p.goto(url);

  // manifest link injected + fetched, branded with the business
  const manifest = await p.evaluate(async () => {
    const link = document.querySelector('link[rel="manifest"]');
    if (!link) return null;
    const txt = await fetch(link.href).then(r => r.text());
    return JSON.parse(txt);
  });
  const manifestOk = manifest && manifest.name==='Zesty Grill' && manifest.display==='standalone' && manifest.theme_color==='#cc3311' && (manifest.icons||[]).length>=1;

  const themeColor = await p.getAttribute('#themeColor', 'content');
  const appleTitle = await p.getAttribute('meta[name="apple-mobile-web-app-title"]', 'content');
  const appleCapable = await p.getAttribute('meta[name="apple-mobile-web-app-capable"]', 'content');
  const hasTouchIcon = await p.locator('link[rel="apple-touch-icon"]').count()===1;
  const iconIsSvg = manifest && (manifest.icons[0].src||'').startsWith('data:image/svg+xml');

  await b.close();
  console.log('manifest:', JSON.stringify(manifest && {name:manifest.name, display:manifest.display, theme:manifest.theme_color}));
  console.log('\n=== RESULTS ===');
  console.log('web manifest injected + branded:', manifestOk);
  console.log('theme-color set to the brand:', themeColor==='#cc3311');
  console.log('apple web-app title = business, capable=yes:', appleTitle==='Zesty Grill' && appleCapable==='yes');
  console.log('home-screen icon present (svg data-uri + apple-touch):', iconIsSvg && hasTouchIcon);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!manifestOk||themeColor!=='#cc3311'||appleTitle!=='Zesty Grill'||!iconIsSvg||!hasTouchIcon?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
