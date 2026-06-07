# SP3 ICS Invites + Subscribe Feed — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an event creator deliberately email standards-compliant iCalendar invites (REQUEST/CANCEL, SEQUENCE) to collaborators, and let any user subscribe their calendar app to a private feed URL — all SEND-SAFE (manual trigger + env-var dry-run/test-redirect guards).

**Architecture:** Extend `backend/routes/delegation_routes.py`. Refactor the existing `event_ics` into a shared `_build_vevent`/`_wrap_vcalendar` pair reused by the per-event `.ics` (PUBLISH), a new manual invite endpoint (REQUEST/CANCEL via Gmail SMTP), and a public token-gated subscribe feed (PUBLISH, many VEVENTs). UID/SEQUENCE persist in the reserved `cal_events.ext_sync`; the feed token persists on the `del_employees` doc. Frontend adds a "Send invites/update" button (confirm-before-send), a cancel-notify checkbox, and a subscribe-link row.

**Tech Stack:** FastAPI, MongoDB (motor), Python `smtplib`/`email.mime`, `secrets`; React (CRA), existing `useDelegationCalendar` hook + `api.js`.

---

## SEND-SAFE testing protocol (applies to every backend test task)

Backend tests are **live-server integration tests** in `backend/tests/` (gitignored, self-cleaning, `EvtTest` prefix). They run against an **isolated test DB** with the dry-run guard ON so **no real email is ever sent**:

```bash
# Terminal 1 — start the isolated test server (orchestrator runs this, NOT subagents)
cd backend && DB_NAME=smartshape_test CALENDAR_INVITE_DRY_RUN=1 \
  python -m uvicorn main:app --host 127.0.0.1 --port 8000 --log-level warning

# Terminal 2 — run the tests
cd backend && REACT_APP_BACKEND_URL=http://127.0.0.1:8000 python -m pytest tests/test_sp3_invites.py -v
```

Login `info@smartshape.in` / `admin123`; grab the `access_token` cookie, send it as a `Bearer` header (the cookie is httponly+Secure, won't resend over http). **STOP the server right after.** Uvicorn has no reliable `--reload` here → after editing routes, **restart the server before running tests**. Subagents WRITE + COMPILE (`python -m py_compile`) + COMMIT; the **orchestrator restarts the server and runs pytest**.

---

## File Structure

- **Modify** `backend/routes/delegation_routes.py`:
  - Refactor `event_ics` (lines ~1543-1581) → `_build_vevent` + `_wrap_vcalendar` + thin `event_ics`.
  - Add `_email_settings`, `_send_invite`, invite endpoint, feed endpoints, feed token helper.
  - Extend `_agenda_events` meta with `invited`/`sequence`.
  - Add `import secrets` to the import block.
- **Create** `backend/tests/test_sp3_invites.py` (gitignored test file).
- **Modify** `frontend/src/lib/api.js` — `delegation.events.invite`, `delegation.calendarFeed`, `delegation.rotateCalendarFeed`.
- **Modify** `frontend/src/hooks/useDelegationCalendar.js` — `sendInvites`, `getFeedLink`, `rotateFeedLink`, feed state.
- **Modify** `frontend/src/components/delegation/calendar/EventActionDrawer.js` — Send invites/update button + confirm.
- **Modify** the cancel flow (EventActionDrawer or its dialog) — "Notify collaborators" checkbox.
- **Modify** `frontend/src/components/delegation/calendar/DelegationCalendar.js` (header overflow) — subscribe-link row.

---

## Phase 1 — Shared ICS builder refactor (behavior-preserving)

### Task 1: Extract `_build_vevent` / `_wrap_vcalendar`, rewire `event_ics`

**Files:**
- Modify: `backend/routes/delegation_routes.py` (lines ~1532-1581)
- Test: `backend/tests/test_sp3_invites.py`

- [ ] **Step 1: Write the failing characterization test** (proves the per-event `.ics` is unchanged after refactor)

```python
# backend/tests/test_sp3_invites.py
import os, requests, pytest

BASE = os.environ.get("REACT_APP_BACKEND_URL", "http://127.0.0.1:8000")
PFX = "EvtTest"

def _login():
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/login",
               json={"email": "info@smartshape.in", "password": "admin123"})
    r.raise_for_status()
    tok = s.cookies.get("access_token")
    return s, {"Authorization": f"Bearer {tok}"}

def _mk_event(s, h, **over):
    body = {"title": f"{PFX} kickoff", "date": "2026-06-10",
            "start_time": "11:00", "end_time": "11:30",
            "collaborator_emails": [f"{PFX.lower()}.client@example.com"]}
    body.update(over)
    r = s.post(f"{BASE}/api/delegation/events", json=body, headers=h)
    r.raise_for_status()
    return r.json()

@pytest.fixture
def sess():
    s, h = _login()
    yield s, h
    # cleanup: cancel every EvtTest event we created
    r = s.get(f"{BASE}/api/delegation/agenda", headers=h,
              params={"from": "2026-06-01", "to": "2026-06-30"})
    for ev in (r.json().get("items", []) if r.ok else []):
        if ev.get("type") == "event" and str(ev.get("title", "")).startswith(PFX):
            s.delete(f"{BASE}/api/delegation/events/{ev['entity_id']}", headers=h)

def test_event_ics_still_publish(sess):
    s, h = sess
    ev = _mk_event(s, h)
    r = s.get(f"{BASE}/api/delegation/events/{ev['event_id']}.ics", headers=h)
    assert r.status_code == 200
    body = r.text
    assert "METHOD:PUBLISH" in body
    assert f"UID:{ev['event_id']}@smartshape.in" in body
    assert "SUMMARY:EvtTest kickoff" in body
```

- [ ] **Step 2: Run to verify it passes against the CURRENT code** (baseline — confirms the test reflects today's behavior before refactor)

Run: `cd backend && REACT_APP_BACKEND_URL=http://127.0.0.1:8000 python -m pytest tests/test_sp3_invites.py::test_event_ics_still_publish -v`
Expected: PASS (current `event_ics` already emits `METHOD:PUBLISH`).

- [ ] **Step 3: Refactor — replace the body of `event_ics` (lines ~1543-1581) with the shared builders**

```python
def _ev_uid(ev):
    return (ev.get("ext_sync") or {}).get("ics_uid") or f"{ev['event_id']}@smartshape.in"

def _build_vevent(ev, *, method, sequence):
    """VEVENT lines for an event under the given iCalendar METHOD."""
    dtstart, is_date = _ics_dt(ev["date"], ev.get("start_time"))
    dtend, _ = _ics_dt(ev["date"], ev.get("end_time") or ev.get("start_time"))
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    lines = ["BEGIN:VEVENT", f"UID:{_ev_uid(ev)}", f"DTSTAMP:{stamp}",
             f"SEQUENCE:{int(sequence)}"]
    if is_date:
        lines += [f"DTSTART;VALUE=DATE:{dtstart}", f"DTEND;VALUE=DATE:{dtstart}"]
    else:
        lines += [f"DTSTART;TZID=Asia/Kolkata:{dtstart}",
                  f"DTEND;TZID=Asia/Kolkata:{dtend}"]
    lines.append(f"SUMMARY:{_ics_escape(ev.get('title'))}")
    if ev.get("description"):
        lines.append(f"DESCRIPTION:{_ics_escape(ev['description'])}")
    if ev.get("location"):
        lines.append(f"LOCATION:{_ics_escape(ev['location'])}")
    # ORGANIZER = the configured sender mailbox; CN = creator name (see spec §0)
    org_email = (_ORG_EMAIL_CACHE.get("email") or ev.get("created_by") or "")
    if org_email:
        cn = _ics_escape(ev.get("created_by") or org_email)
        lines.append(f"ORGANIZER;CN={cn}:mailto:{org_email}")
    for c in ev.get("collaborators", []):
        if c.get("email"):
            cn = _ics_escape(c.get("name") or c["email"])
            if method == "REQUEST":
                lines.append(
                    f"ATTENDEE;CN={cn};ROLE=REQ-PARTICIPANT;"
                    f"PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:{c['email']}")
            else:
                lines.append(f"ATTENDEE;CN={cn}:mailto:{c['email']}")
    lines.append("STATUS:CANCELLED" if method == "CANCEL" else "STATUS:CONFIRMED")
    lines.append("END:VEVENT")
    return lines

def _wrap_vcalendar(method, vevent_blocks):
    out = ["BEGIN:VCALENDAR", "VERSION:2.0",
           "PRODID:-//SmartShape Pro//Calendar//EN", "CALSCALE:GREGORIAN",
           f"METHOD:{method}"]
    for block in vevent_blocks:
        out += block
    out.append("END:VCALENDAR")
    return "\r\n".join(out) + "\r\n"

# Module-level cache so _build_vevent can name the real sender as ORGANIZER without
# an await; refreshed by _email_settings(). Falls back to created_by when empty.
_ORG_EMAIL_CACHE = {"email": ""}

@router.get("/events/{event_id}.ics")
async def event_ics(event_id: str, request: Request):
    """Single-event iCalendar file — 'Add to calendar' for Google/Apple/Outlook."""
    user = await get_current_user(request)
    actor = await _resolve_actor(user)
    ev = await db.cal_events.find_one({"event_id": event_id}, {"_id": 0})
    if not ev:
        raise HTTPException(404, "Event not found")
    email = (user.get("email") or "").lower()
    allowed = ev.get("created_by") == user.get("email") or any(
        (c.get("emp_id") and c["emp_id"] == actor["emp_id"]) or c.get("email", "").lower() == email
        for c in ev.get("collaborators", []))
    if not allowed:
        raise HTTPException(403, "Not your event")
    await _email_settings()  # warms _ORG_EMAIL_CACHE; ignore result here
    body = _wrap_vcalendar("PUBLISH", [_build_vevent(ev, method="PUBLISH", sequence=0)])
    return Response(content=body, media_type="text/calendar",
                    headers={"Content-Disposition": f'attachment; filename="event-{ev["event_id"]}.ics"'})
```

> Note: `event_ics` previously omitted `SEQUENCE`. Adding `SEQUENCE:0` is harmless for PUBLISH (the characterization test asserts METHOD/UID/SUMMARY, not the absence of SEQUENCE). Keep `_ics_escape` and `_ics_dt` exactly as they are.

- [ ] **Step 4: Add `_email_settings` (used here and by the sender)** — place above `event_ics`

```python
async def _email_settings():
    """Return enabled email settings dict, or None. Warms the ORGANIZER cache."""
    s = await db.settings.find_one({"type": "email"}, {"_id": 0})
    if s and s.get("sender_email"):
        _ORG_EMAIL_CACHE["email"] = s.get("sender_email")
    if not s or not s.get("enabled") or not s.get("sender_email") or not s.get("gmail_app_password"):
        return None
    return s
```

- [ ] **Step 5: Compile**

Run: `cd backend && python -m py_compile routes/delegation_routes.py`
Expected: no output (success).

- [ ] **Step 6: ORCHESTRATOR restarts the test server, then run the characterization test**

Run: `cd backend && REACT_APP_BACKEND_URL=http://127.0.0.1:8000 python -m pytest tests/test_sp3_invites.py::test_event_ics_still_publish -v`
Expected: PASS (METHOD:PUBLISH + UID + SUMMARY unchanged).

- [ ] **Step 7: Commit**

```bash
git add backend/routes/delegation_routes.py
git commit -m "refactor(calendar): extract shared ICS builder from event_ics (SP3)"
```

---

## Phase 2 — Invite endpoint + sender

### Task 2: `_send_invite` helper + `POST /events/{id}/invite`

**Files:**
- Modify: `backend/routes/delegation_routes.py` (add after `event_ics`)
- Test: `backend/tests/test_sp3_invites.py`

- [ ] **Step 1: Write the failing tests** (append to the test file)

```python
def test_first_invite_request_seq0(sess):
    s, h = sess
    ev = _mk_event(s, h, collaborator_emails=[f"{PFX.lower()}.a@example.com",
                                              f"{PFX.lower()}.b@example.com"])
    r = s.post(f"{BASE}/api/delegation/events/{ev['event_id']}/invite",
               json={"kind": "request"}, headers=h)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["dry_run"] is True          # server runs with CALENDAR_INVITE_DRY_RUN=1
    assert d["sequence"] == 0
    assert d["method"] == "REQUEST"
    # creator excluded; both external emails present
    assert set(d["sent"]) == {f"{PFX.lower()}.a@example.com", f"{PFX.lower()}.b@example.com"}
    assert "METHOD:REQUEST" in d["ics_preview"]
    assert "RSVP=TRUE" in d["ics_preview"]

def test_second_invite_bumps_sequence_same_uid(sess):
    s, h = sess
    ev = _mk_event(s, h)
    s.post(f"{BASE}/api/delegation/events/{ev['event_id']}/invite",
           json={"kind": "request"}, headers=h)
    r = s.post(f"{BASE}/api/delegation/events/{ev['event_id']}/invite",
               json={"kind": "request"}, headers=h)
    d = r.json()
    assert d["sequence"] == 1
    assert f"UID:{ev['event_id']}@smartshape.in" in d["ics_preview"]

def test_cancel_invite_method_cancel(sess):
    s, h = sess
    ev = _mk_event(s, h)
    s.post(f"{BASE}/api/delegation/events/{ev['event_id']}/invite",
           json={"kind": "request"}, headers=h)
    r = s.post(f"{BASE}/api/delegation/events/{ev['event_id']}/invite",
               json={"kind": "cancel"}, headers=h)
    d = r.json()
    assert d["method"] == "CANCEL"
    assert d["sequence"] == 1
    assert "STATUS:CANCELLED" in d["ics_preview"]

def test_invite_non_creator_403(sess):
    s, h = sess
    ev = _mk_event(s, h)
    bad = {"Authorization": "Bearer not-a-real-token"}
    r = s.post(f"{BASE}/api/delegation/events/{ev['event_id']}/invite",
               json={"kind": "request"}, headers=bad)
    assert r.status_code in (401, 403)

def test_invite_missing_event_404(sess):
    s, h = sess
    r = s.post(f"{BASE}/api/delegation/events/evt_doesnotexist/invite",
               json={"kind": "request"}, headers=h)
    assert r.status_code == 404
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && REACT_APP_BACKEND_URL=http://127.0.0.1:8000 python -m pytest tests/test_sp3_invites.py -k "invite or cancel_invite" -v`
Expected: FAIL (404 — endpoint not defined yet).

- [ ] **Step 3: Add `import secrets` to the import block** (line ~9)

```python
import uuid, os, mimetypes, secrets
```

- [ ] **Step 4: Implement `_send_invite` + the endpoint** (add after `event_ics`)

```python
async def _send_invite(ev, *, method, sequence, recipients):
    """Build + send the iCalendar invite. Honors DRY_RUN / TEST_TO guards.
    Returns {dry_run, sent, ics}."""
    ics = _wrap_vcalendar(method, [_build_vevent(ev, method=method, sequence=sequence)])
    creator = ev.get("created_by") or ""
    verb = "Cancelled" if method == "CANCEL" else "Invitation"
    subject = f"{verb}: {ev.get('title') or 'Event'} — {ev.get('date')}"
    when = ev.get("date") + ((" " + ev["start_time"]) if ev.get("start_time") else "")
    plain = (f"{creator} has "
             + ("cancelled" if method == "CANCEL" else "invited you to")
             + f" the event \"{ev.get('title')}\".\n\n"
             f"When: {when}\nWhere: {ev.get('location') or '-'}\n\n"
             f"{ev.get('description') or ''}\n\n"
             "Your calendar app should offer to add/update this automatically.")

    test_to = os.environ.get("CALENDAR_INVITE_TEST_TO", "").strip()
    if test_to:
        recipients = [test_to]
        subject = "[TEST] " + subject

    if os.environ.get("CALENDAR_INVITE_DRY_RUN", "").strip() in ("1", "true", "True"):
        return {"dry_run": True, "sent": recipients, "ics": ics}

    settings = await _email_settings()
    if not settings:
        raise HTTPException(400, "Email not configured")
    import smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart
    from email.mime.base import MIMEBase
    from email import encoders
    sender_email = settings["sender_email"]
    sender_name = settings.get("sender_name", "SmartShape Pro")
    msg = MIMEMultipart("mixed")
    msg["From"] = f"{sender_name} <{sender_email}>"
    msg["To"] = ", ".join(recipients)
    msg["Subject"] = subject
    alt = MIMEMultipart("alternative")
    alt.attach(MIMEText(plain, "plain", "utf-8"))
    cal = MIMEText(ics, "calendar", "utf-8")
    cal.replace_header("Content-Type", f'text/calendar; method={method}; charset="UTF-8"')
    alt.attach(cal)
    msg.attach(alt)
    att = MIMEBase("application", "ics")
    att.set_payload(ics.encode("utf-8"))
    encoders.encode_base64(att)
    att.add_header("Content-Disposition", 'attachment; filename="invite.ics"')
    msg.attach(att)
    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as smtp:
        smtp.login(sender_email, settings["gmail_app_password"])
        smtp.sendmail(sender_email, recipients, msg.as_string())
    return {"dry_run": False, "sent": recipients, "ics": ics}


@router.post("/events/{event_id}/invite")
async def invite_event(event_id: str, request: Request):
    user = await get_current_user(request)
    ev = await db.cal_events.find_one({"event_id": event_id}, {"_id": 0})
    if not ev:
        raise HTTPException(404, "Event not found")
    if ev["created_by"] != user.get("email"):
        raise HTTPException(403, "Only the creator can send invites")
    await _email_settings()  # warm ORGANIZER cache
    body = await request.json()
    kind = body.get("kind", "request")
    if kind not in ("request", "cancel"):
        raise HTTPException(400, "kind must be 'request' or 'cancel'")
    ext = ev.get("ext_sync") or {}
    prev_seq = ext.get("sequence")
    if kind == "request":
        method = "REQUEST"
        sequence = 0 if prev_seq is None else int(prev_seq) + 1
    else:
        method = "CANCEL"
        sequence = (int(prev_seq) + 1) if prev_seq is not None else 1
    creator_email = (ev.get("created_by") or "").lower()
    recipients, skipped = [], []
    for c in ev.get("collaborators", []):
        em = (c.get("email") or "").strip()
        if not em:
            skipped.append(c.get("name") or "(no email)")
        elif em.lower() != creator_email:
            recipients.append(em)
    result = await _send_invite(ev, method=method, sequence=sequence, recipients=recipients)
    await db.cal_events.update_one({"event_id": event_id}, {"$set": {"ext_sync": {
        "ics_uid": _ev_uid(ev), "sequence": sequence, "last_method": method,
        "invited_emails": recipients, "invited_at": now_iso()}, "updated_at": now_iso()}})
    out = {"kind": kind, "method": method, "sequence": sequence,
           "sent": result["sent"], "skipped": skipped, "dry_run": result["dry_run"]}
    if result["dry_run"]:
        out["ics_preview"] = result["ics"]  # only exposed under DRY_RUN
    return out
```

- [ ] **Step 5: Compile**

Run: `cd backend && python -m py_compile routes/delegation_routes.py`
Expected: no output.

- [ ] **Step 6: ORCHESTRATOR restarts the server, run the invite tests**

Run: `cd backend && REACT_APP_BACKEND_URL=http://127.0.0.1:8000 python -m pytest tests/test_sp3_invites.py -k "invite or cancel_invite or sequence" -v`
Expected: PASS (all 5 invite tests).

- [ ] **Step 7: Commit**

```bash
git add backend/routes/delegation_routes.py
git commit -m "feat(calendar): manual ICS invite endpoint (REQUEST/CANCEL, SEQUENCE, send-safe) — SP3"
```

### Task 3: Email-disabled returns 400 (non-DRY_RUN path)

**Files:**
- Test: `backend/tests/test_sp3_invites.py`

- [ ] **Step 1: Write the failing test** (separate file so it runs the server WITHOUT DRY_RUN)

```python
# This test must run against a server started WITHOUT CALENDAR_INVITE_DRY_RUN.
# Marked so the default DRY_RUN suite skips it.
@pytest.mark.no_dry_run
def test_invite_email_disabled_400(sess):
    s, h = sess
    ev = _mk_event(s, h)
    # ensure email setting is disabled in the test DB
    # (admin endpoint POST /api/settings/email with enabled:false)
    s.post(f"{BASE}/api/settings/email",
           json={"sender_name": "T", "sender_email": "", "gmail_app_password": "", "enabled": False},
           headers=h)
    r = s.post(f"{BASE}/api/delegation/events/{ev['event_id']}/invite",
               json={"kind": "request"}, headers=h)
    assert r.status_code == 400
```

- [ ] **Step 2: Register the marker** — create `backend/tests/conftest.py` if absent

```python
def pytest_configure(config):
    config.addinivalue_line("markers", "no_dry_run: run only with the server started without DRY_RUN")
```

- [ ] **Step 3: No code change needed** — `_send_invite` already raises 400 when `_email_settings()` is None and DRY_RUN is off. This task is verification-only.

- [ ] **Step 4: ORCHESTRATOR runs this one against a NON-dry-run server**

```bash
# stop the DRY_RUN server first, then:
cd backend && DB_NAME=smartshape_test python -m uvicorn main:app --host 127.0.0.1 --port 8000 --log-level warning
# Terminal 2:
cd backend && REACT_APP_BACKEND_URL=http://127.0.0.1:8000 python -m pytest tests/test_sp3_invites.py -m no_dry_run -v
# then STOP this server and restart WITH DRY_RUN for the rest.
```
Expected: PASS (400). No email is sent because settings are disabled.

- [ ] **Step 5: Commit**

```bash
git add backend/tests/conftest.py
git commit -m "test(calendar): email-disabled invite returns 400 (SP3)"
```

---

## Phase 3 — Subscribe feed

### Task 4: feed token endpoints + public `calendar.ics`

**Files:**
- Modify: `backend/routes/delegation_routes.py` (add after `invite_event`)
- Test: `backend/tests/test_sp3_invites.py`

- [ ] **Step 1: Write the failing tests**

```python
def test_feed_link_and_public_feed(sess):
    s, h = sess
    ev = _mk_event(s, h)
    r = s.get(f"{BASE}/api/delegation/calendar-feed", headers=h)
    assert r.status_code == 200, r.text
    link = r.json()
    assert "token=" in link["url"]
    assert link["webcal_url"].startswith("webcal://")
    # public feed — NO auth header
    pub = requests.get(link["url"].replace("https://app.smartshape.in", BASE))
    assert pub.status_code == 200
    assert "BEGIN:VCALENDAR" in pub.text
    assert "EvtTest kickoff" in pub.text

def test_public_feed_excludes_cancelled(sess):
    s, h = sess
    ev = _mk_event(s, h, title=f"{PFX} to-cancel")
    s.delete(f"{BASE}/api/delegation/events/{ev['event_id']}", headers=h)  # soft cancel
    link = s.get(f"{BASE}/api/delegation/calendar-feed", headers=h).json()
    pub = requests.get(link["url"].replace("https://app.smartshape.in", BASE))
    assert "EvtTest to-cancel" not in pub.text

def test_feed_bad_token_404():
    pub = requests.get(f"{BASE}/api/delegation/calendar.ics", params={"token": "nope"})
    assert pub.status_code == 404

def test_feed_rotate_invalidates_old(sess):
    s, h = sess
    old = s.get(f"{BASE}/api/delegation/calendar-feed", headers=h).json()["url"]
    s.post(f"{BASE}/api/delegation/calendar-feed/rotate", headers=h)
    pub = requests.get(old.replace("https://app.smartshape.in", BASE))
    assert pub.status_code == 404
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && REACT_APP_BACKEND_URL=http://127.0.0.1:8000 python -m pytest tests/test_sp3_invites.py -k feed -v`
Expected: FAIL (404 — endpoints not defined).

- [ ] **Step 3: Implement the feed** (add after `invite_event`)

```python
def _base_url():
    return (os.environ.get("PUBLIC_BASE_URL") or os.environ.get("FRONTEND_URL")
            or "https://app.smartshape.in").rstrip("/")

async def _feed_token_for(actor, *, rotate=False):
    emp = await db.del_employees.find_one({"emp_id": actor["emp_id"]},
                                          {"_id": 0, "calendar_feed_token": 1})
    tok = (emp or {}).get("calendar_feed_token")
    if rotate or not tok:
        tok = secrets.token_urlsafe(32)
        await db.del_employees.update_one({"emp_id": actor["emp_id"]},
                                          {"$set": {"calendar_feed_token": tok}})
    return tok

def _feed_links(tok):
    url = f"{_base_url()}/api/delegation/calendar.ics?token={tok}"
    webcal = url.split("://", 1)[1] if "://" in url else url
    return {"url": url, "webcal_url": "webcal://" + webcal}

@router.get("/calendar-feed")
async def calendar_feed_link(request: Request):
    user = await get_current_user(request)
    actor = await _resolve_actor(user)
    tok = await _feed_token_for(actor)
    return _feed_links(tok)

@router.post("/calendar-feed/rotate")
async def calendar_feed_rotate(request: Request):
    user = await get_current_user(request)
    actor = await _resolve_actor(user)
    tok = await _feed_token_for(actor, rotate=True)
    return _feed_links(tok)

@router.get("/calendar.ics")
async def calendar_feed_public(token: str = ""):
    """Public, token-gated subscribe feed (covers Apple). No auth."""
    if not token:
        raise HTTPException(404, "Not found")
    emp = await db.del_employees.find_one({"calendar_feed_token": token},
                                          {"_id": 0, "emp_id": 1, "email": 1})
    if not emp:
        raise HTTPException(404, "Not found")
    await _email_settings()  # warm ORGANIZER cache
    today = date.today()
    dfrom = (today - timedelta(days=90)).isoformat()
    dto = (today + timedelta(days=365)).isoformat()
    q = {"status": "active", "date": {"$gte": dfrom, "$lte": dto},
         "$or": [{"created_by_emp_id": emp["emp_id"]},
                 {"collaborators.emp_id": emp["emp_id"]},
                 {"collaborators.email": emp.get("email")}]}
    rows = await db.cal_events.find(q, {"_id": 0}).to_list(2000)
    blocks = [_build_vevent(r, method="PUBLISH", sequence=int((r.get("ext_sync") or {}).get("sequence", 0)))
              for r in rows]
    body = _wrap_vcalendar("PUBLISH", blocks)
    return Response(content=body, media_type="text/calendar; charset=utf-8",
                    headers={"Cache-Control": "max-age=3600",
                             "Content-Disposition": 'inline; filename="smartshape.ics"'})
```

- [ ] **Step 4: Compile**

Run: `cd backend && python -m py_compile routes/delegation_routes.py`
Expected: no output.

- [ ] **Step 5: ORCHESTRATOR restarts the server, run the feed tests**

Run: `cd backend && REACT_APP_BACKEND_URL=http://127.0.0.1:8000 python -m pytest tests/test_sp3_invites.py -k feed -v`
Expected: PASS (4 feed tests).

- [ ] **Step 6: Commit**

```bash
git add backend/routes/delegation_routes.py
git commit -m "feat(calendar): tokenized subscribe feed + rotate (Apple coverage) — SP3"
```

### Task 5: agenda meta exposes `invited`/`sequence`

**Files:**
- Modify: `backend/routes/delegation_routes.py` `_agenda_events` (lines ~1584-1605)
- Test: `backend/tests/test_sp3_invites.py`

- [ ] **Step 1: Write the failing test**

```python
def test_agenda_meta_invited_flag(sess):
    s, h = sess
    ev = _mk_event(s, h, title=f"{PFX} meta")
    s.post(f"{BASE}/api/delegation/events/{ev['event_id']}/invite",
           json={"kind": "request"}, headers=h)
    r = s.get(f"{BASE}/api/delegation/agenda", headers=h,
              params={"from": "2026-06-01", "to": "2026-06-30"})
    item = next(i for i in r.json()["items"]
                if i.get("entity_id") == ev["event_id"])
    assert item["meta"]["invited"] is True
    assert item["meta"]["sequence"] == 0
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && REACT_APP_BACKEND_URL=http://127.0.0.1:8000 python -m pytest tests/test_sp3_invites.py::test_agenda_meta_invited_flag -v`
Expected: FAIL (KeyError 'invited').

- [ ] **Step 3: Add the two meta keys** — in `_agenda_events`, extend the `meta={...}` dict in the `_ev(...)` call

```python
        ext = r.get("ext_sync") or {}
        out.append(_ev(
            "event", "event", r.get("title"), r["date"], r["event_id"], "/delegation",
            start_time=(r.get("start_time") or None), end_time=(r.get("end_time") or None),
            status=r.get("status"), actions=acts,
            meta={"created_by_name": r.get("created_by", ""), "is_creator": is_creator,
                  "my_response": my_resp, "location": r.get("location", ""),
                  "description": r.get("description", ""),
                  "invited": ext.get("sequence") is not None,
                  "sequence": ext.get("sequence"),
                  "collaborators": [c.get("name") or c.get("email") for c in r.get("collaborators", [])]}))
```

- [ ] **Step 4: Compile + ORCHESTRATOR restart + run**

Run: `cd backend && python -m py_compile routes/delegation_routes.py` then restart, then
`REACT_APP_BACKEND_URL=http://127.0.0.1:8000 python -m pytest tests/test_sp3_invites.py::test_agenda_meta_invited_flag -v`
Expected: PASS.

- [ ] **Step 5: Run the FULL backend suite (DRY_RUN server) to confirm no regressions**

Run: `cd backend && REACT_APP_BACKEND_URL=http://127.0.0.1:8000 python -m pytest tests/test_sp3_invites.py -v -m "not no_dry_run"`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/routes/delegation_routes.py
git commit -m "feat(calendar): agenda meta exposes invited/sequence for drawer (SP3)"
```

---

## Phase 4 — Frontend

### Task 6: API client + hook actions

**Files:**
- Modify: `frontend/src/lib/api.js`
- Modify: `frontend/src/hooks/useDelegationCalendar.js`

- [ ] **Step 1: Add to `api.js` under `delegation.events`** (match the existing `create/update/delete/respond` style; find the `delegation` object)

```js
// inside delegation.events:
invite: (id, kind = "request") =>
  http.post(`/delegation/events/${id}/invite`, { kind }),
// inside delegation (sibling of events):
calendarFeed: () => http.get(`/delegation/calendar-feed`),
rotateCalendarFeed: () => http.post(`/delegation/calendar-feed/rotate`, {}),
```

> Adjust `http.post/get` to whatever wrapper `api.js` already uses (e.g. `apiFetch`, `client`). Read the file's existing delegation block first and mirror it exactly.

- [ ] **Step 2: Add hook actions in `useDelegationCalendar.js`** (mirror existing `createEvent`/`respondEvent`)

```js
const sendInvites = async (id, kind = "request") => {
  const res = await api.delegation.events.invite(id, kind);
  await load();
  return res; // {sent, skipped, dry_run, sequence, ...}
};
const getFeedLink = async () => api.delegation.calendarFeed();
const rotateFeedLink = async () => api.delegation.rotateCalendarFeed();
```

Export them in the hook's return object alongside `createEvent`, `respondEvent`, etc.

- [ ] **Step 3: Verify the production build compiles**

Run: `cd frontend && DISABLE_ESLINT_PLUGIN=true npx --no-install react-scripts build`
Expected: "Compiled successfully" (warnings ok). Then `rm -rf build`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/api.js frontend/src/hooks/useDelegationCalendar.js
git commit -m "feat(calendar): frontend api+hook for invites and subscribe feed (SP3)"
```

### Task 7: Send invites button + confirm + cancel-notify

**Files:**
- Modify: `frontend/src/components/delegation/calendar/EventActionDrawer.js`

- [ ] **Step 1: In the creator branch, add the button** (label depends on `event.meta.invited`)

```jsx
{isCreator && (
  <button
    className="..."  /* match existing drawer buttons */
    onClick={async () => {
      const emails = (event.meta?.collaborators || []);
      if (!window.confirm(
        `Send ${event.meta?.invited ? "an update" : "invites"} to:\n` +
        emails.join("\n") + "\n\nProceed?")) return;
      const r = await sendInvites(event.entity_id, "request");
      const msg = r.dry_run
        ? `Dry-run: would invite ${r.sent.length}`
        : `Invited ${r.sent.length}${r.skipped.length ? ` · skipped ${r.skipped.length}` : ""}`;
      window.alert(msg);
    }}>
    {event.meta?.invited ? "Send update" : "Send invites"}
  </button>
)}
```

> `sendInvites` comes from the hook; thread it through props the same way `cancelEvent`/`respondEvent` already reach the drawer. Read the drawer's current props and follow that wiring.

- [ ] **Step 2: Cancel-notify** — where the drawer calls `cancelEvent`, gate a notify

```jsx
onClick={async () => {
  if (!window.confirm("Cancel this event?")) return;
  const notify = isCreator && event.meta?.invited &&
    window.confirm("Also notify collaborators by email that it's cancelled?");
  await cancelEvent(event.entity_id);
  if (notify) await sendInvites(event.entity_id, "cancel");
}}
```

- [ ] **Step 3: Production build compiles**

Run: `cd frontend && DISABLE_ESLINT_PLUGIN=true npx --no-install react-scripts build`
Expected: "Compiled successfully". Then `rm -rf build`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/delegation/calendar/EventActionDrawer.js
git commit -m "feat(calendar): Send invites/update button + cancel-notify in drawer (SP3)"
```

### Task 8: Subscribe-link row in the calendar header

**Files:**
- Modify: `frontend/src/components/delegation/calendar/DelegationCalendar.js`

- [ ] **Step 1: Add a small "Subscribe in your calendar app" control** (header overflow / a button that lazy-loads the link)

```jsx
const [feed, setFeed] = useState(null);
// ...
<button onClick={async () => setFeed(await getFeedLink())}>Subscribe in calendar app</button>
{feed && (
  <div className="...">
    <input readOnly value={feed.webcal_url} onFocus={e => e.target.select()} />
    <button onClick={() => navigator.clipboard.writeText(feed.webcal_url)}>Copy</button>
    <a href={feed.webcal_url}>Open</a>
    <button onClick={async () => setFeed(await rotateFeedLink())}>Rotate link</button>
  </div>
)}
```

> `getFeedLink`/`rotateFeedLink` come from the hook. Match the component's existing styling utilities.

- [ ] **Step 2: Production build compiles**

Run: `cd frontend && DISABLE_ESLINT_PLUGIN=true npx --no-install react-scripts build`
Expected: "Compiled successfully". Then `rm -rf build`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/delegation/calendar/DelegationCalendar.js
git commit -m "feat(calendar): subscribe-feed link with copy/rotate in calendar header (SP3)"
```

---

## Phase 5 — Verify + deploy

### Task 9: Full verification

- [ ] **Step 1:** Backend — DRY_RUN server up, run `pytest tests/test_sp3_invites.py -v -m "not no_dry_run"` → all green.
- [ ] **Step 2:** Backend — restart server WITHOUT DRY_RUN, run `pytest tests/test_sp3_invites.py -m no_dry_run -v` → 400 test green (no email sent). STOP the server.
- [ ] **Step 3:** Frontend — `DISABLE_ESLINT_PLUGIN=true npx --no-install react-scripts build` → Compiled successfully; `rm -rf build`.
- [ ] **Step 4 (optional, user-driven):** real one-recipient smoke — orchestrator (with user OK) starts the server with `CALENDAR_INVITE_TEST_TO=<a safe address>` (NO DRY_RUN) against the **prod** DB only if the user explicitly wants to see a real invite land; confirm the `.ics` adds to a calendar. Skip by default.

### Task 10: Deploy (manual — see CALENDAR-HANDOFF.md)

- [ ] **Step 1:** Merge `feat/sp3-ics-invites` → `main`, push. Verify `git merge-base --is-ancestor` that main contains the SP3 commits.
- [ ] **Step 2:** Capture current prod commit (rollback point).
- [ ] **Step 3:** SSH (paramiko) to the VPS, `git pull`, rebuild **backend + frontend** (`docker compose -f docker-compose.prod.yml build --no-cache backend frontend`), `up -d backend frontend`. NO `--remove-orphans`.
- [ ] **Step 4:** Set the prod env for the backend container if a real-send is desired later; by default leave invites manual and email settings as configured. (DRY_RUN/TEST_TO are NOT set in prod → real sends happen only when the creator clicks the button.)
- [ ] **Step 5:** Verify live: protected route → 401; `curl https://app.smartshape.in/` shows new `main.<hash>.js`. Ask user to hard-refresh (Ctrl+Shift+R).
- [ ] **Step 6:** Delete any temp file holding the SSH password.

---

## Self-review notes
- **Spec coverage:** builder refactor (§3.1 → T1), invite endpoint+sender+guards (§3.2/3.3 → T2/T3), feed (§3.4 → T4), agenda meta (§4.4 → T5), frontend api/hook/drawer/cancel/subscribe (§4 → T6-T8), testing (§6 → tests across tasks), deploy (§7.5 → T10). All covered.
- **Placeholder scan:** frontend tasks reference "match existing styling/wiring" — intentional, because exact class names/prop-threading must be read from the live components; the *behavior* and API calls are fully specified.
- **Type consistency:** `_build_vevent(ev, *, method, sequence)`, `_wrap_vcalendar(method, blocks)`, `_ev_uid(ev)`, `_email_settings()`, `_send_invite(...)→{dry_run,sent,ics}`, endpoint returns `{kind,method,sequence,sent,skipped,dry_run,ics_preview?}` — consistent across all tasks. `ics_preview` is the agreed DRY_RUN-only inspection field.
