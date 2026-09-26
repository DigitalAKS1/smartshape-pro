import os, pytest, pytest_asyncio
from motor.motor_asyncio import AsyncIOMotorClient
import import_engine as ie


@pytest_asyncio.fixture
async def db():
    name = os.getenv("DB_NAME", "smartshape_test")
    assert name.endswith("_test") or name == "mtt_ci", f"refusing non-test DB: {name}"
    client = AsyncIOMotorClient(os.getenv("MONGO_URL", "mongodb://localhost:27017"))
    yield client[name]


@pytest.mark.asyncio
async def test_resolve_create_when_no_match(db):
    await db.schools.delete_many({})
    r = await ie.resolve_school(db, {"school_name": "Brand New", "city": "Pune"})
    assert r["action"] == "create"


@pytest.mark.asyncio
async def test_resolve_update_by_id(db):
    await db.schools.delete_many({})
    await db.schools.insert_one({"school_id": "sch_known1", "school_name": "X", "is_deleted": False})
    r = await ie.resolve_school(db, {"school_id": "sch_known1", "school_name": "X"})
    assert r["action"] == "update" and r["school_id"] == "sch_known1"


@pytest.mark.asyncio
async def test_resolve_id_miss_falls_through_to_name(db):
    # school_id supplied but no such record -> must fall through to name match (update), not create
    await db.schools.delete_many({})
    await db.schools.insert_one({"school_id": "sch_real", "school_name": "Falcon", "city": "Pune", "is_deleted": False})
    r = await ie.resolve_school(db, {"school_id": "sch_ghost", "school_name": "Falcon", "city": "Pune"})
    assert r["action"] == "update" and r["school_id"] == "sch_real"


@pytest.mark.asyncio
async def test_resolve_needs_review_on_two(db):
    await db.schools.delete_many({})
    await db.schools.insert_many([
        {"school_id": "sch_a", "school_name": "Dups", "city": "Goa", "is_deleted": False},
        {"school_id": "sch_b", "school_name": "Dups", "city": "Goa", "is_deleted": False},
    ])
    r = await ie.resolve_school(db, {"school_name": "Dups", "city": "Goa"})
    assert r["action"] == "needs_review" and r["candidates"] == 2


@pytest.mark.asyncio
async def test_commit_creates_then_updates_no_dup(db):
    await db.schools.delete_many({}); await db.contacts.delete_many({}); await db.audit_backup.delete_many({})
    row = {"school_name":"Sunrise","city":"Pune","name":"Mr A","phone":"99990001","annual_fees":"5L","transport_fee":"1200"}
    r1 = await ie.commit_row(db, row, {"email":"u@t"}, create_leads=False)
    assert r1["action"]=="create" and r1["school_id"]
    # re-run same row -> update, no new school
    r2 = await ie.commit_row(db, {**row,"school_id":r1["school_id"],"annual_fees":"6L"}, {"email":"u@t"}, create_leads=False)
    assert r2["action"]=="update" and r2["school_id"]==r1["school_id"]
    assert await db.schools.count_documents({"is_deleted":{"$ne":True}})==1
    s = await db.schools.find_one({"school_id":r1["school_id"]})
    assert s["annual_budget_range"]=="6L" and s["custom_fields"]["transport_fee"]=="1200"
    assert await db.audit_backup.count_documents({}) >= 1   # snapshot before update


# ---------------------------------------------------------------------------
# M-3: lock safety invariants
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_commit_needs_review_writes_nothing(db):
    """needs_review -> nothing written (no school, contact, lead)."""
    await db.schools.delete_many({})
    await db.contacts.delete_many({})
    await db.leads.delete_many({})
    # Two schools with same name+city -> needs_review
    await db.schools.insert_many([
        {"school_id": "sch_nr1", "school_name": "DupSchool", "city": "Agra", "is_deleted": False},
        {"school_id": "sch_nr2", "school_name": "DupSchool", "city": "Agra", "is_deleted": False},
    ])
    before_schools = await db.schools.count_documents({})
    row = {"school_name": "DupSchool", "city": "Agra", "name": "Test Contact", "phone": "9999000111"}
    result = await ie.commit_row(db, row, {"email": "u@t"}, create_leads=True)
    assert result["action"] == "needs_review"
    assert result["school_id"] is None
    assert result["contact_id"] is None
    assert result["lead_id"] is None
    # No new documents written
    assert await db.schools.count_documents({}) == before_schools
    assert await db.contacts.count_documents({}) == 0
    assert await db.leads.count_documents({}) == 0


@pytest.mark.asyncio
async def test_commit_snapshot_holds_prewrite_value(db):
    """Audit snapshot captured BEFORE the write holds the old value."""
    await db.schools.delete_many({})
    await db.contacts.delete_many({})
    await db.audit_backup.delete_many({})
    # First commit: create with annual_fees "5L"
    row1 = {"school_name": "SnapSchool", "city": "Delhi", "annual_fees": "5L"}
    r1 = await ie.commit_row(db, row1, {"email": "u@t"}, create_leads=False)
    assert r1["action"] == "create"
    sid = r1["school_id"]
    # Second commit: update annual_fees to "9L" using the returned school_id
    row2 = {"school_id": sid, "school_name": "SnapSchool", "city": "Delhi", "annual_fees": "9L"}
    await ie.commit_row(db, row2, {"email": "u@t"}, create_leads=False)
    # The snapshot must hold the PRE-write value "5L", not "9L"
    snap = await db.audit_backup.find_one({"kind": "school_pre_import", "school_id": sid})
    assert snap is not None, "snapshot should exist after update"
    assert snap["snapshot"].get("annual_budget_range") == "5L", (
        f"snapshot should hold pre-write value '5L', got {snap['snapshot'].get('annual_budget_range')!r}"
    )


@pytest.mark.asyncio
async def test_commit_custom_not_clobbered(db):
    """Custom fields accumulate: updating with field B must not erase field A."""
    await db.schools.delete_many({})
    await db.contacts.delete_many({})
    await db.audit_backup.delete_many({})
    # First commit: create with custom field transport_fee
    row1 = {"school_name": "CustomSchool", "city": "Mumbai", "transport_fee": "1200"}
    r1 = await ie.commit_row(db, row1, {"email": "u@t"}, create_leads=False)
    sid = r1["school_id"]
    # Second commit: update with a different custom field (lab_fee), no transport_fee
    row2 = {"school_id": sid, "school_name": "CustomSchool", "city": "Mumbai", "lab_fee": "500"}
    await ie.commit_row(db, row2, {"email": "u@t"}, create_leads=False)
    school = await db.schools.find_one({"school_id": sid})
    cf = school.get("custom_fields", {})
    assert cf.get("transport_fee") == "1200", f"transport_fee should survive, got custom_fields={cf}"
    assert cf.get("lab_fee") == "500", f"lab_fee should be set, got custom_fields={cf}"


@pytest.mark.asyncio
async def test_commit_blank_phone_idempotent(db):
    """I-2: name-only contact must not duplicate on re-commit (dedup by school+name)."""
    await db.schools.delete_many({})
    await db.contacts.delete_many({})
    await db.audit_backup.delete_many({})
    row1 = {"school_name": "PhonelessSchool", "city": "Chennai", "name": "Alice"}
    r1 = await ie.commit_row(db, row1, {"email": "u@t"}, create_leads=False)
    assert r1["contact_id"] is not None
    sid = r1["school_id"]
    # Second commit: same school_id + same name, no phone
    row2 = {"school_id": sid, "school_name": "PhonelessSchool", "city": "Chennai", "name": "Alice"}
    r2 = await ie.commit_row(db, row2, {"email": "u@t"}, create_leads=False)
    assert r2["contact_id"] == r1["contact_id"], "same contact must be reused"
    count = await db.contacts.count_documents({"school_id": sid})
    assert count == 1, f"expected 1 contact, found {count}"
