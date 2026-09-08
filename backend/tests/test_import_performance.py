"""POST /import/execute — batched import contract (CRM Performance Redesign, task 6).

The old importer issued two to four database round trips PER ROW: a duplicate
check, then a find + insert per tag, then the entity insert. A 500-school file
therefore cost thousands of round trips and took 2-3 minutes. The replacement
resolves duplicates and tags for the whole file up front and writes once.

What is pinned here:
  * wall-clock: 500 schools in well under 30s (real MongoDB, skipped if absent),
  * shape: a constant number of round trips regardless of row count,
  * tags: one tag document per NAME, shared by every row that mentions it
    (a per-row mint would leave 500 tags called "Care" and break tag filtering),
  * everything the old importer guaranteed and a naive batch rewrite drops:
    duplicate suppression, the contacts entity type, the import_logs row.

SAFETY: the correctness tests run on mongomock — no server, no Redis. The one
timing test needs a real mongod on localhost and refuses any DB name that is not
a test database. Nothing here can touch live data.

Run:  cd backend && python -m pytest tests/test_import_performance.py -v
"""
import asyncio
import os
import time

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

import routes.admin_routes as admin

UPLOADER = {"email": "info@smartshape.in", "name": "Owner", "role": "admin"}

_DB_NAME = os.environ["DB_NAME"]
assert _DB_NAME.endswith("_test") or _DB_NAME == "mtt_ci", (
    f"refusing to run against non-test database {_DB_NAME!r}"
)


class FakeRequest:
    """The route only needs a caller and a JSON body."""

    def __init__(self, body):
        self._body = body

    async def json(self):
        return self._body


def _run(coro):
    return asyncio.run(coro)


def _as_uploader(monkeypatch, user=UPLOADER):
    async def _me(_request):
        return user
    monkeypatch.setattr(admin, "get_current_user", _me)


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(admin, "db", d)
    return d


@pytest.fixture()
def cache(monkeypatch):
    """In-memory stand-in for Redis, and a record of what was invalidated.

    Also keeps the suite off a real Redis: cache.py's client is synchronous, so
    an unreachable server would block the event loop for its connect timeout on
    every progress write.
    """
    store = {"values": {}, "invalidated": []}

    async def _set(key, value, ttl=600):
        store["values"][key] = value
        return True

    async def _invalidate(pattern):
        store["invalidated"].append(pattern)
        return 0

    monkeypatch.setattr(admin, "set_cached", _set)
    monkeypatch.setattr(admin, "invalidate", _invalidate)
    return store


def _school_rows(n, tags="Care, EU Chandigarh 2026", start=0):
    return [
        {
            "row_num": i + 1,
            "status": "ok",
            "data": {
                "school_name": f"School {i}",
                "email": f"school{i}@example.com",
                "tags": tags,
            },
        }
        for i in range(start, start + n)
    ]


def _execute(rows, entity_type="schools"):
    return admin.execute_import(FakeRequest({"rows": rows, "entity_type": entity_type}))


# ---------------------------------------------------------------------------
# Performance
# ---------------------------------------------------------------------------

def _local_mongo_or_skip():
    """A real mongod on localhost, or skip. Never a remote/live URL."""
    try:
        from motor.motor_asyncio import AsyncIOMotorClient  # noqa: F401
        from pymongo import MongoClient
    except Exception as e:                                   # pragma: no cover
        pytest.skip(f"motor/pymongo unavailable: {e}")
    url = "mongodb://localhost:27017"
    try:
        MongoClient(url, serverSelectionTimeoutMS=1500).server_info()
    except Exception as e:
        pytest.skip(f"no local mongod for the timing test: {e}")
    return url


@pytest.mark.usefixtures("cache")
def test_batch_import_500_schools_under_30s(monkeypatch, capsys):
    """500 schools, each carrying two tags, must import in well under 30s."""
    url = _local_mongo_or_skip()
    _as_uploader(monkeypatch)
    rows = _school_rows(500)

    async def _go():
        from motor.motor_asyncio import AsyncIOMotorClient
        client = AsyncIOMotorClient(url)
        d = client[_DB_NAME]
        # Isolated marker so teardown never reaches beyond this test's writes.
        await d.schools.delete_many({"email": {"$regex": r"^school\d+@example\.com$"}})
        await d.tags.delete_many({"name": {"$in": ["Care", "EU Chandigarh 2026"]}})
        monkeypatch.setattr(admin, "db", d)
        try:
            start = time.perf_counter()
            out = await _execute(rows)
            elapsed = time.perf_counter() - start
            return out, elapsed
        finally:
            await d.schools.delete_many({"email": {"$regex": r"^school\d+@example\.com$"}})
            await d.tags.delete_many({"name": {"$in": ["Care", "EU Chandigarh 2026"]}})
            await d.import_logs.delete_many({"uploaded_by": UPLOADER["email"]})
            client.close()

    data, elapsed = _run(_go())

    assert data["created"] == 500
    assert data["failed"] == 0
    assert data["errors"] == []
    assert data["import_id"].startswith("imp_")
    assert elapsed < 30, f"import took {elapsed:.2f}s, expected <30s"
    with capsys.disabled():
        print(f"\n  500 schools + 2 tags each -> {elapsed:.2f}s")


@pytest.mark.usefixtures("cache")
def test_round_trips_do_not_grow_with_row_count(db, monkeypatch):
    """The real guarantee, independent of how fast the machine is: importing 5
    rows and importing 200 rows cost the SAME number of database calls."""
    _as_uploader(monkeypatch)

    def _count_calls(rows):
        calls = []

        class CountingCollection:
            def __init__(self, inner, name):
                self._inner, self._name = inner, name

            def __getattr__(self, attr):
                target = getattr(self._inner, attr)
                if not callable(target):
                    return target

                def wrapper(*a, **k):
                    calls.append(f"{self._name}.{attr}")
                    return target(*a, **k)
                return wrapper

        class CountingDb:
            def __init__(self, inner):
                self._inner = inner

            def __getattr__(self, name):
                return CountingCollection(getattr(self._inner, name), name)

        fresh = AsyncMongoMockClient()["smartshape_test"]
        monkeypatch.setattr(admin, "db", CountingDb(fresh))
        _run(_execute(rows))
        return calls

    small = _count_calls(_school_rows(5))
    large = _count_calls(_school_rows(200))

    assert small == large, (
        f"round trips grew with row count:\n  5 rows: {small}\n200 rows: {large}"
    )
    # And they are batch calls, not per-row ones.
    assert "schools.insert_many" in large
    assert "schools.insert_one" not in large
    assert "tags.insert_one" not in large
    assert "tags.find_one" not in large
    assert len(large) <= 8, f"expected a handful of round trips, got {large}"


# ---------------------------------------------------------------------------
# Tags
# ---------------------------------------------------------------------------

@pytest.mark.usefixtures("cache")
def test_batch_import_creates_tags_and_links(db, monkeypatch):
    """Import creates the tags named in the sheet and links them to the school."""
    _as_uploader(monkeypatch)
    rows = [{
        "row_num": 1,
        "status": "ok",
        "data": {"school_name": "Test School", "email": "test@example.com",
                 "tags": "Care, GSLC 2026"},
    }]

    data = _run(_execute(rows))
    assert data["created"] == 1

    tags = _run(db.tags.find({"name": {"$in": ["Care", "GSLC 2026"]}}).to_list(None))
    assert len(tags) == 2

    school = _run(db.schools.find_one({"school_name": "Test School"}))
    assert school is not None
    assert len(school.get("tag_ids", [])) == 2
    assert set(school["tag_ids"]) == {t["tag_id"] for t in tags}


@pytest.mark.usefixtures("cache")
def test_one_tag_document_per_name_not_per_row(db, monkeypatch):
    """100 rows naming the same two tags must yield TWO tag documents.

    Minting a tag per row is the trap in a naive batch rewrite: it looks fine on
    a one-row test and silently produces 200 tags called "Care" in production,
    each linked to a different school, which breaks every tag filter.
    """
    _as_uploader(monkeypatch)

    data = _run(_execute(_school_rows(100, tags="Care, GSLC 2026")))
    assert data["created"] == 100

    assert _run(db.tags.count_documents({"name": "Care"})) == 1
    assert _run(db.tags.count_documents({"name": "GSLC 2026"})) == 1

    care = _run(db.tags.find_one({"name": "Care"}))["tag_id"]
    schools = _run(db.schools.find({}, {"_id": 0}).to_list(None))
    assert len(schools) == 100
    assert all(care in s["tag_ids"] for s in schools)
    assert all(len(s["tag_ids"]) == 2 for s in schools)


@pytest.mark.usefixtures("cache")
def test_existing_tag_is_reused_not_duplicated(db, monkeypatch):
    """A tag the CRM already owns keeps its id, colour and grouping."""
    _as_uploader(monkeypatch)
    _run(db.tags.insert_one({"tag_id": "tag_existing", "name": "Care", "color": "#ff0000"}))

    _run(_execute(_school_rows(3, tags="Care")))

    assert _run(db.tags.count_documents({"name": "Care"})) == 1
    schools = _run(db.schools.find({}, {"_id": 0}).to_list(None))
    assert all(s["tag_ids"] == ["tag_existing"] for s in schools)


@pytest.mark.usefixtures("cache")
def test_multi_word_tag_is_not_split_on_spaces(db, monkeypatch):
    """"EU Chandigarh 2026" is ONE tag. The old importer split on whitespace as
    well as commas and turned it into three: EU, Chandigarh, 2026."""
    _as_uploader(monkeypatch)

    _run(_execute(_school_rows(1, tags="Care, EU Chandigarh 2026")))

    names = sorted(t["name"] for t in _run(db.tags.find({}, {"_id": 0}).to_list(None)))
    assert names == ["Care", "EU Chandigarh 2026"]


@pytest.mark.usefixtures("cache")
def test_blank_and_repeated_tag_cells_are_tolerated(db, monkeypatch):
    """Empty cells, trailing commas and a name repeated inside one cell."""
    _as_uploader(monkeypatch)
    rows = [
        {"row_num": 1, "status": "ok",
         "data": {"school_name": "A", "email": "a@x.com", "tags": ""}},
        {"row_num": 2, "status": "ok",
         "data": {"school_name": "B", "email": "b@x.com", "tags": "Care, , Care,"}},
        {"row_num": 3, "status": "ok",
         "data": {"school_name": "C", "email": "c@x.com"}},
    ]

    data = _run(_execute(rows))
    assert data["created"] == 3
    assert _run(db.tags.count_documents({})) == 1
    b = _run(db.schools.find_one({"school_name": "B"}))
    assert len(b["tag_ids"]) == 1
    assert _run(db.schools.find_one({"school_name": "C"}))["tag_ids"] == []


# ---------------------------------------------------------------------------
# Duplicate suppression — the batch rewrite must not reintroduce duplicates
# ---------------------------------------------------------------------------

@pytest.mark.usefixtures("cache")
def test_existing_school_email_is_not_reimported(db, monkeypatch):
    _as_uploader(monkeypatch)
    _run(db.schools.insert_one({"school_id": "sch_old", "school_name": "Old",
                                "email": "school1@example.com"}))

    data = _run(_execute(_school_rows(3)))

    assert data["created"] == 2
    assert data["failed"] == 1
    assert _run(db.schools.count_documents({"email": "school1@example.com"})) == 1
    assert any("already exists" in e["error"] for e in data["errors"])


@pytest.mark.usefixtures("cache")
def test_duplicate_rows_inside_one_file_insert_once(db, monkeypatch):
    _as_uploader(monkeypatch)
    row = {"row_num": 1, "status": "ok",
           "data": {"school_name": "Twin", "email": "twin@example.com"}}
    data = _run(_execute([row, {**row, "row_num": 2}]))

    assert data["created"] == 1
    assert data["failed"] == 1
    assert _run(db.schools.count_documents({"email": "twin@example.com"})) == 1


@pytest.mark.usefixtures("cache")
def test_rows_rejected_at_preview_are_counted_failed(db, monkeypatch):
    _as_uploader(monkeypatch)
    rows = _school_rows(2) + [
        {"row_num": 3, "status": "error", "error": "Missing school_name or email",
         "data": {"school_name": "", "email": ""}},
    ]

    data = _run(_execute(rows))

    assert data["created"] == 2
    assert data["failed"] == 1
    assert data["errors"] == [{"row": 3, "error": "Missing school_name or email"}]


# ---------------------------------------------------------------------------
# Fields the CRM depends on
# ---------------------------------------------------------------------------

@pytest.mark.usefixtures("cache")
def test_owner_defaults_to_the_uploader(db, monkeypatch):
    """A blank Owner column must never produce unowned data."""
    _as_uploader(monkeypatch)
    rows = [
        {"row_num": 1, "status": "ok",
         "data": {"school_name": "Mine", "email": "m@x.com"}},
        {"row_num": 2, "status": "ok",
         "data": {"school_name": "Hers", "email": "h@x.com", "owner": "parul@smartshape.in"}},
    ]

    _run(_execute(rows))

    assert _run(db.schools.find_one({"school_name": "Mine"}))["owner"] == UPLOADER["email"]
    assert _run(db.schools.find_one({"school_name": "Hers"}))["owner"] == "parul@smartshape.in"


@pytest.mark.usefixtures("cache")
def test_school_strength_survives_and_bad_values_fail_their_own_row(db, monkeypatch):
    _as_uploader(monkeypatch)
    rows = [
        {"row_num": 1, "status": "ok",
         "data": {"school_name": "Good", "email": "g@x.com", "school_strength": "1500"}},
        {"row_num": 2, "status": "ok",
         "data": {"school_name": "Bad", "email": "b@x.com", "school_strength": "1,500"}},
        {"row_num": 3, "status": "ok",
         "data": {"school_name": "Blank", "email": "k@x.com", "school_strength": ""}},
    ]

    data = _run(_execute(rows))

    assert data["created"] == 2 and data["failed"] == 1
    assert _run(db.schools.find_one({"school_name": "Good"}))["school_strength"] == 1500
    assert _run(db.schools.find_one({"school_name": "Blank"}))["school_strength"] == 0
    assert _run(db.schools.find_one({"school_name": "Bad"})) is None


@pytest.mark.usefixtures("cache")
def test_contacts_import_still_works(db, monkeypatch):
    """`contacts` is this endpoint's DEFAULT entity type — a schools-only rewrite
    would turn every contact import into a silent no-op."""
    _as_uploader(monkeypatch)
    rows = [
        {"row_num": 1, "status": "ok",
         "data": {"name": "Anita", "phone": "900001", "email": "a@x.com", "tags": "Care"}},
        {"row_num": 2, "status": "ok",
         "data": {"name": "Bimal", "phone": "900002"}},
    ]

    data = _run(_execute(rows, entity_type="contacts"))

    assert data["created"] == 2
    anita = _run(db.contacts.find_one({"name": "Anita"}))
    assert anita["status"] == "active" and anita["converted_to_lead"] is False
    assert len(anita["tag_ids"]) == 1
    assert _run(db.tags.count_documents({"name": "Care"})) == 1


@pytest.mark.usefixtures("cache")
def test_contact_duplicate_is_matched_on_phone_and_name(db, monkeypatch):
    """Same phone, different person = a new contact, as before."""
    _as_uploader(monkeypatch)
    _run(db.contacts.insert_one({"contact_id": "con_old", "name": "Anita", "phone": "900001"}))
    rows = [
        {"row_num": 1, "status": "ok", "data": {"name": "Anita", "phone": "900001"}},
        {"row_num": 2, "status": "ok", "data": {"name": "Anita's Deputy", "phone": "900001"}},
    ]

    data = _run(_execute(rows, entity_type="contacts"))

    assert data["created"] == 1 and data["failed"] == 1
    assert _run(db.contacts.count_documents({"phone": "900001"})) == 2


@pytest.mark.usefixtures("cache")
def test_unsupported_entity_type_reports_failure_not_silent_success(db, monkeypatch):
    _as_uploader(monkeypatch)
    data = _run(_execute(_school_rows(2), entity_type="inventory"))

    assert data["created"] == 0
    assert data["failed"] == 2
    assert all("Unsupported entity_type" in e["error"] for e in data["errors"])


# ---------------------------------------------------------------------------
# Progress, cache invalidation, audit trail
# ---------------------------------------------------------------------------

def test_progress_and_result_are_published_to_redis(db, cache, monkeypatch):
    _as_uploader(monkeypatch)
    data = _run(_execute(_school_rows(250)))

    import_id = data["import_id"]
    progress = cache["values"][f"import:{import_id}:progress"]
    assert progress["total"] == 250
    assert progress["processed"] == 250
    assert progress["created"] == 250
    assert cache["values"][f"import:{import_id}:result"] == data


def test_caches_the_crm_list_reads_are_invalidated(db, cache, monkeypatch):
    """crm_routes caches `schools:batch:{...}`, `tags:by_id` and `crm:facets:{...}`.
    Miss any of them and a freshly imported school is invisible for the TTL."""
    _as_uploader(monkeypatch)
    _run(_execute(_school_rows(1)))

    assert cache["invalidated"] == ["crm:facets:*", "schools:batch:*", "tags:*"]


def test_a_dead_redis_does_not_fail_the_import(db, monkeypatch):
    """cache.py returns False rather than raising when Redis is down; the import
    must still land, and must stop re-attempting the blocking call."""
    _as_uploader(monkeypatch)
    attempts = []

    async def _dead_set(key, value, ttl=600):
        attempts.append(key)
        return False

    async def _dead_invalidate(pattern):
        return 0

    monkeypatch.setattr(admin, "set_cached", _dead_set)
    monkeypatch.setattr(admin, "invalidate", _dead_invalidate)

    data = _run(_execute(_school_rows(300)))

    assert data["created"] == 300
    assert len(attempts) == 1, f"kept calling a dead Redis: {attempts}"


def test_import_log_is_written_for_the_logs_screen(db, monkeypatch, cache):
    """GET /import/logs renders db.import_logs — dropping the write would blank
    the Import Center's history."""
    _as_uploader(monkeypatch)
    data = _run(_execute(_school_rows(4)))

    log = _run(db.import_logs.find_one({"log_id": data["log_id"]}))
    assert log is not None
    assert log["entity_type"] == "schools"
    assert log["total_rows"] == 4
    assert log["success_count"] == 4
    assert log["failed_count"] == 0
    assert log["uploaded_by"] == UPLOADER["email"]
    # One identifier, two names — old callers read log_id, the new contract
    # reads import_id.
    assert data["log_id"] == data["import_id"]
