# Delegation System Enhancements — Design Spec

**Date:** 2026-06-18
**Branch:** `feat/delegation-enhance` (fresh, off `main` — kept independent of the unmerged `feat/module-rbac` rollout)
**Status:** Approved design → ready for implementation plan

## Problem

The Delegation System is ~95% built but has six concrete gaps reported by the owner:

1. Collaborators are saved on an event but **never notified** — collab email does not reach users.
2. Internal teammates added as collaborators aren't clearly linked to *their* calendar / in-app.
3. The **Pending** (and sibling) KPI cards are read-only — clicking does nothing.
4. **Time blocks** exist but are purely informational — no busy/availability enforcement when assigning or collaborating.
5. When a task is assigned to me I can't see **who assigned it** or pivot to "what this person and I have exchanged".
6. The calendar waits up to **45s** to reflect a newly added/collaborated task or event.

## Root-cause findings (confirmed in code)

- **Collab email is wired but blocked two ways.** `EventActionDrawer.js:112` has a "Send invites" button → `POST /events/{id}/invite` → `_send_invite()` (Gmail SMTP + RFC-5545 `.ics`). But: (a) creating/editing an event with collaborators **only inserts the doc** — no automatic send (`delegation_routes.py:1576`); and (b) prod sets `CALENDAR_INVITE_TEST_TO`, which **redirects every invite to one test inbox**, so real recipients get nothing (`_send_invite` guard ~line 1821).
- **Internal collaborators already appear on their own calendar.** `_agenda_events` (`delegation_routes.py:2013`) queries `created_by_emp_id` OR `collaborators.emp_id` OR `collaborators.email`, so an added teammate sees the event. The missing piece is a **notification on add** and **instant** appearance.
- **`delegator_id` / `delegator_name` are stored on every instance** (`_make_instance_v2`) — "who assigned this" data already exists; it just isn't surfaced.
- **`GET /instances`** already filters by `emp_id`, `delegator_id`, `status`, `date_*`, `priority` — enough to power the Pending drill-down and the relationship view with **no new endpoints**.
- Calendar refresh is a 45s `useAutoRefresh` poll (`useDelegationApp.js`); mutations don't force an immediate reload.

## Decisions

- **Notify on save:** Auto. Saving an event/task with collaborators notifies immediately — internal via in-app + calendar, external via email/`.ics`.
- **Test guard:** Remove the `CALENDAR_INVITE_TEST_TO` redirect for real sends; keep `CALENDAR_INVITE_DRY_RUN` for local testing.
- **Time block conflict:** Soft warning + override ("X is blocked 1–3pm (Lunch) — choose another time?" / "Assign anyway").
- **Branch:** fresh `feat/delegation-enhance` off `main`.
- **WhatsApp on collab:** included but **OFF by default**, reusing the existing WhatsApp queue + notification settings (daily-digest pattern).

---

## Feature 1 — Auto-notify collaborators on save (the core fix)

**Backend.** Add `_dispatch_collab_notices(event, prev_collaborators=None)` invoked at the end of `create_event` and `update_event` (after persist):

- Compute **newly added** vs **carried-over** collaborators by email (diff against `prev_collaborators` on update; all are "new" on create).
- For each **internal** (`type:"user"`, has `emp_id`): insert a `del_notifications` row `{type:"collab_invite", emp_id, related_entity:event_id, title, actor_name, is_read:false, created_at}`. The event already shows on their calendar via `_agenda_events`. If WhatsApp collab-notify is enabled **and** the teammate has a phone, enqueue a message on the existing `whatsapp_scheduled` queue.
- For each **external** (`type:"email"`): call `_send_invite(event, recipients=[email], kind="request")` for new emails; for carried-over emails, send `kind="update"` **only when** a material field changed (`date`, `start_time`, `end_time`, `location`, `meeting_link`).
- Stamp each collaborator with `invited_at` (and bump `ext_sync.sequence`) so repeated edits don't re-spam unchanged collaborators.
- Wrap dispatch in try/except — a notification failure must never block event creation/update (mirrors the existing visit-plan guard at `create_event`).

**`_send_invite` guard change.** Replace the unconditional `CALENDAR_INVITE_TEST_TO` redirect with: honor `CALENDAR_INVITE_DRY_RUN` (no send, return preview) but **send to real recipients** otherwise. Ensure `ext_sync.sequence` increments correctly on the first real send (currently skipped when TEST_TO was active).

**Frontend.** Keep the manual "Send invites" button as an explicit **resend**. After save, surface a small toast: "Invited N teammates · emailed M external guests."

**Acceptance:** Adding a collaborator and saving (a) inserts a notification for each internal teammate, (b) emails each external address once, (c) re-saving without changes sends nothing new, (d) changing the time sends an "update" to already-invited collaborators.

## Feature 2 — Internal-team picker linked to calendar

**Frontend only** (`CollaboratorPicker.js`). Split the UI into two labelled groups: **"Team — links to their calendar & notifies them"** (internal toggles) and **"External — email invite"** (email input). Wire the §4 availability hint into the team toggles (show a busy badge next to a teammate whose blocked window overlaps the event time). No backend change — calendar linkage already works via `_agenda_events`.

**Acceptance:** Selecting a teammate shows them under "Team"; after save the event appears on that teammate's Delegation calendar and bell.

## Feature 3 — KPI cards → clickable drill-down

**Frontend** (`DelegationDashboard.js` + a `TaskDrillPanel` reusing `MyTasksTable`/list rendering). Cards (Pending, Overdue, Today, Completed, Verified) become buttons. Clicking opens a panel listing the matching instances with a **"Mine / All Team" toggle**:

- **Mine** → `GET /instances?emp_id=<me>&status=<card>` (delegatee default; always available).
- **All Team** → boss: `GET /instances?status=<card>`; delegator: `GET /instances?delegator_id=<me>&status=<card>`. Toggle hidden for delegatee.
- Overdue card adds `date_to=<today-1>`; Today adds `date_from=date_to=<today>`.

Reuses existing `/instances`. **Acceptance:** Clicking Pending lists exactly the pending instances; toggling Mine/All changes the set per role; counts match the card.

## Feature 4 — Time-block availability (soft warning + override)

**Backend.**
- Add `busy: bool` to `del_plan_blocks` (default `false`). `POST/PATCH /plan-blocks` accept it.
- New `GET /availability?emp_ids=<csv>&date=<iso>` → `{ emp_id: [ {start_time, end_time, label, source} ] }` from busy plan-blocks **plus** that employee's timed events (`cal_events` where they're creator/collaborator) and timed task instances on that date.

**Frontend.**
- `DayPlanBlockDialog.js`: add a **"Busy / Unavailable"** toggle (e.g. "Lunch 1–3pm").
- New `AvailabilityHint` component used in **Assign Tasks** (`DelegationTaskForm`) and **Event dialog**: when a date + time + assignee/collaborator is chosen, fetch `/availability`; on overlap render a soft banner — *"Aman is blocked 1–3 pm (Lunch). Choose another time?"* — with a suggested next free slot and an **"Assign anyway"** override. Blocked ranges are greyed/marked in the time inputs.

**Acceptance:** Assigning a task to a teammate inside their busy window shows the warning + suggestion; "Assign anyway" proceeds; a non-overlapping time shows no warning.

## Feature 5 — "Who assigned this" + relationship view

**Frontend only.**
- Instance/task detail drawer surfaces **"Assigned by {delegator_name}"** prominently (already on the instance).
- My Tasks gains a **person picker**. Selecting a teammate renders two lists:
  - **"Assigned to me by {person}"** → `GET /instances?emp_id=<me>&delegator_id=<person>`
  - **"Assigned by me to {person}"** → `GET /instances?emp_id=<person>&delegator_id=<me>`

No new endpoint. **Acceptance:** With Parul↔Aman tasks both directions, Aman selecting Parul sees both lists correctly populated.

## Feature 6 — Instant calendar refresh

**Frontend.** After every mutation — `createEvent`, `updateEvent`, `sendInvites`, `createBlock`/`updateBlock`/`deleteBlock`, task **assign** (`DelegationTaskForm` submit), `complete`/`verify` — call the relevant `load()`/`refreshAll()` immediately rather than waiting for the 45s poll. Add a single shared refresh signal (a small `useDelegationRefresh` pub/sub or a lifted callback) so a task created under **Assign Tasks** also refreshes the **Calendar** view in the same session. A collaborator's calendar updates on their next poll/refresh (no realtime push in scope).

**Acceptance:** Creating/collaborating on an event or assigning a task updates the visible calendar/list within one render, no manual reload.

---

## Out of scope (YAGNI)

- Real-time push/websocket to *other* users' browsers (their calendar updates on poll/refresh).
- External (ICS) availability free/busy lookup.
- Recurring-block availability beyond a single date.
- Reworking the role model or the existing reassignment-approval flow.

## Files touched

**Backend:** `backend/routes/delegation_routes.py` (collab dispatch, `_send_invite` guard, `busy` on plan-blocks, `/availability`).
**Frontend:** `useDelegationCalendar.js`, `useDelegationApp.js`, `DelegationDashboard.js`, `CollaboratorPicker.js`, `EventDialog.js`, `DayPlanBlockDialog.js`, `DelegationTaskForm.js`, `MyTasksTable.js`; new `TaskDrillPanel`, `AvailabilityHint`, `RelationshipView` components and a `useDelegationRefresh` signal.

## Risks / rollout

- **Email blast risk:** removing the test guard means real sends. Mitigate with the per-collaborator `invited_at` de-dup and the material-change check on updates; verify on one event before broad use.
- **Notification volume:** WhatsApp collab-notify ships OFF; in-app notices are cheap.
- Reuses existing infra (Gmail SMTP, WhatsApp queue, `del_notifications`, `/instances`) — no new dependencies.
