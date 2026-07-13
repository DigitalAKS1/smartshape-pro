"""Vivek round-3 re-audit (2026-07-13) — findings E / F / G. Fixed by Dhruv same day.

The gap-proving tests are now INVERTED (they assert the safe, fixed behavior) and the
positive re-verification tests are kept as-is. Together they are the permanent
regression guard for the merge name-fallback machinery and the phone classifier.

mongomock_motor, NO live DB. Run:
    DB_NAME=smartshape_test python -m pytest tests/test_vivek_round3_findings.py -q
"""
import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

import audit_backup as ab
import cascade_delete
import routes.crm_maintenance_routes as m
from import_engine import normalize_phone

OWNER = {"email": "info@smartshape.in", "role": "admin", "name": "Owner"}


def _run(coro):
    return asyncio.run(coro)


class _Req:
    def __init__(self, body=None):
        self._body = body or {}

    async def json(self):
        return self._body


class _ReqBulk(_Req):
    pass


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(m, "db", d)
    monkeypatch.setattr(ab, "db", d)
    monkeypatch.setattr(cascade_delete, "db", d)

    async def _fake_user(request):
        return OWNER
    monkeypatch.setattr(m, "get_current_user", _fake_user)
    return d


# ===========================================================================
# FINDING E (MEDIUM) — FIXED. When 2+ merge_ids in ONE call normalize to the same
# school name, a single blank-school_id row is legitimately claimed by BOTH, and the
# old code SUMMED the per-merge_id counts — reporting 2 quotations for a DB holding 1.
# The aggregate is now computed by set-deduping doc ids (_distinct_moved_totals), so
# the blast radius an operator reviews is the true row count. The per-merge_id
# breakdown still shows each duplicate's claim (that overlap is real information).
# ===========================================================================

async def _seed_double_claim(db):
    await db.schools.insert_many([
        {"school_id": "surv", "school_name": "St Xavier's High School"},
        {"school_id": "dup1", "school_name": "St Xaviers High School"},
        {"school_id": "dup2", "school_name": "ST XAVIERS  HIGH SCHOOL"},
    ])
    await db.quotations.insert_one({
        "quotation_id": "Q_shared", "school_name": "ST XAVIERS HIGH SCHOOL",
    })


def test_merge_dry_run_dedupes_shared_name_fallback_row(db):
    async def go():
        await _seed_double_claim(db)
        dry = await m.merge_schools(_Req(
            {"survivor_id": "surv", "merge_ids": ["dup1", "dup2"], "dry_run": True}))
        # each duplicate still legitimately CLAIMS the row (real information) ...
        assert dry["per_merge_moves"]["dup1"]["quotations"] == 1
        assert dry["per_merge_moves"]["dup2"]["quotations"] == 1
        # ... but the AGGREGATE is the true distinct count: ONE quotation exists.
        assert dry["moved"]["quotations"] == 1
        assert await db.quotations.count_documents({}) == 1
        # the survivor's projected total is likewise not inflated
        assert dry["survivor_children_after"]["quotations"] == 1
    _run(go())


def test_merge_real_run_moved_count_not_inflated_despite_double_claim(db):
    """Kept from the original audit: the COMMITTED result was always correct
    (the 2nd, now-no-op update_many reports modified_count=0, and audit_backup's
    $or-merge-per-collection dedupes the physical backup)."""
    async def go():
        await _seed_double_claim(db)
        res = await m.merge_schools(_Req(
            {"survivor_id": "surv", "merge_ids": ["dup1", "dup2"],
             "dry_run": False, "confirm": True}))
        assert res["moved"]["quotations"] == 1
        q = await db.quotations.find_one({"quotation_id": "Q_shared"}, {"_id": 0})
        assert q["school_id"] == "surv"
        manifest = await db.audit_backups.find_one(
            {"backup_id": res["child_preimage_backup_id"], "kind": ab.MANIFEST})
        assert manifest["counts"].get("quotations", 0) == 1
    _run(go())


def test_ambiguity_count_dedupes_shared_row(db):
    """The ambiguity counter is deduped by (collection, doc_id) too — one shared row
    claimed by two merge_ids is ONE ambiguous row."""
    async def go():
        await _seed_double_claim(db)
        # a third live school with the same normalized name, outside the merge
        await db.schools.insert_one(
            {"school_id": "other", "school_name": "St Xaviers High School"})
        dry = await m.merge_schools(_Req(
            {"survivor_id": "surv", "merge_ids": ["dup1", "dup2"], "dry_run": True}))
        assert dry["ambiguous_name_fallback_rows"]["count"] == 1   # not 2
    _run(go())


# ===========================================================================
# FINDING F (MEDIUM) — FIXED. _has_trailing_extra_group false-positived on a single
# valid mobile split into many small groups ("+91 98 765 432 10", a paste artifact):
# the 10-digit threshold was crossed early with a group still to come, so a perfectly
# repairable number was flagged and never normalized. The rule now ALSO requires the
# trailing run to be a plausible extension (>= 3 digits) — so a 1-2 digit tail no
# longer disqualifies an otherwise-normal number.
# ===========================================================================

def test_phone_odd_grouping_of_single_number_is_repaired(db):
    async def go():
        raw = "+91 98 765 432 10"
        assert normalize_phone(raw) == "+919876543210"    # normalizing it IS correct
        assert m._phone_category(raw) == "recoverable"    # no longer false-flagged

        await db.contacts.insert_one({"contact_id": "c1", "phone": raw})
        await m.repair_phones(_Req({"dry_run": False}))
        c1 = await db.contacts.find_one({"contact_id": "c1"}, {"_id": 0})
        assert "phone_needs_review" not in c1
        assert c1["phone"] == "+919876543210"             # actually repaired
        assert c1["phone_norm"] == "+919876543210"
    _run(go())


def test_phone_rule_table_after_extension_length_guard():
    """The full discriminator, stated as a table. A COMPLETE number (>=10 digits)
    followed by a run of >=3 digits is an extension/second number -> needs_review.
    Anything else that normalizes to one plausible number stays repairable."""
    for v in ("9876543210 105",        # 10 + 3  -> extension
              "09876543210 105",       # 11 + 3  -> extension
              "98765 43210 105",       # 10 + 3  -> extension (split prefix)
              "9876543210 1056",       # 10 + 4
              "9876543210 9123456789",  # 10 + 10 -> second number
              "9876543210 / 9123456789",
              "0120-4213000 ext 105"):
        assert m._phone_category(v) == "needs_review", v

    for v in ("+91 98765 43210",       # no proper prefix reaches 10
              "0120 421 3000",
              "(0120) 421-3000",
              "987654321 0",           # prefix is only 9 digits
              "+91 98 765 432 10",     # prefix 10, tail 2 -> not an extension
              "+91 9876543210",
              "0120-4213000",
              "919000000002.0"):
        assert m._phone_category(v) == "recoverable", v

    assert m._phone_category("919000000005") == "clean"
    # Derived call, deliberately stated: a 1-digit tail is a stray keystroke, not an
    # extension, so this is repaired rather than flagged.
    assert m._phone_category("9876543210 0") == "recoverable"


# ===========================================================================
# FINDING G (MEDIUM/HIGH) — FIXED. contacts.company is a LOAD-BEARING legacy link:
# import_engine stamps it on every imported contact, School-360 supplements the FK
# contacts list with a {"company": school_name} match, outbound email/WhatsApp
# personalization reads it, and admin_routes ships a dedicated backfill because
# "company set, school_id missing" is a known prod state.
#   (i)  a company-only contact was invisible to merge and stayed orphaned;
#   (ii) a contact reassigned via school_id kept the dead duplicate's `company` text.
# `contacts` is now a name-fallback collection keyed on `company` (_NAME_FIELD), and
# EVERY reassigned contact gets company := survivor's school_name.
# ===========================================================================

def test_merge_relinks_company_only_contact(db):
    async def go():
        await db.schools.insert_many([
            {"school_id": "surv", "school_name": "St. Xavier's High School"},
            {"school_id": "dup1", "school_name": "St Xaviers High School"},
        ])
        await db.contacts.insert_one({
            "contact_id": "c_legacy", "name": "Principal Rao",
            "company": "St Xaviers High School", "source": "import",
        })

        dry = await m.merge_schools(_Req(
            {"survivor_id": "surv", "merge_ids": ["dup1"], "dry_run": True}))
        assert dry["per_merge_moves"]["dup1"]["contacts"] == 1   # now visible

        res = await m.merge_schools(_Req(
            {"survivor_id": "surv", "merge_ids": ["dup1"],
             "dry_run": False, "confirm": True}))
        assert res["moved"]["contacts"] == 1

        c = await db.contacts.find_one({"contact_id": "c_legacy"}, {"_id": 0})
        assert c["school_id"] == "surv"                        # no longer orphaned
        assert c["company"] == "St. Xavier's High School"      # name synced
        # pre-imaged, so the merge stays reversible
        manifest = await db.audit_backups.find_one(
            {"backup_id": res["child_preimage_backup_id"], "kind": ab.MANIFEST})
        assert manifest["counts"].get("contacts", 0) == 1
    _run(go())


def test_merge_syncs_company_on_school_id_reassigned_contact(db):
    async def go():
        await db.schools.insert_many([
            {"school_id": "surv", "school_name": "St. Xavier's High School"},
            {"school_id": "dup1", "school_name": "St Xaviers High School"},
        ])
        await db.contacts.insert_one({
            "contact_id": "c_clean", "name": "VP Admissions",
            "school_id": "dup1", "company": "St Xaviers High School",
        })
        await m.merge_schools(_Req(
            {"survivor_id": "surv", "merge_ids": ["dup1"],
             "dry_run": False, "confirm": True}))
        c = await db.contacts.find_one({"contact_id": "c_clean"}, {"_id": 0})
        assert c["school_id"] == "surv"
        # what outbound personalization reads now names the SURVIVOR, not the
        # deleted duplicate.
        assert c["company"] == "St. Xavier's High School"
    _run(go())


def test_company_fallback_never_steals_a_contact_owned_by_another_school(db):
    async def go():
        await db.schools.insert_many([
            {"school_id": "surv", "school_name": "St. Xavier's High School"},
            {"school_id": "dup1", "school_name": "St Xaviers High School"},
            {"school_id": "other", "school_name": "St Xaviers High School"},
        ])
        # same company text, but ALREADY owned by `other` -> must not be touched
        await db.contacts.insert_one({
            "contact_id": "c_owned", "school_id": "other",
            "company": "St Xaviers High School"})
        await m.merge_schools(_Req(
            {"survivor_id": "surv", "merge_ids": ["dup1"],
             "dry_run": False, "confirm": True}))
        c = await db.contacts.find_one({"contact_id": "c_owned"}, {"_id": 0})
        assert c["school_id"] == "other"
        assert c["company"] == "St Xaviers High School"

        # and the fallback resolver itself honours the same rule + the blank-name guard
        ids = await m._name_fallback_ids("contacts", "St Xaviers High School")
        assert ids == []
        assert await m._name_fallback_ids("contacts", "") == []
    _run(go())


# ===========================================================================
# Positive re-verification of Fix A (field_visits) — kept from the original audit.
# ===========================================================================

def test_field_visits_fully_covered_by_merge(db):
    async def go():
        await db.schools.insert_many([
            {"school_id": "surv", "school_name": "St. Xavier's High School"},
            {"school_id": "dup1", "school_name": "St Xaviers High School"},
        ])
        await db.field_visits.insert_one({
            "visit_id": "fv1", "school_id": "dup1",
            "school_name": "St Xaviers High School", "visit_date": "2026-07-01",
        })
        dry = await m.merge_schools(_Req(
            {"survivor_id": "surv", "merge_ids": ["dup1"], "dry_run": True}))
        assert dry["per_merge_moves"]["dup1"].get("field_visits", 0) == 1

        res = await m.merge_schools(_Req(
            {"survivor_id": "surv", "merge_ids": ["dup1"],
             "dry_run": False, "confirm": True}))
        assert res["moved"].get("field_visits", 0) == 1
        fv = await db.field_visits.find_one({"visit_id": "fv1"}, {"_id": 0})
        assert fv["school_id"] == "surv"
        child_manifest = await db.audit_backups.find_one(
            {"backup_id": res["child_preimage_backup_id"], "kind": ab.MANIFEST})
        assert child_manifest["counts"].get("field_visits", 0) == 1
    _run(go())


def test_field_visits_cascade_deleted_and_snapshotted_on_plain_delete(db):
    async def go():
        await db.schools.insert_one(
            {"school_id": "s1", "school_name": "Solo School"})
        await db.field_visits.insert_one(
            {"visit_id": "fv2", "school_id": "s1", "school_name": "Solo School"})

        req = _ReqBulk({"school_ids": ["s1"], "dry_run": False, "confirm_count": 1})
        res = await m.bulk_delete_schools(req)
        assert res["deleted"] == 1
        assert await db.field_visits.count_documents({"school_id": "s1"}) == 0
        manifest = await db.audit_backups.find_one(
            {"backup_id": res["backups"][0], "kind": ab.MANIFEST})
        assert manifest["counts"].get("field_visits", 0) == 1
    _run(go())
