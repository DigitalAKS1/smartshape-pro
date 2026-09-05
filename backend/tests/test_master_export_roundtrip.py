"""Import Center export -> edit -> re-upload round-trip.

The owner's workflow is: Export all, rearrange/update in Excel, re-upload. That
only works if (a) the export never dies on dirty cells, (b) every column the
export writes maps back on re-import, and (c) values keep their type instead of
degrading to strings a little more on each pass. mongomock.
"""
import asyncio
import io
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient
from openpyxl import Workbook, load_workbook

import field_registry as fr
import import_engine as ie
import routes.dynamic_import_routes as dyn


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(dyn, "db", d)
    return d


def _run(coro):
    return asyncio.run(coro)


# ── Export must survive dirty data ──────────────────────────────────────────

def test_cell_strips_characters_excel_refuses():
    # openpyxl raises IllegalCharacterError on control chars, which 500s the
    # whole export. Real school data imported from other people's spreadsheets
    # carries them.
    assert dyn._cell("Green\x0bValley\x00 School") == "GreenValley School"
    assert dyn._cell("keeps\ttabs\nand\r\nnewlines") == "keeps\ttabs\nand\r\nnewlines"
    assert dyn._cell(1200) == "1200"
    assert dyn._cell(None) == ""


def test_export_xlsx_builds_even_with_control_characters(db):
    async def go():
        await fr.seed_field_definitions(db)
        await db.schools.insert_one({
            "school_id": "sch_dirty",
            "school_name": "St. Xavier\x0b High",
            "city": "Delhi", "is_deleted": False,
        })
        data = await dyn._build_export(db)
        wb = Workbook()
        ws = wb.active
        ws.append(data["headers"])
        for row in data["rows"]:
            ws.append([row.get(h, "") for h in data["headers"]])   # must not raise
        buf = io.BytesIO()
        wb.save(buf)
        assert buf.getvalue()
    _run(go())


# ── Every exported column must map back on re-upload ────────────────────────

def test_every_exported_header_maps_back_on_reimport(db):
    async def go():
        await fr.seed_field_definitions(db)
        await db.schools.insert_one({"school_id": "s1", "school_name": "A", "is_deleted": False})
        data = await dyn._build_export(db)
        mapping = await ie.propose_mapping(db, data["headers"])
        unmapped = [m["source"] for m in mapping if not m.get("key")]
        assert unmapped == [], f"export writes columns the importer drops: {unmapped}"
    _run(go())


def test_export_carries_school_type_and_contact_id(db):
    async def go():
        await fr.seed_field_definitions(db)
        headers = (await dyn._build_export(db))["headers"]
        assert "Contact ID" in headers, "no Contact ID -> a re-upload re-matches contacts by name"
        assert "School Type" in headers, "School Type is un-editable via export/re-upload"
    _run(go())


# ── Values must keep their type across a round-trip ─────────────────────────

def test_number_fields_survive_the_round_trip_as_numbers(db):
    async def go():
        await fr.seed_field_definitions(db)
        await db.schools.insert_one({
            "school_id": "s1", "school_name": "A", "city": "Rohini",
            "school_strength": 1200, "is_deleted": False,
        })
        data = await dyn._build_export(db)
        mapping = await ie.propose_mapping(db, data["headers"])
        keyed = dyn._key_rows(data["headers"], data["rows"], mapping)
        await ie.commit_row(db, keyed[0], {"email": "admin@x"}, False)
        after = await db.schools.find_one({"school_id": "s1"})
        assert after["school_strength"] == 1200
        assert isinstance(after["school_strength"], int), \
            "strength degraded to a string; every re-upload re-degrades it"
    _run(go())


def test_reupload_updates_in_place_and_applies_the_edit(db):
    async def go():
        await fr.seed_field_definitions(db)
        await db.schools.insert_one({
            "school_id": "s1", "school_name": "Delhi Public School",
            "school_type": "CBSE", "city": "Rohini", "is_deleted": False,
        })
        await db.contacts.insert_one({
            "contact_id": "c1", "school_id": "s1", "name": "R Sharma",
            "phone": "9822222222", "is_deleted": False,
        })
        data = await dyn._build_export(db)
        row = dict(data["rows"][0])
        row["City"] = "Pitampura"          # the owner's edit
        row["School Type"] = "ICSE"

        mapping = await ie.propose_mapping(db, data["headers"])
        keyed = dyn._key_rows(data["headers"], [row], mapping)
        res = await ie.commit_row(db, keyed[0], {"email": "admin@x"}, False)

        assert res["action"] == "update"
        assert res["contact_id"] == "c1"           # matched by exported Contact ID
        after = await db.schools.find_one({"school_id": "s1"})
        assert after["city"] == "Pitampura"
        assert after["school_type"] == "ICSE"
        assert await db.schools.count_documents({}) == 1   # no duplicate
        assert await db.contacts.count_documents({}) == 1
    _run(go())


def test_a_renamed_contact_updates_in_place_instead_of_duplicating(db):
    # Renaming the contact is exactly what the owner wants to do in Excel. With
    # no Contact ID column the importer can only match by name/phone, so a
    # rename silently creates a second contact.
    async def go():
        await fr.seed_field_definitions(db)
        await db.schools.insert_one({"school_id": "s1", "school_name": "A", "is_deleted": False})
        await db.contacts.insert_one({"contact_id": "c1", "school_id": "s1",
                                      "name": "R Sharma", "phone": "", "is_deleted": False})
        data = await dyn._build_export(db)
        row = dict(data["rows"][0])
        row["Name"] = "Rakesh Sharma"
        mapping = await ie.propose_mapping(db, data["headers"])
        keyed = dyn._key_rows(data["headers"], [row], mapping)
        await ie.commit_row(db, keyed[0], {"email": "admin@x"}, False)
        assert await db.contacts.count_documents({}) == 1
        c = await db.contacts.find_one({"contact_id": "c1"})
        assert c["name"] == "Rakesh Sharma"
    _run(go())


# ── A school with several contacts must not lose them ───────────────────────

def test_every_contact_is_exported_not_just_the_first(db):
    async def go():
        await fr.seed_field_definitions(db)
        await db.schools.insert_one({"school_id": "s1", "school_name": "A", "is_deleted": False})
        for i, name in enumerate(("R Sharma", "K Verma", "S Gupta")):
            await db.contacts.insert_one({"contact_id": f"c{i}", "school_id": "s1",
                                          "name": name, "is_deleted": False})
        data = await dyn._build_export(db)
        names = sorted(r["Name"] for r in data["rows"])
        assert names == ["K Verma", "R Sharma", "S Gupta"], \
            f"export dropped contacts: {names}"
    _run(go())


def test_a_school_with_no_contacts_still_exports_one_row(db):
    async def go():
        await fr.seed_field_definitions(db)
        await db.schools.insert_one({"school_id": "s1", "school_name": "Lonely", "is_deleted": False})
        data = await dyn._build_export(db)
        assert len(data["rows"]) == 1
        assert data["rows"][0]["School/Institute Name"] == "Lonely"
        assert data["rows"][0]["Name"] == ""
    _run(go())
