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
