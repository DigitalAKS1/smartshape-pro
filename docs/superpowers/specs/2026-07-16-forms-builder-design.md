# Forms Builder + Public Event Registration — Design Spec

**Date:** 2026-07-16
**Branch:** `feat/forms-builder` (off live `main` in `F:/ss-work`)
**Status:** Approved by owner (brainstorm 2026-07-16)

## 1. Problem

The owner currently uses a Google Apps Script to create registration forms for
"SMARTS-SHAPES Teacher's Enrichment Sessions" (webinars for school teachers):
form → teachers register → confirmation email with Zoom link. This lives
outside SmartShape, has no WhatsApp, no CRM capture, no reminders, and must be
re-scripted per session.

**Goal:** a Forms module inside SmartShape — any user builds a form
(Google-Forms style), shares a public link/QR with teachers, teachers register
on a branded mobile page without logging in, and automatically receive
Email + WhatsApp confirmations carrying the Zoom link and calendar entry,
plus automatic reminders. Registrations flow into the CRM.

## 2. Approved requirements

| Decision | Choice |
|---|---|
| Scope | Generic form builder + **Event Registration** preset on top |
| Zoom link | Pasted manually in v1; model reserves fields for Zoom-API auto-create (v2) |
| Confirmation | Instant **Email + WhatsApp**, both containing the Zoom link |
| Calendar | `.ics` attached to email; **Add-to-Google-Calendar link** in email, WhatsApp and thank-you page |
| CRM | Auto-create/link Contacts (dedup phone→email), match School by name |
| Reminders | Automatic **24 h + 1 h before** (email + WhatsApp) **and** manual "Send reminder now" |
| Access | **All users** can create forms; per-form **collaborators**; admin sees all |
| Share | Share panel: copy link + **QR download** + WhatsApp share button with prefilled invite |
| Tracking | Live responses table + **Excel/CSV export** |

Out of v1 (designed-for): Zoom-API auto-create button, registration cap /
close-date UI, CRM-audience invite blasts, post-session participation
certificates (existing certificates pipeline is the natural v2 hook).

## 3. Architecture — Approach C (approved)

Generic form builder as a new module; **Event forms bridge into the existing
production webinar engine** instead of duplicating it:

- `training_sessions` + `session_registrations` already implement the full
  lifecycle: confirm / 24 h / 1 h email stages with join link + ICS
  (`backend/routes/training_routes.py`, `backend/webinar_lifecycle.py`,
  `backend/webinar_templates_html.py`, `scheduler.py::webinar_lifecycle_loop`
  every 10 min, idempotent via per-registration `sent_stages`).
- Saving an **Event form** creates/updates its linked `training_session`.
- Each public submission inserts a `session_registrations` row → existing
  engine handles email stages unchanged.
- **New in this feature:** dynamic field schema, public no-login endpoint,
  WhatsApp channel on every stage, CRM upsert, collaborators, share
  panel/QR, responses table + export.

### 3.1 New collections

**`forms`** (ids `form_<hex12>`, string ids, `{"_id":0}` reads — house style):

```
form_id, title, description, type: "event"|"general",
owner_email, collaborators: [email],
public_token: uuid4-string      # link-is-secret, catalogue pattern
status: "open"|"closed",
banner_url, created_at, updated_at (UTC ISO),
fields: [ { field_id, label, type, required, choices[], order, map_to } ],
# type ∈ text|textarea|dropdown|multiple_choice|checkbox|number|date
# map_to ∈ name|email|phone|school|designation|city|null  (CRM mapping)
event: {                        # event forms only
  theme, date "YYYY-MM-DD", time "HH:MM" (IST), duration_min,
  platform: "zoom"|"meet"|"physical", meeting_link,
  zoom_meeting_id: null,        # reserved for v2 auto-create
  max_participants: null,
  session_id                    # linked training_sessions doc
},
messages: {                     # editable templates w/ {name},{school_name},
  email_subject, email_html,    # {zoom_link},{date},{time},{theme}
  wa_confirm, wa_reminder
}
```

**`form_responses`** (ids `fresp_<hex12>`):

```
response_id, form_id, answers: {field_id: value},
submitted_at, ip_hash,
contact_id | null, school_id | null,        # CRM links
registration_id | null,                      # session_registrations link
delivery: { email: "queued|sent|failed|skipped", whatsapp: same }
```

Indexes (registered in `database.py::connect_db()` via the non-fatal `_i()`
wrapper): `forms.form_id` unique, `forms.public_token` unique,
`form_responses.response_id` unique, `form_responses.form_id + submitted_at`.

Preset fields for new Event forms: Name*, Email*, School Name*, Designation
(dropdown: Art Teacher / Coordinator / Pre Primary Teacher / PRT / TGT /
Other)*, Contact Number*, City* — all editable/removable/reorderable.

### 3.2 Backend routes — new `backend/routes/form_routes.py`

Authenticated (standard `get_current_user`; module `forms`; owner OR
collaborator OR admin for per-form ops):

- `GET /api/forms` — list (admin: all; others: owned + collaborating)
- `POST /api/forms` — create (generic or event preset)
- `GET/PUT/DELETE /api/forms/{form_id}` — manage; PUT syncs the linked
  `training_session` for event forms; DELETE soft-deletes (`is_deleted`)
- `POST /api/forms/{form_id}/status` — open/close
- `GET /api/forms/{form_id}/responses` — table data
- `GET /api/forms/{form_id}/export.xlsx|.csv` — openpyxl / csv StreamingResponse
  (pattern: `dynamic_import_routes.py:315`, `admin_routes.py:880`)
- `POST /api/forms/{form_id}/remind` — manual blast (email + WhatsApp) to all
  registrants now

Public (NO auth — token is the secret, like `/api/catalogue/{token}`):

- `GET /api/forms/public/{public_token}` — sanitized form schema + event
  details (only while `status == "open"`; never leaks owner/collaborators)
- `POST /api/forms/public/{public_token}/submit` — validate → protect →
  persist → CRM upsert → confirmations. Returns thank-you payload
  (zoom link + Google-Calendar URL for event forms).

### 3.3 Submission pipeline (event form)

1. **Validate**: required fields, type checks, hard length caps (200 chars
   text / 2000 textarea), choices must be from schema.
2. **Protect**: honeypot field (`website` — any value ⇒ silent 200 no-op);
   per-IP sliding-window rate limit (in-memory, 5 submits/10 min/form);
   per-form response ceiling 5000; form must be open.
3. **Persist** `form_responses` row.
4. **CRM upsert** (`map_to`-tagged answers): match Contact by normalized
   phone, then email. Existing contact → fill *blank* fields only, never
   overwrite. New contact → create with `source: "form"`,
   `source_form_id`. School Name → case-insensitive match against
   `schools`; link `school_id` if found (no auto-create of schools).
5. **Event bridge**: insert `session_registrations` row (dedup by
   session+email keeps existing engine invariants) → enqueue existing
   `confirm` email stage (join link + ICS + Google-Calendar link).
6. **WhatsApp confirm**: render `messages.wa_confirm` → insert into
   `whatsapp_scheduled` (`wsch_` row; `wa_sender_loop` flushes ≤2 min,
   Evolution `send_text`, existing throttle). Invalid/absent phone ⇒
   `delivery.whatsapp = "skipped"`.
7. **Update** `delivery` statuses on the response row.

Generic (non-event) forms stop after step 4 — thank-you message only, no
confirmations in v1 unless the form has an email `map_to` and the owner
enabled "send confirmation email" (simple toggle, reuses same pipeline
minus event bits).

### 3.4 Reminders

- Extend the existing `webinar_lifecycle_loop` stage handling: when a stage
  (`reminder_24h`, `reminder_1h`) fires for a session linked to a form,
  ALSO enqueue `whatsapp_scheduled` rows rendered from
  `messages.wa_reminder`. Reuses the loop's idempotent `sent_stages` guard —
  no new scheduler loop needed.
- Manual `POST /forms/{id}/remind` enqueues both channels immediately,
  stamped into a `manual_reminders` audit array on the form.

### 3.5 Calendar

- Email: existing ICS attachment machinery (delegation `_send_invite` /
  `webinar_ics.py` patterns).
- WhatsApp + thank-you page: prefilled
  `https://calendar.google.com/calendar/render?action=TEMPLATE&text=...&dates=...&details=...`
  URL (IST → UTC conversion; details include Zoom link).

### 3.6 Frontend

Routing in `frontend/src/App.js` (lazy chunks); module key `forms` added to
`AdminNavItems.js` `MODULE_ROUTE_MAP` + **School Engagement** section.

- **`pages/admin/FormsList.js`** — table (name, type, status, responses,
  event date) + New Form / New Event Registration.
- **`pages/admin/FormBuilder.js`** — left: event-details panel (event forms),
  fields editor (add/remove/reorder via up-down buttons, edit label/type/
  required/choices), Messages tab (email subject/body + WhatsApp texts with
  placeholder chips), Collaborators picker (users list); right: live
  mobile-width preview. Share panel: copy link, QR download
  (`qrcode.react`, client-side), WhatsApp share
  (`https://wa.me/?text=<invite>`).
- **`pages/admin/FormResponses.js`** — live table, delivery ticks
  (email/WA), export buttons, Send-reminder-now.
- **`pages/PublicForm.js`** — public route `/f/:token` (no ProtectedRoute;
  pattern: `CataloguePage.js`). Mobile-first, SmartShape-branded: banner,
  event card (theme/date/time), fields, honeypot (visually hidden), submit →
  thank-you screen with Zoom link + Add-to-Google-Calendar button. Plain
  axios on `REACT_APP_BACKEND_URL` (`lib/api.js` BASE), no credentials.

Frontend-design attention goes to `PublicForm.js` (teacher-facing, brand
surface); admin pages follow existing admin UI idioms.

### 3.7 RBAC & collaborators

- Module key `forms` in the assigned-modules system; per launch decision all
  users are expected to be granted it (RBAC fail-open default per
  MODULE_RBAC_MODE conventions).
- Per-form authorization: `owner_email == user` OR `user in collaborators`
  OR admin (`require_admin` pattern from `rbac.py`). Collaborators get full
  co-manage (edit, responses, export, remind). View-only tier deferred.

## 4. Error handling

- Public submit never 500s to the teacher: validation errors → 422 with
  friendly field messages; rate-limit → 429 "please try again in a few
  minutes"; closed form → 410 page state; honeypot → silent success.
- Email/WhatsApp failures are queue-side (existing retry/status semantics);
  response row records `failed` — visible as a red tick in Responses table.
- CRM upsert failure must NOT lose the registration: response row persists
  first; CRM step wrapped, errors logged to response doc (`crm_error`).
- Deleting/closing a form leaves the linked session + registrations intact
  (history preserved); public page shows "Registrations closed".

## 5. Testing

Backend pytest (in repo `backend/tests` conventions on main):

- Field validation matrix (required/type/choices/length caps).
- Honeypot, rate-limit, closed-form, ceiling behaviors.
- CRM upsert: new contact / existing-by-phone fill-blanks-only / school link.
- Event bridge: session created on save; registration row + confirm stage
  enqueued; WhatsApp row enqueued; dedup by session+email.
- Reminder stage → WhatsApp enqueue idempotence (`sent_stages`).
- Export endpoints produce parseable CSV/XLSX.
- Public schema endpoint leaks nothing sensitive.

Manual verify before deploy: full flow against local backend (NOTE: local
backend hits prod DB — use a throwaway test form and clean up), then bundle
build with `REACT_APP_BACKEND_URL=https://app.smartshape.in`.

## 6. Deployment

Standard main-worktree procedure: implement on `feat/forms-builder` in
`F:/ss-work`; merge to `main` with an explicit bundle-rebuild commit
(`DISABLE_ESLINT_PLUGIN=true`, `NODE_OPTIONS=--max-old-space-size=4096`,
inline `REACT_APP_BACKEND_URL`); never `git add -A`; push → VPS auto-deploy
timer; verify by bundle CONTENT on prod. `feat/module-rbac` (F:/SMARTSHAPE
APP) is a stale fork — nothing merges from it.
