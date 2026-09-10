"""Route-level tests for POST /contacts/import (crm_routes.import_contacts_csv).

test_contacts_import_upsert.py exercises import_engine.commit_row directly,
which never touches the handler's OWN logic: the created/updated/skipped
counting (Ruling R12 — counted from contact_action, not the school's action),
the contact_id-OR-name validation gate, the 50-error cap / error_count, the
chip-tag $addToSet applied after commit_row returns, and — final whole-branch
review item 1 — the require_module gate plus per-row ownership enforcement for
a scoped ("own"-scope) caller. This file calls the real route function
directly (no live server, no TestClient) with the module's `db` monkeypatched
to a fresh mongomock client — the same pattern test_master_import_e2e.py uses
for the sibling /master-import routes, chosen because it is the established
way this codebase drives a real FastAPI route handler against mongomock
without a live server or a real Mongo connection.
"""
import asyncio
import io
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from fastapi import HTTPException
from mongomock_motor import AsyncMongoMockClient

import field_registry as fr
import rbac
import routes.crm_routes as crm

ADMIN = {"email": "importer@smartshape.in", "name": "Importer", "role": "admin"}
# A scoped ("own") sales rep — read_write on leads but only over what they own.
REP = {
    "email": "rep@smartshape.in", "name": "Rep", "role": "sales",
    "module_permissions": {"leads": {"level": "read_write", "scope": "own"}},
}
OTHER_REP = {
    "email": "other.rep@smartshape.in", "name": "Other Rep", "role": "sales",
    "module_permissions": {"leads": {"level": "read_write", "scope": "own"}},
}


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
    monkeypatch.setattr(rbac, "MODULE_RBAC_MODE", "enforce", raising=False)
    return d


def _run(coro):
    return asyncio.run(coro)


def _csv(rows: list) -> bytes:
    """rows[0] is the header row; every row is a list of same length."""
    return "\n".join(",".join(r) for r in rows).encode("utf-8")


def _as(user, monkeypatch):
    """Log the route in as `user` — mirrors test_cross_owner_school_lookup.py."""
    async def _me(_request):
        return user
    monkeypatch.setattr(crm, "get_current_user", _me, raising=False)


async def _import(content: bytes, tag_ids=None, global_notes=None):
    # request is never inspected once get_current_user is monkeypatched via
    # _as() — any placeholder object satisfies the (now mandatory) parameter.
    return await crm.import_contacts_csv(
        file=FakeUpload(content), tag_ids=tag_ids, global_notes=global_notes,
        request=object(),
    )


def test_mixed_file_produces_correct_created_updated_skipped_counts(db, monkeypatch):
    _as(ADMIN, monkeypatch)
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
        # The skipped ghost row now carries a reason, but that must not also
        # count as an error — a row is in exactly one of the four tiles.
        assert len(result["errors"]) == 1, result
        assert "Ghost" not in result["errors"][0]  # the reason names the ROW, not the data
        assert result["error_count"] == 0

        updated = await db.contacts.find_one({"contact_id": "con_existing"})
        assert updated["designation"] == "Director"
        created = await db.contacts.find_one({"name": "Brand New Person"})
        assert created is not None and created["designation"] == "Coordinator"
        # The ghost row must not have created a third contact.
        assert await db.contacts.count_documents({}) == 2
    _run(go())


def test_row_with_neither_contact_id_nor_name_is_skipped_not_errored(db, monkeypatch):
    """A validation skip is not a row ERROR — item 4a: it must count toward
    `skipped` only, never toward `error_count` too. Item 4b: it must still
    carry a short reason in `errors` (previously silent — "1 skipped" with no
    way to tell why)."""
    _as(ADMIN, monkeypatch)
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
        assert result["error_count"] == 0, "a validation skip is not a row error"
        assert len(result["errors"]) == 1, "the skip must carry a reason"
        assert "Row 2" in result["errors"][0]
        assert await db.contacts.count_documents({}) == 0
    _run(go())


def test_chip_tags_are_added_on_top_of_csv_tags_cell_not_replacing_it(db, monkeypatch):
    _as(ADMIN, monkeypatch)
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


# ---------------------------------------------------------------------------
# Final whole-branch review, item 1: /contacts/import had no authorization
# gate at all, and this branch made that dangerous by turning the handler
# from insert-only into something that can mutate (and reassign) an EXISTING
# contact it does not own. Gated like every other CRM write
# (require_module leads:read_write) plus per-row ownership enforcement.
# ---------------------------------------------------------------------------

NOBODY = {"email": "nobody@smartshape.in", "name": "Nobody", "role": "store"}


def test_user_with_no_leads_grant_gets_403_not_500(db, monkeypatch):
    """A store/accounts user with no `leads` module grant at all must be
    turned away with a 403 before a single row is read — not a 500, and
    definitely not a silent pass-through."""
    _as(NOBODY, monkeypatch)
    async def go():
        await fr.seed_field_definitions(db)
        content = _csv([["contact_id", "assigned_to"], ["con_x", "nobody@smartshape.in"]])
        with pytest.raises(HTTPException) as exc_info:
            await _import(content)
        assert exc_info.value.status_code == 403
    _run(go())


def test_admin_updates_any_contact_regardless_of_owner(db, monkeypatch):
    """Admins must keep working exactly as before: no ownership restriction."""
    _as(ADMIN, monkeypatch)
    async def go():
        await fr.seed_field_definitions(db)
        await db.contacts.insert_one({
            "contact_id": "con_admin_target", "name": "Owned By Rep",
            "designation": "Principal", "assigned_to": "rep@smartshape.in",
            "school_id": None,
        })
        content = _csv([
            ["contact_id", "name", "designation"],
            ["con_admin_target", "Owned By Rep", "Director"],
        ])
        result = await _import(content)
        assert result["updated"] == 1, result
        assert result["skipped"] == 0, result
        c = await db.contacts.find_one({"contact_id": "con_admin_target"})
        assert c["designation"] == "Director"
    _run(go())


def test_scoped_rep_updates_own_contact(db, monkeypatch):
    """A scoped ("own") rep must still be able to update a contact they
    actually own (assigned_to == them) — the gate must not over-restrict."""
    _as(REP, monkeypatch)
    async def go():
        await fr.seed_field_definitions(db)
        await db.contacts.insert_one({
            "contact_id": "con_mine", "name": "My Own Contact",
            "designation": "Principal", "assigned_to": REP["email"],
            "school_id": None,
        })
        content = _csv([
            ["contact_id", "name", "designation"],
            ["con_mine", "My Own Contact", "Director"],
        ])
        result = await _import(content)
        assert result["updated"] == 1, result
        assert result["skipped"] == 0, result
        c = await db.contacts.find_one({"contact_id": "con_mine"})
        assert c["designation"] == "Director"
    _run(go())


def test_scoped_rep_cannot_update_or_reassign_a_contact_they_do_not_own(db, monkeypatch):
    """Pins the exploit directly: a two-column contact_id,assigned_to CSV
    uploaded by a scoped rep must not reassign (or touch in any way) a
    contact owned by someone else. The row is skipped with a clear reason,
    never silently applied, never a 500."""
    _as(REP, monkeypatch)
    async def go():
        await fr.seed_field_definitions(db)
        await db.contacts.insert_one({
            "contact_id": "con_theirs", "name": "Not Mine",
            "designation": "Principal", "assigned_to": OTHER_REP["email"],
            "school_id": None,
        })
        content = _csv([
            ["contact_id", "assigned_to"],
            ["con_theirs", REP["email"]],
        ])
        result = await _import(content)
        assert result["updated"] == 0, result
        assert result["created"] == 0, result
        assert result["skipped"] == 1, result
        assert result["error_count"] == 0, "a denied row is a skip, not a crash"
        assert len(result["errors"]) == 1
        assert "con_theirs" in result["errors"][0]
        c = await db.contacts.find_one({"contact_id": "con_theirs"})
        assert c["assigned_to"] == OTHER_REP["email"], (
            "ownership must be completely untouched by a denied row"
        )
        assert c["designation"] == "Principal"
        # No duplicate contact must have been minted either.
        assert await db.contacts.count_documents({}) == 1
    _run(go())


def test_scoped_rep_can_still_create_a_brand_new_contact(db, monkeypatch):
    """The ownership gate is scoped to UPDATING an existing record a rep does
    not own — it must not block a scoped rep from importing their own new
    contacts (no existing match => nothing to authorize against)."""
    _as(REP, monkeypatch)
    async def go():
        await fr.seed_field_definitions(db)
        content = _csv([["name", "designation"], ["Brand New For Rep", "Coordinator"]])
        result = await _import(content)
        assert result["created"] == 1, result
        assert result["skipped"] == 0, result
    _run(go())
