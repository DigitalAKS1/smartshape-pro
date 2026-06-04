# FMS "Fix + Complete" — Design Spec

**Date:** 2026-06-04
**Author:** Aman Shrivastava (with Claude)
**Status:** Approved for planning
**Scope:** Fix bugs in the existing Flow Management System and complete the three missing pillars (correct TAT, notifications, RBAC). No rewrite.

---

## 1. Background

SmartShape Pro already has a substantial FMS:

- **Backend:** `backend/routes/fms_routes.py` (~852 lines) — flows, stages, complete/approve/reject, QC, pre-dispatch checklist, payment milestones, dashboard, score report, templates, calendar. Auto-creates delegation tasks per active stage.
- **Frontend:** `frontend/src/pages/admin/FlowManagement.js`, `components/fms/{FMSDashboard,FlowList,FlowDetailPanel,FlowFormDialog}.js`, `hooks/useFlowManagement.js`.

A deep-research pass (BPMN 2.0, Freshservice/Microsoft Dynamics SLA docs, APScheduler, Goodhart's Law; 23 verified claims) confirmed the architecture is sound but surfaced that the FMS *looks* complete while the three things that make it an "autopilot accountability system" — correct TAT, notifications, and RBAC — are buggy or absent.

This spec keeps the existing lightweight MongoDB model (research explicitly warns against embedding a heavyweight BPMN engine for live UI workflows) and fixes/completes it.

## 2. Goals

1. Fix four concrete bugs (TAT timezone, live status placeholder, scoring, reject overwrite).
2. Build the missing notification engine (staff + customer, WhatsApp + Email) reusing existing infrastructure.
3. Enforce role-based access on FMS routes, including field-level masking and stage edit-locks.
4. Add lightweight completeness: audit log and pause/hold.

## 3. Non-goals

- No Zoom / webinar / certificate subsystem (separate project, parked).
- No heavyweight BPMN engine (Camunda etc.).
- No new scheduler dependency (APScheduler) — reuse `backend/scheduler.py`.
- No priority-tier SLAs, 24×7 calendar mode, or trend-graph dashboards (these were the "Full overhaul" option, deferred).

## 4. Key architecture decision: reuse the existing scheduler

The project already has `backend/scheduler.py`: four perpetual `asyncio` loops started from FastAPI startup via `start_scheduler()`, including `email_sender_loop` and `wa_sender_loop` (queue flushers, every 2 min) and a daily `greeting_loop`. There is also a proven Evolution WhatsApp client (`backend/services/evolution_client.py`, singleton `evolution`) and a SMTP helper (`_smtp_send`).

**Decision:** Add **one new loop** — `fms_sla_loop` — to `scheduler.py`, wired into `start_scheduler()`. It runs every 5 minutes, scans active stages, computes live TAT %, and on each not-yet-fired threshold sends the notification and records it for dedupe.

**Send path:** FMS notifications send directly via the `evolution` client (WhatsApp) and `_smtp_send` (email), because memory and code indicate Evolution is the live WhatsApp integration. The `wa_sender_loop` queue uses WABA providers (Gupshup/360dialog/Meta), which is a different path; FMS will not use that queue to avoid a provider mismatch. Each send is logged to `fms_notifications` with status for observability and retry.

> Open item for implementation: confirm Evolution is connected in production (`evolution.is_connected()`); if the business instead uses a configured WABA provider, the send helper can branch. Default = Evolution.

## 5. Detailed design

### 5.1 Bug fixes (`fms_routes.py`)

**B1 — TAT timezone.** `calculate_plan_time` and `working_minutes_elapsed` currently treat office hours `10..18` as UTC, but the business runs on IST. Fix: do the office-hours/holiday walk in IST (`IST = UTC+5:30`, already defined in `scheduler.py`), convert inputs UTC→IST at entry and the result IST→UTC at exit. Storage stays ISO-UTC. Add a focused unit test: an order created 17:50 IST Friday must start its clock 10:00 IST Monday.

**B2 — `tat_status()` live status.** Remove the dead placeholder (`pct = (now - planned_dt + (planned_dt - planned_dt))`). New logic given `plan_start`, `plan_done`, optional `actual_done`:
- If `actual_done`: `green` if `actual_done <= plan_done` else `red`.
- Else compute `pct_elapsed = (now - plan_start) / (plan_done - plan_start)` clamped ≥0:
  - `pct < 0.5` → `green`
  - `0.5 ≤ pct < 0.8` → `orange`
  - `0.8 ≤ pct < 1.0` → `red`
  - `pct ≥ 1.0` → `overdue`
- Thresholds read from `fms_settings` (see 5.2) so they match notification thresholds.

**B3 — `score_stage()`.** Replace hardcoded `planned_mins = 60` with the stage's real budget. Signature becomes `score_stage(plan_start, plan_done, actual_done)`; `planned_mins = (plan_done - plan_start) in minutes`. Early finish > 100 capped at 100; 2× over budget → 0; linear between. Done-late and never-done both score 0.

**B4 — `reject_stage`.** Stop the double-write that overwrites `rejected` with `active`. On reject: set the stage `status = "rejected"`, persist `reject_reason`, `approval_status = "rejected"`, `approval_by`, `rejected_at`. Then create a **new redo stage** (same `order`, `key + "_redo"`, fresh plan times) set to `active`, mirroring the QC-fail rework pattern already in the file. Append both events to `fms_stage_logs`.

### 5.2 Settings additions (`fms_settings` doc, served by `GET/PUT /fms/settings`)

Extend the existing settings object (currently `office_start`, `office_end`, `weekly_off`, `holidays`) with:

```
status_warning_pct:   0.5     # orange threshold (elapsed)
status_red_pct:       0.8     # red threshold (elapsed)
notify_warning_pct:   0.5     # remaining-time threshold for 1st reminder
notify_escalate_pct:  0.2     # remaining-time threshold for 2nd reminder
notify_on_breach:     true    # fire at/after plan_done
notify_channels:      ["whatsapp", "email"]
templates: {
  staff_warning:  "Reminder: {stage} for {title} ({ref}) is due by {due}.",
  staff_escalate: "URGENT: {stage} for {title} ({ref}) is nearly overdue (due {due}).",
  staff_breach:   "OVERDUE: {stage} for {title} ({ref}) missed its deadline ({due}).",
  manager_breach: "{assignee} missed {stage} for {title} ({ref}), due {due}.",
  customer_stage: "Hi {customer_name}, update on your order {ref}: {stage} is complete."
}
```

`PUT /fms/settings` whitelist is extended to accept these keys. All have safe defaults so existing installs work unchanged.

### 5.3 Notification engine

**New collection `fms_notifications`** — dedupe + audit:
```
{ notif_id, flow_id, stage_id, kind, threshold,   # kind: staff_warning|staff_escalate|staff_breach|manager_breach|customer_stage
  channel, recipient, status, error, sent_at }
```
Unique guard: a given `(stage_id, kind, channel)` is sent at most once.

**`fms_sla_loop` (in `scheduler.py`, every 5 min):**
1. Load `fms_settings` (office hours, thresholds, templates, channels).
2. Query active stages: `db.fms_stages.find({status: "active"})`.
3. For each stage compute remaining = `(plan_done - now)`; `pct_remaining = remaining / (plan_done - plan_start)`.
4. Determine which staff threshold the stage now satisfies (warning when `pct_remaining ≤ notify_warning_pct`, escalate when `≤ notify_escalate_pct`, breach when `now ≥ plan_done` and `notify_on_breach`). For each not-yet-sent `(stage_id, kind, channel)`:
   - Resolve recipient: stage `assigned_to` (lookup `del_employees` / users for phone+email). For `manager_breach`, resolve the assignee's manager/department head.
   - Render template, send via channel helper, insert `fms_notifications` record with result.
5. Paused stages (status `paused`) are skipped entirely.

**Customer-notify-on-complete:** triggered synchronously in `complete_stage` / `_advance_flow`, not the loop. When a completed stage's template definition has `customer_notify: true` and the flow has a `customer_phone`/`customer_email`, render `customer_stage` and send (also recorded in `fms_notifications`). Add `customer_notify: bool` to the stage definition schema (templates and the `ORDER_STAGES`/etc. constants); default `false`.

**Send helpers (new, in scheduler.py or a small `fms_notify.py`):**
- `_fms_send_wa(phone, text)` → `await evolution.send_text(phone, text)`.
- `_fms_send_email(to, subject, body)` → `asyncio.to_thread(_smtp_send, …)` using `_email_cfg()`.
- Both wrapped in try/except; failures recorded as `status:"failed"` with error, eligible for retry next pass (a failed record does not count as "sent").

### 5.4 RBAC on FMS routes

Use `get_team(user)` from `backend/rbac.py` (returns `admin|accounts|store|sales`).

**Field masking (server-side projection before responding):**
- `sales` → strip `amount`, `customer_phone` from flow objects in `GET /fms/flows`, `GET /fms/flows/{id}`, `GET /fms/dashboard`, `GET /fms/calendar`. Also strip payment milestone amounts.
- `store` → strip `amount` and payment fields (operational view only).
- `accounts`, `admin` → full.
- Implement one helper `_mask_flow(flow, team)` applied uniformly so masking can't be forgotten per-route.

**Stage edit-lock (write gating):** `complete_stage`, `approve_stage`, `reject_stage`, `submit_qc`, `submit_checklist` must verify the user's team matches the stage's `team` (or user is `admin`). Map stage `team` values (`sales`, `store`, `dispatch`, `accounts`, `purchase`, `management`, `field`) to allowed user teams; `dispatch`/`purchase`→`store`-adjacent mapping documented in code. Read-gates-write: 403 if not permitted.

### 5.5 Audit log

**New collection `fms_stage_logs`** — append-only:
```
{ log_id, flow_id, stage_id, action,   # created|activated|completed|approved|rejected|reworked|paused|resumed
  from_status, to_status, by, note, at }
```
A single helper `_log_stage(stage, action, user, note)` called from every mutation point (create_flow, complete, approve, reject, QC, advance, pause/resume). `GET /fms/flows/{id}/logs` returns history for the detail panel.

### 5.6 Pause / hold

- Add stage status `paused`; add `paused_intervals: [{from, to}]` to stage docs.
- `POST /fms/stages/{id}/pause` (records `from`, sets `paused`), `POST /fms/stages/{id}/resume` (closes interval, sets `active`, **shifts** `plan_done` forward by paused working-time so the deadline excludes paused time).
- Live TAT (`tat_status`, dashboard, loop) subtracts paused intervals from elapsed.
- Only the stage's team or admin may pause/resume; logged.

## 6. Data model summary

New / changed collections:
- `fms_settings` — extended with thresholds + templates (5.2).
- `fms_notifications` — new (5.3).
- `fms_stage_logs` — new (5.5).
- `fms_stages` — add `paused`, `paused_intervals`; stage defs add `customer_notify`.

Indexes: `fms_stages` on `{status, plan_done}` (efficient loop scan); `fms_notifications` on `{stage_id, kind, channel}` (dedupe lookup); `fms_stage_logs` on `{flow_id, at}`.

## 7. Scoring & Goodhart caution

`score_report` stays but the spec records a deliberate caution (research, medium confidence): single punitive TAT-compliance scores get gamed. We keep scores as a *balanced, informational* signal — report shows on-time %, green/red counts, AND avg score together; no automated punitive action is wired to the score. Future "Full overhaul" may add a quality dimension.

## 8. Build order (phased, each shippable)

1. **Phase 1 — Bug fixes + audit log.** B1–B4, `fms_stage_logs`, indexes, unit tests for TAT/IST, status, scoring. (Foundational; everything else relies on correct TAT.)
2. **Phase 2 — RBAC.** `_mask_flow`, stage edit-locks, tests for sales masking + 403 on cross-team write.
3. **Phase 3 — Notifications.** Settings additions, `fms_notifications`, `fms_sla_loop`, send helpers, dedupe; customer-notify-on-complete. Manual + automated tests with a mock send.
4. **Phase 4 — Pause/hold.** Status, intervals, endpoints, TAT exclusion, UI control.

## 9. Testing

- **TAT engine:** unit tests for after-hours start, weekend skip, holiday skip, multi-day spans, pause exclusion.
- **Status/score:** table-driven tests across pct ranges and early/late finishes.
- **RBAC:** sales response excludes `amount`/`customer_phone`; cross-team write returns 403.
- **Notifications:** with `evolution`/SMTP mocked, assert one send per `(stage,kind,channel)` and dedupe on second loop pass; breach also notifies manager.
- **Frontend:** dashboard renders new `tat_status` colors with icon+text (accessibility — color not sole signal, per research).

## 10. Risks / open items

- **Scheduler single-instance:** `fms_sla_loop` must run in exactly one process. Confirm deployment runs one backend worker (or guard the loop) to avoid duplicate sends. (Research footgun: multi-worker = N schedulers.)
- **Evolution vs WABA send path** (see §4 open item).
- **Manager resolution** for `manager_breach` depends on department/manager data in `del_employees`/users being populated; fall back to admin notification if absent.
- **Goodhart's Law:** keep scoring informational, not punitive (§7).
