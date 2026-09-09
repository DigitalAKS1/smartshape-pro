import asyncio
import os, pytest, pytest_asyncio
from motor.motor_asyncio import AsyncIOMotorClient
import field_registry as fr


@pytest_asyncio.fixture
async def db():
    name = os.getenv("DB_NAME", "smartshape_test")
    assert name.endswith("_test") or name == "mtt_ci", f"refusing non-test DB: {name}"
    client = AsyncIOMotorClient(os.getenv("MONGO_URL", "mongodb://localhost:27017"))
    d = client[name]
    yield d
    # Teardown: wipe test data; runs inside the same pytest-asyncio event loop.
    await d.field_definitions.delete_many({})
    await d.app_meta.delete_many({"_id": "field_definitions_seeded"})


def test_normalize_header():
    assert fr.normalize_header("  School's Mail ") == "schools mail"
    assert fr.normalize_header("Phone Number") == "phone number"


@pytest.mark.asyncio
async def test_seed_is_idempotent(db):
    await fr.seed_field_definitions(db)
    n1 = await db.field_definitions.count_documents({})
    await fr.seed_field_definitions(db)
    n2 = await db.field_definitions.count_documents({})
    assert n1 == n2 and n1 >= 28


@pytest.mark.asyncio
async def test_seed_marks_core(db):
    await fr.seed_field_definitions(db)
    f = await db.field_definitions.find_one({"key": "school_name"})
    assert f["is_core"] is True and f["entity"] == "school"


@pytest.mark.asyncio
async def test_create_and_softdelete_custom(db):
    await fr.seed_field_definitions(db)
    f = await fr.create_field(db, {"label": "Transport Fee", "entity": "school", "type": "number"}, {"email": "a@b.c"})
    assert f["key"] == "transport_fee" and f["is_core"] is False
    await fr.soft_delete_field(db, f["field_id"])
    doc = await db.field_definitions.find_one({"field_id": f["field_id"]})
    assert doc["is_active"] is False


@pytest.mark.asyncio
async def test_cannot_delete_core(db):
    await fr.seed_field_definitions(db)
    core = await db.field_definitions.find_one({"key": "school_name"})
    with pytest.raises(ValueError):
        await fr.soft_delete_field(db, core["field_id"])


def test_merge_fields_flattens_custom():
    doc = {"school_name": "X", "custom_fields": {"transport_fee": 1200}}
    out = fr.merge_fields(doc)
    assert out["school_name"] == "X" and out["transport_fee"] == 1200


# ---------------------------------------------------------------------------
# Core-field alias/label reconciliation (2026-09-10 fix).
#
# propose_mapping reads `aliases` from the STORED field_definitions document,
# never from SEED_FIELDS directly, so a document seeded before a SEED_FIELDS
# edit never picks the edit up on its own. These use mongomock_motor
# (never a real database) rather than the `db` fixture above.
# ---------------------------------------------------------------------------

def test_seed_reconciles_stale_core_aliases():
    """A core field's stored aliases lagging behind SEED_FIELDS is reconciled
    on the next seed run — this is the exact bug that let the missing 'phone'
    alias silently never reach a database seeded before the fix shipped."""
    async def go():
        from mongomock_motor import AsyncMongoMockClient
        db = AsyncMongoMockClient()["smartshape_test"]
        await db.field_definitions.insert_one({
            "field_id": "fld_phone_stale", "key": "phone", "label": "Phone Number",
            "entity": "contact", "type": "phone", "options": [], "required": False,
            "is_unique": False, "is_core": True, "maps_to": "phone",
            "aliases": ["phone number", "mobile", "contact phone"],  # pre-fix, no bare "phone"
            "group": "Contact", "order": 20, "is_active": True,
            "created_by": "system", "created_at": "2020-01-01T00:00:00+00:00",
        })
        await fr.seed_field_definitions(db)
        doc = await db.field_definitions.find_one({"key": "phone"})
        assert "phone" in doc["aliases"], (
            "a stale core-field alias list must be reconciled to SEED_FIELDS "
            "on the next seed run, or a code fix never reaches an existing deployment"
        )
        # Reconciliation must not have inserted a second "phone" document.
        assert await db.field_definitions.count_documents({"key": "phone"}) == 1
    asyncio.run(go())


def test_seed_leaves_custom_field_aliases_alone():
    """A user-created (non-core) field's aliases are never touched by the seed,
    even if they happen to collide with a key seed_field_definitions manages."""
    async def go():
        from mongomock_motor import AsyncMongoMockClient
        db = AsyncMongoMockClient()["smartshape_test"]
        await fr.seed_field_definitions(db)
        custom = await fr.create_field(
            db, {"label": "Transport Fee", "entity": "school", "type": "number"},
            {"email": "a@b.c"})
        await db.field_definitions.update_one(
            {"field_id": custom["field_id"]},
            {"$set": {"aliases": ["a deliberately edited custom alias"]}})
        await fr.seed_field_definitions(db)
        doc = await db.field_definitions.find_one({"field_id": custom["field_id"]})
        assert doc["aliases"] == ["a deliberately edited custom alias"], (
            "seed_field_definitions must never touch a non-core field's aliases"
        )
    asyncio.run(go())


def test_seed_second_run_writes_nothing_when_nothing_stale():
    """Once every core field already matches SEED_FIELDS, a further seed run
    issues no update_one calls at all — proving the reconciliation really is
    write-only-on-diff, not an unconditional overwrite."""
    async def go():
        from mongomock_motor import AsyncMongoMockClient
        db = AsyncMongoMockClient()["smartshape_test"]
        await fr.seed_field_definitions(db)  # first run: inserts everything fresh

        calls = []
        orig_update_one = db.field_definitions.update_one

        async def spy_update_one(*args, **kwargs):
            calls.append((args, kwargs))
            return await orig_update_one(*args, **kwargs)

        db.field_definitions.update_one = spy_update_one
        await fr.seed_field_definitions(db)  # second run: nothing should be stale
        assert calls == [], (
            "a second seed run with nothing to reconcile must not write anything"
        )
    asyncio.run(go())
