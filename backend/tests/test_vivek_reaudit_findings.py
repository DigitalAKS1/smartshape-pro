"""Vivek re-audit (2026-07-13) — 3 HIGH + 1 MED gaps found by going deeper on the
same two mechanisms (schools/merge, repair/phones). Fixed by Dhruv same day.

These tests originally reproduced the gaps (they PASSED against the gapped code).
They are now INVERTED: each asserts the SAFE, fixed behavior and stands as a
permanent regression guard.

mongomock_motor, NO live DB. Run:
    DB_NAME=smartshape_test python -m pytest tests/test_vivek_reaudit_findings.py -q
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

OWNER = {"email": "info@smartshape.in", "role": "admin", "name": "Owner"}


def _run(coro):
    return asyncio.run(coro)


class _Req:
    def __init__(self, body=None):
        self._body = body or {}

    async def json(self):
        return self._body


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
# FINDING A (HIGH) — FIXED. field_visits (rep GPS check-in/out, field_routes;
# admin export/dashboard) carries school_id and is read with a school_name
# fallback, but was missing from BOTH merge's _SCHOOL_ID_COLLECTIONS and
# cascade_delete.build_school_plan. A merge left every field visit of the
# duplicate pointing at a school_id it then deleted — a dangling FK even for
# perfectly clean rows. Now reassigned by merge AND cascaded by a school delete.
# ===========================================================================

def test_merge_moves_field_visits(db):
    async def go():
        await db.schools.insert_many([
            {"school_id": "surv", "school_name": "St. Xavier's High School"},
            {"school_id": "dup1", "school_name": "St Xaviers High School"},
        ])
        await db.field_visits.insert_one({
            "visit_id": "fv1", "school_id": "dup1",
            "school_name": "St Xaviers High School", "visit_date": "2026-07-01",
            "status": "visited", "rep_email": "rep@smartshape.in",
        })
        # a rep-created visit with NO school_id, only the duplicate's name
        await db.field_visits.insert_one({
            "visit_id": "fv2", "school_name": "St Xaviers High School",
            "status": "visited",
        })

        dry = await m.merge_schools(_Req(
            {"survivor_id": "surv", "merge_ids": ["dup1"], "dry_run": True}))
        assert dry["per_merge_moves"]["dup1"]["field_visits"] == 2   # preview is honest

        res = await m.merge_schools(_Req(
            {"survivor_id": "surv", "merge_ids": ["dup1"],
             "dry_run": False, "confirm": True, "reason": "dedup"}))
        assert res["moved"]["field_visits"] == 2

        # both visits now hang off the survivor — no dangling FK
        assert await db.field_visits.count_documents({"school_id": "dup1"}) == 0
        assert await db.field_visits.count_documents({"school_id": "surv"}) == 2
        fv = await db.field_visits.find_one({"visit_id": "fv1"}, {"_id": 0})
        assert fv["school_id"] == "surv"
        assert await db.schools.find_one({"school_id": fv["school_id"]}) is not None
    _run(go())


def test_school_cascade_delete_includes_field_visits(db):
    """The other half of finding A: a full school delete must snapshot + cascade
    field_visits, not silently orphan them."""
    async def go():
        school = {"school_id": "s1", "school_name": "Doomed School"}
        await db.schools.insert_one(school)
        await db.field_visits.insert_many([
            {"visit_id": "fv1", "school_id": "s1"},
            {"visit_id": "fv2", "school_name": "Doomed School"},   # name-only
        ])
        plan, label, _ = await cascade_delete.build_school_plan(school)
        assert any(coll == "field_visits" for coll, _q in plan)

        res = await m._bulk_delete_schools(
            ["s1"], dry_run=False, reason="cascade", actor=OWNER)
        assert res["deleted"] == 1
        # cascaded, not orphaned — and captured in the restorable backup
        assert await db.field_visits.count_documents({}) == 0
        manifest = await db.audit_backups.find_one(
            {"backup_id": res["backups"][0], "kind": ab.MANIFEST})
        assert manifest["counts"].get("field_visits") == 2
    _run(go())


# ===========================================================================
# FINDING B (HIGH) — FIXED. The name-fallback matched school_name by EXACT string
# equality while merge-candidate grouping uses _norm_school_name (mojibake repair +
# lower + whitespace collapse). So the exact shapes the normalizer exists to handle
# — case / double spaces / mojibake — slipped through and stayed orphaned. The
# fallback now matches on NORMALIZED name (Python-side post-filter), and the same
# resolved row set drives the counts, the child pre-image AND the reassignment.
# ===========================================================================

def test_merge_name_fallback_matches_case_whitespace_mojibake_variants(db):
    async def go():
        await db.schools.insert_many([
            {"school_id": "surv", "school_name": "St. Xavier's High School"},
            {"school_id": "dup1", "school_name": "St Xaviers High School"},
            # unrelated school that HAS its own school_id — must never be captured
            {"school_id": "other", "school_name": "Some Other School"},
        ])
        await db.quotations.insert_many([
            # case + double whitespace variant of dup1's name
            {"quotation_id": "Q_case", "school_name": "ST XAVIERS  HIGH SCHOOL",
             "grand_total": 250000},
            # mojibake variant
            {"quotation_id": "Q_moji", "school_name": "ST XAVIERSâ€™ HIGH SCHOOL",
             "grand_total": 100},
            # already owned by another school -> NOT ours, even though blank-ish name
            {"quotation_id": "Q_other", "school_id": "other",
             "school_name": "Some Other School"},
        ])

        dry = await m.merge_schools(_Req(
            {"survivor_id": "surv", "merge_ids": ["dup1"], "dry_run": True}))
        # the case/whitespace variant is now SEEN by the preview
        assert dry["per_merge_moves"]["dup1"]["quotations"] >= 1

        await m.merge_schools(_Req(
            {"survivor_id": "surv", "merge_ids": ["dup1"],
             "dry_run": False, "confirm": True}))

        q = await db.quotations.find_one({"quotation_id": "Q_case"}, {"_id": 0})
        assert q["school_id"] == "surv"                       # no longer orphaned
        assert q["school_name"] == "St. Xavier's High School"  # properly re-linked
        assert await db.schools.count_documents({"school_id": q["school_id"]}) == 1

        # no over-capture: the quotation owned by `other` is untouched
        qo = await db.quotations.find_one({"quotation_id": "Q_other"}, {"_id": 0})
        assert qo["school_id"] == "other"
    _run(go())


def test_name_fallback_normalizes_via_same_key_as_grouping(db):
    """The fallback key MUST be _norm_school_name — the same key duplicate-schools
    groups by — or the two disagree about what 'the same school' means."""
    async def go():
        await db.quotations.insert_many([
            {"quotation_id": "Q1", "school_name": "ST XAVIERS  HIGH SCHOOL"},
            {"quotation_id": "Q2", "school_name": "st xaviers high school"},
            {"quotation_id": "Q3", "school_name": "Totally Different"},
            {"quotation_id": "Q4", "school_id": "owned",
             "school_name": "St Xaviers High School"},   # has an owner -> excluded
        ])
        ids = await m._name_fallback_ids("quotations", "St Xaviers High School")
        assert set(ids) == {"Q1", "Q2"}

        # a blank merge name disables the fallback entirely (no blanket sweep)
        assert await m._name_fallback_ids("quotations", "") == []
        assert await m._name_fallback_ids("quotations", "   ") == []
    _run(go())


# ===========================================================================
# FINDING C (HIGH) — FIXED. Two SHORT values joined by a bare space (no separator
# char, no "ext"/"x" keyword) whose combined digits stayed under the E.164 cap slid
# past every guard and were silently rewritten: "9876543210 105" -> "9876543210105".
# _phone_category now flags a COMPLETE number (>=10 digits) followed by further
# whitespace-separated digit groups — while legitimately grouped single numbers
# ("+91 98765 43210", "0120 421 3000") stay 'recoverable'.
# ===========================================================================

def test_repair_phones_flags_short_space_joined_values(db):
    async def go():
        await db.contacts.insert_many([
            {"contact_id": "c_ext_noword", "phone": "9876543210 105"},    # 13 digits
            {"contact_id": "c_ext_noword2", "phone": "9876543210 1056"},  # 14 digits
            # legit spaced single numbers — MUST still normalize
            {"contact_id": "c_mob", "phone": "+91 98765 43210"},
            {"contact_id": "c_land", "phone": "0120 421 3000"},
        ])

        plan = await m._plan_phones()
        rec_ids = {t[1] for t in plan["contacts"]["recoverable"]}
        review_ids = {t[1] for t in plan["contacts"]["needs_review"]}
        assert {"c_ext_noword", "c_ext_noword2"} == review_ids
        assert {"c_mob", "c_land"} == rec_ids

        await m.repair_phones(_Req({"dry_run": False}))

        # the real numbers are PRESERVED verbatim and flagged, not fabricated
        c1 = await db.contacts.find_one({"contact_id": "c_ext_noword"}, {"_id": 0})
        assert c1["phone"] == "9876543210 105"      # NOT "9876543210105"
        assert c1["phone_needs_review"] is True
        c2 = await db.contacts.find_one({"contact_id": "c_ext_noword2"}, {"_id": 0})
        assert c2["phone"] == "9876543210 1056"
        assert c2["phone_needs_review"] is True

        # legit spaced numbers still get tidied
        mob = await db.contacts.find_one({"contact_id": "c_mob"}, {"_id": 0})
        assert mob["phone"] == "+919876543210"
        assert "phone_needs_review" not in mob
        land = await db.contacts.find_one({"contact_id": "c_land"}, {"_id": 0})
        assert land["phone"] == "01204213000"
        assert "phone_needs_review" not in land
    _run(go())


def test_phone_category_rule_table():
    """The discriminator, stated as a table — corruption cases vs legit numbers."""
    for v in ("9876543210 105", "9876543210 1056", "9876543210 9123456789",
              "9876543210 / 9123456789", "0120-4213000 ext 105"):
        assert m._phone_category(v) == "needs_review", v
    for v in ("+91 98765 43210", "0120 421 3000", "(0120) 421-3000",
              "+91 9876543210", "0120-4213000", "919000000002.0"):
        assert m._phone_category(v) == "recoverable", v
    assert m._phone_category("919000000005") == "clean"


# ===========================================================================
# FINDING D (MEDIUM) — FIXED. When 3+ live schools share a normalized name (chain
# names: "DAV Public School"), a blank-school_id legacy row matching that name is
# genuinely ambiguous. The truth isn't in the data, so the row still moves with the
# merge — but the operator now SEES the guess: the dry-run reports
# ambiguous_name_fallback_rows (count + samples + the rival school ids).
# ===========================================================================

def test_merge_surfaces_ambiguous_name_fallback(db):
    async def go():
        await db.schools.insert_many([
            {"school_id": "surv", "school_name": "DAV Public School"},
            {"school_id": "dup1", "school_name": "DAV Public School"},
            # a THIRD branch, same name, NOT part of this merge
            {"school_id": "other_branch", "school_name": "DAV Public School"},
        ])
        await db.quotations.insert_one({
            "quotation_id": "Q_ambiguous", "school_name": "DAV Public School"})

        dry = await m.merge_schools(_Req(
            {"survivor_id": "surv", "merge_ids": ["dup1"], "dry_run": True}))
        amb = dry["ambiguous_name_fallback_rows"]
        # the guess is SURFACED, not silent
        assert amb["count"] == 1
        assert amb["rival_schools"]["dup1"] == ["other_branch"]
        s = amb["samples"][0]
        assert s["collection"] == "quotations" and s["doc_id"] == "Q_ambiguous"
        assert s["also_matches_schools"] == ["other_branch"]
        assert "verify" in amb["note"].lower()

        res = await m.merge_schools(_Req(
            {"survivor_id": "surv", "merge_ids": ["dup1"],
             "dry_run": False, "confirm": True}))
        # still moved (ground truth is unknowable) — but it was declared up-front
        assert res["ambiguous_name_fallback_rows"]["count"] == 1
        q = await db.quotations.find_one({"quotation_id": "Q_ambiguous"}, {"_id": 0})
        assert q["school_id"] == "surv"
        assert await db.schools.count_documents({"school_id": "other_branch"}) == 1
    _run(go())


def test_no_ambiguity_reported_when_name_is_unique(db):
    async def go():
        await db.schools.insert_many([
            {"school_id": "surv", "school_name": "Unique School A"},
            {"school_id": "dup1", "school_name": "Unique School B"},
        ])
        await db.quotations.insert_one(
            {"quotation_id": "Q1", "school_name": "Unique School B"})
        dry = await m.merge_schools(_Req(
            {"survivor_id": "surv", "merge_ids": ["dup1"], "dry_run": True}))
        assert dry["ambiguous_name_fallback_rows"]["count"] == 0
        assert dry["per_merge_moves"]["dup1"]["quotations"] == 1   # still moves
    _run(go())
