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


def test_contacts_only_row_creates_no_school(db):
    async def go():
        row = {"contact_id": "con_solo", "name": "Solo Person",
               "phone": "9998887776"}
        res = await ie.commit_row(db, row, IMPORTER, create_leads=False,
                                  allow_school_create=False)
        assert await db.schools.count_documents({}) == 0, "no junk school"
        assert res["school_id"] is None
        c = await db.contacts.find_one({"contact_id": "con_solo"})
        assert c is not None
        assert c.get("school_id") in (None, "")
    _run(go())


def test_contacts_only_update_keeps_existing_school_link(db):
    async def go():
        await db.schools.insert_one({
            "school_id": "sch_link", "school_name": "Linked School",
            "is_deleted": False})
        await db.contacts.insert_one({
            "contact_id": "con_link", "school_id": "sch_link",
            "name": "Linked Person", "designation": "Principal"})

        row = {"contact_id": "con_link", "name": "Linked Person",
               "designation": "Director"}
        await ie.commit_row(db, row, IMPORTER, create_leads=False,
                            allow_school_create=False)

        c = await db.contacts.find_one({"contact_id": "con_link"})
        assert c["school_id"] == "sch_link", "must not unlink the parent school"
        assert c["designation"] == "Director"
    _run(go())


def test_default_still_creates_a_school(db):
    async def go():
        row = {"school_name": "Fresh School", "name": "Fresh Person"}
        res = await ie.commit_row(db, row, IMPORTER, create_leads=False)
        assert res["school_id"] is not None
        assert await db.schools.count_documents({}) == 1
    _run(go())


def _csv_bytes(header: str, rows: list) -> bytes:
    return ("\n".join([header] + rows)).encode("utf-8")


def test_round_trip_updates_instead_of_duplicating(db):
    """The headline case: export -> edit -> re-upload updates the record."""
    async def go():
        await db.schools.insert_one({
            "school_id": "sch_rt", "school_name": "Round Trip School",
            "is_deleted": False})
        await db.contacts.insert_one({
            "contact_id": "con_rt", "school_id": "sch_rt",
            "name": "Alka Kapur", "phone": "1141427627",
            "email": "alka@example.com", "designation": "Principal"})

        # Exactly the export's column order, with phone and email left blank
        # and designation edited — the owner's real workflow.
        row = {
            "contact_id": "con_rt", "name": "Alka Kapur", "phone": "",
            "email": "", "school_name": "Round Trip School",
            "school_id": "sch_rt", "designation": "Director",
        }
        await ie.commit_row(db, row, IMPORTER, create_leads=False,
                            allow_school_create=False)

        assert await db.contacts.count_documents({}) == 1, "must update, not duplicate"
        c = await db.contacts.find_one({"contact_id": "con_rt"})
        assert c["designation"] == "Director"
        assert c["email"] == "alka@example.com"
        assert c["phone"] == "1141427627"
    _run(go())


def test_supplied_contact_id_is_honoured_on_create(db):
    async def go():
        await db.schools.insert_one({
            "school_id": "sch_sup", "school_name": "Supplied School",
            "is_deleted": False})
        row = {"contact_id": "con_chosen", "school_id": "sch_sup",
               "name": "Chosen Id"}
        await ie.commit_row(db, row, IMPORTER, create_leads=False,
                            allow_school_create=False)
        assert await db.contacts.find_one({"contact_id": "con_chosen"}) is not None
    _run(go())


def test_row_with_name_but_no_phone_is_imported(db):
    async def go():
        await db.schools.insert_one({
            "school_id": "sch_np", "school_name": "No Phone School",
            "is_deleted": False})
        row = {"school_id": "sch_np", "name": "Harsimran Kaur Kapany"}
        await ie.commit_row(db, row, IMPORTER, create_leads=False,
                            allow_school_create=False)
        c = await db.contacts.find_one({"name": "Harsimran Kaur Kapany"})
        assert c is not None, "most exported rows have no phone and must still import"
    _run(go())


# The exact header row emitted by GET /export/contacts (admin_routes.py:1569).
EXPORT_HEADERS = [
    "contact_id", "name", "phone", "email", "company", "school_id",
    "designation", "source", "notes", "birthday", "assigned_to", "tags",
    "status", "converted", "lead_id", "created_at",
]


def test_export_headers_map_without_surprises(db):
    """Pin the mapping of our own export's columns.

    propose_mapping falls back to fuzzy matching at ratio >= 0.78, so an
    unmapped column can silently bind to an unrelated field. This asserts the
    columns we care about map correctly and that the ones we do not handle stay
    unmapped rather than fuzzing onto something else.
    """
    async def go():
        from field_registry import seed_field_definitions
        await seed_field_definitions(db)
        mapping = await ie.propose_mapping(db, EXPORT_HEADERS)
        by_source = {m["source"]: m["key"] for m in mapping}

        assert by_source["contact_id"] == "contact_id"
        assert by_source["school_id"] == "school_id"
        assert by_source["lead_id"] == "lead_id"
        assert by_source["name"] == "name"
        assert by_source["email"] == "email"
        assert by_source["phone"] == "phone"
        assert by_source["company"] == "school_name"
        assert by_source["designation"] == "designation"
        assert by_source["notes"] == "notes"
        assert by_source["tags"] == "tags"
        assert by_source["assigned_to"] == "assign_to"

        # Columns with no field definition must not fuzzy-bind to anything.
        for col in ("status", "converted", "created_at"):
            assert by_source[col] is None, (
                f"export column {col!r} fuzzy-mapped to {by_source[col]!r}; "
                "add an explicit field definition or tighten the alias table"
            )
    _run(go())


# ---------------------------------------------------------------------------
# Review round 1 fixes: ownership must not leak onto a school via a
# contacts-only import, and a valid contact_id must survive an ambiguous
# school match.
# ---------------------------------------------------------------------------

def test_contacts_import_never_reassigns_school_owner(db):
    """A rep re-uploading their OWN contacts export must not silently steal
    ownership of a school that already belongs to someone else — ownership
    drives row visibility, so this previously changed who could even see it."""
    async def go():
        await db.schools.insert_one({
            "school_id": "sch_owned", "school_name": "Owned School",
            "assigned_to": "real.owner@smartshape.in", "assigned_name": "Real Owner",
            "is_deleted": False})
        row = {"school_id": "sch_owned", "name": "Some Contact",
               "assign_to": "rep.reuploading@smartshape.in"}
        res = await ie.commit_row(db, row, IMPORTER, create_leads=False,
                                  allow_school_create=False)
        assert res["action"] == "update", "the school row itself is still resolved"
        sch = await db.schools.find_one({"school_id": "sch_owned"})
        assert sch["assigned_to"] == "real.owner@smartshape.in", (
            "contacts-only import (allow_school_create=False) must never "
            "reassign a school's owner"
        )
        assert sch["assigned_name"] == "Real Owner"
        # The contact itself is still owned by the CSV's assigned_to — only the
        # SCHOOL's ownership is protected, not the contact's.
        c = await db.contacts.find_one({"school_id": "sch_owned", "name": "Some Contact"})
        assert c["assigned_to"] == "rep.reuploading@smartshape.in"
    _run(go())


def test_master_import_still_reassigns_school_owner(db):
    """Guard against over-fixing: master-import (allow_school_create=True,
    the default) must keep reassigning an existing school's owner exactly as
    before — this task only scopes the fix to the contacts-only path."""
    async def go():
        await db.schools.insert_one({
            "school_id": "sch_reassign", "school_name": "Reassign School",
            "assigned_to": "old.owner@smartshape.in", "assigned_name": "Old Owner",
            "is_deleted": False})
        row = {"school_id": "sch_reassign", "school_name": "Reassign School",
               "name": "Some Contact", "assign_to": "new.owner@smartshape.in"}
        res = await ie.commit_row(db, row, IMPORTER, create_leads=False)  # allow_school_create=True (default)
        assert res["action"] == "update"
        sch = await db.schools.find_one({"school_id": "sch_reassign"})
        assert sch["assigned_to"] == "new.owner@smartshape.in", (
            "master-import (allow_school_create=True) behaviour must be unchanged"
        )
    _run(go())


def test_valid_contact_id_survives_ambiguous_school(db):
    """A contact carrying a well-formed contact_id must still upsert even when
    its school_name collides with 2+ duplicate schools (needs_review) — the
    owner has a real duplicate-school problem and this fires on real data."""
    async def go():
        for i in range(2):
            await db.schools.insert_one({
                "school_id": f"sch_dup{i}", "school_name": "Ambiguous School",
                "is_deleted": False})
        await db.contacts.insert_one({
            "contact_id": "con_ambig", "school_id": "sch_dup0",
            "name": "Ambiguous Contact", "designation": "Coordinator"})

        row = {"contact_id": "con_ambig", "name": "Ambiguous Contact",
               "school_name": "Ambiguous School", "designation": "Principal"}
        res = await ie.commit_row(db, row, IMPORTER, create_leads=False,
                                  allow_school_create=False)

        assert res["action"] == "skip_school", (
            "an ambiguous school match must downgrade to skip_school, not abort the row"
        )
        assert res["contact_action"] == "update"
        c = await db.contacts.find_one({"contact_id": "con_ambig"})
        assert c["designation"] == "Principal", "the contact must still be updated"
        assert c["school_id"] == "sch_dup0", "the contact's existing school link must be left alone"
    _run(go())


def test_ambiguous_school_without_contact_id_still_needs_review(db):
    """Without a supplied contact_id, an ambiguous school match must still be
    reported as needs_review — the downgrade is scoped to rows carrying a
    trustworthy id, not a general relaxation of the ambiguity guard."""
    async def go():
        for i in range(2):
            await db.schools.insert_one({
                "school_id": f"sch_dup2_{i}", "school_name": "Another Ambiguous School",
                "is_deleted": False})
        row = {"name": "No Id Contact", "school_name": "Another Ambiguous School"}
        res = await ie.commit_row(db, row, IMPORTER, create_leads=False,
                                  allow_school_create=False)
        assert res["action"] == "needs_review"
        assert await db.contacts.count_documents({}) == 0, "nothing should be written"
    _run(go())
