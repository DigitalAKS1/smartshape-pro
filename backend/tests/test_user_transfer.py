"""Tests for deactivate-and-transfer on admin_delete_user.

Pure-Python tests cover the TRANSFER_SPECS contract (no DB / no network).
The endpoint tests spin up routes.admin_routes.router in-process against an
isolated test DB, following the pattern in test_admin_roles.py (patch
module-level `db` and `get_current_user`, never import main).
"""
import os
import pytest
import pytest_asyncio
from motor.motor_asyncio import AsyncIOMotorClient
from fastapi import FastAPI
from httpx import AsyncClient, ASGITransport

from routes.admin_routes import TRANSFER_SPECS
import routes.admin_routes as ar

_DB_NAME = os.getenv("DB_NAME", "smartshape_test")
assert _DB_NAME.endswith("_test") or _DB_NAME == "mtt_ci", f"refusing non-test DB: {_DB_NAME}"

_MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")

ADMIN = {"user_id": "user_admin", "email": "admin@smartshape.in", "role": "admin",
         "roles": ["admin"], "module_permissions": {}}


# ==================== TRANSFER_SPECS contract (pure Python) ====================

def test_transfer_never_touches_sales_attribution():
    collections = {c for c, _, _, _ in TRANSFER_SPECS}
    for banned in ("quotations", "orders", "invoices"):
        assert banned not in collections


def test_transfer_never_rewrites_created_by():
    fields = {f for _, f, _, _ in TRANSFER_SPECS}
    assert "created_by" not in fields


def test_every_spec_collection_is_really_written_by_the_app():
    """Guards against a spec entry that can never match — the `visits` mistake."""
    collections = {c for c, _, _, _ in TRANSFER_SPECS}
    assert "visits" not in collections


def test_field_visits_only_transfers_open_visits():
    spec = [s for s in TRANSFER_SPECS if s[0] == "field_visits"]
    assert spec and spec[0][1] == "sales_person_email"
    assert spec[0][3] == {"outcome": None}


def test_specs_have_no_duplicates():
    collections = [c for c, _, _, _ in TRANSFER_SPECS]
    assert len(collections) == len(set(collections))


def test_transfer_specs_cover_live_crm_ownership():
    """del_task_instances is intentionally NOT a TRANSFER_SPECS tuple — it keys
    on emp_id, not an email field — so it's handled separately in the route.
    This just confirms the tuple-based collections are still all present."""
    collections = {c for c, _, _, _ in TRANSFER_SPECS}
    for expected in ("leads", "schools", "contacts", "tasks", "followups",
                     "visit_plans", "field_visits"):
        assert expected in collections, f"{expected} missing from TRANSFER_SPECS"


def test_every_spec_carries_the_display_name_field_the_app_actually_writes():
    """The owner key and its display name must move together. Verified against
    the insert sites, not guessed: leads/schools/contacts/tasks/visit_plans write
    `assigned_name`, field_visits writes `sales_person_name`, and followups has
    no name field on ANY of its four insert paths (crm_routes.py:3209 and :3295,
    field_routes.py:122, server.py:2303) — so None there is deliberate."""
    expected = {
        "leads": "assigned_name",
        "schools": "assigned_name",
        "contacts": "assigned_name",
        "tasks": "assigned_name",
        "followups": None,
        "visit_plans": "assigned_name",
        "field_visits": "sales_person_name",
    }
    actual = {c: n for c, _, n, _ in TRANSFER_SPECS}
    assert actual == expected


def test_crm_transfer_collections_are_a_subset_of_the_specs():
    collections = {c for c, _, _, _ in TRANSFER_SPECS}
    assert set(ar.CRM_TRANSFER_COLLECTIONS) <= collections
    # These are exactly the transferable collections whose list endpoints are
    # gated by crm_routes._crm_read.
    assert set(ar.CRM_TRANSFER_COLLECTIONS) == {"leads", "schools", "contacts"}


# ==================== Endpoint tests (isolated test DB) ====================

@pytest_asyncio.fixture
async def ctx():
    motor_client = AsyncIOMotorClient(_MONGO_URL)
    d = motor_client[_DB_NAME]
    orig_db = ar.db
    ar.db = d
    app = FastAPI()
    app.include_router(ar.router, prefix="/api")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://t") as client:
        yield d, client
    ar.db = orig_db
    for coll in ("users", "salespersons", "leads", "schools", "contacts", "tasks",
                 "followups", "visit_plans", "field_visits", "del_employees",
                 "del_task_instances", "quotations", "orders", "activity_logs"):
        await d[coll].delete_many({})
    motor_client.close()


def _as(user):
    async def fake(request):
        return user
    return fake


@pytest_asyncio.fixture
async def leaving_and_recipient(ctx):
    d, client = ctx
    await d.users.insert_one({
        "user_id": "user_leaving", "email": "leaving@smartshape.in", "name": "Leaving Rep",
        "role": "sales_person", "roles": ["sales_person"], "is_active": True,
    })
    await d.users.insert_one({
        "user_id": "user_recipient", "email": "recipient@smartshape.in", "name": "Recipient Rep",
        "role": "sales_person", "roles": ["sales_person"], "is_active": True,
    })
    await d.salespersons.insert_one({"email": "leaving@smartshape.in", "is_active": True})

    # Live CRM records owned by the leaving user. They carry the departing
    # person's DISPLAY name too — that is what must move with the owner key.
    await d.leads.insert_one({"lead_id": "lead_1", "assigned_to": "leaving@smartshape.in",
                               "assigned_name": "Leaving Rep",
                               "created_by": "leaving@smartshape.in"})
    await d.schools.insert_one({"school_id": "school_1", "assigned_to": "leaving@smartshape.in",
                                 "assigned_name": "Leaving Rep"})
    await d.contacts.insert_one({"contact_id": "contact_1", "assigned_to": "leaving@smartshape.in",
                                  "assigned_name": "Leaving Rep"})
    await d.tasks.insert_one({"task_id": "task_1", "assigned_to": "leaving@smartshape.in",
                               "assigned_name": "Leaving Rep"})
    await d.followups.insert_one({"followup_id": "fu_1", "assigned_to": "leaving@smartshape.in"})

    # visit_plans: one still outstanding (status "planned" — live work), one
    # completed and one cancelled (both terminal — history/not-live-work,
    # must stay put; mirrors the terminal-status set already used to read
    # this collection at admin_routes.py:714 and server.py:3111)
    await d.visit_plans.insert_one({"plan_id": "plan_open", "assigned_to": "leaving@smartshape.in",
                                     "assigned_name": "Leaving Rep", "status": "planned"})
    await d.visit_plans.insert_one({"plan_id": "plan_done", "assigned_to": "leaving@smartshape.in",
                                     "status": "completed"})
    await d.visit_plans.insert_one({"plan_id": "plan_cancelled", "assigned_to": "leaving@smartshape.in",
                                     "status": "cancelled"})

    # field_visits: one still open (no outcome — live work), one completed
    # (has an outcome — history, must stay with the original rep)
    await d.field_visits.insert_one({"visit_id": "visit_open", "sales_person_email": "leaving@smartshape.in",
                                      "sales_person_name": "Leaving Rep", "outcome": None})
    await d.field_visits.insert_one({"visit_id": "visit_done", "sales_person_email": "leaving@smartshape.in",
                                      "sales_person_name": "Leaving Rep", "outcome": "interested"})

    # del_task_instances key on emp_id, not email — via del_employees
    await d.del_employees.insert_one({"emp_id": "emp_leaving", "name": "Leaving Rep",
                                       "email": "leaving@smartshape.in"})
    await d.del_employees.insert_one({"emp_id": "emp_recipient", "name": "Recipient Rep",
                                       "email": "recipient@smartshape.in"})
    await d.del_task_instances.insert_one({"instance_id": "inst_pending", "emp_id": "emp_leaving",
                                            "emp_name": "Leaving Rep", "status": "pending"})
    await d.del_task_instances.insert_one({"instance_id": "inst_done", "emp_id": "emp_leaving",
                                            "emp_name": "Leaving Rep", "status": "completed"})

    # Sales-attribution records that must NOT move
    await d.quotations.insert_one({"quotation_id": "quot_1", "created_by": "leaving@smartshape.in"})
    await d.orders.insert_one({"order_id": "order_1", "sales_person_email": "leaving@smartshape.in"})

    return d, client


@pytest.mark.asyncio
async def test_data_summary_counts_only_live_crm_collections(ctx, monkeypatch, leaving_and_recipient):
    d, client = leaving_and_recipient
    monkeypatch.setattr(ar, "get_current_user", _as(ADMIN))
    r = await client.get("/api/admin/users/user_leaving/data-summary")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["counts"] == {
        "leads": 1, "schools": 1, "contacts": 1, "tasks": 1,
        "followups": 1, "visit_plans": 1, "field_visits": 1, "del_task_instances": 1,
    }
    assert body["total"] == 8
    assert "quotations" not in body["counts"]
    assert "orders" not in body["counts"]


@pytest.mark.asyncio
async def test_data_summary_requires_admin(ctx, monkeypatch, leaving_and_recipient):
    d, client = leaving_and_recipient
    non_admin = {"user_id": "x", "email": "rep@smartshape.in", "role": "sales_person",
                 "roles": ["sales_person"], "module_permissions": {}}
    monkeypatch.setattr(ar, "get_current_user", _as(non_admin))
    r = await client.get("/api/admin/users/user_leaving/data-summary")
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_delete_without_transfer_deactivates_and_leaves_records_orphaned(ctx, monkeypatch, leaving_and_recipient):
    d, client = leaving_and_recipient
    monkeypatch.setattr(ar, "get_current_user", _as(ADMIN))
    r = await client.delete("/api/admin/users/user_leaving")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["deactivated"] is True
    assert body["transferred"] == {}

    user_doc = await d.users.find_one({"user_id": "user_leaving"}, {"_id": 0})
    assert user_doc is not None, "user document must be kept, not deleted"
    assert user_doc["is_active"] is False

    sp_doc = await d.salespersons.find_one({"email": "leaving@smartshape.in"}, {"_id": 0})
    assert sp_doc["is_active"] is False

    lead = await d.leads.find_one({"lead_id": "lead_1"}, {"_id": 0})
    assert lead["assigned_to"] == "leaving@smartshape.in"


@pytest.mark.asyncio
async def test_visit_plans_open_transfers_completed_and_cancelled_stay(ctx, monkeypatch, leaving_and_recipient):
    """End-to-end, mirroring test_field_visits_open_transfers_completed_stays:
    seed one planned, one completed and one cancelled visit plan, transfer,
    assert ONLY the planned one moved. `cancelled` must be excluded too — it
    is not live work, and this is the terminal-status set the codebase
    already uses to read this collection (admin_routes.py:714,
    server.py:3111). This assertion would FAIL under a bare
    `{"status": {"$ne": "completed"}}` filter, since that would incorrectly
    move plan_cancelled along with plan_open."""
    d, client = leaving_and_recipient
    monkeypatch.setattr(ar, "get_current_user", _as(ADMIN))
    r = await client.delete("/api/admin/users/user_leaving",
                             params={"transfer_to": "recipient@smartshape.in"})
    assert r.status_code == 200, r.text
    assert r.json()["transferred"]["visit_plans"] == 1

    open_plan = await d.visit_plans.find_one({"plan_id": "plan_open"}, {"_id": 0})
    assert open_plan["assigned_to"] == "recipient@smartshape.in"

    cancelled_plan = await d.visit_plans.find_one({"plan_id": "plan_cancelled"}, {"_id": 0})
    assert cancelled_plan["assigned_to"] == "leaving@smartshape.in", \
        "a cancelled visit plan is not live work and must not be transferred"

    done_plan = await d.visit_plans.find_one({"plan_id": "plan_done"}, {"_id": 0})
    assert done_plan["assigned_to"] == "leaving@smartshape.in", \
        "a completed visit plan is history and must keep its original owner"


@pytest.mark.asyncio
async def test_transfer_recipient_lookup_is_case_insensitive(ctx, monkeypatch, leaving_and_recipient):
    """A recipient stored with a mixed-case email (some insert paths don't
    lowercase on write) must still be selectable, and every write must use
    the canonically-stored casing, not the caller-supplied one."""
    d, client = leaving_and_recipient
    await d.users.update_one({"user_id": "user_recipient"},
                              {"$set": {"email": "Recipient@SmartShape.in"}})
    monkeypatch.setattr(ar, "get_current_user", _as(ADMIN))
    r = await client.delete("/api/admin/users/user_leaving",
                             params={"transfer_to": "recipient@smartshape.in"})
    assert r.status_code == 200, r.text
    assert r.json()["transferred"]["leads"] == 1

    lead = await d.leads.find_one({"lead_id": "lead_1"}, {"_id": 0})
    assert lead["assigned_to"] == "Recipient@SmartShape.in", \
        "must use the recipient's canonically-stored email casing, not the lowercased input"


@pytest.mark.asyncio
async def test_delete_with_transfer_moves_live_crm_ownership_only(ctx, monkeypatch, leaving_and_recipient):
    d, client = leaving_and_recipient
    monkeypatch.setattr(ar, "get_current_user", _as(ADMIN))
    r = await client.delete("/api/admin/users/user_leaving",
                             params={"transfer_to": "recipient@smartshape.in"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["deactivated"] is True
    assert body["transferred"] == {
        "leads": 1, "schools": 1, "contacts": 1, "tasks": 1,
        "followups": 1, "visit_plans": 1, "field_visits": 1, "del_task_instances": 1,
    }

    lead = await d.leads.find_one({"lead_id": "lead_1"}, {"_id": 0})
    assert lead["assigned_to"] == "recipient@smartshape.in"
    # created_by is history — never rewritten
    assert lead["created_by"] == "leaving@smartshape.in"

    school = await d.schools.find_one({"school_id": "school_1"}, {"_id": 0})
    assert school["assigned_to"] == "recipient@smartshape.in"

    # Sales attribution is untouched
    quot = await d.quotations.find_one({"quotation_id": "quot_1"}, {"_id": 0})
    assert quot["created_by"] == "leaving@smartshape.in"
    order = await d.orders.find_one({"order_id": "order_1"}, {"_id": 0})
    assert order["sales_person_email"] == "leaving@smartshape.in"

    # Delegation: emp_id + emp_name move together, only for the pending instance
    inst_pending = await d.del_task_instances.find_one({"instance_id": "inst_pending"}, {"_id": 0})
    assert inst_pending["emp_id"] == "emp_recipient"
    assert inst_pending["emp_name"] == "Recipient Rep"
    inst_done = await d.del_task_instances.find_one({"instance_id": "inst_done"}, {"_id": 0})
    assert inst_done["emp_id"] == "emp_leaving"
    assert inst_done["emp_name"] == "Leaving Rep"

    user_doc = await d.users.find_one({"user_id": "user_leaving"}, {"_id": 0})
    assert user_doc["is_active"] is False


@pytest.mark.asyncio
async def test_field_visits_open_transfers_completed_stays(ctx, monkeypatch, leaving_and_recipient):
    """End-to-end: seed one completed (outcome set) and one open (outcome None)
    field visit, transfer, assert ONLY the open one moved."""
    d, client = leaving_and_recipient
    monkeypatch.setattr(ar, "get_current_user", _as(ADMIN))
    r = await client.delete("/api/admin/users/user_leaving",
                             params={"transfer_to": "recipient@smartshape.in"})
    assert r.status_code == 200, r.text
    assert r.json()["transferred"]["field_visits"] == 1

    open_visit = await d.field_visits.find_one({"visit_id": "visit_open"}, {"_id": 0})
    assert open_visit["sales_person_email"] == "recipient@smartshape.in"

    done_visit = await d.field_visits.find_one({"visit_id": "visit_done"}, {"_id": 0})
    assert done_visit["sales_person_email"] == "leaving@smartshape.in", \
        "a completed visit is history and must keep its original owner"


@pytest.mark.asyncio
async def test_delegation_transfer_skipped_silently_when_no_employee_row(ctx, monkeypatch):
    """If the departing user (or the recipient) has no del_employees row,
    delegation transfer must be skipped silently — never error, never invent
    a del_employees record."""
    d, client = ctx
    await d.users.insert_one({
        "user_id": "user_leaving2", "email": "leaving2@smartshape.in", "name": "Leaving Two",
        "role": "sales_person", "roles": ["sales_person"], "is_active": True,
    })
    await d.users.insert_one({
        "user_id": "user_recipient2", "email": "recipient2@smartshape.in", "name": "Recipient Two",
        "role": "sales_person", "roles": ["sales_person"], "is_active": True,
    })
    # Neither has a del_employees row.
    monkeypatch.setattr(ar, "get_current_user", _as(ADMIN))
    r = await client.delete("/api/admin/users/user_leaving2",
                             params={"transfer_to": "recipient2@smartshape.in"})
    assert r.status_code == 200, r.text
    assert "del_task_instances" not in r.json()["transferred"]
    assert await d.del_employees.count_documents({}) == 0, "must never invent a del_employees record"


@pytest.mark.asyncio
async def test_delete_rejects_transfer_to_self(ctx, monkeypatch, leaving_and_recipient):
    d, client = leaving_and_recipient
    monkeypatch.setattr(ar, "get_current_user", _as(ADMIN))
    r = await client.delete("/api/admin/users/user_leaving",
                             params={"transfer_to": "leaving@smartshape.in"})
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_delete_rejects_unknown_recipient(ctx, monkeypatch, leaving_and_recipient):
    d, client = leaving_and_recipient
    monkeypatch.setattr(ar, "get_current_user", _as(ADMIN))
    r = await client.delete("/api/admin/users/user_leaving",
                             params={"transfer_to": "nobody@smartshape.in"})
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_delete_rejects_transfer_to_deactivated_recipient(ctx, monkeypatch, leaving_and_recipient):
    d, client = leaving_and_recipient
    await d.users.update_one({"user_id": "user_recipient"}, {"$set": {"is_active": False}})
    monkeypatch.setattr(ar, "get_current_user", _as(ADMIN))
    r = await client.delete("/api/admin/users/user_leaving",
                             params={"transfer_to": "recipient@smartshape.in"})
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_delete_rejects_removing_self(ctx, monkeypatch, leaving_and_recipient):
    d, client = leaving_and_recipient
    self_admin = dict(ADMIN, user_id="user_leaving")
    monkeypatch.setattr(ar, "get_current_user", _as(self_admin))
    r = await client.delete("/api/admin/users/user_leaving")
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_delete_requires_admin(ctx, monkeypatch, leaving_and_recipient):
    d, client = leaving_and_recipient
    non_admin = {"user_id": "x", "email": "rep@smartshape.in", "role": "sales_person",
                 "roles": ["sales_person"], "module_permissions": {}}
    monkeypatch.setattr(ar, "get_current_user", _as(non_admin))
    r = await client.delete("/api/admin/users/user_leaving")
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_delete_unknown_user_404s(ctx, monkeypatch, leaving_and_recipient):
    d, client = leaving_and_recipient
    monkeypatch.setattr(ar, "get_current_user", _as(ADMIN))
    r = await client.delete("/api/admin/users/user_does_not_exist")
    assert r.status_code == 404


# ==================== Fix 2: the display name moves with the owner key ====================

@pytest.mark.asyncio
async def test_transfer_moves_owner_name_alongside_owner_email(ctx, monkeypatch, leaving_and_recipient):
    """Every other write path in this codebase sets `assigned_to` and
    `assigned_name` together. Moving only the key leaves the DEPARTED person's
    name on the recipient's records — /leads/forecast buckets `by_rep` on
    `assigned_name`, so transferred pipeline would report under the wrong rep.
    This would FAIL if TRANSFER_SPECS carried no name field."""
    d, client = leaving_and_recipient
    monkeypatch.setattr(ar, "get_current_user", _as(ADMIN))
    r = await client.delete("/api/admin/users/user_leaving",
                             params={"transfer_to": "recipient@smartshape.in"})
    assert r.status_code == 200, r.text

    lead = await d.leads.find_one({"lead_id": "lead_1"}, {"_id": 0})
    assert lead["assigned_to"] == "recipient@smartshape.in"
    assert lead["assigned_name"] == "Recipient Rep", \
        "the departed rep's name must not survive on a transferred lead"

    school = await d.schools.find_one({"school_id": "school_1"}, {"_id": 0})
    assert school["assigned_to"] == "recipient@smartshape.in"
    assert school["assigned_name"] == "Recipient Rep"

    contact = await d.contacts.find_one({"contact_id": "contact_1"}, {"_id": 0})
    assert contact["assigned_name"] == "Recipient Rep"

    task = await d.tasks.find_one({"task_id": "task_1"}, {"_id": 0})
    assert task["assigned_name"] == "Recipient Rep"

    plan = await d.visit_plans.find_one({"plan_id": "plan_open"}, {"_id": 0})
    assert plan["assigned_name"] == "Recipient Rep"

    # field_visits uses a different name key
    open_visit = await d.field_visits.find_one({"visit_id": "visit_open"}, {"_id": 0})
    assert open_visit["sales_person_email"] == "recipient@smartshape.in"
    assert open_visit["sales_person_name"] == "Recipient Rep"

    # ...and history keeps the ORIGINAL pair, name included
    done_visit = await d.field_visits.find_one({"visit_id": "visit_done"}, {"_id": 0})
    assert done_visit["sales_person_email"] == "leaving@smartshape.in"
    assert done_visit["sales_person_name"] == "Leaving Rep"


@pytest.mark.asyncio
async def test_followups_transfer_without_inventing_a_name_field(ctx, monkeypatch, leaving_and_recipient):
    """`followups` has no display-name field on any insert path. The transfer
    must move the owner and NOT create a phantom `assigned_name` key."""
    d, client = leaving_and_recipient
    monkeypatch.setattr(ar, "get_current_user", _as(ADMIN))
    r = await client.delete("/api/admin/users/user_leaving",
                             params={"transfer_to": "recipient@smartshape.in"})
    assert r.status_code == 200, r.text
    fu = await d.followups.find_one({"followup_id": "fu_1"}, {"_id": 0})
    assert fu["assigned_to"] == "recipient@smartshape.in"
    assert "assigned_name" not in fu


@pytest.mark.asyncio
async def test_transfer_name_falls_back_to_email_never_blank(ctx, monkeypatch, leaving_and_recipient):
    """A blank `assigned_name` against a real `assigned_to` is the corrupt pair
    _apply_owner exists to prevent — never write one."""
    d, client = leaving_and_recipient
    await d.users.update_one({"user_id": "user_recipient"}, {"$set": {"name": ""}})
    monkeypatch.setattr(ar, "get_current_user", _as(ADMIN))
    r = await client.delete("/api/admin/users/user_leaving",
                             params={"transfer_to": "recipient@smartshape.in"})
    assert r.status_code == 200, r.text
    lead = await d.leads.find_one({"lead_id": "lead_1"}, {"_id": 0})
    assert lead["assigned_name"] == "recipient@smartshape.in"


# ============ Fix 4: warn before handing CRM work to someone who can't see it ============

@pytest.mark.asyncio
async def test_data_summary_reports_how_much_of_the_work_is_crm(ctx, monkeypatch, leaving_and_recipient):
    d, client = leaving_and_recipient
    monkeypatch.setattr(ar, "get_current_user", _as(ADMIN))
    r = await client.get("/api/admin/users/user_leaving/data-summary")
    assert r.status_code == 200, r.text
    body = r.json()
    # leads + schools + contacts = 3 of the 8 live records
    assert body["crm_total"] == 3
    assert body["total"] == 8


@pytest.mark.asyncio
async def test_admin_users_flags_who_can_actually_receive_crm_work(ctx, monkeypatch):
    """The recipient dropdown offers every active user. A store manager with no
    `leads` grant receives a departing rep's pipeline into a black hole — CRM
    lists return []. The list endpoint must expose that, per candidate."""
    d, client = ctx
    await d.users.insert_many([
        # sales team — CRM access has always been implicit, no grant needed
        {"user_id": "u_sales", "email": "sales@x.in", "name": "Sales", "role": "sales_person",
         "roles": ["sales_person"], "is_active": True},
        # store only, no leads grant — CANNOT see CRM records
        {"user_id": "u_store", "email": "store@x.in", "name": "Store", "role": "store",
         "roles": ["store"], "is_active": True,
         "module_permissions": {"orders": {"level": "read_write", "scope": "all"}}},
        # store PLUS an explicit leads grant — CAN see CRM records
        {"user_id": "u_store_crm", "email": "storecrm@x.in", "name": "Store CRM", "role": "store",
         "roles": ["store"], "is_active": True,
         "module_permissions": {"leads": {"level": "read", "scope": "all"}}},
        # a leads grant explicitly set to "none" is not a grant
        {"user_id": "u_none", "email": "none@x.in", "name": "None", "role": "accounts",
         "roles": ["accounts"], "is_active": True,
         "module_permissions": {"leads": {"level": "none"}}},
        # admin bypasses every module check
        {"user_id": "u_admin", "email": "adm@x.in", "name": "Adm", "role": "admin",
         "roles": ["admin"], "is_active": True},
        # legacy doc: no `roles` key, no module_permissions at all
        {"user_id": "u_legacy", "email": "legacy@x.in", "name": "Legacy", "role": "sales_person",
         "is_active": True},
    ])
    monkeypatch.setattr(ar, "get_current_user", _as(ADMIN))
    r = await client.get("/api/admin/users")
    assert r.status_code == 200, r.text
    flags = {u["email"]: u["can_receive_crm"] for u in r.json()}
    assert flags["sales@x.in"] is True
    assert flags["store@x.in"] is False
    assert flags["storecrm@x.in"] is True
    assert flags["none@x.in"] is False
    assert flags["adm@x.in"] is True
    assert flags["legacy@x.in"] is True


@pytest.mark.asyncio
async def test_can_receive_crm_matches_the_crm_read_gate_exactly(ctx, monkeypatch):
    """The dialog's warning must not drift from the gate that actually decides
    whether the recipient's CRM lists come back empty."""
    from routes.crm_routes import _crm_read
    from rbac import can_read_crm
    table = [
        {"role": "sales_person", "roles": ["sales_person"]},
        {"role": "store", "roles": ["store"]},
        {"role": "store", "roles": ["store", "sales_person"]},
        {"role": "accounts", "roles": ["accounts"],
         "module_permissions": {"leads": {"level": "read", "scope": "own"}}},
        {"role": "accounts", "roles": ["accounts"],
         "module_permissions": {"leads": {"level": "none"}}},
        {"role": "admin", "roles": ["admin"]},
        {"role": "store"},          # legacy: no roles key
        {},                          # nothing at all
    ]
    for u in table:
        assert can_read_crm(u) is _crm_read(u), u
