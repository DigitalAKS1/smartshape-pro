"""repair_orphaned_converted_leads — repairs the ~8 leads the convert-to-lead
school_id bug orphaned in production, without touching the separate
duplicate-schools problem. mongomock.
"""
import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

from migrations.repair_orphaned_converted_leads import repair_orphaned_converted_leads


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture()
def db():
    return AsyncMongoMockClient()["smartshape_test"]


def test_repairs_a_blank_school_id_lead_from_its_contact(db):
    async def go():
        await db.contacts.insert_one({
            "contact_id": "c1", "school_id": "s_dps", "lead_id": "lead_1",
        })
        await db.leads.insert_one({
            "lead_id": "lead_1", "school_id": "", "converted_from_contact": "c1",
        })
        result = await repair_orphaned_converted_leads(db)
        assert result["repaired"] == 1
        lead = await db.leads.find_one({"lead_id": "lead_1"})
        assert lead["school_id"] == "s_dps"
    _run(go())


def test_matches_via_lead_id_when_converted_from_contact_is_missing(db):
    async def go():
        await db.contacts.insert_one({"contact_id": "c2", "school_id": "s_x", "lead_id": "lead_2"})
        await db.leads.insert_one({"lead_id": "lead_2", "school_id": None})
        result = await repair_orphaned_converted_leads(db)
        assert result["repaired"] == 1
        lead = await db.leads.find_one({"lead_id": "lead_2"})
        assert lead["school_id"] == "s_x"
    _run(go())


def test_leaves_a_lead_pointing_at_a_different_real_school_alone(db):
    async def go():
        await db.contacts.insert_one({"contact_id": "c3", "school_id": "s_a", "lead_id": "lead_3"})
        await db.leads.insert_one({
            "lead_id": "lead_3", "school_id": "s_b", "converted_from_contact": "c3",
        })
        result = await repair_orphaned_converted_leads(db)
        assert result["repaired"] == 0
        lead = await db.leads.find_one({"lead_id": "lead_3"})
        assert lead["school_id"] == "s_b", "must not guess which duplicate school is right"
    _run(go())


def test_leaves_a_lead_whose_contact_has_no_school_alone(db):
    async def go():
        await db.contacts.insert_one({"contact_id": "c4", "school_id": "", "lead_id": "lead_4"})
        await db.leads.insert_one({
            "lead_id": "lead_4", "school_id": "", "converted_from_contact": "c4",
        })
        result = await repair_orphaned_converted_leads(db)
        assert result["repaired"] == 0
        assert result["skipped_contact_has_no_school"] == 1
        lead = await db.leads.find_one({"lead_id": "lead_4"})
        assert lead["school_id"] == ""
    _run(go())


def test_leaves_a_lead_with_no_matching_contact_alone(db):
    async def go():
        await db.leads.insert_one({"lead_id": "lead_5", "school_id": ""})
        result = await repair_orphaned_converted_leads(db)
        assert result["repaired"] == 0
        assert result["skipped_no_contact"] == 1
    _run(go())


def test_second_run_repairs_zero(db):
    async def go():
        await db.contacts.insert_one({
            "contact_id": "c1", "school_id": "s_dps", "lead_id": "lead_1",
        })
        await db.leads.insert_one({
            "lead_id": "lead_1", "school_id": "", "converted_from_contact": "c1",
        })
        first = await repair_orphaned_converted_leads(db)
        assert first["repaired"] == 1
        second = await repair_orphaned_converted_leads(db)
        assert second["repaired"] == 0
        assert second["total_orphans_seen"] == 0
    _run(go())
