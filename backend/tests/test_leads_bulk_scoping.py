"""POST /leads/bulk-tag, /leads/bulk-stage, /leads/bulk-assign (crm_routes.py).

bulk-tag and bulk-stage used to check only get_current_user, so any logged-in
user could tag or move the stage of ANY lead. They now:
  - need `leads` read_write (require_module);
  - reach, for a non-"all" caller, exactly the leads GET /leads shows them
    (`_leads_visibility_or`: assigned to me OR at a school I own) — anything
    else lands in `skipped`, not a 403;
  - dedupe then cap at 2,000 ids (400 above);
  - return {requested, updated, skipped} plus the `modified` key they always
    returned.
bulk-assign was already admin-only (admin sees everything) — it gains the
dedupe + cap and the count keys, keeping the `assigned` key
ReassignLeadDialog reads.

Harness: mongomock_motor with `crm.db` monkeypatched, route functions called
directly — the same pattern as test_contacts_bulk.py.
Run with:
    DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 \
    python -m pytest tests/test_leads_bulk_scoping.py -q
"""
import asyncio
import json
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from fastapi import HTTPException
from mongomock_motor import AsyncMongoMockClient

import rbac
import routes.crm_routes as crm

ADMIN = {"email": "info@smartshape.in", "name": "Owner", "role": "admin"}
REP = {
    "email": "rep@smartshape.in", "name": "Rep", "role": "sales",
    "module_permissions": {"leads": {"level": "read_write", "scope": "own"}},
}
OTHER_REP_EMAIL = "other.rep@smartshape.in"
# Has CRM work elsewhere but no `leads` grant at all.
NO_LEADS = {
    "email": "accounts@smartshape.in", "name": "Accounts", "role": "accounts",
    "module_permissions": {"invoices": {"level": "read_write", "scope": "all"}},
}
READ_ONLY = {
    "email": "readonly@smartshape.in", "name": "Read Only", "role": "sales",
    "module_permissions": {"leads": {"level": "read", "scope": "own"}},
}


class FakeRequest:
    def __init__(self, body=None):
        self._body = body or {}

    async def json(self):
        return self._body

    async def body(self):
        return json.dumps(self._body).encode()


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(crm, "db", d)
    monkeypatch.setattr(rbac, "MODULE_RBAC_MODE", "enforce", raising=False)
    return d


@pytest.fixture(autouse=True)
def invalidations(monkeypatch):
    """Keep the cache layer off Redis: reads always miss, writes are dropped,
    and invalidations are recorded so a test can assert on them."""
    seen = []

    async def _get(_key, default=None):
        return default

    async def _set(_key, _value, ttl=600):
        return True

    async def _invalidate(pattern):
        seen.append(pattern)
        return 0

    monkeypatch.setattr(crm, "get_cached", _get)
    monkeypatch.setattr(crm, "set_cached", _set)
    monkeypatch.setattr(crm, "invalidate", _invalidate)
    return seen


def _as(user, monkeypatch):
    async def _me(_request):
        return user
    monkeypatch.setattr(crm, "get_current_user", _me)


def _run(coro):
    return asyncio.run(coro)


async def _seed_tag(db, tag_id="tag_hot"):
    await db.tags.insert_one({"tag_id": tag_id, "name": tag_id, "color": "#f00"})


async def _seed_school(db, school_id, *, assigned_to=""):
    await db.schools.insert_one({
        "school_id": school_id, "school_name": school_id,
        "assigned_to": assigned_to, "is_deleted": False,
    })


async def _seed_lead(db, lead_id, *, assigned_to="", school_id=None, stage="new", tag_ids=None):
    await db.leads.insert_one({
        "lead_id": lead_id, "company_name": lead_id, "contact_name": lead_id,
        "assigned_to": assigned_to, "school_id": school_id, "stage": stage,
        "tag_ids": tag_ids or [], "pipeline_history": [],
    })


async def _seed_mixed(db):
    """10 leads a scoped REP might select:
    - 3 assigned to the rep;
    - 1 at a school the rep owns but assigned to someone else (GET /leads
      shows it to the rep — the case `_owner_clause` alone would miss);
    - 6 assigned to someone else at a school the rep does not own.
    Returns (visible_ids, invisible_ids)."""
    await _seed_school(db, "sch_owned", assigned_to=REP["email"])
    await _seed_school(db, "sch_other", assigned_to=OTHER_REP_EMAIL)
    visible = []
    for i in range(3):
        lid = f"mine_{i}"
        await _seed_lead(db, lid, assigned_to=REP["email"], school_id="sch_other")
        visible.append(lid)
    await _seed_lead(db, "at_my_school", assigned_to=OTHER_REP_EMAIL, school_id="sch_owned")
    visible.append("at_my_school")
    invisible = []
    for i in range(6):
        lid = f"theirs_{i}"
        await _seed_lead(db, lid, assigned_to=OTHER_REP_EMAIL, school_id="sch_other")
        invisible.append(lid)
    return visible, invisible


async def _visible_via_get_leads(ids):
    """What GET /leads (legacy unpaginated path) shows the current caller."""
    rows = await crm.get_leads(FakeRequest())
    return sorted(r["lead_id"] for r in rows if r["lead_id"] in set(ids))


# ---------------------------------------------------------------------------
# bulk-tag
# ---------------------------------------------------------------------------

def test_bulk_tag_scoped_rep_updates_exactly_what_get_leads_shows_them(db, monkeypatch, invalidations):
    _as(REP, monkeypatch)

    async def go():
        await _seed_tag(db)
        visible, invisible = await _seed_mixed(db)
        # The bulk route and GET /leads must agree on what the rep can see.
        assert await _visible_via_get_leads(visible + invisible) == sorted(visible)

        out = await crm.bulk_tag_leads(FakeRequest({
            "lead_ids": visible + invisible, "tag_id": "tag_hot", "action": "add",
        }))
        assert out["requested"] == 10
        assert out["updated"] == 4
        assert out["skipped"] == 6
        assert "modified" in out  # the key the endpoint always returned
        for lid in visible:
            assert (await db.leads.find_one({"lead_id": lid}))["tag_ids"] == ["tag_hot"]
        for lid in invisible:
            assert (await db.leads.find_one({"lead_id": lid}))["tag_ids"] == []
    _run(go())
    assert "crm:facets:*" in invalidations
    assert "tags:*" in invalidations


def test_bulk_tag_remove_is_scoped_too(db, monkeypatch):
    _as(REP, monkeypatch)

    async def go():
        await _seed_tag(db)
        await _seed_school(db, "sch_other", assigned_to=OTHER_REP_EMAIL)
        await _seed_lead(db, "mine", assigned_to=REP["email"], tag_ids=["tag_hot"])
        await _seed_lead(db, "theirs", assigned_to=OTHER_REP_EMAIL, school_id="sch_other",
                         tag_ids=["tag_hot"])
        out = await crm.bulk_tag_leads(FakeRequest({
            "lead_ids": ["mine", "theirs"], "tag_id": "tag_hot", "action": "remove",
        }))
        assert (out["requested"], out["updated"], out["skipped"]) == (2, 1, 1)
        assert (await db.leads.find_one({"lead_id": "mine"}))["tag_ids"] == []
        assert (await db.leads.find_one({"lead_id": "theirs"}))["tag_ids"] == ["tag_hot"]
    _run(go())


def test_bulk_tag_admin_updates_all(db, monkeypatch):
    _as(ADMIN, monkeypatch)

    async def go():
        await _seed_tag(db)
        visible, invisible = await _seed_mixed(db)
        out = await crm.bulk_tag_leads(FakeRequest({
            "lead_ids": visible + invisible, "tag_id": "tag_hot", "action": "add",
        }))
        assert (out["requested"], out["updated"], out["skipped"]) == (10, 10, 0)
    _run(go())


def test_bulk_tag_without_leads_module_is_403(db, monkeypatch):
    _as(NO_LEADS, monkeypatch)

    async def go():
        await _seed_tag(db)
        await _seed_lead(db, "l1", assigned_to=NO_LEADS["email"])
        with pytest.raises(HTTPException) as exc:
            await crm.bulk_tag_leads(FakeRequest({
                "lead_ids": ["l1"], "tag_id": "tag_hot", "action": "add",
            }))
        assert exc.value.status_code == 403
        assert (await db.leads.find_one({"lead_id": "l1"}))["tag_ids"] == []
    _run(go())


def test_bulk_tag_read_only_leads_grant_is_403(db, monkeypatch):
    _as(READ_ONLY, monkeypatch)

    async def go():
        await _seed_tag(db)
        await _seed_lead(db, "l1", assigned_to=READ_ONLY["email"])
        with pytest.raises(HTTPException) as exc:
            await crm.bulk_tag_leads(FakeRequest({
                "lead_ids": ["l1"], "tag_id": "tag_hot", "action": "add",
            }))
        assert exc.value.status_code == 403
    _run(go())


def test_bulk_tag_2001_ids_is_400(db, monkeypatch):
    _as(ADMIN, monkeypatch)

    async def go():
        await _seed_tag(db)
        with pytest.raises(HTTPException) as exc:
            await crm.bulk_tag_leads(FakeRequest({
                "lead_ids": [f"l_{i}" for i in range(2001)], "tag_id": "tag_hot", "action": "add",
            }))
        assert exc.value.status_code == 400
    _run(go())


def test_bulk_tag_dedupes_before_the_cap_and_the_count(db, monkeypatch):
    _as(ADMIN, monkeypatch)

    async def go():
        await _seed_tag(db)
        await _seed_lead(db, "l1")
        # 2,500 copies of one id is ONE lead — neither over the cap nor 2,500 requested.
        out = await crm.bulk_tag_leads(FakeRequest({
            "lead_ids": ["l1"] * 2500, "tag_id": "tag_hot", "action": "add",
        }))
        assert (out["requested"], out["updated"], out["skipped"]) == (1, 1, 0)
    _run(go())


def test_bulk_tag_writes_one_activity_entry_per_batch(db, monkeypatch):
    _as(ADMIN, monkeypatch)

    async def go():
        await _seed_tag(db)
        for i in range(5):
            await _seed_lead(db, f"l{i}")
        await crm.bulk_tag_leads(FakeRequest({
            "lead_ids": [f"l{i}" for i in range(5)], "tag_id": "tag_hot", "action": "add",
        }))
        assert await db.activity_logs.count_documents({"action": "bulk_tag_add"}) == 1
    _run(go())


# ---------------------------------------------------------------------------
# bulk-stage
# ---------------------------------------------------------------------------

def test_bulk_stage_scoped_rep_moves_exactly_what_get_leads_shows_them(db, monkeypatch, invalidations):
    _as(REP, monkeypatch)

    async def go():
        visible, invisible = await _seed_mixed(db)
        assert await _visible_via_get_leads(visible + invisible) == sorted(visible)

        out = await crm.bulk_stage_leads(FakeRequest({
            "lead_ids": visible + invisible, "stage": "demo",
        }))
        assert (out["requested"], out["updated"], out["skipped"]) == (10, 4, 6)
        assert out["modified"] == 4  # the key the endpoint always returned
        for lid in visible:
            lead = await db.leads.find_one({"lead_id": lid})
            assert lead["stage"] == "demo"
            assert lead["pipeline_history"][-1]["from_stage"] == "new"
            assert lead["pipeline_history"][-1]["to_stage"] == "demo"
            assert lead["pipeline_history"][-1]["by_email"] == REP["email"]
        for lid in invisible:
            lead = await db.leads.find_one({"lead_id": lid})
            assert lead["stage"] == "new"
            assert lead["pipeline_history"] == []
    _run(go())
    assert "crm:facets:*" in invalidations


def test_bulk_stage_history_records_each_leads_own_from_stage(db, monkeypatch):
    """Grouped writes must not smear one lead's from_stage onto another."""
    _as(ADMIN, monkeypatch)

    async def go():
        await _seed_lead(db, "a", stage="new")
        await _seed_lead(db, "b", stage="qualified")
        await _seed_lead(db, "c", stage="new")
        await crm.bulk_stage_leads(FakeRequest({"lead_ids": ["a", "b", "c"], "stage": "won"}))
        for lid, was in (("a", "new"), ("b", "qualified"), ("c", "new")):
            lead = await db.leads.find_one({"lead_id": lid})
            assert lead["stage"] == "won"
            assert len(lead["pipeline_history"]) == 1
            assert lead["pipeline_history"][0]["from_stage"] == was
    _run(go())


def test_bulk_stage_admin_moves_all(db, monkeypatch):
    _as(ADMIN, monkeypatch)

    async def go():
        visible, invisible = await _seed_mixed(db)
        out = await crm.bulk_stage_leads(FakeRequest({
            "lead_ids": visible + invisible, "stage": "demo",
        }))
        assert (out["requested"], out["updated"], out["skipped"]) == (10, 10, 0)
    _run(go())


def test_bulk_stage_without_leads_module_is_403(db, monkeypatch):
    _as(NO_LEADS, monkeypatch)

    async def go():
        await _seed_lead(db, "l1", assigned_to=NO_LEADS["email"])
        with pytest.raises(HTTPException) as exc:
            await crm.bulk_stage_leads(FakeRequest({"lead_ids": ["l1"], "stage": "demo"}))
        assert exc.value.status_code == 403
        assert (await db.leads.find_one({"lead_id": "l1"}))["stage"] == "new"
    _run(go())


def test_bulk_stage_2001_ids_is_400(db, monkeypatch):
    _as(ADMIN, monkeypatch)

    async def go():
        with pytest.raises(HTTPException) as exc:
            await crm.bulk_stage_leads(FakeRequest({
                "lead_ids": [f"l_{i}" for i in range(2001)], "stage": "demo",
            }))
        assert exc.value.status_code == 400
    _run(go())


def test_bulk_stage_writes_one_activity_entry_per_batch(db, monkeypatch):
    _as(ADMIN, monkeypatch)

    async def go():
        for i in range(5):
            await _seed_lead(db, f"l{i}", stage="new" if i % 2 else "qualified")
        await crm.bulk_stage_leads(FakeRequest({
            "lead_ids": [f"l{i}" for i in range(5)], "stage": "demo",
        }))
        assert await db.activity_logs.count_documents({"action": "bulk_stage_change"}) == 1
    _run(go())


# ---------------------------------------------------------------------------
# bulk-assign (already admin-only — gains dedupe, cap and counts)
# ---------------------------------------------------------------------------

def test_bulk_assign_still_returns_assigned_plus_counts(db, monkeypatch):
    _as(ADMIN, monkeypatch)

    async def go():
        await db.users.insert_one({"email": "newowner@smartshape.in", "name": "New Owner"})
        await _seed_lead(db, "l1")
        await _seed_lead(db, "l2")
        out = await crm.bulk_assign_leads(FakeRequest({
            "lead_ids": ["l1", "l2", "l2", "gone"], "new_agent_email": "newowner@smartshape.in",
            "new_agent_name": "", "reason": "test",
        }))
        # `assigned` is what ReassignLeadDialog reads — must stay.
        assert out["assigned"] == 2
        assert (out["requested"], out["updated"], out["skipped"]) == (3, 2, 1)
        for lid in ("l1", "l2"):
            lead = await db.leads.find_one({"lead_id": lid})
            assert lead["assigned_to"] == "newowner@smartshape.in"
            assert lead["assigned_name"] == "New Owner"
    _run(go())


def test_bulk_assign_is_still_admin_only(db, monkeypatch):
    _as(REP, monkeypatch)

    async def go():
        await _seed_lead(db, "l1", assigned_to=REP["email"])
        with pytest.raises(HTTPException) as exc:
            await crm.bulk_assign_leads(FakeRequest({
                "lead_ids": ["l1"], "new_agent_email": "x@smartshape.in", "reason": "r",
            }))
        assert exc.value.status_code == 403
    _run(go())


def test_bulk_assign_2001_ids_is_400(db, monkeypatch):
    _as(ADMIN, monkeypatch)

    async def go():
        with pytest.raises(HTTPException) as exc:
            await crm.bulk_assign_leads(FakeRequest({
                "lead_ids": [f"l_{i}" for i in range(2001)],
                "new_agent_email": "someone@smartshape.in", "reason": "r",
            }))
        assert exc.value.status_code == 400
    _run(go())


# ---------------------------------------------------------------------------
# GET /leads visibility is unchanged by the helper extraction
# ---------------------------------------------------------------------------

def test_get_leads_scope_for_a_rep_is_assigned_or_owned_school(db, monkeypatch):
    _as(REP, monkeypatch)

    async def go():
        visible, invisible = await _seed_mixed(db)
        # A lead the rep CREATED but that is unassigned is NOT visible: leads have
        # no created-by fallback (unlike `_owner_clause`), and the helper must not
        # add one.
        await db.leads.insert_one({"lead_id": "created_unassigned", "created_by": REP["email"],
                                   "assigned_to": "", "school_id": "sch_other", "stage": "new"})
        rows = await crm.get_leads(FakeRequest())
        assert sorted(r["lead_id"] for r in rows) == sorted(visible)
    _run(go())


def test_get_leads_rep_with_no_owned_schools_sees_only_assigned(db, monkeypatch):
    _as(REP, monkeypatch)

    async def go():
        await _seed_lead(db, "mine", assigned_to=REP["email"])
        await _seed_lead(db, "no_school", assigned_to=OTHER_REP_EMAIL)
        rows = await crm.get_leads(FakeRequest())
        assert [r["lead_id"] for r in rows] == ["mine"]
    _run(go())
