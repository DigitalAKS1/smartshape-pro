"""Generic lookup masters (Phase 1): school_category, product_category, package_type.

Harness: mongomock_motor with `lookup_routes.db` monkeypatched, route functions
called directly (same pattern as test_bulk_multi_tag.py).
"""
import asyncio
import json
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from fastapi import HTTPException
from mongomock_motor import AsyncMongoMockClient

import routes.lookup_routes as lk

ADMIN = {"email": "info@smartshape.in", "name": "Owner", "role": "admin"}
REP = {"email": "rep@smartshape.in", "name": "Rep", "role": "sales"}


class FakeRequest:
    def __init__(self, body=None):
        self._body = body or {}

    async def json(self):
        return self._body

    async def body(self):
        return json.dumps(self._body).encode()


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(lk, "db", d)
    return d


def _as(user, monkeypatch):
    async def _me(_request):
        return user
    monkeypatch.setattr(lk, "get_current_user", _me)


def _run(coro):
    return asyncio.run(coro)


def test_get_seeds_school_category(db, monkeypatch):
    _as(ADMIN, monkeypatch)
    items = _run(lk.get_lookup("school_category", FakeRequest()))
    assert [i["name"] for i in items] == ["Pre School", "K-12 School", "Franchise", "Navodaya", "Independent"]


def test_seed_idempotent(db, monkeypatch):
    _as(ADMIN, monkeypatch)
    _run(lk.get_lookup("school_category", FakeRequest()))
    _run(lk.get_lookup("school_category", FakeRequest()))
    assert _run(db.lookup_values.count_documents({"list_key": "school_category"})) == 5


def test_product_category_seed_values(db, monkeypatch):
    _as(ADMIN, monkeypatch)
    items = _run(lk.get_lookup("product_category", FakeRequest()))
    assert len(items) == 14
    row = next(i for i in items if i["value"] == "3d_flowers")
    assert row["name"] == "3D Flowers"


def test_create_dedupes_case_insensitive(db, monkeypatch):
    _as(REP, monkeypatch)
    items = _run(lk.get_lookup("school_category", FakeRequest()))
    pre = next(i for i in items if i["name"] == "Pre School")
    got = _run(lk.create_lookup("school_category", FakeRequest({"name": "pre school"})))
    assert got["lookup_id"] == pre["lookup_id"]


def test_create_slug_value(db, monkeypatch):
    _as(REP, monkeypatch)
    got = _run(lk.create_lookup("school_category", FakeRequest({"name": "Play Way School"})))
    assert got["value"] == "play_way_school"
    assert got["name"] == "Play Way School"


def test_rename_name_list_cascades(db, monkeypatch):
    _as(ADMIN, monkeypatch)
    items = _run(lk.get_lookup("school_category", FakeRequest()))
    fr = next(i for i in items if i["name"] == "Franchise")
    _run(db.schools.insert_one({"school_id": "s1", "school_category": "Franchise"}))
    _run(lk.update_lookup("school_category", fr["lookup_id"], FakeRequest({"name": "Franchisee"})))
    s = _run(db.schools.find_one({"school_id": "s1"}))
    assert s["school_category"] == "Franchisee"


def test_rename_value_list_keeps_records(db, monkeypatch):
    _as(ADMIN, monkeypatch)
    items = _run(lk.get_lookup("product_category", FakeRequest()))
    fl = next(i for i in items if i["value"] == "flowers")
    _run(db.dies.insert_one({"die_id": "d1", "category": "flowers"}))
    out = _run(lk.update_lookup("product_category", fl["lookup_id"], FakeRequest({"name": "Florals"})))
    assert out["name"] == "Florals" and out["value"] == "flowers"
    d = _run(db.dies.find_one({"die_id": "d1"}))
    assert d["category"] == "flowers"


def test_delete_in_use_409(db, monkeypatch):
    _as(ADMIN, monkeypatch)
    items = _run(lk.get_lookup("school_category", FakeRequest()))
    nv = next(i for i in items if i["name"] == "Navodaya")
    _run(db.schools.insert_one({"school_id": "s1", "school_category": "Navodaya"}))
    with pytest.raises(HTTPException) as e:
        _run(lk.delete_lookup("school_category", nv["lookup_id"], FakeRequest()))
    assert e.value.status_code == 409
    assert "1" in str(e.value.detail)


def test_delete_unused_ok(db, monkeypatch):
    _as(ADMIN, monkeypatch)
    items = _run(lk.get_lookup("school_category", FakeRequest()))
    ind = next(i for i in items if i["name"] == "Independent")
    _run(lk.delete_lookup("school_category", ind["lookup_id"], FakeRequest()))
    assert _run(db.lookup_values.count_documents({"lookup_id": ind["lookup_id"]})) == 0


def test_rename_requires_admin(db, monkeypatch):
    _as(ADMIN, monkeypatch)
    items = _run(lk.get_lookup("school_category", FakeRequest()))
    _as(REP, monkeypatch)
    with pytest.raises(HTTPException) as e:
        _run(lk.update_lookup("school_category", items[0]["lookup_id"], FakeRequest({"name": "X"})))
    assert e.value.status_code == 403
    with pytest.raises(HTTPException) as e:
        _run(lk.delete_lookup("school_category", items[0]["lookup_id"], FakeRequest()))
    assert e.value.status_code == 403


def test_unknown_list_404(db, monkeypatch):
    _as(ADMIN, monkeypatch)
    with pytest.raises(HTTPException) as e:
        _run(lk.get_lookup("nope", FakeRequest()))
    assert e.value.status_code == 404


def test_usage_counts(db, monkeypatch):
    _as(ADMIN, monkeypatch)
    _run(db.schools.insert_many([
        {"school_id": "a", "school_category": "Pre School"},
        {"school_id": "b", "school_category": "Pre School"},
        {"school_id": "c", "school_category": "Pre School", "is_deleted": True},
    ]))
    items = _run(lk.get_lookup("school_category", FakeRequest()))
    assert next(i for i in items if i["name"] == "Pre School")["usage"] == 2


def test_canonical_name(db, monkeypatch):
    assert _run(lk.canonical_name("school_category", "k-12 school")) == "K-12 School"
    assert _run(lk.canonical_name("product_category", "3D flowers")) == "3d_flowers"
    assert _run(lk.canonical_name("product_category", "animals_birds")) == "animals_birds"
    assert _run(lk.canonical_name("school_category", "  Montessori ")) == "Montessori"
    assert _run(lk.canonical_name("school_category", "")) == ""


def test_lists_metadata(db, monkeypatch):
    _as(REP, monkeypatch)
    lists = _run(lk.list_lookups(FakeRequest()))
    keys = {l["key"]: l["group"] for l in lists}
    assert keys == {"school_category": "crm", "product_category": "product", "package_type": "product"}


# ── Final-review fixes ────────────────────────────────────────────────────────

def test_rename_cascades_into_saved_campaign_audiences(db, monkeypatch):
    _as(ADMIN, monkeypatch)
    items = _run(lk.get_lookup("school_category", FakeRequest()))
    fr = next(i for i in items if i["name"] == "Franchise")
    _run(db.email_campaigns.insert_one({"campaign_id": "e1", "audience_filter": {"school_categories": ["Franchise", "Navodaya"]}}))
    _run(db.whatsapp_campaigns.insert_one({"campaign_id": "w1", "audience_filter": {"school_categories": ["Franchise"]}}))
    _run(db.email_campaigns.insert_one({"campaign_id": "e2", "audience_filter": {"cities": ["Delhi"]}}))
    _run(lk.update_lookup("school_category", fr["lookup_id"], FakeRequest({"name": "Franchisee"})))
    e1 = _run(db.email_campaigns.find_one({"campaign_id": "e1"}))
    w1 = _run(db.whatsapp_campaigns.find_one({"campaign_id": "w1"}))
    e2 = _run(db.email_campaigns.find_one({"campaign_id": "e2"}))
    assert e1["audience_filter"]["school_categories"] == ["Franchisee", "Navodaya"]
    assert w1["audience_filter"]["school_categories"] == ["Franchisee"]
    assert e2["audience_filter"] == {"cities": ["Delhi"]}


def test_unknown_value_snaps_to_existing_record_spelling(db, monkeypatch):
    _run(db.schools.insert_one({"school_id": "m1", "school_category": "Montessori"}))
    assert _run(lk.canonical_name("school_category", "montessori")) == "Montessori"
    # value-stored lists never borrow from records
    assert _run(lk.canonical_name("product_category", "zzz")) == "zzz"


def test_exact_name_beats_slug_match(db, monkeypatch):
    _as(ADMIN, monkeypatch)
    items = _run(lk.get_lookup("school_category", FakeRequest()))
    pre = next(i for i in items if i["name"] == "Pre School")
    _run(lk.update_lookup("school_category", pre["lookup_id"], FakeRequest({"name": "Playgroup"})))
    # "Pre School" is now a new value, not the renamed Playgroup row
    got = _run(lk.create_lookup("school_category", FakeRequest({"name": "Pre School"})))
    assert got["name"] == "Pre School"
    assert got["lookup_id"] != pre["lookup_id"]
    assert _run(lk.canonical_name("school_category", "pre school")) == "Pre School"
    assert _run(lk.canonical_name("school_category", "playgroup")) == "Playgroup"


def test_rename_rejects_slug_clash(db, monkeypatch):
    _as(ADMIN, monkeypatch)
    items = _run(lk.get_lookup("school_category", FakeRequest()))
    ind = next(i for i in items if i["name"] == "Independent")
    with pytest.raises(HTTPException) as e:
        _run(lk.update_lookup("school_category", ind["lookup_id"], FakeRequest({"name": "Navodaya!"})))
    assert e.value.status_code == 409


def test_delete_counts_soft_deleted_records(db, monkeypatch):
    _as(ADMIN, monkeypatch)
    items = _run(lk.get_lookup("school_category", FakeRequest()))
    nv = next(i for i in items if i["name"] == "Navodaya")
    _run(db.schools.insert_one({"school_id": "d1", "school_category": "Navodaya", "is_deleted": True}))
    with pytest.raises(HTTPException) as e:
        _run(lk.delete_lookup("school_category", nv["lookup_id"], FakeRequest()))
    assert e.value.status_code == 409
