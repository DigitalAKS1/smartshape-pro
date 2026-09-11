"""POST /drip/enroll-schools reaches only the schools the caller can see.

The tag roll-up resolves over the whole CRM, so a scoped rep's tag-targeted
drip would otherwise enrol — and open Direct-Mail leads at — other reps'
schools. Hand-picked `school_ids` had the same hole. For a caller without
"all" scope on leads, the target schools are intersected with
`crm_routes._schools_visibility_or` (the rule GET /schools uses); the rest are
counted in `skipped_not_visible`, never enrolled, never a 403 for the batch.

mongomock only; the executor kick is replaced, so nothing runs or sends.

Run:
    DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 \
    python -m pytest tests/test_drip_enroll_scoping.py -q
"""
import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

import rbac
import routes.crm_routes as crm
import routes.drip_routes as drip
import scheduler as sched

ADMIN = {"email": "info@smartshape.in", "name": "Owner", "role": "admin"}
REP = {
    "email": "rep@smartshape.in", "name": "Rep", "role": "sales",
    "module_permissions": {"leads": {"level": "read_write", "scope": "own"}},
}
OTHER = "other.rep@smartshape.in"


class FakeRequest:
    def __init__(self, body=None):
        self._body = body or {}
        self.query_params = {}

    async def json(self):
        return self._body


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    for mod in (crm, drip, sched):
        monkeypatch.setattr(mod, "db", d, raising=False)
    monkeypatch.setattr(rbac, "MODULE_RBAC_MODE", "enforce", raising=False)

    async def _no_executor():
        raise AssertionError("the drip executor must not run in this test")
    monkeypatch.setattr(sched, "run_drip_executor", _no_executor)
    return d


def _as(user, monkeypatch):
    async def _me(_request):
        return user
    monkeypatch.setattr(drip, "get_current_user", _me)
    monkeypatch.setattr(crm, "get_current_user", _me)


def _run(coro):
    return asyncio.run(coro)


async def _seed(db):
    await db.drip_sequences.insert_one({
        "sequence_id": "seq1", "name": "GSLC follow-up", "is_active": True,
        # 3 days out: enrolment never kicks the executor
        "steps": [{"step_number": 1, "delay_days": 3, "message_type": "call_task",
                   "message_template": "Call {name}"}],
    })
    for sid, owner in (("s_mine", REP["email"]), ("s_theirs", OTHER), ("s_linked", OTHER)):
        await db.schools.insert_one({"school_id": sid, "school_name": sid,
                                     "assigned_to": owner, "is_deleted": False, "tag_ids": []})
    # s_linked is another rep's school that holds one of MY deals -> visible to me.
    await db.leads.insert_one({"lead_id": "l_my_deal", "school_id": "s_linked", "stage": "new",
                               "assigned_to": REP["email"], "is_deleted": False, "tag_ids": []})
    # The tag sits on a person at each school.
    for sid in ("s_mine", "s_theirs", "s_linked"):
        await db.contacts.insert_one({"contact_id": f"c_{sid}", "school_id": sid,
                                      "tag_ids": ["t_gslc"], "is_deleted": False})


async def _enrolled_schools(db):
    out = set()
    async for e in db.drip_enrollments.find({"sequence_id": "seq1"}, {"_id": 0, "lead_id": 1}):
        lead = await db.leads.find_one({"lead_id": e["lead_id"]}, {"_id": 0, "school_id": 1})
        out.add(lead["school_id"])
    return out


def test_scoped_rep_tag_drip_only_enrols_schools_they_can_see(db, monkeypatch):
    _as(REP, monkeypatch)

    async def go():
        await _seed(db)
        out = await drip.enroll_schools(FakeRequest({"sequence_id": "seq1", "tag_id": "t_gslc"}))
        assert out["matched_by_tag"] == 3
        assert out["enrolled"] == 2
        assert out["skipped_not_visible"] == 1
        assert await _enrolled_schools(db) == {"s_mine", "s_linked"}
        # no Direct-Mail lead was opened at the school the rep cannot see
        assert await db.leads.count_documents({"school_id": "s_theirs"}) == 0
    _run(go())


def test_scoped_rep_hand_picked_school_ids_are_scoped_too(db, monkeypatch):
    _as(REP, monkeypatch)

    async def go():
        await _seed(db)
        out = await drip.enroll_schools(FakeRequest({
            "sequence_id": "seq1", "school_ids": ["s_mine", "s_theirs", "s_mine"]}))
        assert (out["enrolled"], out["skipped_not_visible"]) == (1, 1)
        assert await _enrolled_schools(db) == {"s_mine"}
    _run(go())


def test_scoped_rep_with_no_visible_target_enrols_nobody_and_says_why(db, monkeypatch):
    _as(REP, monkeypatch)

    async def go():
        await _seed(db)
        out = await drip.enroll_schools(FakeRequest({"sequence_id": "seq1", "school_ids": ["s_theirs"]}))
        assert (out["enrolled"], out["skipped_not_visible"], out["total"]) == (0, 1, 0)
        assert await db.drip_enrollments.count_documents({}) == 0
    _run(go())


def test_admin_is_not_scoped(db, monkeypatch):
    _as(ADMIN, monkeypatch)

    async def go():
        await _seed(db)
        out = await drip.enroll_schools(FakeRequest({"sequence_id": "seq1", "tag_id": "t_gslc"}))
        assert (out["enrolled"], out["skipped_not_visible"]) == (3, 0)
        assert await _enrolled_schools(db) == {"s_mine", "s_theirs", "s_linked"}
    _run(go())


def test_a_non_list_school_ids_is_a_400_not_a_500(db, monkeypatch):
    _as(ADMIN, monkeypatch)

    async def go():
        await _seed(db)
        with pytest.raises(Exception) as exc:
            await drip.enroll_schools(FakeRequest({"sequence_id": "seq1", "school_ids": "s_mine"}))
        assert getattr(exc.value, "status_code", None) == 400
    _run(go())
