"""GET /export/schools — streaming CSV contract (CRM Performance Redesign, task 7).

Every other export on this router calls `.to_list(5000)` and builds the whole
file in a StringIO before replying: capped, and a memory spike on a 1-vCPU box.
This one must hold nothing bigger than a cursor batch, so what is pinned here is:

  * the CSV grid survives dirty school data (commas, quotes, embedded newlines),
  * tag ids become tag names from ONE query, not one query per row,
  * the header reaches the client before the last school has been read,
  * the rows are exactly the rows the caller could already see in the CRM
    (own-scope reps included) and never a soft-deleted one.

Task 7's brief put this in tests/test_import_performance.py; that file is owned
by task 6 (batch import) and was overwritten mid-task, so the export contract
lives in its own file.

SAFETY: mongomock only. No live DB, no server, no Redis.

Run:  cd backend && python -m pytest tests/test_export_streaming.py -v
"""
import asyncio
import csv
import io
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from fastapi import HTTPException
from mongomock_motor import AsyncMongoMockClient

import rbac
import routes.admin_routes as admin

_DB_NAME = os.environ["DB_NAME"]
assert _DB_NAME.endswith("_test") or _DB_NAME == "mtt_ci", (
    f"refusing to run against non-test database {_DB_NAME!r}"
)

ADMIN = {"email": "info@smartshape.in", "name": "Owner", "role": "admin"}
PARUL = {
    "email": "parul@ss.in", "name": "Parul", "role": "sales_person",
    "module_permissions": {"leads": {"level": "read_write", "scope": "own"}},
}
AMIT = {
    "email": "amit@ss.in", "name": "Amit", "role": "sales_person",
    "module_permissions": {"leads": {"level": "read_write", "scope": "own"}},
}


class FakeRequest:
    """The route only uses the request to identify the caller."""


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(admin, "db", d, raising=False)
    monkeypatch.setattr(rbac, "MODULE_RBAC_MODE", "enforce")
    return d


def _as(user, monkeypatch):
    async def _me(_request):
        return user
    monkeypatch.setattr(admin, "get_current_user", _me, raising=False)


def _run(coro):
    return asyncio.run(coro)


async def _drain(response):
    """Collect a StreamingResponse the way an HTTP client would."""
    chunks = []
    async for chunk in response.body_iterator:
        chunks.append(chunk.decode() if isinstance(chunk, bytes) else chunk)
    return "".join(chunks)


def _export(user, monkeypatch, **kwargs):
    _as(user, monkeypatch)

    async def _go():
        response = await admin.export_schools(FakeRequest(), **kwargs)
        return response, await _drain(response)

    return _run(_go())


def _rows(text):
    return list(csv.reader(io.StringIO(text)))


def test_export_schools_streams_csv(db, monkeypatch):
    """1000 schools export as CSV: header + one row each, tags resolved to names."""
    _run(db.schools.insert_many([
        {
            "school_id": f"sch_{i}",
            "school_name": f"School {i}",
            "email": f"school{i}@example.com",
            "phone": f"98000000{i:03d}",
            "city": "NYC" if i % 2 == 0 else "LA",
            "state": "Delhi",
            "assigned_to": "parul@ss.in",
            "tag_ids": ["tag_care"] if i % 10 == 0 else [],
        }
        for i in range(1000)
    ]))
    _run(db.tags.insert_one({"tag_id": "tag_care", "name": "Care"}))

    response, text = _export(ADMIN, monkeypatch)

    assert response.status_code == 200
    assert response.media_type == "text/csv"
    assert "attachment" in response.headers["content-disposition"]

    rows = _rows(text)
    assert rows[0] == ["school_id", "school_name", "email", "phone",
                       "city", "state", "owner", "tags"]
    assert len(rows) == 1001, f"expected header + 1000 rows, got {len(rows)}"

    # Naive line-splitting clients must see the same 1000 data lines.
    assert len([ln for ln in text.split("\n") if ln]) == 1001

    by_id = {r[0]: r for r in rows[1:]}
    assert by_id["sch_0"][1] == "School 0"
    assert by_id["sch_0"][6] == "parul@ss.in"       # owner column
    assert by_id["sch_0"][7] == "Care"              # tag id resolved to name
    assert by_id["sch_1"][7] == ""                  # untagged school


def test_export_fetches_tags_once_not_once_per_school(db, monkeypatch):
    """The brief's sample code ran a find_one per tag per row — a 1000-row N+1.
    Tag names must be fetched in a single query and reused."""
    _run(db.schools.insert_many([
        {"school_id": f"sch_{i}", "school_name": f"School {i}",
         "tag_ids": ["tag_care", "tag_eu"]}
        for i in range(200)
    ]))
    _run(db.tags.insert_many([
        {"tag_id": "tag_care", "name": "Care"},
        {"tag_id": "tag_eu", "name": "EU Chandigarh"},
    ]))

    calls = {"find": 0, "find_one": 0}

    class CountingTags:
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
        def tags(self):
            return CountingTags(self._inner.tags)

        def __getattr__(self, name):
            return getattr(self._inner, name)

    monkeypatch.setattr(admin, "db", CountingDb(db))

    _response, text = _export(ADMIN, monkeypatch)

    rows = _rows(text)
    assert len(rows) == 201
    assert rows[1][7] == "Care|EU Chandigarh"
    assert calls["find_one"] == 0, "per-row tag lookup is back"
    assert calls["find"] == 1, f"expected 1 batched tags query, got {calls['find']}"


def test_export_does_not_buffer_every_row_before_sending(db, monkeypatch):
    """Streaming means the header reaches the client before the last school is
    read. If the generator materialised the collection first, the cursor would
    already be exhausted by the time the first chunk arrives."""
    _run(db.schools.insert_many([
        {"school_id": f"sch_{i}", "school_name": f"School {i}"} for i in range(500)
    ]))

    read = {"docs": 0}
    real_find = db.schools.find

    class CountingCursor:
        def __init__(self, inner):
            self._inner = inner

        def batch_size(self, n):
            self._inner = self._inner.batch_size(n)
            return self

        def sort(self, *a, **k):
            self._inner = self._inner.sort(*a, **k)
            return self

        def __aiter__(self):
            inner = self._inner.__aiter__()

            async def gen():
                async for doc in inner:
                    read["docs"] += 1
                    yield doc

            return gen()

    class CountingSchools:
        def __init__(self, inner):
            self._inner = inner

        def find(self, *a, **k):
            return CountingCursor(real_find(*a, **k))

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

    monkeypatch.setattr(admin, "db", CountingDb(db))
    _as(ADMIN, monkeypatch)

    async def _go():
        response = await admin.export_schools(FakeRequest())
        it = response.body_iterator.__aiter__()
        first = await it.__anext__()
        after_header = read["docs"]
        second = await it.__anext__()
        rest = [chunk async for chunk in it]
        return first, after_header, second, len(rest)

    first, after_header, second, rest_count = _run(_go())

    assert first.startswith("school_id,")
    assert after_header == 0, "whole collection was read before the header went out"
    assert second.startswith("sch_")
    assert rest_count == 499
    assert read["docs"] == 500


def test_export_escapes_commas_quotes_and_newlines(db, monkeypatch):
    """Dirty school data must not be able to break the CSV grid."""
    _run(db.schools.insert_many([
        {"school_id": "s1", "school_name": "St. Mary's, Delhi", "city": "Delhi"},
        {"school_id": "s2", "school_name": 'The "Great" School', "city": "Pune"},
        {"school_id": "s3", "school_name": "Line1\nLine2\r\nLine3", "city": "Goa"},
        {"school_id": "s4", "school_name": "Tab\tSchool", "city": "Kochi"},
    ]))

    _response, text = _export(ADMIN, monkeypatch)

    rows = _rows(text)
    assert len(rows) == 5, f"escaping broke the row count: {rows}"
    by_id = {r[0]: r for r in rows[1:]}
    assert by_id["s1"][1] == "St. Mary's, Delhi"
    assert by_id["s2"][1] == 'The "Great" School'
    # Embedded newlines are flattened so one school is always one CSV line.
    assert by_id["s3"][1] == "Line1 Line2 Line3"
    assert by_id["s4"][1] == "Tab School"
    assert by_id["s3"][4] == "Goa"


def test_export_coerces_non_string_values(db, monkeypatch):
    """A phone stored as a number, or a stray None, must not blow up the stream."""
    _run(db.schools.insert_many([
        {"school_id": "s1", "school_name": "Numeric", "phone": 9876543210,
         "city": None, "tag_ids": None},
        {"school_id": "s2"},  # nothing but an id
    ]))

    _response, text = _export(ADMIN, monkeypatch)

    rows = _rows(text)
    by_id = {r[0]: r for r in rows[1:]}
    assert by_id["s1"][3] == "9876543210"
    assert by_id["s1"][4] == ""
    assert by_id["s2"] == ["s2", "", "", "", "", "", "", ""]


def test_export_omits_deleted_schools(db, monkeypatch):
    """A soft-deleted school is gone from the CRM; it must be gone from the CSV."""
    _run(db.schools.insert_many([
        {"school_id": "live", "school_name": "Live School"},
        {"school_id": "dead", "school_name": "Dead School", "is_deleted": True},
    ]))

    _response, text = _export(ADMIN, monkeypatch)

    assert [r[0] for r in _rows(text)[1:]] == ["live"]


def test_export_is_scoped_to_what_the_rep_can_see(db, monkeypatch):
    """An own-scope rep exporting gets her own schools, not the whole database.
    Same visibility as GET /schools: owned, created-while-unassigned, plus the
    schools carrying her leads or quotations."""
    _run(db.schools.insert_many([
        {"school_id": "mine", "school_name": "Mine", "assigned_to": "parul@ss.in"},
        {"school_id": "created", "school_name": "Created",
         "created_by": "parul@ss.in", "assigned_to": ""},
        {"school_id": "via_lead", "school_name": "Via Lead", "assigned_to": "amit@ss.in"},
        {"school_id": "via_quote", "school_name": "Via Quote", "assigned_to": "amit@ss.in"},
        {"school_id": "hers", "school_name": "Hers", "assigned_to": "amit@ss.in"},
    ]))
    _run(db.leads.insert_one({"lead_id": "l1", "school_id": "via_lead",
                              "assigned_to": "parul@ss.in"}))
    _run(db.quotations.insert_one({"quote_number": "q1", "school_id": "via_quote",
                                   "created_by": "parul@ss.in"}))

    _response, text = _export(PARUL, monkeypatch)
    assert sorted(r[0] for r in _rows(text)[1:]) == ["created", "mine", "via_lead", "via_quote"]

    _response, text = _export(AMIT, monkeypatch)
    assert sorted(r[0] for r in _rows(text)[1:]) == ["hers", "via_lead", "via_quote"]

    _response, text = _export(ADMIN, monkeypatch)
    assert len(_rows(text)[1:]) == 5


def test_export_denied_without_crm_read(db, monkeypatch):
    """No CRM grant, no school export."""
    storekeeper = {"email": "store@ss.in", "name": "Store", "role": "store",
                   "module_permissions": {"inventory": {"level": "read", "scope": "all"}}}
    _run(db.schools.insert_one({"school_id": "s1", "school_name": "S1"}))
    _as(storekeeper, monkeypatch)

    with pytest.raises(HTTPException) as exc:
        _run(admin.export_schools(FakeRequest()))
    assert exc.value.status_code == 403


def test_export_rejects_unsupported_format(db, monkeypatch):
    """?format=xlsx must fail loudly, not silently hand back CSV."""
    _as(ADMIN, monkeypatch)
    with pytest.raises(HTTPException) as exc:
        _run(admin.export_schools(FakeRequest(), format="xlsx"))
    assert exc.value.status_code == 400


def test_export_falls_back_to_legacy_owner_field(db, monkeypatch):
    """Schools written by the legacy CSV importer carry `owner`, not
    `assigned_to` (the now-deleted admin_routes.execute_import). Export both."""
    _run(db.schools.insert_many([
        {"school_id": "new", "school_name": "New", "assigned_to": "parul@ss.in"},
        {"school_id": "old", "school_name": "Old", "owner": "amit@ss.in"},
    ]))

    _response, text = _export(ADMIN, monkeypatch)
    assert {r[0]: r[6] for r in _rows(text)[1:]} == {"new": "parul@ss.in", "old": "amit@ss.in"}
