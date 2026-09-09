"""Tags and notes flow through the import engine onto the contact.

Run with:  cd backend && python -m pytest tests/test_contacts_import_upsert.py -q
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


def test_parse_tag_cell_accepts_pipes_and_commas():
    assert ie.parse_tag_cell("A|B|C") == ["A", "B", "C"]
    assert ie.parse_tag_cell("A, B, C") == ["A", "B", "C"]
    assert ie.parse_tag_cell(" A | B , C ") == ["A", "B", "C"]
    assert ie.parse_tag_cell("A||B") == ["A", "B"]
    assert ie.parse_tag_cell("") == []
    assert ie.parse_tag_cell(None) == []
    assert ie.parse_tag_cell("A|A|B") == ["A", "B"]


def test_tags_cell_replaces_contact_tag_ids(db):
    async def go():
        await db.tags.insert_one({"tag_id": "tag_hot", "name": "Hot Lead"})
        await db.schools.insert_one({
            "school_id": "sch_t", "school_name": "Tag School", "is_deleted": False})
        await db.contacts.insert_one({
            "contact_id": "con_t", "school_id": "sch_t",
            "name": "Tagged Person", "tag_ids": ["tag_stale"]})

        row = {"school_id": "sch_t", "contact_id": "con_t",
               "name": "Tagged Person", "tags": "Hot Lead"}
        await ie.commit_row(db, row, IMPORTER, create_leads=False)

        c = await db.contacts.find_one({"contact_id": "con_t"})
        assert c["tag_ids"] == ["tag_hot"], "a non-blank tags cell is authoritative"
    _run(go())


def test_blank_tags_cell_leaves_existing_tags(db):
    async def go():
        await db.schools.insert_one({
            "school_id": "sch_t", "school_name": "Tag School", "is_deleted": False})
        await db.contacts.insert_one({
            "contact_id": "con_t", "school_id": "sch_t",
            "name": "Tagged Person", "tag_ids": ["tag_keep"]})

        row = {"school_id": "sch_t", "contact_id": "con_t",
               "name": "Tagged Person", "tags": ""}
        await ie.commit_row(db, row, IMPORTER, create_leads=False)

        c = await db.contacts.find_one({"contact_id": "con_t"})
        assert c["tag_ids"] == ["tag_keep"], "blank tags cell must not clear tags (D1)"
    _run(go())


def test_unknown_tag_name_is_created(db):
    async def go():
        await db.schools.insert_one({
            "school_id": "sch_t", "school_name": "Tag School", "is_deleted": False})
        row = {"school_id": "sch_t", "name": "New Person", "tags": "Brand New Tag"}
        await ie.commit_row(db, row, IMPORTER, create_leads=False)

        made = await db.tags.find_one({"name": "Brand New Tag"})
        assert made is not None, "an unseen tag name should be created"
        c = await db.contacts.find_one({"name": "New Person"})
        assert c["tag_ids"] == [made["tag_id"]]
    _run(go())


def test_notes_writes_to_native_column_not_custom_fields(db):
    async def go():
        await db.schools.insert_one({
            "school_id": "sch_n", "school_name": "Note School", "is_deleted": False})
        row = {"school_id": "sch_n", "name": "Noted Person",
               "notes": "Met at expo 2026"}
        await ie.commit_row(db, row, IMPORTER, create_leads=False)

        c = await db.contacts.find_one({"name": "Noted Person"})
        assert c["notes"] == "Met at expo 2026"
        assert "notes" not in (c.get("custom_fields") or {})
    _run(go())
