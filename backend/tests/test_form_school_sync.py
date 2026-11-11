"""Point 8: Form responses → School data, matched by suggestion and synced manually."""
import asyncio
import json
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from fastapi import HTTPException
from mongomock_motor import AsyncMongoMockClient

import rbac
import routes.crm_routes as crm
import routes.form_routes as fr

ADMIN = {"email": "info@smartshape.in", "name": "Owner", "role": "admin"}
STRANGER = {"email": "x@smartshape.in", "name": "X", "role": "store"}


class FakeRequest:
    def __init__(self, body=None):
        self._body = body or {}

    async def json(self):
        return self._body

    async def body(self):
        return json.dumps(self._body).encode()


def _run(c):
    return asyncio.run(c)


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(fr, "db", d)
    monkeypatch.setattr(crm, "db", d)
    monkeypatch.setattr(rbac, "MODULE_RBAC_MODE", "enforce", raising=False)

    async def _me(_r):
        return ADMIN
    monkeypatch.setattr(fr, "get_current_user", _me)
    _run(d.forms.insert_one({"form_id": "f1", "owner_email": ADMIN["email"], "fields": [
        {"field_id": "q_name", "map_to": "name"}, {"field_id": "q_school", "map_to": "school"},
        {"field_id": "q_city", "map_to": "city"}, {"field_id": "q_phone", "map_to": "phone"}]}))
    _run(d.schools.insert_many([
        {"school_id": "s1", "school_name": "Delhi Public School", "city": ""},
        {"school_id": "s2", "school_name": "St Marys Convent", "city": "Agra"},
    ]))
    _run(d.contacts.insert_one({"contact_id": "c1", "name": "Ms Rao", "school_id": None}))
    _run(d.form_responses.insert_many([
        {"response_id": "r1", "form_id": "f1", "contact_id": "c1", "school_id": None,
         "answers": {"q_name": "Ms Rao", "q_school": "delhi public schol", "q_city": "Noida"}},
        {"response_id": "r2", "form_id": "f1", "contact_id": None, "school_id": None,
         "answers": {"q_name": "Mr X", "q_school": "Totally Unknown Academy"}},
        {"response_id": "r3", "form_id": "f1", "contact_id": None, "school_id": "s2",
         "answers": {"q_school": "St Marys Convent"}},
    ]))
    return d


def test_suggestions_fuzzy_match_unlinked_only(db):
    out = _run(fr.form_school_suggestions("f1", FakeRequest()))
    assert out["r1"]["school_id"] == "s1" and out["r1"]["typed"] == "delhi public schol"
    assert out["r2"] is None
    assert "r3" not in out                                  # already linked


def test_link_updates_response_contact_and_fills_blank_school_fields(db):
    out = _run(fr.link_responses_to_schools("f1", FakeRequest({"links": [{"response_id": "r1", "school_id": "s1"}]})))
    assert out["linked"] == 1 and out["skipped"] == []
    r = _run(db.form_responses.find_one({"response_id": "r1"}))
    assert r["school_id"] == "s1" and r["school_linked_by"] == ADMIN["email"]
    c = _run(db.contacts.find_one({"contact_id": "c1"}))
    assert c["school_id"] == "s1" and c["school_name"] == "Delhi Public School"
    s = _run(db.schools.find_one({"school_id": "s1"}))
    assert s["city"] == "Noida"                             # was blank → filled


def test_link_never_overwrites_filled_school_fields(db):
    _run(db.form_responses.update_one({"response_id": "r3"}, {"$set": {"answers": {"q_city": "Mumbai"}}}))
    _run(fr.link_responses_to_schools("f1", FakeRequest({"links": [{"response_id": "r3", "school_id": "s2"}]})))
    assert _run(db.schools.find_one({"school_id": "s2"}))["city"] == "Agra"


def test_unlink_and_bad_rows_reported(db):
    _run(fr.link_responses_to_schools("f1", FakeRequest({"links": [{"response_id": "r1", "school_id": "s1"}]})))
    out = _run(fr.link_responses_to_schools("f1", FakeRequest({"links": [
        {"response_id": "r1", "school_id": None},
        {"response_id": "nope", "school_id": "s1"},
        {"response_id": "r2", "school_id": "missing"}]})))
    assert out["linked"] == 0 and out["unlinked"] == 1
    assert {s["response_id"] for s in out["skipped"]} == {"nope", "r2"}
    assert _run(db.form_responses.find_one({"response_id": "r1"}))["school_id"] is None


def test_only_form_managers(db, monkeypatch):
    async def _x(_r):
        return STRANGER
    monkeypatch.setattr(fr, "get_current_user", _x)
    with pytest.raises(HTTPException) as e:
        _run(fr.form_school_suggestions("f1", FakeRequest()))
    assert e.value.status_code == 403
    with pytest.raises(HTTPException) as e:
        _run(fr.link_responses_to_schools("f1", FakeRequest({"links": []})))
    assert e.value.status_code == 403
