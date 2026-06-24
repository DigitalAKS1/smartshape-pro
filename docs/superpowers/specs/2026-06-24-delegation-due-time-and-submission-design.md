# Delegation — Due Time + Rich Submission Flow

Date: 2026-06-24
Module: Delegation System (`backend/routes/delegation_routes.py`, `frontend/src/.../delegation`)

## Problem

1. Tasks are assigned with a **date only** (no time of day).
2. Completion is a single **"Done"** button. There is no way for a delegatee to say
   "I couldn't do it (why)" or "I did part of it, I'll finish by X, please hand the
   rest to a teammate."

## Decisions (confirmed with owner)

- **Due time:** optional time field; blank → treated as end-of-day (23:59). Non-disruptive to existing tasks.
- **Not Done:** task **stays pending/overdue**; reason logged & visible; delegator notified.
- **Partial:** task **stays pending** with a new expected finish date; reassignment to a
  teammate is **optional** and goes through the **existing approval flow** (delegator approves).
- **Notifications:** in-app, matching the existing delegation notification pattern (`_notify`).
  (Delegation task events are in-app today; we stay consistent rather than half-wiring email/WA.)

## Backend changes (`delegation_routes.py`)

### Due time
- `TaskIn` gains `due_time: Optional[str] = None` (`"HH:MM"`).
- Stored on the task doc (`create_task`, `bulk_create_tasks`).
- `_make_instance_v2` gains a `due_time` kwarg → stored on each instance.
- Threaded through `create_task`, `bulk_create_tasks`, and `_resync_pending_instances`
  (propagated to pending instances on edit).
- `due_time` added to `TASK_EDITABLE` and the edit `LOG_FIELDS`.

### Instance fields (new)
- `due_time` — `"HH:MM"` or `""`.
- `last_outcome` — `null | "done" | "not_done" | "partial"` (drives the badge).
- `submissions[]` — append-only history of `{outcome, note, expected_date, expected_time, at, by}`.

### New endpoint
`POST /delegation/instances/{instance_id}/report`
Body: `{ outcome: "not_done" | "partial", note (required), expected_date?, expected_time?, reassign_to_emp_id? }`
- Rejects if already completed/verified.
- Appends a `submissions` entry, sets `last_outcome`, keeps `status = pending`.
- **Partial:** `expected_date` required (not past); moves `due_date`/`due_time` to the
  expected finish (change-logged); if `reassign_to_emp_id` given → creates a reassign
  request via the shared helper (needs delegator approval).
- Notifies the delegator in-app (`_notify`).

`create_reassign_request` is refactored to call a shared `_make_reassign_request(...)`
helper so `report` can reuse the exact same approval flow + notifications.

## Frontend changes

- `lib/api.js`: `instances.report(id, d)`.
- `hooks/useDelegationApp.js`:
  - `submitInst` / `setSubmitInst` state (the instance whose submit dialog is open).
  - `submitDone(inst, {note, file})` — note → `complete`; file → `complete-with-image`.
  - `reportInst(inst, payload)` — calls `instances.report`, toasts, refreshes.
  - `completeInst` keeps working for manager-side quick-complete (drawer/visits/overview).
  - assignment row (`newRow`) gains `due_time: ''`.
- `components/delegation/SubmitTaskDialog.js` (new): three tabs — **Done** (remark, +photo
  if `requires_image`), **Not Done** (reason*), **Partial** (progress*, expected date*,
  expected time, optional teammate).
- `DelegationTaskForm.js`: optional time input under the one-time date and under the
  recurring range (applies to every generated instance).
- `EditTaskDialog.js`: optional Due time field (owner edit).
- `MyTasksTable.js` + `MyPlanner.js`: primary completion action opens `SubmitTaskDialog`;
  show due time next to due date; show **Not Done** (red) / **Partial** (amber) badge from
  `last_outcome`, with the latest note/expected date visible.
- `DelegationApp.js`: render `SubmitTaskDialog` once (like `ReassignTaskDialog`), driven by
  `submitInst`; pass `onSubmit` to the two delegatee surfaces; bump `mtKey` after submit.

## Out of scope
- Email/WhatsApp for task submission events (kept in-app, consistent with current module).
- Time-aware overdue in server aggregates (`team-summary` stays date-based; UI shows time).
