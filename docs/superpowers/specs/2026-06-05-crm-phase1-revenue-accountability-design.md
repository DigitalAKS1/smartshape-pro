# CRM Phase 1 — Revenue & Forecast + Stop Leads Dying

**Date:** 2026-06-05
**Status:** Design approved (brainstorm), pending implementation plan
**Scope:** Phase 1 of a 4-phase CRM upgrade roadmap (see Roadmap section).

---

## Goal

Turn the existing School CRM (`app.smartshape.in/leads`) from a *list of leads* into a
*revenue-forecasting + accountability* tool, benchmarked against HubSpot CRM practices.

Phase 1 delivers two clusters together:

1. **Revenue & Forecast** — put a ₹ value on every lead, show a weighted pipeline forecast,
   capture lost reasons, and report a conversion funnel.
2. **Stop Leads Dying** — flag neglected leads (overdue / stuck / no next action), warn on
   stage change without a next step, and send a daily "needs attention" digest.

## Architecture decision

**Approach B — compute on read.** Persist only *real data* on the lead and an admin settings
doc; calculate everything *derived* (weighted value, attention flags, funnel %) live at query
time and inside the digest job. Matches how the CRM already computes stage/score/visit-required.
Dataset is hundreds–low-thousands of leads, so live computation is effortless. No precomputed/
cached forecast fields, no staleness, minimal schema growth.

---

## Section 1 — Data model (the only new stored data)

### New fields on each lead (`db.leads`)
- `expected_value` — number (₹). Rep's manual estimate. Auto-overridden by linked quotation
  grand_total when a quotation is linked (see deal-value resolution).
- `lost_reason` — string. Required only when stage becomes `lost`. One of the admin list.
- `lost_reason_note` — string, optional free text.

### New admin settings doc (`db.crm_settings`, single document, admin-editable in UI)
- `stage_probabilities` — map stage → win %. Defaults:
  `new 10, contacted 20, demo 30, quoted 50, negotiation 70, won 100, lost 0`.
  (retention/resell excluded from open-pipeline forecast.)
- `stage_idle_limits` — map stage → max idle days before "stuck". Defaults:
  `new 7, contacted 5, demo 4, quoted 4, negotiation 3, retention 30, resell 14`.
- `lost_reasons` — editable list. Defaults: `Price, Competitor, No budget, No response, Timing, Other`.
- `digest_time` — HH:MM, when the daily digest sends. Default `08:00` IST.
- `digest_enabled` — boolean. **Default `false`** (safety; see Safety section).

Total stored footprint: 3 lead fields + 1 settings doc. Everything else is computed.

---

## Section 2 — Revenue & Forecast logic (computed on read)

### Deal value resolution (per lead)
1. If ≥1 quotation linked → `value = latest linked quotation's grand_total` (source of truth).
2. Else → `value = expected_value` (manual estimate).
3. Else → no value; excluded from forecast totals, shown as "—".

### Weighted forecast
- `weighted_value = value × stage_probabilities[stage]`.
- Only **open** stages count toward pipeline forecast: new, contacted, demo, quoted, negotiation.
  (won = closed-won actuals, reported separately; lost/retention/resell excluded.)
- Surfaced as: total pipeline value, total weighted value, per-stage breakdown
  (count + ₹ + weighted ₹), and per-rep totals.

### Lost-reason capture
- Moving a lead to `lost` requires selecting a `lost_reason` from the admin list; optional note.

### Conversion funnel report (computed)
- Stage-to-stage progression New → Contacted → Demo → Quoted → Negotiation → Won:
  count at each stage and % advanced from previous stage.
- Average days per stage, derived from `pipeline_history` timestamps (already recorded).
- Win/Loss summary: won count & value vs lost count, with **lost reasons broken down**.
- Filterable by date range, rep, and source.

### Permissions
- admin → all leads; sales → own assigned leads only; accounts/store → no CRM (unchanged RBAC).

---

## Section 3 — Stop Leads Dying logic (computed on read + one scheduler job)

### "Needs attention" — open lead flags if ANY is true
- **Overdue follow-up** — `next_followup_date` passed and no follow-up marked complete.
- **Stuck/rotting** — days since `last_activity_date` ≥ `stage_idle_limits[stage]`.
- **No next action** — no upcoming follow-up and no open task.

Each reason yields its own badge (e.g. "Overdue 3d", "Stuck", "No next step").

### Warn on stage change
- Advancing a stage without an upcoming follow-up/task shows a dismissible reminder
  ("Set a next step for this lead?") with a "schedule now" shortcut. Non-blocking.
- Exception: moving to `lost` shows the **required** lost-reason picker instead.

### Daily digest (reuses existing WhatsApp + email scheduler infra)
- Runs at `digest_time` when `digest_enabled` is true.
- Each sales rep → own message: their overdue, stuck, and no-action leads (grouped, counts,
  top few by priority/value).
- Admin → team-wide summary: per-rep counts of overdue/stuck/no-action + total at-risk ₹.
- Channel: matches existing rep-notification channel (WhatsApp primary, email fallback);
  no new delivery service.

### In-app "Needs Attention" view
- A filter/segment on the Leads page showing flagged leads for the current user
  (admin sees all), sortable by reason and value. The digest links here.

---

## Section 4 — UI surfaces & endpoints

### Where each piece appears
- **Lead form (`LeadFormDialog`):** `expected_value` ₹ input when no quotation linked;
  read-only "from quotation" display when linked.
- **Lead detail panel (`LeadDetailPanel`):** value, weighted value, stage probability,
  attention badges.
- **Lead cards / table (`LeadsCRM`, `SalesLeads`, card components):** value column, weighted
  value, attention badges; "Needs Attention" filter.
- **Lost stage flow:** required `lost_reason` dropdown + optional note.
- **Forecast widget:** pipeline total, weighted total, per-stage breakdown, per-rep — on the
  CRM dashboard/analytics area.
- **Conversion funnel report:** new analytics view with date/rep/source filters.
- **Admin Settings page:** edit `stage_probabilities`, `stage_idle_limits`, `lost_reasons`,
  `digest_time`, `digest_enabled`. Admin-only.
- **Stage-change reminder modal:** the warn-on-change nudge.

### Backend endpoints (extend `crm_routes.py`)
- Extend lead create/update to accept `expected_value`, `lost_reason`, `lost_reason_note`
  (validate lost_reason required when stage→lost).
- `GET /crm/forecast` — totals + per-stage + per-rep weighted forecast (RBAC-scoped).
- `GET /crm/funnel` — funnel counts, conversion %, avg days/stage, win/loss, lost-reason breakdown.
- `GET /crm/needs-attention` — flagged leads for current user (RBAC-scoped) with reasons.
- `GET/PUT /crm/settings` — read/update the crm_settings doc (PUT admin-only).
- Digest scheduler job — computes needs-attention per rep + admin summary, sends via existing scheduler.

---

## Safety (production-data guardrails)

Running the backend locally targets the **production DB** and fires **real** WhatsApp/email
schedulers. Therefore:
- `digest_enabled` defaults to **false**; the digest job no-ops until explicitly enabled.
- The digest job supports a **dry-run mode** (env flag or settings toggle) that logs the exact
  messages it *would* send instead of sending them, for safe local verification.
- All new read endpoints are non-mutating. The only writes are the 3 lead fields and the
  settings doc, both via explicit user action.

---

## Out of scope (deferred to later phases)

- Per-lead probability override (chose auto-per-stage).
- Email open/click tracking, web-form capture, SMS, chatbot.
- Unified activity timeline, saved views, mobile quick-log → **Phase 3**.
- Auto round-robin on capture, tunable lead scoring, duplicate detection → **Phase 4**.

## Roadmap (full program)

1. **Phase 1 (this spec):** Revenue & Forecast + Stop Leads Dying.
2. **Phase 2:** (folded into Phase 1 per user request — was "Stop Leads Dying").
3. **Phase 3:** One Clear Lead View — unified timeline, saved views, mobile quick-log.
4. **Phase 4:** Assignment & Scoring — auto round-robin by capacity, tunable scoring, dedupe.

---

## Success criteria

- Every open lead can carry a ₹ value (manual or from quotation) and appears in a weighted forecast.
- Admin sees total + weighted pipeline, per-stage and per-rep, plus a conversion funnel with
  lost-reason breakdown.
- Neglected leads are visibly flagged in-app with clear reasons.
- Reps and admin can receive a daily digest (once enabled), with a safe dry-run path.
- All settings (probabilities, idle limits, lost reasons, digest time) are admin-tunable without
  a code change. No regression to existing RBAC scoping.
