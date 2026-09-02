# Offline Mail: postal endorsement, drip linking, plan-vs-actual verification — Design Spec

**Date:** 2026-09-02
**Owner:** SmartShape (info@smartshape.in)
**Branch:** `feat/mail-verify-gap` (worktree `F:/ss-mail`, forked from `main` @ 982d1d9)
**Status:** Draft for review

## 1. Goal & core insight

Offline Mail can already *plan* a posting run and print QR-tracked stickers. What it
cannot do is tell the owner **what was actually posted**. Today a run has a single
`status` dropdown, and flipping it to `posted` stamps `posted_at` on every touch at
once (`crm_routes.py:1017`) — so a run where 2 of 10 brochures went out is
indistinguishable from one where all 10 did.

**The insight that shapes this spec:** in a physical channel the *plan* and the
*actual* always diverge — stock runs out, an address is blank, the courier pickup is
missed. A marketing engine that only records intent produces confident, wrong ROI
numbers. So the unit of truth moves down from the **run** to the **touch**: every
individual school×piece gets a planned date, a verified outcome, and an actual date.
Everything the owner asked for — the gap report, the re-plan, the honest response
rate — falls out of that one change.

A second, smaller insight from the field: the packet in the owner's photo carries a
hand-written **"Open Post"**. That endorsement decides the tariff the postal clerk
charges. It is written by hand today because the sticker cannot print it. Making it a
free-text, size-adjustable field on the label removes a manual step from every single
posting.

## 2. Scope

- **P1 — Postal endorsement + font size** on the address sticker.
- **P2 — Real drip↔mail linking:** drip physical steps produce per-sequence,
  per-piece mail runs whose touches back-link to the enrolment and step.
- **P3 — Verification, re-plan, gap report, sequence drill-down.** The core, built on
  a three-state touch lifecycle (planned → printed → posted) plus a cross-run
  "Today's Post" queue, an overdue nudge, and undo.
- **P4 — Filter ↔ drip ↔ tagging alignment.**

**Out of scope:** courier API integration / real delivery scans; changing the QR
response flow (`/api/r/{token}`) which already works; rebuilding the CRM filter rail;
any change to the WhatsApp/email drip channels beyond what P2/P3 need.

## 3. What already exists (verified on `main`, do not rebuild)

| Capability | Where |
|---|---|
| Areas → mail runs → one `mail_touches` doc per school, each with a QR token | `crm_routes.py` `_make_mail_run()` |
| Address-review sheet (fill blanks, save back to school DB, sync-all) | `components/mail/MailAddressSheet.js` |
| Sticker PDF: Godex thermal one-per-page + A4 4-up, 5 preset sizes + custom mm, portrait/landscape, per-batch From override, logo, tagline, contact | `_build_stickers_pdf()` / `_render_label()` |
| Drip physical step → `physical_dispatches` + rep task + a mail touch in a daily *"Drip Mailers"* run | `create_physical_from_drip()` (`crm_routes.py:159`) |
| Per-step firing log with channel + status + timestamp | `db.drip_step_logs`, written by `run_drip_executor()` (`scheduler.py:525`) |
| Engagement ledger mirror for every fired drip step | `services/engagement.log_engagement_event()` |
| Run-level ROI analytics (response rate, cost/response, cost/appointment) | `GET /mail-runs/analytics` |

The drip→mail link therefore **already exists** but is coarse: every sequence and
piece type of a given day collapses into one run keyed only on
`{is_drip_run: True, send_date: today}`, and the touch carries no `sequence_id`,
`enrollment_id` or `step_number`. P2 fixes exactly that.

## 4. Data model changes

### 4.1 `mail_touches` — new fields (the heart of P3)

| Field | Meaning |
|---|---|
| `planned_date` | `"YYYY-MM-DD"` — when we intended to post this piece |
| `verify_status` | `pending` \| `sent` \| `not_sent` \| `skipped` (default `pending`) |
| `verified_by` | user email |
| `verified_at` | ISO timestamp |
| `reason` | free text — why not sent (e.g. "address missing", "out of stock") |
| `printed_at` | ISO timestamp — stamped by the sticker endpoint itself (7.5) |
| `print_batch_id` | groups one print job; a re-print starts a new batch |
| `replan_count` | int, default 0 |
| `sequence_id` | set when the touch came from a drip step |
| `enrollment_id` | set when the touch came from a drip step |
| `step_number` | set when the touch came from a drip step |
| `source` | `manual` \| `area` \| `import` \| `drip` |

`posted_at` already exists and becomes the **actual** date, written only on
verification.

**Migration:** a non-fatal backfill on boot (same pattern as the existing `_i()`
index wrapper) sets `verify_status: "pending"`, `replan_count: 0`, `source: "manual"`
and `planned_date` = the run's `send_date` (falling back to the run's `created_at`
date) on every touch missing them. Legacy touches whose run is already `posted` are
backfilled `verify_status: "sent"` with `posted_at` preserved, so historical
analytics do not suddenly read as unsent.

### 4.2 `mail_runs` — new fields

- `sequence_id` — set on drip runs, so a run belongs to one sequence
- `sequence_name` — denormalised for display
- `counts.verified_sent` / `counts.not_sent` / `counts.pending` — recomputed on verify

`status` stops being freely user-set and becomes **derived**: `planned` while any
touch is pending, `posted` once every touch is `sent`/`skipped`, `closed` only by
explicit user action. The dropdown stays, but selecting `posted` now routes through
the verify-all path rather than blind-stamping every touch.

### 4.3 `db.settings` type=`company` — new sticker defaults

- `sticker_endorsement` — free text, e.g. `"Book Post"`
- `sticker_endorsement_pt` — int, `0` = auto
- `sticker_text_scale` — float 0.8–1.3, default 1.0

### 4.4 `schools` — P4 only

- `tags: [tag_id]` — mirrors the existing contact/lead `tags` field

## 5. P1 — Postal endorsement + font size

**Backend.** `_render_label()` gains three parameters — `endorsement`,
`endorsement_pt` and `text_scale`:

- `endorsement` (str) — drawn **bold, right-aligned, on its own line above `To,`**.
  Right-aligned-above rather than overlaid in the right margin, because the TO block
  wraps to the full inner width; an overlay would need per-line width juggling and
  would collide on small labels. On labels under 45 mm high (the existing compact
  branch) the endorsement is drawn only if it fits one line, otherwise dropped.
- `endorsement_pt` (float, `0` = auto) — auto derives as `f_name * 0.8`.

`text_scale` (float, clamped 0.8–1.3) multiplies `f_lbl`, `f_body`, `f_name` and
`f_pin` *before* their existing min/max clamps are applied, so scaling can never
produce a label that overflows its own geometry.

`GET /mail-runs/{run_id}/stickers.pdf` accepts `endorsement`, `endorsement_pt` and
`text_scale` as query params, following the existing `from_*` per-batch override
pattern. Absent params fall back to the `db.settings` company defaults.

**Frontend.** A "Postal endorsement" block in the `MailAddressSheet` print-options
panel: a text input with quick-chips (*Book Post*, *Open Post*, *Printed Matter*,
*Book Packet*), a pt stepper with +/− buttons, and a **Text size** stepper
(80%–130%). "Save as default" extends to persist the three new company fields.

## 6. P2 — Real drip↔mail linking

`create_physical_from_drip()` takes three new optional args — `sequence_id`,
`enrollment_id`, `step_number` — which `run_drip_executor()` already has in hand at
the call site (`scheduler.py:457`).

**Run grouping** changes from `{is_drip_run, send_date}` to
`{is_drip_run, send_date, sequence_id, piece_type}`, named
`"{sequence} · {piece} — {date}"`. A brochure step and a sample step from two
different sequences on the same day now produce two runs, each printable with the
right piece. The existing per-day dedup (one touch per school per run) is preserved,
keyed on the narrower run.

Every drip touch is stamped with `source: "drip"`, the three ids, `item_name`, and
`planned_date` = the step's due date.

**Surfacing.** Offline Mail's run table gains a *Drip* badge + sequence name; the
DripsTab sequence card gains a *"N mailers waiting to print"* link that deep-links to
that run's address sheet.

## 7. P3 — Verification, re-plan, gap report, drill-down

### 7.1 Endpoints

**`POST /mail-runs/{run_id}/verify`**
Body: `{ rows: [{touch_id, verify_status, posted_date?, reason?}] }` or
`{ select_all: true, verify_status, posted_date? }`.
Writes `verify_status` / `posted_at` / `verified_by` / `verified_at` / `reason` per
touch, recomputes run counts and derived status, and mirrors each `sent` to the
engagement ledger (channel `mail`, `dedup_key: "mailtouch:{touch_id}"`).

**`POST /mail-runs/{run_id}/replan`**
Body: `{ touch_ids: [...] | select_pending: true, new_date: "YYYY-MM-DD" }`.
Sets `planned_date = new_date`, `verify_status` back to `pending`, increments
`replan_count`. The run stays open. Does **not** touch the drip enrolment schedule
(see 7.4).

**`GET /mail-runs/gap-report?from=&to=&group_by=run|sequence|owner|school`**
Rows: `{ key, label, planned, sent, not_sent, pending, avg_days_late, replans,
on_time_pct }`, where `avg_days_late = mean(posted_at.date − planned_date)` over
`sent` touches only.

**`GET /drip/sequences/{sequence_id}/deliveries?status=&channel=&step=`**
One row per (enrolment × step), fired or not:
`{ school_id, school_name, owner, step_number, channel, item, planned_date,
actual_date, status, run_id?, touch_id? }`.

`deliveries` composes `drip_step_logs` (fired) with the *unfired* remainder derived
from each active enrolment's `current_step` against the sequence's step list — which
is what makes "planned but not done" visible at all. Physical rows join
`mail_touches` on `enrollment_id` + `step_number` to pull the verified outcome.

**Route-ordering caution:** `/mail-runs/gap-report` MUST be declared above
`/mail-runs/{run_id}`, exactly as the existing `/mail-runs/analytics` comment warns,
or FastAPI matches `gap-report` as a `run_id`.

### 7.2 Verify sheet (UI)

`MailAddressSheet` gains a second mode, toggled by a tab: **Addresses** (today's
sheet) and **Verify & post**. The verify view is a table with:

- a checkbox column plus **Select all** / **Select pending**;
- per-row **✓ Sent** / **✗ Not sent**, with a reason input revealed on "not sent";
- one actual-date field for the batch, defaulting to today;
- a footer bar reading *"2 of 10 verified sent · 8 pending"* with two actions —
  **Mark selected sent** and **Move remaining to [date]**.

One implementation, two entry points: Offline Mail opens it on a run; the sequence
drill-down deep-links into it filtered to that sequence's touches.

### 7.3 Gap report (UI)

A "Plan vs Actual" panel in Offline Mail and in Marketing → Engagement: a group-by
selector (run / sequence / rep / school), a date range, and a table of planned / sent
/ not sent / pending / on-time % / avg days late. Rows click through to the
underlying run or sequence. CSV export reuses the existing `saveBlob` helper (which
already carries the `document.body.appendChild` fix).

### 7.4 Slip policy (decided)

When a physical touch slips, **only the mail touch moves**. The enrolment's
`next_step_at` and the rest of the sequence are untouched, so a postage delay never
stalls the WhatsApp and call cadence behind it. No per-sequence toggle — one
predictable rule.

### 7.5 The lifecycle is three states, not two

A touch does not go from *planned* to *posted*. Somebody prints a sticker, somebody
sticks it on a packet, and somebody else carries the bundle to the post office —
and that last hop is exactly where pieces are lost, because nobody owns it. A
two-state model cannot see the loss; a three-state one can:

```
planned ──print──▶ printed ──verify──▶ sent
   │                  │                 └─▶ not_sent (+ reason)
   └──────────────────┴──replan──▶ planned (new date, replan_count += 1)
```

So `mail_touches` also carries `printed_at` and `print_batch_id`, both written by the
sticker endpoint itself — printing *is* the event, so no extra click is needed to
record it. This gives the owner the question that actually matters at 6pm: **"37
stickers were printed today and only 29 were posted — where are the other 8?"** That
is a `printed_at IS NOT NULL AND verify_status = 'pending'` query, surfaced as its own
line in the gap report and as an alert (7.7).

`print_batch_id` also makes a re-print honest: reprinting a run starts a new batch
rather than silently overwriting when the first print happened.

### 7.6 "Today's Post" — one queue across every run

The single highest-value screen in this whole design, and the one that turns the
feature from a report into a workflow. Today the owner must remember which runs are
outstanding and open each one. Instead:

**`GET /mail-runs/today-queue?date=`** returns every touch whose `planned_date <=
date` and whose `verify_status` is `pending`, grouped by run, with a total. Drip
mailers and manual runs sit in one list, because to the person doing the posting they
are the same job.

The Offline Mail page opens on it: *"12 pieces to post today — 7 brochures (Principal
Machine Pitch), 5 samples (Rohini area)"*, with **Print all stickers** producing one
combined PDF across runs (reusing `_build_stickers_pdf` with a merged touch list, so
the printer is loaded once, not four times) and **Verify all posted** as the end-of-day
action. Overdue pieces from earlier dates surface at the top in red — this is where
slipped work becomes impossible to ignore.

### 7.7 Nudge the owner instead of waiting to be asked

A scheduler job (`JOB14`, alongside the existing keep-in-touch job in `scheduler.py`)
runs each evening and, when anything is overdue — `planned_date` in the past and still
`pending` — writes a `crm_notifications` row for the run's owner and, when the
existing WhatsApp digest is configured, adds a line to it. Two thresholds, both
deliberately quiet: printed-but-not-posted for over 1 day, and planned-but-not-printed
for over 3 days. Opt-in via the same App Settings → Notifications toggle the daily
digest already uses, so this cannot start messaging anyone unasked.

### 7.8 The gap report answers "why", not just "how much"

Counts alone tell the owner work slipped, not what to fix. So the report also returns:

- a **reason Pareto** — `not_sent` grouped by `reason`, biggest first. If 60% is
  "address missing", the fix is a data-cleanup afternoon, and each reason row links
  straight to the affected schools in the address sheet.
- **postage exposure** — `courier_cost / planned` × `not_sent`, i.e. the budgeted
  postage attached to pieces that never went out.
- **print-to-post leakage** — printed but never posted, the 7.5 number, with the
  stickers effectively wasted.
- **`on_time_pct` trend** by week, so the owner can see whether discipline is
  improving or drifting rather than reading one static number.

### 7.9 Undo

Verification is a fast, repetitive, batch action, which means it will be mis-clicked.
`POST /mail-runs/{run_id}/verify` supports `undo: true` on a set of `touch_ids`,
restoring `verify_status: "pending"`, clearing `posted_at` / `verified_by` /
`verified_at` / `reason`, and removing the mirrored ledger event by its `dedup_key`.
Without this, one stray "Select all → Mark sent" would permanently corrupt the very
numbers the feature exists to protect.

## 8. P4 — Filter ↔ drip ↔ tagging alignment

1. **"Enrol in sequence"** as a bulk action on any CRM filter selection, twin to the
   existing "Mail Run" button, calling the shipped `POST /drip/enroll-schools`.
2. **Tags on schools** (today contact/lead-only): a `tags` array, a filter-rail
   facet, and bulk tag/untag from a selection — so a sequence can target a tag.
3. **Tag manager** in CRMMasters gains colour, usage count, rename-cascade and
   **merge duplicates** (reusing the `_resolve_tags` name-resolution path).

## 9. Error handling & edge cases

- **Verifying a touch twice** is idempotent: the ledger `dedup_key` prevents a
  duplicate timeline event, and run counts are recomputed from the touches rather
  than incremented, so no drift.
- **A run deleted mid-verification** — the existing cascade already removes its
  touches; verify/replan return 404 rather than half-writing.
- **`planned_date` absent** (a legacy touch the backfill missed): the gap report
  excludes it from `avg_days_late` instead of counting it as 0 days late.
- **Replanning a `sent` touch** is rejected — only `pending`/`not_sent` may move.
- **Endorsement too long for the label** is wrapped to one line and truncated by
  measured width; it never pushes the address block off the sticker.
- **`text_scale` out of range** is clamped, not rejected, so an old bookmarked print
  URL still works.
- **The drip run-grouping change must not orphan in-flight runs:** the lookup falls
  back to the old `{is_drip_run, send_date}` key when no `sequence_id`-keyed run
  exists for that day, so a mid-day deploy degrades gracefully instead of
  double-posting a school.

## 10. Testing

Backend (pytest + mongomock — the suite is committed on `main`):

- `_render_label` with an endorsement at each preset size, custom mm, and A4 4-up;
  assert the PDF renders and the address block survives `text_scale` 0.8 and 1.3.
- Verify endpoint: partial verify → run counts and derived status; `select_all`;
  double-verify idempotency; the ledger event written exactly once.
- Replan: pending touches move and `replan_count` increments; a `sent` touch is
  rejected; the enrolment's `next_step_at` is **unchanged** (the 7.4 guarantee,
  asserted explicitly).
- Gap report: `avg_days_late` excludes touches with no `planned_date`; each
  `group_by` mode.
- `deliveries`: unfired steps appear as planned; a physical row picks up the verified
  outcome from its touch.
- Drip run grouping: two sequences × two piece types in one day → four runs, one
  touch each; plus the legacy-key fallback path.
- Backfill: legacy touches on a `posted` run come out `sent`, not `pending`.
- `printed_at` / `print_batch_id` are stamped by a sticker download, a re-print opens
  a new batch, and `skip_incomplete` does **not** mark skipped touches as printed.
- Today's queue: overdue touches from earlier dates are included and sort first; a
  combined multi-run print yields one PDF with the right total page count.
- Undo: restores `pending`, clears the actual date, removes the ledger event, and a
  re-verify afterwards writes the ledger event again exactly once.
- Nudge job: fires only when overdue work exists, respects the opt-in setting, and
  does not re-notify the same run twice in one day.
- Gap report: reason Pareto ordering, postage exposure arithmetic, and print-to-post
  leakage on a run with a mix of printed/posted/pending touches.

Frontend: the verify sheet's select-all / partial-selection state, and the
endorsement + text-size params reaching the sticker URL.

## 11. Rollout

P1 → P2 → P3 → P4 ship independently, each a deployable increment. Build and deploy
from this worktree per the standing procedure: commit source **and** the rebuilt
bundle explicitly (never `git add -A`), build with `DISABLE_ESLINT_PLUGIN=true` and
an inline `REACT_APP_BACKEND_URL=https://app.smartshape.in`, and verify by bundle
content. The `mail_touches` backfill is idempotent and non-fatal, so it is safe to
ship with P3 and safe to re-run.
