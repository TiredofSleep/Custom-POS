# Worker Rights and Scheduling

> **Status (reconciled against the current build, engine v0.44).** Design intent handed over from a ClaudeChat
> session — *not* implementation-ready. A growing foundation exists; much is still roadmap.
>
> **Already shipped (foundations to build on):** PIN **time-clock** (punches in `DB.punches`), **paid labor
> hours** in the Z-report (now net of unpaid breaks), the **clock-in welcome/briefing**, **tips + commission**,
> the **data-ownership / export** principle (JSON backup + CSV — extend to per-worker), the processor-agnostic
> **notify seam** (SMS via a hub adapter) that the scheduling/break/reminder texts ride on, and:
> - **v0.43** — ✅ the **scheduling grid**: a weekly staff×day grid, per-worker weekly-hours total with an
>   **overtime (>40h) flag surfaced by default**, and a **publish → text every scheduled worker their shifts**
>   workflow (editing a published week silently un-publishes so nobody works off a stale copy). Builder ships a
>   `schedule` station type; the salon template ships one wired.
> - **v0.44** — ✅ **break tracking + real-time earnings + a worker-protective break-rules engine.** A
>   clocked-in worker gets an **on-shift screen**: hours worked, live **earnings** (per-person `$/hr` from the
>   builder), and **start/end unpaid break** (subtracted from paid hours *and* the shop's labor total). The
>   **break-rules engine** (`FLOW.labor`, worker-protective `LABOR_DEFAULTS`) surfaces a **meal-break reminder**
>   once a shift passes the threshold with none taken — defaults protect workers even when the operator
>   configures nothing; thresholds tune, the protection has no accidental off switch.
>
> **Net-new (this doc's remaining value):** rest-break reminders + enforceable rest-rules, the **coverage
> marketplace**, **PTO / time-off**, **incident / injury reporting** + **panic button**, **state labor-law
> modules**, the separate **worker portal**, and payroll / government export.
>
> **Honor the design principle:** worker-protective **defaults**, **core-with-configuration** — an operator can
> tune parameters but removing protections takes deliberate code editing, not a toggle.
>
> **Suggested first slice (the doc's Phase 1–2):** worker profiles → a **scheduling grid** → publish→notify,
> then **break tracking** + **real-time earnings**. Arkansas is home base; abstract against CA/WA rules early.

Cross-vertical design document for worker-facing features and scheduling infrastructure. Applies to every vertical that has employees (restaurant, dry cleaner, salon, retail, coffee, moving, print shop, auto shop, spa).

Not restaurant-specific. Referenced from vertical-specific docs where relevant.

## Design Principle

Worker rights features are first-class primitives, not optional add-ons. Default configuration protects workers. Operator can adjust but cannot silently remove protections. Overrides require explicit acknowledgment and are documented.

The tool is neutral. The defaults tilt toward worker interest. Operators who want to be extractive have to consciously configure that; ethical operators get worker-friendly defaults automatically.

## Architecture

Worker features exist across three surfaces:

**Worker Portal** — separate authentication, browser-accessible from any device (not just POS terminals). Workers see their schedules, pay, tips, breaks, requests, documents. Their private view of their own work life.

**POS Integration** — worker actions during shift (clock in, break, notes, incident reports) happen from the POS interface they're already using. Reduces friction. Data flows to worker portal automatically.

**Manager Dashboard** — operator sees aggregate scheduling, labor compliance, request queue, incident log. Standard management surface but with worker rights compliance visible so operators can't accidentally violate laws.

Three interfaces, one underlying data model. Workers own their data.

## Data Model

### Worker Profile

Each worker record contains:
- Identity (name, contact, emergency contact)
- Employment start date and status (active, on-leave, terminated)
- Position/role (server, cook, dishwasher, host, manager)
- Wage rate (hourly base, tip credit if applicable)
- State/jurisdiction (drives labor law compliance rules)
- Availability preferences (preferred days, hours, max hours per week)
- Time-off balances (PTO, sick leave, vacation)
- Certifications (food handler, alcohol service, ServSafe with expiration dates)
- Accommodations (any documented workplace accommodations)
- Language preference (for texts, portal UI)
- Notification preferences (SMS, email, portal only)

### Shift Record

Each shift stores:
- Worker ID
- Scheduled start and end
- Actual clock in and out timestamps
- Position worked
- Section or station assignment
- Breaks taken (start, end, type)
- Wages earned (calculated real-time)
- Tips earned (individual and pooled portions)
- Sales attributed to worker (for tip pool calculations)
- Incidents logged
- Notes (worker-added or manager-added)
- Compliance flags (missed breaks, unauthorized overtime, off-clock work detected)

### Schedule

Weekly schedule structure:
- Week starting date
- Published timestamp (drives predictability compliance)
- Shifts (worker, position, start, end, section)
- Change history (every modification with who and when)
- Coverage requests (workers asking to give up shifts)
- Approval status per shift and per change

## Scheduling Interface

### Manager Scheduling View

**Grid-based weekly schedule editor.**

Rows are workers, columns are days. Each cell is a shift block that can be dragged to adjust times, moved between workers, or split.

**Features:**
- Drag shifts to move between workers
- Resize shifts to change times
- Copy shifts (Ctrl+drag) for repeating patterns
- Template weeks (save typical schedule, apply to future weeks)
- Position filters (show only servers, only kitchen, etc.)
- Coverage view (does each hour have enough people)
- Cost view (labor cost per hour, per day, per week with running total)
- Compliance overlay (warnings on shifts that violate rules)

**Compliance warnings appear in real-time:**
- Overtime: worker approaching or exceeding 40 hours in a week
- Clopening: less than X hours between shifts (state-configurable)
- Minor labor: workers under 18 scheduled outside allowed hours
- Break violation: shift too long without scheduled break
- Availability conflict: shift outside worker's stated availability
- Skill mismatch: worker without required certification for role
- Predictability: schedule not published early enough per local law

Manager can override any warning but override is logged with reason.

**Publishing workflow:**
- Draft state: manager arranging shifts, workers don't see
- Preview state: manager can share draft with specific workers for feedback
- Published state: workers notified, becomes official schedule
- Change state: post-publish changes require justification and worker notification

Published schedule triggers:
- Twilio SMS to each worker with their shifts for the week
- Portal notification
- Calendar file (iCal) sent for import into worker's phone calendar
- Confirmation request from workers (acknowledge receipt)

### Worker Portal Schedule View

Worker sees only their own schedule, plus:
- Available shifts they could pick up (offered by other workers or open)
- Time-off requests they've submitted
- Availability settings
- Shift trade history
- Weekly hours accumulation with overtime forecast

**Actions available:**
- Request time off (with reason, date range)
- Post shift for coverage (offer their shift to others)
- Pick up available shift (from coverage pool)
- Update availability preferences
- Message coworker about a trade
- Acknowledge published schedule

### Coverage Marketplace

Workers can offer shifts and pick up shifts without manager approval (within configured constraints).

**Rules configurable by operator:**
- Trades require both workers meet position requirements
- Maximum hours per week enforced automatically
- Overtime shifts flagged (require manager approval)
- Skill matches required (server can't cover kitchen without training flag)
- Same-day trades allowed or require notice

**Manager visibility:**
- Sees all pending trades
- Can approve/deny if configured to require approval
- Sees completed trades with reasons
- Alerts on unusual patterns (one worker always trading out)

### Shift Reminders

Automatic Twilio SMS reminders:
- 24 hours before shift: schedule confirmation
- 2 hours before shift: shift starting soon
- On-call shifts: alert when needed

Configurable per worker preference.

## Break Management

### Break Rules Engine

State-specific break requirements loaded at configuration time. Common patterns:

- California: 30-minute meal break by 5 hours, second by 10 hours, 10-minute rest breaks per 4 hours
- Washington: 30-minute meal break for 5+ hour shifts, 10-minute rest per 4 hours
- New York: 30-minute meal break for 6+ hour shifts (industry-specific)
- Federal minimum: no federal break requirement, state law controls

Configuration reads worker's state and applies appropriate rules.

### Break Tracking Workflow

**During shift:**
- POS shows next required break time
- 15 minutes before break due: Twilio SMS to worker "Break due in 15 minutes"
- At break time: SMS "Break due now"
- Worker taps "Start break" in POS, timer starts
- Worker taps "End break" when returning, duration recorded
- If break not started 30 minutes after due: alert to manager (understaffed?)
- If break shorter than required: flag for compliance record

**Break records include:**
- Scheduled time
- Actual start
- Actual end
- Duration
- Type (rest/meal)
- Compliance status (compliant, short, missed, waived)
- Reason if non-compliant (worker choice, manager instruction, understaffing)

### Missed Break Handling

Some breaks are legitimately missed (medical emergency, unusual rush, worker chose to work through). System captures reason.

Under California law and similar jurisdictions, missed meal breaks require premium pay (one hour at regular rate). System calculates this automatically and adds to paycheck.

Worker acknowledges missed break with reason. Cannot be forced or defaulted.

Reports show break compliance rates per worker, per shift, per manager. Managers with high missed-break rates are flagged.

## Wage and Tip Transparency

### Real-Time Earnings Display

Worker sees during shift:
- Hours worked so far this shift
- Hourly wages earned so far
- Tips earned so far (individual)
- Tips earned so far (from pool if applicable)
- Total earnings for shift
- Weekly hours accumulated
- Weekly earnings accumulated
- Distance to overtime threshold

Updates in real-time as tickets close and tips are added.

### Pay Period Summary

At end of pay period, worker sees:
- Total hours (regular, overtime, holiday)
- Total wages by category
- Tip income (individual and pooled)
- Deductions (taxes, benefits, uniforms if legal)
- Expected net pay
- Comparison to previous pay period

Available for download as PDF pay stub.

### Tip Pool Transparency

If restaurant uses tip pooling:

**Configuration visible to all workers:**
- Which positions contribute
- Which positions receive
- Distribution formula (hours worked, sales generated, points system, equal split)
- Any tip-outs (bar, food runners, kitchen if legal)

**Per-shift calculation shown to workers:**
- Total tips into pool
- Their contribution
- Their share received
- Formula used
- Any tip-outs

If tip pool rules are illegal (management taking share, back-of-house sharing when tip credit is used), system flags this and warns operator during configuration. Doesn't prevent operation but creates documented record.

### Tip Credit Compliance

For states allowing tip credit (paying below minimum with tips making up difference):
- System tracks whether tips actually brought worker to minimum wage
- If not, employer must make up difference
- System calculates and adds automatic wage adjustment
- Worker sees "tip credit adjustment" as separate line

### Wage Theft Prevention

**Off-the-clock work detection:**
- If POS activity detected while worker clocked out (orders taken, tickets modified) — alert
- Manager can override with reason (worker helped with emergency situation)
- Records preserved for possible wage dispute

**Automatic clock-out prevention:**
- Manager cannot clock out worker without their acknowledgment
- If manager attempts, worker gets SMS notification with option to dispute
- Both actions logged

**Shift modification protection:**
- If actual clock times differ from scheduled significantly, requires acknowledgment
- Worker sees change and can dispute before payroll processing
- Managers cannot silently reduce worker hours

## Time-Off and PTO

### Request System

Worker submits request through portal:
- Date range
- Type (vacation, sick, personal, bereavement, jury duty, other)
- Reason (optional, not required for legal categories)
- Coverage plan (optional: "I've asked Sarah to cover")

Request appears in manager queue with:
- Automatic conflict detection (does worker have shifts scheduled?)
- Coverage suggestions (who's available?)
- PTO balance check (does worker have enough accrued?)
- Response deadline (some states require response within X days)

Manager approves/denies with reason. Denial requires documented reason if:
- Legally protected leave (FMLA, sick leave in some states)
- Sufficient notice was given
- Coverage is available

### PTO Accrual and Tracking

**Configuration:**
- Accrual rate (per hour worked, per pay period, per year)
- Different rates by tenure or position
- Rollover rules (use-it-or-lose-it, carry-over caps)
- Payout on termination (state law)

**Worker sees:**
- Current balance
- Accrual rate
- Recent usage
- Projected balance at year-end
- Expiring hours warning

**Manager sees:**
- Team balances
- Upcoming approved time off
- PTO cost forecast

### Sick Leave Compliance

Many jurisdictions now require paid sick leave (California, Washington, Arizona, cities). System tracks:
- Accrual per state requirements
- Anti-retaliation (using sick leave cannot count against worker)
- No-questions-asked policy (workers don't need to justify)
- Automatic accrual visibility

## Incident and Injury Reporting

### Worker-Initiated Reports

Workers can log incidents from POS or portal:
- Injury (minor, requires-attention, emergency)
- Safety concern (equipment, environment, procedure)
- Harassment or discrimination
- Wage discrepancy
- Manager conduct concern
- Other

Each report:
- Timestamp automatic
- Description (worker writes)
- Photos optional
- Anonymous option (report without name attached)
- Auto-forwards to management and to worker's own records
- Cannot be deleted by management (created evidence trail)

### OSHA-Relevant Documentation

Injuries logged in format suitable for OSHA 300 log if required:
- Nature of injury
- Body part affected
- What worker was doing
- What object/substance involved
- Days away from work
- Job restrictions

System auto-generates OSHA 300 log if operator is subject to reporting.

### Anonymous Feedback Channel

Separate from incident reports:
- General feedback about workplace
- Suggestions for improvement
- Concerns that don't rise to formal incident level
- Truly anonymous (system doesn't record identity even internally)
- Goes to designated manager or ownership

Prevents fear-of-retaliation from silencing legitimate concerns.

## Panic Button

Discrete emergency button available in worker portal and POS interface.

**Activation triggers:**
- Silent alert to designated manager phone (Twilio call)
- Silent alert to designated backup contact
- Optional: call to 911 if configured for immediate emergency
- Location logged (which station, which section)
- Timestamp logged
- No visible indicator to other workers or customers

**Configuration per business:**
- Who receives alerts
- Escalation if no response in X minutes
- Whether 911 is auto-called or manual
- Post-incident documentation prompt

## Disciplinary Documentation

### Progressive Discipline Support

If operator uses progressive discipline (verbal warning → written warning → suspension → termination):

- Each step documented in system
- Worker acknowledges receipt (electronic signature)
- Worker can add response
- All parties see complete record
- Cannot be modified after acknowledgment

### Termination Documentation

Termination requires:
- Documented reason
- Effective date
- Final paycheck calculation
- Return of company property checklist
- Unused PTO payout (if state requires)
- Continuation of benefits notice (COBRA if applicable)
- Reference policy (what employer will confirm to future employers)

Worker gets copy automatically. Cannot be terminated without documented cause in system.

### Anti-Retaliation Timeline

If worker reports incident and is subsequently disciplined or terminated within X days, system flags for review. Not preventing discipline but creating visibility.

Reports include:
- Wage complaints
- Safety complaints
- Harassment reports
- Union organizing activity (protected in most states)
- Regulatory reporting

## Worker-Owned Data

### Data Portability

At any time, worker can export their complete record:
- Employment history
- Hours worked
- Wages earned
- Tips earned
- Performance data
- Schedule history
- Break compliance
- Time off used
- Incident reports filed
- Disciplinary records

Format: PDF for human reading, JSON for portability to other systems.

### Post-Termination Access

Terminated workers retain access to their own records for 3 years minimum (state law varies). Can download historical data for:
- Unemployment claims
- Wage disputes
- Reference materials for job applications
- Legal proceedings

Employer cannot delete worker records within statutory retention period.

## Onboarding

### First-Day Workflow

New worker completes onboarding through portal:
- Personal information
- Emergency contacts
- Direct deposit setup
- W-4 tax withholding
- I-9 employment verification
- Handbook acknowledgment
- Job description acknowledgment
- Sexual harassment training (if required by state)
- Food handler certification upload (if applicable)
- Alcohol service certification (if applicable)
- Understanding of pay structure and tip policy
- Break entitlement acknowledgment
- Rights notification (state labor board, wage/hour info)

Each acknowledgment timestamped and signed electronically. Creates evidence trail that worker knew their rights from day one.

### Rights Notification

Every worker sees at onboarding and can access anytime:
- Minimum wage in their state
- Overtime rules
- Break entitlements
- Sick leave rights
- State labor department contact
- Workers' comp insurance carrier
- Legal aid resources
- OSHA reporting information

Not preachy. Just available.

## Compliance Reporting

### Labor Law Dashboard

Manager sees compliance status at a glance:
- Break compliance rate this week
- Overtime hours this week
- Predictability schedule (was it published on time?)
- Missed break premium pay owed
- Tip credit compliance
- Minor worker hour compliance
- Certification expirations approaching
- Required documentation completion rate

Yellow/red flags for issues that need attention. Green when compliant.

### Audit Trail

Every action logged:
- Who made the change
- What changed
- When
- Why (if reason required)
- Previous value
- New value

Cannot be modified. Provides evidence trail for:
- Wage/hour disputes
- Unemployment claims
- Discrimination cases
- Regulatory audits

### State-Specific Modules

System loads state law compliance based on business location:
- California: complex meal break rules, split shift premium, reporting time pay
- New York: spread of hours pay, call-in pay
- Washington: predictive scheduling in Seattle
- Chicago: fair workweek ordinance
- Others as needed

New states added as templates. Community can contribute state-specific configurations.

## Integration Points

### Twilio Integration

SMS for:
- Schedule notifications
- Shift reminders
- Break reminders
- Coverage requests
- Time-off request responses
- Wage/tip summaries
- Compliance alerts
- Panic button responses

Voice for:
- Panic button escalation
- Emergency notifications

Cost estimation: at scale of 20 workers with typical usage, probably $10-20/month per business. Reasonable operating cost.

### Payroll Integration

Not building full payroll. But export formats for:
- QuickBooks Payroll
- Gusto
- ADP
- Paychex
- Manual CSV

Payroll data includes hours (regular, overtime, holiday), tips, missed break premiums, PTO used, deductions consented to.

### Calendar Integration

iCal export for:
- Individual worker schedules
- Manager team view
- Time-off approved

Push to worker phones automatically.

### Government Reporting

- OSHA 300 log format
- Unemployment insurance reports
- Workers' comp reports
- EEOC reports (for businesses over threshold)

Auto-generated from underlying data.

## Priority Implementation Order

**Phase 1 - Foundation (do first):**
1. Worker profile data model
2. Schedule data model
3. Basic scheduling interface (manager view)
4. Worker portal authentication and basic schedule view
5. Twilio integration for schedule notifications

**Phase 2 - Rights basics (essential worker protection):**
6. Break tracking with Twilio reminders
7. Real-time wage and tip visibility to workers
8. Overtime warning and prevention
9. Time-off request system
10. Basic compliance dashboard

**Phase 3 - Advanced protection:**
11. Tip pool transparency and calculations
12. Wage theft prevention (off-clock detection, clock-out prevention)
13. Incident and injury reporting
14. Panic button
15. Anonymous feedback channel

**Phase 4 - Comprehensive compliance:**
16. State-specific labor law modules
17. Progressive discipline documentation
18. Anti-retaliation timeline tracking
19. Onboarding workflow with rights acknowledgment
20. Full audit trail and reporting

**Phase 5 - Ecosystem:**
21. Payroll export formats
22. Government reporting formats
23. Worker data portability tools
24. Post-termination access
25. Multi-state operator support

## Cross-Vertical Application

Every feature above applies to:
- Restaurants
- Bars
- Dry cleaners
- Salons
- Spas
- Auto shops
- Retail
- Coffee shops
- Moving companies
- Print shops
- Any vertical with employees

Restaurant-specific pieces (tip pooling, tip credit, kitchen station coordination) are configurable modules within the general framework. Non-tipped verticals disable those modules.

Some verticals have unique requirements:
- Moving companies: driver hours-of-service compliance (federal DOT rules)
- Retail: California ABC-5 gig worker classification issues
- Healthcare-adjacent (spas with medical procedures): HIPAA considerations

State and vertical combinations create configuration matrix. Build for the common case, add specific configurations as verticals develop.

## Design Philosophy Reminders

**Defaults matter.** Every default should tilt toward worker protection. Operators can override but must do so consciously.

**Documentation creates accountability.** Every action logged. Not to punish operators but to provide evidence when disputes arise.

**Workers own their data.** They can access, export, and preserve their records independent of employer.

**Transparency is a feature.** Workers see the same data managers see (about themselves). Hidden math is a red flag.

**Compliance is not optional.** State laws are minimum standards. System enforces them by default.

**Rights notification is passive.** Available, not pushy. Workers who want to know their rights can find them.

**Anti-retaliation is built in.** Timeline tracking, documented decisions, and audit trails protect against retaliation for exercising rights.

## Notes for Implementation

The scheduling interface is substantial work. Probably 100-200 hours with ClaudeCode help just for the core scheduling grid, publishing workflow, and Twilio integration.

The full worker rights suite (all phases) is probably 400-800 hours total.

Prioritize phases 1 and 2 for the initial ship. Phase 3 for restaurants specifically (highest tip theft, injury, and harassment rates). Later phases as operators adopt and demand emerges.

Consider whether some of this should be a separate module operators explicitly enable (worker-rights.js) vs. built into the core. Argument for core: defaults protect workers universally. Argument for module: operators can opt out, which is honest about what they're doing.

Recommendation: core with configuration. Operator cannot remove worker rights entirely but can configure some parameters (which state law, which specific rules). Removing protections requires code editing (they can, it's open source, but the friction is intentional).

## Testing Considerations

- Break compliance across different state rules
- Schedule change notifications reach workers
- Wage calculations correct including tip credit, overtime, missed break premium
- Coverage marketplace prevents overtime creation
- Time-off requests conflict detection
- Incident reports cannot be modified or deleted by management
- Data export includes complete worker record
- Anti-retaliation flags trigger appropriately
- Panic button alerts reach correct contacts
- Onboarding acknowledgments captured properly

## Handoff Notes

This document is design intent. Implementation-ready specifications for:
- Data model (worker profile, shift, schedule)
- Break management workflow
- Wage and tip transparency requirements
- Time-off system
- Incident reporting
- Panic button
- Onboarding workflow

Requires design work before implementation:
- Specific UI/UX for scheduling grid (multiple views, drag-and-drop mechanics)
- Worker portal design
- State-specific compliance rule engine architecture
- Integration architecture for Twilio, payroll systems, government reporting

Coordinate with Brayden on:
- Priority ordering (Phase 1 essential, later phases as ready)
- State-specific rules to implement first (Arkansas is home base; California and Washington are complex enough to force good abstractions)
- Which behaviors are core vs. configurable
- How worker portal deploys (part of same download, separate service, both)

Once foundation is built, adding vertical-specific worker rights features becomes straightforward.
