# School · Contact · Lead · Pipeline — a CRM specialist's review and roadmap

**Date:** 2026-09-05
**Status:** proposal for the owner
**Scope:** the data model and sales process, not the screens

---

## The business this CRM has to describe

SmartShape sells two very different things to the same customer:

- **A machine.** Capital equipment. Long cycle, demo-led, one per school, high value,
  bought once.
- **Dies, stamps and consumables.** An annuity. Short cycle, repeat, low value each,
  bought forever once the machine is in the building.

Almost every finding below comes from the same root: **the CRM models the first
motion and has nowhere to put the second.** That matters commercially, because
the second is where the margin compounds — a school that bought a machine in 2024
should be generating die orders every term, and the system currently has no way
to see, forecast or chase that.

## What is already right

Worth saying plainly, because the rest of this is criticism.

- **School / Contact / Lead is the correct three-entity spine.** Account, person,
  opportunity. Most small CRMs collapse these and regret it. This one didn't.
- **Ownership and scope are properly modelled** — per-module grants with own/all,
  enforced server-side, not just hidden in the UI.
- **Stage probabilities and idle limits are configurable, per stage.** Many
  commercial CRMs charge for that.
- **The engagement timeline and ledger** (from the Engagement OS work) are a
  genuinely good foundation that the rest of the model doesn't yet use.
- **Deal Type already exists** — New Machine, Reorder Dies, New Dies, Sample.
  The vocabulary for the second motion is there. The model just can't act on it.

---

## Findings

### 1. "Lead" is doing two jobs, and they need different rules

`leads` is simultaneously the unqualified enquiry ("a school scanned a QR code")
and the deal being worked ("₹4.2 lakh machine, closing in March"). Those want
opposite handling: an enquiry should be cheap, disposable, and either qualified
or binned; a deal should have a value, a close date, a next step, and be
forecast.

Because they are one record, an enquiry sits in your pipeline value from day one
at 10% probability, and a real deal carries the same fields as a QR scan.

**Symptom you can see:** the pipeline's Open Value includes every unqualified
enquiry ever created.

### 2. A school can only have one open opportunity at a time

`_upsert_direct_mail_lead` reuses any lead that is not `won`/`lost`. So when a
school is evaluating a machine *and* due to reorder dies, the second one has
nowhere to go — it overwrites the first's source and deal type.

This is the annuity problem in its sharpest form. `deal_type` exists precisely
because these are different deals; the model forbids them from coexisting.

### 3. `retention` and `resell` are account states wearing pipeline clothes

They are stages in a pipeline whose terminal state is `won`, and they carry
probability **0**. Two consequences:

- Moving a happy repeat customer to `retention` **removes them from your
  forecast**. Your most reliable future revenue scores zero.
- `resell` has an idle limit of 14 days, so a customer who reorders termly is
  permanently "stuck".

Retention is not a step towards a sale. It is what an account *is* between sales.

### 4. Won value is a guess, not money

`expected_value` is typed by a rep. Orders carry `lead_id` and update the lead,
so the link exists — but the funnel and the win-rate reports read
`expected_value`, not the order total. So:

- Reported won value never reconciles with what was invoiced.
- Nobody can answer "what is a demo actually worth?", which is the number that
  decides whether demos are worth doing.

### 5. Activity lives in four places

`tasks`, `followups`, `call_notes`, and `engagement_events`. To answer "what has
anyone done with this school", four collections have to agree. The engagement
ledger was built to be the single answer and is only partly wired.

### 6. Nothing enforces a next step

`next_followup_date` exists and idle limits exist, but a deal with no next step
is not an error — it is just quiet. In practice this is the single largest
source of pipeline rot in any sales team, and the cheapest thing to fix.

### 7. Qualification is undefined

School holds `school_strength`, `board`, `annual_budget_range`, `school_type` —
everything needed to say "this is a good-fit account" — and none of it informs
priority. Reps prioritise by whoever called most recently.

---

## Roadmap

Four phases. Each ships on its own and is useful before the next starts. Ordered
by return, not by difficulty.

### Phase 1 — Make the pipeline tell the truth *(highest return, lowest risk)*

No model changes. Fix what the numbers mean.

1. **Split the funnel from the forecast.** Open Value counts only qualified
   deals. Unqualified enquiries get their own count, not a rupee figure.
2. **Won value reads the order, not the guess.** Where a won lead has orders,
   report the invoiced total; flag won deals with no order as unreconciled — that
   list is itself worth having.
3. **Retention and resell leave the probability table.** They stop scoring 0 and
   stop being "stuck"; they move to an account state (Phase 2) and, until then,
   are simply excluded from pipeline maths rather than dragging it down.
4. **Every open deal needs a next step.** A deal with no `next_followup_date` is
   surfaced as a defect on the rep's own dashboard — not a nag email, a visible
   count they can clear.

**You get:** a forecast you can act on, and a weekly number that reconciles with
your invoices.

### Phase 2 — Separate the account's life from the deal's life

1. **Account status on School** — Prospect · Customer · Dormant · Lost, derived
   from order history rather than typed. A school that has ever ordered is a
   Customer, permanently.
2. **Retire `retention`/`resell` as stages**, replacing them with that status
   plus the reorder motion in Phase 3.
3. **Lifecycle dates on School** — first order, last order, last contact. Three
   fields that make "who has gone quiet" a query instead of a hunch.

**You get:** "show me customers who haven't ordered in two terms" — which is the
list your business actually runs on.

### Phase 3 — Let the annuity exist

1. **Allow concurrent open deals per school**, keyed by `deal_type`. One machine
   deal and one die reorder can be open at once; the dedup rule becomes "one open
   deal per school *per deal type*".
2. **A short reorder pipeline** — Due · Contacted · Ordered — separate from the
   machine pipeline, because a reorder does not need a demo or a negotiation and
   should not be measured as if it did.
3. **Reorder due dates from order history.** A school that buys dies every March
   generates a Due deal in February, automatically. This is the single feature
   most likely to increase revenue, because it converts your existing customer
   base into a working list without anyone remembering anything.

**You get:** repeat business becomes a pipeline you can see and chase, instead of
whatever the reps happen to recall.

### Phase 4 — Prioritise by fit, not by recency

1. **A fit score on School** from data you already hold — strength, board, type,
   budget band, and whether they own a machine.
2. **Sort the rep's day by fit × stage age**, so the best-fit stalled deal is top,
   not the noisiest one.
3. **Win/loss by segment.** With Phase 1's real money and Phase 2's account
   status, "we win CBSE schools over 1,000 students and lose small state-board
   ones" becomes a report rather than an opinion — and that changes who you mail.

**You get:** the answer to which schools deserve a rep's time.

---

## What I would not build

- **A separate Lead object with a conversion step.** Textbook CRM, wrong here:
  it adds a hand-off ceremony to a four-person team. Qualification is better as a
  flag on the deal than as a second entity.
- **Custom stage builders.** The stages are nearly right; making them
  configurable would freeze the current confusion in place.
- **Forecast categories (Commit/Best Case/Pipeline).** Real value, but only once
  Phase 1's numbers are trustworthy. Sophistication on top of guesses is worse
  than nothing.
- **Lead scoring by behaviour.** The engagement ledger could support it, but fit
  scoring (Phase 4) pays off sooner for a business with this few accounts.

---

## Suggested order

Phase 1 first, and possibly on its own for a while. It is a few days of work, it
touches no data model, and it makes every number on the dashboard mean something
— which is the precondition for trusting anything built after it.

Phase 3 is the one with revenue attached. It should not start before Phase 2,
because concurrent deals without an account status just doubles the confusion.
