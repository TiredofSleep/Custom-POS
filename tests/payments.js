const { chromium } = require('playwright-core');
const url = ('file://' + require('path').resolve(__dirname, '..', 'pos.html'));
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
(async () => {
  const errors = [];
  const b = await chromium.launch({ executablePath: EXE, args:['--no-sandbox'] });
  const ctx = await b.newContext(); const p = await ctx.newPage();
  p.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
  p.on('pageerror', e => errors.push('pageerror: '+e.message));
  await p.goto(url);
  const B = async n => p.getByRole('button',{name:new RegExp('^'+n)}).first().click();
  const T = async () => (await p.locator('main').innerText());

  // Salon takes card. Ring a retail Product ($22, no path -> READY immediately), pay by card.
  await B('Salon'); await B('Front Desk');
  await B('Shampoo'); await B('Send order');
  const hasCardButton = await p.getByRole('button',{name:/Pay by card \$22\.00/}).isVisible();
  await p.getByRole('button',{name:/Pay by card/}).click();
  const afterCard = await T();
  // approved -> the record shows a card tender with brand + last4 (browser never saw a PAN)
  const cardTenderShown = /💳 (Visa|Mastercard|Amex) ••\d{4}/.test(afterCard);
  await B('Done');
  const closed = /completed today/.test(await T());

  await b.close();
  console.log('after card:', afterCard.replace(/\n+/g,' | '));
  console.log('\n=== RESULTS ===');
  console.log('card tender offered where enabled:', hasCardButton);
  console.log('processor-agnostic charge approves + returns brand/last4:', cardTenderShown);
  console.log('card-paid order completes:', closed);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!hasCardButton||!cardTenderShown||!closed?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
