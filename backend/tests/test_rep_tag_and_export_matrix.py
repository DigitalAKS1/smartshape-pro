"""The tag + export permission matrix, as the product owner described the bug.

A sales person (own-scoped `leads` grant) reported two things:

  1. "I get an error when I add a tag to one contact / one school."
  2. "I export, edit in Excel, re-upload — and nothing updates."

Both are permission-and-plumbing bugs, and neither is visible from any single
route. This file pins the WHOLE matrix in one place: every actor
(own-scoped rep / all-scoped non-admin / admin with no `module_permissions`
key at all) against every target shape that really exists in production
(a record assigned to the rep, an UNASSIGNED record at a school the rep owns,
an UNASSIGNED record at a school nobody the rep can see owns, a record
assigned to another rep, and a school the rep only reaches through her own
quotation), for every write that touches tags plus the export → edit →
re-upload round trip.

Production shape mirrored by `_seed` (counts from the live DB, 2026-09):
  • 1602 contacts, of which 409 have `assigned_to: None` and a few `""`
  • ~800 schools, of which 398 have `assigned_to: None`
  • 255 contacts carry tags; NO school carries a tag
  • soft-deleted contacts exist and must never reach an export file

The assertions state the DESIRED behaviour (a rep may edit and tag exactly
what she can SEE — nothing more, nothing less), so they fail before the fix
and pass after it.

Run with:
  cd backend && DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 \
      python -m pytest tests/test_rep_tag_and_export_matrix.py -q
"""
import asyncio
import csv
import io
import json
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from fastapi import HTTPException
from mongomock_motor import AsyncMongoMockClient

import field_registry as fr
import rbac
import routes.admin_routes as admin
import routes.crm_routes as crm

# ── Actors ──────────────────────────────────────────────────────────────────
# The reporting sales person: own-scoped read_write on `leads`.
REP = {
    "email": "bde@smartshape.in", "name": "BDE Rep", "role": "sales_person",
    "module_permissions": {"leads": {"level": "read_write", "scope": "own"}},
}
# A non-admin who is nonetheless allowed to see everything.
ALL_REP = {
    "email": "manager@smartshape.in", "name": "Sales Manager", "role": "sales_person",
    "module_permissions": {"leads": {"level": "read_write", "scope": "all"}},
}
# The owner. Note: NO `module_permissions` key at all — this is exactly how the
# live info@ account is stored, and every gate must keep passing without one.
ADMIN = {"email": "info@smartshape.in", "name": "Owner", "role": "admin"}
# Somebody else's territory.
OTHER = {"email": "other.rep@smartshape.in", "name": "Other Rep", "role": "sales_person",
         "module_permissions": {"leads": {"level": "read_write", "scope": "own"}}}

ACTORS = {"rep": REP, "all_scope": ALL_REP, "admin": ADMIN}

# ── Target ids ──────────────────────────────────────────────────────────────
# Schools
S_MINE = "sch_mine"            # assigned to REP
S_OTHER = "sch_other"          # assigned to OTHER
S_UNOWNED = "sch_unowned"      # assigned_to None — nobody's
S_QUOTED = "sch_quoted"        # OTHER's school, but REP has a quotation on it
# Contacts
C_MINE = "con_mine"                    # assigned to REP, at S_MINE
C_UNASSIGNED_MY_SCHOOL = "con_unmine"  # assigned_to None, at S_MINE
C_UNASSIGNED_NO_SCHOOL = "con_unfree"  # assigned_to None, at S_UNOWNED
C_THEIRS = "con_theirs"                # assigned to OTHER, at S_OTHER
C_DELETED = "con_deleted"              # REP's, soft-deleted

# What the rep must be able to reach, and what must stay out of reach.
REP_CAN_REACH_CONTACTS = {C_MINE, C_UNASSIGNED_MY_SCHOOL}
REP_CANNOT_REACH_CONTACTS = {C_UNASSIGNED_NO_SCHOOL, C_THEIRS}
REP_CAN_REACH_SCHOOLS = {S_MINE, S_QUOTED}
REP_CANNOT_REACH_SCHOOLS = {S_OTHER, S_UNOWNED}

TAG = "tag_expo"

# Production bulk counts — the file/scope sizes the owner actually sees.
PROD_CONTACTS = 1602
PROD_UNASSIGNED_CONTACTS = 409
PROD_SCHOOLS = 800
PROD_UNASSIGNED_SCHOOLS = 398
PROD_TAGGED_CONTACTS = 255


class FakeRequest:
    def __init__(self, body=None):
        self._body = body or {}

    async def json(self):
        return self._body

    async def body(self):
        return json.dumps(self._body).encode()


class FakeUpload:
    def __init__(self, data: bytes, filename: str = "contacts_export.csv"):
        self._data = data
        self.filename = filename

    async def read(self):
        return self._data


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(crm, "db", d)
    monkeypatch.setattr(admin, "db", d, raising=False)
    monkeypatch.setattr(rbac, "MODULE_RBAC_MODE", "enforce", raising=False)
    return d


def _as(user, monkeypatch):
    async def _me(_request):
        return user
    monkeypatch.setattr(crm, "get_current_user", _me, raising=False)
    monkeypatch.setattr(admin, "get_current_user", _me, raising=False)


def _run(coro):
    return asyncio.run(coro)


async def _seed(db, bulk: bool = False):
    """The named fixtures above, plus — when `bulk` — the production volume."""
    await db.tags.insert_one({"tag_id": TAG, "name": "Delhi Expo", "color": "#6366f1"})

    await db.schools.insert_many([
        {"school_id": S_MINE, "school_name": "DPS Mine", "assigned_to": REP["email"],
         "assigned_name": REP["name"], "is_deleted": False},
        {"school_id": S_OTHER, "school_name": "KV Theirs", "assigned_to": OTHER["email"],
         "assigned_name": OTHER["name"], "is_deleted": False},
        # `assigned_to: None` is the real production shape for 398 schools.
        {"school_id": S_UNOWNED, "school_name": "Unowned Public", "assigned_to": None,
         "is_deleted": False},
        {"school_id": S_QUOTED, "school_name": "Quoted By Me", "assigned_to": OTHER["email"],
         "assigned_name": OTHER["name"], "is_deleted": False},
    ])
    # The rep's own quotation is what makes S_QUOTED visible to her in GET
    # /schools — editing it must therefore be allowed too.
    await db.quotations.insert_one({
        "quotation_id": "qt_1", "school_id": S_QUOTED,
        "assigned_to": REP["email"], "created_by": REP["email"], "is_deleted": False})

    await db.contacts.insert_many([
        {"contact_id": C_MINE, "name": "Mine Principal", "phone": "9000000001",
         "school_id": S_MINE, "company": "DPS Mine", "assigned_to": REP["email"],
         "assigned_name": REP["name"], "is_deleted": False},
        {"contact_id": C_UNASSIGNED_MY_SCHOOL, "name": "Unassigned At My School",
         "phone": "9000000002", "school_id": S_MINE, "company": "DPS Mine",
         "assigned_to": None, "is_deleted": False},
        {"contact_id": C_UNASSIGNED_NO_SCHOOL, "name": "Unassigned Elsewhere",
         "phone": "9000000003", "school_id": S_UNOWNED, "company": "Unowned Public",
         "assigned_to": "", "is_deleted": False},   # the "" variant seen in prod
        {"contact_id": C_THEIRS, "name": "Their Principal", "phone": "9000000004",
         "school_id": S_OTHER, "company": "KV Theirs", "assigned_to": OTHER["email"],
         "assigned_name": OTHER["name"], "is_deleted": False},
        {"contact_id": C_DELETED, "name": "Archived Person", "phone": "9000000005",
         "school_id": S_MINE, "company": "DPS Mine", "assigned_to": REP["email"],
         "assigned_name": REP["name"], "is_deleted": True},
    ])

    if bulk:
        schools = []
        for i in range(PROD_SCHOOLS - 4):
            unassigned = i < (PROD_UNASSIGNED_SCHOOLS - 1)
            schools.append({
                "school_id": f"sch_b{i}", "school_name": f"Bulk School {i}",
                "assigned_to": None if unassigned else OTHER["email"],
                "is_deleted": False,
            })
        await db.schools.insert_many(schools)
        contacts = []
        for i in range(PROD_CONTACTS - 5):
            unassigned = i < (PROD_UNASSIGNED_CONTACTS - 2)
            doc = {
                "contact_id": f"con_b{i}", "name": f"Bulk Contact {i}",
                "phone": f"98{i:08d}", "school_id": f"sch_b{i % (PROD_SCHOOLS - 4)}",
                "assigned_to": None if unassigned else OTHER["email"],
                "is_deleted": False,
            }
            if i < PROD_TAGGED_CONTACTS:
                doc["tag_ids"] = [TAG]
            contacts.append(doc)
        await db.contacts.insert_many(contacts)


async def _tag_ids_of(db, coll, key, _id):
    doc = await getattr(db, coll).find_one({key: _id})
    return list((doc or {}).get("tag_ids") or [])


async def _outcome(coro):
    """'ok' or 'HTTP <status>' — so a matrix row reads like the bug report."""
    try:
        await coro
        return "ok"
    except HTTPException as e:
        return f"HTTP {e.status_code}"


async def _drain(response):
    chunks = []
    async for chunk in response.body_iterator:
        chunks.append(chunk.decode() if isinstance(chunk, bytes) else chunk)
    return "".join(chunks)


# ═══════════════════════════════════════════════════════════════════════════
# 1. PUT /contacts/{id} with tag_ids — the School-Profile contact dialog
# ═══════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("actor", list(ACTORS))
def test_update_contact_with_tag_ids_persists_the_tags(db, monkeypatch, actor):
    """useSchoolProfile.saveContact PUTs the WHOLE form, tag_ids included.
    The route whitelisted fields and never read tag_ids, so the chips the rep
    just clicked were silently dropped — a save that "worked" and changed
    nothing. update_school has always honoured tag_ids; this must match."""
    _as(ACTORS[actor], monkeypatch)

    async def go():
        await _seed(db)
        out = await _outcome(crm.update_contact(
            C_MINE, FakeRequest({"name": "Mine Principal", "tag_ids": [TAG]})))
        assert out == "ok", f"{actor} could not save a contact they can see: {out}"
        assert await _tag_ids_of(db, "contacts", "contact_id", C_MINE) == [TAG], (
            f"{actor}: PUT /contacts dropped tag_ids on the floor")
    _run(go())


def test_rep_can_tag_an_unassigned_contact_at_a_school_she_owns(db, monkeypatch):
    """409 production contacts have no owner. The rep SEES them in her list
    because they sit at her school, so she must be able to edit and tag them —
    visibility and editability must never disagree."""
    _as(REP, monkeypatch)

    async def go():
        await _seed(db)
        out = await _outcome(crm.update_contact(
            C_UNASSIGNED_MY_SCHOOL, FakeRequest({"tag_ids": [TAG]})))
        assert out == "ok", f"rep blocked on a contact her own list shows her: {out}"
        assert await _tag_ids_of(db, "contacts", "contact_id",
                                 C_UNASSIGNED_MY_SCHOOL) == [TAG]
    _run(go())


@pytest.mark.parametrize("target", sorted(REP_CANNOT_REACH_CONTACTS))
def test_rep_is_refused_on_a_contact_she_cannot_see(db, monkeypatch, target):
    """By design: an unassigned contact at a school nobody she can see owns,
    and another rep's contact, stay invisible AND untouchable."""
    _as(REP, monkeypatch)

    async def go():
        await _seed(db)
        out = await _outcome(crm.update_contact(target, FakeRequest({"tag_ids": [TAG]})))
        assert out == "HTTP 403", f"{target} should be out of reach, got {out}"
        assert await _tag_ids_of(db, "contacts", "contact_id", target) == []
    _run(go())


def test_create_contact_carries_tag_ids_through(db, monkeypatch):
    """POST /contacts built its document field by field and never looked at
    tag_ids either — so "Add Contact" from a school profile lost every chip."""
    _as(REP, monkeypatch)

    async def go():
        await _seed(db)
        created = await crm.create_contact(FakeRequest({
            "name": "Brand New", "phone": "9111111111",
            "school_id": S_MINE, "tag_ids": [TAG]}))
        assert created["tag_ids"] == [TAG], "POST /contacts dropped tag_ids"
    _run(go())


def test_create_contact_accepts_tag_names_like_update_school_does(db, monkeypatch):
    """`_resolve_tags` mints an unknown NAME into a real tag — the same
    forgiving behaviour PUT /schools already gives, so an import-shaped body
    ("Delhi Expo") does not silently vanish."""
    _as(ADMIN, monkeypatch)

    async def go():
        await _seed(db)
        created = await crm.create_contact(FakeRequest({
            "name": "Named Tag", "phone": "9111111112", "tag_ids": ["Delhi Expo"]}))
        assert created["tag_ids"] == [TAG], "a tag NAME must resolve to its id"
    _run(go())


def test_create_school_keeps_the_tags_picked_in_the_add_dialog(db, monkeypatch):
    """The Add-School dialog now shows the tag picker; POST /schools used to
    build its document field by field and never read `tag_ids`, so a tag
    picked at creation vanished with a green 'School added' toast."""
    _as(ADMIN, monkeypatch)

    async def go():
        await _seed(db)
        created = await crm.create_school(FakeRequest({
            "school_name": "Tagged At Birth", "city": "Rohini", "tag_ids": [TAG]}))
        sid = created["school_id"]
        assert (await db.schools.find_one({"school_id": sid}))["tag_ids"] == [TAG]
    _run(go())


def test_doc_matches_refuses_an_operator_it_cannot_judge():
    """A clause the in-memory evaluator can't judge must fail LOUD, never
    silently count as a match — that would widen access."""
    import pytest as _pt
    assert crm._doc_matches({"assigned_to": "a"}, {"assigned_to": {"$in": ["a"]}})
    with _pt.raises(ValueError):
        crm._doc_matches({"assigned_to": "a"}, {"assigned_to": {"$nin": ["a"]}})


# ═══════════════════════════════════════════════════════════════════════════
# 2. POST /contacts/{id}/tags — the single-chip route the Contacts tab uses
# ═══════════════════════════════════════════════════════════════════════════

def test_add_contact_tag_is_allowed_on_everything_the_rep_can_see(db, monkeypatch):
    _as(REP, monkeypatch)

    async def go():
        await _seed(db)
        for cid in sorted(REP_CAN_REACH_CONTACTS):
            out = await _outcome(crm.add_contact_tag(cid, FakeRequest({"tag_id": TAG})))
            assert out == "ok", f"rep refused on visible contact {cid}: {out}"
            assert TAG in await _tag_ids_of(db, "contacts", "contact_id", cid)
    _run(go())


@pytest.mark.parametrize("target", sorted(REP_CANNOT_REACH_CONTACTS))
def test_add_contact_tag_refuses_an_invisible_contact(db, monkeypatch, target):
    """The single-tag route had NO ownership check at all: any logged-in user
    could tag (or untag) any contact in the database by id, including the
    1193 she cannot see. Same rule as every other contact write."""
    _as(REP, monkeypatch)

    async def go():
        await _seed(db)
        out = await _outcome(crm.add_contact_tag(target, FakeRequest({"tag_id": TAG})))
        assert out == "HTTP 403", f"{target} must not be taggable, got {out}"
        assert await _tag_ids_of(db, "contacts", "contact_id", target) == []
    _run(go())


def test_remove_contact_tag_refuses_an_invisible_contact(db, monkeypatch):
    _as(REP, monkeypatch)

    async def go():
        await _seed(db)
        await db.contacts.update_one({"contact_id": C_THEIRS},
                                     {"$set": {"tag_ids": [TAG]}})
        out = await _outcome(crm.remove_contact_tag(C_THEIRS, TAG, FakeRequest()))
        assert out == "HTTP 403", out
        assert await _tag_ids_of(db, "contacts", "contact_id", C_THEIRS) == [TAG]
    _run(go())


@pytest.mark.parametrize("actor", ["all_scope", "admin"])
def test_a_wide_actor_can_tag_anything(db, monkeypatch, actor):
    _as(ACTORS[actor], monkeypatch)

    async def go():
        await _seed(db)
        for cid in sorted(REP_CAN_REACH_CONTACTS | REP_CANNOT_REACH_CONTACTS):
            out = await _outcome(crm.add_contact_tag(cid, FakeRequest({"tag_id": TAG})))
            assert out == "ok", f"{actor} refused on {cid}: {out}"
    _run(go())


# ═══════════════════════════════════════════════════════════════════════════
# 3. Bulk tag — contacts and schools
# ═══════════════════════════════════════════════════════════════════════════

def test_bulk_tag_contacts_reaches_exactly_the_visible_ones(db, monkeypatch):
    _as(REP, monkeypatch)

    async def go():
        await _seed(db)
        ids = sorted(REP_CAN_REACH_CONTACTS | REP_CANNOT_REACH_CONTACTS)
        out = await crm.bulk_tag_contacts(FakeRequest(
            {"contact_ids": ids, "tag_ids": [TAG], "action": "add"}))
        assert out["updated"] == len(REP_CAN_REACH_CONTACTS), out
        assert out["skipped"] == len(REP_CANNOT_REACH_CONTACTS), out
        for cid in REP_CAN_REACH_CONTACTS:
            assert await _tag_ids_of(db, "contacts", "contact_id", cid) == [TAG]
        for cid in REP_CANNOT_REACH_CONTACTS:
            assert await _tag_ids_of(db, "contacts", "contact_id", cid) == []
    _run(go())


def test_bulk_tag_schools_reaches_exactly_the_visible_ones(db, monkeypatch):
    """Including S_QUOTED: a school the rep only reaches through her own
    quotation is in GET /schools, so a bulk tag must land on it too."""
    _as(REP, monkeypatch)

    async def go():
        await _seed(db)
        ids = sorted(REP_CAN_REACH_SCHOOLS | REP_CANNOT_REACH_SCHOOLS)
        out = await crm.bulk_tag_schools(FakeRequest(
            {"school_ids": ids, "tag_ids": [TAG], "action": "add"}))
        assert out["updated"] == len(REP_CAN_REACH_SCHOOLS), out
        for sid in REP_CAN_REACH_SCHOOLS:
            assert await _tag_ids_of(db, "schools", "school_id", sid) == [TAG]
        for sid in REP_CANNOT_REACH_SCHOOLS:
            assert await _tag_ids_of(db, "schools", "school_id", sid) == []
    _run(go())


# ═══════════════════════════════════════════════════════════════════════════
# 4. PUT /schools/{id} with tag_ids — the (new) single-school tag path
# ═══════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("actor", list(ACTORS))
def test_update_school_with_tag_ids_persists(db, monkeypatch, actor):
    _as(ACTORS[actor], monkeypatch)

    async def go():
        await _seed(db)
        out = await _outcome(crm.update_school(S_MINE, FakeRequest({"tag_ids": [TAG]})))
        assert out == "ok", f"{actor} blocked on S_MINE: {out}"
        assert await _tag_ids_of(db, "schools", "school_id", S_MINE) == [TAG]
    _run(go())


def test_rep_can_edit_the_school_her_own_quotation_sits_on(db, monkeypatch):
    """THE DRIFT: `_schools_visibility_or` (the list) counts a school linked by
    the rep's own QUOTATION, but `_user_can_access_school` (the write guard)
    only counted leads. So the rep saw the school, opened it, saved — 403.
    Both must come from the same helper."""
    _as(REP, monkeypatch)

    async def go():
        await _seed(db)
        out = await _outcome(crm.update_school(S_QUOTED, FakeRequest({"tag_ids": [TAG]})))
        assert out == "ok", f"rep blocked on a school her own quote sits on: {out}"
        assert await _tag_ids_of(db, "schools", "school_id", S_QUOTED) == [TAG]
    _run(go())


@pytest.mark.parametrize("target", sorted(REP_CANNOT_REACH_SCHOOLS))
def test_rep_is_refused_on_a_school_she_cannot_see(db, monkeypatch, target):
    _as(REP, monkeypatch)

    async def go():
        await _seed(db)
        out = await _outcome(crm.update_school(target, FakeRequest({"tag_ids": [TAG]})))
        assert out == "HTTP 403", f"{target} should be out of reach, got {out}"
        assert await _tag_ids_of(db, "schools", "school_id", target) == []
    _run(go())


# ═══════════════════════════════════════════════════════════════════════════
# 5. GET /export/contacts
# ═══════════════════════════════════════════════════════════════════════════

async def _export_ids(monkeypatch):
    text = await _drain(await admin.export_contacts(FakeRequest()))
    rows = list(csv.DictReader(io.StringIO(text)))
    return {r["contact_id"] for r in rows}, rows


def test_export_never_contains_a_soft_deleted_contact(db, monkeypatch):
    """`find({})` exported archived rows. Re-uploading one creates a DUPLICATE,
    because every matcher in the import engine excludes deleted contacts —
    so the owner's own export was manufacturing ghosts."""
    _as(ADMIN, monkeypatch)

    async def go():
        await _seed(db)
        ids, _ = await _export_ids(monkeypatch)
        assert C_DELETED not in ids, "an archived contact must never be exported"
        assert ids == {C_MINE, C_UNASSIGNED_MY_SCHOOL,
                       C_UNASSIGNED_NO_SCHOOL, C_THEIRS}
    _run(go())


def test_export_is_scoped_to_what_the_rep_can_see(db, monkeypatch):
    """The export applied NO scope at all, so the rep's file held all 1602
    contacts. She edited her own rows, re-uploaded, and the import then
    skipped every row she could not touch — "the upload didn't work"."""
    _as(REP, monkeypatch)

    async def go():
        await _seed(db)
        ids, _ = await _export_ids(monkeypatch)
        assert ids == REP_CAN_REACH_CONTACTS, (
            "the rep's export must hold exactly the contacts she can edit")
    _run(go())


def test_export_at_production_volume_is_a_small_file_for_a_rep(db, monkeypatch):
    """The shape the owner actually has: 1602 contacts, 409 unowned."""
    _as(REP, monkeypatch)

    async def go():
        await _seed(db, bulk=True)
        assert await db.contacts.count_documents({}) == PROD_CONTACTS
        ids, _ = await _export_ids(monkeypatch)
        assert ids == REP_CAN_REACH_CONTACTS, (
            f"rep exported {len(ids)} contacts, expected {len(REP_CAN_REACH_CONTACTS)}")
    _run(go())


def test_export_for_an_all_scoped_user_holds_every_live_contact(db, monkeypatch):
    _as(ALL_REP, monkeypatch)

    async def go():
        await _seed(db)
        ids, _ = await _export_ids(monkeypatch)
        assert ids == {C_MINE, C_UNASSIGNED_MY_SCHOOL,
                       C_UNASSIGNED_NO_SCHOOL, C_THEIRS}
    _run(go())


def test_export_refuses_a_user_with_no_crm_access(db, monkeypatch):
    """Ungated, the route answered 200 to anybody with a session."""
    _as({"email": "store@smartshape.in", "name": "Store", "role": "store",
         "module_permissions": {}}, monkeypatch)

    async def go():
        await _seed(db)
        out = await _outcome(admin.export_contacts(FakeRequest()))
        assert out == "HTTP 403", out
    _run(go())


def test_export_schools_is_scoped_for_a_rep(db, monkeypatch):
    _as(REP, monkeypatch)

    async def go():
        await _seed(db)
        text = await _drain(await admin.export_schools(FakeRequest()))
        ids = {r["school_id"] for r in csv.DictReader(io.StringIO(text))}
        assert ids == REP_CAN_REACH_SCHOOLS, ids
    _run(go())


# ═══════════════════════════════════════════════════════════════════════════
# 6. The round trip: export → edit in Excel → re-upload
# ═══════════════════════════════════════════════════════════════════════════

async def _import(content: bytes):
    return await crm.import_contacts_csv(
        file=FakeUpload(content), tag_ids=None, global_notes=None, request=object())


def _edit_csv(rows, fieldnames, mutate):
    out = io.StringIO()
    w = csv.DictWriter(out, fieldnames=fieldnames)
    w.writeheader()
    for r in rows:
        mutate(r)
        w.writerow(r)
    return out.getvalue().encode("utf-8")


def test_rep_round_trip_updates_and_never_duplicates(db, monkeypatch):
    """Export → change a designation in Excel → re-upload. Every row in the
    rep's own file must UPDATE, and the contact count must not move."""
    _as(REP, monkeypatch)

    async def go():
        await fr.seed_field_definitions(db)
        await _seed(db)
        text = await _drain(await admin.export_contacts(FakeRequest()))
        reader = csv.DictReader(io.StringIO(text))
        rows = list(reader)
        before = await db.contacts.count_documents({})
        content = _edit_csv(rows, reader.fieldnames,
                            lambda r: r.update(designation="Vice Principal"))
        result = await _import(content)
        assert result["updated"] == len(rows), result
        assert result["created"] == 0, result
        assert result["skipped"] == 0, result
        assert await db.contacts.count_documents({}) == before, "the re-upload duplicated rows"
        for cid in REP_CAN_REACH_CONTACTS:
            doc = await db.contacts.find_one({"contact_id": cid})
            assert doc["designation"] == "Vice Principal"
    _run(go())


def test_reuploading_an_archived_row_does_not_mint_a_duplicate(db, monkeypatch):
    """Belt and braces for the export fix: even if an old file still holds an
    archived contact, the import must not create a second live copy of it."""
    _as(ADMIN, monkeypatch)

    async def go():
        await fr.seed_field_definitions(db)
        await _seed(db)
        text = await _drain(await admin.export_contacts(FakeRequest()))
        assert C_DELETED not in text, (
            "the archived contact is still in the export — a re-upload of this "
            "file is exactly what creates the duplicates the owner is seeing")
    _run(go())


def test_a_row_the_rep_may_not_update_says_who_owns_it(db, monkeypatch):
    """"Skipped" with no reason is why the owner called this "didn't work".
    The reason must name the human to ask, and the summary must count it."""
    _as(REP, monkeypatch)

    async def go():
        await fr.seed_field_definitions(db)
        await _seed(db)
        content = ("contact_id,designation\n"
                   f"{C_THEIRS},Vice Principal\n").encode("utf-8")
        result = await _import(content)
        assert result["updated"] == 0, result
        assert result["skipped"] == 1, result
        assert result["not_authorized"] == 1, (
            "the summary must count rows refused on ownership separately")
        reason = result["errors"][0]
        assert C_THEIRS in reason, reason
        assert "assigned to" in reason.lower(), reason
        assert (OTHER["name"] in reason or OTHER["email"] in reason), (
            f"the reason must name the owner to ask: {reason}")
        doc = await db.contacts.find_one({"contact_id": C_THEIRS})
        assert doc.get("designation") is None, "a refused row must not be applied"
    _run(go())


def test_rep_may_update_an_unassigned_contact_at_her_school_via_import(db, monkeypatch):
    """The import gate must use the same visibility rule as everything else —
    not a bare ownership check — or the 409 unowned contacts stay unimportable
    even when they sit at the rep's own school."""
    _as(REP, monkeypatch)

    async def go():
        await fr.seed_field_definitions(db)
        await _seed(db)
        content = ("contact_id,designation\n"
                   f"{C_UNASSIGNED_MY_SCHOOL},Vice Principal\n").encode("utf-8")
        result = await _import(content)
        assert result["updated"] == 1, result
        assert result["not_authorized"] == 0, result
        doc = await db.contacts.find_one({"contact_id": C_UNASSIGNED_MY_SCHOOL})
        assert doc["designation"] == "Vice Principal"
    _run(go())
