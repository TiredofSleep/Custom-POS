const { chromium } = require('playwright-core');
const url = 'file:///workspace/custom-pos/pos.html';
const EXE = process.env.CHROMIUM_EXE || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
(async () => {
  const errors = [];
  const b = await chromium.launch({ executablePath: EXE, args:['--no-sandbox'] });
  const ctx = await b.newContext(); const p = await ctx.newPage();
  p.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
  p.on('pageerror', e => errors.push('pageerror: '+e.message));
  await p.goto(url);
  const B = async n => p.getByRole('button',{name:new RegExp('^'+n)}).first().click();
  const changeTo = async n => { await p.getByText('change station').click(); await B(n); };
  const T = async () => (await p.locator('main').innerText());

  await B('Salon'); await B('Front Desk');
  // attach Pat, buy a $25 gift card, pay -> credits gift $25 and earns 25 pts
  await p.locator('#custPhone').fill('5551234'); await p.locator('#custName').fill('Pat');
  await p.getByRole('button',{name:/Look up \/ attach/}).click();
  await B('Gift card'); await B('Send order');
  await p.getByRole('button',{name:/Take payment \$25\.00/}).click();
  await B('Done');

  // new order: recall Pat -> shows points + gift balance
  await p.locator('#custPhone').fill('5551234');
  await p.getByRole('button',{name:/Look up \/ attach/}).click();
  const recalled = await T();
  const balancesShown = /25 pts · gift card \$25\.00/.test(recalled);

  // ring Color ($85) by Alex, run it, then redeem gift + loyalty at checkout
  await B('Color'); await B('Alex'); await B('Add to order'); await B('Send order');
  await changeTo('Chair'); await B('Mark done here');
  await changeTo('Front Desk');
  await p.getByRole('button',{name:/Pay with gift card \$25\.00/}).click();   // -25 -> 60
  await p.getByRole('button',{name:/Redeem 20 pts/}).click();                 // -5 -> 55
  const beforeCash = await T();
  const redeemedToFiftyFive = /Take balance \$55\.00/.test(beforeCash);   // paid>0 after redemptions -> "Take balance"
  await p.getByRole('button',{name:/Take balance/}).click();
  await B('Done');
  // recall again: gift should be spent (0), points adjusted (earned 85, spent 20 redeem)
  await p.locator('#custPhone').fill('5551234');
  await p.getByRole('button',{name:/Look up \/ attach/}).click();
  const after = await T();
  const spentGiftKeptPoints = /gift card \$0\.00/.test(after) || !/gift card \$2/.test(after);

  await b.close();
  console.log('recalled:', recalled.replace(/\n+/g,' | '));
  console.log('after:', after.replace(/\n+/g,' | '));
  console.log('\n=== RESULTS ===');
  console.log('gift card purchase credits balance + earns points:', balancesShown);
  console.log('gift ($25) + loyalty ($5) redeemed -> balance $55:', redeemedToFiftyFive);
  console.log('gift balance spent after redemption:', spentGiftKeptPoints);
  console.log('console errors:', errors.length?errors:'NONE');
  process.exit(errors.length||!balancesShown||!redeemedToFiftyFive||!spentGiftKeptPoints?1:0);
})().catch(e=>{ console.error('FATAL',e); process.exit(2); });
