"""Route-level tests for POST /contacts/import (crm_routes.import_contacts_csv).

test_contacts_import_upsert.py exercises import_engine.commit_row directly,
which never touches the handler's OWN logic: the created/updated/skipped
counting (Ruling R12 — counted from contact_action, not the school's action),
the contact_id-OR-name validation gate, the 50-error cap / error_count, and
the chip-tag $addToSet applied after commit_row returns. This file calls the
real route function directly (no live server, no TestClient) with the
module's `db` monkeypatched to a fresh mongomock client — the same pattern
test_master_import_e2e.py uses for the sibling /master-import routes, chosen
because it is the established way this codebase drives a real FastAPI route
handler against mongomock without a live server or a real Mongo connection.
"""
import asyncio
import io
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

import field_registry as fr
import routes.crm_routes as crm

ADMIN = {"email": "importer@smartshape.in", "name": "Importer", "role": "admin"}


class FakeUpload:
    """Stands in for a Starlette UploadFile — matches test_master_import_e2e.py."""

    def __init__(self, data: bytes, filename: str = "contacts.csv"):
        self._data = data
        self.filename = filename

    async def read(self):
        return self._data


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(crm, "db", d)
    return d


def _run(coro):
    return asyncio.run(coro)


def _csv(rows: list) -> bytes:
    """rows[0] is the header row; every row is a list of same length."""
    return "\n".join(",".join(r) for r in rows).encode("utf-8")


async def _import(content: bytes, tag_ids=None, global_notes=None):
    return await crm.import_contacts_csv(
        file=FakeUpload(content), tag_ids=tag_ids, global_notes=global_notes, request=None,
    )


def test_mixed_file_produces_correct_created_updated_skipped_counts(db):
    async def go():
        await fr.seed_field_definitions(db)
        await db.contacts.insert_one({
            "contact_id": "con_existing", "name": "Alka Kapur",
            "designation": "Principal", "school_id": None,
        })

        content = _csv([
            ["contact_id", "name", "phone", "designation"],
            # update: matches by contact_id
            ["con_existing", "Alka Kapur", "", "Director"],
            # create: no contact_id, has a name
            ["", "Brand New Person", "9000000001", "Coordinator"],
            # skipped: neither contact_id nor name
            ["", "", "9000000002", "Ghost Row"],
        ])
        result = await _import(content)

        assert result["created"] == 1, result
        assert result["updated"] == 1, result
        assert result["skipped"] == 1, result
        assert result["errors"] == []
        assert result["error_count"] == 0

        updated = await db.contacts.find_one({"contact_id": "con_existing"})
        assert updated["designation"] == "Director"
        created = await db.contacts.find_one({"name": "Brand New Person"})
        assert created is not None and created["designation"] == "Coordinator"
        # The ghost row must not have created a third contact.
        assert await db.contacts.count_documents({}) == 2
    _run(go())


def test_row_with_neither_contact_id_nor_name_is_skipped_not_errored(db):
    async def go():
        await fr.seed_field_definitions(db)
        content = _csv([
            ["contact_id", "name", "phone"],
            ["", "", "9999999999"],
        ])
        result = await _import(content)
        assert result["created"] == 0
        assert result["updated"] == 0
        assert result["skipped"] == 1
        assert result["errors"] == [], "a validation skip is not a row error"
        assert await db.contacts.count_documents({}) == 0
    _run(go())


def test_chip_tags_are_added_on_top_of_csv_tags_cell_not_replacing_it(db):
    async def go():
        await fr.seed_field_definitions(db)
        await db.tags.insert_one({"tag_id": "tag_chip1", "name": "Chip Tag"})

        content = _csv([
            ["name", "tags"],
            ["Tag Test Person", "Csv Tag"],
        ])
        result = await _import(content, tag_ids="tag_chip1")
        assert result["created"] == 1, result

        c = await db.contacts.find_one({"name": "Tag Test Person"})
        csv_tag = await db.tags.find_one({"name": "Csv Tag"})
        assert csv_tag is not None, "the CSV tags cell must still resolve/create its own tag"
        assert set(c["tag_ids"]) == {"tag_chip1", csv_tag["tag_id"]}, (
            "the dialog's chip tag must be ADDED to the CSV's own tags cell, not replace it"
        )
    _run(go())
