"""A drip 'physical material' step physically sends to the school: it queues a
dispatch + rep task with the NAMED item, and drops a printable QR-tracked mailer
into Offline Mail under today's "Drip Mailers" run. mongomock, direct call."""
import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

import routes.crm_routes as crm


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(crm, "db", d)
    return d


def test_physical_step_names_item_and_mails_school(db):
    async def go():
        lead = {"lead_id": "L1", "school_id": "s1", "company_name": "St Xavier",
                "contact_name": "Asha", "assigned_to": "rep@x.in"}
        await crm.create_physical_from_drip(lead, "catalogue", "Principal Pitch",
                                            material_name="2026 Die Catalogue + Sample Kit")

        # dispatch carries the named item
        disp = await db.physical_dispatches.find_one({"lead_id": "L1"}, {"_id": 0})
        assert disp["material_name"] == "2026 Die Catalogue + Sample Kit"

        # rep task title uses the named item, not the generic type
        task = await db.tasks.find_one({"lead_id": "L1"}, {"_id": 0})
        assert "2026 Die Catalogue + Sample Kit" in task["title"] and "St Xavier" in task["title"]

        # a printable QR-tracked mailer landed in Offline Mail, under a run named
        # for the sequence that produced it (an unnamed "Drip Mailers" pile told
        # whoever printed it nothing about which campaign they were posting)
        run = await db.mail_runs.find_one({"is_drip_run": True}, {"_id": 0})
        assert run and run["counts"]["sent"] == 1
        assert "Principal Pitch" in run["name"] and "catalogue" in run["name"]
        touch = await db.mail_touches.find_one({"school_id": "s1"}, {"_id": 0})
        assert touch and touch["qr_token"] and touch["item_name"] == "2026 Die Catalogue + Sample Kit"
        assert touch["run_id"] == run["run_id"]
    asyncio.run(go())


def test_the_same_piece_twice_in_a_day_posts_once(db):
    """Re-firing the same step must not post a school twice."""
    async def go():
        lead = {"lead_id": "L1", "school_id": "s1", "company_name": "X", "assigned_to": "r@x.in"}
        await crm.create_physical_from_drip(lead, "brochure", "Seq", sequence_id="q1")
        await crm.create_physical_from_drip(lead, "brochure", "Seq", sequence_id="q1")
        assert await db.mail_touches.count_documents({"school_id": "s1"}) == 1
        run = await db.mail_runs.find_one({"is_drip_run": True}, {"_id": 0})
        assert run["counts"]["sent"] == 1
    asyncio.run(go())


def test_two_different_pieces_are_two_separate_mailers(db):
    """A brochure and a sample are two physical items — two envelopes, two QR
    codes, and two rows on the printing run. Collapsing them into one mailer
    would post only one of the two things the sequence promised to send."""
    async def go():
        lead = {"lead_id": "L1", "school_id": "s1", "company_name": "X", "assigned_to": "r@x.in"}
        await crm.create_physical_from_drip(lead, "brochure", "Seq", sequence_id="q1")
        await crm.create_physical_from_drip(lead, "sample", "Seq", sequence_id="q1")
        assert await db.mail_touches.count_documents({"school_id": "s1"}) == 2
        pieces = {t["piece_type"] async for t in db.mail_touches.find({})}
        assert pieces == {"brochure", "sample"}
        assert await db.mail_runs.count_documents({"is_drip_run": True}) == 2
    asyncio.run(go())


def test_no_school_still_queues_dispatch(db):
    async def go():
        lead = {"lead_id": "L1", "company_name": "No School", "assigned_to": "r@x.in"}
        await crm.create_physical_from_drip(lead, "brochure", "Seq", material_name="Flyer")
        assert await db.physical_dispatches.count_documents({"lead_id": "L1"}) == 1
        assert await db.mail_touches.count_documents({}) == 0   # no school → no mailer
    asyncio.run(go())
