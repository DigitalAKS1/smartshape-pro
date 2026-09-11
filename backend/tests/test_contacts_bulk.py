"""POST /contacts/bulk-tag and POST /contacts/bulk-assign (crm_routes.py).

Contacts had no bulk endpoint of any kind before this branch — only the
per-contact add/removeTag. These two routes are modelled on the existing
`/schools/bulk-tag` and `/leads/bulk-assign`, but — unlike the existing
`/leads/bulk-tag` / `/leads/bulk-stage` (which check only get_current_user,
so any logged-in user can touch any lead) — they are owner-scoped: a
non-"all" caller only ever reaches contacts `_owner_clause` says are theirs.

Uses mongomock_motor with `crm.db` monkeypatched, and calls the route
functions directly — the harness `test_contacts_import_route.py` and
`test_tag_permissions.py` already established for this codebase.
Run with:
    DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 \
    python -m pytest tests/test_contacts_bulk.py -q
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
# A scoped ("own") sales rep — read_write on leads but only over what they own.
REP = {
    "email": "rep@smartshape.in", "name": "Rep", "role": "sales",
    "module_permissions": {"leads": {"level": "read_write", "scope": "own"}},
}
OTHER_REP_EMAIL = "other.rep@smartshape.in"
# Read-only grant — must be refused before a single row is touched.
READ_ONLY = {
    "email": "readonly@smartshape.in", "name": "Read Only", "role": "sales",
    "module_permissions": {"leads": {"level": "read", "scope": "own"}},
}


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


def _as(user, monkeypatch):
    async def _me(_request):
        return user
    monkeypatch.setattr(crm, "get_current_user", _me)


def _run(coro):
    return asyncio.run(coro)


async def _seed_tag(db, tag_id, name):
    await db.tags.insert_one({"tag_id": tag_id, "name": name, "color": "#f00"})


async def _seed_contact(db, contact_id, *, assigned_to="", tag_ids=None, is_deleted=False):
    await db.contacts.insert_one({
        "contact_id": contact_id, "name": contact_id, "phone": "9000000000",
        "assigned_to": assigned_to, "tag_ids": tag_ids or [],
        "is_deleted": is_deleted,
    })


# ---------------------------------------------------------------------------
# bulk-tag
# ---------------------------------------------------------------------------

def test_bulk_tag_add_adds_every_tag_without_duplicating_existing_ones(db, monkeypatch):
    _as(ADMIN, monkeypatch)

    async def go():
        await _seed_tag(db, "tag_a", "A")
        await _seed_tag(db, "tag_b", "B")
        await _seed_contact(db, "c1", tag_ids=["tag_a"])  # already has tag_a
        await _seed_contact(db, "c2", tag_ids=[])

        out = await crm.bulk_tag_contacts(FakeRequest({
            "contact_ids": ["c1", "c2"], "tag_ids": ["tag_a", "tag_b"], "action": "add",
        }))
        assert out == {"requested": 2, "updated": 2, "skipped": 0}

        c1 = await db.contacts.find_one({"contact_id": "c1"})
        c2 = await db.contacts.find_one({"contact_id": "c2"})
        # tag_a is not duplicated on c1; both contacts end up with both tags.
        assert sorted(c1["tag_ids"]) == ["tag_a", "tag_b"]
        assert sorted(c2["tag_ids"]) == ["tag_a", "tag_b"]
    _run(go())


def test_bulk_tag_remove_pulls_every_listed_tag(db, monkeypatch):
    _as(ADMIN, monkeypatch)

    async def go():
        await _seed_tag(db, "tag_a", "A")
        await _seed_tag(db, "tag_b", "B")
        await _seed_contact(db, "c1", tag_ids=["tag_a", "tag_b", "tag_c"])

        out = await crm.bulk_tag_contacts(FakeRequest({
            "contact_ids": ["c1"], "tag_ids": ["tag_a", "tag_b"], "action": "remove",
        }))
        assert out == {"requested": 1, "updated": 1, "skipped": 0}
        c1 = await db.contacts.find_one({"contact_id": "c1"})
        assert c1["tag_ids"] == ["tag_c"]
    _run(go())


def test_scoped_rep_only_updates_contacts_they_own(db, monkeypatch):
    """10 ids, 4 owned by the caller, 6 owned by someone else -> updated=4."""
    _as(REP, monkeypatch)

    async def go():
        await _seed_tag(db, "tag_hot", "Hot")
        mine = [f"mine_{i}" for i in range(4)]
        theirs = [f"theirs_{i}" for i in range(6)]
        for cid in mine:
            await _seed_contact(db, cid, assigned_to=REP["email"])
        for cid in theirs:
            await _seed_contact(db, cid, assigned_to=OTHER_REP_EMAIL)

        out = await crm.bulk_tag_contacts(FakeRequest({
            "contact_ids": mine + theirs, "tag_ids": ["tag_hot"], "action": "add",
        }))
        assert out == {"requested": 10, "updated": 4, "skipped": 6}
        for cid in mine:
            assert (await db.contacts.find_one({"contact_id": cid}))["tag_ids"] == ["tag_hot"]
        for cid in theirs:
            assert (await db.contacts.find_one({"contact_id": cid}))["tag_ids"] == []
    _run(go())


def test_admin_updates_all_ten_regardless_of_owner(db, monkeypatch):
    _as(ADMIN, monkeypatch)

    async def go():
        await _seed_tag(db, "tag_hot", "Hot")
        ids = [f"c_{i}" for i in range(10)]
        for i, cid in enumerate(ids):
            await _seed_contact(db, cid, assigned_to=(REP["email"] if i < 4 else OTHER_REP_EMAIL))

        out = await crm.bulk_tag_contacts(FakeRequest({
            "contact_ids": ids, "tag_ids": ["tag_hot"], "action": "add",
        }))
        assert out == {"requested": 10, "updated": 10, "skipped": 0}
    _run(go())


def test_more_than_2000_ids_is_rejected(db, monkeypatch):
    _as(ADMIN, monkeypatch)

    async def go():
        await _seed_tag(db, "tag_hot", "Hot")
        ids = [f"c_{i}" for i in range(2001)]
        with pytest.raises(HTTPException) as exc:
            await crm.bulk_tag_contacts(FakeRequest({
                "contact_ids": ids, "tag_ids": ["tag_hot"], "action": "add",
            }))
        assert exc.value.status_code == 400
    _run(go())


def test_duplicate_ids_in_the_request_are_counted_once(db, monkeypatch):
    _as(ADMIN, monkeypatch)

    async def go():
        await _seed_tag(db, "tag_hot", "Hot")
        await _seed_contact(db, "c1")

        out = await crm.bulk_tag_contacts(FakeRequest({
            "contact_ids": ["c1", "c1", "c1"], "tag_ids": ["tag_hot"], "action": "add",
        }))
        assert out == {"requested": 1, "updated": 1, "skipped": 0}
    _run(go())


def test_soft_deleted_contacts_are_excluded(db, monkeypatch):
    _as(ADMIN, monkeypatch)

    async def go():
        await _seed_tag(db, "tag_hot", "Hot")
        await _seed_contact(db, "c_gone", is_deleted=True)

        out = await crm.bulk_tag_contacts(FakeRequest({
            "contact_ids": ["c_gone"], "tag_ids": ["tag_hot"], "action": "add",
        }))
        assert out == {"requested": 1, "updated": 0, "skipped": 1}
        assert (await db.contacts.find_one({"contact_id": "c_gone"}))["tag_ids"] == []
    _run(go())


def test_user_without_the_leads_write_grant_is_refused(db, monkeypatch):
    _as(READ_ONLY, monkeypatch)

    async def go():
        await _seed_tag(db, "tag_hot", "Hot")
        await _seed_contact(db, "c1", assigned_to=READ_ONLY["email"])
        with pytest.raises(HTTPException) as exc:
            await crm.bulk_tag_contacts(FakeRequest({
                "contact_ids": ["c1"], "tag_ids": ["tag_hot"], "action": "add",
            }))
        assert exc.value.status_code == 403
    _run(go())


# ---------------------------------------------------------------------------
# bulk-assign
# ---------------------------------------------------------------------------

def test_bulk_assign_resolves_email_and_stores_the_display_name(db, monkeypatch):
    """The bug this pins: a bare display NAME must never land in `assigned_to`
    — only the resolved email does, with the name mirrored into `assigned_name`."""
    _as(ADMIN, monkeypatch)

    async def go():
        await db.users.insert_one({"email": "newowner@smartshape.in", "name": "New Owner"})
        await _seed_contact(db, "c1")
        await _seed_contact(db, "c2")

        out = await crm.bulk_assign_contacts(FakeRequest({
            "contact_ids": ["c1", "c2"], "assigned_to": "New Owner",  # typed as a NAME
        }))
        assert out == {"requested": 2, "updated": 2, "skipped": 0}

        for cid in ("c1", "c2"):
            c = await db.contacts.find_one({"contact_id": cid})
            assert c["assigned_to"] == "newowner@smartshape.in", (
                "assigned_to must be the resolved EMAIL, never the bare name"
            )
            assert c["assigned_name"] == "New Owner"
    _run(go())


def test_bulk_assign_by_email_resolves_the_display_name_too(db, monkeypatch):
    _as(ADMIN, monkeypatch)

    async def go():
        await db.users.insert_one({"email": "newowner@smartshape.in", "name": "New Owner"})
        await _seed_contact(db, "c1")

        await crm.bulk_assign_contacts(FakeRequest({
            "contact_ids": ["c1"], "assigned_to": "newowner@smartshape.in",
        }))
        c = await db.contacts.find_one({"contact_id": "c1"})
        assert c["assigned_to"] == "newowner@smartshape.in"
        assert c["assigned_name"] == "New Owner"
    _run(go())


def test_bulk_assign_unresolvable_name_is_rejected_not_silently_dropped(db, monkeypatch):
    _as(ADMIN, monkeypatch)

    async def go():
        await _seed_contact(db, "c1")
        with pytest.raises(HTTPException) as exc:
            await crm.bulk_assign_contacts(FakeRequest({
                "contact_ids": ["c1"], "assigned_to": "Nobody Known",
            }))
        assert exc.value.status_code == 400
        # untouched — no silent unassignment
        c = await db.contacts.find_one({"contact_id": "c1"})
        assert c["assigned_to"] == ""
    _run(go())


def test_bulk_assign_is_owner_scoped_like_bulk_tag(db, monkeypatch):
    _as(REP, monkeypatch)

    async def go():
        await db.users.insert_one({"email": "newowner@smartshape.in", "name": "New Owner"})
        await _seed_contact(db, "mine", assigned_to=REP["email"])
        await _seed_contact(db, "theirs", assigned_to=OTHER_REP_EMAIL)

        out = await crm.bulk_assign_contacts(FakeRequest({
            "contact_ids": ["mine", "theirs"], "assigned_to": "newowner@smartshape.in",
        }))
        assert out == {"requested": 2, "updated": 1, "skipped": 1}
        assert (await db.contacts.find_one({"contact_id": "mine"}))["assigned_to"] == "newowner@smartshape.in"
        assert (await db.contacts.find_one({"contact_id": "theirs"}))["assigned_to"] == OTHER_REP_EMAIL
    _run(go())


def test_bulk_assign_more_than_2000_ids_is_rejected(db, monkeypatch):
    _as(ADMIN, monkeypatch)

    async def go():
        ids = [f"c_{i}" for i in range(2001)]
        with pytest.raises(HTTPException) as exc:
            await crm.bulk_assign_contacts(FakeRequest({
                "contact_ids": ids, "assigned_to": "someone@smartshape.in",
            }))
        assert exc.value.status_code == 400
    _run(go())


# ---------------------------------------------------------------------------
# Visibility must match GET /contacts (fix round 1, item 7)
#
# GET /contacts shows a scoped rep a contact whenever it sits at a school
# they own, even if that contact's own `assigned_to` is someone else
# (`_contacts_visibility_or` = `_owner_clause` OR under-an-owned-school). The
# bulk routes originally scoped with `_owner_clause` alone, so a contact the
# rep could plainly see in the list came back "skipped" from a bulk action —
# this pins the fix.
# ---------------------------------------------------------------------------

async def _seed_school(db, school_id, *, assigned_to=""):
    await db.schools.insert_one({
        "school_id": school_id, "school_name": school_id,
        "assigned_to": assigned_to, "is_deleted": False,
    })


def test_bulk_tag_reaches_a_contact_at_a_school_the_rep_owns_even_if_assigned_elsewhere(db, monkeypatch):
    _as(REP, monkeypatch)

    async def go():
        await _seed_tag(db, "tag_hot", "Hot")
        await _seed_school(db, "sch_owned", assigned_to=REP["email"])
        await _seed_school(db, "sch_other", assigned_to=OTHER_REP_EMAIL)
        # Visible to the rep via GET /contacts (owned school), even though its
        # own assigned_to is someone else — must be reachable by bulk-tag too.
        await db.contacts.insert_one({
            "contact_id": "c_owned_school", "name": "c_owned_school", "phone": "9000000000",
            "assigned_to": OTHER_REP_EMAIL, "school_id": "sch_owned", "tag_ids": [], "is_deleted": False,
        })
        # Not visible: someone else's contact at a school the rep does not own.
        await db.contacts.insert_one({
            "contact_id": "c_other_school", "name": "c_other_school", "phone": "9000000000",
            "assigned_to": OTHER_REP_EMAIL, "school_id": "sch_other", "tag_ids": [], "is_deleted": False,
        })

        out = await crm.bulk_tag_contacts(FakeRequest({
            "contact_ids": ["c_owned_school", "c_other_school"],
            "tag_ids": ["tag_hot"], "action": "add",
        }))
        assert out == {"requested": 2, "updated": 1, "skipped": 1}
        assert (await db.contacts.find_one({"contact_id": "c_owned_school"}))["tag_ids"] == ["tag_hot"]
        assert (await db.contacts.find_one({"contact_id": "c_other_school"}))["tag_ids"] == []
    _run(go())


def test_bulk_assign_reaches_a_contact_at_a_school_the_rep_owns_even_if_assigned_elsewhere(db, monkeypatch):
    _as(REP, monkeypatch)

    async def go():
        await db.users.insert_one({"email": "newowner@smartshape.in", "name": "New Owner"})
        await _seed_school(db, "sch_owned", assigned_to=REP["email"])
        await _seed_school(db, "sch_other", assigned_to=OTHER_REP_EMAIL)
        await db.contacts.insert_one({
            "contact_id": "c_owned_school", "name": "c_owned_school", "phone": "9000000000",
            "assigned_to": OTHER_REP_EMAIL, "school_id": "sch_owned", "tag_ids": [], "is_deleted": False,
        })
        await db.contacts.insert_one({
            "contact_id": "c_other_school", "name": "c_other_school", "phone": "9000000000",
            "assigned_to": OTHER_REP_EMAIL, "school_id": "sch_other", "tag_ids": [], "is_deleted": False,
        })

        out = await crm.bulk_assign_contacts(FakeRequest({
            "contact_ids": ["c_owned_school", "c_other_school"], "assigned_to": "newowner@smartshape.in",
        }))
        assert out == {"requested": 2, "updated": 1, "skipped": 1}
        assert (await db.contacts.find_one({"contact_id": "c_owned_school"}))["assigned_to"] == "newowner@smartshape.in"
        assert (await db.contacts.find_one({"contact_id": "c_other_school"}))["assigned_to"] == OTHER_REP_EMAIL
    _run(go())
