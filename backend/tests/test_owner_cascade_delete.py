"""Offline unit tests for owner-only cascade delete + restore.

Uses mongomock_motor (in-memory async Mongo) and patches the `db` handle in the
modules under test, so NOTHING here touches the production database. Run with:
    python -m pytest tests/test_owner_cascade_delete.py -q
"""

import asyncio
import os

# Guarantee no real Mongo client is ever constructed: set a dummy MONGO_URL before
# importing database.py (load_dotenv does not override already-set env vars).
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

import audit_backup
import cascade_delete
import rbac


def _fresh_db():
    """A clean in-memory db, wired into both modules under test."""
    db = AsyncMongoMockClient()["smartshape_test"]
    audit_backup.db = db
    cascade_delete.db = db
    return db


async def _seed_school(db):
    """One school with the full CRM+ERP footprint: lead, contact, quote(+catalogue),
    order(+items/timeline/payments/dispatch), task, follow-up."""
    await db.schools.insert_one({"school_id": "sch1", "school_name": "Springfield High"})
    await db.leads.insert_one({"lead_id": "lead1", "school_id": "sch1"})
    await db.contacts.insert_one({"contact_id": "con1", "school_id": "sch1", "lead_id": "lead1"})
    await db.quotations.insert_one({"quotation_id": "q1", "school_id": "sch1", "lead_id": "lead1"})
    await db.catalogue_selections.insert_one({"selection_id": "sel1", "quotation_id": "q1"})
    await db.catalogue_selection_items.insert_one({"item_id": "ci1", "catalogue_selection_id": "sel1"})
    await db.quotation_edit_history.insert_one({"quotation_id": "q1", "v": 1})
    await db.orders.insert_one({"order_id": "ord1", "school_id": "sch1", "quotation_id": "q1", "lead_id": "lead1"})
    await db.order_items.insert_one({"order_item_id": "oi1", "order_id": "ord1", "die_id": "d1", "quantity": 5, "status": "on_hold"})
    await db.order_timeline.insert_one({"timeline_id": "tl1", "order_id": "ord1"})
    await db.payments.insert_one({"payment_id": "p1", "order_id": "ord1", "amount": 100})
    await db.dispatches.insert_one({"dispatch_id": "dsp1", "order_id": "ord1", "school_id": "sch1"})
    await db.tasks.insert_one({"task_id": "t1", "lead_id": "lead1"})
    await db.followups.insert_one({"followup_id": "f1", "lead_id": "lead1"})
    # An UNRELATED school that must survive the cascade.
    await db.schools.insert_one({"school_id": "sch2", "school_name": "Other School"})
    await db.leads.insert_one({"lead_id": "lead2", "school_id": "sch2"})


# ── gate ────────────────────────────────────────────────────────────────────

def test_superadmin_gate():
    assert rbac.is_superadmin({"email": "info@smartshape.in"})
    assert rbac.is_superadmin({"email": "  INFO@SmartShape.IN "})  # case + whitespace
    assert not rbac.is_superadmin({"email": "admin@smartshape.in"})
    assert not rbac.is_superadmin({"email": ""})
    assert not rbac.is_superadmin({})

    with pytest.raises(Exception):
        rbac.require_superadmin({"email": "someone@else.com"})
    rbac.require_superadmin({"email": "info@smartshape.in"})  # no raise


# ── school cascade ────────────────────────────────────────────────────────────

def test_school_cascade_deletes_footprint_and_spares_others():
    async def body():
        db = _fresh_db()
        await _seed_school(db)

        school = await db.schools.find_one({"school_id": "sch1"}, {"_id": 0})
        plan, label, touches_orders = await cascade_delete.build_school_plan(school)
        assert label == "Springfield High"
        assert touches_orders is True

        counts = await audit_backup.preview_counts(plan)
        # spot-check the important collections are all captured
        for coll in ("schools", "leads", "contacts", "quotations", "orders",
                     "order_items", "payments", "dispatches", "tasks", "followups",
                     "catalogue_selection_items", "quotation_edit_history"):
            assert counts.get(coll, 0) >= 1, f"{coll} missing from preview"

        result = await audit_backup.snapshot_and_delete(
            plan, root_type="school", root_id="sch1", root_label=label,
            deleted_by="info@smartshape.in", reason="test")

        # Everything related is gone…
        assert await db.schools.count_documents({"school_id": "sch1"}) == 0
        assert await db.leads.count_documents({"lead_id": "lead1"}) == 0
        assert await db.orders.count_documents({"order_id": "ord1"}) == 0
        assert await db.order_items.count_documents({"order_id": "ord1"}) == 0
        assert await db.payments.count_documents({"order_id": "ord1"}) == 0
        assert await db.dispatches.count_documents({"order_id": "ord1"}) == 0
        assert await db.tasks.count_documents({"lead_id": "lead1"}) == 0
        # …but the unrelated school is untouched.
        assert await db.schools.count_documents({"school_id": "sch2"}) == 1
        assert await db.leads.count_documents({"lead_id": "lead2"}) == 1

        # A complete backup manifest exists.
        manifest = await db.audit_backups.find_one(
            {"backup_id": result["backup_id"], "kind": audit_backup.MANIFEST}, {"_id": 0})
        assert manifest and manifest["total"] == result["total"] and manifest["total"] >= 14

    asyncio.run(body())


def test_restore_reinserts_everything():
    async def body():
        db = _fresh_db()
        await _seed_school(db)
        school = await db.schools.find_one({"school_id": "sch1"}, {"_id": 0})
        plan, label, _ = await cascade_delete.build_school_plan(school)
        result = await audit_backup.snapshot_and_delete(
            plan, root_type="school", root_id="sch1", root_label=label,
            deleted_by="info@smartshape.in")

        assert await db.schools.count_documents({"school_id": "sch1"}) == 0

        restored = await audit_backup.restore_bundle(result["backup_id"], restored_by="info@smartshape.in")
        assert restored["found"] is True
        assert restored["total"] == result["total"]

        # Live records are back.
        assert await db.schools.count_documents({"school_id": "sch1"}) == 1
        assert await db.orders.count_documents({"order_id": "ord1"}) == 1
        assert await db.order_items.count_documents({"order_id": "ord1"}) == 1

        # Manifest marked restored; a second restore is refused (no duplicates).
        manifest = await db.audit_backups.find_one(
            {"backup_id": result["backup_id"], "kind": audit_backup.MANIFEST}, {"_id": 0})
        assert manifest["restored"] is True
        again = await audit_backup.restore_bundle(result["backup_id"])
        assert again.get("already_restored") is True and again["total"] == 0
        assert await db.schools.count_documents({"school_id": "sch1"}) == 1

    asyncio.run(body())


def test_restore_missing_backup():
    async def body():
        _fresh_db()
        r = await audit_backup.restore_bundle("bk_does_not_exist")
        assert r["found"] is False and r["total"] == 0

    asyncio.run(body())


# ── contact cascade (narrower) ────────────────────────────────────────────────

def test_contact_cascade_is_scoped_to_its_lead_chain():
    async def body():
        db = _fresh_db()
        await _seed_school(db)
        # Sibling contact on the SAME school but with no lead — must survive.
        await db.contacts.insert_one({"contact_id": "con2", "school_id": "sch1"})

        contact = await db.contacts.find_one({"contact_id": "con1"}, {"_id": 0})
        plan, label, touches_orders = await cascade_delete.build_contact_plan(contact)
        assert touches_orders is True

        await audit_backup.snapshot_and_delete(
            plan, root_type="contact", root_id="con1", root_label=label,
            deleted_by="info@smartshape.in")

        # The contact and its lead chain (lead/quote/order) are gone…
        assert await db.contacts.count_documents({"contact_id": "con1"}) == 0
        assert await db.leads.count_documents({"lead_id": "lead1"}) == 0
        assert await db.orders.count_documents({"order_id": "ord1"}) == 0
        # …the sibling contact and the school itself remain.
        assert await db.contacts.count_documents({"contact_id": "con2"}) == 1
        assert await db.schools.count_documents({"school_id": "sch1"}) == 1

    asyncio.run(body())
