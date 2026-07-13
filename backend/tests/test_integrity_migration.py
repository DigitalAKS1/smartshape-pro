"""Phase 4 — CRM link / phone integrity: detect + guarded dry-run migrations.

mongomock_motor (in-memory async Mongo), NO live DB. Python 3.14: every coro is
driven with asyncio.run (no implicit event loop).

Run:
    DB_NAME=smartshape_test python -m pytest tests/test_integrity_migration.py -q
"""
import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest

import routes.crm_maintenance_routes as m
import audit_backup as ab


class _Req:
    """Minimal stand-in; get_current_user is monkeypatched so it's never read.

    Carries a JSON body so the migration endpoints can `await request.json()`.
    """
    def __init__(self, body=None):
        self._body = body or {}

    async def json(self):
        return self._body


def _run(coro):
    return asyncio.run(coro)


# The owner account — passes require_superadmin.
OWNER = {"email": "info@smartshape.in", "role": "admin", "name": "Owner"}


@pytest.fixture()
def db(monkeypatch):
    from mongomock_motor import AsyncMongoMockClient
    d = AsyncMongoMockClient()["smartshape_test"]
    # Wire the same handle into every module that reaches for `db`.
    monkeypatch.setattr(m, "db", d)
    monkeypatch.setattr(ab, "db", d)

    async def _fake_user(request):
        return OWNER
    monkeypatch.setattr(m, "get_current_user", _fake_user)
    return d


# ===========================================================================
# _phone_category — the classifier the repair/detect passes share
# ===========================================================================

def test_phone_category():
    assert m._phone_category(None) == "empty"
    assert m._phone_category("") == "empty"
    assert m._phone_category("   ") == "empty"
    assert m._phone_category("919000000001") == "clean"
    assert m._phone_category("919000000002.0") == "recoverable"   # trailing .0
    assert m._phone_category("+91 90000 00003") == "recoverable"  # spaces/+
    assert m._phone_category(919000000004.0) == "recoverable"     # float
    assert m._phone_category("9.19E+11") == "lossy"               # sci-notation
    assert m._phone_category("9.19999E+11") == "lossy"


# ===========================================================================
# 1. integrity-detect (read-only)
# ===========================================================================

async def _seed_detect(db):
    await db.leads.insert_many([
        # canonical + consistent
        {"lead_id": "lead_A", "contact_id": "c_ok", "school_id": "s_named"},
        # legacy convert link, contact_id blank -> cfc_no_contact_id
        {"lead_id": "lead_B", "converted_from_contact": "c_conv"},
        # dangling: contact missing
        {"lead_id": "lead_C", "contact_id": "c_missing"},
        # dangling: contact soft-deleted
        {"lead_id": "lead_D", "contact_id": "c_deleted"},
        # valid contact but no back-pointer -> lead_contact_id_no_backref
        {"lead_id": "lead_E", "contact_id": "c_nobackref"},
        # live child of a soft-deleted school
        {"lead_id": "lead_del", "school_id": "s_del"},
        # duplicate lead_id
        {"lead_id": "ldup"},
        {"lead_id": "ldup"},
    ])
    await db.contacts.insert_many([
        {"contact_id": "c_ok", "name": "OK", "lead_id": "lead_A",
         "converted_to_lead": True},
        {"contact_id": "c_conv", "name": "Conv", "lead_id": "lead_B",
         "converted_to_lead": True},
        {"contact_id": "c_deleted", "name": "Gone", "is_deleted": True},
        {"contact_id": "c_nobackref", "name": "NoRef", "converted_to_lead": False},
        # converted flag set but no lead points back -> contacts_converted_no_lead
        {"contact_id": "c_orphan", "name": "Orphan", "converted_to_lead": True},
    ])
    await db.schools.insert_many([
        {"school_id": "s_named", "school_name": "Named", "phone": "919000000001"},
        {"school_id": "s_float", "school_name": "Float", "phone": 919000000002.0},
        {"school_id": "s_sci", "school_name": "Sci", "phone": "9.19E+11"},
        {"school_id": "sdup", "school_name": "Dup1", "phone": ""},
        {"school_id": "sdup", "school_name": "Dup2", "phone": "919000000003"},
        {"school_id": "s_del", "school_name": "Del", "phone": "919000000004",
         "is_deleted": True},
    ])


def test_integrity_detect_counts(db):
    async def go():
        await _seed_detect(db)
        rep = await m.integrity_detect(_Req())

        links = rep["links"]
        assert links["converted_from_no_contact_id"] == 1   # lead_B
        assert links["dangling_contact_id"] == 2            # lead_C, lead_D
        assert links["lead_contact_id_no_backref"] == 1     # lead_E
        assert links["contacts_converted_no_lead"] == 1     # c_orphan

        assert rep["duplicates"]["school_id"] == [{"value": "sdup", "count": 2}]
        assert rep["duplicates"]["lead_id"] == [{"value": "ldup", "count": 2}]

        assert rep["schools_soft_deleted_with_children"] == 1  # s_del has lead_del

        ph = rep["phones"]["schools"]
        assert ph["total"] == 6
        assert ph["clean"] == 3          # s_named, sdup#2, s_del
        assert ph["recoverable"] == 1    # s_float
        assert ph["lossy"] == 1          # s_sci
        assert ph["empty"] == 1          # sdup#1

    _run(go())


def test_integrity_detect_writes_nothing(db):
    async def go():
        await _seed_detect(db)
        before = (await db.leads.count_documents({}),
                  await db.contacts.count_documents({}),
                  await db.schools.count_documents({}),
                  await db.audit_backups.count_documents({}))
        await m.integrity_detect(_Req())
        after = (await db.leads.count_documents({}),
                 await db.contacts.count_documents({}),
                 await db.schools.count_documents({}),
                 await db.audit_backups.count_documents({}))
        assert before == after
    _run(go())


# ===========================================================================
# 2. unify-links
# ===========================================================================

async def _seed_unify(db):
    await db.leads.insert_many([
        # phase A: copy converted_from_contact -> blank contact_id, + phase B backref
        {"lead_id": "lead_1", "converted_from_contact": "cc1"},
        # phase B only: contact_id set, contact lacks back-pointer
        {"lead_id": "lead_2", "contact_id": "cc2"},
        # already consistent -> no change (idempotency baseline)
        {"lead_id": "lead_3", "contact_id": "cc3"},
        # dangling -> unify must NOT touch it
        {"lead_id": "lead_4", "contact_id": "gone"},
    ])
    await db.contacts.insert_many([
        {"contact_id": "cc1", "name": "One"},
        {"contact_id": "cc2", "name": "Two"},
        {"contact_id": "cc3", "name": "Three", "lead_id": "lead_3",
         "converted_to_lead": True},
    ])


def test_unify_dry_run_changes_nothing(db):
    async def go():
        await _seed_unify(db)
        res = await m.migrate_unify_links(_Req({"dry_run": True}))
        assert res["dry_run"] is True
        assert res["leads_would_set_contact_id"] == 1   # lead_1
        assert res["contacts_would_backref"] == 2       # cc1, cc2
        # nothing mutated
        l1 = await db.leads.find_one({"lead_id": "lead_1"}, {"_id": 0})
        assert "contact_id" not in l1 or not l1.get("contact_id")
        cc2 = await db.contacts.find_one({"contact_id": "cc2"}, {"_id": 0})
        assert not cc2.get("lead_id")
        assert await db.audit_backups.count_documents({}) == 0
    _run(go())


def test_unify_real_run_makes_link_consistent_and_snapshots(db):
    async def go():
        await _seed_unify(db)
        res = await m.migrate_unify_links(_Req({"dry_run": False, "reason": "phase4"}))
        assert res["dry_run"] is False
        assert res["leads_updated"] == 1
        assert res["contacts_updated"] == 2
        assert "backup_id" in res

        # lead_1: contact_id copied from converted_from_contact
        l1 = await db.leads.find_one({"lead_id": "lead_1"}, {"_id": 0})
        assert l1["contact_id"] == "cc1"
        # cc1 back-pointer + converted flag
        cc1 = await db.contacts.find_one({"contact_id": "cc1"}, {"_id": 0})
        assert cc1["lead_id"] == "lead_1" and cc1["converted_to_lead"] is True
        # cc2 back-pointer set for the contact_id-only lead
        cc2 = await db.contacts.find_one({"contact_id": "cc2"}, {"_id": 0})
        assert cc2["lead_id"] == "lead_2" and cc2["converted_to_lead"] is True
        # dangling lead untouched
        l4 = await db.leads.find_one({"lead_id": "lead_4"}, {"_id": 0})
        assert l4["contact_id"] == "gone"

        # pre-image snapshot exists (manifest + chunks)
        manifest = await db.audit_backups.find_one(
            {"backup_id": res["backup_id"], "kind": ab.MANIFEST})
        assert manifest is not None and manifest["migration"] is True
    _run(go())


def test_unify_is_idempotent(db):
    async def go():
        await _seed_unify(db)
        await m.migrate_unify_links(_Req({"dry_run": False}))
        # second pass: nothing left to do
        res2 = await m.migrate_unify_links(_Req({"dry_run": True}))
        assert res2["leads_would_set_contact_id"] == 0
        assert res2["contacts_would_backref"] == 0
    _run(go())


# ===========================================================================
# 3. dangling-contact-links
# ===========================================================================

async def _seed_dangling(db):
    await db.leads.insert_many([
        {"lead_id": "lead_x", "contact_id": "c_live"},
        {"lead_id": "lead_y", "contact_id": "c_dead",
         "converted_from_contact": "c_dead"},
        {"lead_id": "lead_z", "contact_id": "c_none",
         "converted_from_contact": "other"},
    ])
    await db.contacts.insert_many([
        {"contact_id": "c_live", "name": "Live"},
        {"contact_id": "c_dead", "name": "Dead", "is_deleted": True},
    ])


def test_dangling_dry_run(db):
    async def go():
        await _seed_dangling(db)
        res = await m.repair_dangling_contact_links(_Req({"dry_run": True}))
        assert res["leads_would_unset"] == 2   # lead_y (deleted), lead_z (missing)
        # not mutated
        assert (await db.leads.find_one({"lead_id": "lead_y"}))["contact_id"] == "c_dead"
        assert await db.audit_backups.count_documents({}) == 0
    _run(go())


def test_dangling_real_only_unsets_dangling(db):
    async def go():
        await _seed_dangling(db)
        res = await m.repair_dangling_contact_links(_Req({"dry_run": False}))
        assert res["leads_unset"] == 2
        assert "backup_id" in res

        # live lead untouched
        lx = await db.leads.find_one({"lead_id": "lead_x"}, {"_id": 0})
        assert lx["contact_id"] == "c_live"
        # deleted-contact lead: both matching fields unset
        ly = await db.leads.find_one({"lead_id": "lead_y"}, {"_id": 0})
        assert not ly.get("contact_id") and not ly.get("converted_from_contact")
        # missing-contact lead: contact_id unset, non-matching cfc preserved
        lz = await db.leads.find_one({"lead_id": "lead_z"}, {"_id": 0})
        assert not lz.get("contact_id")
        assert lz.get("converted_from_contact") == "other"
    _run(go())


# ===========================================================================
# 4. phones
# ===========================================================================

async def _seed_phones(db):
    await db.contacts.insert_many([
        {"contact_id": "ct_rec", "phone": "919000000002.0"},   # recoverable
        {"contact_id": "ct_lossy", "phone": "9.19E+11"},       # lossy
        {"contact_id": "ct_clean", "phone": "919000000005"},   # untouched
    ])


def test_phones_dry_run(db):
    async def go():
        await _seed_phones(db)
        res = await m.repair_phones(_Req({"dry_run": True}))
        assert res["per_collection"]["contacts"] == {
            "recoverable": 1, "lossy": 1, "needs_review": 0}
        assert res["totals"] == {"recoverable": 1, "lossy": 1, "needs_review": 0}
        # untouched
        ct = await db.contacts.find_one({"contact_id": "ct_rec"}, {"_id": 0})
        assert ct["phone"] == "919000000002.0" and "phone_norm" not in ct
        assert await db.audit_backups.count_documents({}) == 0
    _run(go())


def test_phones_real_fixes_recoverable_and_flags_lossy(db):
    async def go():
        await _seed_phones(db)
        res = await m.repair_phones(_Req({"dry_run": False, "reason": "phase4"}))
        assert "backup_id" in res

        rec = await db.contacts.find_one({"contact_id": "ct_rec"}, {"_id": 0})
        assert rec["phone"] == "919000000002" and rec["phone_norm"] == "919000000002"

        lossy = await db.contacts.find_one({"contact_id": "ct_lossy"}, {"_id": 0})
        assert lossy["phone"] == "9.19E+11"        # NOT touched
        assert lossy["phone_needs_reimport"] is True
        assert lossy["phone_norm"] == ""

        clean = await db.contacts.find_one({"contact_id": "ct_clean"}, {"_id": 0})
        assert clean["phone"] == "919000000005" and "phone_norm" not in clean
    _run(go())


# ===========================================================================
# 5 & 6. Forward-fixes in crm_routes (delete_contact, get_leads)
# ===========================================================================

@pytest.fixture()
def crm(monkeypatch):
    """Wire mongomock into crm_routes and bypass auth as the owner/admin."""
    import routes.crm_routes as cr
    from mongomock_motor import AsyncMongoMockClient
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(cr, "db", d)

    async def _fake_user(request):
        return OWNER
    monkeypatch.setattr(cr, "get_current_user", _fake_user)
    return cr, d


def test_delete_contact_unsets_pointing_lead(crm):
    cr, d = crm

    async def go():
        await d.contacts.insert_one({"contact_id": "cX", "name": "X", "school_id": "s1"})
        await d.leads.insert_many([
            {"lead_id": "L1", "contact_id": "cX", "school_id": "s1"},
            {"lead_id": "L2", "converted_from_contact": "cX", "school_id": "s1"},
        ])
        await cr.delete_contact("cX", _Req())

        l1 = await d.leads.find_one({"lead_id": "L1"}, {"_id": 0})
        assert not l1.get("contact_id")            # canonical link cleared
        l2 = await d.leads.find_one({"lead_id": "L2"}, {"_id": 0})
        assert not l2.get("converted_from_contact")  # legacy link cleared
        cX = await d.contacts.find_one({"contact_id": "cX"}, {"_id": 0})
        assert cX["is_deleted"] is True
        assert not cX.get("lead_id") and not cX.get("converted_to_lead")
    _run(go())


def test_get_leads_shows_name_for_contact_id_only_lead(crm):
    cr, d = crm

    async def go():
        await d.schools.insert_one({"school_id": "sN", "school_name": "N School"})
        await d.contacts.insert_one({"contact_id": "cN", "name": "Neha", "school_id": "sN"})
        # contact_id-only link (no converted_from_contact) — the create/import style
        await d.leads.insert_one({
            "lead_id": "lN", "contact_id": "cN", "school_id": "sN",
            "stage": "new", "created_at": "2026-07-01T00:00:00",
        })
        leads = await cr.get_leads(_Req())
        row = next(l for l in leads if l["lead_id"] == "lN")
        assert row["linked_contact_name"] == "Neha"
    _run(go())
