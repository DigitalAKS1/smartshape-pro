# Territory & Offline-Mail Engine (Marketing sub-project A) — Design Spec

**Date:** 2026-08-12
**Owner:** SmartShape (info@smartshape.in)
**Status:** Draft for review

## 1. Goal & core insight

Give SmartShape a **territory-based offline marketing engine** that posts physical
pieces (brochure / sample / newsletter) to schools by area **and orchestrates the
follow-up cadence that actually converts** — then feeds everything back into the CRM.

**The insight that shapes the whole design (research-grounded):** a physical mailer
is *not* a standalone act. Direct mail + coordinated digital/call follow-up gets
~63% higher response and ~53% more leads than digital alone — but only when the
mailer **opens a tracked cadence** (mailer with a QR/short-link → 8–12 well-timed
touches over 2–4 weeks, tighter early). A brochure with no follow-up is wasted
postage. So this engine tracks **"kya hua bhejne ke baad"** (delivered? responded?
appointment?) and drives the next action until the deal closes.

## 2. Scope

- **A1 — Areas + targeting:** define city/pincode areas, auto-assign schools by
  pincode, select schools for a run (using the shipped **Deal-Type filter**).
- **A2 — Mail Run:** a campaign entity (piece type, area, schools, courier,
  tracking) with a per-school **mail-touch** record; a run dashboard.
- **A3 — Response tracking:** each mailer carries a **QR / unique short-link**;
  scans + manual "delivered / responded / appointment" log to the school 360.
- **A4 — Auto follow-up cadence + reporting:** a run auto-creates the follow-up
  sequence per school (feeds Today's Actions); response-rate & cost-per-response
  reporting by area / piece / deal-type.

**Out of scope (later / other sub-projects):** the generic online cadence engine
(sub-project B), exhibitions/workshops (D), reorder engine (C). A hands *off* to
B for the digital touches but does not rebuild them.

## 3. Data model (new collections + fields)

**`mail_areas`** — `{area_id, name, kind: "pincode"|"city"|"custom", pincode?,
city?, assigned_to (rep email), school_count (cached), created_at}`.
Schools auto-map to an area by `school.pincode` (fallback `school.city`).

**`mail_runs`** — `{run_id, name, area_id, piece_type: "brochure"|"sample"|
"newsletter"|"other", deal_type_target?, school_ids[], send_date, courier,
tracking_no?, status: "planned"|"posted"|"closed", created_by, created_at,
counts: {sent, delivered, responded, appointments}}`.

**`mail_touches`** — one per (run, school): `{touch_id, run_id, school_id,
lead_id?, piece_type, posted_at, qr_token, delivery_status: "pending"|
"delivered"|"returned", responded: bool, responded_at?, response_channel?,
appointment: bool, next_action_date?, outcome_note, owner}`.
This is the row that answers "what did we send this school, and what happened."

**Fields added to existing docs:** none required on `schools`; the 360 rolls up
from `mail_touches` (like it now rolls up `fms_flows` and `deal_types`).

## 4. Phase detail

### A1 — Areas + targeting
- **Endpoints:** `GET/POST/DELETE /crm/mail-areas`; `POST /crm/mail-areas/{id}/auto-assign`
  (maps schools by pincode/city, updates `school_count`);
  `GET /crm/mail-areas/{id}/schools?filter=...` (reuses the deal-type/CRM filter).
- **Screen:** "Areas" tab — list areas + counts; open an area → the school list
  with the **existing FilterRail** (filter by deal-type: *"no New-Machine yet"*),
  multi-select schools for a run.
- **Reuse:** `crmFilter.js` + `FilterRail` (deal-type facet just shipped), schools DB.

### A2 — Mail Run
- **Endpoints:** `POST /crm/mail-runs` (creates run + a `mail_touch` per selected
  school, source-tags/creates a lead per school: `source="Direct Mail"`,
  `deal_type=run.deal_type_target`); `GET /crm/mail-runs` (dashboard),
  `GET /crm/mail-runs/{id}`, `PUT /crm/mail-runs/{id}/status`.
- **Screen:** "Mail Runs" dashboard — *kya bheja, kaun se area me, kab, courier,
  tracking* + per-school touch table with status columns.
- **Reuse:** lead auto-create pattern (from quotation `_auto_register`), courier
  fields mirror the order-dispatch pattern.

### A3 — Response tracking
- **QR/link:** each `mail_touch` gets a `qr_token`; the printed piece shows a QR to
  `/r/<qr_token>` (public). A scan logs `responded=true, response_channel="qr"` and
  opens a simple "interested / call me" capture (creates/links a lead).
- **Endpoints:** public `GET /r/{qr_token}` (log + landing), staff `PUT
  /crm/mail-touches/{id}` (manual delivered/responded/appointment/outcome).
- **360:** add a **"Offline Mail" block** to `get_school_profile` (list touches +
  status), same pattern as the `fms_flows` block just shipped.
- **Reuse:** the existing QR generation (used for forms), the public-token pattern
  (`/f/<token>`, `/catalogue/<token>`).

### A4 — Auto follow-up cadence + reporting
- **Cadence:** on run "posted", each `mail_touch` schedules the follow-up sequence
  (call in 2–3 days → email/WhatsApp → next touch), written as CRM tasks/follow-ups
  so they appear in **Today's Actions** with the school context + "referenced the
  mailer" note. Hands the digital touches to sub-project B when built.
- **Reporting:** `GET /crm/mail-runs/reports` — per area/piece/deal-type: sent →
  delivered → responded → appointment → converted, response-rate, and (if courier
  cost entered) cost-per-response.
- **Reuse:** Today's Actions/attention engine, email/WhatsApp scheduler, the funnel
  reporting pattern.

## 5. Reuse map (build on, don't rebuild)

| Need | Reuses |
|---|---|
| Who to mail (targeting) | **Deal-Type filter + FilterRail** (shipped) |
| Lead per mailed school | quotation `_auto_register` lead-create pattern |
| Courier + tracking | order-dispatch fields |
| QR + public landing | forms/catalogue public-token + QR infra |
| 360 "Offline Mail" block | the `fms_flows` / `deal_types` rollup pattern (shipped) |
| Follow-up cadence | Today's Actions + tasks/follow-ups + email/WhatsApp scheduler |

**Net-new:** `mail_areas`, `mail_runs`, `mail_touches`, the QR-response route, and
the mail→cadence trigger.

## 6. Acceptance criteria (per phase)

- **A1:** an admin can create a "Rohini (110085)" area, see its schools
  auto-assigned by pincode, filter them by deal-type, and select a subset.
- **A2:** creating a mail run records the piece/courier/date and produces one
  trackable touch (+ a Direct-Mail lead) per selected school, visible on a dashboard.
- **A3:** scanning a mailer's QR logs a response against that school and shows on
  its 360; staff can mark delivered/responded/appointment.
- **A4:** posting a run seeds each school's follow-up in Today's Actions; a report
  shows response-rate by area/piece.

## 7. Build sequence

A1 → A2 (backbone, independently useful) → A3 (response) → A4 (cadence + reporting).
Each phase ships and deploys independently, test-first, behind the owner's deploy
sign-off (same discipline as the shipped features).

## 8. Decisions (expert defaults — owner can veto any)

1. **Courier cost:** an **optional** `courier_cost` field per run. If filled, reporting
   shows cost-per-response; if blank, that metric is simply hidden. No forced data entry.
2. **QR landing page:** a **simple self-contained "I'm interested — call me" capture**
   (name/phone auto-prefilled from the touch), which creates/links a lead. Keeps A
   independent of the teacher-registration form; can add a "learn more" link to that
   form later.
3. **Default follow-up cadence** (editable in Settings, per the research "tight early"):
   **Day 2 — call · Day 4 — WhatsApp · Day 7 — email · Day 12 — call · Day 18 — final call.**
   Each step written as a CRM task/follow-up so it lands in Today's Actions.

These are defaults, not locks — each is a single config value the owner can change
without a rebuild.
