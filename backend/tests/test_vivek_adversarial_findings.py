"""Adversarial QA audit of crm_maintenance_routes.py destructive endpoints
(found by Vivek, 2026-07-13; fixed by Dhruv same day).

These tests originally reproduced 5 real defects (they PASSED against the buggy
code, proving the bugs). They are now INVERTED: each asserts the SAFE, fixed
behavior and is a permanent regression guard. A 6th test covers finding 5
(merge reversibility), which had no original repro.

mongomock_motor, NO live DB.
Run:
    DB_NAME=smartshape_test python -m pytest tests/test_vivek_adversarial_findings.py -q
"""
import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from fastapi import HTTPException
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
# FINDING 1 (CRITICAL) — FIXED. merge_schools must NOT orphan quotations/invoices
# that are linked by school_name only (no/blank school_id) — a real legacy shape
# (cascade_delete: "school_id (+ school_name on quotations/invoices)"; quotation
# routes only stamp school_id when the name resolved at save time).
# The merge now mirrors cascade_delete's name fallback for quotations/invoices,
# but ONLY for rows whose school_id is blank/absent AND whose school_name equals
# THAT duplicate's exact name. The dry-run counts them, so the preview is honest.
# ===========================================================================

async def _seed_merge_with_legacy_quotation(db):
    await db.schools.insert_many([
        {"school_id": "surv", "school_name": "St. Xavier's High School"},
        {"school_id": "dup1", "school_name": "St Xaviers High School"},
        # a THIRD, unrelated school that happens to share dup1's name but HAS its
        # own school_id — its quotation must NEVER be captured by the name fallback.
        {"school_id": "other", "school_name": "St Xaviers High School"},
    ])
    # Legacy quotation: only school_name (dup1's exact spelling), NO school_id.
    await db.quotations.insert_one({
        "quotation_id": "Q_legacy", "school_name": "St Xaviers High School",
        "grand_total": 500000,
    })
    # Properly-linked quotation owned by `other` — same name, but has a school_id.
    await db.quotations.insert_one({
        "quotation_id": "Q_other", "school_id": "other",
        "school_name": "St Xaviers High School", "grand_total": 111,
    })


def test_merge_reassigns_school_name_only_quotation(db):
    async def go():
        await _seed_merge_with_legacy_quotation(db)

        # (a) the dry-run is now HONEST — it sees the legacy quotation.
        dry = await m.merge_schools(_Req(
            {"survivor_id": "surv", "merge_ids": ["dup1"], "dry_run": True}))
        assert dry["per_merge_moves"]["dup1"] == {"quotations": 1}

        res = await m.merge_schools(_Req(
            {"survivor_id": "surv", "merge_ids": ["dup1"],
             "dry_run": False, "confirm": True, "reason": "dedup"}))
        assert res["moved"] == {"quotations": 1}

        # (b) the Rs 5,00,000 quotation is now properly linked to the survivor —
        # both school_id AND school_name, so it resolves to a live school.
        q = await db.quotations.find_one({"quotation_id": "Q_legacy"}, {"_id": 0})
        assert q["school_id"] == "surv"
        assert q["school_name"] == "St. Xavier's High School"
        assert await db.schools.find_one({"school_id": q["school_id"]}) is not None

        # (c) NO over-capture: the same-named quotation owned by `other` (which has
        # its own school_id) is untouched.
        qo = await db.quotations.find_one({"quotation_id": "Q_other"}, {"_id": 0})
        assert qo["school_id"] == "other"
        assert qo["school_name"] == "St Xaviers High School"
    _run(go())


# ===========================================================================
# FINDING 2 (HIGH) — FIXED. repair/phones must never fabricate a number.
# normalize_phone() strips ALL non-digits and concatenates the runs, so a
# multi-value cell ("a / b") or an embedded extension ("... ext 105") would be
# glued into one wrong number. _phone_category now classifies these
# 'needs_review': flagged, never rewritten. normalize_phone's own contract is
# unchanged (other callers depend on it).
# ===========================================================================

def test_repair_phones_flags_multi_value_and_extension_without_touching_them(db):
    async def go():
        await db.contacts.insert_many([
            {"contact_id": "c_multi", "phone": "9876543210 / 9123456789"},
            {"contact_id": "c_ext", "phone": "0120-4213000 ext 105"},
            # space-joined pair: no separator char, but too long to be one number
            {"contact_id": "c_long", "phone": "9876543210 9123456789"},
            # a genuinely recoverable single number — MUST still be normalized
            {"contact_id": "c_ok", "phone": "+91 98765 43210"},
        ])

        plan = await m._plan_phones()
        review_ids = {t[1] for t in plan["contacts"]["needs_review"]}
        rec_ids = {t[1] for t in plan["contacts"]["recoverable"]}
        assert {"c_multi", "c_ext", "c_long"} == review_ids
        assert rec_ids == {"c_ok"}          # the risky ones are NOT "recoverable"

        # dry-run surfaces what is being skipped
        dry = await m.repair_phones(_Req({"dry_run": True}))
        assert dry["totals"]["needs_review"] == 3
        assert dry["totals"]["recoverable"] == 1
        assert set(dry["skipped_samples"]["contacts"]) == {"c_multi", "c_ext", "c_long"}

        await m.repair_phones(_Req({"dry_run": False}))

        # the risky values are PRESERVED verbatim, and flagged for a human
        multi = await db.contacts.find_one({"contact_id": "c_multi"}, {"_id": 0})
        assert multi["phone"] == "9876543210 / 9123456789"   # NOT "98765432109123456789"
        assert multi["phone_needs_review"] is True
        assert multi["phone_norm"] == ""

        ext = await db.contacts.find_one({"contact_id": "c_ext"}, {"_id": 0})
        assert ext["phone"] == "0120-4213000 ext 105"        # NOT "01204213000105"
        assert ext["phone_needs_review"] is True

        lng = await db.contacts.find_one({"contact_id": "c_long"}, {"_id": 0})
        assert lng["phone"] == "9876543210 9123456789"
        assert lng["phone_needs_review"] is True

        # the honest single number still gets normalized
        ok = await db.contacts.find_one({"contact_id": "c_ok"}, {"_id": 0})
        assert ok["phone"] == "+919876543210" and ok["phone_norm"] == "+919876543210"
        assert "phone_needs_review" not in ok
    _run(go())


# ===========================================================================
# FINDING 3 (MEDIUM/HIGH) — FIXED. delete-blank-childless had a plan-then-execute
# TOCTOU gap: the childless id set was computed once, then reused at execute
# time, so a school that gained a lead in the gap was still swept away with it.
# _bulk_delete_schools(require_childless=True) now RE-CHECKS childlessness
# immediately before each delete and SKIPS any school that gained children.
# ===========================================================================

def test_delete_blank_childless_skips_school_that_gained_a_lead(db):
    async def go():
        await db.schools.insert_many([
            {"school_id": "b1", "school_name": ""},
            {"school_id": "b2", "school_name": ""},   # stays childless -> deleted
        ])

        # Step 1: compute the childless set — both qualify.
        ids = await m._blank_childless_ids()
        assert set(ids) == {"b1", "b2"}

        # Step 2 (the race): a rep attaches a lead to b1 in the gap.
        await db.leads.insert_one({"lead_id": "L_new", "school_id": "b1"})

        # Step 3: execute with the STALE id list (the blank-childless path).
        res = await m._bulk_delete_schools(
            ids, dry_run=False, reason="race", actor=OWNER, require_childless=True)

        # b1 is SKIPPED — school and its brand-new lead both survive.
        assert res["deleted"] == 1
        assert [s["school_id"] for s in res["skipped"]] == ["b1"]
        assert await db.schools.count_documents({"school_id": "b1"}) == 1
        assert await db.leads.count_documents({"lead_id": "L_new"}) == 1
        # b2 was genuinely childless and is gone.
        assert await db.schools.count_documents({"school_id": "b2"}) == 0
    _run(go())


def test_explicit_bulk_delete_still_cascades_children(db):
    """The re-check must NOT leak into the explicit bulk-delete path, where
    deleting a school WITH children is the whole point (a cascade)."""
    async def go():
        await db.schools.insert_one({"school_id": "s1", "school_name": "Real"})
        await db.leads.insert_one({"lead_id": "L1", "school_id": "s1"})
        res = await m._bulk_delete_schools(
            ["s1"], dry_run=False, reason="owner cascade", actor=OWNER)
        assert res["deleted"] == 1 and res["skipped"] == []
        assert await db.schools.count_documents({"school_id": "s1"}) == 0
        assert await db.leads.count_documents({"lead_id": "L1"}) == 0
    _run(go())


# ===========================================================================
# FINDING 4 (LOW) — FIXED. bulk-delete deduplicates school_ids BEFORE computing
# the confirm_count guard and the blast radius, so a repeated id can no longer
# inflate the dry-run preview (["s1","s1","s1"] used to report 3 schools) or the
# confirm_count, and only one backup manifest is written per real school.
# ===========================================================================

def test_bulk_delete_dedupes_duplicate_ids(db):
    async def go():
        await db.schools.insert_one({"school_id": "s1", "school_name": "Once"})
        await db.contacts.insert_one({"contact_id": "c1", "school_id": "s1"})

        dry = await m.bulk_delete_schools(_Req(
            {"school_ids": ["s1", "s1", "s1"], "dry_run": True}))
        assert dry["totals"]["schools"] == 1     # ONE school, reported once
        assert dry["totals"]["contacts"] == 1

        # confirm_count is now compared against the DISTINCT count -> raw 3 is rejected
        with pytest.raises(HTTPException) as e:
            await m.bulk_delete_schools(_Req(
                {"school_ids": ["s1", "s1", "s1"], "dry_run": False, "confirm_count": 3}))
        assert e.value.status_code == 400
        assert await db.schools.count_documents({"school_id": "s1"}) == 1  # untouched

        res = await m.bulk_delete_schools(_Req(
            {"school_ids": ["s1", "s1", "s1"], "dry_run": False, "confirm_count": 1}))
        assert await db.schools.count_documents({"school_id": "s1"}) == 0
        assert len(res["backups"]) == 1   # one real deletion -> one manifest
    _run(go())


# ===========================================================================
# FINDING 5 (MEDIUM) — FIXED. merge_schools now rejects a soft-deleted survivor
# or merge target (400), so live children can never be FK-reassigned onto a
# school that every list view filters out.
# ===========================================================================

def test_merge_rejects_soft_deleted_survivor_and_target(db):
    async def go():
        await db.schools.insert_many([
            {"school_id": "survdel", "school_name": "Ghost School", "is_deleted": True},
            {"school_id": "live", "school_name": "Live School"},
            {"school_id": "dupdel", "school_name": "Dead Dup", "is_deleted": True},
            {"school_id": "dup1", "school_name": "Ghost Skool"},
        ])
        await db.leads.insert_one({"lead_id": "L1", "school_id": "dup1"})

        # soft-deleted SURVIVOR -> 400
        with pytest.raises(HTTPException) as e1:
            await m.merge_schools(_Req(
                {"survivor_id": "survdel", "merge_ids": ["dup1"],
                 "dry_run": False, "confirm": True}))
        assert e1.value.status_code == 400
        assert "deleted" in e1.value.detail.lower()

        # soft-deleted MERGE TARGET -> 400
        with pytest.raises(HTTPException) as e2:
            await m.merge_schools(_Req(
                {"survivor_id": "live", "merge_ids": ["dupdel"],
                 "dry_run": False, "confirm": True}))
        assert e2.value.status_code == 400

        # the lead never moved onto a hidden school
        lead = await db.leads.find_one({"lead_id": "L1"}, {"_id": 0})
        assert lead["school_id"] == "dup1"
    _run(go())


# ===========================================================================
# FINDING 6 (MEDIUM) — FIXED. merge's "restorable" claim was false: the child FK
# rewrite was never captured, so a wrong merge could not be undone. The merge now
# snapshots every CHILD doc (with its ORIGINAL school_id) before re-pointing it,
# and says plainly what restore does and does not do.
# ===========================================================================

def test_merge_snapshots_child_preimage_so_unmerge_is_reconstructible(db):
    async def go():
        await db.schools.insert_many([
            {"school_id": "surv", "school_name": "Survivor"},
            {"school_id": "dup1", "school_name": "Dup One"},
        ])
        await db.leads.insert_one({"lead_id": "L1", "school_id": "dup1"})
        await db.contacts.insert_one({"contact_id": "C1", "school_id": "dup1"})

        res = await m.merge_schools(_Req(
            {"survivor_id": "surv", "merge_ids": ["dup1"],
             "dry_run": False, "confirm": True, "reason": "dedup"}))

        bid = res["child_preimage_backup_id"]
        assert res["child_preimage_counts"] == {"leads": 1, "contacts": 1}
        assert "not auto-reverted" in res["undo_note"].lower()

        # The pre-image chunks hold each child's ORIGINAL school_id (dup1) — enough
        # to reconstruct an un-merge, even though the live docs now say "surv".
        chunks = await db.audit_backups.find(
            {"backup_id": bid, "kind": ab.CHUNK}, {"_id": 0}).to_list(100)
        pre_docs = {c["collection"]: c["docs"] for c in chunks}
        assert pre_docs["leads"][0]["school_id"] == "dup1"
        assert pre_docs["contacts"][0]["school_id"] == "dup1"

        # live docs did move
        assert (await db.leads.find_one({"lead_id": "L1"}))["school_id"] == "surv"
    _run(go())
