"""Multi-tag bulk tagging on POST /leads/bulk-tag and POST /schools/bulk-tag.

The owner's ask: "Select School, contact, or Lead ... and add tag once in all" —
tick several tags (or create one) and apply them to a whole selection in ONE
step, on every tab. Contacts already took a `tag_ids` list; this pins:

  - leads + schools accept `tag_ids: [str]` AND the legacy single `tag_id`,
    keeping every response key existing callers read (`modified` on leads;
    `ok`/`updated`/`tag_id`/`action` on schools) and adding
    `requested`/`updated`/`skipped`;
  - on add every tag must exist (400 naming the unknown ids, nothing written);
  - /schools/bulk-tag is now visibility-scoped exactly like GET /schools
    (a rep's out-of-scope ids land in `skipped`), deduped, capped at 2,000,
    logged once per batch, and busts the facet/tag caches;
  - `include_people: true` spreads the same add/remove to the contacts and
    leads at the schools that were actually MATCHED — for a rep, only the ones
    she can see — while the default (false) leaves them untouched.

Harness: mongomock_motor with `crm.db` monkeypatched, route functions called
directly — the same pattern as test_contacts_bulk.py / test_leads_bulk_scoping.py.
Run with:
    DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 \
    python -m pytest tests/test_bulk_multi_tag.py -q
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
OTHER = "other.rep@smartshape.in"


class FakeRequest:
    def __init__(self, body=None):
        self._body = body or {}

    async def json(self):
        return self._body

    async def body(self):   # _parse_json_body reads raw bytes
        return json.dumps(self._body).encode()


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(crm, "db", d)
    monkeypatch.setattr(rbac, "MODULE_RBAC_MODE", "enforce", raising=False)
    return d


@pytest.fixture(autouse=True)
def invalidations(monkeypatch):
    """Keep the cache layer off Redis and record every invalidation."""
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


async def _tags(db, *tag_ids):
    for t in tag_ids:
        await db.tags.insert_one({"tag_id": t, "name": t, "color": "#f00"})


async def _school(db, sid, *, assigned_to="", created_by="", tag_ids=None, is_deleted=False):
    await db.schools.insert_one({
        "school_id": sid, "school_name": sid, "assigned_to": assigned_to,
        "created_by": created_by, "tag_ids": tag_ids or [], "is_deleted": is_deleted,
    })


async def _contact(db, cid, *, school_id=None, assigned_to="", tag_ids=None, is_deleted=False):
    await db.contacts.insert_one({
        "contact_id": cid, "name": cid, "phone": "9000000000", "school_id": school_id,
        "assigned_to": assigned_to, "tag_ids": tag_ids or [], "is_deleted": is_deleted,
    })


async def _lead(db, lid, *, school_id=None, assigned_to="", tag_ids=None, is_deleted=False):
    await db.leads.insert_one({
        "lead_id": lid, "company_name": lid, "school_id": school_id,
        "assigned_to": assigned_to, "stage": "new", "tag_ids": tag_ids or [],
        "is_deleted": is_deleted, "pipeline_history": [],
    })


async def _tags_of(db, coll, key, val):
    doc = await db[coll].find_one({key: val})
    return sorted(doc.get("tag_ids") or [])


# ---------------------------------------------------------------------------
# leads — multi-tag + legacy
# ---------------------------------------------------------------------------

def test_leads_multi_tag_add_then_remove(db, monkeypatch):
    _as(ADMIN, monkeypatch)

    async def go():
        await _tags(db, "t_a", "t_b", "t_c")
        await _lead(db, "l1", tag_ids=["t_a"])
        await _lead(db, "l2", tag_ids=["t_c"])
        out = await crm.bulk_tag_leads(FakeRequest({
            "lead_ids": ["l1", "l2"], "tag_ids": ["t_a", "t_b", "t_a"], "action": "add",
        }))
        assert (out["requested"], out["updated"], out["skipped"]) == (2, 2, 0)
        assert "modified" in out
        assert await _tags_of(db, "leads", "lead_id", "l1") == ["t_a", "t_b"]
        assert await _tags_of(db, "leads", "lead_id", "l2") == ["t_a", "t_b", "t_c"]

        out = await crm.bulk_tag_leads(FakeRequest({
            "lead_ids": ["l1", "l2"], "tag_ids": ["t_a", "t_b"], "action": "remove",
        }))
        assert (out["requested"], out["updated"], out["skipped"]) == (2, 2, 0)
        assert await _tags_of(db, "leads", "lead_id", "l1") == []
        assert await _tags_of(db, "leads", "lead_id", "l2") == ["t_c"]
    _run(go())


def test_leads_legacy_single_tag_id_still_works_with_old_keys(db, monkeypatch):
    _as(ADMIN, monkeypatch)

    async def go():
        await _tags(db, "t_a")
        await _lead(db, "l1")
        out = await crm.bulk_tag_leads(FakeRequest({
            "lead_ids": ["l1"], "tag_id": "t_a", "action": "add",
        }))
        assert out == {"requested": 1, "updated": 1, "skipped": 0, "modified": 1}
        assert await _tags_of(db, "leads", "lead_id", "l1") == ["t_a"]
    _run(go())


def test_leads_unknown_tag_is_400_and_writes_nothing(db, monkeypatch):
    _as(ADMIN, monkeypatch)

    async def go():
        await _tags(db, "t_real")
        await _lead(db, "l1")
        with pytest.raises(HTTPException) as exc:
            await crm.bulk_tag_leads(FakeRequest({
                "lead_ids": ["l1"], "tag_ids": ["t_real", "t_ghost"], "action": "add",
            }))
        assert exc.value.status_code == 400
        assert "t_ghost" in exc.value.detail and "t_real" not in exc.value.detail
        assert await _tags_of(db, "leads", "lead_id", "l1") == []
    _run(go())


def test_leads_non_list_tag_ids_is_400(db, monkeypatch):
    _as(ADMIN, monkeypatch)

    async def go():
        await _tags(db, "t_a")
        await _lead(db, "l1")
        for bad in ("t_a", [1, 2], {"t_a": 1}):
            with pytest.raises(HTTPException) as exc:
                await crm.bulk_tag_leads(FakeRequest({
                    "lead_ids": ["l1"], "tag_ids": bad, "action": "add",
                }))
            assert exc.value.status_code == 400
        with pytest.raises(HTTPException) as exc:
            await crm.bulk_tag_leads(FakeRequest({"lead_ids": ["l1"], "action": "add"}))
        assert exc.value.status_code == 400
    _run(go())


# ---------------------------------------------------------------------------
# schools — multi-tag + legacy + validation
# ---------------------------------------------------------------------------

def test_schools_multi_tag_add_then_remove(db, monkeypatch, invalidations):
    _as(ADMIN, monkeypatch)

    async def go():
        await _tags(db, "t_a", "t_b", "t_c")
        await _school(db, "s1", tag_ids=["t_c"])
        await _school(db, "s2")
        out = await crm.bulk_tag_schools(FakeRequest({
            "school_ids": ["s1", "s2", "s2"], "tag_ids": ["t_a", "t_b"], "action": "add",
        }))
        assert out["ok"] is True
        assert (out["requested"], out["updated"], out["skipped"]) == (2, 2, 0)
        assert out["tag_id"] == "t_a" and out["tag_ids"] == ["t_a", "t_b"]
        assert out["action"] == "add"
        assert await _tags_of(db, "schools", "school_id", "s1") == ["t_a", "t_b", "t_c"]
        assert await _tags_of(db, "schools", "school_id", "s2") == ["t_a", "t_b"]

        out = await crm.bulk_tag_schools(FakeRequest({
            "school_ids": ["s1", "s2"], "tag_ids": ["t_a", "t_b"], "action": "remove",
        }))
        assert out["updated"] == 2 and out["action"] == "remove"
        assert await _tags_of(db, "schools", "school_id", "s1") == ["t_c"]
        assert await _tags_of(db, "schools", "school_id", "s2") == []
    _run(go())
    assert "crm:facets:*" in invalidations
    assert "tags:*" in invalidations


def test_schools_legacy_single_tag_id_keeps_old_keys(db, monkeypatch):
    _as(ADMIN, monkeypatch)

    async def go():
        await _tags(db, "t_a")
        await _school(db, "s1")
        out = await crm.bulk_tag_schools(FakeRequest({
            "school_ids": ["s1"], "tag_id": "t_a", "action": "add",
        }))
        for key in ("ok", "updated", "tag_id", "action", "requested", "skipped"):
            assert key in out, key
        assert out["ok"] is True and out["updated"] == 1
        assert out["tag_id"] == "t_a" and out["action"] == "add"
        assert await _tags_of(db, "schools", "school_id", "s1") == ["t_a"]
    _run(go())


def test_schools_unknown_tag_is_400_and_writes_nothing(db, monkeypatch):
    _as(ADMIN, monkeypatch)

    async def go():
        await _tags(db, "t_real")
        await _school(db, "s1")
        await _contact(db, "c1", school_id="s1")
        await _lead(db, "l1", school_id="s1")
        with pytest.raises(HTTPException) as exc:
            await crm.bulk_tag_schools(FakeRequest({
                "school_ids": ["s1"], "tag_ids": ["t_real", "t_ghost"], "action": "add",
                "include_people": True,
            }))
        assert exc.value.status_code == 400
        assert "t_ghost" in exc.value.detail
        assert await _tags_of(db, "schools", "school_id", "s1") == []
        assert await _tags_of(db, "contacts", "contact_id", "c1") == []
        assert await _tags_of(db, "leads", "lead_id", "l1") == []
        assert await db.activity_logs.count_documents({}) == 0
    _run(go())


def test_schools_remove_of_an_unknown_tag_is_a_harmless_no_op(db, monkeypatch):
    _as(ADMIN, monkeypatch)

    async def go():
        await _school(db, "s1", tag_ids=["t_deleted_since"])
        out = await crm.bulk_tag_schools(FakeRequest({
            "school_ids": ["s1"], "tag_ids": ["t_deleted_since"], "action": "remove",
        }))
        assert out["updated"] == 1
        assert await _tags_of(db, "schools", "school_id", "s1") == []
    _run(go())


def test_schools_2001_ids_is_400(db, monkeypatch):
    _as(ADMIN, monkeypatch)

    async def go():
        await _tags(db, "t_a")
        with pytest.raises(HTTPException) as exc:
            await crm.bulk_tag_schools(FakeRequest({
                "school_ids": [f"s_{i}" for i in range(2001)], "tag_ids": ["t_a"], "action": "add",
            }))
        assert exc.value.status_code == 400
    _run(go())


def test_schools_duplicates_are_deduped_before_the_cap(db, monkeypatch):
    _as(ADMIN, monkeypatch)

    async def go():
        await _tags(db, "t_a")
        await _school(db, "s1")
        out = await crm.bulk_tag_schools(FakeRequest({
            "school_ids": ["s1"] * 2500, "tag_ids": ["t_a"], "action": "add",
        }))
        assert (out["requested"], out["updated"], out["skipped"]) == (1, 1, 0)
    _run(go())


def test_schools_bad_bodies_are_400(db, monkeypatch):
    _as(ADMIN, monkeypatch)

    async def go():
        await _tags(db, "t_a")
        await _school(db, "s1")
        bad_bodies = [
            {"school_ids": ["s1"], "tag_ids": "t_a", "action": "add"},
            {"school_ids": ["s1"], "tag_ids": [], "action": "add"},
            {"school_ids": [], "tag_ids": ["t_a"], "action": "add"},
            {"school_ids": "s1", "tag_ids": ["t_a"], "action": "add"},
            {"school_ids": ["s1"], "tag_ids": ["t_a"], "action": "toggle"},
            {"school_ids": ["s1"], "tag_id": 7, "action": "add"},
        ]
        for body in bad_bodies:
            with pytest.raises(HTTPException) as exc:
                await crm.bulk_tag_schools(FakeRequest(body))
            assert exc.value.status_code == 400, body
        assert await _tags_of(db, "schools", "school_id", "s1") == []
    _run(go())


def test_schools_soft_deleted_school_is_skipped(db, monkeypatch):
    _as(ADMIN, monkeypatch)

    async def go():
        await _tags(db, "t_a")
        await _school(db, "s_gone", is_deleted=True)
        out = await crm.bulk_tag_schools(FakeRequest({
            "school_ids": ["s_gone"], "tag_ids": ["t_a"], "action": "add",
        }))
        assert (out["updated"], out["skipped"]) == (0, 1)
        assert await _tags_of(db, "schools", "school_id", "s_gone") == []
    _run(go())


def test_schools_one_activity_entry_per_batch(db, monkeypatch):
    _as(ADMIN, monkeypatch)

    async def go():
        await _tags(db, "t_a", "t_b")
        for i in range(5):
            await _school(db, f"s{i}")
        await crm.bulk_tag_schools(FakeRequest({
            "school_ids": [f"s{i}" for i in range(5)], "tag_ids": ["t_a", "t_b"], "action": "add",
        }))
        assert await db.activity_logs.count_documents({"action": "bulk_tag_add"}) == 1
    _run(go())


# ---------------------------------------------------------------------------
# schools — rep scoping (must equal GET /schools)
# ---------------------------------------------------------------------------

async def _seed_rep_schools(db):
    """Schools a scoped REP might select. Visible in GET /schools:
    - s_owned: assigned to the rep;
    - s_created: created by the rep, still unassigned;
    - s_via_lead: owned by OTHER but holding a lead assigned to the rep;
    - s_via_quote: owned by OTHER but holding the rep's quotation.
    Invisible: s_other (OTHER's, nothing of the rep's on it)."""
    await _school(db, "s_owned", assigned_to=REP["email"])
    await _school(db, "s_created", created_by=REP["email"])
    await _school(db, "s_via_lead", assigned_to=OTHER)
    await _lead(db, "l_rep_at_via_lead", school_id="s_via_lead", assigned_to=REP["email"])
    await _school(db, "s_via_quote", assigned_to=OTHER)
    await db.quotations.insert_one({"quotation_id": "q1", "school_id": "s_via_quote",
                                    "created_by": REP["email"], "is_deleted": False})
    await _school(db, "s_other", assigned_to=OTHER)
    return ["s_owned", "s_created", "s_via_lead", "s_via_quote"], ["s_other"]


def test_schools_rep_tags_exactly_what_get_schools_shows_her(db, monkeypatch):
    _as(REP, monkeypatch)

    async def go():
        await _tags(db, "t_a", "t_b")
        visible, invisible = await _seed_rep_schools(db)
        listed = sorted(s["school_id"] for s in await crm.get_schools(FakeRequest()))
        assert listed == sorted(visible)

        out = await crm.bulk_tag_schools(FakeRequest({
            "school_ids": visible + invisible, "tag_ids": ["t_a", "t_b"], "action": "add",
        }))
        assert (out["requested"], out["updated"], out["skipped"]) == (5, 4, 1)
        for sid in visible:
            assert await _tags_of(db, "schools", "school_id", sid) == ["t_a", "t_b"]
        assert await _tags_of(db, "schools", "school_id", "s_other") == []
    _run(go())


def test_schools_admin_reaches_every_school(db, monkeypatch):
    _as(ADMIN, monkeypatch)

    async def go():
        await _tags(db, "t_a")
        visible, invisible = await _seed_rep_schools(db)
        out = await crm.bulk_tag_schools(FakeRequest({
            "school_ids": visible + invisible, "tag_ids": ["t_a"], "action": "add",
        }))
        assert (out["requested"], out["updated"], out["skipped"]) == (5, 5, 0)
    _run(go())


def test_schools_read_only_grant_is_403(db, monkeypatch):
    _as({**REP, "module_permissions": {"leads": {"level": "read", "scope": "own"}}}, monkeypatch)

    async def go():
        await _tags(db, "t_a")
        await _school(db, "s1", assigned_to=REP["email"])
        with pytest.raises(HTTPException) as exc:
            await crm.bulk_tag_schools(FakeRequest({
                "school_ids": ["s1"], "tag_ids": ["t_a"], "action": "add",
            }))
        assert exc.value.status_code == 403
        assert await _tags_of(db, "schools", "school_id", "s1") == []
    _run(go())


# ---------------------------------------------------------------------------
# schools — include_people
# ---------------------------------------------------------------------------

async def _seed_people(db):
    """Two selected schools with people, one unselected school with people."""
    await _school(db, "s1")
    await _school(db, "s2")
    await _school(db, "s_unselected")
    await _contact(db, "c1a", school_id="s1")
    await _contact(db, "c1b", school_id="s1", tag_ids=["t_keep"])
    await _contact(db, "c1_deleted", school_id="s1", is_deleted=True)
    await _contact(db, "c2", school_id="s2")
    await _contact(db, "c_unsel", school_id="s_unselected")
    await _lead(db, "l1", school_id="s1")
    await _lead(db, "l2", school_id="s2")
    await _lead(db, "l2_deleted", school_id="s2", is_deleted=True)
    await _lead(db, "l_unsel", school_id="s_unselected")


def test_include_people_true_tags_contacts_and_leads_of_matched_schools(db, monkeypatch):
    _as(ADMIN, monkeypatch)

    async def go():
        await _tags(db, "t_a", "t_b")
        await _seed_people(db)
        out = await crm.bulk_tag_schools(FakeRequest({
            "school_ids": ["s1", "s2"], "tag_ids": ["t_a", "t_b"], "action": "add",
            "include_people": True,
        }))
        assert out["updated"] == 2
        assert out["contacts_updated"] == 3   # c1a, c1b, c2 — not the deleted one
        assert out["leads_updated"] == 2      # l1, l2 — not the deleted one
        for cid in ("c1a", "c2"):
            assert await _tags_of(db, "contacts", "contact_id", cid) == ["t_a", "t_b"]
        assert await _tags_of(db, "contacts", "contact_id", "c1b") == ["t_a", "t_b", "t_keep"]
        for lid in ("l1", "l2"):
            assert await _tags_of(db, "leads", "lead_id", lid) == ["t_a", "t_b"]
        # untouched: soft-deleted people, and everyone at an unselected school
        assert await _tags_of(db, "contacts", "contact_id", "c1_deleted") == []
        assert await _tags_of(db, "leads", "lead_id", "l2_deleted") == []
        assert await _tags_of(db, "contacts", "contact_id", "c_unsel") == []
        assert await _tags_of(db, "leads", "lead_id", "l_unsel") == []
        assert await db.activity_logs.count_documents({"action": "bulk_tag_add"}) == 1
    _run(go())


def test_include_people_default_false_leaves_people_untouched(db, monkeypatch):
    _as(ADMIN, monkeypatch)

    async def go():
        await _tags(db, "t_a")
        await _seed_people(db)
        for body_extra in ({}, {"include_people": False}, {"include_people": "yes"}):
            out = await crm.bulk_tag_schools(FakeRequest({
                "school_ids": ["s1", "s2"], "tag_ids": ["t_a"], "action": "add", **body_extra,
            }))
            assert out["updated"] == 2
            assert (out["contacts_updated"], out["leads_updated"]) == (0, 0)
        assert await _tags_of(db, "schools", "school_id", "s1") == ["t_a"]
        for cid in ("c1a", "c2"):
            assert await _tags_of(db, "contacts", "contact_id", cid) == []
        for lid in ("l1", "l2"):
            assert await _tags_of(db, "leads", "lead_id", lid) == []
    _run(go())


def test_include_people_skips_people_of_a_deleted_school(db, monkeypatch):
    _as(ADMIN, monkeypatch)

    async def go():
        await _tags(db, "t_a")
        await _school(db, "s_gone", is_deleted=True)
        await _contact(db, "c_gone_school", school_id="s_gone")
        await _lead(db, "l_gone_school", school_id="s_gone")
        out = await crm.bulk_tag_schools(FakeRequest({
            "school_ids": ["s_gone"], "tag_ids": ["t_a"], "action": "add", "include_people": True,
        }))
        assert (out["updated"], out["contacts_updated"], out["leads_updated"]) == (0, 0, 0)
        assert await _tags_of(db, "contacts", "contact_id", "c_gone_school") == []
        assert await _tags_of(db, "leads", "lead_id", "l_gone_school") == []
    _run(go())


def test_include_people_remove_pulls_from_all_three(db, monkeypatch):
    _as(ADMIN, monkeypatch)

    async def go():
        await _tags(db, "t_a", "t_b")
        await _school(db, "s1", tag_ids=["t_a", "t_b", "t_keep"])
        await _contact(db, "c1", school_id="s1", tag_ids=["t_a", "t_keep"])
        await _lead(db, "l1", school_id="s1", tag_ids=["t_b"])
        out = await crm.bulk_tag_schools(FakeRequest({
            "school_ids": ["s1"], "tag_ids": ["t_a", "t_b"], "action": "remove",
            "include_people": True,
        }))
        assert (out["updated"], out["contacts_updated"], out["leads_updated"]) == (1, 1, 1)
        assert await _tags_of(db, "schools", "school_id", "s1") == ["t_keep"]
        assert await _tags_of(db, "contacts", "contact_id", "c1") == ["t_keep"]
        assert await _tags_of(db, "leads", "lead_id", "l1") == []
    _run(go())


def test_include_people_for_a_rep_never_leaves_her_scope(db, monkeypatch):
    """A rep selects an out-of-scope school (by id) plus a school she only sees
    through her own lead. She must reach:
      - nobody at the out-of-scope school, even though she requested it;
      - at the linked school, only the people SHE can see — her own lead and
        her own contact — not the other rep's contact or lead there.
    At a school she owns she reaches everyone there (the owned-school rule)."""
    _as(REP, monkeypatch)

    async def go():
        await _tags(db, "t_a")
        await _seed_rep_schools(db)
        # out of scope
        await _contact(db, "c_other_school", school_id="s_other", assigned_to=OTHER)
        await _lead(db, "l_other_school", school_id="s_other", assigned_to=OTHER)
        # linked (via the rep's lead) but owned by OTHER
        await _contact(db, "c_rep_at_via_lead", school_id="s_via_lead", assigned_to=REP["email"])
        await _contact(db, "c_other_at_via_lead", school_id="s_via_lead", assigned_to=OTHER)
        await _lead(db, "l_other_at_via_lead", school_id="s_via_lead", assigned_to=OTHER)
        # owned by the rep: other rep's people there are visible to her
        await _contact(db, "c_other_at_owned", school_id="s_owned", assigned_to=OTHER)
        await _lead(db, "l_other_at_owned", school_id="s_owned", assigned_to=OTHER)

        out = await crm.bulk_tag_schools(FakeRequest({
            "school_ids": ["s_other", "s_via_lead", "s_owned"], "tag_ids": ["t_a"],
            "action": "add", "include_people": True,
        }))
        assert (out["requested"], out["updated"], out["skipped"]) == (3, 2, 1)
        assert out["contacts_updated"] == 2   # c_rep_at_via_lead, c_other_at_owned
        assert out["leads_updated"] == 2      # l_rep_at_via_lead, l_other_at_owned

        tagged = {"c_rep_at_via_lead", "c_other_at_owned"}
        for cid in ("c_other_school", "c_rep_at_via_lead", "c_other_at_via_lead", "c_other_at_owned"):
            want = ["t_a"] if cid in tagged else []
            assert await _tags_of(db, "contacts", "contact_id", cid) == want, cid
        tagged = {"l_rep_at_via_lead", "l_other_at_owned"}
        for lid in ("l_other_school", "l_rep_at_via_lead", "l_other_at_via_lead", "l_other_at_owned"):
            want = ["t_a"] if lid in tagged else []
            assert await _tags_of(db, "leads", "lead_id", lid) == want, lid
        assert await _tags_of(db, "schools", "school_id", "s_other") == []
    _run(go())
