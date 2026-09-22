# Drip ↔ Offline Mail: linking, verification and reporting — Design

**Date:** 2026-09-22
**Status:** Approved by owner ("continue as expert", 2026-09-22) — ready for planning
**Author:** Aman Shrivastava (owner) + Claude
**Depends on:** origin/main `928b8fc` (contact drips live). Research map with file:line evidence:
session scratchpad `drip-offline-research.md` (read-only; line numbers taken on `928b8fc`).

## Problem

Owner-reported, all confirmed against the code and production data on 2026-09-22.

1. **Duplicate sequences.** Pressing Enter in the sequence-name box calls `save()`
   (`DripsTab.js:420`); `save()` sets `saving` but never checks it (`:156-199`), and
   `POST /drip/sequences` (`drip_routes.py:352`) inserts unconditionally — no name check, no
   idempotency window, no index. The owner saw 2–3 copies and deleted them by hand.
2. **Editing a sequence wipes its post steps' material.** `mapSeq` (`marketingUtils.js:112-142`)
   drops `material_type`/`material_name`; `startEdit` then re-reads them as `brochure`/`""`.
3. **A drip's post step is not linked to Offline Mail when authored.** The step's `material_type`
   is a hard-coded list (`DripsTab.js:525-530`) that disagrees with the mail-run `piece_type` list
   (`OfflineMail.js:15`). The only join is at fire time (`scheduler.py:560` →
   `create_physical_from_drip`, `crm_routes.py:179-276`). Nothing in the dialog says a mailer will
   appear in Offline Mail.
4. **Contacts with no school get no mailer.** `crm_routes.py:225-226` gates the Offline Mail leg on
   `school_id`; such sends exist only as a `physical_dispatches` row with `needs_dispatch: True`, a
   flag that is written once and read nowhere. Production: 39 of 40 dispatches sit in this state.
5. **Verification is school-level and run-scoped only.** `VerifyPostTable` lives inside one mail
   run; `/mail-runs/{id}/addresses` returns no `contact_id`/name; the `physical_dispatches` row and
   the `mail_touches` row for the same posting share no id and never sync.
6. **Reporting is three disconnected screens** (sequence deliveries drill-down, school drips card,
   mail gap report) plus counters. No "schools we sent marketing to" list, no per-contact roll-up,
   no sent-vs-verified in one place, no CSV export.

## Decisions

- **D1 — One envelope per school per item per day.** When several contacts at one school are in
  the same drip, one mailer row is created and it lists every recipient name. One tick covers the
  envelope. (Owner's decision 1; overrides nothing existing — `create_physical_from_drip` already
  dedupes touches on `run_id + school_id`.)
- **D2 — A contact with no school is never posted blindly.** The mailer row is still created, with
  `verify_status: "needs_address"`, so it appears in the queue flagged instead of vanishing. Giving
  the contact a school (or the school an address) moves it back to `pending` on the next executor
  pass. Nothing is cancelled.
- **D3 — One shared Materials list.** A `mail_materials` collection replaces both hard-coded lists.
  Drip steps and manual mail runs pick from it. Seeded with the union of today's values:
  `brochure, sample, catalogue, kit, newsletter, gift`, plus `other`. Legacy free-text values keep
  working (a step whose `material_type` is not in the list is shown as-is and flagged in the editor).
- **D4 — One posting, one record of truth.** The `mail_touches` row is the source of truth for
  "posted or not". `physical_dispatches` rows link to it (`touch_id`) and are updated from it, never
  the other way round. `needs_dispatch` is derived from `verify_status == "pending"`, not stored.
- **D5 — The verification queue is cross-run.** "To post" lists every pending/needs_address touch
  across all runs and drips, and a tick there is exactly `_do_verify` (`crm_routes.py:1484`) — no
  second verification path.
- **D6 — Reporting is one endpoint with a `group_by`.** School / contact / sequence roll-ups are the
  same query grouped differently, built on `drip_step_logs` + `mail_touches` + `engagement_events`,
  which already carry `sequence_id`, `enrollment_id`, `step_number`, `school_id`, `contact_id`,
  `touch_id`. No new data collection.
- **D7 — Duplicate prevention is belt-and-braces**, copying the quotation pattern: client
  re-entrancy guard (`useCreateQuotation.js:419`) + server 30-second idempotency window
  (`quotation_routes.py:506-518`) + explicit 409 on an exact-name match for the same creator.

## Sub-project A — Fix the glitches

### A1 Duplicate sequences
- `DripsTab.js save()` and `SequenceEnrollDialog.submit()`: `if (saving) return;` first line; Enter
  in the name box routes through the same guarded function.
- `POST /drip/sequences`: (a) if a sequence with the same trimmed, case-insensitive `name` exists
  and is not soft-deleted → **409** `A sequence called "X" already exists`; (b) same creator + same
  name + same step count within 30 s → return the existing document (idempotent), status 200.
- Index: non-unique `(name_lower)` on `drip_sequences`, guarded like every other index in
  `database.py`. (Not unique — legacy data and the seeder's system twin, `drip_routes.py:279-280`,
  make a unique index unsafe at startup.)
- UI: a 409 shows the message and focuses the name box.

### A2 Editing keeps material
- `mapSeq` carries `material_type`, `material_name`, `attachment_id` through unchanged.
- Test: round-trip a sequence with a post step through `mapSeq` → `startEdit` → `save()` payload and
  assert both fields survive.

### A3 Seeder twin
- `_seed_defaults` lookup matches on name regardless of `created_by`, so a hand-made sequence with a
  default's name is not twinned. (Two-line change, `drip_routes.py:279-280`.)

## Sub-project B — "To post" queue with per-envelope ticks

### Data
- `mail_touches` gains `contact_ids: [str]`, `recipient_names: [str]`, `dispatch_ids: [str]` and the
  new `verify_status` value `needs_address`. `VERIFY_STATUSES` becomes
  `("pending", "needs_address", "sent", "not_sent", "skipped")`.
- `physical_dispatches` gains `touch_id`. `create_physical_from_drip` writes it on both sides in the
  same call. For a school-less contact it still creates the touch (D2) with `needs_address`.
- Backfill migration (dry-run default, `--apply`): link existing dispatches to touches by
  `(enrollment_id, step_number)`; touches for school-less enrolments get `needs_address`.

### Endpoint
- `GET /mail-runs/to-post?status=&sequence_id=&owner=&from=&to=&q=` → rows
  `{touch_id, run_id, run_name, sequence_id, sequence_name, school_id, school_name, address_ok,
  contact_ids, recipient_names, item_name, piece_type, planned_date, overdue_days, verify_status,
  posted_at, reason, owner}` + totals by status. Reps see only touches at schools they can see
  (`_schools_visibility_or`); admins see all. Cap 2,000 rows, sorted overdue-first.
- Verification reuses `POST /mail-runs/{run_id}/verify` per run; the queue groups its selected
  touch ids by `run_id` and issues one call per run. `_do_verify` additionally mirrors
  `sent_date`/`courier` onto the linked dispatch (D4).

### UI
- Offline Mail → new **To post** tab (first tab). Table: School · Recipients · Item · Sequence ·
  Due · Status · Owner. `useBulkSelect` for ticks (one-by-one, header, shift-range, hidden count).
  Sticky bar: **Mark posted** (date, default today) · **Not posted** (reason) · **Undo** · **Print
  stickers for selected**. Filters: status chips (Pending / Needs address / Overdue / Sent /
  Not sent), sequence, owner, date range, search. `needs_address` rows show a "Needs address" badge
  linking to the school/contact. Mobile: card list with the same checkbox.
- The Dispatch Tracking page's per-row "mark received" stays; its "sent" state now reads from the
  linked touch.

## Sub-project C — Link the drip to Offline Mail at authoring time

- `mail_materials` collection `{material_id, name, piece_type, active, created_by, created_at}`;
  CRUD under Offline Mail → **Materials** (admin/`leads:read_write`), seeded per D3.
- Drip step editor: `material_type` becomes a select over active materials (plus "Other…" free
  text); `SequenceEnrollDialog` "Post something" uses the same list; manual mail-run creation uses
  the same list for `piece_type`.
- The New/Edit Sequence dialog shows, under any post step: *"On day N this creates a mailer in
  Offline Mail → To post. Post it and tick it there."*
- `_CHANNEL_OF` and the executor are unchanged; the material name flows through as today.

## Sub-project D — "Marketing Sent" report

- `GET /reports/marketing-sent?group_by=school|contact|sequence&from=&to=&sequence_id=&owner=&channel=`
  → rows with: key (school/contact/sequence + name + owner), `sequences: [names]`,
  `sent_by_channel: {whatsapp, email, call, post}`, `post: {verified_sent, pending, not_sent,
  needs_address}`, `last_sent_at`, `responses: {qr_scans, interest}`; plus grand totals. Reps are
  scoped by the same visibility helpers as the lists. `?format=csv` streams the same rows.
- Reports hub entry "Marketing sent" (School / Contact / Sequence toggle, filters, export). The
  sequence card's deliveries drill-down gains Contact and Owner columns and an Export button.

## Testing

- **A:** two `save()` calls in flight create one sequence; server 409 on exact name; 30-s idempotency
  returns the same id; `mapSeq` round-trip keeps material; seeder does not twin a same-named
  hand-made sequence.
- **B:** a fired post step writes touch + dispatch linked both ways; three contacts at one school →
  one touch with three names; school-less contact → `needs_address`, visible in `/to-post`, moved to
  `pending` after the contact gains a school; ticking in To post sets the touch AND the dispatch;
  reps see only their schools; backfill dry-run writes nothing.
- **C:** materials CRUD; a step with a legacy value still fires; both dropdowns read the same list.
- **D:** the three `group_by` modes agree with each other's totals; a school reached only by post
  shows `post.pending` until verified, then `verified_sent`; CSV has the same rows as JSON.
- All tests mock SMTP / WhatsApp / push. Backend tests run with
  `DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017`, never a bare `pytest tests/`.

## Rollout

A ships first (bug fixes, no data change). B and C ship together (B's backfill migration runs
dry-run then `--apply` before the push, with owner confirmation — it writes to production). D last.
Every step needs a frontend bundle rebuild before merge.

## Out of scope

- Courier/tracking integration; address validation; per-contact envelopes (D1 rules them out);
  configuring WhatsApp/email providers.
