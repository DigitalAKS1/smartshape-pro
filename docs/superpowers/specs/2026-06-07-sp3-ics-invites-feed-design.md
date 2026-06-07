# SP3 REST — ICS Email Invites + Subscribe Feed — Design Spec (Sub-project 3, REST half)

**Date:** 2026-06-07
**Module:** SmartShape Pro — Delegation Collaborative Calendar
**Status:** Approved for planning
**Depends on:** SP1 (`cal_events` + agenda) and SP3-pull (`event_ics`, the per-event `.ics` link) — both LIVE.

---

## 0. Context

SP3 has two halves. The **pull core** (per-event `GET /delegation/events/{id}.ics` +
"Add to calendar" drawer link, `METHOD:PUBLISH`) is already LIVE. This spec covers the
**REST half**: emailing real iCalendar invites to collaborators and a subscribe-able
per-user feed (the only path that covers Apple, which has no OAuth calendar API).

### ⚠️ Outward-facing — SEND-SAFE is a hard requirement
This emails real people including external clients. Every design choice below favors
*no accidental sends*:
- **Manual trigger only** — nothing emails on create/edit/cancel by itself; the creator
  clicks an explicit button.
- **Two env-var guards** — `CALENDAR_INVITE_DRY_RUN` (build everything, skip SMTP) and
  `CALENDAR_INVITE_TEST_TO` (redirect all recipients to one safe address). All automated
  tests run with `DRY_RUN=1` against `smartshape_test` → **zero real emails**.
- **UI confirm-before-send** lists the exact recipient addresses.

### Decisions locked in brainstorming
- Trigger model: **fully manual** (button), across create/update/cancel.
- Test-safe path: **env-var guards** (`CALENDAR_INVITE_DRY_RUN`, `CALENDAR_INVITE_TEST_TO`),
  not a request parameter, so prod can't be flipped into test or vice-versa by a payload.
- `ORGANIZER` = the configured SmartShape sender mailbox (`CN` = creator name), **not**
  the creator's address — because we send via Gmail SMTP and a `From` ≠ `ORGANIZER`
  mismatch makes clients flag spoofing and drop the add-to-calendar card. RSVP is in-app;
  we never parse inbound email, so an accurate ORGANIZER address buys nothing.
- UID/SEQUENCE live in the reserved `cal_events.ext_sync`.

---

## 1. Goal

Let an event creator deliberately email standards-compliant iCalendar invites to
collaborators (auto-adding the event to their Google/Apple/Outlook calendar, with proper
updates and cancellations), and let any user subscribe their calendar app to a private
feed URL of all their events.

### Non-goals (YAGNI)
- No inbound RSVP email parsing — RSVP stays in-app (SP1 respond flow).
- No recurring events.
- No per-collaborator delivery/open tracking beyond an `invited_emails` list.
- No attachment of files other than the `.ics`.
- No OAuth two-way sync (that is SP4).

---

## 2. Data model — additive only

Reuse `cal_events.ext_sync` (reserved in SP1, no migration):

```jsonc
"ext_sync": {
  "ics_uid": "evt_xxxxxxxx@smartshape.in",  // stable; equals the existing event_ics UID
  "sequence": 0,                            // bumps on every update / cancel
  "last_method": "REQUEST",                 // REQUEST | CANCEL
  "invited_emails": ["rep@smartshape.in", "client@abc.edu"],
  "invited_at": "2026-06-07T..."
}
```

New field on the `del_employees` doc (lazily written, additive):

```jsonc
"calendar_feed_token": "<secrets.token_urlsafe(32)>"  // per-user subscribe-feed secret
```

---

## 3. Backend (`backend/routes/delegation_routes.py`)

### 3.1 Shared ICS builder (refactor — one source of truth)
Extract from today's `event_ics`:
- `_build_vevent(ev, *, method, sequence) -> list[str]` — the VEVENT lines. For
  `method == "REQUEST"`, attendees get `ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE`;
  for `CANCEL`, `STATUS:CANCELLED`; for `PUBLISH`, today's behavior. Always emits
  `UID` (`ext_sync.ics_uid` if present else `{event_id}@smartshape.in`), `SEQUENCE`,
  `DTSTAMP`, `DTSTART/DTEND` (TZID `Asia/Kolkata` or `VALUE=DATE`), `SUMMARY`,
  optional `DESCRIPTION`/`LOCATION`, `ORGANIZER`, `ATTENDEE`s.
- `_wrap_vcalendar(method, vevents) -> str` — VCALENDAR envelope (`VERSION:2.0`,
  `PRODID`, `CALSCALE`, `METHOD`), CRLF-joined.
- Existing `event_ics` rewritten to call these with `method="PUBLISH"` — **behavior
  unchanged** (covered by a characterization assertion in tests).

### 3.2 Invite sender
- `_email_settings() -> dict | None` — reads `db.settings.find_one({"type":"email"})`;
  returns None when missing/disabled.
- `async def _send_invite(ev, *, method, sequence, recipients) -> dict` — builds a
  `multipart/mixed` message: a `text/plain` human summary, a
  `text/calendar; method=<METHOD>; charset=UTF-8` part, and the same content as a named
  `.ics` attachment (maximizes client rendering). Honors guards:
  - `CALENDAR_INVITE_DRY_RUN` truthy → **skip** `smtplib`; return
    `{dry_run: True, sent: recipients}`.
  - `CALENDAR_INVITE_TEST_TO` set → replace recipients with `[that_addr]`, prefix
    subject with `[TEST]`.
  - Otherwise send via Gmail `SMTP_SSL` using `sender_email`/`gmail_app_password`
    (same mechanism as `_send_email`).

### 3.3 Endpoint — `POST /delegation/events/{event_id}/invite`
- Creator-only (404 if missing, 403 if `created_by != caller`).
- Body `{kind: "request" | "cancel"}`, default `"request"`.
- 400 if email settings disabled/unconfigured (unless DRY_RUN — DRY_RUN still computes).
- Recipients = `collaborators[].email` that are non-empty **and not the creator** (both
  `user` and `email` types).
- `sequence`:
  - `request` → `0` if `ext_sync.sequence` unset, else `ext_sync.sequence + 1`.
  - `cancel` → `(ext_sync.sequence or 0) + 1`.
- `method` = `REQUEST` (kind=request) or `CANCEL` (kind=cancel).
- On success, write `ext_sync = {ics_uid, sequence, last_method, invited_emails, invited_at}`.
- Returns `{kind, method, sequence, sent:[...], skipped:[...], dry_run:bool}`. `skipped`
  = collaborators without an email (e.g. internal user rows missing an address).

### 3.4 Subscribe feed
- `GET /delegation/calendar.ics?token=…` — **public, unauthenticated** (token is the
  secret). Look up `del_employees` by `calendar_feed_token`; 404 on bad/blank token.
  Query that owner's **active** `cal_events` (creator or collaborator, same `$or` as
  `_agenda_events`) within a rolling window `today−90d … today+365d`. Return a
  `METHOD:PUBLISH` VCALENDAR with one VEVENT per event. Cancelled events omitted.
  Headers: `Content-Type: text/calendar; charset=utf-8`, `Cache-Control: max-age=3600`.
- `GET /delegation/calendar-feed` (auth) — resolve actor; if the `del_employees` doc
  lacks `calendar_feed_token`, generate `secrets.token_urlsafe(32)` and persist it.
  Return `{url, webcal_url}` where `url` = `https://app.smartshape.in/api/delegation/calendar.ics?token=…`
  and `webcal_url` swaps the scheme to `webcal://` (one-click subscribe on Apple/Outlook).
  Base URL from `PUBLIC_BASE_URL`/`FRONTEND_URL` env with an `app.smartshape.in` default.
- `POST /delegation/calendar-feed/rotate` (auth) — regenerate the token (old URL dies),
  return the new `{url, webcal_url}`.

### 3.5 Authorization summary
Invite = creator only. Feed link/rotate = the authenticated owner only. Public feed =
bearer-of-token (the secret in the URL).

---

## 4. Frontend

### 4.1 API client (`frontend/src/lib/api.js`)
`delegation.events.invite(id, kind)`, `delegation.calendarFeed()`,
`delegation.rotateCalendarFeed()`.

### 4.2 Hook (`useDelegationCalendar.js`)
`sendInvites(id, kind="request")` (calls API, surfaces the returned `sent`/`skipped`),
`getFeedLink()`, `rotateFeedLink()`, plus state for the feed-link UI.

### 4.3 Components
- **EventActionDrawer** (creator branch): a **"Send invites"** button, relabeled
  **"Send update"** when `ext_sync.sequence` is already set (read from the agenda event
  `meta`; expose `ext_sync` summary in `_agenda_events` meta). Clicking opens a confirm
  that **lists the exact recipient emails** before sending; on success shows
  "Invited N · skipped M".
- **Cancel flow:** the cancel confirmation gains a **"Notify collaborators"** checkbox.
  When checked, after `cancelEvent(id)` resolves, call `sendInvites(id, "cancel")`.
- **Subscribe link:** a "Subscribe in your calendar app" row in the calendar header
  overflow — shows the `webcal` URL with **Copy** and **Rotate link**, lazily loaded via
  `getFeedLink()`.

### 4.4 Agenda meta addition
`_agenda_events` adds to `meta`: `invited` (bool — `ext_sync.sequence` is set),
`sequence` so the drawer can pick "Send invites" vs "Send update".

---

## 5. Error handling & edge cases
- Invite on a non-existent event → 404; by a non-creator → 403.
- Email settings disabled and not DRY_RUN → 400 "Email not configured".
- Event with zero emailable collaborators → `sent:[]`, `skipped:[...]` (no SMTP attempt),
  200 — UI says "no one to invite".
- All-day events → `VALUE=DATE` DTSTART/DTEND in the ICS.
- Cancel-notify for an event never invited → still valid (`sequence` 0→1), but the UI only
  offers it once the event exists; harmless if `invited_emails` empty (sent:[]).
- Bad/blank feed token → 404. Rotate → old token 404s thereafter.
- Feed window excludes events outside −90/+365d and all cancelled events.

## 6. Testing — backend integration (live test DB, `DRY_RUN=1`, `EvtTest` prefix, self-cleaning)
1. **First invite:** create event w/ a teammate + an external email → `POST …/invite` →
   `sequence:0`, `sent` = both emails minus creator, `ext_sync.ics_uid` set; the built ICS
   (assert via a DRY_RUN echo of the body or a follow-up `.ics` fetch) contains
   `METHOD:REQUEST` and `RSVP=TRUE`.
2. **Update invite:** second call → `sequence:1`, same `ics_uid`.
3. **Cancel notify:** `kind:"cancel"` → `METHOD:CANCEL`, `STATUS:CANCELLED`, `sequence` bumped.
4. **Auth:** invite by non-creator → 403; missing event → 404.
5. **Settings:** with email disabled and DRY_RUN off → 400 (separate sub-test toggling the
   setting, restored after).
6. **Feed:** `GET /calendar-feed` returns a `url` containing a token; public
   `GET /calendar.ics?token=` returns the owner's active events and **excludes** a
   cancelled one; bad token → 404; `rotate` then old token → 404.
7. **Characterization:** existing `event_ics` still returns `METHOD:PUBLISH` after the
   builder refactor.

To assert ICS contents without sending, the invite endpoint includes the rendered ICS in
its JSON response **only when `DRY_RUN` is on** (field `ics_preview`); production responses
omit it.

Frontend: production build compiles (`DISABLE_ESLINT_PLUGIN=true … react-scripts build`);
the confirm dialog renders the recipient emails.

## 7. Build phases
1. **Backend builder refactor** — `_build_vevent`/`_wrap_vcalendar`; `event_ics` rewired;
   characterization test green.
2. **Invite endpoint + sender** — `_send_invite`, `_email_settings`, guards, `ext_sync`
   writes; tests 1–5.
3. **Subscribe feed** — token endpoints + public feed; test 6.
4. **Frontend** — api/hook/drawer/cancel-notify/subscribe-link; build green.
5. **Verify + deploy** — test DB run, production build, manual one-recipient `TEST_TO`
   smoke (optional, user-driven), deploy.

## 8. Risks
- Gmail SMTP deliverability / spam classification of calendar parts — mitigated by sending
  as the configured mailbox (ORGANIZER match) and including a plain-text part. Documented.
- Public feed URL is a bearer secret — mitigated by 32-byte token + rotate endpoint.
- `From` ≠ creator may confuse a recipient ("invite came from SmartShape, not Aman") —
  mitigated by naming the creator in the body and `ORGANIZER;CN`.
