"""GET /leads pagination contract (CRM Performance Redesign, task 4).

The old endpoint pulled every lead into memory (`.to_list(10000)`) and then
queried db.schools once PER LEAD — the N+1 that made the CRM list take 10-30s.
This pins the replacement: a page of leads, an honest total, and facet counts,
with schools/tags batch-fetched exactly once per request.

SAFETY: mongomock only. No live DB, no Redis — the cache layer is stubbed with
an in-memory dict so a cache HIT is exercised deterministically and a missing
Redis can never make this suite hang or flake.

Run:  cd backend && python -m pytest tests/test_crm_pagination.py -v
"""
import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

import rbac
import routes.crm_routes as crm

ADMIN = {"email": "info@smartshape.in", "name": "Owner", "role": "admin"}


class FakeRequest:
    """The route only uses the request to identify the caller."""
    pass


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(crm, "db", d)
    monkeypatch.setattr(rbac, "MODULE_RBAC_MODE", "enforce")
    return d


@pytest.fixture()
def cache(monkeypatch):
    """In-memory stand-in for Redis. Also lets a test assert cache hits."""
    store = {}

    async def _get(key, default=None):
        return store.get(key, default)

    async def _set(key, value, ttl=600):
        store[key] = value
        return True

    monkeypatch.setattr(crm, "get_cached", _get)
    monkeypatch.setattr(crm, "set_cached", _set)
    return store


def _as(user, monkeypatch):
    async def _me(_request):
        return user
    monkeypatch.setattr(crm, "get_current_user", _me)


def _run(coro):
    return asyncio.run(coro)


@pytest.mark.usefixtures("cache")
def test_leads_pagination_returns_page_and_total(db, monkeypatch):
    """GET /leads?page=1&limit=50 returns one page, the real total, and facets."""
    _as(ADMIN, monkeypatch)

    leads = [
        {
            "lead_id": f"lead_{i:03d}",
            "school_id": f"sch_{i % 10}",
            "stage": "negotiation" if i % 2 == 0 else "qualified",
            "assigned_to": "john@company.com" if i % 3 == 0 else "jane@company.com",
            # leads store tag ids under `tags` (see create_lead), not `tag_ids`
            "tags": ["tag_care"] if i % 5 == 0 else [],
            "created_at": f"2026-09-{(i % 28) + 1:02d}T00:00:00+00:00",
            "company_name": f"Company {i}",
            "contact_name": f"Contact {i}",
        }
        for i in range(150)
    ]
    _run(db.leads.insert_many(leads))

    schools = [
        {
            "school_id": f"sch_{i}",
            "school_name": f"School {i}",
            "city": "NYC" if i % 2 == 0 else "LA",
            "school_type": "CBSE",
            "school_strength": 1500,
        }
        for i in range(10)
    ]
    _run(db.schools.insert_many(schools))
    _run(db.tags.insert_one({"tag_id": "tag_care", "name": "Care"}))

    data = _run(crm.get_leads(FakeRequest(), page=1, limit=50))

    # Pagination
    assert len(data["leads"]) == 50
    assert data["total"] == 150
    assert data["page"] == 1
    assert data["pages"] == 3
    assert data["limit"] == 50

    # Facets
    assert "facets" in data
    assert "stages" in data["facets"]
    assert "tags" in data["facets"]
    assert data["facets"]["stages"] == {"negotiation": 75, "qualified": 75}
    assert data["facets"]["tags"] == {"tag_care": 30}

    # Enrichment survived the rewrite — the list UI reads all of these.
    row = data["leads"][0]
    for key in ("school_name", "school_type", "school_city", "lead_score",
                "visit_required", "deal_value", "probability", "weighted_value"):
        assert key in row, f"{key} missing from enriched lead"
    assert row["school_name"] == f"School {int(row['lead_id'].split('_')[1]) % 10}"
    # tag ids stay ids (the frontend filters on them); names ride alongside
    tagged = next(l for l in data["leads"] if l["tags"])
    assert tagged["tags"] == ["tag_care"]
    assert tagged["tag_names"] == ["Care"]

    # Page 2 is a different, non-overlapping slice; last page is short.
    p2 = _run(crm.get_leads(FakeRequest(), page=2, limit=50))
    assert len(p2["leads"]) == 50
    ids1 = {l["lead_id"] for l in data["leads"]}
    ids2 = {l["lead_id"] for l in p2["leads"]}
    assert not (ids1 & ids2)
    p3 = _run(crm.get_leads(FakeRequest(), page=3, limit=50))
    assert len(p3["leads"]) == 50
    p4 = _run(crm.get_leads(FakeRequest(), page=4, limit=50))
    assert p4["leads"] == []


@pytest.mark.usefixtures("cache")
def test_leads_pagination_with_filters(db, monkeypatch):
    """GET /leads?stage=negotiation filters first, then paginates the filtered set."""
    _as(ADMIN, monkeypatch)

    leads = [
        {"lead_id": f"lead_{i:03d}",
         "stage": "negotiation" if i < 100 else "qualified",
         "created_at": f"2026-09-{(i % 28) + 1:02d}T00:00:00+00:00"}
        for i in range(150)
    ]
    _run(db.leads.insert_many(leads))

    data = _run(crm.get_leads(FakeRequest(), page=1, limit=50, stage="negotiation"))

    assert data["total"] == 100          # only negotiation leads
    assert data["pages"] == 2
    assert len(data["leads"]) == 50
    assert all(lead["stage"] == "negotiation" for lead in data["leads"])


@pytest.mark.usefixtures("cache")
def test_search_is_combined_with_scope_not_overwritten(db, monkeypatch):
    """A rep's own-scope must survive a search box — the two $or clauses have to
    AND together. Getting this wrong leaks the whole pipeline to every rep."""
    rep = {"email": "parul@smartshape.in", "name": "Parul", "role": "sales",
           "module_permissions": {"leads": {"level": "read_write", "scope": "own"}}}
    _as(rep, monkeypatch)

    _run(db.leads.insert_many([
        {"lead_id": "mine", "assigned_to": "parul@smartshape.in",
         "company_name": "Delhi Public School", "stage": "new"},
        {"lead_id": "hers", "assigned_to": "amit@smartshape.in",
         "company_name": "Delhi Modern School", "stage": "new"},
    ]))

    data = _run(crm.get_leads(FakeRequest(), page=1, limit=50, search="Delhi"))
    assert [l["lead_id"] for l in data["leads"]] == ["mine"]
    assert data["total"] == 1


@pytest.mark.usefixtures("cache")
def test_legacy_unpaginated_call_still_returns_a_list(db, monkeypatch):
    """5 live screens still call GET /leads expecting a bare array (useCrmData,
    useSalesHome, useSalesLeads, useVisitPlanning, VisitFormDialog). Until they
    migrate, a call with no page/limit must keep the old shape."""
    _as(ADMIN, monkeypatch)
    _run(db.leads.insert_many([
        {"lead_id": "l1", "school_id": "s1", "stage": "new", "created_at": "2026-09-01"},
        {"lead_id": "l2", "school_id": "s1", "stage": "won", "created_at": "2026-09-02"},
    ]))
    _run(db.schools.insert_one({"school_id": "s1", "school_name": "DPS", "city": "Delhi"}))

    out = _run(crm.get_leads(FakeRequest()))
    assert isinstance(out, list)
    assert len(out) == 2
    assert out[0]["school_name"] == "DPS"
    assert "lead_score" in out[0]


@pytest.mark.usefixtures("cache")
def test_schools_are_fetched_once_not_once_per_lead(db, monkeypatch):
    """The whole point of the rewrite: kill the N+1. 50 leads across 10 schools
    must cost ONE schools query, not 50."""
    _as(ADMIN, monkeypatch)
    _run(db.leads.insert_many([
        {"lead_id": f"l{i:03d}", "school_id": f"sch_{i % 10}", "stage": "new",
         "created_at": f"2026-09-{(i % 28) + 1:02d}"}
        for i in range(50)
    ]))
    _run(db.schools.insert_many([
        {"school_id": f"sch_{i}", "school_name": f"S{i}", "city": "Delhi"}
        for i in range(10)
    ]))

    # mongomock hands back a fresh collection wrapper on every attribute access,
    # so the counter has to live on a db proxy, not on one collection object.
    calls = {"find": 0, "find_one": 0}

    class CountingSchools:
        def __init__(self, inner):
            self._inner = inner

        def find(self, *a, **k):
            calls["find"] += 1
            return self._inner.find(*a, **k)

        async def find_one(self, *a, **k):
            calls["find_one"] += 1
            return await self._inner.find_one(*a, **k)

        def __getattr__(self, name):
            return getattr(self._inner, name)

    class CountingDb:
        def __init__(self, inner):
            self._inner = inner

        @property
        def schools(self):
            return CountingSchools(self._inner.schools)

        def __getattr__(self, name):
            return getattr(self._inner, name)

    monkeypatch.setattr(crm, "db", CountingDb(db))

    data = _run(crm.get_leads(FakeRequest(), page=1, limit=50))
    assert len(data["leads"]) == 50
    assert calls["find_one"] == 0, "per-lead school lookup is back"
    assert calls["find"] == 1, f"expected 1 batched schools query, got {calls['find']}"
