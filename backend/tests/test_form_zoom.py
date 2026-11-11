"""Point 7: event form ↔ Zoom — create the meeting from the form; optionally register
each registrant on Zoom so they get a personal join link."""
import asyncio
import json
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from fastapi import HTTPException
from mongomock_motor import AsyncMongoMockClient

import routes.form_routes as fr
import zoom_service as zs

ADMIN = {"email": "info@smartshape.in", "name": "Owner", "role": "admin"}


class FakeRequest:
    def __init__(self, body=None):
        self._body = body or {}

    async def json(self):
        return self._body


def _run(c):
    return asyncio.run(c)


@pytest.fixture()
def env(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(fr, "db", d)

    async def _me(_r):
        return ADMIN
    monkeypatch.setattr(fr, "get_current_user", _me)
    calls = {"create": [], "reg": []}

    async def _configured():
        return True

    async def _create(topic, start_time, duration=60, timezone_str="Asia/Kolkata", agenda="", registration=False):
        calls["create"].append({"topic": topic, "start_time": start_time, "duration": duration, "registration": registration})
        return {"meeting_id": "999", "join_url": "https://zoom.us/j/999", "password": "pw", "start_url": "", "start_time": start_time, "topic": topic}

    async def _register(meeting_id, email, name):
        calls["reg"].append({"meeting_id": meeting_id, "email": email, "name": name})
        return {"join_url": f"https://zoom.us/w/999?tk={email}", "registrant_id": "r1"}
    monkeypatch.setattr(zs, "is_configured", _configured)
    monkeypatch.setattr(zs, "create_meeting", _create)
    monkeypatch.setattr(zs, "add_registrant", _register)

    async def _sync(form, email):
        return "sess_1"
    monkeypatch.setattr(fr, "_sync_event_session", _sync)
    _run(d.forms.insert_one({"form_id": "f1", "type": "event", "title": "Art Webinar", "owner_email": ADMIN["email"],
                             "event": {"theme": "Paper art", "date": "2026-12-20", "time": "16:30", "duration_min": 45,
                                       "platform": "zoom", "meeting_link": ""}}))
    return {"db": d, "calls": calls}


def test_create_meeting_from_form(env):
    out = _run(fr.create_form_zoom_meeting("f1", FakeRequest({"registration": True})))
    c = env["calls"]["create"][0]
    assert c["topic"] == "Art Webinar" and c["start_time"] == "2026-12-20T16:30:00" and c["duration"] == 45
    assert c["registration"] is True
    ev = _run(env["db"].forms.find_one({"form_id": "f1"}))["event"]
    assert ev["zoom_meeting_id"] == "999" and ev["meeting_link"] == "https://zoom.us/j/999"
    assert ev["zoom_registration"] is True and out["meeting_link"] == "https://zoom.us/j/999"


def test_create_needs_date_time_and_no_existing_meeting(env):
    _run(env["db"].forms.update_one({"form_id": "f1"}, {"$set": {"event.time": ""}}))
    with pytest.raises(HTTPException) as e:
        _run(fr.create_form_zoom_meeting("f1", FakeRequest({})))
    assert e.value.status_code == 400
    _run(env["db"].forms.update_one({"form_id": "f1"}, {"$set": {"event.time": "10:00", "event.zoom_meeting_id": "5"}}))
    with pytest.raises(HTTPException) as e:
        _run(fr.create_form_zoom_meeting("f1", FakeRequest({})))
    assert e.value.status_code == 409


def test_zoom_register_gives_personal_link_once(env):
    form = {"form_id": "f1", "event": {"zoom_meeting_id": "999", "zoom_registration": True}}
    reg = {"reg_id": "g1", "email": "a@x.in", "name": "Asha Rao"}
    _run(env["db"].session_registrations.insert_one(dict(reg)))
    link = _run(fr._zoom_register(form, reg))
    assert link == "https://zoom.us/w/999?tk=a@x.in"
    assert env["calls"]["reg"] == [{"meeting_id": "999", "email": "a@x.in", "name": "Asha Rao"}]
    assert _run(env["db"].session_registrations.find_one({"reg_id": "g1"}))["zoom_join_url"] == link
    assert _run(fr._zoom_register(form, {**reg, "zoom_join_url": link})) == link    # no second API call
    assert len(env["calls"]["reg"]) == 1


def test_zoom_register_off_or_failing_never_raises(env, monkeypatch):
    assert _run(fr._zoom_register({"event": {"zoom_meeting_id": "999"}}, {"reg_id": "g", "email": "a@x.in"})) == ""

    async def _boom(*a):
        raise RuntimeError("zoom down")
    monkeypatch.setattr(zs, "add_registrant", _boom)
    form = {"event": {"zoom_meeting_id": "999", "zoom_registration": True}}
    assert _run(fr._zoom_register(form, {"reg_id": "g", "email": "a@x.in", "name": "A"})) == ""


def test_messages_use_personal_link_when_present(env):
    form = {"title": "T", "event": {"meeting_link": "https://zoom.us/j/999"}}
    assert fr._msg_ctx(form, {"name": "A"})["zoom_link"] == "https://zoom.us/j/999"
    assert fr._msg_ctx(form, {"name": "A", "zoom_join_url": "https://zoom.us/w/me"})["zoom_link"] == "https://zoom.us/w/me"


def test_clean_event_keeps_zoom_fields():
    ev = fr._clean_event({"date": "2026-12-20", "time": "10:00", "zoom_meeting_id": "999",
                          "zoom_registration": True, "zoom_password": "pw"})
    assert ev["zoom_registration"] is True and ev["zoom_password"] == "pw"


def test_webinar_stage_emails_use_personal_link():
    import routes.training_routes as tr
    session = {"session_id": "s", "title": "T", "meeting_link": "https://zoom.us/j/999"}
    assert tr._stage_tokens(session, {})["join_url"] == "https://zoom.us/j/999"
    assert tr._stage_tokens(session, {"zoom_join_url": "https://zoom.us/w/me"})["join_url"] == "https://zoom.us/w/me"
