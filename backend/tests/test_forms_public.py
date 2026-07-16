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
