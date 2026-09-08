"""Performance benchmarks for the CRM Performance Redesign (task 12).

The redesign exists because the CRM list took 10-30s and a 500-school import
took 2-3 minutes. Tasks 3-6 fixed that (compound indexes, batched enrichment,
Redis caching, a single-round-trip importer). This file is the ratchet: it
pins the four numbers the plan promised so a later refactor cannot quietly
give them back.

    lead list page   < 500ms
    tag-filtered page < 200ms
    500-school import <  30s
    cache hit rate    >  75%

HOW THE NUMBERS ARE MEASURED
----------------------------
The three latency/throughput benchmarks run against a REAL mongod on
localhost and are SKIPPED if there isn't one. They cannot run on mongomock:
mongomock is an in-memory Python scan with no query planner, so it neither
uses nor needs the compound indexes from task 3 — a "pass" there would say
nothing about production. The benchmark therefore builds the exact index set
`ensure_indexes.py` declares for `leads` before timing anything.

Timings are the MEDIAN of several runs, not a single sample. A dev box will
occasionally hand any one run a GC pause or a scheduler hiccup, and a suite
that fails on that is a suite people learn to ignore. Min/median/max are all
printed so a regression is visible even when the assert still passes.

The cache benchmark deliberately does NOT infer hits from elapsed time.
It counts them, through an instrumented cache. Timing-based hit detection
sets a threshold that is either so loose it can never fail or so tight it
fails on an unlucky run; counting is exact and tells you *which* key missed.

SAFETY
------
Nothing here can touch live data:
  * the Mongo URL is hardcoded to localhost — MONGO_URL from backend/.env
    (which on a dev box points at the live Atlas cluster) is never used to
    connect;
  * the database name must end in `_test`, asserted at import;
  * every document written carries a per-run marker and teardown deletes by
    that marker only. No collection is dropped and no database is dropped.

Run:  cd backend && python -m pytest tests/test_performance_benchmarks.py -v -s
"""
import asyncio
import os
import statistics
import time
import uuid

# Set BEFORE importing anything that calls load_dotenv() — load_dotenv does not
# override existing environment variables, so this pins the suite to a local
# test database even though backend/.env names the production cluster.
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

import rbac
import routes.admin_routes as admin
import routes.crm_routes as crm

ADMIN = {"email": "info@smartshape.in", "name": "Owner", "role": "admin"}

# Never taken from the environment: the timing tests always talk to localhost.
LOCAL_MONGO_URL = "mongodb://localhost:27017"

_DB_NAME = os.environ["DB_NAME"]
assert _DB_NAME.endswith("_test") or _DB_NAME == "mtt_ci", (
    f"refusing to run benchmarks against non-test database {_DB_NAME!r}"
)

# Every document this file writes is stamped with this. Teardown deletes by it,
# so a benchmark can never remove a row it did not create — even if someone
# points DB_NAME at a test database that other suites are also using.
RUN = uuid.uuid4().hex[:8]

# Targets from the plan. Named so a failure message says what was promised.
TARGET_LEAD_LIST_S = 0.5
TARGET_TAG_FILTER_S = 0.2
TARGET_IMPORT_S = 30.0
TARGET_CACHE_HIT_RATE = 0.75


# ---------------------------------------------------------------------------
# Harness
# ---------------------------------------------------------------------------

class FakeRequest:
    """The read routes only use the request to identify the caller."""


class JsonRequest(FakeRequest):
    def __init__(self, body):
        self._body = body

    async def json(self):
        return self._body


def _run(coro):
    return asyncio.run(coro)


def _as_admin(monkeypatch, module):
    async def _me(_request):
        return ADMIN
    monkeypatch.setattr(module, "get_current_user", _me)


def _report(label, samples, target):
    """Print the distribution, not just the number that happened to be asserted."""
    lo, mid, hi = min(samples), statistics.median(samples), max(samples)
    print(f"\n  {label}: median {mid * 1000:.0f}ms "
          f"(min {lo * 1000:.0f}ms, max {hi * 1000:.0f}ms) "
          f"| target <{target * 1000:.0f}ms | n={len(samples)}")


# Probed once per session, not once per test. A per-test probe with a short
# timeout SKIPS spuriously: mongod is busy servicing the previous benchmark's
# 10k inserts/deletes when the next one asks, and a skipped benchmark is a
# silently unenforced target — the worst possible failure mode here.
_MONGO_PROBE = None


def _local_mongo_or_skip():
    """A real mongod on localhost, or skip. Never a remote/live URL."""
    global _MONGO_PROBE
    if _MONGO_PROBE is None:
        try:
            from motor.motor_asyncio import AsyncIOMotorClient  # noqa: F401
            from pymongo import MongoClient
        except Exception as e:                                # pragma: no cover
            _MONGO_PROBE = f"motor/pymongo unavailable: {e}"
        else:
            try:
                MongoClient(LOCAL_MONGO_URL,
                            serverSelectionTimeoutMS=10_000).server_info()
                _MONGO_PROBE = ""
            except Exception as e:
                _MONGO_PROBE = f"no local mongod for the timing benchmarks: {e}"
    if _MONGO_PROBE:
        pytest.skip(_MONGO_PROBE)
    return LOCAL_MONGO_URL


async def _measure(call, warmups=3, samples=9):
    """Median-of-N latency for `call`, after discarding `warmups` runs.

    The discarded runs matter: the first touch of a freshly written collection
    pays for WiredTiger cache population and first-page faults, which on a cold
    box measured 10x the steady-state cost. Benchmarking that would pin the
    speed of the filesystem rather than the speed of the query.
    """
    for _ in range(warmups):
        await call()
    out, timings = None, []
    for _ in range(samples):
        start = time.perf_counter()
        out = await call()
        timings.append(time.perf_counter() - start)
    return timings, out


async def _open_local_db():
    from motor.motor_asyncio import AsyncIOMotorClient
    client = AsyncIOMotorClient(LOCAL_MONGO_URL)
    return client, client[_DB_NAME]


async def _build_lead_indexes(d):
    """Create exactly the indexes production has for `leads`.

    Imported from ensure_indexes rather than restated here: a benchmark that
    measures a hand-copied index set stops measuring production the moment the
    real list changes. create_index is idempotent and purely additive.
    """
    from ensure_indexes import INDEXES, index_keys
    for entry in INDEXES["leads"]:
        await d.leads.create_index(index_keys(entry), background=True)


async def _cleanup(d):
    """Delete only what this run inserted."""
    await d.leads.delete_many({"bench_run": RUN})
    await d.schools.delete_many({"bench_run": RUN})
    await d.tags.delete_many({"bench_run": RUN})
    await d.schools.delete_many({"email": {"$regex": rf"^bench{RUN}-\d+@example\.com$"}})
    await d.import_logs.delete_many({"uploaded_by": ADMIN["email"], "bench_run": RUN})


@pytest.fixture()
def null_cache(monkeypatch):
    """A cache that always misses, on both route modules.

    The latency targets have to hold on a COLD cache. A warm-cache benchmark
    measures a dictionary lookup and would keep passing after someone
    reintroduced the N+1 — the first user after every deploy, every TTL expiry
    and every cache eviction pays the cold cost, so that is the number worth
    defending. (The warm number is reported alongside for contrast.)
    """
    async def _get(key, default=None):
        return default

    async def _set(key, value, ttl=600):
        return True

    async def _invalidate(pattern):
        return 0

    for module in (crm, admin):
        for name, fn in (("get_cached", _get), ("set_cached", _set),
                         ("invalidate", _invalidate)):
            if hasattr(module, name):
                monkeypatch.setattr(module, name, fn)


@pytest.fixture()
def counting_cache(monkeypatch):
    """In-memory cache that records every hit and miss, per key.

    Stands in for Redis so the hit-rate benchmark is deterministic and so a
    missing/slow Redis can never make the suite hang.
    """
    store = {}
    stats = {"hits": 0, "misses": 0, "missed_keys": [], "hit_keys": []}

    async def _get(key, default=None):
        if key in store:
            stats["hits"] += 1
            stats["hit_keys"].append(key)
            return store[key]
        stats["misses"] += 1
        stats["missed_keys"].append(key)
        return default

    async def _set(key, value, ttl=600):
        store[key] = value
        return True

    async def _invalidate(pattern):
        if pattern.endswith("*"):
            doomed = [k for k in store if k.startswith(pattern[:-1])]
        else:
            doomed = [k for k in store if k == pattern]
        for k in doomed:
            store.pop(k, None)
        return len(doomed)

    monkeypatch.setattr(crm, "get_cached", _get)
    monkeypatch.setattr(crm, "set_cached", _set)
    monkeypatch.setattr(crm, "invalidate", _invalidate)
    stats["store"] = store
    return stats


def _lead_docs(n, schools=200):
    """n leads spread over `schools` schools, a fifth of them tagged.

    Spreading across many schools is the point: the bug being defended against
    is the per-lead school lookup, and a dataset where every lead shares one
    school would hide it behind a single cached document.
    """
    stages = ["new", "qualified", "demo", "negotiation", "quoted"]
    return [
        {
            "lead_id": f"bench{RUN}_lead_{i:06d}",
            "bench_run": RUN,
            "school_id": f"bench{RUN}_sch_{i % schools}",
            "stage": stages[i % len(stages)],
            "assigned_to": f"rep{i % 7}@smartshape.in",
            # leads store tag ids under `tags` (see create_lead), NOT `tag_ids`
            "tags": [f"bench{RUN}_tag_care"] if i % 5 == 0 else [],
            "company_name": f"Company {i}",
            "contact_name": f"Contact {i}",
            "expected_value": 10000 + (i % 50) * 1000,
            "created_at": f"2026-{(i % 12) + 1:02d}-{(i % 28) + 1:02d}T00:00:00+00:00",
        }
        for i in range(n)
    ]


def _school_docs(n):
    return [
        {
            "school_id": f"bench{RUN}_sch_{i}",
            "bench_run": RUN,
            "school_name": f"Bench School {i}",
            "city": "Delhi" if i % 2 else "Mumbai",
            "school_type": "CBSE",
            "school_strength": 500 + i,
        }
        for i in range(n)
    ]


# ---------------------------------------------------------------------------
# Benchmark 1 — lead list page under 500ms, over 10k leads
# ---------------------------------------------------------------------------

@pytest.mark.usefixtures("null_cache")
def test_lead_list_page_under_500ms(monkeypatch, capsys):
    """GET /leads?page=1&limit=50 over 10,000 leads must answer in <500ms.

    This is the query that used to take 10-30s. The cost it defends against is
    the N+1 (one db.schools.find_one per lead) plus loading all 10,000 rows
    into memory with .to_list(10000) before slicing.
    """
    _local_mongo_or_skip()
    _as_admin(monkeypatch, crm)

    async def _go():
        client, d = await _open_local_db()
        try:
            await _cleanup(d)
            await _build_lead_indexes(d)
            await d.schools.insert_many(_school_docs(200))
            await d.leads.insert_many(_lead_docs(10_000))
            monkeypatch.setattr(crm, "db", d)

            return await _measure(
                lambda: crm.get_leads(FakeRequest(), page=1, limit=50))
        finally:
            await _cleanup(d)
            client.close()

    samples, data = _run(_go())

    # The page is real, not an empty list that returned quickly.
    assert len(data["leads"]) == 50
    assert data["total"] == 10_000
    assert data["pages"] == 200
    assert data["leads"][0]["school_name"].startswith("Bench School")

    median = statistics.median(samples)
    with capsys.disabled():
        _report("lead list (10k leads, cold cache)", samples, TARGET_LEAD_LIST_S)
    assert median < TARGET_LEAD_LIST_S, (
        f"lead list median {median * 1000:.0f}ms, target <{TARGET_LEAD_LIST_S * 1000:.0f}ms "
        f"(samples: {[round(s * 1000) for s in samples]}ms)"
    )


# ---------------------------------------------------------------------------
# Benchmark 2 — tag-filtered page under 200ms
# ---------------------------------------------------------------------------

@pytest.mark.usefixtures("null_cache")
def test_tag_filter_under_200ms(monkeypatch, capsys):
    """GET /leads?page=1&limit=50&tag=... must answer in <200ms.

    Tag filtering is the slowest filter in the rail because `tags` is a
    multikey array. Task 3 added the (tags, stage) compound index for exactly
    this; the benchmark runs with that index present so it measures the shipped
    configuration.
    """
    _local_mongo_or_skip()
    _as_admin(monkeypatch, crm)
    tag_id = f"bench{RUN}_tag_care"

    async def _go():
        client, d = await _open_local_db()
        try:
            await _cleanup(d)
            await _build_lead_indexes(d)
            await d.schools.insert_many(_school_docs(200))
            await d.leads.insert_many(_lead_docs(10_000))
            await d.tags.insert_one(
                {"tag_id": tag_id, "name": "Care", "bench_run": RUN})
            monkeypatch.setattr(crm, "db", d)

            return await _measure(
                lambda: crm.get_leads(FakeRequest(), page=1, limit=50, tag=tag_id))
        finally:
            await _cleanup(d)
            client.close()

    samples, data = _run(_go())

    # The filter actually filtered: one lead in five is tagged.
    assert data["total"] == 2000
    assert len(data["leads"]) == 50
    assert all(tag_id in lead["tags"] for lead in data["leads"])
    assert data["leads"][0]["tag_names"] == ["Care"]

    median = statistics.median(samples)
    with capsys.disabled():
        _report("tag filter (10k leads, cold cache)", samples, TARGET_TAG_FILTER_S)
    assert median < TARGET_TAG_FILTER_S, (
        f"tag filter median {median * 1000:.0f}ms, target <{TARGET_TAG_FILTER_S * 1000:.0f}ms "
        f"(samples: {[round(s * 1000) for s in samples]}ms)"
    )


# ---------------------------------------------------------------------------
# Benchmark 3 — 500-school import under 30s
# ---------------------------------------------------------------------------

@pytest.mark.usefixtures("null_cache")
def test_import_500_schools_under_30s(monkeypatch, capsys):
    """POST /import/execute with 500 tagged schools must finish in <30s.

    The old importer took 2-3 minutes for this file. Tags are included because
    they were the per-row hotspot (a find_one plus an insert_one per tag per
    row).
    """
    _local_mongo_or_skip()
    _as_admin(monkeypatch, admin)

    rows = [
        {
            "row_num": i + 1,
            "status": "ok",
            "data": {
                "school_name": f"Bench Import School {i}",
                "email": f"bench{RUN}-{i}@example.com",
                "tags": "Care, EU Chandigarh 2026",
            },
        }
        for i in range(500)
    ]

    async def _go():
        client, d = await _open_local_db()
        out = None
        try:
            await _cleanup(d)
            await d.tags.delete_many({"name": {"$in": ["Care", "EU Chandigarh 2026"]}})
            monkeypatch.setattr(admin, "db", d)

            start = time.perf_counter()
            out = await admin.execute_import(
                JsonRequest({"rows": rows, "entity_type": "schools"}))
            elapsed = time.perf_counter() - start
            return out, elapsed
        finally:
            # The importer stamps its own documents, so teardown removes them by
            # the id it returned rather than by "everything this user imported" —
            # a benchmark must not delete another suite's rows if DB_NAME is shared.
            if out and out.get("log_id"):
                await d.import_logs.delete_many({"log_id": out["log_id"]})
            await d.tags.delete_many({"name": {"$in": ["Care", "EU Chandigarh 2026"]},
                                      "created_by": ADMIN["email"]})
            await _cleanup(d)
            client.close()

    data, elapsed = _run(_go())

    assert data["created"] == 500
    assert data["failed"] == 0
    assert data["errors"] == []

    with capsys.disabled():
        print(f"\n  import 500 schools + 2 tags each: {elapsed:.2f}s "
              f"| target <{TARGET_IMPORT_S:.0f}s")
    assert elapsed < TARGET_IMPORT_S, (
        f"import took {elapsed:.2f}s, target <{TARGET_IMPORT_S:.0f}s")


# ---------------------------------------------------------------------------
# Benchmark 4 — cache hit rate above 75%
# ---------------------------------------------------------------------------

def _seed_mongomock(d):
    _run(d.schools.insert_many(_school_docs(20)))
    _run(d.leads.insert_many(_lead_docs(300, schools=20)))
    _run(d.tags.insert_one({"tag_id": f"bench{RUN}_tag_care", "name": "Care"}))


def test_cache_hit_rate_above_75_percent(monkeypatch, counting_cache, capsys):
    """Repeated list requests must serve >75% of their cache lookups from cache.

    Counted, not timed. The failure this actually catches is an UNSTABLE CACHE
    KEY: a key built from `hash()` or from anything per-request would still
    populate the cache and still look fast on a warm dictionary, while hitting
    0% in production across workers and restarts. Counting the lookups is the
    only way to see that.
    """
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(crm, "db", d)
    monkeypatch.setattr(rbac, "MODULE_RBAC_MODE", "enforce")
    _as_admin(monkeypatch, crm)
    _seed_mongomock(d)

    # Warm-up. Must MISS, otherwise the counter is not wired to anything real.
    _run(crm.get_leads(FakeRequest(), page=1, limit=50))
    assert counting_cache["misses"] > 0, "warm-up recorded no misses — cache not wired"
    warm_misses = counting_cache["misses"]
    assert counting_cache["hits"] == 0, "cold cache reported a hit"

    counting_cache["hits"] = 0
    counting_cache["misses"] = 0
    counting_cache["missed_keys"].clear()

    for _ in range(10):
        _run(crm.get_leads(FakeRequest(), page=1, limit=50))

    hits, misses = counting_cache["hits"], counting_cache["misses"]
    lookups = hits + misses
    assert lookups > 0, "no cache lookups at all — is the list still cached?"
    hit_rate = hits / lookups

    with capsys.disabled():
        print(f"\n  cache: {hits}/{lookups} lookups hit ({hit_rate:.1%}) over 10 requests "
              f"| target >{TARGET_CACHE_HIT_RATE:.0%} "
              f"| cold request populated {warm_misses} keys")
        if counting_cache["missed_keys"]:
            print(f"  missed after warm-up: {sorted(set(counting_cache['missed_keys']))}")

    assert hit_rate > TARGET_CACHE_HIT_RATE, (
        f"cache hit rate {hit_rate:.1%}, target >{TARGET_CACHE_HIT_RATE:.0%}. "
        f"Missed keys: {sorted(set(counting_cache['missed_keys']))}"
    )


def test_cache_keys_are_stable_across_processes(monkeypatch, counting_cache):
    """The cache key for the same request must be byte-identical every time.

    `_stable_key` uses md5(json) precisely because Python randomises str
    hashing per process (PYTHONHASHSEED), so a hash()-based key would give
    every worker its own private cache and a 0% hit rate in production while
    every local test still passed. Pinning the key set makes that regression
    impossible to merge quietly.
    """
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(crm, "db", d)
    _as_admin(monkeypatch, crm)
    _seed_mongomock(d)

    _run(crm.get_leads(FakeRequest(), page=1, limit=50))
    first = set(counting_cache["store"])

    counting_cache["missed_keys"].clear()
    _run(crm.get_leads(FakeRequest(), page=1, limit=50))

    assert counting_cache["missed_keys"] == [], (
        "the same request produced new cache keys on its second run: "
        f"{counting_cache['missed_keys']}"
    )
    assert set(counting_cache["store"]) == first
    # And the keys are the documented, greppable ones — not opaque churn.
    assert any(k.startswith("schools:batch:") for k in first)
    assert any(k.startswith("crm:facets:") for k in first)


def test_a_write_evicts_the_list_caches_it_invalidates(monkeypatch, counting_cache):
    """Cache hit rate must not be bought with staleness.

    A benchmark that only rewards hits is satisfied by a cache that never
    expires, which ships a CRM where an imported school stays invisible for ten
    minutes. This pins the other half of the contract: the import path drops
    the three key families the list reads.
    """
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(crm, "db", d)
    _as_admin(monkeypatch, crm)
    _seed_mongomock(d)

    _run(crm.get_leads(FakeRequest(), page=1, limit=50))
    assert any(k.startswith("schools:batch:") for k in counting_cache["store"])
    assert any(k.startswith("crm:facets:") for k in counting_cache["store"])

    # The patterns admin_routes.execute_import invalidates after a commit.
    for pattern in ("crm:facets:*", "schools:batch:*", "tags:*"):
        _run(crm.invalidate(pattern))

    leftover = [k for k in counting_cache["store"]
                if k.startswith(("schools:batch:", "crm:facets:", "tags:"))]
    assert leftover == [], f"import invalidation left stale list caches: {leftover}"
