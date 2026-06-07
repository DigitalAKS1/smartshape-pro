# SP5 — Reminders & Recurring Obligations — Design Spec

**Date:** 2026-06-08
**Module:** SmartShape Pro — Delegation Calendar (program sub-project 5)
**Status:** Approved for planning
**Reuses:** the running marketing scheduler's delivery queues (`email_scheduled`,
`whatsapp_scheduled`) drained every 2 min by `email_sender_loop`/`wa_sender_loop`
(`backend/scheduler.py`); WhatsApp provider via `_send_wa`/Evolution.

---

## 0. Goal

A reminder system for recurring obligations — SaaS **subscriptions**, **loan** EMIs,
insurance **premiums**, and arbitrary **custom** items — that fires on **WhatsApp + email**
(per-reminder choice) ahead of the due moment, with **custom lead offsets in days and
hours** (e.g. "1 day before" *and* "2 hours before"), and shows on the calendar so
monthly/yearly obligations are visible.

### Decisions locked (brainstorming, 2026-06-08)
- **Recipients / scope = all modes:** a reminder defaults to the creator, can add other
  staff and/or an external email/phone, and can be marked **shared** (visible to the admin
  team). 
- **Channels = per-reminder checkboxes** `email` and `whatsapp`; if both ticked, both fire.
- **Lead time = custom offsets**, each `{value, unit: day|hour}`, multiple per reminder
  (so "1 day before" + "2 hours before" is two offsets). Needs a due **time**, not just a
  date, and a dispatcher that runs every few minutes.

### ⚠️ Outward-facing → SEND-SAFE
Fires real WhatsApp/email. Mitigations: recipients default to **self**; a
`REMINDERS_DRY_RUN` env makes the dispatcher compute + log but **not enqueue**; all tests
run against `smartshape_test` where email/WA providers are unconfigured, so even enqueued
rows are never delivered. The manual "run due now" endpoint is admin-only.

---

## 1. Data model — new `reminders` collection (additive)

```jsonc
{
  "reminder_id": "rem_xxxxxxxx",
  "title": "GitHub Team subscription",
  "category": "subscription",          // subscription | loan | insurance | custom
  "amount": 4200,                      // number | null
  "currency": "INR",
  "recurrence": "monthly",             // once | monthly | yearly
  "due_date": "2026-07-05",            // once: the date; monthly: anchor (day-of-month used);
                                       // yearly: anchor (month+day used)
  "due_time": "09:00",                 // HH:MM, local (Asia/Kolkata)
  "lead_offsets": [                    // when to ping, before the due moment
    { "value": 1, "unit": "day" },
    { "value": 2, "unit": "hour" }
  ],
  "channels": { "email": true, "whatsapp": true },
  "recipients": [                      // default: the creator (resolved from del_employees)
    { "type": "user",  "emp_id": "emp_x", "name": "Aman", "email": "info@…", "phone": "9…" },
    { "type": "email", "email": "cfo@acme.in" },
    { "type": "phone", "phone": "98…" }
  ],
  "shared": false,                     // true → visible to the admin team
  "notes": "",
  "status": "active",                  // active | paused | done
  "fired": ["2026-07-05|1day", "2026-07-05|2hour"],   // occurrence|offset already sent
  "created_by": "info@…", "created_by_emp_id": "emp_x",
  "created_at": "…", "updated_at": "…"
}
```
Additive; no migration. `fired` is pruned to entries from the last 60 days.

---

## 2. Backend (`backend/routes/delegation_routes.py` + `backend/scheduler.py`)

### 2.1 CRUD (`delegation_routes.py`)
- `POST /delegation/reminders` — create. Resolve creator → default recipient. Require
  `title`, `due_date`, `recurrence`. Validate `lead_offsets` units ∈ {day,hour}, channels
  at least one true. Default `lead_offsets=[{1,day}]`, `channels={email:true,whatsapp:true}`.
- `GET /delegation/reminders` — list reminders the caller owns **or** that are `shared`
  (admins see all shared). Sorted by next occurrence.
- `PATCH /delegation/reminders/{id}` — owner-only (or admin) edit of any field above.
- `DELETE /delegation/reminders/{id}` — owner/admin; soft `status:'done'` (keeps history).
- `POST /delegation/reminders/{id}/pause` & `/resume` — toggle `status` active⇄paused.
- `POST /delegation/reminders/run-due` — **admin-only** manual dispatch pass; returns
  `{enqueued_email, enqueued_wa, fired:[{reminder_id, occurrence, offset}]}`. Also the
  test hook.

### 2.2 Occurrence + dispatch helpers
- `_reminder_occurrences(rem, around_date)` → the candidate occurrence dates near `around`:
  - `once` → `[due_date]`.
  - `monthly` → this month's and next month's date using `due_date`'s day-of-month
    (clamped to month length).
  - `yearly` → this year's and next year's `month-day` of `due_date`.
- `_offset_delta(offset)` → `timedelta(days=…)` or `timedelta(hours=…)`.
- `dispatch_due_reminders(now)` (in `scheduler.py`, importable) — for each `active`
  reminder, for each candidate occurrence `occ` and each `lead_offset`:
  - `fire_dt = occ_datetime(occ, due_time) − offset_delta`; `key = f"{occ}|{value}{unit}"`.
  - if `now ≥ fire_dt` and `key ∉ fired` and `now ≤ occ_datetime + 1 day` (don't fire stale):
    enqueue (see 2.3) for every channel×recipient, append `key` to `fired`.
  - After processing: `once` reminders whose occurrence+offsets are all past → `status:done`;
    prune `fired` to last 60 days. Honors `REMINDERS_DRY_RUN` (compute only).

### 2.3 Enqueue (reuse the marketing queues)
- Email → insert into `db.email_scheduled`:
  `{scheduled_id: gen_id('esch'), campaign_id: 'reminder', status:'pending',
    email: <recipient email>, subject: "<title> — due <date>", message: <body>,
    created_at: now}`.
- WhatsApp → insert into `db.whatsapp_scheduled`:
  `{scheduled_id: gen_id('wsch'), campaign_id: 'reminder', status:'pending',
    phone: <recipient phone>, message: <body>, created_at: now}`.
- `campaign_id` is required (the loops subscript `msg["campaign_id"]`); the sentinel
  `'reminder'` matches no campaign doc, so the `$inc` is a harmless no-op.
- Body: `"⏰ Reminder: <title>\n<category> <amount?>\nDue <date> <time> (<in 1 day/2 hours>)\n<notes>"`.

### 2.4 Calendar integration
- `_agenda_reminders(emp_id, email, dfrom, dto)` — reminders the subject owns/shares whose
  **occurrence dates** fall in `[from,to]` → normalize via `_ev` → `source:'reminder'`,
  `type:'reminder'`, colour from `AGENDA_COLORS['reminder']` (add `"reminder": "#f59e0b"`),
  `actions:['edit','pause']`, `meta:{category, amount, channels, recurrence, next_due}`.
  Wire into `get_agenda`. Add `'reminder'` to the source filter list.

### 2.5 Scheduler wiring
- Add `reminders_loop()` to `scheduler.py` (every 180 s → `dispatch_due_reminders(now)`),
  started in `start_scheduler()`. 3-min granularity fires hour-offsets within ≤3 min.

## 3. Frontend
- **API** (`api.js`): `delegation.reminders.{list,create,update,delete,pause,resume,runDue}`.
- **Hook** (`useDelegationReminders.js` — separate, focused): list/create/update/pause state.
- **Reminders manager** — a new tab in the Delegation calendar header ("Reminders") OR a
  panel: table of reminders (title, category, amount, next due, channels, recurrence,
  status) with add/edit/pause/delete. 
- **ReminderDialog** — title, category, amount, recurrence (once/monthly/yearly),
  due date + time, **lead offsets editor** (rows of value + day/hour, add/remove),
  channel checkboxes (email/whatsapp), recipients (self + add staff/email/phone),
  shared toggle, notes.
- **Calendar surfacing**: `source:'reminder'` items render with the reminder colour + a
  ⏰ glyph; clicking opens the EventActionDrawer (extended) showing details + edit/pause.

## 4. Error handling & edge cases
- Missing title/due_date/recurrence → 400. No channel selected → 400. Bad offset unit → 400.
- Recipient with no email skipped for email channel; no phone skipped for WhatsApp (reported).
- Month-end clamp: monthly on day 31 → last day of shorter months.
- Paused reminders never fire; `done`/once past → excluded from agenda.
- Duplicate-fire guard via `fired` keys (idempotent dispatch — safe to run-due repeatedly).
- DRY_RUN / unconfigured-provider → nothing delivered.

## 5. Testing (live test DB, `smartshape_test`, self-cleaning `RemTest`)
Email/WA providers are unconfigured in the test DB, so enqueued rows never send.
1. Create monthly reminder w/ offsets [1 day, 2 hour], both channels → stored with defaults.
2. `run-due` at a time inside the 1-day window → `email_scheduled` + `whatsapp_scheduled`
   each get a `pending` row to the recipient; `fired` gains the `…|1day` key; second
   `run-due` does **not** double-enqueue (idempotent).
3. `run-due` outside any lead window → nothing enqueued.
4. Agenda includes the reminder on its occurrence date (`source:'reminder'`).
5. Pause → `run-due` enqueues nothing. Once-reminder past all offsets → `status:done`.
6. Validation: no title/recurrence → 400; no channel → 400.
7. List returns own + shared; non-owner can't PATCH another's private reminder (403).

Frontend: production build compiles; ReminderDialog renders the offsets editor + channel
checkboxes.

## 6. Build phases
1. **Backend model + CRUD + validation** + tests 1,6,7.
2. **Dispatcher** (`dispatch_due_reminders`, occurrence/offset helpers, enqueue) +
   `run-due` endpoint + tests 2,3,5.
3. **Agenda integration** + colour + test 4.
4. **Scheduler loop** wired into `start_scheduler`.
5. **Frontend**: api/hook/manager/dialog/calendar surfacing; build green.
6. **Deploy** (auto-deploy; `REMINDERS_DRY_RUN` left UNSET in prod so reminders fire; the
   SP3 `CALENDAR_INVITE_TEST_TO` guard is unrelated and stays until invite testing done).

## 6a. Bulk import (CSV / Excel)

Create many reminders at once by uploading a spreadsheet — e.g. an HR/admin loading every
employee's recurring task or every business obligation in one go.

- **Template** — a downloadable `reminders-template.csv` with header row:
  `title, category, amount, recurrence, due_date, due_time, lead_offsets, channels, recipient_emails, recipient_phones, assignee_emp_ids, shared, notes`.
  - `lead_offsets` = `;`-separated like `1d;2h`. `channels` = `email;whatsapp` (or one).
  - `recipient_emails`/`recipient_phones`/`assignee_emp_ids` = `;`-separated; assignees are
    resolved against `del_employees` (so you can target employees by id/email).
- **Parsing** — the frontend parses CSV **and** `.xlsx` to JSON rows (SheetJS/`xlsx`,
  already feasible client-side) → posts `rows[]`. No backend file-format dependency.
- **Endpoint** `POST /delegation/reminders/bulk` — body `{rows:[…]}`. Per row: validate
  (same rules as single create), resolve recipients/assignees, insert. Returns
  `{created: N, errors: [{row: i, error: "…"}]}` — partial success, never all-or-nothing.
- **UI** — an "Import" button in the Reminders manager: download-template link + file
  picker + a preview table (valid/invalid rows) before confirming the import.
- Note: bulk delegation **tasks** already exist (`POST /delegation/tasks/bulk`,
  `delegation.tasks.bulkCreate`); this adds the same convenience for reminders.

## 7. Out of scope (YAGNI)
No weekly/custom-interval recurrence in v1 (once/monthly/yearly only). No snooze/ack flow.
No SMS. No attachment in reminders. No timezone per-reminder (Asia/Kolkata fixed).
