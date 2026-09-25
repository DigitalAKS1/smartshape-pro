"""Tag roll-up — services/tag_scope.resolve_tag_scope and every caller of it.

Spec: docs/superpowers/specs/2026-09-11-crm-selection-contact-drip-tag-rollup-design.md
(decisions D1-D4, sub-project 3).

    D1  a contact matches only if it carries the tag itself
    D2  a school matches if tagged, or any live contact/lead of it is
    D3  a lead matches if tagged, or its school matches under D2

Three layers:
  1. the resolver on small hand-built data, one rule per test;
  2. the shared agreement fixture (tests/fixtures/tag_rollup_fixture.json) —
     the frontend runs the same file through matchesCrmFilter in
     src/lib/__tests__/tagRollupAgreement.test.js, and both must equal the
     fixture's expected sets, so screen and send cannot disagree;
  3. each switched caller: the tag-targeted drip, the WhatsApp tag broadcast,
     the email + WhatsApp campaign audiences and GET /leads?tag=.

mongomock only, and every outward channel is stubbed: the WhatsApp HTTP client
is replaced, the drip executor kick is replaced, and nothing here builds an
SMTP connection or a push.

Run:
    DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 \
    python -m pytest tests/test_tag_scope.py -q
"""
import asyncio
import json
import os
from pathlib import Path

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import httpx
import pytest
from mongomock_motor import AsyncMongoMockClient

import rbac
import routes.crm_routes as crm
import routes.drip_routes as drip
import routes.email_routes as email_mod
import routes.settings_routes as settings_mod
import routes.whatsapp_routes as wa_mod
import scheduler as sched
from services.tag_scope import resolve_tag_scope

FIXTURE = Path(__file__).parent / "fixtures" / "tag_rollup_fixture.json"

ADMIN = {"email": "info@smartshape.in", "name": "Owner", "role": "admin"}
REP = {
    "email": "rep@smartshape.in", "name": "Rep", "role": "sales",
    "module_permissions": {"leads": {"level": "read_write", "scope": "own"}},
}
OTHER = "other.rep@smartshape.in"


class FakeRequest:
    def __init__(self, body=None, params=None):
        self._body = body or {}
        self.query_params = params or {}

    async def json(self):
        return self._body


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    for mod in (crm, drip, email_mod, settings_mod, wa_mod, sched):
        monkeypatch.setattr(mod, "db", d, raising=False)
    monkeypatch.setattr(rbac, "MODULE_RBAC_MODE", "enforce", raising=False)
    return d


@pytest.fixture()
def no_cache(monkeypatch):
    """GET /leads caches facets + school maps in Redis; keep it in-process."""
    store = {}

    async def _get(key, default=None):
        return store.get(key, default)

    async def _set(key, value, ttl=600):
        store[key] = value
        return True

    async def _invalidate(pattern):
        return 0

    monkeypatch.setattr(crm, "get_cached", _get)
    monkeypatch.setattr(crm, "set_cached", _set)
    monkeypatch.setattr(crm, "invalidate", _invalidate)
    return store


def _as(user, monkeypatch):
    async def _me(_request):
        return user
    for mod in (crm, drip, email_mod, settings_mod, wa_mod):
        monkeypatch.setattr(mod, "get_current_user", _me, raising=False)


async def _school(db, sid, tags=None, deleted=False, **extra):
    await db.schools.insert_one({"school_id": sid, "school_name": sid, "tag_ids": tags or [],
                                 "is_deleted": deleted, **extra})


async def _contact(db, cid, sid, tags=None, deleted=False, **extra):
    await db.contacts.insert_one({"contact_id": cid, "name": cid, "school_id": sid,
                                  "tag_ids": tags or [], "is_deleted": deleted, **extra})


async def _lead(db, lid, sid, tags=None, deleted=False, **extra):
    await db.leads.insert_one({"lead_id": lid, "company_name": lid, "school_id": sid,
                               "tag_ids": tags or [], "is_deleted": deleted,
                               "stage": "new", "created_at": "2026-09-01T00:00:00+00:00", **extra})


# ─────────────────────────────────────────────────────────────────────────────
# 1. The resolver, one rule at a time
# ─────────────────────────────────────────────────────────────────────────────

def test_d1_a_contact_at_a_matching_school_is_not_in_scope_unless_tagged_itself(db):
    async def go():
        await _school(db, "s1")
        await _contact(db, "c_tagged", "s1", ["t"])
        await _contact(db, "c_colleague", "s1")
        await _contact(db, "c_other_tag", "s1", ["t_other"])
        scope = await resolve_tag_scope(db, "t")
        assert scope["contact_ids"] == {"c_tagged"}
        assert scope["school_ids"] == {"s1"}          # the school DOES surface (D2)
    _run(go())


def test_d1_a_contact_at_a_directly_tagged_school_is_not_in_scope(db):
    async def go():
        await _school(db, "s1", ["t"])
        await _contact(db, "c1", "s1")
        scope = await resolve_tag_scope(db, "t")
        assert scope["contact_ids"] == set()
        assert scope["school_ids"] == {"s1"}
    _run(go())


def test_d2_school_matches_directly_through_a_contact_and_through_a_lead(db):
    async def go():
        await _school(db, "s_direct", ["t"])
        await _school(db, "s_via_contact")
        await _school(db, "s_via_lead")
        await _school(db, "s_unrelated")
        await _contact(db, "c1", "s_via_contact", ["t"])
        await _lead(db, "l1", "s_via_lead", ["t"])
        await _contact(db, "c_unrelated", "s_unrelated", ["t_other"])
        scope = await resolve_tag_scope(db, "t")
        assert scope["school_ids"] == {"s_direct", "s_via_contact", "s_via_lead"}
    _run(go())


def test_d3_a_lead_at_a_matching_school_is_in_scope(db):
    async def go():
        await _school(db, "s_via_contact")
        await _school(db, "s_direct", ["t"])
        await _school(db, "s_via_lead")
        await _contact(db, "c1", "s_via_contact", ["t"])
        await _lead(db, "l_at_contact_school", "s_via_contact")
        await _lead(db, "l_at_direct_school", "s_direct")
        await _lead(db, "l_tagged", "s_via_lead", ["t"])
        await _lead(db, "l_sibling", "s_via_lead")
        await _lead(db, "l_elsewhere", "s_nowhere")
        scope = await resolve_tag_scope(db, "t")
        assert scope["lead_ids"] == {"l_at_contact_school", "l_at_direct_school", "l_tagged", "l_sibling"}
    _run(go())


def test_soft_deletes_never_match_and_never_contribute(db):
    async def go():
        # deleted school, tagged directly -> out, and its lead does not roll in
        await _school(db, "s_deleted", ["t"], deleted=True)
        await _lead(db, "l_at_deleted", "s_deleted")
        # a deleted tagged contact does not surface its school
        await _school(db, "s_via_deleted_contact")
        await _contact(db, "c_deleted", "s_via_deleted_contact", ["t"], deleted=True)
        await _lead(db, "l_at_s2", "s_via_deleted_contact")
        # a deleted tagged lead does not surface its school
        await _school(db, "s_via_deleted_lead")
        await _lead(db, "l_deleted", "s_via_deleted_lead", ["t"], deleted=True)
        await _lead(db, "l_at_s3", "s_via_deleted_lead")
        # a deleted lead at a matching school does not roll in
        await _school(db, "s_live")
        await _contact(db, "c_live", "s_live", ["t"])
        await _lead(db, "l_deleted_at_live", "s_live", deleted=True)
        # a live tagged contact at a deleted school: the person is in, the school is not
        await _contact(db, "c_at_deleted", "s_deleted", ["t"])

        scope = await resolve_tag_scope(db, "t")
        assert scope["contact_ids"] == {"c_live", "c_at_deleted"}
        assert scope["school_ids"] == {"s_live"}
        assert scope["lead_ids"] == set()
    _run(go())


def test_a_school_id_pointing_at_no_school_is_treated_as_no_school(db):
    async def go():
        await _contact(db, "c1", "s_ghost", ["t"])
        await _lead(db, "l_at_ghost", "s_ghost")
        scope = await resolve_tag_scope(db, "t")
        assert scope == {"contact_ids": {"c1"}, "school_ids": set(), "lead_ids": set()}
    _run(go())


def test_a_list_of_tags_is_any_of_and_a_single_id_still_works(db):
    async def go():
        await _school(db, "s_a")
        await _school(db, "s_b")
        await _contact(db, "c_a", "s_a", ["t_a"])
        await _lead(db, "l_b", "s_b", ["t_b"])
        a = await resolve_tag_scope(db, "t_a")
        b = await resolve_tag_scope(db, ["t_b"])
        both = await resolve_tag_scope(db, ["t_a", "t_b", "t_a", "  "])
        assert a["school_ids"] == {"s_a"} and b["school_ids"] == {"s_b"}
        assert both["school_ids"] == {"s_a", "s_b"}
        assert both["contact_ids"] == {"c_a"} and both["lead_ids"] == {"l_b"}
    _run(go())


def test_blank_input_matches_nothing_rather_than_everything(db):
    async def go():
        await _school(db, "s1")
        await _contact(db, "c1", "s1")
        for blank in (None, "", "   ", [], [""]):
            assert await resolve_tag_scope(db, blank) == {
                "contact_ids": set(), "school_ids": set(), "lead_ids": set()}
    _run(go())


class _CountingDb:
    """Wraps a db so the test can count queries — proves there are no per-row lookups."""
    def __init__(self, inner):
        self._inner = inner
        self.finds = 0

    def __getattr__(self, name):
        coll = getattr(self._inner, name)
        outer = self

        class _Coll:
            def find(self, *a, **k):
                outer.finds += 1
                return coll.find(*a, **k)

            def __getattr__(self, n):
                raise AssertionError(f"resolver used {name}.{n}; only batched find() is allowed")
        return _Coll()


def test_the_resolver_issues_four_batched_queries_however_big_the_tag_is(db):
    async def go():
        for i in range(200):
            await _school(db, f"s{i}")
            await _contact(db, f"c{i}", f"s{i}", ["t"])
            await _lead(db, f"l{i}", f"s{i}")
        counting = _CountingDb(db)
        scope = await resolve_tag_scope(counting, "t")
        assert len(scope["school_ids"]) == 200 and len(scope["lead_ids"]) == 200
        assert counting.finds == 4
    _run(go())


# ─────────────────────────────────────────────────────────────────────────────
# 2. The shared fixture — the Python half of the D4 agreement test
# ─────────────────────────────────────────────────────────────────────────────

def _fixture():
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


async def _load_fixture(db, fx):
    await db.schools.insert_many([dict(s) for s in fx["schools"]])
    await db.contacts.insert_many([dict(c) for c in fx["contacts"]])
    await db.leads.insert_many([dict(lead) for lead in fx["leads"]])


@pytest.mark.parametrize("query", _fixture()["queries"], ids=lambda q: q["name"])
def test_resolver_matches_the_shared_fixture(db, query):
    """The frontend asserts the SAME expected sets from the SAME file, so a pass
    on both sides means the screen and the send agree on every query here."""
    async def go():
        await _load_fixture(db, _fixture())
        scope = await resolve_tag_scope(db, query["tag_ids"])
        got = {k: sorted(v) for k, v in scope.items()}
        assert got == query["expected"]
    _run(go())


def test_fixture_mirrors_the_production_shapes_in_the_spec(db):
    """Spec, sub-project 3 testing: GSLC -> 98 / 92 / 2, Demo Done -> 0 / 32 / 34.
    Hot Lead: 1 tagged contact with 10 colleagues stays 1 contact (D1)."""
    async def go():
        fx = _fixture()
        await _load_fixture(db, fx)
        g = await resolve_tag_scope(db, "t_gslc")
        d = await resolve_tag_scope(db, "t_demo")
        h = await resolve_tag_scope(db, "t_hot")
        assert (len(g["contact_ids"]), len(g["school_ids"]), len(g["lead_ids"])) == (98, 92, 2)
        assert (len(d["contact_ids"]), len(d["school_ids"]), len(d["lead_ids"])) == (0, 32, 34)
        assert (len(h["contact_ids"]), len(h["school_ids"]), len(h["lead_ids"])) == (1, 6, 5)
        # The GSLC schools hold 114 people; only the 98 attendees are in scope.
        at_gslc_schools = await db.contacts.count_documents(
            {"school_id": {"$in": sorted(g["school_ids"])}, "is_deleted": {"$ne": True}})
        assert at_gslc_schools == 114
    _run(go())


# ─────────────────────────────────────────────────────────────────────────────
# 3. Every switched caller
# ─────────────────────────────────────────────────────────────────────────────

# ── drip: POST /drip/enroll-schools {tag_id} — enrols SCHOOLS (D2) ──────────

def test_tag_targeted_drip_enrols_a_school_reached_only_through_a_tagged_contact(db, monkeypatch):
    _as(ADMIN, monkeypatch)
    kicks = []

    async def _no_executor():
        kicks.append(1)
    monkeypatch.setattr(sched, "run_drip_executor", _no_executor)

    async def go():
        await db.drip_sequences.insert_one({
            "sequence_id": "seq1", "name": "GSLC follow-up", "is_active": True,
            "steps": [{"step_number": 1, "delay_days": 3, "message_type": "call_task",
                       "message_template": "Call {name}"}],
        })
        await _school(db, "s_via_contact", assigned_to="parul@smartshape.in")
        await _contact(db, "c_attendee", "s_via_contact", ["t_gslc"])
        await _school(db, "s_deleted", deleted=True)
        await _contact(db, "c_at_deleted", "s_deleted", ["t_gslc"])
        await _school(db, "s_untagged")

        out = await drip.enroll_schools(FakeRequest({"sequence_id": "seq1", "tag_id": "t_gslc"}))
        assert out["matched_by_tag"] == 1
        assert out["enrolled"] == 1 and out["total"] == 1

        enr = await db.drip_enrollments.find_one({"sequence_id": "seq1"})
        lead = await db.leads.find_one({"lead_id": enr["lead_id"]})
        assert lead["school_id"] == "s_via_contact"
        # before the roll-up: db.schools.find({"tag_ids": tag}) -> 400 "matched no schools"
    _run(go())
    assert kicks == []   # first step is 3 days out, so the executor was never kicked


def test_tag_targeted_drip_still_refuses_a_tag_that_reaches_no_school(db, monkeypatch):
    _as(ADMIN, monkeypatch)

    async def go():
        await db.drip_sequences.insert_one({
            "sequence_id": "seq1", "name": "x", "is_active": True,
            "steps": [{"step_number": 1, "delay_days": 3, "message_type": "call_task"}]})
        await _contact(db, "c_no_school", None, ["t_x"])
        with pytest.raises(Exception) as exc:
            await drip.enroll_schools(FakeRequest({"sequence_id": "seq1", "tag_id": "t_x"}))
        assert getattr(exc.value, "status_code", None) == 400
        assert await db.drip_enrollments.count_documents({}) == 0
    _run(go())


# ── WhatsApp: POST /whatsapp/broadcast-by-tag — messages LEADS (D3) ─────────

def test_whatsapp_tag_broadcast_reaches_the_lead_at_a_school_surfaced_by_a_tagged_contact(db, monkeypatch,
                                                                                          fake_evolution):
    from wa_fixtures import seed_wa, wire_wa
    _as(ADMIN, monkeypatch)
    wire_wa(monkeypatch, db, fake_evolution)

    async def go():
        await seed_wa(db)
        await db.settings.insert_one({"type": "notifications", "require_wa_consent": False})
        await _school(db, "s_via_contact")
        await _contact(db, "c_attendee", "s_via_contact", ["t_gslc"], phone="9111111111")
        await _lead(db, "l_at_school", "s_via_contact", contact_phone="9222222222",
                    contact_name="Deal Contact")
        await _lead(db, "l_deleted", "s_via_contact", deleted=True, contact_phone="9333333333")
        await _lead(db, "l_elsewhere", "s_other", contact_phone="9444444444")

        out = await settings_mod.whatsapp_broadcast_by_tag(
            FakeRequest({"tag_id": "t_gslc", "message": "Hi {contact_name}"}))
        assert {k: out[k] for k in ("sent", "failed", "skipped", "total")} == {
            "sent": 1, "failed": 0, "skipped": 0, "total": 1}
        assert out["unique_recipients"] == 1 and out["deals"] == 1
        # It goes through services.wa_send.send_whatsapp, to the fake Evolution server.
        assert [s["number"] for s in fake_evolution.sends] == ["919222222222"]
        # before the roll-up: db.leads.find({"tag_ids": tag}) -> total 0
    _run(go())


# ── email campaign audience — PEOPLE, so D1 ─────────────────────────────────

def test_email_campaign_tag_audience_is_the_tagged_people_not_their_colleagues(db, monkeypatch):
    async def go():
        await _school(db, "s1")
        await _contact(db, "c_attendee", "s1", ["t_gslc"], email="a@x.in")
        await _contact(db, "c_colleague", "s1", email="b@x.in")
        await _contact(db, "c_deleted", "s1", ["t_gslc"], deleted=True, email="d@x.in")
        await _school(db, "s_tagged", ["t_gslc"])            # tagged school: its people stay out
        await _contact(db, "c_at_tagged_school", "s_tagged", email="e@x.in")
        await _lead(db, "l_tagged", "s1", ["t_gslc"])        # a lead is not a contact

        out = await email_mod._resolve_audience({"tags": ["t_gslc"]}, ADMIN)
        assert sorted(c["contact_id"] for c in out) == ["c_attendee"]
    _run(go())


def test_email_campaign_tag_audience_keeps_the_owner_scope(db, monkeypatch):
    async def go():
        await _school(db, "s1")
        await _contact(db, "c_mine", "s1", ["t_gslc"], assigned_to=REP["email"], email="m@x.in")
        await _contact(db, "c_theirs", "s1", ["t_gslc"], assigned_to=OTHER, email="t@x.in")
        out = await email_mod._resolve_audience({"tags": ["t_gslc"]}, REP)
        assert [c["contact_id"] for c in out] == ["c_mine"]
    _run(go())


def test_email_campaign_tag_audience_still_ands_with_the_other_facets(db, monkeypatch):
    async def go():
        await _school(db, "s_delhi", city="Delhi")
        await _school(db, "s_pune", city="Pune")
        await _contact(db, "c_delhi", "s_delhi", ["t_gslc"], email="d@x.in")
        await _contact(db, "c_pune", "s_pune", ["t_gslc"], email="p@x.in")
        out = await email_mod._resolve_audience({"tags": ["t_gslc"], "cities": ["Delhi"]}, ADMIN)
        assert [c["contact_id"] for c in out] == ["c_delhi"]
        # a tag nobody carries is an empty audience, never "everyone"
        assert await email_mod._resolve_audience({"tags": ["t_none"]}, ADMIN) == []
    _run(go())


# ── WhatsApp campaign audience — PEOPLE, so D1 ──────────────────────────────

def test_whatsapp_campaign_tag_audience_is_the_tagged_people_not_their_colleagues(db, monkeypatch):
    async def go():
        await _school(db, "s1")
        await _contact(db, "c_attendee", "s1", ["t_gslc"])
        await _contact(db, "c_colleague", "s1")
        await _lead(db, "l_tagged", "s1", ["t_gslc"])
        out = await wa_mod._resolve_audience({"tags": ["t_gslc"]})
        assert [c["contact_id"] for c in out] == ["c_attendee"]
        assert await wa_mod._resolve_audience({"tags": ["t_none"]}) == []
    _run(go())


# ── GET /leads?tag= — LEADS (D3), inside the caller's visibility ────────────

def test_get_leads_by_tag_includes_the_lead_at_a_school_reached_only_through_a_tagged_contact(
        db, monkeypatch, no_cache):
    _as(ADMIN, monkeypatch)

    async def go():
        await _school(db, "s_via_contact")
        await _contact(db, "c_attendee", "s_via_contact", ["t_gslc"])
        await _lead(db, "l_at_school", "s_via_contact")
        await _lead(db, "l_tagged", "s_other", ["t_gslc"])
        await _lead(db, "l_unrelated", "s_other2")

        legacy = await crm.get_leads(FakeRequest(), tag="t_gslc")
        assert sorted(lead["lead_id"] for lead in legacy) == ["l_at_school", "l_tagged"]

        page = await crm.get_leads(FakeRequest(), page=1, limit=50, tag="t_gslc")
        assert page["total"] == 2
        assert sorted(lead["lead_id"] for lead in page["leads"]) == ["l_at_school", "l_tagged"]
    _run(go())


def test_get_leads_by_tag_never_widens_a_reps_visibility(db, monkeypatch, no_cache):
    _as(REP, monkeypatch)

    async def go():
        await _school(db, "s_mine", assigned_to=REP["email"])
        await _school(db, "s_theirs", assigned_to=OTHER)
        await _contact(db, "c1", "s_mine", ["t_gslc"])
        await _contact(db, "c2", "s_theirs", ["t_gslc"])
        await _lead(db, "l_mine", "s_mine", assigned_to=OTHER)      # visible: owned school
        await _lead(db, "l_theirs", "s_theirs", assigned_to=OTHER)  # in scope, NOT visible

        out = await crm.get_leads(FakeRequest(), tag="t_gslc")
        assert [lead["lead_id"] for lead in out] == ["l_mine"]
    _run(go())


# ─────────────────────────────────────────────────────────────────────────────
# Fix round: a non-string id must never 500 a caller
# ─────────────────────────────────────────────────────────────────────────────

def test_mixed_type_ids_do_not_raise_anywhere(db, monkeypatch, no_cache):
    """Ids are strings by convention, but an import or a hand edit can leave an
    int behind. sorted() over {1, "s2"} raises TypeError -> a 500; the resolver
    and its callers must not sort mixed sets."""
    _as(ADMIN, monkeypatch)

    async def go():
        await _school(db, 101)                      # int school_id
        await _school(db, "s2")
        await _contact(db, 7, 101, ["t"])           # int contact_id at the int school
        await _contact(db, "c2", "s2", ["t"])
        await _lead(db, 55, 101)                    # int lead_id
        await _lead(db, "l2", "s2")

        scope = await resolve_tag_scope(db, "t")
        assert scope == {"contact_ids": {7, "c2"}, "school_ids": {101, "s2"}, "lead_ids": {55, "l2"}}

        assert len(await email_mod._resolve_audience({"tags": ["t"]}, ADMIN)) == 2
        assert len(await wa_mod._resolve_audience({"tags": ["t"]})) == 2
        assert len(await crm.get_leads(FakeRequest(), tag="t")) == 2
        await db.drip_sequences.insert_one({
            "sequence_id": "seq1", "name": "x", "is_active": True,
            "steps": [{"step_number": 1, "delay_days": 3, "message_type": "call_task"}]})
        out = await drip.enroll_schools(FakeRequest({"sequence_id": "seq1", "tag_id": "t"}))
        assert out["matched_by_tag"] == 2
    _run(go())
