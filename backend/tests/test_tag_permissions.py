"""Exactly what a sales rep (not an admin) can and cannot do with tags.

The owner asked a direct question — "is tagging working for Parul?" — and the
answer differs per action, so it is pinned here rather than reasoned about. A
rep segments her own pipeline all day; only the shared master list is protected.
mongomock.
"""
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

# A sales exec with the ordinary CRM grant, i.e. what Parul's account looks like.
REP = {
    "email": "parul@smartshape.in", "name": "Parul Kanchan", "role": "sales",
    "module_permissions": {"leads": {"level": "read_write", "scope": "own"}},
}
ADMIN = {"email": "info@smartshape.in", "name": "Owner", "role": "admin"}


class FakeRequest:
    def __init__(self, body=None):
        self._body = body or {}

    async def json(self):
        return self._body

    async def body(self):   # _parse_json_body reads raw bytes on some routes
        return json.dumps(self._body).encode()


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(crm, "db", d)
    monkeypatch.setattr(rbac, "MODULE_RBAC_MODE", "enforce")
    return d


def _as(user, monkeypatch):
    async def _me(_request):
        return user
    monkeypatch.setattr(crm, "get_current_user", _me)


def _run(coro):
    return asyncio.run(coro)


async def _seed(db):
    await db.tags.insert_one({"tag_id": "tag_hot", "name": "Hot Lead", "color": "#f00"})
    await db.schools.insert_one({"school_id": "s1", "school_name": "DPS", "is_deleted": False})
    await db.leads.insert_one({"lead_id": "l1", "school_id": "s1", "is_deleted": False})
    await db.contacts.insert_one({"contact_id": "c1", "school_id": "s1", "name": "R Sharma",
                                  "is_deleted": False})


# ── What a rep CAN do: use tags on her own records ──────────────────────────

def test_a_rep_can_create_a_tag(db, monkeypatch):
    _as(REP, monkeypatch)

    async def go():
        await _seed(db)
        out = await crm.create_tag(FakeRequest({"name": "Delhi expo", "color": "#0f0"}))
        assert out["name"] == "Delhi expo"
        assert out["created_by"] == "parul@smartshape.in"
    _run(go())


def test_a_rep_can_tag_leads_in_bulk(db, monkeypatch):
    _as(REP, monkeypatch)

    async def go():
        await _seed(db)
        out = await crm.bulk_tag_leads(FakeRequest(
            {"lead_ids": ["l1"], "tag_id": "tag_hot", "action": "add"}))
        assert out["modified"] == 1
        assert (await db.leads.find_one({"lead_id": "l1"}))["tags"] == ["tag_hot"]
    _run(go())


def test_a_rep_can_tag_a_contact(db, monkeypatch):
    _as(REP, monkeypatch)

    async def go():
        await _seed(db)
        await crm.add_contact_tag("c1", FakeRequest({"tag_id": "tag_hot"}))
        assert (await db.contacts.find_one({"contact_id": "c1"}))["tag_ids"] == ["tag_hot"]
    _run(go())


def test_a_rep_with_the_leads_grant_can_bulk_tag_schools(db, monkeypatch):
    # The server has always allowed this — it asks for leads:read_write, not for
    # admin. The Schools tab UI is the part that does not offer it.
    _as(REP, monkeypatch)

    async def go():
        await _seed(db)
        out = await crm.bulk_tag_schools(FakeRequest(
            {"school_ids": ["s1"], "tag_id": "tag_hot", "action": "add"}))
        assert out["updated"] == 1
        assert (await db.schools.find_one({"school_id": "s1"}))["tags"] == ["tag_hot"]
    _run(go())


def test_a_rep_without_the_leads_grant_is_refused_on_schools(db, monkeypatch):
    _as({**REP, "module_permissions": {"leads": {"level": "read"}}}, monkeypatch)

    async def go():
        await _seed(db)
        with pytest.raises(HTTPException) as e:
            await crm.bulk_tag_schools(FakeRequest(
                {"school_ids": ["s1"], "tag_id": "tag_hot", "action": "add"}))
        assert e.value.status_code == 403
    _run(go())


# ── What a rep CANNOT do: change the list everyone else sees ────────────────

def test_a_rep_cannot_rename_a_tag(db, monkeypatch):
    _as(REP, monkeypatch)

    async def go():
        await _seed(db)
        with pytest.raises(HTTPException) as e:
            await crm.update_tag("tag_hot", FakeRequest({"name": "Very Hot"}))
        assert e.value.status_code == 403
        assert (await db.tags.find_one({"tag_id": "tag_hot"}))["name"] == "Hot Lead"
    _run(go())


def test_a_rep_cannot_delete_a_tag(db, monkeypatch):
    _as(REP, monkeypatch)

    async def go():
        await _seed(db)
        with pytest.raises(HTTPException) as e:
            await crm.delete_tag("tag_hot", FakeRequest())
        assert e.value.status_code == 403
        assert await db.tags.count_documents({}) == 1
    _run(go())


def test_an_admin_can_rename_and_delete(db, monkeypatch):
    _as(ADMIN, monkeypatch)

    async def go():
        await _seed(db)
        out = await crm.update_tag("tag_hot", FakeRequest({"name": "Very Hot"}))
        assert out["name"] == "Very Hot"
        await crm.delete_tag("tag_hot", FakeRequest())
        assert await db.tags.count_documents({}) == 0
    _run(go())


# ── The seeder must not undo an admin's edits ───────────────────────────────
#
# _seed_marketing_tags() ran on EVERY GET /tags and re-inserted any default tag
# whose NAME was missing. So renaming "Hot Lead" to "Very Hot" and refetching
# put a brand-new "Hot Lead" straight back, and the admin — who had just been
# told "Tag updated" — saw the old tag still sitting in the list.

def test_renaming_a_default_tag_survives_the_next_list(db, monkeypatch):
    _as(ADMIN, monkeypatch)

    async def go():
        await crm.get_tags(FakeRequest())                 # seed the defaults
        hot = await db.tags.find_one({"name": "Hot Lead"})
        await crm.update_tag(hot["tag_id"], FakeRequest({"name": "Very Hot"}))

        tags = await crm.get_tags(FakeRequest())          # what the page reloads
        names = [t["name"] for t in tags]
        assert "Very Hot" in names
        assert "Hot Lead" not in names, "the seeder resurrected the old name"
        assert len(names) == len(set(names)), f"duplicate tags after a rename: {names}"
    _run(go())


def test_recolouring_a_default_tag_sticks(db, monkeypatch):
    _as(ADMIN, monkeypatch)

    async def go():
        await crm.get_tags(FakeRequest())
        hot = await db.tags.find_one({"name": "Hot Lead"})
        await crm.update_tag(hot["tag_id"], FakeRequest({"color": "#000000"}))
        await crm.get_tags(FakeRequest())
        assert (await db.tags.find_one({"tag_id": hot["tag_id"]}))["color"] == "#000000"
        assert await db.tags.count_documents({"name": "Hot Lead"}) == 1
    _run(go())


def test_a_deleted_default_tag_stays_deleted(db, monkeypatch):
    _as(ADMIN, monkeypatch)

    async def go():
        await crm.get_tags(FakeRequest())
        hot = await db.tags.find_one({"name": "Hot Lead"})
        await crm.delete_tag(hot["tag_id"], FakeRequest())
        tags = await crm.get_tags(FakeRequest())
        assert "Hot Lead" not in [t["name"] for t in tags], "a default tag cannot be deleted"
    _run(go())


def test_listing_tags_does_not_write_on_every_read(db, monkeypatch):
    # A write on every list is also a needless round trip on a 1-vCPU box.
    _as(ADMIN, monkeypatch)

    async def go():
        await crm.get_tags(FakeRequest())
        before = await db.tags.count_documents({})
        for _ in range(5):
            await crm.get_tags(FakeRequest())
        assert await db.tags.count_documents({}) == before
    _run(go())


def test_a_fresh_install_still_gets_the_default_tags(db, monkeypatch):
    _as(ADMIN, monkeypatch)

    async def go():
        assert await db.tags.count_documents({}) == 0
        tags = await crm.get_tags(FakeRequest())
        assert len(tags) == len(crm._DEFAULT_MARKETING_TAGS)
        assert "Hot Lead" in [t["name"] for t in tags]
    _run(go())
