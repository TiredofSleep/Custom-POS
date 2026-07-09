export const meta = {
  name: 'persona-templates',
  description: 'Run diverse business-owner personas through customPOS; each designs a POS and emits an engine-valid starter template + surfaces gaps; an auditor scores handoff-readiness.',
  phases: [
    { title: 'Personas', detail: 'each owner designs their POS + emits a template proposal' },
    { title: 'Audit', detail: 'validate configs, dedupe, verdict on handoff-readiness' },
  ],
}

// The engine contract personas must respect (mirrors builder.html TEMPLATES + pos.html MODULES).
const SPEC = `
customPOS TEMPLATE SHAPE (each is a plain JSON object):
{
  flowId, label, topology:("linear"|"hub-and-spoke"), blurb,
  branding:{ name, brandColor },
  endpoints:{
    customer:{persist:true|false},
    payment:{ tenders:[ "cash","card","account" ], closeGate:"balanceLE0",
              tip:{presets:[15,18,20]}?, split:true?, deposit:{pct:50}?, points:["deposit-balance"]? },
    tax:{rate:0.08}?, notify:{template:"Hi {name}, #{number} at {biz} is ready."}?,
    loyalty:{earnPerDollar:1,redeemPoints:100,redeemValue:5}?, quotes:true?, print:true?, scan:true?,
    discounts:true?, approvals:{refund:true}?, roundUp:{cause:"..."}?
  },
  timer:{ mode:("due"|"aging"), promiseSec?, warnSec?, badSec?, label } ?,
  capacity:{ perOrderMins, max } ?,  kds:{warnSec,badSec} ?,
  floor:{ label, tables:[ {id,label,seats} ] } ?,
  performers:["Alex","Sam"] ?,  commission:{pct:40} ?,
  catalog:[ { id, name, price, category, path:[...station ids],
              cost?, ageRestricted:(18|21)?, serialized:true?, customPrice:true?,
              stock?, reorderAt?, par?,
              modifiers:[{group,required,options:[{name,price}]}]?, addons:[{name,price}]?, flags:["..."]? } ],
  stations:[ { id, type, label, view:{money:true|false, external:true?}, checklist:["..."]? } ]
}
VALID station "type" values (each lights up a module): central, intake, fulfillment (Core) ·
production (kitchen/back-of-house) · staging (rack/shelf) · board (status board) · tracker (customer status, use view.external:true) ·
report (reports/commission) · detail (itemize/tag) · route (delivery) · timeclock · booking (appointments) ·
kds (kitchen display) · floor (table plan; needs endpoints... no—needs top-level floor{}) · schedule · worker (worker portal).
RULES: every path[] id must be a station id that exists. Money is taken at central/intake/fulfillment stations (view.money:true).
customPrice:true items prompt for a price at ring time (good for by-weight/by-quote). ageRestricted gates a checkout ID check.
Keep it REAL and minimal — only turn on what this business actually needs.`

const EXISTING = 'retail, convenience, counter, foodtruck, market, mobile, bar, dispensary, cafe, cleaner, ozark, repair, salon, burgerbarn, bistro, blank'

const PERSONAS = [
  { seed:'bakery',      who:'the owner of a small neighborhood BAKERY who takes custom cake pre-orders (deposit + pickup day) and also sells pastries over the counter. Not very techy — wants it simple.' },
  { seed:'butcher',     who:'a BUTCHER / DELI owner who sells most things BY WEIGHT (price per pound, entered at the counter) plus some fixed-price sandwiches. Sharp operator, wants accurate money.' },
  { seed:'pizzeria',    who:'a PIZZERIA owner who does phone + walk-in orders, makes pizzas in the back, and DELIVERS to homes. Moderately techy.' },
  { seed:'barbershop',  who:'a BARBERSHOP owner with 3 barbers who work on commission + tips, mostly walk-ins with a waiting queue, some appointments. Practical, not techy.' },
  { seed:'scoop',       who:'an ICE CREAM / scoop shop owner — fast counter, cones vs cups vs sizes as options, summer rush. Low-tech, wants dead simple + fast.' },
  { seed:'consignment', who:'a CONSIGNMENT / THRIFT store owner — every item is one-of-a-kind (unique price, tracked individually), pays consignors their share later. Detail-oriented.' },
  { seed:'florist',     who:'a FLORIST who sells arrangements (often custom-priced to the order), takes phone orders, and DELIVERS. Texts customers when ready. Fairly techy.' },
  { seed:'boba',        who:'a BOBA / bubble-tea shop owner — lots of drink customizations (sweetness, ice, toppings), made-to-order with a make-line display, tips. Young, comfortable with tech.' },
]

const PROPOSAL_SCHEMA = {
  type:'object', additionalProperties:false,
  required:['key','template','rationale','modulesUsed','gaps','wouldHandoff'],
  properties:{
    key:{type:'string', description:'short lowercase template key, NOT one of the existing ones'},
    template:{type:'object', description:'a COMPLETE, engine-valid TEMPLATES entry object per the SPEC'},
    rationale:{type:'string', description:'one or two sentences: why this shape fits the business'},
    modulesUsed:{type:'array', items:{type:'string'}, description:'the module/station types this design turns on'},
    gaps:{type:'array', items:{type:'string'}, description:'anything the engine could NOT express for this business (empty if none)'},
    wouldHandoff:{type:'boolean', description:'true if a non-technical owner of this business could realistically run their day on the built POS'},
  }
}

phase('Personas')
const proposals = await parallel(PERSONAS.map((pz, i) => () =>
  agent(
    `You are ${pz.who}\n\n` +
    `You just found customPOS.org — a free tool where you answer a few questions and download a point-of-sale you own. ` +
    `Design YOUR shop's POS. Think about how you actually take orders and money, what happens between the order and the customer getting it, ` +
    `who works for you, and how customers pay. Then express it as ONE engine-valid starter template.\n\n` +
    `${SPEC}\n\n` +
    `Existing templates (do NOT duplicate these keys/shapes; yours must be genuinely different): ${EXISTING}.\n` +
    `Your template key should relate to "${pz.seed}".\n\n` +
    `Return the template plus: an honest note of anything the engine could NOT do for your business (gaps), ` +
    `and whether a non-technical owner like you could really run the day on it. Be concrete and realistic — ` +
    `a real menu with real prices, only the stations/modules you truly need.`,
    { label:`persona:${pz.seed}`, phase:'Personas', schema:PROPOSAL_SCHEMA }
  )
))

const valid = proposals.filter(Boolean)
log(`${valid.length}/${PERSONAS.length} personas produced a template`)

phase('Audit')
const AUDIT_SCHEMA = {
  type:'object', additionalProperties:false,
  required:['handoffReady','blockers','majors','minors','bestTemplates','newGaps','summary'],
  properties:{
    handoffReady:{type:'boolean'},
    blockers:{type:'array', items:{type:'string'}, description:'must-fix issues that stop a real owner cold'},
    majors:{type:'array', items:{type:'string'}},
    minors:{type:'array', items:{type:'string'}},
    bestTemplates:{type:'array', items:{type:'string'}, description:'keys of the strongest, most-reusable community-seed templates worth shipping'},
    newGaps:{type:'array', items:{type:'string'}, description:'genuinely new engine gaps surfaced this round, deduped'},
    summary:{type:'string'},
  }
}
const audit = await agent(
  `You are a demanding QA lead auditing whether customPOS is ready to hand to real, non-technical small-business owners.\n` +
  `RECENT FIXES already shipped: cash change-making; a deeper guided interview (staff roles, a refund-approval gate, an editable ready-text message, and an honest note that "card" records a sale but doesn't charge yet); custom-price items with quantity steppers.\n\n` +
  `Here are ${valid.length} POS designs that business-owner personas just built, as JSON:\n` +
  valid.map(p => `### ${p.key}\n- rationale: ${p.rationale}\n- modulesUsed: ${(p.modulesUsed||[]).join(', ')}\n- gaps: ${(p.gaps||[]).join(' | ')||'none'}\n- wouldHandoff: ${p.wouldHandoff}\n- template: ${JSON.stringify(p.template)}`).join('\n\n') +
  `\n\nAssess: (1) Are these configs engine-valid per the SPEC below (every path[] points at a real station, money stations exist, no invented fields)? ` +
  `(2) Which are the strongest, most-reusable community-seed templates worth shipping to everyone? ` +
  `(3) What GENUINELY NEW gaps did this round surface (dedupe against the known ones: single flat tax rate, no live email transport, card is a simulator until a processor is connected, age-verify is honor-system with no DOB capture)? ` +
  `(4) Overall: is it handoff-ready, and what (if anything) still blocks a real owner?\n\n${SPEC}`,
  { label:'auditor', phase:'Audit', schema:AUDIT_SCHEMA }
)

return { proposals: valid, audit }
