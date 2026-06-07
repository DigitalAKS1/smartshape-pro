# Collaborative Calendar Events + Click-to-Add — Design Spec (Sub-project 1)

**Date:** 2026-06-07
**Module:** SmartShape Pro — Delegation Calendar
**Status:** Approved for planning

---

## 0. Program decomposition (context)

The full ask ("click anywhere to add a task, collaborate by email, auto-sync to Google/Apple/Outlook, cleaner calendar") is **four independent subsystems**, built in order:

1. **Collaborative Events + Click-to-Add** — THIS spec. Shared `cal_events` + click-a-slot to add a personal block or a collaborator event. Foundation for everything below.
2. **Calendar design polish** (`frontend-design`) — finishing pass of Sub-project 1's UI.
3. **ICS invites + Apple feed** — email `.ics` invites (auto-add to Google/Apple/Outlook for any collaborator) + a subscribe-able per-user ICS feed for Apple.
4. **Google + Microsoft OAuth two-way sync** — connect-account flows, token storage, push+pull. Requires external setup (Google Cloud + Azure + privacy policy + Google verification). Apple stays on the #3 feed (no Apple OAuth calendar API exists).

This spec covers **Sub-project 1 only**. Sub-projects 2–4 get their own specs. The `cal_events` model here intentionally reserves an `ext_sync` field so #3/#4 attach without a migration.

### Decisions locked in brainstorming
- Sync end-goal = **full OAuth two-way** (Google + MS) — deferred to Sub-project 4; Apple via ICS feed (#3).
- Click a slot → **choice of** a quick personal **block** *or* a full **event**.
- Collaborators = **internal teammates AND any external email**.
- Build everything, **in the sub-project order above**.

---

## 1. Goal (Sub-project 1)

Let a user click any time on the calendar to add work, and create **shared events** that instantly appear on every collaborator's calendar inside the app. This is the in-app foundation; external-calendar delivery is Sub-projects 3–4.

### Non-goals (this sub-project)
- No `.ics`, no external calendar delivery, no OAuth (those are #3/#4).
- No recurring events in v1 (single occurrence).
- No availability/free-busy or conflict detection.

---

## 2. Data model — new `cal_events` collection

```jsonc
{
  "event_id": "evt_xxxxxxxx",
  "title": "Kickoff with DPS",
  "description": "",
  "location": "",
  "color": "#0ea5e9",
  "date": "2026-06-10",          // YYYY-MM-DD
  "start_time": "11:00",         // HH:MM, or null when all_day
  "end_time": "11:30",           // HH:MM, or null
  "all_day": false,
  "created_by": "info@smartshape.in",
  "created_by_emp_id": "emp_xxx",
  "collaborators": [
    { "type": "user",  "emp_id": "emp_abc", "email": "rep@smartshape.in", "name": "Rep", "response": "pending" },
    { "type": "email", "emp_id": null,      "email": "client@abc.edu",    "name": "",    "response": "pending" }
  ],
  "linked_event_id": "",         // optional: agenda event this was created from
  "status": "active",            // active | cancelled
  "ext_sync": {},                // reserved for Sub-projects 3/4 (ics uid, provider ids)
  "created_at": "...", "updated_at": "..."
}
```
Additive; no migration. `collaborators[].response` exists for the respond flow; ICS/OAuth will later read `ext_sync`.

---

## 3. Backend (`backend/routes/delegation_routes.py`)

### 3.1 Event CRUD
- `POST /delegation/events` — body `{title, date, start_time?, end_time?, all_day?, description?, location?, color?, collaborator_emp_ids?:[], collaborator_emails?:[], linked_event_id?}`.
  - Resolve actor (`_resolve_actor`). Require `title` + `date`. Validate `end_time > start_time` when both present.
  - Build `collaborators`: for each emp_id look up `del_employees` (type `user`, capture email+name); for each raw email not already a user, add type `email`. De-dup by email. Always include the creator as an accepted `user` collaborator.
  - Insert; return the event.
- `PATCH /delegation/events/{event_id}` — creator-only. Editable: `title, description, location, color, date, start_time, end_time, all_day, collaborator_emp_ids, collaborator_emails`. Recompute `collaborators` if provided. Set `updated_at`.
- `DELETE /delegation/events/{event_id}` — creator-only; sets `status:'cancelled'` (soft) so later sync can emit a cancel.
- `POST /delegation/events/{event_id}/respond` — body `{response:'accepted'|'declined'}`; updates the calling user's entry in `collaborators` (match by emp_id or email). 403 if caller isn't a collaborator.

### 3.2 Agenda integration
Add `_agenda_events(emp_id, email, dfrom, dto)`:
- Query `cal_events` where `status:'active'`, `date` in `[from,to]`, and the subject is involved:
  `{$or:[{created_by_emp_id: emp_id}, {"collaborators.emp_id": emp_id}, {"collaborators.email": email}]}`.
- Normalize via `_ev` → `source:'event'`, `type:'event'`, `entity_id:event_id`, `link:'/delegation'`, color from the event, `actions`: creator → `['edit','cancel']`; non-creator collaborator → `['respond']` (+ `open`). Include `meta:{collaborators:[names], created_by_name, my_response, is_creator, location, description}`.
- Wire into `get_agenda` alongside the other sources (self and team-view both include events the subject is on).
- Colour: add `"event": "#0ea5e9"` to `AGENDA_COLORS`.

### 3.3 Authorization
Edit/cancel = creator only. Respond = any collaborator. Viewing = creator or collaborator (enforced by the agenda query). Team-view (`emp_id` param) shows that person's events via the same `$or` on their emp_id/email.

---

## 4. Frontend

### 4.1 New components (`frontend/src/components/delegation/calendar/`)
- **`QuickAddPopover.js`** — opens at a clicked slot; shows the target date/time and two choices: **Block** (calls existing `createBlock`) or **Event** (switches to the event form inline or opens `EventDialog`).
- **`CollaboratorPicker.js`** — multiselect of teammates (from `teamOptions`/employees) **+** a free-text email field that adds validated email chips. Emits `{emp_ids:[], emails:[]}`.
- **`EventDialog.js`** — create/edit a shared event: title, date, start/end (or all-day), location, colour, `CollaboratorPicker`, description. Save → `createEvent`/`updateEvent`. Edit mode shows Cancel-event + (for collaborators) respond.

### 4.2 Hook (`useDelegationCalendar.js`)
Add: `createEvent(payload)`, `updateEvent(id,payload)`, `cancelEvent(id)`, `respondEvent(id,response)` (each calls the API + `load()`), and `eventDialog` state. API client: add `delegation.events.{create,update,delete,respond}`.

### 4.3 Click-to-add wiring
- **CalendarDay:** clicking an empty hour slot opens `QuickAddPopover` with that date+time (replaces the current straight-to-block "+"). The hover "+" still adds a block directly for speed.
- **CalendarWeek (AgendaList Phase-2):** an "+" affordance per day opens the popover for that date (all-day default).
- **CalendarMonth:** clicking a day still opens the Day view (unchanged); a small "+" on hover opens the popover for that date.

### 4.4 Rendering events
- `event`-source items render on the grid/list with the event colour and a collaborators glyph (e.g. "+2"). 
- Clicking an `event` opens the existing **EventActionDrawer**, extended: creator sees **Edit / Cancel**; collaborator sees **Accept / Decline**; everyone sees collaborator list + **Open**. (Drawer routes `edit`→`EventDialog`, `cancel`→`cancelEvent`, `respond`→`respondEvent`.)

---

## 5. Error handling & edge cases
- Missing title/date → 400. `end_time <= start_time` → 400.
- Editing/cancelling someone else's event → 403. Responding when not a collaborator → 403.
- External email validation client-side (basic regex) and server-side (skip blanks/dupes).
- All-day events (no time) render in the day/week all-day lane and the month dot.
- Cancelled events excluded from the agenda.
- Creator is always a collaborator (sees their own event; can't be removed).

## 6. Testing
Backend integration tests (live test DB, self-cleaning, `EvtTest` prefix): create event (creator auto-added) → appears in creator's agenda as `source:'event'` with `actions:['edit','cancel']`; a teammate collaborator sees it in *their* agenda; PATCH by non-creator → 403; respond updates the caller's response; respond by non-collaborator → 403; cancel removes it from the agenda; validation (no title/date, end≤start → 400).
Frontend: production build compiles; component render of QuickAddPopover (block vs event branch), CollaboratorPicker (chip add/remove), EventDialog save.

## 7. Build phases (Sub-project 1)
1. **Backend:** `cal_events` CRUD + respond + `_agenda_events` wired into `/agenda` + tests.
2. **Frontend data:** API client + hook actions (create/update/cancel/respond) + event-source rendering + EventActionDrawer extension.
3. **Click-to-add UI:** `QuickAddPopover` + `CollaboratorPicker` + `EventDialog`, wired into Day/Week/Month.
4. **Polish:** fold the `frontend-design` clean-up pass (Sub-project 2) here.

## 8. Risks
- Collaborator identity matching relies on email/emp_id consistency (same approach the agenda already uses). Documented.
- `ext_sync` reserved now so Sub-projects 3/4 need no migration.
