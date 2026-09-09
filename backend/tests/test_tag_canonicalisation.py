"""D5 — tags live in `tag_ids` on contacts, schools and leads.

Schools currently carry BOTH `tags` (written by the CRM) and `tag_ids`
(written by CSV import), so tags applied one way are invisible to the other.

Run with:  cd backend && python -m pytest tests/test_tag_canonicalisation.py -q
"""

import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest

from migrations.canonicalise_tag_fields import canonicalise_tag_fields


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture()
def db():
    from mongomock_motor import AsyncMongoMockClient
    return AsyncMongoMockClient()["smartshape_test"]


def test_school_with_both_fields_unions_them(db):
    async def go():
        await db.schools.insert_one({
            "school_id": "sch_both", "tags": ["tag_a", "tag_b"],
            "tag_ids": ["tag_b", "tag_c"],
        })
        await canonicalise_tag_fields(db)
        s = await db.schools.find_one({"school_id": "sch_both"})
        assert sorted(s["tag_ids"]) == ["tag_a", "tag_b", "tag_c"]
        assert "tags" not in s
    _run(go())


def test_school_with_only_legacy_tags_is_migrated(db):
    async def go():
        await db.schools.insert_one({"school_id": "sch_old", "tags": ["tag_x"]})
        await canonicalise_tag_fields(db)
        s = await db.schools.find_one({"school_id": "sch_old"})
        assert s["tag_ids"] == ["tag_x"]
        assert "tags" not in s
    _run(go())


def test_lead_tags_renamed_to_tag_ids(db):
    async def go():
        await db.leads.insert_one({"lead_id": "lead_1", "tags": ["tag_hot"]})
        await canonicalise_tag_fields(db)
        l = await db.leads.find_one({"lead_id": "lead_1"})
        assert l["tag_ids"] == ["tag_hot"]
        assert "tags" not in l
    _run(go())


def test_contacts_are_left_alone(db):
    async def go():
        await db.contacts.insert_one({"contact_id": "con_1", "tag_ids": ["tag_q"]})
        await canonicalise_tag_fields(db)
        c = await db.contacts.find_one({"contact_id": "con_1"})
        assert c["tag_ids"] == ["tag_q"]
    _run(go())


def test_migration_is_idempotent(db):
    async def go():
        await db.schools.insert_one({"school_id": "sch_i", "tags": ["tag_a"]})
        first = await canonicalise_tag_fields(db)
        second = await canonicalise_tag_fields(db)
        assert first["schools_merged"] == 1
        assert second["schools_merged"] == 0
        assert second["already_clean"] is True
        s = await db.schools.find_one({"school_id": "sch_i"})
        assert s["tag_ids"] == ["tag_a"]
    _run(go())
