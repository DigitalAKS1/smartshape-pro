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
