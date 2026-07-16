"""test_form_crm.py — fill-blanks-only CRM upsert from public form submissions."""
import os
import pytest
import pytest_asyncio
from motor.motor_asyncio import AsyncIOMotorClient

_DB_NAME = os.getenv("DB_NAME", "smartshape_test")
assert _DB_NAME.endswith("_test") or _DB_NAME == "mtt_ci", f"refusing non-test DB: {_DB_NAME}"

from services.form_crm import upsert_contact

_MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")

MAPPED = {"name": "Asha Verma", "email": "asha@example.com", "phone": "+91 98765 43210",
          "school": "DPS Indore", "designation": "PRT", "city": "Indore"}


@pytest_asyncio.fixture
async def d():
    motor_client = AsyncIOMotorClient(_MONGO_URL)
    dd = motor_client[_DB_NAME]
    yield dd
    await dd.contacts.delete_many({})
    await dd.schools.delete_many({})
    motor_client.close()


@pytest.mark.asyncio
async def test_creates_tagged_contact_and_links_school(d):
    await d.schools.insert_one({"school_id": "sch_x1", "school_name": "dps indore"})
    cid, sid = await upsert_contact(d, dict(MAPPED), "form_abc")
    assert cid and cid.startswith("con_") and sid == "sch_x1"
    c = await d.contacts.find_one({"contact_id": cid}, {"_id": 0})
    assert c["source"] == "form" and c["source_form_id"] == "form_abc"
    assert c["phone_norm"] == "+919876543210"
    assert c["school_id"] == "sch_x1" and c["status"] == "active"


@pytest.mark.asyncio
async def test_existing_by_phone_fills_blanks_only(d):
    await d.contacts.insert_one({
        "contact_id": "con_old1", "name": "A. Verma", "phone": "+91 98765 43210",
        "phone_norm": "+919876543210", "email": "", "designation": "TGT",
        "city": "", "school_id": None, "school_name": "", "status": "active"})
    cid, sid = await upsert_contact(d, dict(MAPPED), "form_abc")
    assert cid == "con_old1"
    c = await d.contacts.find_one({"contact_id": "con_old1"}, {"_id": 0})
    assert c["email"] == "asha@example.com"     # blank -> filled
    assert c["city"] == "Indore"                # blank -> filled
    assert c["designation"] == "TGT"            # existing value NEVER overwritten
    assert c["name"] == "A. Verma"              # name never overwritten


@pytest.mark.asyncio
async def test_no_phone_no_email_returns_none(d):
    cid, sid = await upsert_contact(d, {"name": "X", "school": "Y"}, "form_abc")
    assert cid is None and sid is None
    assert await d.contacts.count_documents({}) == 0
