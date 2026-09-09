"""D1 — a blank CSV cell must never clear an existing field.

A spreadsheet round-trip emits every column for every row, so cells the user
left empty arrive as "". Re-uploading an export must not overwrite live
phone/email values with empty strings.

Run with:  cd backend && python -m pytest tests/test_import_blank_safety.py -q
"""

import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest

import import_engine as ie

IMPORTER = {"email": "importer@smartshape.in", "name": "Importer"}


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture()
def db():
    from mongomock_motor import AsyncMongoMockClient
    return AsyncMongoMockClient()["smartshape_test"]


def test_strip_blanks_drops_empty_keeps_falsy_values():
    out = ie._strip_blanks({
        "keep": "value",
        "empty": "",
        "spaces": "   ",
        "none": None,
        "zero": 0,
        "false": False,
    })
    assert out == {"keep": "value", "zero": 0, "false": False}


def test_blank_cells_do_not_clear_contact_fields(db):
    async def go():
        await db.schools.insert_one({
            "school_id": "sch_keepme", "school_name": "Keep School",
            "phone": "9876543210", "city": "Pune", "is_deleted": False,
        })
        await db.contacts.insert_one({
            "contact_id": "con_keepme", "school_id": "sch_keepme",
            "name": "Alka Kapur", "phone": "1141427627",
            "email": "alka@example.com", "designation": "Principal",
        })
        row = {
            "school_id": "sch_keepme",
            "contact_id": "con_keepme",
            "name": "Alka Kapur",
            "phone": "",
            "email": "",
            "designation": "Director",
        }
        await ie.commit_row(db, row, IMPORTER, create_leads=False)

        c = await db.contacts.find_one({"contact_id": "con_keepme"})
        assert c["email"] == "alka@example.com", "blank email cell cleared a live address"
        assert c["phone"] == "1141427627", "blank phone cell cleared a live number"
        assert c["designation"] == "Director", "non-blank cell should have updated"
    _run(go())


def test_blank_cells_do_not_clear_school_fields(db):
    async def go():
        await db.schools.insert_one({
            "school_id": "sch_keepme", "school_name": "Keep School",
            "phone": "9876543210", "city": "Pune", "state": "MH",
            "is_deleted": False,
        })
        row = {
            "school_id": "sch_keepme",
            "school_name": "Keep School",
            "school_phone": "",
            "city": "",
            "state": "Maharashtra",
        }
        await ie.commit_row(db, row, IMPORTER, create_leads=False)

        s = await db.schools.find_one({"school_id": "sch_keepme"})
        assert s["phone"] == "9876543210", "blank phone column cleared the school phone"
        assert s["city"] == "Pune", "blank city cell cleared a live city"
        assert s["state"] == "Maharashtra", "non-blank cell should have updated"
    _run(go())


def test_zero_strength_is_written_not_treated_as_blank(db):
    async def go():
        await db.schools.insert_one({
            "school_id": "sch_zero", "school_name": "Zero School",
            "school_strength": 500, "is_deleted": False,
        })
        row = {"school_id": "sch_zero", "school_name": "Zero School",
               "school_strength": "0"}
        await ie.commit_row(db, row, IMPORTER, create_leads=False)

        s = await db.schools.find_one({"school_id": "sch_zero"})
        assert s["school_strength"] == 0, "0 is a real value, not a blank"
    _run(go())
