"""Duplicate drip sequences (Sub-project A1/A3).

The owner ended up with 2-3 copies of the same sequence: pressing Enter in the
name box fires save() again while the first POST is still in flight, and
POST /drip/sequences used to insert unconditionally. The fix is belt-and-braces
(D7), so each strand is asserted on its own:

  * two rapid creates from the same person      -> one document (idempotent)
  * a deliberate re-create of the same name     -> 409
  * a different name                            -> a second document
  * the seeder                                  -> never twins a hand-made name
  * the name_lower index                        -> guarded, never crashes startup

mongomock; no network, no provider.
"""
import asyncio
import inspect
import os
from datetime import datetime, timedelta, timezone

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from fastapi import HTTPException
from mongomock_motor import AsyncMongoMockClient

import database
import routes.drip_routes as drip
import rbac

ADMIN = {"email": "info@smartshape.in", "name": "Owner", "role": "admin"}
OTHER = {"email": "bde@smartshape.in", "name": "BDE", "role": "admin"}


class FakeRequest:
    def __init__(self, body=None, params=None):
        self._body = body or {}
        self.query_params = params or {}

    async def json(self):
        return self._body


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(drip, "db", d, raising=False)
    monkeypatch.setattr(rbac, "MODULE_RBAC_MODE", "enforce")

    # Who "I" am for this call; a test flips it to check the idempotency window
    # is per creator. monkeypatch removes the attribute again at teardown.
    monkeypatch.setattr(drip, "_test_user", ADMIN, raising=False)

    async def _me(_request):
        return drip._test_user
    monkeypatch.setattr(drip, "get_current_user", _me)
    return d


def _run(coro):
    return asyncio.run(coro)


PAYLOAD = {
    "name": "Principal Pitch",
    "description": "Catalogue drop",
    "trigger": "manual",
    "steps": [
        {"delay_days": 0, "message_type": "physical_material",
         "material_type": "catalogue", "material_name": "2026 Die Catalogue"},
        {"delay_days": 3, "message_type": "whatsapp", "message_template": "Hi {name}"},
    ],
}


# ── The double-submit itself ────────────────────────────────────────────────

def test_two_rapid_creates_make_one_sequence(db):
    async def go():
        first = await drip.create_sequence(FakeRequest(dict(PAYLOAD)))
        second = await drip.create_sequence(FakeRequest(dict(PAYLOAD)))

        assert await db.drip_sequences.count_documents({}) == 1, \
            "the second in-flight submit created a duplicate sequence"
        assert second["sequence_id"] == first["sequence_id"], \
            "the double-submit did not get the first sequence back"
    _run(go())


def test_the_idempotent_return_carries_the_steps(db):
    # The UI puts the returned document straight into the list, so an empty or
    # half-made echo would blank the new card.
    async def go():
        await drip.create_sequence(FakeRequest(dict(PAYLOAD)))
        second = await drip.create_sequence(FakeRequest(dict(PAYLOAD)))
        assert len(second["steps"]) == 2
        assert second["steps"][0]["material_name"] == "2026 Die Catalogue"
        assert "enrollment_count" in second, "the echo skipped _enrich"
    _run(go())


# ── A deliberate second sequence under a taken name ─────────────────────────

def test_an_exact_name_match_is_a_409(db):
    async def go():
        await drip.create_sequence(FakeRequest(dict(PAYLOAD)))
        # Older than the 30s window: this is a new intent, not a double click.
        await db.drip_sequences.update_one(
            {"name": "Principal Pitch"},
            {"$set": {"created_at": (datetime.now(timezone.utc)
                                     - timedelta(minutes=5)).isoformat()}})

        with pytest.raises(HTTPException) as e:
            await drip.create_sequence(FakeRequest(dict(PAYLOAD)))
        assert e.value.status_code == 409
        assert "Principal Pitch" in e.value.detail
        assert await db.drip_sequences.count_documents({}) == 1
    _run(go())


def test_the_name_match_ignores_case_and_surrounding_space(db):
    async def go():
        first = await drip.create_sequence(FakeRequest(dict(PAYLOAD)))
        body = dict(PAYLOAD, name="   principal PITCH  ")

        # Inside the window it is the same intent, so it echoes the same document…
        echo = await drip.create_sequence(FakeRequest(body))
        assert echo["sequence_id"] == first["sequence_id"]

        # …and outside it, it is a name clash.
        await db.drip_sequences.update_one(
            {"sequence_id": first["sequence_id"]},
            {"$set": {"created_at": (datetime.now(timezone.utc)
                                     - timedelta(minutes=5)).isoformat()}})
        with pytest.raises(HTTPException) as e:
            await drip.create_sequence(FakeRequest(body))
        assert e.value.status_code == 409
        assert await db.drip_sequences.count_documents({}) == 1
    _run(go())


def test_a_legacy_sequence_without_name_lower_still_blocks_a_duplicate(db):
    # Every sequence in production predates `name_lower`; the guard cannot rely
    # on it alone or the very rows it exists to protect stay unprotected.
    async def go():
        await db.drip_sequences.insert_one({
            "sequence_id": "drip_legacy", "name": "Quiz Engage",
            "created_by": "bde@smartshape.in", "is_active": True, "steps": [],
            "created_at": "2026-09-18T09:02:00+00:00",
        })
        with pytest.raises(HTTPException) as e:
            await drip.create_sequence(FakeRequest(dict(PAYLOAD, name="quiz engage")))
        assert e.value.status_code == 409
    _run(go())


def test_another_person_cannot_borrow_the_idempotency_window(db):
    # The 30s echo is per creator; a second user typing the same name inside the
    # window must be told the name is taken, not handed someone else's sequence.
    async def go():
        await drip.create_sequence(FakeRequest(dict(PAYLOAD)))
        drip._test_user = OTHER
        try:
            with pytest.raises(HTTPException) as e:
                await drip.create_sequence(FakeRequest(dict(PAYLOAD)))
            assert e.value.status_code == 409
        finally:
            drip._test_user = ADMIN
    _run(go())


def test_the_same_name_with_a_different_step_count_is_a_409_not_an_echo(db):
    async def go():
        await drip.create_sequence(FakeRequest(dict(PAYLOAD)))
        body = dict(PAYLOAD, steps=PAYLOAD["steps"][:1])
        with pytest.raises(HTTPException) as e:
            await drip.create_sequence(FakeRequest(body))
        assert e.value.status_code == 409
    _run(go())


# ── The guard must not block real work ──────────────────────────────────────

def test_a_different_name_creates_a_second_sequence(db):
    async def go():
        first = await drip.create_sequence(FakeRequest(dict(PAYLOAD)))
        second = await drip.create_sequence(FakeRequest(dict(PAYLOAD, name="Teacher Pitch")))
        assert second["sequence_id"] != first["sequence_id"]
        assert await db.drip_sequences.count_documents({}) == 2
    _run(go())


def test_a_blank_name_is_still_a_400(db):
    async def go():
        with pytest.raises(HTTPException) as e:
            await drip.create_sequence(FakeRequest(dict(PAYLOAD, name="   ")))
        assert e.value.status_code == 400
    _run(go())


def test_create_and_rename_keep_name_lower_true(db):
    # The dedupe key has to follow a rename, or the freed/new name goes unguarded.
    async def go():
        created = await drip.create_sequence(FakeRequest(dict(PAYLOAD)))
        doc = await db.drip_sequences.find_one({"sequence_id": created["sequence_id"]})
        assert doc["name_lower"] == "principal pitch"

        await drip.update_sequence(created["sequence_id"],
                                   FakeRequest({"name": "  Principal Machine Pitch "}))
        doc = await db.drip_sequences.find_one({"sequence_id": created["sequence_id"]})
        assert doc["name"] == "Principal Machine Pitch"
        assert doc["name_lower"] == "principal machine pitch"

        # The name it was renamed away from is free again.
        again = await drip.create_sequence(FakeRequest(dict(PAYLOAD)))
        assert again["sequence_id"] != created["sequence_id"]
    _run(go())


def test_renaming_onto_another_sequences_name_is_a_409(db):
    # The create guard alone is not enough: an Edit → rename could otherwise
    # recreate the exact duplicate-in-the-list state it exists to prevent.
    async def go():
        first = await drip.create_sequence(FakeRequest(dict(PAYLOAD)))
        second = await drip.create_sequence(FakeRequest({**PAYLOAD, "name": "Pitch v2"}))
        with pytest.raises(HTTPException) as exc:
            await drip.update_sequence(second["sequence_id"],
                                       FakeRequest({"name": " principal PITCH "}))
        assert exc.value.status_code == 409
        # Untouched; and a no-op rename of itself is still fine.
        assert (await db.drip_sequences.find_one({"sequence_id": second["sequence_id"]}))["name"] == "Pitch v2"
        await drip.update_sequence(first["sequence_id"], FakeRequest({"name": "Principal Pitch"}))
    _run(go())


# ── The seeder (A3) ─────────────────────────────────────────────────────────

def test_the_seeder_does_not_twin_a_hand_made_sequence_of_the_same_name(db):
    # _seed_defaults runs on EVERY GET /drip/sequences. Its lookup used to be
    # keyed on created_by: "system", so an owner-made sequence named like a stock
    # one was invisible to it and a system twin appeared beside it on the next
    # page load — under the same name, in the same list.
    stock_name = drip._DEFAULT_SEQUENCES[0]["name"]

    async def go():
        mine = await drip.create_sequence(FakeRequest(dict(PAYLOAD, name=stock_name)))
        await drip._seed_defaults()
        await drip._seed_defaults()          # every page load, not just the first

        same_name = await db.drip_sequences.find(
            {"name": stock_name}, {"_id": 0}).to_list(10)
        assert len(same_name) == 1, "the seeder twinned the owner's sequence"
        assert same_name[0]["sequence_id"] == mine["sequence_id"]
        assert same_name[0]["created_by"] == ADMIN["email"], \
            "the seeder overwrote the owner's sequence with the stock one"
        assert same_name[0]["steps"][0]["material_name"] == "2026 Die Catalogue"
    _run(go())


def test_the_seeder_still_seeds_and_still_updates_its_own_copies(db):
    async def go():
        await drip._seed_defaults()
        assert await db.drip_sequences.count_documents({"created_by": "system"}) \
            == len(drip._DEFAULT_SEQUENCES), "the stock sequences were not seeded"

        # Running it again is a no-op, not a second set.
        await drip._seed_defaults()
        assert await db.drip_sequences.count_documents({}) == len(drip._DEFAULT_SEQUENCES)

        # A stock copy the owner has NOT customised is still refreshed in place.
        stock_name = drip._DEFAULT_SEQUENCES[0]["name"]
        await db.drip_sequences.update_one({"name": stock_name},
                                           {"$set": {"description": "drifted"}})
        await drip._seed_defaults()
        doc = await db.drip_sequences.find_one({"name": stock_name}, {"_id": 0})
        assert doc["description"] == drip._DEFAULT_SEQUENCES[0]["description"]
        assert doc.get("name_lower") == stock_name.lower(), \
            "a seeded sequence has no dedupe key, so a hand-made twin could slip past"
    _run(go())


def test_a_customised_stock_sequence_is_left_alone(db):
    async def go():
        await drip._seed_defaults()
        stock_name = drip._DEFAULT_SEQUENCES[0]["name"]
        await db.drip_sequences.update_one(
            {"name": stock_name},
            {"$set": {"customised": True, "description": "the owner's words"}})
        await drip._seed_defaults()
        doc = await db.drip_sequences.find_one({"name": stock_name}, {"_id": 0})
        assert doc["description"] == "the owner's words"
        assert await db.drip_sequences.count_documents({"name": stock_name}) == 1
    _run(go())


# ── The index ───────────────────────────────────────────────────────────────

def test_the_name_lower_index_is_registered_and_guarded():
    src = inspect.getsource(database.connect_db)
    assert 'db.drip_sequences.create_index("name_lower"' in src, \
        "no name_lower index on drip_sequences"
    line = next(ln for ln in src.splitlines() if 'drip_sequences.create_index' in ln)
    assert "_i(" in line, "the index is not wrapped in _i() — a failure would crash startup"
    assert "unique=True" not in line, \
        "a unique index over legacy duplicate names would fail at startup"


def test_index_creation_failure_does_not_raise():
    async def go():
        async def boom():
            raise Exception("IndexOptionsConflict: index already exists with different options")
        await database._i(boom())          # must swallow, not propagate

        d = AsyncMongoMockClient()["smartshape_test"]
        await database._i(d.drip_sequences.create_index("name_lower", background=True))
    _run(go())
