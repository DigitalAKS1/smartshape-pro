# Zoom Webinar Email Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automate the full Zoom webinar/training email lifecycle — invite → registration confirmation (+`.ics`) → 24h/1h reminders → live nudge → no-show / attended follow-up — keyed dynamically off a published `training_sessions` doc with a Zoom link, reusing the HTML email engine (v1) and the existing Zoom attendee-import for attendance truth.

**Architecture:** Builds on the v1 HTML email engine (`email_utils`, `email_scheduled` queue, `process_email_queue`, `personalize_html`). Registration confirmations fire on a register action; time-based stages (reminders/live/follow-up) fire from a NEW `webinar_scheduler_loop` that scans sessions and enqueues HTML rows into the SAME `email_scheduled` queue (idempotent via per-stage flags). Attendance (attended vs no-show) comes from extending the existing `/crm-zoom/import`. `.ics` reuses the RFC-5545 primitives already in `delegation_routes.py`.

**Tech Stack:** FastAPI + Motor/MongoDB, `smtplib`/`email.mime` (via v1 `_smtp_send`), React 19/CRA frontend, existing `delegation_routes.py` iCalendar primitives, existing `crm_zoom` attendee matcher.

## Global Constraints

- **Depends on v1 HTML email engine** (merged: `email_utils.py`, `_smtp_send(...,body_html)`, `process_email_queue` forwarding `body_html`, `_is_suppressed`, `email_scheduled` rows with `{email, subject, message, body_html, status:"pending", type, campaign_id}`).
- **NEVER run tests against prod.** In-process harness against `DB_NAME=smartshape_test` (prod guard `assert _DB_NAME.endswith("_test") or _DB_NAME=="mtt_ci"`); pattern = `backend/tests/test_import_endpoints.py`; pure-logic tests mock `scheduler.smtplib.SMTP_SSL`. Run: `cd backend && MONGO_URL=mongodb://localhost:27017 DB_NAME=smartshape_test python -m pytest tests/<file> -v`. Tests dir is gitignored → force-add.
- **All emails HTML** via `email_utils` (`sanitize_html` + `wrap_email_shell`; `personalize_html` for HTML token substitution, plain `personalize` for subject/plain body). Every mass/registrant path checks `_is_suppressed` before enqueue.
- **Idempotency is mandatory** — every time-based stage fires **exactly once** per registrant (guard flags on the registration doc); a scheduler restart/redeploy must not double-send.
- **Manual Stage 1, auto Stages 2–7** (per spec §5.1 / Nikhil Appendix A.2): the initial invite is the v1 composer (already built); this plan builds the automated stages only.
- **No schema migration** — new fields additive, defaulted at read/write.
- **Python** `C:\Python314\python` (not python3); Windows; bare imports run from `backend/`. Frontend build: `NODE_OPTIONS=--max-old-space-size=4096 DISABLE_ESLINT_PLUGIN=true npm run build`.
- **Merge tokens** (spec §5.2): `{name}`, `{school_name}`, `{session_title}`, `{session_date}`, `{session_time}`, `{platform}`, `{join_url}`, `{add_to_calendar_url}`, `{host_name}`, `{recording_url}`.
- **Template copy** comes verbatim from Nikhil's Appendix A.4 in `docs/superpowers/specs/2026-07-01-html-email-webinar-lifecycle-design.md` (subject A/B + blocks); do not invent new copy.

---

## File Structure

- Create `backend/webinar_ics.py` — session→`.ics` builder reusing `delegation_routes` primitives. One responsibility: iCalendar for a training session.
- Create `backend/webinar_lifecycle.py` — pure helpers: stage due-time computation, per-stage token dict, which registrants are due. DB-free, unit-testable.
- Create `backend/webinar_templates_html.py` — the 7 webinar HTML template bodies (Appendix A.4) keyed by stage.
- Modify `backend/routes/training_routes.py` — session model additions (`host_name`, `host_email`, `recording_url`, `zoom_meeting_id`, `webinar_emails`, `reminders_sent`); `POST /training/sessions/{id}/register`; `GET /training/sessions/{id}/ics`; `POST /training/sessions/{id}/reconcile-attendance`; a shared `_enqueue_webinar_stage(session, registration, stage)` helper.
- Modify `backend/scheduler.py` — add `webinar_lifecycle_loop()` + register it in the start function.
- Modify `backend/routes/email_routes.py` — add `session_id` audience filter to `_resolve_audience`.
- Modify `backend/routes/crm_zoom_routes.py` — extend `/crm-zoom/import` to reconcile attendees ↔ `session_registrations` when `session_id` is provided.
- Modify `frontend/src/pages/admin/CustomerEngagement.js` + `frontend/src/hooks/useCustomerEngagement.js` — session dialog: `host_name`, `recording_url`, and per-stage auto-email toggles; a "Reconcile attendance" action + attended/no-show badges in the registrations view.

---

## Task W1: Session `.ics` builder + endpoint

**Files:**
- Create: `backend/webinar_ics.py`
- Modify: `backend/routes/training_routes.py` (add `GET /training/sessions/{id}/ics`)
- Test: `backend/tests/test_webinar_ics.py`

**Interfaces:**
- Produces: `build_session_ics(session: dict) -> str` — a full VCALENDAR (METHOD:PUBLISH) string for one session, using raw `session["meeting_link"]` as URL/CONFERENCE. Reuses `_ics_escape`, `_ics_dt`, `_ics_fold`, `_wrap_vcalendar` from `routes.delegation_routes`.

- [ ] **Step 1: Write the failing test (pure, no DB)**

```python
# backend/tests/test_webinar_ics.py
from webinar_ics import build_session_ics

def _sess():
    return {"session_id": "sess_x", "title": "Die Workshop", "date": "2099-03-04",
            "time": "10:30", "platform": "zoom", "meeting_link": "https://zoom.us/j/1",
            "description": "Live demo", "location": ""}

def test_ics_has_vevent_and_tzid_and_join():
    ics = build_session_ics(_sess())
    assert "BEGIN:VCALENDAR" in ics and "BEGIN:VEVENT" in ics
    assert "SUMMARY:Die Workshop" in ics
    assert "DTSTART;TZID=Asia/Kolkata:20990304T103000" in ics
    assert "https://zoom.us/j/1" in ics
    assert ics.endswith("\r\n")

def test_ics_physical_uses_location_no_conference():
    s = _sess(); s["platform"] = "physical"; s["meeting_link"] = ""; s["location"] = "Faridabad Center"
    ics = build_session_ics(s)
    assert "LOCATION:Faridabad Center" in ics
    assert "CONFERENCE" not in ics
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd "f:/SMARTSHAPE APP/backend" && DB_NAME=smartshape_test python -m pytest tests/test_webinar_ics.py -v`
Expected: FAIL (`ModuleNotFoundError: webinar_ics`).

- [ ] **Step 3: Implement `webinar_ics.py`**

```python
# backend/webinar_ics.py
"""iCalendar (.ics) for a training session, reusing delegation_routes' RFC-5545 primitives."""
from datetime import datetime, timezone
from routes.delegation_routes import _ics_escape, _ics_dt, _wrap_vcalendar


def build_session_ics(session: dict) -> str:
    dtstart, is_date = _ics_dt(session.get("date", ""), session.get("time", ""))
    dtend, _ = _ics_dt(session.get("date", ""), session.get("time", ""))  # 0-length; clients still add it
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    uid = f"{session.get('session_id','sess')}@smartshape.in"
    join = (session.get("meeting_link") or "").strip()
    lines = ["BEGIN:VEVENT", f"UID:{uid}", f"DTSTAMP:{stamp}", "SEQUENCE:0"]
    if is_date:
        lines += [f"DTSTART;VALUE=DATE:{dtstart}", f"DTEND;VALUE=DATE:{dtstart}"]
    else:
        lines += [f"DTSTART;TZID=Asia/Kolkata:{dtstart}", f"DTEND;TZID=Asia/Kolkata:{dtend}"]
    lines.append(f"SUMMARY:{_ics_escape(session.get('title'))}")
    desc = []
    if join:
        desc.append(f"Join: {join}")
    if session.get("description"):
        desc.append(session["description"])
    if desc:
        lines.append(f"DESCRIPTION:{_ics_escape(chr(10).join(desc))}")
    if session.get("location"):
        lines.append(f"LOCATION:{_ics_escape(session['location'])}")
    if join:
        lines.append(f"URL:{join}")
        lines.append(f'CONFERENCE;VALUE=URI;FEATURE=VIDEO;LABEL="Zoom":{join}')
        lines.append(f"X-GOOGLE-CONFERENCE:{join}")
    lines.append("STATUS:CONFIRMED")
    lines.append("END:VEVENT")
    return _wrap_vcalendar("PUBLISH", [lines])
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd "f:/SMARTSHAPE APP/backend" && DB_NAME=smartshape_test python -m pytest tests/test_webinar_ics.py -v`
Expected: 2 passed.

- [ ] **Step 5: Add the endpoint** to `training_routes.py`

```python
from fastapi.responses import Response

@router.get("/training/sessions/{session_id}/ics")
async def session_ics(session_id: str):
    session = await db.training_sessions.find_one({"session_id": session_id}, {"_id": 0})
    if not session:
        raise HTTPException(404, "Session not found")
    from webinar_ics import build_session_ics
    ics = build_session_ics(session)
    return Response(content=ics, media_type="text/calendar",
                    headers={"Content-Disposition": f'attachment; filename="{session_id}.ics"'})
```

- [ ] **Step 6: Commit**

```bash
git add backend/webinar_ics.py backend/routes/training_routes.py && git add -f backend/tests/test_webinar_ics.py
git commit -m "feat(webinar): session .ics builder + GET /training/sessions/{id}/ics"
```

---

## Task W2: Session + registration data model

**Files:**
- Modify: `backend/routes/training_routes.py` (`create_session`, `update_session`, and a `_session_defaults` reader)
- Test: `backend/tests/test_webinar_model.py`

**Interfaces:**
- Produces: `create_session`/`update_session` accept & persist `host_name`, `host_email`, `recording_url`, `zoom_meeting_id`, and `webinar_emails` (dict of per-stage bools). Reads apply defaults: `webinar_emails` defaults every stage `True`; `reminders_sent` defaults `{}`. `session_registrations` docs gain `status` (`"registered"`), `contact_id`, and per-stage `sent_stages` (list). Stage keys are the canonical set: `"confirm","remind_24h","remind_1h","live","noshow","attended"`.

- [ ] **Step 1: Write the failing test (in-process)** — POST a session with `host_name`+`webinar_emails`, GET it back, assert persisted + defaults present. (Harness per `test_import_endpoints.py`; patch `routes.training_routes.db` + monkeypatch its `get_current_user`.)

```python
# backend/tests/test_webinar_model.py  (abbreviated — full harness like test_import_endpoints.py)
async def test_session_persists_webinar_fields(client, test_db):
    r = await client.post("/api/training/sessions", json={
        "title": "W", "date": "2099-01-02", "time": "09:00", "platform": "zoom",
        "meeting_link": "https://zoom.us/j/9", "host_name": "Aman",
        "webinar_emails": {"remind_1h": False}})
    assert r.status_code == 200
    sid = r.json()["session_id"]
    got = [s for s in (await client.get("/api/training/sessions")).json() if s["session_id"] == sid][0]
    assert got["host_name"] == "Aman"
    assert got["webinar_emails"]["remind_1h"] is False
    assert got["webinar_emails"].get("confirm") is True   # default-filled
```

- [ ] **Step 2: Run → RED.** `cd backend && MONGO_URL=mongodb://localhost:27017 DB_NAME=smartshape_test python -m pytest tests/test_webinar_model.py -v`

- [ ] **Step 3: Implement.** In `create_session` doc add:
```python
"host_name": body.get("host_name", ""),
"host_email": body.get("host_email", ""),
"recording_url": body.get("recording_url", ""),
"zoom_meeting_id": body.get("zoom_meeting_id", ""),
"webinar_emails": {**{k: True for k in ("confirm","remind_24h","remind_1h","live","noshow","attended")}, **(body.get("webinar_emails") or {})},
"reminders_sent": {},
```
Add the same keys to `update_session`'s `allowed` list (`host_name, host_email, recording_url, zoom_meeting_id, webinar_emails`). In `list_sessions`, after fetching, backfill defaults for legacy docs missing `webinar_emails` (map default-True dict) so reads are consistent. Registration status fields are set where registrations are created (Task W3).

- [ ] **Step 4: Run → GREEN.**

- [ ] **Step 5: Commit** (`training_routes.py` + test). Message: `feat(webinar): session webinar_emails/host/recording fields + defaults`.

---

## Task W3: Register endpoint + Stage-2 confirmation (HTML + .ics)

**Files:**
- Modify: `backend/routes/training_routes.py` (`POST /training/sessions/{id}/register`, `_enqueue_webinar_stage` helper)
- Test: `backend/tests/test_webinar_register.py`

**Interfaces:**
- Produces:
  - `async def _enqueue_webinar_stage(session, reg, stage)` — builds the stage's HTML (via `webinar_templates_html` + tokens), skips if suppressed or already in `reg["sent_stages"]`, inserts an `email_scheduled` row (`type:"webinar"`, `campaign_id: f"webinar_{session_id}"`), and marks `sent_stages`. Returns True if enqueued.
  - `POST /training/sessions/{id}/register` body `{name, email, school_name?, contact_id?}` → upserts a `session_registrations` row (dedup by session+email), sets `status:"registered"`, `sent_stages:[]`, then calls `_enqueue_webinar_stage(session, reg, "confirm")` when `webinar_emails.confirm`. Returns `{registered: True, reg_id}`.

- [ ] **Step 1: Failing test** — register a contact, assert a `session_registrations` row exists (`status:"registered"`) AND an `email_scheduled` row with `type:"webinar"`, non-empty `body_html`, and the `.ics` add-to-calendar link/token present; re-register same email → no duplicate registration, no duplicate confirm.

- [ ] **Step 2: Run → RED.**

- [ ] **Step 3: Implement** `_enqueue_webinar_stage` (reuse the enqueue shape from `notify_session`; use `personalize_html` for `body_html`, plain `personalize` for subject/message; tokens from a `_session_tokens(session)` dict incl. `add_to_calendar_url = f"{FRONTEND_URL}/api/training/sessions/{id}/ics"`), the `register` endpoint, and a `_get_or_create_registration` dedup. `webinar_templates_html.STAGE_HTML["confirm"]` supplies the body (Task W4 — for RED you may inline a minimal body, but W4 replaces it).

- [ ] **Step 4: Run → GREEN.**

- [ ] **Step 5: Commit.** Message: `feat(webinar): register endpoint + stage-2 confirmation via HTML queue`.

---

## Task W4: Webinar HTML templates (7 stages)

**Files:**
- Create: `backend/webinar_templates_html.py`
- Test: `backend/tests/test_webinar_templates.py`

**Interfaces:**
- Produces: `STAGE_HTML: dict[str,str]` and `STAGE_SUBJECT: dict[str,str]`, keyed by the 6 auto stages (`confirm, remind_24h, remind_1h, live, noshow, attended`), authored from Nikhil's Appendix A.4 (email-safe HTML, 600px shell via `email_utils.wrap_email_shell` or self-wrapped, bulletproof CTA, tokens intact). `render_stage(stage, tokens) -> (subject, html)` substitutes `{...}` tokens.

- [ ] **Step 1: Failing test** — `render_stage("confirm", {...tokens})` returns a subject containing the session title and an html containing `{join_url}`'s value + `#e94560` + no leftover `{session_title}`.
- [ ] **Step 2: Run → RED.**
- [ ] **Step 3: Implement** the 6 stage bodies (copy from Appendix A.4; reuse a local `_wrap`/`_btn` DRY helper like `email_templates_html.py`). `render_stage` does plain `str.replace` of tokens into subject and (separately) into html — the CALLER escapes contact values via `personalize_html`; template-level session tokens (title/date/url) are trusted app data.
- [ ] **Step 4: Run → GREEN. Wire** `training_routes._session_tokens` + `_enqueue_webinar_stage` to use `render_stage` (replace any inline body from W3).
- [ ] **Step 5: Commit.** Message: `feat(webinar): 6 email-safe HTML lifecycle templates`.

---

## Task W5: `webinar_lifecycle` due-time helpers (pure)

**Files:**
- Create: `backend/webinar_lifecycle.py`
- Test: `backend/tests/test_webinar_lifecycle.py`

**Interfaces:**
- Produces (all pure, take an explicit `now: datetime` — never call `datetime.now` inside, for testability):
  - `session_start_ist(session) -> datetime|None` — parse `date`+`time` as Asia/Kolkata naive UTC-offset datetime.
  - `due_time_stages(session, now) -> list[str]` — which of `remind_24h`(start−24h), `remind_1h`(start−1h), `live`(start..start+15m), `noshow`/`attended`(start+2h) are due at `now`, honoring `webinar_emails` toggles. (Confirm is not time-based.)

- [ ] **Step 1: Failing tests** — a session starting at a fixed datetime: at `start−24h05m` → `remind_24h` NOT yet due; at `start−23h` → `remind_24h` due; at `start+3h` → `noshow`/`attended` due; a toggled-off stage never returned.
- [ ] **Step 2: Run → RED.**
- [ ] **Step 3: Implement** the pure helpers (IST = UTC+5:30; compute start, compare windows). No DB.
- [ ] **Step 4: Run → GREEN.**
- [ ] **Step 5: Commit.** Message: `feat(webinar): pure due-time stage computation`.

---

## Task W6: `webinar_lifecycle_loop` scheduler job

**Files:**
- Modify: `backend/scheduler.py` (add `webinar_lifecycle_loop()` + register `asyncio.create_task(webinar_lifecycle_loop())` in the start function alongside the others)
- Test: `backend/tests/test_webinar_loop.py`

**Interfaces:**
- Consumes: `webinar_lifecycle.due_time_stages`, `training_routes._enqueue_webinar_stage`, `session_registrations`.
- Produces: `async def process_webinar_lifecycle(now=None)` (the loop body, `now`-injectable for tests) — for each published session with a `meeting_link`, compute due stages; for `remind_24h/remind_1h/live` enqueue to all `status=="registered"` registrations missing that stage; for `noshow`/`attended` enqueue only to registrations whose `status` is `no_show`/`attended` respectively (set by W7 reconciliation). Idempotent via `sent_stages`. `webinar_lifecycle_loop()` = `while True: try process_webinar_lifecycle(); except; await asyncio.sleep(600)`.

- [ ] **Step 1: Failing test** — insert a published session starting ~23h from a fixed `now` + 2 registrations; call `await process_webinar_lifecycle(now=fixed)`; assert 2 `email_scheduled` `type:"webinar"` rows for `remind_24h` and each registration's `sent_stages` contains `remind_24h`; call again → NO new rows (idempotent).
- [ ] **Step 2: Run → RED.**
- [ ] **Step 3: Implement** `process_webinar_lifecycle` + loop; register the task in the start function (the block with the other `asyncio.create_task(...)` calls).
- [ ] **Step 4: Run → GREEN.**
- [ ] **Step 5: Commit.** Message: `feat(webinar): lifecycle scheduler loop (reminders/live, idempotent)`.

---

## Task W7: Attendance reconciliation → no-show/attended

**Files:**
- Modify: `backend/routes/training_routes.py` (`POST /training/sessions/{id}/reconcile-attendance`)
- Modify: `backend/routes/crm_zoom_routes.py` (accept optional `session_id` in `/import` and call the reconcile helper)
- Test: `backend/tests/test_webinar_attendance.py`

**Interfaces:**
- Produces: `async def _reconcile_attendance(session_id, attendee_emails: list[str]) -> dict` — for each `session_registrations` row of that session: if its email (lowercased) is in `attendee_emails` → `status="attended"`; else → `status="no_show"`. Returns `{attended, no_show}`. Exposed as `POST /training/sessions/{id}/reconcile-attendance` body `{attendee_emails: []}` (admin-run or fed by the Zoom import). `/crm-zoom/import` gains an optional `session_id`; when present it collects imported attendee emails and calls `_reconcile_attendance`.

- [ ] **Step 1: Failing test** — 2 registrations (a@ / b@); `POST /reconcile-attendance {attendee_emails:["a@x.com"]}` → a@ `status:"attended"`, b@ `status:"no_show"`; response `{attended:1,no_show:1}`.
- [ ] **Step 2: Run → RED.**
- [ ] **Step 3: Implement** `_reconcile_attendance` + endpoint; wire the optional `session_id` branch into `/crm-zoom/import` (non-breaking — absent `session_id` = unchanged behavior).
- [ ] **Step 4: Run → GREEN.**
- [ ] **Step 5: Commit.** Message: `feat(webinar): attendance reconciliation (attended/no_show) + zoom-import hook`.

---

## Task W8: `session_id` audience filter

**Files:**
- Modify: `backend/routes/email_routes.py` (`_resolve_audience`)
- Test: `backend/tests/test_webinar_audience.py`

**Interfaces:**
- Produces: `_resolve_audience` supports `audience_filter={"session_id": X, "session_status": "attended"|"no_show"|"registered"|None}` → returns contacts/pseudo-contacts derived from `session_registrations` of that session (optionally filtered by status), shaped like the other audience results (`{email, name/first_name, company}`), so the composer/campaign send path can target them.

- [ ] **Step 1: Failing test** — seed a session + 2 registrations (1 attended); `_resolve_audience({"session_id":sid,"session_status":"attended"})` returns exactly the attended one with its email.
- [ ] **Step 2: Run → RED.**
- [ ] **Step 3: Implement** the `session_id` branch at the top of `_resolve_audience` (before the generic contact query).
- [ ] **Step 4: Run → GREEN.**
- [ ] **Step 5: Commit.** Message: `feat(webinar): session_id/status audience filter for targeted sends`.

---

## Task W9: Session dialog — host + recording + per-stage toggles

**Files:**
- Modify: `frontend/src/hooks/useCustomerEngagement.js` (session form state)
- Modify: `frontend/src/pages/admin/CustomerEngagement.js` (session dialog fields)

**Interfaces:**
- Produces: the New/Edit Session dialog gains `host_name`, `recording_url` inputs and a "Automated emails" block of checkboxes bound to `sessForm.webinar_emails[stage]` for the 6 stages; these persist through the existing `saveSess` (already sends the whole form).

- [ ] **Step 1:** Add `host_name:'', recording_url:'', webinar_emails:{confirm:true,remind_24h:true,remind_1h:true,live:true,noshow:true,attended:true}` to the session form initializer in `useCustomerEngagement.js` (and the edit-prefill from `s`).
- [ ] **Step 2:** In the session dialog (`CustomerEngagement.js`), add the two inputs + a labelled checkbox group (one checkbox per stage, human labels: "Registration confirmation", "Reminder — 1 day before", "Reminder — 1 hour before", "Live now", "No-show follow-up", "Attended follow-up") toggling `webinar_emails`.
- [ ] **Step 3:** Build: `cd frontend && NODE_OPTIONS=--max-old-space-size=4096 DISABLE_ESLINT_PLUGIN=true npm run build 2>&1 | tail -15` → Compiled.
- [ ] **Step 4:** Commit (both files). Message: `feat(webinar): session dialog host/recording + per-stage email toggles`.

---

## Task W10: Registrations view — attendance + reconcile

**Files:**
- Modify: `frontend/src/hooks/useCustomerEngagement.js` (reconcile action)
- Modify: `frontend/src/pages/admin/CustomerEngagement.js` (registrations dialog)

**Interfaces:**
- Produces: the existing "Registrations" dialog shows each registrant's `status` (registered/attended/no_show) as a colored badge, and a "Reconcile attendance" button that POSTs to `/training/sessions/{id}/reconcile-attendance` (using the Zoom attendee list if available, else a prompt) and refreshes.

- [ ] **Step 1:** Add `reconcileAttendance(session_id, emails)` to the hook (calls the endpoint, toasts `{attended} attended / {no_show} no-show`, reloads regs).
- [ ] **Step 2:** In the registrations dialog, render a status badge per row and a "Reconcile attendance" button (for v1, a simple flow: the button calls the endpoint with the emails already imported via Zoom, or opens a small textarea to paste attendee emails). Keep it minimal.
- [ ] **Step 3:** Build → Compiled.
- [ ] **Step 4:** Commit. Message: `feat(webinar): registrations attendance badges + reconcile action`.

---

## Self-Review Notes (author)
- **Spec coverage (§5):** stages 2–7 (W3 confirm, W6 reminders/live, W7 no-show/attended split), `.ics` reuse (W1), dynamic scheduler (W5/W6), attendance truth via zoom-import (W7), `session_id` audience (W8), session config UI (W9/W10). Stage 1 invite = v1 composer (already shipped). Deliverability caps/List-Unsubscribe already in v1 `_smtp_send`.
- **Idempotency:** `sent_stages` per registration guards every time-based enqueue (W3/W6); tested in W6.
- **Type consistency:** stage keys `confirm/remind_24h/remind_1h/live/noshow/attended` identical across W2 (`webinar_emails`), W4 (`STAGE_HTML`), W5 (`due_time_stages`), W6 (loop), W9 (toggles). `_enqueue_webinar_stage(session, reg, stage)` signature identical in W3 and W6. `email_scheduled` row shape matches the v1 `process_email_queue` consumer (`email, subject, message, body_html, status:"pending", type, campaign_id`).
- **YAGNI:** WhatsApp arm of stages 4/5 deferred (spec notes "+WA later"); no open/click tracking; reconcile UI is a minimal paste/import trigger, not an auto-poll.
