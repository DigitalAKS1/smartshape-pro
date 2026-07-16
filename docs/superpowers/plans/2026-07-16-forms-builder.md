# Forms Builder + Public Event Registration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Google-Forms-style form builder in SmartShape; Event Registration forms get a public no-login page (`/f/<token>`) and bridge into the existing production webinar engine (confirm/24h/1h emails) with added WhatsApp confirmations/reminders, CRM contact upsert, collaborators, QR share, and CSV/XLSX export.

**Architecture:** New `forms` + `form_responses` collections and `backend/routes/form_routes.py`. Event forms sync a linked `training_sessions` doc so `scheduler.webinar_lifecycle_loop` + `routes.training_routes._enqueue_webinar_stage` deliver email stages unchanged; we add a WhatsApp companion per stage via the `whatsapp_scheduled` queue. Spec: `docs/superpowers/specs/2026-07-16-forms-builder-design.md`.

**Tech Stack:** FastAPI + Motor (async Mongo), pytest + pytest-asyncio + httpx ASGITransport, React 19 (CRA) + Tailwind + shadcn-style ui components + lucide-react, `qrcode.react` (new dep).

## Global Constraints

- Work in **`F:/ss-work`** on branch **`feat/forms-builder`**. NEVER touch `F:/SMARTSHAPE APP` (stale fork).
- Windows box: use `python` (never `python3`). Bash tool works; paths `/f/ss-work/...`.
- **Tests must never hit prod**: every test file starts with the DB-name guard (see Task 1); run with `DB_NAME=smartshape_test`; never import `main` (starts schedulers against prod Atlas).
- Mongo ids: app-generated strings `<prefix>_<uuid4.hex[:12]>`; all reads project `{"_id": 0}`.
- Timestamps: `datetime.now(timezone.utc).isoformat()` via module-local `_now()`.
- Session `date`/`time` are IST wall-clock strings `"YYYY-MM-DD"` / `"HH:MM"`.
- Commit source files explicitly by path — **never `git add -A`** (build/ and env files must not sneak in).
- Frontend build check: `DISABLE_ESLINT_PLUGIN=true NODE_OPTIONS=--max-old-space-size=4096 npm run build`. Do NOT commit `frontend/build/` in this branch — bundle commit happens only at deploy time with owner approval.
- Reuse, don't duplicate: email via `email_utils` + `db.email_scheduled` queue; WhatsApp via `db.whatsapp_scheduled` queue; reminders via existing `webinar_lifecycle_loop`.

**Run tests:** `cd /f/ss-work/backend && DB_NAME=smartshape_test python -m pytest tests/<file> -v` (needs local Mongo on `localhost:27017`, same as existing `test_webinar_loop.py`).

---

### Task 1: forms CRUD + event-session sync (backend)

**Files:**
- Create: `backend/routes/form_routes.py`
- Test: `backend/tests/test_forms_crud.py`

**Interfaces:**
- Consumes: `database.db`, `auth_utils.get_current_user`, `rbac.get_team`, `db.training_sessions` doc shape (`routes/training_routes.py:124-144`).
- Produces (used by Tasks 2-6): `router` (APIRouter), `_now()`, `_can_manage(user, form) -> bool`, `_get_form_or_404(form_id)`, `_clean_fields(raw) -> list`, `_sync_event_session(form, user_email) -> session_id`, `default_event_fields()`, `_default_messages()`, constants `FIELD_TYPES`, `DEFAULT_WA_CONFIRM`, `DEFAULT_WA_REMINDER`, `FORM_SESSION_EMAILS`.

- [ ] **Step 1: Write the failing test** — `backend/tests/test_forms_crud.py`:

```python
"""test_forms_crud.py — in-process tests for forms CRUD + event-session sync.
Patches routes.form_routes.db to a local test DB; never imports main."""
import os
import pytest
import pytest_asyncio
from motor.motor_asyncio import AsyncIOMotorClient
from fastapi import FastAPI
from httpx import AsyncClient, ASGITransport

_DB_NAME = os.getenv("DB_NAME", "smartshape_test")
assert _DB_NAME.endswith("_test") or _DB_NAME == "mtt_ci", f"refusing non-test DB: {_DB_NAME}"

import routes.form_routes as fr

_MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")

ADMIN = {"email": "info@smartshape.in", "role": "admin", "module_permissions": {}}
SALES = {"email": "rep@smartshape.in", "role": "sales_person", "module_permissions": {}}
OTHER = {"email": "other@smartshape.in", "role": "sales_person", "module_permissions": {}}


@pytest_asyncio.fixture
async def ctx():
    motor_client = AsyncIOMotorClient(_MONGO_URL)
    d = motor_client[_DB_NAME]
    orig_db = fr.db
    fr.db = d
    app = FastAPI()
    app.include_router(fr.router, prefix="/api")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://t") as client:
        yield d, client
    fr.db = orig_db
    for coll in ("forms", "form_responses", "training_sessions"):
        await d[coll].delete_many({})
    motor_client.close()


def _as(user):
    async def fake(request):
        return user
    return fake


@pytest.mark.asyncio
async def test_create_event_form_presets_and_session(ctx, monkeypatch):
    d, client = ctx
    monkeypatch.setattr(fr, "get_current_user", _as(SALES))
    r = await client.post("/api/forms", json={
        "title": "Teacher Session #05", "type": "event",
        "event": {"theme": "Patriotism Through Creativity", "date": "2026-07-18",
                  "time": "13:00", "platform": "zoom",
                  "meeting_link": "https://zoom.us/j/999"}})
    assert r.status_code == 200, r.text
    form = r.json()
    assert form["form_id"].startswith("form_")
    assert len(form["public_token"]) >= 32
    assert form["status"] == "open"
    assert [f["map_to"] for f in form["fields"]] == \
        ["name", "email", "school", "designation", "phone", "city"]
    sess = await d.training_sessions.find_one({"session_id": form["event"]["session_id"]}, {"_id": 0})
    assert sess and sess["meeting_link"] == "https://zoom.us/j/999"
    assert sess["webinar_emails"] == {"confirm": True, "remind_24h": True,
                                      "remind_1h": True, "live": False,
                                      "noshow": False, "attended": False}


@pytest.mark.asyncio
async def test_update_syncs_session_and_authz(ctx, monkeypatch):
    d, client = ctx
    monkeypatch.setattr(fr, "get_current_user", _as(SALES))
    form = (await client.post("/api/forms", json={
        "title": "S", "type": "event",
        "event": {"date": "2026-07-18", "time": "13:00", "meeting_link": "x"}})).json()
    fid = form["form_id"]
    # stranger cannot edit
    monkeypatch.setattr(fr, "get_current_user", _as(OTHER))
    assert (await client.put(f"/api/forms/{fid}", json={"title": "H"})).status_code == 403
    # owner adds a collaborator; collaborator can then edit
    monkeypatch.setattr(fr, "get_current_user", _as(SALES))
    await client.put(f"/api/forms/{fid}", json={"collaborators": ["other@smartshape.in"]})
    monkeypatch.setattr(fr, "get_current_user", _as(OTHER))
    r = await client.put(f"/api/forms/{fid}", json={
        "event": {"date": "2026-07-19", "time": "14:00", "meeting_link": "https://zoom.us/j/1"}})
    assert r.status_code == 200
    sess = await d.training_sessions.find_one(
        {"session_id": form["event"]["session_id"]}, {"_id": 0})
    assert sess["date"] == "2026-07-19" and sess["time"] == "14:00"
    # admin sees the form in list; owner list scoped
    monkeypatch.setattr(fr, "get_current_user", _as(ADMIN))
    assert any(f["form_id"] == fid for f in (await client.get("/api/forms")).json())


@pytest.mark.asyncio
async def test_soft_delete_and_status(ctx, monkeypatch):
    d, client = ctx
    monkeypatch.setattr(fr, "get_current_user", _as(SALES))
    fid = (await client.post("/api/forms", json={"title": "G", "type": "general"})).json()["form_id"]
    assert (await client.post(f"/api/forms/{fid}/status", json={"status": "closed"})).status_code == 200
    assert (await client.get(f"/api/forms/{fid}")).json()["status"] == "closed"
    assert (await client.delete(f"/api/forms/{fid}")).status_code == 200
    assert (await client.get(f"/api/forms/{fid}")).status_code == 404
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /f/ss-work/backend && DB_NAME=smartshape_test python -m pytest tests/test_forms_crud.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'routes.form_routes'` (or ImportError). If `httpx`/`pytest-asyncio` are missing: `python -m pip install httpx pytest-asyncio`.

- [ ] **Step 3: Create `backend/routes/form_routes.py`**

```python
"""Forms Builder — dynamic forms + public event registration.

Any authenticated user can create forms; per-form authorization is
owner OR collaborator OR admin. Event-type forms sync a linked
training_sessions doc so the existing webinar email lifecycle
(confirm / remind_24h / remind_1h) runs unchanged; WhatsApp stages
are added by this module (Tasks 4-5).
"""
from fastapi import APIRouter, HTTPException, Request
from datetime import datetime, timezone
import re, uuid, logging

from database import db
from auth_utils import get_current_user
from rbac import get_team

router = APIRouter()
log = logging.getLogger("forms")

FIELD_TYPES = {"text", "textarea", "dropdown", "multiple_choice", "checkbox", "number", "date"}
MAP_TO_KEYS = {"name", "email", "phone", "school", "designation", "city"}

# For form-linked sessions only 3 stages are wanted; live/noshow/attended stay off.
FORM_SESSION_EMAILS = {"confirm": True, "remind_24h": True, "remind_1h": True,
                       "live": False, "noshow": False, "attended": False}

DEFAULT_WA_CONFIRM = (
    "Dear {name}, your registration is confirmed! \U0001F389\n\n"
    "{title}\nTheme: {theme}\nDate: {date}\nTime: {time}\n\n"
    "Join on Zoom:\n{zoom_link}\n\n"
    "Add to calendar: {calendar_link}\n\n"
    "— SMARTS-SHAPES Team of Educators")

DEFAULT_WA_REMINDER = (
    "⏰ Reminder: {title} is coming up!\n\n"
    "Theme: {theme}\nDate: {date}\nTime: {time}\n\n"
    "Join on Zoom:\n{zoom_link}\n\n"
    "— SMARTS-SHAPES Team of Educators")


def _now():
    return datetime.now(timezone.utc).isoformat()


def _fid():
    return f"ffld_{uuid.uuid4().hex[:8]}"


def default_event_fields():
    def mk(label, ftype, map_to, choices=None):
        return {"field_id": _fid(), "label": label, "type": ftype,
                "required": True, "choices": choices or [], "map_to": map_to}
    return [
        mk("Name", "text", "name"),
        mk("Email", "text", "email"),
        mk("School Name", "text", "school"),
        mk("Designation", "dropdown", "designation",
           ["Art Teacher", "Coordinator", "Pre Primary Teacher", "PRT", "TGT", "Other"]),
        mk("Contact Number", "text", "phone"),
        mk("City", "text", "city"),
    ]


def _default_messages():
    return {"email_subject": "", "email_html": "",
            "wa_confirm": DEFAULT_WA_CONFIRM, "wa_reminder": DEFAULT_WA_REMINDER}


def _can_manage(user, form) -> bool:
    if get_team(user) == "admin":
        return True
    email = (user.get("email") or "").lower()
    if email == (form.get("owner_email") or "").lower():
        return True
    return email in [(c or "").lower() for c in (form.get("collaborators") or [])]


async def _get_form_or_404(form_id: str) -> dict:
    form = await db.forms.find_one(
        {"form_id": form_id, "is_deleted": {"$ne": True}}, {"_id": 0})
    if not form:
        raise HTTPException(404, "Form not found")
    return form


def _clean_fields(raw_fields) -> list:
    fields = []
    for f in (raw_fields or [])[:40]:
        ftype = f.get("type", "text")
        if ftype not in FIELD_TYPES:
            raise HTTPException(422, f"Unknown field type: {ftype}")
        map_to = f.get("map_to") or None
        if map_to is not None and map_to not in MAP_TO_KEYS:
            raise HTTPException(422, f"Unknown map_to: {map_to}")
        fields.append({
            "field_id": f.get("field_id") or _fid(),
            "label": str(f.get("label") or "")[:120],
            "type": ftype,
            "required": bool(f.get("required")),
            "choices": [str(c)[:80] for c in (f.get("choices") or [])][:30],
            "map_to": map_to,
        })
    return fields


def _clean_event(raw: dict) -> dict:
    ev = raw or {}
    out = {k: str(ev.get(k) or "")[:300] for k in
           ("theme", "date", "time", "platform", "meeting_link")}
    out["platform"] = out["platform"] or "zoom"
    try:
        out["duration_min"] = max(15, min(480, int(ev.get("duration_min") or 60)))
    except (TypeError, ValueError):
        out["duration_min"] = 60
    try:
        out["max_participants"] = max(0, int(ev.get("max_participants") or 0))
    except (TypeError, ValueError):
        out["max_participants"] = 0
    out["zoom_meeting_id"] = str(ev.get("zoom_meeting_id") or "")[:60]  # reserved for v2 auto-create
    return out


async def _sync_event_session(form: dict, user_email: str) -> str:
    """Create/update the training_sessions doc backing an event form so the
    existing webinar email lifecycle handles confirm/24h/1h stages."""
    ev = form.get("event") or {}
    sdoc = {
        "title": form.get("title", ""),
        "description": ev.get("theme", ""),
        "date": ev.get("date", ""),
        "time": ev.get("time", ""),
        "platform": ev.get("platform", "zoom"),
        "meeting_link": ev.get("meeting_link", ""),
        "location": "",
        "max_participants": ev.get("max_participants") or 0,
        "is_published": True,
        "zoom_meeting_id": ev.get("zoom_meeting_id") or "",
        "webinar_emails": dict(FORM_SESSION_EMAILS),
        "updated_at": _now(),
    }
    session_id = ev.get("session_id")
    if session_id and await db.training_sessions.find_one({"session_id": session_id}):
        await db.training_sessions.update_one({"session_id": session_id}, {"$set": sdoc})
        return session_id
    session_id = f"sess_{uuid.uuid4().hex[:12]}"
    await db.training_sessions.insert_one({
        **sdoc, "session_id": session_id, "status": "upcoming",
        "host_name": "", "host_email": "", "recording_url": "",
        "reminders_sent": {}, "source": "form",
        "created_at": _now(), "created_by": user_email,
    })
    return session_id


# ── Authenticated CRUD ────────────────────────────────────────────────────────

@router.get("/forms")
async def list_forms(request: Request):
    user = await get_current_user(request)
    q = {"is_deleted": {"$ne": True}}
    if get_team(user) != "admin":
        email = (user.get("email") or "").lower()
        q["$or"] = [{"owner_email": email}, {"collaborators": email}]
    forms = await db.forms.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    for f in forms:
        f["response_count"] = await db.form_responses.count_documents({"form_id": f["form_id"]})
    return forms


@router.post("/forms")
async def create_form(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    ftype = body.get("type") if body.get("type") in ("event", "general") else "general"
    fields = _clean_fields(body.get("fields")) if body.get("fields") else (
        default_event_fields() if ftype == "event" else
        [{"field_id": _fid(), "label": "Name", "type": "text",
          "required": True, "choices": [], "map_to": "name"}])
    form = {
        "form_id": f"form_{uuid.uuid4().hex[:12]}",
        "title": str(body.get("title") or "Untitled form")[:200],
        "description": str(body.get("description") or "")[:2000],
        "type": ftype,
        "owner_email": (user.get("email") or "").lower(),
        "collaborators": [],
        "public_token": str(uuid.uuid4()),
        "status": "open",
        "banner_url": str(body.get("banner_url") or "")[:500],
        "fields": fields,
        "messages": _default_messages(),
        "manual_reminders": [],
        "is_deleted": False,
        "created_at": _now(),
        "updated_at": _now(),
    }
    if ftype == "event":
        form["event"] = _clean_event(body.get("event"))
        form["event"]["session_id"] = await _sync_event_session(form, form["owner_email"])
    await db.forms.insert_one(form)
    form.pop("_id", None)
    return form


@router.get("/forms/{form_id}")
async def get_form(form_id: str, request: Request):
    user = await get_current_user(request)
    form = await _get_form_or_404(form_id)
    if not _can_manage(user, form):
        raise HTTPException(403, "Not your form")
    return form


@router.put("/forms/{form_id}")
async def update_form(form_id: str, request: Request):
    user = await get_current_user(request)
    form = await _get_form_or_404(form_id)
    if not _can_manage(user, form):
        raise HTTPException(403, "Not your form")
    body = await request.json()
    updates = {}
    if "title" in body:
        updates["title"] = str(body.get("title") or "Untitled form")[:200]
    if "description" in body:
        updates["description"] = str(body.get("description") or "")[:2000]
    if "banner_url" in body:
        updates["banner_url"] = str(body.get("banner_url") or "")[:500]
    if "fields" in body:
        updates["fields"] = _clean_fields(body.get("fields"))
    if "collaborators" in body:
        updates["collaborators"] = [
            str(c).lower().strip() for c in (body.get("collaborators") or [])
            if "@" in str(c)][:20]
    if "messages" in body:
        msgs = {**(form.get("messages") or _default_messages())}
        for k in ("email_subject", "email_html", "wa_confirm", "wa_reminder"):
            if k in (body.get("messages") or {}):
                cap = 10000 if k == "email_html" else 2000
                msgs[k] = str(body["messages"].get(k) or "")[:cap]
        updates["messages"] = msgs
    if form.get("type") == "event" and "event" in body:
        ev = _clean_event(body.get("event"))
        ev["session_id"] = (form.get("event") or {}).get("session_id")
        merged = {**form, "event": ev,
                  "title": updates.get("title", form.get("title", ""))}
        ev["session_id"] = await _sync_event_session(merged, (user.get("email") or "").lower())
        updates["event"] = ev
    updates["updated_at"] = _now()
    await db.forms.update_one({"form_id": form_id}, {"$set": updates})
    return await _get_form_or_404(form_id)


@router.post("/forms/{form_id}/status")
async def set_form_status(form_id: str, request: Request):
    user = await get_current_user(request)
    form = await _get_form_or_404(form_id)
    if not _can_manage(user, form):
        raise HTTPException(403, "Not your form")
    body = await request.json()
    status = body.get("status")
    if status not in ("open", "closed"):
        raise HTTPException(422, "status must be open|closed")
    await db.forms.update_one({"form_id": form_id},
                              {"$set": {"status": status, "updated_at": _now()}})
    return {"ok": True, "status": status}


@router.delete("/forms/{form_id}")
async def delete_form(form_id: str, request: Request):
    user = await get_current_user(request)
    form = await _get_form_or_404(form_id)
    if not _can_manage(user, form):
        raise HTTPException(403, "Not your form")
    await db.forms.update_one({"form_id": form_id},
                              {"$set": {"is_deleted": True, "updated_at": _now()}})
    return {"ok": True}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `cd /f/ss-work/backend && DB_NAME=smartshape_test python -m pytest tests/test_forms_crud.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
cd /f/ss-work && git add backend/routes/form_routes.py backend/tests/test_forms_crud.py && git commit -m "feat(forms): forms CRUD + event training_session sync"
```

---

### Task 2: public schema + submit endpoint (validation, honeypot, rate limit)

**Files:**
- Modify: `backend/routes/form_routes.py` (append)
- Test: `backend/tests/test_forms_public.py`

**Interfaces:**
- Consumes: Task 1 (`_get_form_or_404` not used here — public lookup is by token), `db.form_responses`.
- Produces: `GET /api/forms/public/{token}`, `POST /api/forms/public/{token}/submit`, `validate_answers(fields, answers) -> (clean, errors)`, `_mapped(form, clean) -> dict`, `_client_ip(request)`, `_rate_ok(ip, form_id)`, `_thank_you(form) -> dict`, constants `RATE_LIMIT=5`, `RATE_WINDOW=600`, `MAX_RESPONSES=5000`. Task 3/4 extend the submit handler at the marked hook points.

- [ ] **Step 1: Write the failing test** — `backend/tests/test_forms_public.py`:

```python
"""test_forms_public.py — public form schema + submit protections."""
import os
import pytest
import pytest_asyncio
from motor.motor_asyncio import AsyncIOMotorClient
from fastapi import FastAPI
from httpx import AsyncClient, ASGITransport

_DB_NAME = os.getenv("DB_NAME", "smartshape_test")
assert _DB_NAME.endswith("_test") or _DB_NAME == "mtt_ci", f"refusing non-test DB: {_DB_NAME}"

import routes.form_routes as fr

_MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")
SALES = {"email": "rep@smartshape.in", "role": "sales_person", "module_permissions": {}}


@pytest_asyncio.fixture
async def ctx(monkeypatch):
    motor_client = AsyncIOMotorClient(_MONGO_URL)
    d = motor_client[_DB_NAME]
    orig_db = fr.db
    fr.db = d
    fr._RATE.clear()
    async def fake_user(request):
        return SALES
    monkeypatch.setattr(fr, "get_current_user", fake_user)
    app = FastAPI()
    app.include_router(fr.router, prefix="/api")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as client:
        form = (await client.post("/api/forms", json={
            "title": "Session #05", "type": "event",
            "event": {"theme": "Patriotism", "date": "2026-07-18", "time": "13:00",
                      "meeting_link": "https://zoom.us/j/999"}})).json()
        yield d, client, form
    fr.db = orig_db
    for coll in ("forms", "form_responses", "training_sessions",
                 "session_registrations", "email_scheduled", "whatsapp_scheduled",
                 "contacts", "schools", "email_campaigns"):
        await d[coll].delete_many({})
    motor_client.close()


def _answers(form, **over):
    by_map = {f["map_to"]: f["field_id"] for f in form["fields"] if f.get("map_to")}
    vals = {"name": "Asha Verma", "email": "asha@example.com", "school": "DPS Indore",
            "designation": "PRT", "phone": "+91 98765 43210", "city": "Indore"}
    vals.update(over)
    return {by_map[k]: v for k, v in vals.items() if k in by_map}


@pytest.mark.asyncio
async def test_public_schema_hides_meeting_link(ctx):
    d, client, form = ctx
    r = await client.get(f"/api/forms/public/{form['public_token']}")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "open" and len(body["fields"]) == 6
    assert "zoom.us" not in str(body)          # link only after registering
    assert "owner_email" not in body and "collaborators" not in body


@pytest.mark.asyncio
async def test_submit_validation_and_honeypot(ctx):
    d, client, form = ctx
    tok = form["public_token"]
    # honeypot: pretend success, store nothing
    r = await client.post(f"/api/forms/public/{tok}/submit",
                          json={"website": "spam", "answers": _answers(form)})
    assert r.status_code == 200
    assert await d.form_responses.count_documents({}) == 0
    # missing required field
    bad = _answers(form); bad.pop(list(bad)[0])
    r = await client.post(f"/api/forms/public/{tok}/submit", json={"answers": bad})
    assert r.status_code == 422 and "field_errors" in r.json()["detail"]
    # invalid dropdown choice
    r = await client.post(f"/api/forms/public/{tok}/submit",
                          json={"answers": _answers(form, designation="Hacker")})
    assert r.status_code == 422
    # good submit stores a response
    r = await client.post(f"/api/forms/public/{tok}/submit", json={"answers": _answers(form)})
    assert r.status_code == 200 and r.json()["ok"] is True
    assert await d.form_responses.count_documents({"form_id": form["form_id"]}) == 1


@pytest.mark.asyncio
async def test_closed_form_and_rate_limit(ctx):
    d, client, form = ctx
    tok = form["public_token"]
    for i in range(5):
        r = await client.post(f"/api/forms/public/{tok}/submit",
                              json={"answers": _answers(form, email=f"t{i}@x.com",
                                                        phone=f"98765432{i:02d}")})
        assert r.status_code == 200
    r = await client.post(f"/api/forms/public/{tok}/submit", json={"answers": _answers(form)})
    assert r.status_code == 429
    await client.post(f"/api/forms/{form['form_id']}/status", json={"status": "closed"})
    fr._RATE.clear()
    r = await client.post(f"/api/forms/public/{tok}/submit", json={"answers": _answers(form)})
    assert r.status_code == 410
    assert (await client.get(f"/api/forms/public/{tok}")).json()["status"] == "closed"
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /f/ss-work/backend && DB_NAME=smartshape_test python -m pytest tests/test_forms_public.py -v`
Expected: FAIL — `AttributeError: module 'routes.form_routes' has no attribute '_RATE'` / 404s.

- [ ] **Step 3: Append the public section to `backend/routes/form_routes.py`**

```python
# ── Public endpoints (NO auth — the token is the secret, catalogue pattern) ───

RATE_LIMIT, RATE_WINDOW, MAX_RESPONSES = 5, 600, 5000
_RATE = {}   # {(ip, form_id): [epoch_seconds, ...]} — in-memory, single process


def _client_ip(request: Request) -> str:
    fwd = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    return fwd or (request.client.host if request.client else "?")


def _rate_ok(ip: str, form_id: str) -> bool:
    import time as _t
    now_s = _t.time()
    key = (ip, form_id)
    hits = [t for t in _RATE.get(key, []) if now_s - t < RATE_WINDOW]
    if len(hits) >= RATE_LIMIT:
        _RATE[key] = hits
        return False
    hits.append(now_s)
    _RATE[key] = hits
    if len(_RATE) > 10000:          # bot-flood memory backstop
        _RATE.clear()
    return True


def validate_answers(fields: list, answers: dict):
    """Returns (clean, errors). clean maps field_id -> str|list[str]."""
    clean, errors = {}, {}
    answers = answers if isinstance(answers, dict) else {}
    for f in fields:
        fid = f["field_id"]
        val = answers.get(fid)
        if isinstance(val, list):
            val = [str(v)[:200] for v in val][:30]
            empty = not val
        else:
            val = ("" if val is None else str(val)).strip()
            empty = not val
        if f.get("required") and empty:
            errors[fid] = "This field is required"
            continue
        if empty:
            clean[fid] = [] if f["type"] == "checkbox" else ""
            continue
        t = f["type"]
        if t in ("dropdown", "multiple_choice"):
            if val not in f.get("choices", []):
                errors[fid] = "Invalid choice"
                continue
        elif t == "checkbox":
            if not isinstance(val, list) or any(v not in f.get("choices", []) for v in val):
                errors[fid] = "Invalid choice"
                continue
        elif t == "number":
            try:
                float(str(val).replace(",", ""))
            except ValueError:
                errors[fid] = "Must be a number"
                continue
            val = str(val)[:40]
        elif t == "textarea":
            val = str(val)[:2000]
        elif t == "date":
            val = str(val)[:40]
        else:
            val = str(val)[:200]
        clean[fid] = val
    return clean, errors


def _mapped(form: dict, clean: dict) -> dict:
    """{map_to: answer} for CRM + registration use."""
    out = {}
    for f in form.get("fields", []):
        if f.get("map_to") and clean.get(f["field_id"]):
            out[f["map_to"]] = clean[f["field_id"]]
    return out


def _thank_you(form: dict) -> dict:
    ev = form.get("event") or {}
    if form.get("type") != "event":
        return {"message": "Thank you! Your response has been recorded."}
    return {"message": "Registration confirmed! Check your email & WhatsApp for the joining details.",
            "title": form.get("title", ""), "theme": ev.get("theme", ""),
            "date": ev.get("date", ""), "time": ev.get("time", ""),
            "zoom_link": ev.get("meeting_link", ""), "calendar_link": gcal_url(form)}


@router.get("/forms/public/{token}")
async def public_form(token: str):
    form = await db.forms.find_one(
        {"public_token": token, "is_deleted": {"$ne": True}}, {"_id": 0})
    if not form:
        raise HTTPException(404, "Form not found")
    if form.get("status") != "open":
        return {"status": "closed", "title": form.get("title", "")}
    ev = form.get("event") or {}
    return {
        "status": "open",
        "title": form.get("title", ""),
        "description": form.get("description", ""),
        "type": form.get("type", "general"),
        "banner_url": form.get("banner_url", ""),
        "fields": form.get("fields", []),
        # meeting_link deliberately withheld — revealed only after registering
        "event": {k: ev.get(k, "") for k in ("theme", "date", "time", "platform", "duration_min")},
    }


@router.post("/forms/public/{token}/submit")
async def public_submit(token: str, request: Request):
    import hashlib
    form = await db.forms.find_one(
        {"public_token": token, "is_deleted": {"$ne": True}}, {"_id": 0})
    if not form:
        raise HTTPException(404, "Form not found")
    if form.get("status") != "open":
        raise HTTPException(410, "Registrations are closed")
    body = await request.json()
    if (body.get("website") or "").strip():     # honeypot: silent no-op success
        return {"ok": True, "thank_you": _thank_you(form)}
    ip = _client_ip(request)
    if not _rate_ok(ip, form["form_id"]):
        raise HTTPException(429, "Too many attempts — please try again in a few minutes")
    if await db.form_responses.count_documents({"form_id": form["form_id"]}) >= MAX_RESPONSES:
        raise HTTPException(410, "Registrations are closed")
    clean, errors = validate_answers(form.get("fields", []), body.get("answers"))
    if errors:
        raise HTTPException(422, detail={"field_errors": errors})

    response = {
        "response_id": f"fresp_{uuid.uuid4().hex[:12]}",
        "form_id": form["form_id"],
        "answers": clean,
        "submitted_at": _now(),
        "ip_hash": hashlib.sha256(ip.encode()).hexdigest()[:16],
        "contact_id": None, "school_id": None, "registration_id": None,
        "delivery": {"email": "skipped", "whatsapp": "skipped"},
    }
    await db.form_responses.insert_one(response)
    response.pop("_id", None)

    mapped = _mapped(form, clean)
    updates = {}
    # -- Task 3 hook: CRM upsert fills updates["contact_id"/"school_id"] --
    # -- Task 4 hook: event bridge + confirmations fill updates["registration_id"/"delivery.*"] --
    if updates:
        await db.form_responses.update_one(
            {"response_id": response["response_id"]}, {"$set": updates})
    return {"ok": True, "thank_you": _thank_you(form)}
```

Also append the calendar-link helper (used by `_thank_you` above and by Task 4 messages):

```python
def gcal_url(form: dict) -> str:
    """Prefilled Google-Calendar 'add event' URL (works in WhatsApp texts)."""
    from urllib.parse import urlencode
    from datetime import timedelta
    from webinar_lifecycle import session_start_ist
    ev = form.get("event") or {}
    start = session_start_ist({"date": ev.get("date"), "time": ev.get("time")})
    if not start:
        return ""
    end = start + timedelta(minutes=int(ev.get("duration_min") or 60))
    fmt = "%Y%m%dT%H%M%SZ"
    details = f"Join: {ev.get('meeting_link', '')}" if ev.get("meeting_link") else ""
    return "https://calendar.google.com/calendar/render?" + urlencode({
        "action": "TEMPLATE", "text": form.get("title", ""),
        "dates": f"{start.strftime(fmt)}/{end.strftime(fmt)}",
        "details": details})
```

NOTE: `gcal_url` must be defined ABOVE `_thank_you` in the file (plain function order doesn't matter for runtime since calls happen per-request, but keep it near `_thank_you` for readability).

- [ ] **Step 4: Run tests**

Run: `cd /f/ss-work/backend && DB_NAME=smartshape_test python -m pytest tests/test_forms_public.py tests/test_forms_crud.py -v`
Expected: all pass (Task 1 tests must still pass).

- [ ] **Step 5: Commit**

```bash
cd /f/ss-work && git add backend/routes/form_routes.py backend/tests/test_forms_public.py && git commit -m "feat(forms): public schema + submit with honeypot/rate-limit/validation"
```

---

### Task 3: CRM contact upsert service

**Files:**
- Create: `backend/services/form_crm.py`
- Modify: `backend/routes/form_routes.py` (fill Task-3 hook)
- Test: `backend/tests/test_form_crm.py`

**Interfaces:**
- Consumes: `import_engine.normalize_phone`, `db.contacts` (has `phone_norm` field + index), `db.schools`.
- Produces: `async upsert_contact(db, mapped: dict, form_id: str) -> (contact_id|None, school_id|None)` — never raises.

- [ ] **Step 1: Write the failing test** — `backend/tests/test_form_crm.py`:

```python
"""test_form_crm.py — fill-blanks-only CRM upsert from public form submissions."""
import os
import pytest
import pytest_asyncio
from motor.motor_asyncio import AsyncIOMotorClient

_DB_NAME = os.getenv("DB_NAME", "smartshape_test")
assert _DB_NAME.endswith("_test") or _DB_NAME == "mtt_ci", f"refusing non-test DB: {_DB_NAME}"

from services.form_crm import upsert_contact

_MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")

MAPPED = {"name": "Asha Verma", "email": "asha@example.com", "phone": "+91 98765 43210",
          "school": "DPS Indore", "designation": "PRT", "city": "Indore"}


@pytest_asyncio.fixture
async def d():
    motor_client = AsyncIOMotorClient(_MONGO_URL)
    dd = motor_client[_DB_NAME]
    yield dd
    await dd.contacts.delete_many({})
    await dd.schools.delete_many({})
    motor_client.close()


@pytest.mark.asyncio
async def test_creates_tagged_contact_and_links_school(d):
    await d.schools.insert_one({"school_id": "sch_x1", "school_name": "dps indore"})
    cid, sid = await upsert_contact(d, dict(MAPPED), "form_abc")
    assert cid and cid.startswith("con_") and sid == "sch_x1"
    c = await d.contacts.find_one({"contact_id": cid}, {"_id": 0})
    assert c["source"] == "form" and c["source_form_id"] == "form_abc"
    assert c["phone_norm"] == "+919876543210"
    assert c["school_id"] == "sch_x1" and c["status"] == "active"


@pytest.mark.asyncio
async def test_existing_by_phone_fills_blanks_only(d):
    await d.contacts.insert_one({
        "contact_id": "con_old1", "name": "A. Verma", "phone": "+91 98765 43210",
        "phone_norm": "+919876543210", "email": "", "designation": "TGT",
        "city": "", "school_id": None, "school_name": "", "status": "active"})
    cid, sid = await upsert_contact(d, dict(MAPPED), "form_abc")
    assert cid == "con_old1"
    c = await d.contacts.find_one({"contact_id": "con_old1"}, {"_id": 0})
    assert c["email"] == "asha@example.com"     # blank -> filled
    assert c["city"] == "Indore"                # blank -> filled
    assert c["designation"] == "TGT"            # existing value NEVER overwritten
    assert c["name"] == "A. Verma"              # name never overwritten


@pytest.mark.asyncio
async def test_no_phone_no_email_returns_none(d):
    cid, sid = await upsert_contact(d, {"name": "X", "school": "Y"}, "form_abc")
    assert cid is None and sid is None
    assert await d.contacts.count_documents({}) == 0
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /f/ss-work/backend && DB_NAME=smartshape_test python -m pytest tests/test_form_crm.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'services.form_crm'`.

- [ ] **Step 3: Create `backend/services/form_crm.py`**

```python
"""CRM upsert for public form submissions.

Match an existing contact by normalized phone, then email. Existing contacts
get FILL-BLANKS-ONLY updates (never overwrite CRM data). New contacts are
tagged source="form" + source_form_id so junk from a public form is always
one filter away from bulk cleanup. Never raises — a CRM failure must not
lose the registration.
"""
import re, uuid, logging
from datetime import datetime, timezone

from import_engine import normalize_phone

log = logging.getLogger("forms.crm")


def _now():
    return datetime.now(timezone.utc).isoformat()


async def upsert_contact(db, mapped: dict, form_id: str):
    """mapped: any subset of {name,email,phone,school,designation,city}.
    Returns (contact_id | None, school_id | None)."""
    try:
        name = (mapped.get("name") or "").strip()
        email = (mapped.get("email") or "").strip().lower()
        phone = (mapped.get("phone") or "").strip()
        if not (phone or ("@" in email)):
            return None, None
        norm = normalize_phone(phone) if phone else ""

        school_id, school_name = None, (mapped.get("school") or "").strip()
        if school_name:
            school = await db.schools.find_one(
                {"school_name": {"$regex": f"^{re.escape(school_name)}$", "$options": "i"}},
                {"_id": 0, "school_id": 1})
            school_id = (school or {}).get("school_id")

        ors = []
        if norm:
            ors += [{"phone_norm": norm}, {"phone": phone}]
        if "@" in email:
            ors.append({"email": email})
        existing = await db.contacts.find_one(
            {"$or": ors, "is_deleted": {"$ne": True}}, {"_id": 0})

        if existing:
            fill = {}
            if "@" in email and not (existing.get("email") or "").strip():
                fill["email"] = email
            if phone and not (existing.get("phone") or "").strip():
                fill["phone"], fill["phone_norm"] = phone, norm
            for src, dst in (("designation", "designation"), ("city", "city")):
                v = (mapped.get(src) or "").strip()
                if v and not (existing.get(dst) or "").strip():
                    fill[dst] = v
            if school_id and not existing.get("school_id"):
                fill["school_id"] = school_id
            if school_name and not (existing.get("school_name") or "").strip():
                fill["school_name"] = school_name
            if fill:
                fill["updated_at"] = _now()
                await db.contacts.update_one(
                    {"contact_id": existing["contact_id"]}, {"$set": fill})
            return existing["contact_id"], school_id

        contact_id = f"con_{uuid.uuid4().hex[:12]}"
        await db.contacts.insert_one({
            "contact_id": contact_id, "name": name,
            "phone": phone, "phone_norm": norm, "email": email,
            "designation": (mapped.get("designation") or "").strip(),
            "city": (mapped.get("city") or "").strip(),
            "school_id": school_id, "school_name": school_name,
            "company": school_name, "notes": "", "status": "active",
            "converted_to_lead": False, "lead_id": None,
            "source": "form", "source_form_id": form_id,
            "created_by": "public_form", "created_at": _now(),
        })
        return contact_id, school_id
    except Exception as exc:
        log.warning("[form-crm] upsert failed: %s", exc)
        return None, None
```

- [ ] **Step 4: Fill the Task-3 hook in `public_submit`** (`backend/routes/form_routes.py`) — replace the two hook comment lines with:

```python
    from services.form_crm import upsert_contact
    contact_id, school_id = await upsert_contact(db, mapped, form["form_id"])
    updates["contact_id"], updates["school_id"] = contact_id, school_id
    # -- Task 4 hook: event bridge + confirmations fill updates["registration_id"/"delivery.*"] --
```

- [ ] **Step 5: Run tests**

Run: `cd /f/ss-work/backend && DB_NAME=smartshape_test python -m pytest tests/test_form_crm.py tests/test_forms_public.py -v`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
cd /f/ss-work && git add backend/services/form_crm.py backend/tests/test_form_crm.py backend/routes/form_routes.py && git commit -m "feat(forms): CRM contact upsert (fill-blanks-only, source-tagged)"
```

---

### Task 4: event bridge — registration + Email/WhatsApp confirmations

**Files:**
- Modify: `backend/routes/form_routes.py` (append helpers + fill Task-4 hook)
- Test: `backend/tests/test_forms_confirm.py`

**Interfaces:**
- Consumes: `routes.training_routes._enqueue_webinar_stage(session, reg, stage) -> bool` (idempotent via `sent_stages`), `db.whatsapp_scheduled` queue row shape (`scheduled_id: wsch_<hex12>, campaign_id, status:"pending", phone, message, created_at`), `email_utils` helpers, `gcal_url` (Task 2).
- Produces: `render_msg(tmpl, ctx) -> str`, `_msg_ctx(form, reg) -> dict`, `_enqueue_wa(phone, message, campaign_id) -> bool`, `_enqueue_custom_confirm_email(form, session, reg) -> bool`. Registration rows now carry `phone`, `wa_sent_stages`, `source_form_id` (extra keys — existing engine ignores them).

- [ ] **Step 1: Write the failing test** — `backend/tests/test_forms_confirm.py`:

```python
"""test_forms_confirm.py — event submit -> session_registrations + email + WhatsApp."""
import os
import pytest
import pytest_asyncio
from motor.motor_asyncio import AsyncIOMotorClient
from fastapi import FastAPI
from httpx import AsyncClient, ASGITransport

_DB_NAME = os.getenv("DB_NAME", "smartshape_test")
assert _DB_NAME.endswith("_test") or _DB_NAME == "mtt_ci", f"refusing non-test DB: {_DB_NAME}"

import routes.form_routes as fr
import routes.training_routes as tr

_MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")
SALES = {"email": "rep@smartshape.in", "role": "sales_person", "module_permissions": {}}


@pytest_asyncio.fixture
async def ctx(monkeypatch):
    motor_client = AsyncIOMotorClient(_MONGO_URL)
    d = motor_client[_DB_NAME]
    orig_fr, orig_tr = fr.db, tr.db
    fr.db = d
    tr.db = d          # _enqueue_webinar_stage writes via training_routes.db
    fr._RATE.clear()
    async def fake_user(request):
        return SALES
    monkeypatch.setattr(fr, "get_current_user", fake_user)
    app = FastAPI()
    app.include_router(fr.router, prefix="/api")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as client:
        form = (await client.post("/api/forms", json={
            "title": "Session #05", "type": "event",
            "event": {"theme": "Patriotism", "date": "2026-07-18", "time": "13:00",
                      "meeting_link": "https://zoom.us/j/999"}})).json()
        yield d, client, form
    fr.db, tr.db = orig_fr, orig_tr
    for coll in ("forms", "form_responses", "training_sessions", "session_registrations",
                 "email_scheduled", "whatsapp_scheduled", "email_campaigns",
                 "email_suppressions", "contacts", "schools"):
        await d[coll].delete_many({})
    motor_client.close()


def _answers(form, **over):
    by_map = {f["map_to"]: f["field_id"] for f in form["fields"] if f.get("map_to")}
    vals = {"name": "Asha Verma", "email": "asha@example.com", "school": "DPS Indore",
            "designation": "PRT", "phone": "9876543210", "city": "Indore"}
    vals.update(over)
    return {by_map[k]: v for k, v in vals.items() if k in by_map}


@pytest.mark.asyncio
async def test_submit_registers_and_queues_email_and_whatsapp(ctx):
    d, client, form = ctx
    tok = form["public_token"]
    r = await client.post(f"/api/forms/public/{tok}/submit", json={"answers": _answers(form)})
    assert r.status_code == 200
    ty = r.json()["thank_you"]
    assert ty["zoom_link"] == "https://zoom.us/j/999"
    assert "calendar.google.com" in ty["calendar_link"]
    reg = await d.session_registrations.find_one(
        {"session_id": form["event"]["session_id"]}, {"_id": 0})
    assert reg and reg["email"] == "asha@example.com" and reg["phone"] == "9876543210"
    assert "confirm" in reg["sent_stages"]
    assert await d.email_scheduled.count_documents({"email": "asha@example.com"}) == 1
    wa = await d.whatsapp_scheduled.find_one({"phone": "9876543210"}, {"_id": 0})
    assert wa and "zoom.us/j/999" in wa["message"] and "Asha" in wa["message"]
    resp = await d.form_responses.find_one({"form_id": form["form_id"]}, {"_id": 0})
    assert resp["registration_id"] == reg["reg_id"]
    assert resp["delivery"] == {"email": "queued", "whatsapp": "queued"}
    assert resp["contact_id"] and resp["contact_id"].startswith("con_")


@pytest.mark.asyncio
async def test_duplicate_email_reuses_reg_no_second_confirm(ctx):
    d, client, form = ctx
    tok = form["public_token"]
    await client.post(f"/api/forms/public/{tok}/submit", json={"answers": _answers(form)})
    await client.post(f"/api/forms/public/{tok}/submit", json={"answers": _answers(form)})
    assert await d.session_registrations.count_documents({}) == 1
    assert await d.email_scheduled.count_documents({}) == 1   # confirm sent once
    assert await d.form_responses.count_documents({}) == 2    # both responses kept


@pytest.mark.asyncio
async def test_custom_email_template_used_when_set(ctx):
    d, client, form = ctx
    await client.put(f"/api/forms/{form['form_id']}", json={"messages": {
        "email_subject": "See you at {title}!",
        "email_html": "<p>Hi {name}, join: {zoom_link}</p>"}})
    await client.post(f"/api/forms/public/{form['public_token']}/submit",
                      json={"answers": _answers(form)})
    row = await d.email_scheduled.find_one({}, {"_id": 0})
    assert row["subject"] == "See you at Session #05!"
    assert "zoom.us/j/999" in row["body_html"]


@pytest.mark.asyncio
async def test_missing_phone_marks_whatsapp_skipped(ctx):
    d, client, form = ctx
    ans = _answers(form)
    phone_fid = next(f["field_id"] for f in form["fields"] if f["map_to"] == "phone")
    ans[phone_fid] = "12345"     # too short to be a real number
    # phone field is required=True in preset; bypass by making it optional first
    fields = form["fields"]
    for f in fields:
        if f["map_to"] == "phone":
            f["required"] = False
    await client.put(f"/api/forms/{form['form_id']}", json={"fields": fields})
    ans[phone_fid] = ""
    r = await client.post(f"/api/forms/public/{form['public_token']}/submit",
                          json={"answers": ans})
    assert r.status_code == 200
    resp = await d.form_responses.find_one({}, {"_id": 0})
    assert resp["delivery"]["whatsapp"] == "skipped"
    assert resp["delivery"]["email"] == "queued"
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /f/ss-work/backend && DB_NAME=smartshape_test python -m pytest tests/test_forms_confirm.py -v`
Expected: FAIL — `registration_id` is None / no `whatsapp_scheduled` rows (hook not yet filled).

- [ ] **Step 3: Append messaging helpers to `backend/routes/form_routes.py`**

```python
# ── Confirmation / reminder messaging ─────────────────────────────────────────

def render_msg(tmpl: str, ctx: dict) -> str:
    out = tmpl or ""
    for k, v in ctx.items():
        out = out.replace("{" + k + "}", str(v or ""))
    return out


def _msg_ctx(form: dict, reg: dict) -> dict:
    ev = form.get("event") or {}
    first = (reg.get("name") or "").split(" ")[0]
    return {"name": first or "there",
            "school_name": reg.get("school_name") or "your school",
            "title": form.get("title", ""), "theme": ev.get("theme", ""),
            "date": ev.get("date", ""), "time": ev.get("time", ""),
            "zoom_link": ev.get("meeting_link", ""),
            "calendar_link": gcal_url(form)}


async def _enqueue_wa(phone: str, message: str, campaign_id: str) -> bool:
    """Queue one WhatsApp text via the existing wa_sender_loop queue."""
    phone = (phone or "").strip()
    if len(re.sub(r"\D", "", phone)) < 10:
        return False
    await db.whatsapp_scheduled.insert_one({
        "scheduled_id": f"wsch_{uuid.uuid4().hex[:12]}", "campaign_id": campaign_id,
        "status": "pending", "phone": phone, "message": message,
        "created_at": _now()})
    return True


async def _enqueue_custom_confirm_email(form: dict, session: dict, reg: dict) -> bool:
    """If the form owner customised the confirmation email, queue THAT instead
    of the engine's stage template. Returns True when the custom path handled
    the confirm stage (including guard-skips); False -> caller falls back to
    _enqueue_webinar_stage(session, reg, "confirm")."""
    msgs = form.get("messages") or {}
    subject_t = (msgs.get("email_subject") or "").strip()
    html_t = (msgs.get("email_html") or "").strip()
    if not (subject_t and html_t):
        return False
    if "confirm" in (reg.get("sent_stages") or []):
        return True
    email = (reg.get("email") or "").strip().lower()
    if not email or "@" not in email:
        return True
    if await db.email_suppressions.find_one({"email": email}):
        return True
    from email_utils import (sanitize_html, personalize, personalize_html,
                             plain_from_html, wrap_email_shell)
    ctx = _msg_ctx(form, reg)
    html = wrap_email_shell(sanitize_html(render_msg(html_t, ctx)))
    subject = render_msg(subject_t, ctx)
    first, school = ctx["name"], ctx["school_name"]
    await db.email_scheduled.insert_one({
        "scheduled_id": f"esched_{uuid.uuid4().hex[:10]}",
        "campaign_id": f"form_{form['form_id']}",
        "email": email, "contact_name": reg.get("name", ""),
        "subject": personalize(subject, first, school),
        "message": personalize(plain_from_html(html), first, school),
        "body_html": personalize_html(html, first, school),
        "status": "pending", "type": "webinar", "queued_at": _now(), "sent_at": None})
    await db.session_registrations.update_one(
        {"reg_id": reg["reg_id"]}, {"$addToSet": {"sent_stages": "confirm"}})
    return True
```

- [ ] **Step 4: Fill the Task-4 hook in `public_submit`** — replace the Task-4 hook comment line with:

```python
    if form.get("type") == "event" and (form.get("event") or {}).get("session_id"):
        session = await db.training_sessions.find_one(
            {"session_id": form["event"]["session_id"]}, {"_id": 0})
        if session:
            email_l = (mapped.get("email") or "").strip().lower()
            reg = None
            if "@" in email_l:
                reg = await db.session_registrations.find_one(
                    {"session_id": session["session_id"], "email": email_l})
            if not reg:
                reg = {"reg_id": f"reg_{uuid.uuid4().hex[:12]}",
                       "session_id": session["session_id"],
                       "name": mapped.get("name") or "",
                       "email": email_l if "@" in email_l else "",
                       "school_name": mapped.get("school") or "",
                       "phone": mapped.get("phone") or "",
                       "contact_id": updates.get("contact_id"),
                       "status": "registered", "sent_stages": [],
                       "wa_sent_stages": [], "registered_at": _now(),
                       "source_form_id": form["form_id"]}
                await db.session_registrations.insert_one(reg)
                reg.pop("_id", None)
            updates["registration_id"] = reg["reg_id"]
            # Confirmation email: custom template if set, else engine stage
            from routes.training_routes import _enqueue_webinar_stage
            if not await _enqueue_custom_confirm_email(form, session, reg):
                await _enqueue_webinar_stage(session, reg, "confirm")
            updates["delivery.email"] = "queued" if reg.get("email") else "skipped"
            # WhatsApp confirmation (instant)
            wa_msg = render_msg(
                (form.get("messages") or {}).get("wa_confirm") or DEFAULT_WA_CONFIRM,
                _msg_ctx(form, reg))
            wa_ok = await _enqueue_wa(reg.get("phone"), wa_msg, f"form_{form['form_id']}")
            updates["delivery.whatsapp"] = "queued" if wa_ok else "skipped"
```

- [ ] **Step 5: Run tests**

Run: `cd /f/ss-work/backend && DB_NAME=smartshape_test python -m pytest tests/test_forms_confirm.py tests/test_forms_public.py tests/test_form_crm.py tests/test_forms_crud.py -v`
Expected: all pass. NOTE: `test_forms_public.py::test_closed_form_and_rate_limit` submits 5 times — it will now also create registrations/emails; its fixture already cleans those collections.

- [ ] **Step 6: Commit**

```bash
cd /f/ss-work && git add backend/routes/form_routes.py backend/tests/test_forms_confirm.py && git commit -m "feat(forms): event bridge - registration + email/WhatsApp confirmations"
```

---

### Task 5: WhatsApp reminder stages + manual "Send reminder now"

**Files:**
- Modify: `backend/routes/form_routes.py` (append), `backend/scheduler.py:1050-1051` (per-reg loop)
- Test: `backend/tests/test_forms_reminders.py`

**Interfaces:**
- Consumes: `scheduler.process_webinar_lifecycle(now=...)` (injectable clock), `webinar_templates_html.render_stage`, `routes.training_routes._session_tokens`.
- Produces: `async enqueue_form_wa_stage(session, reg, stage) -> bool` (idempotent via `wa_sent_stages` on the registration), `POST /api/forms/{form_id}/remind`.

- [ ] **Step 1: Write the failing test** — `backend/tests/test_forms_reminders.py`:

```python
"""test_forms_reminders.py — WA companion to email reminder stages + manual blast."""
import os
from datetime import datetime, timezone, timedelta

import pytest
import pytest_asyncio
from motor.motor_asyncio import AsyncIOMotorClient
from fastapi import FastAPI
from httpx import AsyncClient, ASGITransport

_DB_NAME = os.getenv("DB_NAME", "smartshape_test")
assert _DB_NAME.endswith("_test") or _DB_NAME == "mtt_ci", f"refusing non-test DB: {_DB_NAME}"

import scheduler
import routes.form_routes as fr
import routes.training_routes as tr

_MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")
SALES = {"email": "rep@smartshape.in", "role": "sales_person", "module_permissions": {}}


@pytest_asyncio.fixture
async def ctx(monkeypatch):
    motor_client = AsyncIOMotorClient(_MONGO_URL)
    d = motor_client[_DB_NAME]
    origs = (scheduler.db, fr.db, tr.db)
    scheduler.db = fr.db = tr.db = d
    fr._RATE.clear()
    async def fake_user(request):
        return SALES
    monkeypatch.setattr(fr, "get_current_user", fake_user)
    app = FastAPI()
    app.include_router(fr.router, prefix="/api")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as client:
        yield d, client
    scheduler.db, fr.db, tr.db = origs
    for coll in ("forms", "form_responses", "training_sessions", "session_registrations",
                 "email_scheduled", "whatsapp_scheduled", "email_campaigns",
                 "email_suppressions", "contacts", "schools"):
        await d[coll].delete_many({})
    motor_client.close()


async def _make_event(client, start_utc):
    ist = start_utc + timedelta(hours=5, minutes=30)
    return (await client.post("/api/forms", json={
        "title": "Session #05", "type": "event",
        "event": {"theme": "Patriotism", "date": ist.strftime("%Y-%m-%d"),
                  "time": ist.strftime("%H:%M"),
                  "meeting_link": "https://zoom.us/j/999"}})).json()


def _answers(form, **over):
    by_map = {f["map_to"]: f["field_id"] for f in form["fields"] if f.get("map_to")}
    vals = {"name": "Asha", "email": "asha@example.com", "school": "DPS",
            "designation": "PRT", "phone": "9876543210", "city": "Indore"}
    vals.update(over)
    return {by_map[k]: v for k, v in vals.items() if k in by_map}


@pytest.mark.asyncio
async def test_scheduler_reminder_also_queues_whatsapp_idempotently(ctx):
    d, client = ctx
    now = datetime.now(timezone.utc)
    form = await _make_event(client, now + timedelta(hours=12))   # inside 24h window
    await client.post(f"/api/forms/public/{form['public_token']}/submit",
                      json={"answers": _answers(form)})
    await d.whatsapp_scheduled.delete_many({})   # drop the confirm WA row
    await scheduler.process_webinar_lifecycle(now=now)
    assert await d.whatsapp_scheduled.count_documents({}) == 1    # remind_24h WA
    wa = await d.whatsapp_scheduled.find_one({}, {"_id": 0})
    assert "zoom.us/j/999" in wa["message"]
    await scheduler.process_webinar_lifecycle(now=now)            # second pass: no dup
    assert await d.whatsapp_scheduled.count_documents({}) == 1
    reg = await d.session_registrations.find_one({}, {"_id": 0})
    assert "remind_24h" in reg["wa_sent_stages"]


@pytest.mark.asyncio
async def test_manual_remind_blasts_both_channels(ctx):
    d, client = ctx
    now = datetime.now(timezone.utc)
    form = await _make_event(client, now + timedelta(days=5))
    for i in range(2):
        await client.post(f"/api/forms/public/{form['public_token']}/submit",
                          json={"answers": _answers(form, email=f"t{i}@x.com",
                                                    phone=f"98765432{i:02d}")})
    await d.email_scheduled.delete_many({})
    await d.whatsapp_scheduled.delete_many({})
    r = await client.post(f"/api/forms/{form['form_id']}/remind")
    assert r.status_code == 200
    body = r.json()
    assert body["emails"] == 2 and body["whatsapp"] == 2 and body["registrants"] == 2
    assert await d.email_scheduled.count_documents({}) == 2
    assert await d.whatsapp_scheduled.count_documents({}) == 2
    updated = (await client.get(f"/api/forms/{form['form_id']}")).json()
    assert len(updated["manual_reminders"]) == 1
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /f/ss-work/backend && DB_NAME=smartshape_test python -m pytest tests/test_forms_reminders.py -v`
Expected: FAIL — 404 on `/remind`; scheduler pass queues 0 WhatsApp rows.

- [ ] **Step 3: Append to `backend/routes/form_routes.py`**

```python
# ── Reminders ─────────────────────────────────────────────────────────────────

async def enqueue_form_wa_stage(session: dict, reg: dict, stage: str) -> bool:
    """WhatsApp companion to the email reminder stages (remind_24h/remind_1h).
    Called by scheduler.process_webinar_lifecycle for form-linked sessions.
    Idempotent per registration+stage via wa_sent_stages."""
    form = await db.forms.find_one(
        {"event.session_id": session.get("session_id"), "is_deleted": {"$ne": True}},
        {"_id": 0})
    if not form:
        return False
    if stage in (reg.get("wa_sent_stages") or []):
        return False
    msg = render_msg(
        (form.get("messages") or {}).get("wa_reminder") or DEFAULT_WA_REMINDER,
        _msg_ctx(form, reg))
    if not await _enqueue_wa(reg.get("phone"), msg, f"form_{form['form_id']}"):
        return False
    await db.session_registrations.update_one(
        {"reg_id": reg["reg_id"]}, {"$addToSet": {"wa_sent_stages": stage}})
    return True


@router.post("/forms/{form_id}/remind")
async def send_reminder_now(form_id: str, request: Request):
    """Manual blast: reminder email + WhatsApp to every registered attendee, now."""
    user = await get_current_user(request)
    form = await _get_form_or_404(form_id)
    if not _can_manage(user, form):
        raise HTTPException(403, "Not your form")
    if form.get("type") != "event" or not (form.get("event") or {}).get("session_id"):
        raise HTTPException(422, "Only event forms have reminders")
    session = await db.training_sessions.find_one(
        {"session_id": form["event"]["session_id"]}, {"_id": 0})
    if not session:
        raise HTTPException(404, "Linked session not found")

    from routes.training_routes import _session_tokens
    from webinar_templates_html import render_stage
    from email_utils import (sanitize_html, personalize, personalize_html,
                             plain_from_html, wrap_email_shell)
    subject_t, inner = render_stage("remind_1h", _session_tokens(session))
    html_t = wrap_email_shell(sanitize_html(inner))

    regs = await db.session_registrations.find(
        {"session_id": session["session_id"], "status": "registered"},
        {"_id": 0}).to_list(5000)
    emails = wa = 0
    for reg in regs:
        email = (reg.get("email") or "").strip().lower()
        if email and "@" in email and \
                not await db.email_suppressions.find_one({"email": email}):
            first = (reg.get("name") or "").split(" ")[0]
            school = reg.get("school_name") or "your school"
            await db.email_scheduled.insert_one({
                "scheduled_id": f"esched_{uuid.uuid4().hex[:10]}",
                "campaign_id": f"form_{form_id}", "email": email,
                "contact_name": reg.get("name", ""),
                "subject": personalize(subject_t, first, school),
                "message": personalize(plain_from_html(html_t), first, school),
                "body_html": personalize_html(html_t, first, school),
                "status": "pending", "type": "webinar",
                "queued_at": _now(), "sent_at": None})
            emails += 1
        msg = render_msg(
            (form.get("messages") or {}).get("wa_reminder") or DEFAULT_WA_REMINDER,
            _msg_ctx(form, reg))
        if await _enqueue_wa(reg.get("phone"), msg, f"form_{form_id}"):
            wa += 1
    await db.forms.update_one({"form_id": form_id}, {"$push": {"manual_reminders": {
        "at": _now(), "by": user["email"], "emails": emails, "whatsapp": wa}}})
    return {"emails": emails, "whatsapp": wa, "registrants": len(regs)}
```

- [ ] **Step 4: Hook the scheduler** — in `backend/scheduler.py`, inside `process_webinar_lifecycle`, the per-registration loop currently reads (lines ~1050-1051):

```python
                for reg in regs:
                    await _enqueue_webinar_stage(session, reg, stage)
```

Replace with:

```python
                for reg in regs:
                    await _enqueue_webinar_stage(session, reg, stage)
                    if stage in ("remind_24h", "remind_1h"):
                        # WhatsApp companion for form-linked sessions (no-op otherwise)
                        try:
                            from routes.form_routes import enqueue_form_wa_stage
                            await enqueue_form_wa_stage(session, reg, stage)
                        except Exception as exc:
                            log.warning(f"[webinar loop] form wa {stage}: {exc}")
```

IMPORTANT: `enqueue_form_wa_stage` reads/writes via `routes.form_routes.db`, so the existing `test_webinar_loop.py` (which patches only `scheduler.db` and `tr.db`) must keep passing — the lazy import + `forms` collection being empty in that test makes it a no-op. Verify in Step 5.

- [ ] **Step 5: Run tests (including the pre-existing webinar loop suite)**

Run: `cd /f/ss-work/backend && DB_NAME=smartshape_test python -m pytest tests/test_forms_reminders.py tests/test_webinar_loop.py -v`
Expected: all pass — but `test_webinar_loop.py` runs against an UNPATCHED `routes.form_routes.db` (prod-configured module global). If any of its tests fail or hang on the forms lookup, patch `fr.db` there too is NOT allowed (don't edit existing tests unless broken by us); instead make `enqueue_form_wa_stage` resilient: it already no-ops when `db.forms` has no matching doc. If the unpatched global points at an unreachable Mongo, wrap the `forms.find_one` in the same try/except that the scheduler hook already provides (the exception is caught and logged there) — confirm the suite passes.

- [ ] **Step 6: Commit**

```bash
cd /f/ss-work && git add backend/routes/form_routes.py backend/scheduler.py backend/tests/test_forms_reminders.py && git commit -m "feat(forms): WhatsApp reminder stages + manual send-reminder-now"
```

---

### Task 6: responses list + CSV/XLSX export

**Files:**
- Modify: `backend/routes/form_routes.py` (append)
- Test: `backend/tests/test_forms_export.py`

**Interfaces:**
- Consumes: Tasks 1-4 (form + responses docs), `openpyxl` (already a backend dep — used by `import_engine.py`).
- Produces: `GET /api/forms/{form_id}/responses` → `{form, responses, count}`; `GET /api/forms/{form_id}/export.csv`; `GET /api/forms/{form_id}/export.xlsx`; helper `_export_rows(form, rows) -> list[list]`.

- [ ] **Step 1: Write the failing test** — `backend/tests/test_forms_export.py`:

```python
"""test_forms_export.py — responses listing + CSV/XLSX export."""
import csv, io, os
import pytest
import pytest_asyncio
from motor.motor_asyncio import AsyncIOMotorClient
from fastapi import FastAPI
from httpx import AsyncClient, ASGITransport

_DB_NAME = os.getenv("DB_NAME", "smartshape_test")
assert _DB_NAME.endswith("_test") or _DB_NAME == "mtt_ci", f"refusing non-test DB: {_DB_NAME}"

import routes.form_routes as fr

_MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")
SALES = {"email": "rep@smartshape.in", "role": "sales_person", "module_permissions": {}}
OTHER = {"email": "other@smartshape.in", "role": "sales_person", "module_permissions": {}}


@pytest_asyncio.fixture
async def ctx(monkeypatch):
    motor_client = AsyncIOMotorClient(_MONGO_URL)
    d = motor_client[_DB_NAME]
    orig_db = fr.db
    fr.db = d
    fr._RATE.clear()
    fr._CURRENT = {"user": SALES}
    async def fake_user(request):
        return fr._CURRENT["user"]
    monkeypatch.setattr(fr, "get_current_user", fake_user)
    app = FastAPI()
    app.include_router(fr.router, prefix="/api")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as client:
        form = (await client.post("/api/forms", json={
            "title": "Session #05", "type": "event",
            "event": {"theme": "Patriotism", "date": "2026-07-18", "time": "13:00",
                      "meeting_link": "https://zoom.us/j/999"}})).json()
        by_map = {f["map_to"]: f["field_id"] for f in form["fields"] if f.get("map_to")}
        ans = {by_map[k]: v for k, v in {
            "name": "Asha Verma", "email": "asha@example.com", "school": "DPS Indore",
            "designation": "PRT", "phone": "9876543210", "city": "Indore"}.items()}
        await client.post(f"/api/forms/public/{form['public_token']}/submit",
                          json={"answers": ans})
        yield d, client, form
    fr.db = orig_db
    for coll in ("forms", "form_responses", "training_sessions", "session_registrations",
                 "email_scheduled", "whatsapp_scheduled", "email_campaigns",
                 "contacts", "schools"):
        await d[coll].delete_many({})
    motor_client.close()


@pytest.mark.asyncio
async def test_responses_listing_scoped(ctx):
    d, client, form = ctx
    r = await client.get(f"/api/forms/{form['form_id']}/responses")
    assert r.status_code == 200
    body = r.json()
    assert body["count"] == 1
    assert body["responses"][0]["delivery"]["email"] == "queued"
    fr._CURRENT["user"] = OTHER
    assert (await client.get(f"/api/forms/{form['form_id']}/responses")).status_code == 403
    fr._CURRENT["user"] = SALES


@pytest.mark.asyncio
async def test_csv_export(ctx):
    d, client, form = ctx
    r = await client.get(f"/api/forms/{form['form_id']}/export.csv")
    assert r.status_code == 200
    assert "text/csv" in r.headers["content-type"]
    rows = list(csv.reader(io.StringIO(r.text)))
    assert rows[0][:2] == ["Submitted At", "Name"]
    assert "Asha Verma" in rows[1]


@pytest.mark.asyncio
async def test_xlsx_export(ctx):
    d, client, form = ctx
    r = await client.get(f"/api/forms/{form['form_id']}/export.xlsx")
    assert r.status_code == 200
    from openpyxl import load_workbook
    wb = load_workbook(io.BytesIO(r.content), read_only=True)
    ws = wb.active
    data = [[c.value for c in row] for row in ws.iter_rows()]
    assert data[0][1] == "Name" and "Asha Verma" in data[1]
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /f/ss-work/backend && DB_NAME=smartshape_test python -m pytest tests/test_forms_export.py -v`
Expected: FAIL — 404 on `/responses` and `/export.*`.

- [ ] **Step 3: Append to `backend/routes/form_routes.py`**

```python
# ── Responses + export ────────────────────────────────────────────────────────

@router.get("/forms/{form_id}/responses")
async def list_responses(form_id: str, request: Request):
    user = await get_current_user(request)
    form = await _get_form_or_404(form_id)
    if not _can_manage(user, form):
        raise HTTPException(403, "Not your form")
    rows = await db.form_responses.find({"form_id": form_id}, {"_id": 0}) \
        .sort("submitted_at", -1).to_list(5000)
    return {"form": form, "responses": rows, "count": len(rows)}


def _export_rows(form: dict, rows: list) -> list:
    fields = form.get("fields", [])
    out = [["Submitted At"] + [f["label"] for f in fields] +
           ["Email Status", "WhatsApp Status"]]
    for r in reversed(rows):        # oldest first in exports
        ans = r.get("answers") or {}
        vals = []
        for f in fields:
            v = ans.get(f["field_id"], "")
            vals.append(", ".join(v) if isinstance(v, list) else v)
        d = r.get("delivery") or {}
        out.append([r.get("submitted_at", "")] + vals +
                   [d.get("email", ""), d.get("whatsapp", "")])
    return out


@router.get("/forms/{form_id}/export.csv")
async def export_csv(form_id: str, request: Request):
    import csv as _csv, io as _io
    from fastapi.responses import StreamingResponse
    user = await get_current_user(request)
    form = await _get_form_or_404(form_id)
    if not _can_manage(user, form):
        raise HTTPException(403, "Not your form")
    rows = await db.form_responses.find({"form_id": form_id}, {"_id": 0}) \
        .sort("submitted_at", -1).to_list(5000)
    buf = _io.StringIO()
    w = _csv.writer(buf)
    for line in _export_rows(form, rows):
        w.writerow(line)
    buf.seek(0)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition":
                                      f'attachment; filename="{form_id}_responses.csv"'})


@router.get("/forms/{form_id}/export.xlsx")
async def export_xlsx(form_id: str, request: Request):
    import io as _io
    from fastapi.responses import StreamingResponse
    from openpyxl import Workbook
    user = await get_current_user(request)
    form = await _get_form_or_404(form_id)
    if not _can_manage(user, form):
        raise HTTPException(403, "Not your form")
    rows = await db.form_responses.find({"form_id": form_id}, {"_id": 0}) \
        .sort("submitted_at", -1).to_list(5000)
    wb = Workbook()
    ws = wb.active
    ws.title = "Responses"
    for line in _export_rows(form, rows):
        ws.append(line)
    buf = _io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition":
                 f'attachment; filename="{form_id}_responses.xlsx"'})
```

ROUTE-ORDER NOTE: FastAPI matches in registration order; `/forms/public/{token}` (Task 2) is registered before `/forms/{form_id}` (Task 1) only if the file keeps public routes ABOVE... it does not — Task 1's `GET /forms/{form_id}` was registered FIRST, so a request to `/api/forms/public/<tok>` would match `form_id="public"`? No: `/forms/public/{token}` has 3 path segments vs 2 — no collision. `/forms/{form_id}/responses` vs `/forms/public/{token}` are distinct shapes too. No action needed; this note exists so nobody "fixes" it.

- [ ] **Step 4: Run tests**

Run: `cd /f/ss-work/backend && DB_NAME=smartshape_test python -m pytest tests/test_forms_export.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
cd /f/ss-work && git add backend/routes/form_routes.py backend/tests/test_forms_export.py && git commit -m "feat(forms): responses listing + CSV/XLSX export"
```

---

### Task 7: wire-up — router mount, indexes, RBAC defaults

**Files:**
- Modify: `backend/main.py` (~line 60s import block + line ~120 router registration)
- Modify: `backend/database.py` (~line 64, after the contacts indexes)
- Modify: `backend/rbac.py:105-125` (`ROLE_DEFAULT_PERMISSIONS`)

**Interfaces:**
- Produces: `/api/forms/*` live in the app; `forms`/`form_responses` indexes; every role's default grants include `forms: read_write`.

- [ ] **Step 1: Mount the router** — in `backend/main.py`, find the import block where other routers are imported (grep `from routes.training_routes`), add alongside:

```python
from routes.form_routes import router as form_router
```

and after line ~120 (`app.include_router(telephony_router, prefix="/api")`):

```python
app.include_router(form_router, prefix="/api")
```

- [ ] **Step 2: Indexes** — in `backend/database.py`, after the contacts index lines (~line 63), add:

```python
    # ── Forms builder ────────────────────────────────────────────────────────
    await _i(db.forms.create_index("form_id", unique=True))
    await _i(db.forms.create_index("public_token", unique=True))
    await _i(db.form_responses.create_index("response_id", unique=True))
    await _i(db.form_responses.create_index(
        [("form_id", 1), ("submitted_at", -1)], background=True))
```

- [ ] **Step 3: RBAC defaults** — in `backend/rbac.py`, add `"forms": _RW,` to EACH of the three dicts in `ROLE_DEFAULT_PERMISSIONS` (`accounts`, `store`, `sales_person`) so every user can create/manage forms per the owner's decision ("anyone has right to create form"). Example for `sales_person`:

```python
    "sales_person": {
        "dashboard": _R, "quotations": _RW, "leads": _RW, "field_sales": _RW,
        "sales_portal": _RW, "leave_management": _RW, "analytics": _R,
        "delegation": _RW, "forms": _RW,
    },
```

(Apply the same `"forms": _RW,` addition to the `accounts` and `store` dicts.)

- [ ] **Step 4: Smoke-import** — verify the app still imports cleanly WITHOUT starting it against prod:

Run: `cd /f/ss-work/backend && python -c "import ast; ast.parse(open('main.py').read()); ast.parse(open('routes/form_routes.py').read()); ast.parse(open('database.py').read()); ast.parse(open('rbac.py').read()); print('syntax ok')"`
Expected: `syntax ok`. (Do NOT `import main` — it would run startup against the prod DB config.)

Then run the full new suite + existing RBAC tests:
Run: `cd /f/ss-work/backend && DB_NAME=smartshape_test python -m pytest tests/test_forms_crud.py tests/test_forms_public.py tests/test_form_crm.py tests/test_forms_confirm.py tests/test_forms_reminders.py tests/test_forms_export.py tests/test_rbac_module.py tests/test_webinar_loop.py -v`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
cd /f/ss-work && git add backend/main.py backend/database.py backend/rbac.py && git commit -m "feat(forms): mount router, indexes, forms module in role defaults"
```

---

### Task 8: frontend wiring — api group, routes, sidebar, FormsList page

**Files:**
- Modify: `frontend/src/lib/api.js` (append near the other export groups; `adminMeetings` is a good neighbor)
- Modify: `frontend/src/App.js` (lazy imports ~lines 19-93; routes ~lines 166-243)
- Modify: `frontend/src/components/layouts/AdminNavItems.js:14-89`
- Create: `frontend/src/pages/admin/FormsList.js`

**Interfaces:**
- Consumes: backend routes from Tasks 1-6; `AdminLayout`, `ui/button`, `ui/input`, `sonner` toast (idioms per `pages/admin/MeetingsAdmin.js`).
- Produces: `forms` + `publicForms` api groups; routes `/forms`, `/forms/:formId`, `/forms/:formId/responses` (protected) and `/f/:token` (public — component built in Task 11, route registered here with a placeholder-free lazy import, so Task 11's file must exist before `npm run build`; within THIS task verify with the dev-server compile only after Task 11, or temporarily verify via `node --check` transpile is skipped — simplest: register the `/f/:token` route in Task 11 instead. THIS task registers only the three protected routes.)

- [ ] **Step 1: Install the QR dependency**

```bash
cd /f/ss-work/frontend && npm install qrcode.react@^4.2.0
```

- [ ] **Step 2: Append api groups to `frontend/src/lib/api.js`** (before `export default API;` at the file end; note `axios` and `BACKEND_URL` already exist at the top of the file):

```javascript
// ── Forms builder ───────────────────────────────────────────────────────────
export const forms = {
  list: () => API.get('/forms'),
  create: (data) => API.post('/forms', data),
  get: (id) => API.get(`/forms/${id}`),
  update: (id, data) => API.put(`/forms/${id}`, data),
  remove: (id) => API.delete(`/forms/${id}`),
  setStatus: (id, status) => API.post(`/forms/${id}/status`, { status }),
  responses: (id) => API.get(`/forms/${id}/responses`),
  remind: (id) => API.post(`/forms/${id}/remind`),
  exportUrl: (id, fmt) => `${BACKEND_URL}/api/forms/${id}/export.${fmt}`,
};

// Public registration page — plain axios, no credentials (catalogue pattern)
export const publicForms = {
  get: (token) => axios.get(`${BACKEND_URL}/api/forms/public/${token}`),
  submit: (token, payload) => axios.post(`${BACKEND_URL}/api/forms/public/${token}/submit`, payload),
};
```

- [ ] **Step 3: Create `frontend/src/pages/admin/FormsList.js`**

```javascript
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminLayout from '../../components/layouts/AdminLayout';
import { forms as formsApi } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { toast } from 'sonner';
import { FormInput, Plus, CalendarClock, Users, Link2 } from 'lucide-react';

export default function FormsList() {
  const nav = useNavigate();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);

  const textPri = 'text-[var(--text-primary)]', textSec = 'text-[var(--text-secondary)]';
  const card = 'bg-[var(--bg-card)] border-[var(--border-color)]';

  const load = () => formsApi.list()
    .then(r => setList(Array.isArray(r.data) ? r.data : []))
    .catch(() => toast.error('Could not load forms'))
    .finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const createForm = async (type) => {
    try {
      const r = await formsApi.create(
        type === 'event'
          ? { title: 'New Event Registration', type: 'event', event: { platform: 'zoom' } }
          : { title: 'New Form', type: 'general' });
      nav(`/forms/${r.data.form_id}`);
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed to create'); }
  };

  return (
    <AdminLayout>
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className={`text-2xl font-semibold ${textPri} flex items-center gap-2`}>
              <FormInput className="h-6 w-6" /> Forms
            </h1>
            <p className={`text-sm ${textSec} mt-1`}>
              Build registration forms, share a public link, and track responses.
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => createForm('event')}>
              <CalendarClock className="h-4 w-4 mr-1" /> New Event Registration
            </Button>
            <Button variant="outline" onClick={() => createForm('general')}>
              <Plus className="h-4 w-4 mr-1" /> New Form
            </Button>
          </div>
        </div>

        <div className={`${card} border rounded-md overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead>
              <tr className={`${textSec} text-left border-b border-[var(--border-color)]`}>
                <th className="p-3">Form</th><th className="p-3">Type</th>
                <th className="p-3">Event date</th><th className="p-3">Status</th>
                <th className="p-3">Responses</th><th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {(list || []).map(f => (
                <tr key={f.form_id}
                    className={`border-b border-[var(--border-color)] hover:bg-[var(--bg-primary)] cursor-pointer`}
                    onClick={() => nav(`/forms/${f.form_id}`)}>
                  <td className={`p-3 font-medium ${textPri}`}>{f.title}</td>
                  <td className={`p-3 ${textSec}`}>{f.type === 'event' ? 'Event' : 'General'}</td>
                  <td className={`p-3 ${textSec}`}>{f.event?.date || '—'}</td>
                  <td className="p-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      f.status === 'open' ? 'bg-green-500/15 text-green-500'
                                          : 'bg-gray-500/15 text-gray-400'}`}>
                      {f.status}
                    </span>
                  </td>
                  <td className={`p-3 ${textSec}`}>
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-3.5 w-3.5" /> {f.response_count ?? 0}
                    </span>
                  </td>
                  <td className="p-3" onClick={e => e.stopPropagation()}>
                    <Button size="sm" variant="ghost"
                            onClick={() => nav(`/forms/${f.form_id}/responses`)}>
                      <Link2 className="h-4 w-4 mr-1" /> Responses
                    </Button>
                  </td>
                </tr>
              ))}
              {!loading && list.length === 0 && (
                <tr><td colSpan={6} className={`p-8 text-center ${textSec}`}>
                  No forms yet — create your first Event Registration.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AdminLayout>
  );
}
```

- [ ] **Step 4: Register routes** — in `frontend/src/App.js`:

Lazy imports (with the other `pages/admin` lazy imports):

```javascript
const FormsList = lazy(() => import('./pages/admin/FormsList'));
const FormBuilder = lazy(() => import('./pages/admin/FormBuilder'));
const FormResponses = lazy(() => import('./pages/admin/FormResponses'));
```

Protected routes (next to the other ProtectedRoute entries — match the exact wrapper style used by neighbors, e.g. how `/meetings-admin` is declared):

```javascript
<Route path="/forms" element={<ProtectedRoute><FormsList /></ProtectedRoute>} />
<Route path="/forms/:formId" element={<ProtectedRoute><FormBuilder /></ProtectedRoute>} />
<Route path="/forms/:formId/responses" element={<ProtectedRoute><FormResponses /></ProtectedRoute>} />
```

NOTE: `FormBuilder`/`FormResponses` files are created in Tasks 9-10 — CRA lazy imports of missing files fail at BUILD time only; create minimal stub files now so the app compiles between tasks:

```javascript
// frontend/src/pages/admin/FormBuilder.js  (replaced in Task 9)
import React from 'react';
export default function FormBuilder() { return null; }
```

```javascript
// frontend/src/pages/admin/FormResponses.js  (replaced in Task 10)
import React from 'react';
export default function FormResponses() { return null; }
```

- [ ] **Step 5: Sidebar + page title** — in `frontend/src/components/layouts/AdminNavItems.js`:
  - Add `FormInput` to the lucide-react import at the top.
  - Add to `MODULE_ROUTE_MAP` (after `certificates:` line 62): `forms: { path: '/forms', icon: FormInput, label: 'Forms' },`
  - In `SIDEBAR_SECTIONS` line 87 change to: `{ label: 'School Engagement',  modules: ['school_portal', 'certificates', 'forms'] },`
  - In `getPageTitle` add (with the other `startsWith` cases): `if (pathname.startsWith('/forms')) return 'Forms';`

- [ ] **Step 6: Module grant surfaces** — the User Management grant editor enumerates module keys. Find where and add `forms`:

```bash
cd /f/ss-work/frontend/src && grep -rn "certificates" --include=*.js pages/admin/UserManagement.js pages/admin/ModuleMaster.js components/ 2>/dev/null | grep -iv "cert_routes\|Certificates.js" | head -20
```

Wherever module keys are enumerated for granting (a constant array/object listing `certificates`, `school_portal`, …), add `forms` with label `Forms` following the exact same entry shape. If grants are DB-driven (no hardcoded list found), no frontend change is needed — the key flows from `rbac.py` defaults.

- [ ] **Step 7: Compile check**

```bash
cd /f/ss-work/frontend && DISABLE_ESLINT_PLUGIN=true NODE_OPTIONS=--max-old-space-size=4096 npm run build
```
Expected: `Compiled successfully` (warnings ok). Do NOT commit `build/`.

- [ ] **Step 8: Commit**

```bash
cd /f/ss-work && git add frontend/src/lib/api.js frontend/src/App.js frontend/src/components/layouts/AdminNavItems.js frontend/src/pages/admin/FormsList.js frontend/src/pages/admin/FormBuilder.js frontend/src/pages/admin/FormResponses.js frontend/package.json frontend/package-lock.json && git commit -m "feat(forms): FormsList page, routes, sidebar module, api group"
```
(If Step 6 touched a grant-editor file, `git add` it too.)

---

### Task 9: FormBuilder page (fields editor + messages + collaborators + share/QR)

**Files:**
- Replace stub: `frontend/src/pages/admin/FormBuilder.js`

**Interfaces:**
- Consumes: `forms` api group (Task 8), `qrcode.react` (`QRCodeCanvas`), `useAuth`-less (no special auth logic — backend enforces).
- Produces: the builder UI. Field object shape must match backend `_clean_fields`: `{field_id, label, type, required, choices[], map_to}`.

- [ ] **Step 1: Replace `frontend/src/pages/admin/FormBuilder.js` with the full component**

```javascript
import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import AdminLayout from '../../components/layouts/AdminLayout';
import { forms as formsApi } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { toast } from 'sonner';
import { QRCodeCanvas } from 'qrcode.react';
import {
  ArrowLeft, ArrowUp, ArrowDown, Trash2, Plus, Copy, Download,
  MessageCircle, Users, Save, Send, ExternalLink,
} from 'lucide-react';

const FIELD_TYPES = [
  ['text', 'Short text'], ['textarea', 'Long text'], ['dropdown', 'Dropdown'],
  ['multiple_choice', 'Multiple choice'], ['checkbox', 'Checkboxes'],
  ['number', 'Number'], ['date', 'Date'],
];
const MAP_OPTIONS = [
  ['', '— not mapped —'], ['name', 'Name'], ['email', 'Email'], ['phone', 'Phone'],
  ['school', 'School'], ['designation', 'Designation'], ['city', 'City'],
];

export default function FormBuilder() {
  const { formId } = useParams();
  const nav = useNavigate();
  const [form, setForm] = useState(null);
  const [tab, setTab] = useState('fields'); // fields | messages | share
  const [saving, setSaving] = useState(false);
  const [newCollab, setNewCollab] = useState('');
  const qrRef = useRef(null);

  const textPri = 'text-[var(--text-primary)]', textSec = 'text-[var(--text-secondary)]',
        textMuted = 'text-[var(--text-muted)]';
  const card = 'bg-[var(--bg-card)] border-[var(--border-color)]';
  const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';

  useEffect(() => {
    formsApi.get(formId).then(r => setForm(r.data))
      .catch(() => { toast.error('Form not found'); nav('/forms'); });
  }, [formId, nav]);

  if (!form) return <AdminLayout><div className="p-8" /></AdminLayout>;

  const publicUrl = `${window.location.origin}/f/${form.public_token}`;
  const isEvent = form.type === 'event';
  const set = (patch) => setForm({ ...form, ...patch });
  const setEvent = (patch) => set({ event: { ...(form.event || {}), ...patch } });
  const setMsg = (patch) => set({ messages: { ...(form.messages || {}), ...patch } });

  const save = async () => {
    setSaving(true);
    try {
      const r = await formsApi.update(form.form_id, {
        title: form.title, description: form.description,
        fields: form.fields, collaborators: form.collaborators,
        messages: form.messages,
        ...(isEvent ? { event: form.event } : {}),
      });
      setForm(r.data);
      toast.success('Saved');
    } catch (e) { toast.error(e.response?.data?.detail || 'Save failed'); }
    finally { setSaving(false); }
  };

  const setField = (i, patch) => {
    const fields = form.fields.slice();
    fields[i] = { ...fields[i], ...patch };
    set({ fields });
  };
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= form.fields.length) return;
    const fields = form.fields.slice();
    [fields[i], fields[j]] = [fields[j], fields[i]];
    set({ fields });
  };
  const addField = () => set({
    fields: [...form.fields, { field_id: `new_${Date.now()}`, label: 'New question',
                               type: 'text', required: false, choices: [], map_to: null }],
  });
  const removeField = (i) => set({ fields: form.fields.filter((_, k) => k !== i) });

  const copyLink = () => { navigator.clipboard.writeText(publicUrl); toast.success('Link copied'); };
  const downloadQR = () => {
    const canvas = qrRef.current?.querySelector('canvas');
    if (!canvas) return;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `${form.title.replace(/\W+/g, '_')}_QR.png`;
    a.click();
  };
  const waShare = () => {
    const ev = form.event || {};
    const text = isEvent
      ? `📢 *${form.title}*\n${ev.theme ? `Theme: ${ev.theme}\n` : ''}` +
        `${ev.date ? `Date: ${ev.date}\n` : ''}${ev.time ? `Time: ${ev.time}\n` : ''}` +
        `\nRegister here:\n${publicUrl}`
      : `Please fill this form: *${form.title}*\n${publicUrl}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };
  const sendReminder = async () => {
    try {
      const r = await formsApi.remind(form.form_id);
      toast.success(`Reminder queued — ${r.data.emails} emails, ${r.data.whatsapp} WhatsApp`);
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
  };
  const toggleStatus = async () => {
    const next = form.status === 'open' ? 'closed' : 'open';
    try { await formsApi.setStatus(form.form_id, next); set({ status: next }); }
    catch { toast.error('Failed'); }
  };

  return (
    <AdminLayout>
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => nav('/forms')}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Input value={form.title} onChange={e => set({ title: e.target.value })}
                   className={`${inputCls} text-lg font-semibold w-[340px]`} />
            <span className={`text-xs px-2 py-0.5 rounded-full ${
              form.status === 'open' ? 'bg-green-500/15 text-green-500'
                                     : 'bg-gray-500/15 text-gray-400'}`}>
              {form.status}
            </span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={toggleStatus}>
              {form.status === 'open' ? 'Close form' : 'Reopen form'}
            </Button>
            {isEvent && (
              <Button variant="outline" size="sm" onClick={sendReminder}>
                <Send className="h-4 w-4 mr-1" /> Send reminder now
              </Button>
            )}
            <Button variant="outline" size="sm"
                    onClick={() => nav(`/forms/${form.form_id}/responses`)}>
              Responses
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              <Save className="h-4 w-4 mr-1" /> {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>

        <div className="flex gap-2 border-b border-[var(--border-color)]">
          {[['fields', 'Fields'], ['messages', 'Messages'], ['share', 'Share']].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
                    className={`px-4 py-2 text-sm ${tab === k
                      ? `${textPri} border-b-2 border-[#e94560] font-medium`
                      : textSec}`}>
              {l}
            </button>
          ))}
        </div>

        {tab === 'fields' && (
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-3">
              {isEvent && (
                <div className={`${card} border rounded-md p-4 space-y-2`}>
                  <h3 className={`text-sm font-medium ${textPri}`}>Event details</h3>
                  <Input placeholder="Theme (e.g. Patriotism Through Creativity)"
                         value={form.event?.theme || ''}
                         onChange={e => setEvent({ theme: e.target.value })} className={inputCls} />
                  <div className="grid grid-cols-3 gap-2">
                    <div><Label className={`text-xs ${textMuted}`}>Date</Label>
                      <Input type="date" value={form.event?.date || ''}
                             onChange={e => setEvent({ date: e.target.value })} className={inputCls} /></div>
                    <div><Label className={`text-xs ${textMuted}`}>Time (IST)</Label>
                      <Input type="time" value={form.event?.time || ''}
                             onChange={e => setEvent({ time: e.target.value })} className={inputCls} /></div>
                    <div><Label className={`text-xs ${textMuted}`}>Duration (min)</Label>
                      <Input type="number" value={form.event?.duration_min || 60}
                             onChange={e => setEvent({ duration_min: e.target.value })} className={inputCls} /></div>
                  </div>
                  <Input placeholder="Zoom link (paste from your Zoom account)"
                         value={form.event?.meeting_link || ''}
                         onChange={e => setEvent({ meeting_link: e.target.value })} className={inputCls} />
                </div>
              )}

              <div className={`${card} border rounded-md p-4 space-y-3`}>
                <div className="flex items-center justify-between">
                  <h3 className={`text-sm font-medium ${textPri}`}>Questions</h3>
                  <Button size="sm" variant="outline" onClick={addField}>
                    <Plus className="h-4 w-4 mr-1" /> Add question
                  </Button>
                </div>
                {form.fields.map((f, i) => (
                  <div key={f.field_id} className="border border-[var(--border-color)] rounded-md p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <Input value={f.label} onChange={e => setField(i, { label: e.target.value })}
                             className={`${inputCls} flex-1`} />
                      <Button size="sm" variant="ghost" onClick={() => move(i, -1)}><ArrowUp className="h-4 w-4" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => move(i, 1)}><ArrowDown className="h-4 w-4" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => removeField(i)}><Trash2 className="h-4 w-4 text-red-400" /></Button>
                    </div>
                    <div className="grid grid-cols-3 gap-2 items-center">
                      <select value={f.type} onChange={e => setField(i, { type: e.target.value })}
                              className={`h-9 px-2 rounded-md text-sm ${inputCls}`}>
                        {FIELD_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                      <select value={f.map_to || ''} onChange={e => setField(i, { map_to: e.target.value || null })}
                              className={`h-9 px-2 rounded-md text-sm ${inputCls}`}>
                        {MAP_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                      <label className={`flex items-center gap-1 text-sm ${textSec}`}>
                        <input type="checkbox" checked={!!f.required}
                               onChange={e => setField(i, { required: e.target.checked })} /> Required
                      </label>
                    </div>
                    {['dropdown', 'multiple_choice', 'checkbox'].includes(f.type) && (
                      <Input placeholder="Choices, comma-separated"
                             value={(f.choices || []).join(', ')}
                             onChange={e => setField(i, { choices: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                             className={inputCls} />
                    )}
                  </div>
                ))}
              </div>

              <div className={`${card} border rounded-md p-4 space-y-2`}>
                <h3 className={`text-sm font-medium ${textPri} flex items-center gap-2`}>
                  <Users className="h-4 w-4" /> Collaborators
                </h3>
                <p className={`text-xs ${textMuted}`}>Teammates who can edit this form and see responses.</p>
                {(form.collaborators || []).map(c => (
                  <div key={c} className={`flex items-center justify-between text-sm ${textSec}`}>
                    {c}
                    <Button size="sm" variant="ghost"
                            onClick={() => set({ collaborators: form.collaborators.filter(x => x !== c) })}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
                <div className="flex gap-2">
                  <Input placeholder="teammate@smartshape.in" value={newCollab}
                         onChange={e => setNewCollab(e.target.value)} className={inputCls} />
                  <Button size="sm" variant="outline" onClick={() => {
                    if (!newCollab.includes('@')) return toast.error('Enter an email');
                    set({ collaborators: [...(form.collaborators || []), newCollab.toLowerCase().trim()] });
                    setNewCollab('');
                  }}>Add</Button>
                </div>
              </div>
            </div>

            {/* Live mobile-width preview */}
            <div>
              <p className={`text-xs ${textMuted} mb-2`}>Preview (as teachers see it)</p>
              <div className="mx-auto w-[360px] border border-[var(--border-color)] rounded-xl p-4 bg-white text-gray-900 space-y-3">
                <div className="text-center">
                  <div className="text-lg font-bold">{form.title}</div>
                  {isEvent && (
                    <div className="text-xs text-gray-600 mt-1">
                      {form.event?.theme && <div>Theme: {form.event.theme}</div>}
                      <div>{form.event?.date} {form.event?.time && `· ${form.event.time}`}</div>
                    </div>
                  )}
                </div>
                {form.fields.map(f => (
                  <div key={f.field_id}>
                    <div className="text-sm font-medium">
                      {f.label}{f.required && <span className="text-red-500"> *</span>}
                    </div>
                    {['dropdown'].includes(f.type)
                      ? <select className="w-full border rounded p-1.5 text-sm mt-1" disabled>
                          <option>{(f.choices || [])[0] || 'Select…'}</option>
                        </select>
                      : ['multiple_choice', 'checkbox'].includes(f.type)
                      ? <div className="mt-1 space-y-1">{(f.choices || []).map(c => (
                          <label key={c} className="flex items-center gap-2 text-sm">
                            <input type={f.type === 'checkbox' ? 'checkbox' : 'radio'} disabled /> {c}
                          </label>))}</div>
                      : <input className="w-full border rounded p-1.5 text-sm mt-1" disabled
                               placeholder={f.type === 'textarea' ? 'Long answer' : 'Answer'} />}
                  </div>
                ))}
                <button className="w-full bg-[#e94560] text-white rounded-md py-2 text-sm font-semibold" disabled>
                  Register
                </button>
              </div>
            </div>
          </div>
        )}

        {tab === 'messages' && (
          <div className={`${card} border rounded-md p-4 space-y-4 max-w-2xl`}>
            <p className={`text-xs ${textMuted}`}>
              Placeholders: {'{name} {school_name} {title} {theme} {date} {time} {zoom_link} {calendar_link}'}
            </p>
            <div>
              <Label className={`text-xs ${textMuted}`}>WhatsApp confirmation (sent instantly on registration)</Label>
              <textarea rows={7} value={form.messages?.wa_confirm || ''}
                        onChange={e => setMsg({ wa_confirm: e.target.value })}
                        className={`w-full rounded-md p-2 text-sm ${inputCls}`} />
            </div>
            <div>
              <Label className={`text-xs ${textMuted}`}>WhatsApp reminder (24h & 1h before + manual)</Label>
              <textarea rows={6} value={form.messages?.wa_reminder || ''}
                        onChange={e => setMsg({ wa_reminder: e.target.value })}
                        className={`w-full rounded-md p-2 text-sm ${inputCls}`} />
            </div>
            <div>
              <Label className={`text-xs ${textMuted}`}>
                Custom confirmation email (optional — leave blank to use the standard branded email with Zoom link + calendar button)
              </Label>
              <Input placeholder="Email subject" value={form.messages?.email_subject || ''}
                     onChange={e => setMsg({ email_subject: e.target.value })} className={inputCls} />
              <textarea rows={8} placeholder="Email HTML body" value={form.messages?.email_html || ''}
                        onChange={e => setMsg({ email_html: e.target.value })}
                        className={`w-full rounded-md p-2 text-sm mt-2 font-mono ${inputCls}`} />
            </div>
          </div>
        )}

        {tab === 'share' && (
          <div className={`${card} border rounded-md p-6 max-w-2xl space-y-5`}>
            <div>
              <Label className={`text-xs ${textMuted}`}>Public registration link</Label>
              <div className="flex gap-2 mt-1">
                <Input readOnly value={publicUrl} className={`${inputCls} flex-1`} />
                <Button variant="outline" onClick={copyLink}><Copy className="h-4 w-4 mr-1" /> Copy</Button>
                <Button variant="outline" onClick={() => window.open(publicUrl, '_blank')}>
                  <ExternalLink className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-6">
              <div ref={qrRef} className="bg-white p-3 rounded-md">
                <QRCodeCanvas value={publicUrl} size={160} />
              </div>
              <div className="space-y-2">
                <Button variant="outline" onClick={downloadQR}>
                  <Download className="h-4 w-4 mr-1" /> Download QR
                </Button>
                <Button className="bg-[#25D366] hover:bg-[#1ebe5b] text-white block" onClick={waShare}>
                  <MessageCircle className="h-4 w-4 mr-1" /> Share on WhatsApp
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
```

- [ ] **Step 2: Compile check**

```bash
cd /f/ss-work/frontend && DISABLE_ESLINT_PLUGIN=true NODE_OPTIONS=--max-old-space-size=4096 npm run build
```
Expected: `Compiled successfully`.

- [ ] **Step 3: Commit**

```bash
cd /f/ss-work && git add frontend/src/pages/admin/FormBuilder.js && git commit -m "feat(forms): FormBuilder page - fields editor, messages, collaborators, share/QR"
```

---

### Task 10: FormResponses page

**Files:**
- Replace stub: `frontend/src/pages/admin/FormResponses.js`

**Interfaces:**
- Consumes: `forms.responses(id)` → `{form, responses, count}`; `forms.exportUrl(id, fmt)`; `forms.remind(id)`.

- [ ] **Step 1: Replace `frontend/src/pages/admin/FormResponses.js`**

```javascript
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import AdminLayout from '../../components/layouts/AdminLayout';
import { forms as formsApi } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { toast } from 'sonner';
import { ArrowLeft, Download, Send, CheckCircle2, XCircle, MinusCircle } from 'lucide-react';

const Tick = ({ v }) => v === 'queued' || v === 'sent'
  ? <CheckCircle2 className="h-4 w-4 text-green-500 inline" />
  : v === 'failed'
  ? <XCircle className="h-4 w-4 text-red-500 inline" />
  : <MinusCircle className="h-4 w-4 text-gray-500 inline" />;

export default function FormResponses() {
  const { formId } = useParams();
  const nav = useNavigate();
  const [data, setData] = useState(null);

  const textPri = 'text-[var(--text-primary)]', textSec = 'text-[var(--text-secondary)]';
  const card = 'bg-[var(--bg-card)] border-[var(--border-color)]';

  useEffect(() => {
    formsApi.responses(formId).then(r => setData(r.data))
      .catch(() => { toast.error('Could not load responses'); nav('/forms'); });
  }, [formId, nav]);

  if (!data) return <AdminLayout><div className="p-8" /></AdminLayout>;
  const { form, responses, count } = data;

  const sendReminder = async () => {
    try {
      const r = await formsApi.remind(formId);
      toast.success(`Reminder queued — ${r.data.emails} emails, ${r.data.whatsapp} WhatsApp`);
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed'); }
  };

  return (
    <AdminLayout>
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => nav(`/forms/${formId}`)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className={`text-xl font-semibold ${textPri}`}>{form.title}</h1>
              <p className={`text-sm ${textSec}`}>{count} registration{count === 1 ? '' : 's'}</p>
            </div>
          </div>
          <div className="flex gap-2">
            {form.type === 'event' && (
              <Button variant="outline" size="sm" onClick={sendReminder}>
                <Send className="h-4 w-4 mr-1" /> Send reminder now
              </Button>
            )}
            <Button variant="outline" size="sm"
                    onClick={() => window.open(formsApi.exportUrl(formId, 'xlsx'), '_blank')}>
              <Download className="h-4 w-4 mr-1" /> Excel
            </Button>
            <Button variant="outline" size="sm"
                    onClick={() => window.open(formsApi.exportUrl(formId, 'csv'), '_blank')}>
              <Download className="h-4 w-4 mr-1" /> CSV
            </Button>
          </div>
        </div>

        <div className={`${card} border rounded-md overflow-x-auto`}>
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className={`${textSec} text-left border-b border-[var(--border-color)]`}>
                <th className="p-3">Submitted</th>
                {form.fields.map(f => <th key={f.field_id} className="p-3">{f.label}</th>)}
                <th className="p-3">Email</th><th className="p-3">WhatsApp</th>
              </tr>
            </thead>
            <tbody>
              {(responses || []).map(r => (
                <tr key={r.response_id} className="border-b border-[var(--border-color)]">
                  <td className={`p-3 ${textSec}`}>
                    {(r.submitted_at || '').slice(0, 16).replace('T', ' ')}
                  </td>
                  {form.fields.map(f => {
                    const v = (r.answers || {})[f.field_id];
                    return <td key={f.field_id} className={`p-3 ${textPri}`}>
                      {Array.isArray(v) ? v.join(', ') : (v || '—')}
                    </td>;
                  })}
                  <td className="p-3"><Tick v={r.delivery?.email} /></td>
                  <td className="p-3"><Tick v={r.delivery?.whatsapp} /></td>
                </tr>
              ))}
              {responses.length === 0 && (
                <tr><td colSpan={form.fields.length + 3} className={`p-8 text-center ${textSec}`}>
                  No registrations yet — share the form link.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AdminLayout>
  );
}
```

- [ ] **Step 2: Compile check** — same `npm run build` command as Task 9 Step 2. Expected: `Compiled successfully`.

- [ ] **Step 3: Commit**

```bash
cd /f/ss-work && git add frontend/src/pages/admin/FormResponses.js && git commit -m "feat(forms): responses table with delivery ticks + export buttons"
```

---

### Task 11: public registration page `/f/:token`

**Files:**
- Create: `frontend/src/pages/PublicForm.js`
- Modify: `frontend/src/App.js` (public route + lazy import)

**Interfaces:**
- Consumes: `publicForms.get(token)` / `publicForms.submit(token, {answers, website})` (Task 8). Backend 422 detail shape: `{field_errors: {field_id: message}}`; 429/410 with string detail.
- Produces: mobile-first teacher-facing page. This is the brand surface — styling is self-contained (no AdminLayout), light theme, works on a 360px phone.

- [ ] **Step 1: Create `frontend/src/pages/PublicForm.js`**

```javascript
import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { publicForms } from '../lib/api';

const ACCENT = '#e94560';

export default function PublicForm() {
  const { token } = useParams();
  const [form, setForm] = useState(null);
  const [state, setState] = useState('loading'); // loading|open|closed|missing|done
  const [answers, setAnswers] = useState({});
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [thanks, setThanks] = useState(null);
  const [hp, setHp] = useState(''); // honeypot

  useEffect(() => {
    publicForms.get(token)
      .then(r => {
        if (r.data.status === 'closed') { setForm(r.data); setState('closed'); }
        else { setForm(r.data); setState('open'); }
      })
      .catch(() => setState('missing'));
  }, [token]);

  const setAns = (fid, v) => { setAnswers(a => ({ ...a, [fid]: v })); setErrors(e => ({ ...e, [fid]: null })); };
  const toggleCheck = (fid, choice) => {
    const cur = Array.isArray(answers[fid]) ? answers[fid] : [];
    setAns(fid, cur.includes(choice) ? cur.filter(c => c !== choice) : [...cur, choice]);
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      const r = await publicForms.submit(token, { answers, website: hp });
      setThanks(r.data.thank_you || {});
      setState('done');
      window.scrollTo(0, 0);
    } catch (e) {
      const detail = e.response?.data?.detail;
      if (e.response?.status === 422 && detail?.field_errors) {
        setErrors(detail.field_errors);
      } else if (e.response?.status === 429) {
        alert('Too many attempts — please try again in a few minutes.');
      } else if (e.response?.status === 410) {
        setState('closed');
      } else {
        alert('Something went wrong — please try again.');
      }
    } finally { setSubmitting(false); }
  };

  const Shell = ({ children }) => (
    <div style={{ minHeight: '100vh', background: '#f4f6fb', fontFamily: 'Arial, Helvetica, sans-serif' }}>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '24px 16px' }}>
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <span style={{ fontWeight: 800, fontSize: 20, color: '#1a1a2e' }}>
            SMART<span style={{ color: ACCENT }}>SHAPE</span>
          </span>
        </div>
        {children}
        <p style={{ textAlign: 'center', color: '#9aa3b2', fontSize: 12, marginTop: 20 }}>
          Powered by SmartShape Pro
        </p>
      </div>
    </div>
  );
  const Card = ({ children }) => (
    <div style={{ background: '#fff', borderRadius: 14, padding: 22,
                  boxShadow: '0 4px 18px rgba(26,26,46,.08)' }}>{children}</div>
  );

  if (state === 'loading') return <Shell><Card><p style={{ color: '#667' }}>Loading…</p></Card></Shell>;
  if (state === 'missing') return <Shell><Card>
    <h2 style={{ margin: 0 }}>Form not found</h2>
    <p style={{ color: '#667' }}>This link is invalid or has been removed.</p>
  </Card></Shell>;
  if (state === 'closed') return <Shell><Card>
    <h2 style={{ margin: 0 }}>{form?.title || 'Registrations closed'}</h2>
    <p style={{ color: '#667' }}>Registrations for this session are closed. Thank you for your interest!</p>
  </Card></Shell>;

  if (state === 'done') return <Shell><Card>
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 44 }}>🎉</div>
      <h2 style={{ color: ACCENT, margin: '8px 0' }}>Registration Confirmed</h2>
      <p style={{ color: '#444' }}>{thanks?.message}</p>
      {thanks?.date && <p style={{ color: '#444', fontWeight: 600 }}>
        {thanks.date}{thanks.time ? ` · ${thanks.time}` : ''}</p>}
      {thanks?.zoom_link && (
        <a href={thanks.zoom_link} style={{ display: 'inline-block', background: ACCENT,
             color: '#fff', padding: '13px 26px', borderRadius: 8, textDecoration: 'none',
             fontWeight: 700, margin: '10px 0' }}>
          JOIN ZOOM MEETING
        </a>)}
      <br />
      {thanks?.calendar_link && (
        <a href={thanks.calendar_link} target="_blank" rel="noreferrer"
           style={{ display: 'inline-block', border: `2px solid ${ACCENT}`, color: ACCENT,
                    padding: '10px 22px', borderRadius: 8, textDecoration: 'none',
                    fontWeight: 700, marginTop: 6 }}>
          📅 Add to Google Calendar
        </a>)}
      <p style={{ color: '#889', fontSize: 13, marginTop: 14 }}>
        The joining details were also sent to your email & WhatsApp.
      </p>
    </div>
  </Card></Shell>;

  const ev = form.event || {};
  const inputStyle = (fid) => ({
    width: '100%', boxSizing: 'border-box', padding: '11px 12px', fontSize: 15,
    borderRadius: 8, border: `1.5px solid ${errors[fid] ? ACCENT : '#d6dbe6'}`,
    marginTop: 6, background: '#fff', color: '#1a1a2e',
  });

  return (
    <Shell>
      {form.banner_url && (
        <img src={form.banner_url} alt="" style={{ width: '100%', borderRadius: 14, marginBottom: 12 }} />
      )}
      <Card>
        <h1 style={{ fontSize: 22, margin: 0, color: '#1a1a2e' }}>{form.title}</h1>
        {form.description && <p style={{ color: '#556', fontSize: 14 }}>{form.description}</p>}
        {form.type === 'event' && (ev.theme || ev.date) && (
          <div style={{ background: '#f4f6fb', borderRadius: 10, padding: 12, margin: '12px 0',
                        fontSize: 14, color: '#334' }}>
            {ev.theme && <div><b>Theme:</b> {ev.theme}</div>}
            {ev.date && <div><b>Date:</b> {ev.date}</div>}
            {ev.time && <div><b>Time:</b> {ev.time} (IST)</div>}
            <div><b>Platform:</b> {ev.platform === 'zoom' ? 'Zoom (link shared after registration)' : ev.platform}</div>
          </div>
        )}

        {form.fields.map(f => (
          <div key={f.field_id} style={{ marginTop: 14 }}>
            <label style={{ fontWeight: 600, fontSize: 14, color: '#1a1a2e' }}>
              {f.label}{f.required && <span style={{ color: ACCENT }}> *</span>}
            </label>
            {f.type === 'dropdown' ? (
              <select value={answers[f.field_id] || ''} style={inputStyle(f.field_id)}
                      onChange={e => setAns(f.field_id, e.target.value)}>
                <option value="">Select…</option>
                {(f.choices || []).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            ) : f.type === 'multiple_choice' ? (
              <div style={{ marginTop: 6 }}>{(f.choices || []).map(c => (
                <label key={c} style={{ display: 'flex', gap: 8, alignItems: 'center',
                                        fontSize: 14, padding: '4px 0', color: '#334' }}>
                  <input type="radio" name={f.field_id} checked={answers[f.field_id] === c}
                         onChange={() => setAns(f.field_id, c)} /> {c}
                </label>))}</div>
            ) : f.type === 'checkbox' ? (
              <div style={{ marginTop: 6 }}>{(f.choices || []).map(c => (
                <label key={c} style={{ display: 'flex', gap: 8, alignItems: 'center',
                                        fontSize: 14, padding: '4px 0', color: '#334' }}>
                  <input type="checkbox"
                         checked={Array.isArray(answers[f.field_id]) && answers[f.field_id].includes(c)}
                         onChange={() => toggleCheck(f.field_id, c)} /> {c}
                </label>))}</div>
            ) : f.type === 'textarea' ? (
              <textarea rows={4} value={answers[f.field_id] || ''} style={inputStyle(f.field_id)}
                        onChange={e => setAns(f.field_id, e.target.value)} />
            ) : (
              <input type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                     value={answers[f.field_id] || ''} style={inputStyle(f.field_id)}
                     onChange={e => setAns(f.field_id, e.target.value)}
                     inputMode={f.map_to === 'phone' ? 'tel' : undefined} />
            )}
            {errors[f.field_id] && (
              <div style={{ color: ACCENT, fontSize: 12, marginTop: 4 }}>{errors[f.field_id]}</div>
            )}
          </div>
        ))}

        {/* Honeypot — visually hidden from humans, bots fill it */}
        <input type="text" value={hp} onChange={e => setHp(e.target.value)}
               autoComplete="off" tabIndex={-1} aria-hidden="true"
               style={{ position: 'absolute', left: '-5000px', height: 0, width: 0, opacity: 0 }}
               name="website" />

        <button onClick={submit} disabled={submitting}
                style={{ width: '100%', background: ACCENT, color: '#fff', border: 'none',
                         borderRadius: 10, padding: '14px 0', fontSize: 16, fontWeight: 700,
                         marginTop: 20, cursor: 'pointer', opacity: submitting ? .6 : 1 }}>
          {submitting ? 'Registering…' : 'Register'}
        </button>
      </Card>
    </Shell>
  );
}
```

- [ ] **Step 2: Register the public route** — in `frontend/src/App.js`:

Lazy import (next to `CataloguePage` at ~line 74):

```javascript
const PublicForm = lazy(() => import('./pages/PublicForm'));
```

Route (next to `/catalogue/:token` at ~line 170 — public, NO ProtectedRoute):

```javascript
<Route path="/f/:token" element={<PublicForm />} />
```

- [ ] **Step 3: Compile check** — same `npm run build` command. Expected: `Compiled successfully`.

- [ ] **Step 4: Commit**

```bash
cd /f/ss-work && git add frontend/src/pages/PublicForm.js frontend/src/App.js && git commit -m "feat(forms): public mobile-first registration page /f/:token"
```

---

### Task 12: full verification pass

**Files:** none new — verification only.

- [ ] **Step 1: Full backend suite**

Run: `cd /f/ss-work/backend && DB_NAME=smartshape_test python -m pytest tests/ -v --ignore=tests/__pycache__ -x -q`
Expected: all forms tests + `test_webinar_loop.py` + `test_rbac_module.py` pass. Some pre-existing test files hit prod-guarded paths and may be skipped/marked — only investigate failures in files this branch touched.

- [ ] **Step 2: Production-config build**

```bash
cd /f/ss-work/frontend && DISABLE_ESLINT_PLUGIN=true NODE_OPTIONS=--max-old-space-size=4096 REACT_APP_BACKEND_URL=https://app.smartshape.in npm run build
```
Expected: `Compiled successfully`, new chunk for PublicForm/FormBuilder in output listing. Do NOT commit `build/`.

- [ ] **Step 3: End-to-end smoke (manual, careful — local backend hits PROD DB)**

Only if the owner wants a live check pre-merge: start backend + `npm start`, create a throwaway event form titled `ZZTEST-delete-me`, register with your own email/phone, verify: response row, contact tagged `source: form`, confirmation email + WhatsApp queue rows. Then delete the form, the `ZZTEST` training_session, its registration, the test contact, and any queued messages BEFORE the 2-min sender loops flush them (or stop the backend first). Skip entirely if not needed — the pytest suite covers the chain against the test DB.

- [ ] **Step 4: Final review + summary commit check**

```bash
cd /f/ss-work && git log --oneline main..feat/forms-builder && git status -s
```
Expected: ~10 feature commits, clean tree. Branch is ready for review/merge; deploy (merge to main + bundle-rebuild commit + push) happens ONLY with the owner's go-ahead per `reference_deploy_mechanism`.

---

## Plan Self-Review Notes (kept for the executor)

- **Spec coverage**: CRUD+collaborators (T1), public page+protections (T2/T11), CRM upsert (T3), confirmations email+WA+calendar links (T4), auto 24h/1h + manual reminders (T5), responses+export (T6), module/RBAC/indexes (T7), admin UI (T8-T10), QR+WhatsApp share (T9). Spec §3.5 ICS: delivered as the engine's existing add-to-calendar ICS link inside stage emails + Google-Calendar URL — no new ICS code needed.
- **Deliberate deviations from spec**: none functional; `.ics` arrives as a link/button (existing engine behavior) rather than a MIME attachment — same UX on mobile.
- **Type consistency**: field shape `{field_id,label,type,required,choices,map_to}` used identically in `_clean_fields`, `validate_answers`, FormBuilder, PublicForm; `delivery` values `queued|sent|failed|skipped` shared by backend + `Tick` component; `thank_you` keys consumed by PublicForm match `_thank_you`.
- **Known risks called out inline**: route-order note (T6), `test_webinar_loop` interplay (T5 Step 5), lazy-import stubs (T8), grant-editor discovery (T8 Step 6).
