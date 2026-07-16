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
