# CRM ID-Based Upsert & Tag Canonicalisation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A CSV exported from the CRM, edited in Excel, and re-uploaded updates the existing contacts, schools and leads it names — matched by ID — without erasing any field left blank.

**Architecture:** Reuse the existing `import_engine.commit_row()`, which already performs ID-first upsert across all three collections, rather than writing a fourth importer. Three changes make it fit: blank cells stop overwriting live data, tags gain a field-registry entry, and a contacts-only row stops minting a junk school. Then `POST /contacts/import` is repointed at it and two orphaned insert-only endpoints are deleted. Before any of that, the `tags` / `tag_ids` field split is canonicalised so tags written by import and by the UI are the same field.

**Tech Stack:** Python 3.14, FastAPI, Motor/MongoDB, pytest + `mongomock_motor`, openpyxl.

**Spec:** `docs/superpowers/specs/2026-09-09-crm-grid-and-upsert-design.md`

## Global Constraints

- **Branch:** all work lands on `feat/crm-grid-upsert` (already created from `origin/main` at `b99a6bc`). Never commit to `main` or to a detached HEAD.
- **D1 — blank never clears.** An empty CSV cell means "leave this field alone". Only non-blank values are written on update. Zero (`0`) and `False` are values, not blanks, and must survive.
- **D5 — canonical tag field is `tag_ids`** on `db.contacts`, `db.schools` and `db.leads`. After Task 3 no code may read or write `schools.tags` or `leads.tags`.
- **D6 — no compatibility shim.** Migrate and cut over together; do not add dual-read fallbacks.
- **Tests never touch the production database.** Use the `mongomock_motor` `db` fixture, following `backend/tests/test_import_safety.py`.
- **Run tests from the `backend/` directory:** `cd backend && python -m pytest tests/<file> -q`.
- **Python interpreter is `python`, not `python3`** (`python3` is a broken Windows Store stub on this machine).
- Migrations live in `backend/migrations/` and must be idempotent — safe to run twice, second run reports zero changes.
- Commit after each task. Never use `git add -A` (the repo has untracked scratch directories); stage named files only.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `backend/import_engine.py` | Blank-safe update dicts; tags application; contacts-only guard | 1, 5, 6 |
| `backend/field_registry.py` | `tags` and `notes` field definitions | 5 |
| `backend/migrations/canonicalise_tag_fields.py` | One-shot `tags` → `tag_ids` union migration (new) | 2 |
| `backend/migrations/canonicalise_school_owner.py` | One-shot `owner` → `assigned_to` migration (new) | 4 |
| `backend/routes/crm_routes.py` | Tag field renames; repoint `POST /contacts/import` | 3, 7 |
| `backend/routes/admin_routes.py` | School insert owner field; delete orphaned import endpoints | 4, 8 |
| `backend/ensure_indexes.py` | Indexes on `schools.tag_ids`, `leads.tag_ids` | 3 |
| `frontend/src/lib/api.js` | Delete orphaned `importSystem` methods | 8 |
| `backend/tests/test_import_blank_safety.py` | D1 regression suite (new) | 1 |
| `backend/tests/test_tag_canonicalisation.py` | Migration + round-trip visibility (new) | 2, 3 |
| `backend/tests/test_contacts_import_upsert.py` | End-to-end round-trip suite (new) | 5, 6, 7 |

---

### Task 1: Blank cells must never clear a field

This is a live data-loss fix, independent of everything else. `split_values()` emits every column present in the row, including empty ones, and `commit_row()` `$set`s them wholesale — so Admin → Import Center is silently wiping fields today whenever a sheet has blank columns.

**Files:**
- Modify: `backend/import_engine.py` (add helper near `_now()` at line 328; rewrite the update branches at lines 510-520 and 540-566)
- Test: `backend/tests/test_import_blank_safety.py` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `_strip_blanks(d: dict) -> dict` in `import_engine`, used by Tasks 5 and 6.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_import_blank_safety.py`:

```python
"""D1 — a blank CSV cell must never clear an existing field.

A spreadsheet round-trip emits every column for every row, so cells the user
left empty arrive as "". Re-uploading an export must not overwrite live
phone/email values with empty strings.

Run with:  cd backend && python -m pytest tests/test_import_blank_safety.py -q
"""

import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest

import import_engine as ie

IMPORTER = {"email": "importer@smartshape.in", "name": "Importer"}


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture()
def db():
    from mongomock_motor import AsyncMongoMockClient
    return AsyncMongoMockClient()["smartshape_test"]


def test_strip_blanks_drops_empty_keeps_falsy_values():
    out = ie._strip_blanks({
        "keep": "value",
        "empty": "",
        "spaces": "   ",
        "none": None,
        "zero": 0,
        "false": False,
    })
    assert out == {"keep": "value", "zero": 0, "false": False}


def test_blank_cells_do_not_clear_contact_fields(db):
    async def go():
        await db.schools.insert_one({
            "school_id": "sch_keepme", "school_name": "Keep School",
            "phone": "9876543210", "city": "Pune", "is_deleted": False,
        })
        await db.contacts.insert_one({
            "contact_id": "con_keepme", "school_id": "sch_keepme",
            "name": "Alka Kapur", "phone": "1141427627",
            "email": "alka@example.com", "designation": "Principal",
        })
        row = {
            "school_id": "sch_keepme",
            "contact_id": "con_keepme",
            "name": "Alka Kapur",
            "phone": "",
            "email": "",
            "designation": "Director",
        }
        await ie.commit_row(db, row, IMPORTER, create_leads=False)

        c = await db.contacts.find_one({"contact_id": "con_keepme"})
        assert c["email"] == "alka@example.com", "blank email cell cleared a live address"
        assert c["phone"] == "1141427627", "blank phone cell cleared a live number"
        assert c["designation"] == "Director", "non-blank cell should have updated"
    _run(go())


def test_blank_cells_do_not_clear_school_fields(db):
    async def go():
        await db.schools.insert_one({
            "school_id": "sch_keepme", "school_name": "Keep School",
            "phone": "9876543210", "city": "Pune", "state": "MH",
            "is_deleted": False,
        })
        row = {
            "school_id": "sch_keepme",
            "school_name": "Keep School",
            "school_phone": "",
            "city": "",
            "state": "Maharashtra",
        }
        await ie.commit_row(db, row, IMPORTER, create_leads=False)

        s = await db.schools.find_one({"school_id": "sch_keepme"})
        assert s["phone"] == "9876543210", "blank phone column cleared the school phone"
        assert s["city"] == "Pune", "blank city cell cleared a live city"
        assert s["state"] == "Maharashtra", "non-blank cell should have updated"
    _run(go())


def test_zero_strength_is_written_not_treated_as_blank(db):
    async def go():
        await db.schools.insert_one({
            "school_id": "sch_zero", "school_name": "Zero School",
            "school_strength": 500, "is_deleted": False,
        })
        row = {"school_id": "sch_zero", "school_name": "Zero School",
               "school_strength": "0"}
        await ie.commit_row(db, row, IMPORTER, create_leads=False)

        s = await db.schools.find_one({"school_id": "sch_zero"})
        assert s["school_strength"] == 0, "0 is a real value, not a blank"
    _run(go())
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && python -m pytest tests/test_import_blank_safety.py -q
```

Expected: `test_strip_blanks_drops_empty_keeps_falsy_values` fails with
`AttributeError: module 'import_engine' has no attribute '_strip_blanks'`, and
the two blank-cell tests fail on the preserved-value assertions.

- [ ] **Step 3: Add the `_strip_blanks` helper**

In `backend/import_engine.py`, immediately after `_now()` (line 328-330):

```python
def _strip_blanks(d: dict) -> dict:
    """Drop keys whose value is blank, so an update never clears a live field.

    A spreadsheet round-trip emits every column for every row, so a cell the
    user left empty arrives as "". Writing that back would overwrite live data
    with an empty string. Zero and False are real values and are preserved.
    """
    out = {}
    for k, v in d.items():
        if v is None:
            continue
        if isinstance(v, str) and not v.strip():
            continue
        out[k] = v
    return out
```

- [ ] **Step 4: Make the school update branch blank-safe**

In `commit_row`, replace the `else:` update branch body (currently lines 510-520,
starting `upd: dict = dict(parts["school"])`) with:

```python
        upd: dict = _strip_blanks(parts["school"])
        if sch_phone_raw:
            upd["phone"] = sch_phone_raw
        for k, v in _strip_blanks(parts["custom"]["school"]).items():
            upd[f"custom_fields.{k}"] = v
        upd["last_activity_date"] = now
        upd["import_date"] = now
        if sch_phone_norm:
            upd["phone_norm"] = sch_phone_norm
        upd.update(assign_set)
        await db.schools.update_one({"school_id": sid}, {"$set": upd})
```

The removed `or "phone" in upd` condition was the school-phone clearing bug: the
mere presence of a phone column, blank or not, wrote over the stored number.

- [ ] **Step 5: Make the contact upsert blank-safe**

Replace the contact value assembly and write (currently lines 540-566) with:

```python
        cvals = _strip_blanks(dict(parts["contact"]))
        if con_phone_raw:
            cvals["phone"] = con_phone_raw
        cdoc = _strip_blanks({
            "school_id": sid,
            **cvals,
            "phone_norm": con_phone_norm,
            "import_date": now,
            **assign_set,
        })
        if existing:
            cid = existing["contact_id"]
            upd_c = dict(cdoc)
            for k, v in _strip_blanks(parts["custom"]["contact"]).items():
                upd_c[f"custom_fields.{k}"] = v
            await db.contacts.update_one({"contact_id": cid}, {"$set": upd_c})
        else:
            cid = supplied_cid or f"con_{_uuid.uuid4().hex[:12]}"
            await db.contacts.insert_one({
                "contact_id": cid,
                "created_at": now,
                "is_deleted": False,
                "created_by": user_email,
                "status": "active",
                "company": parts["school"].get("school_name", ""),
                "source": "import",
                "converted_to_lead": False,
                "lead_id": None,
                "custom_fields": parts["custom"]["contact"],
                **cdoc,
            })
```

Custom fields now use dotted `$set` paths on update, matching the school branch,
so a partial sheet no longer replaces the whole `custom_fields` object.

- [ ] **Step 6: Run the new tests and the existing engine suites**

```bash
cd backend && python -m pytest tests/test_import_blank_safety.py -q
cd backend && python -m pytest tests/test_import_safety.py tests/test_import_resolve.py tests/test_master_import_e2e.py tests/test_import_clean.py -q
```

Expected: all pass. The existing suites must stay green — they cover the
Import Center path this change also affects.

- [ ] **Step 7: Commit**

```bash
git add backend/import_engine.py backend/tests/test_import_blank_safety.py
git commit -m "fix(import): blank CSV cells no longer clear existing fields

split_values emits every column present in a row, including empty ones, and
commit_row \$set them wholesale — so a sheet with blank columns silently wiped
those fields on every matched record. Adds _strip_blanks and applies it to both
update branches. Zero and False are preserved as real values.

Also removes the 'or \"phone\" in upd' condition that cleared a school's phone
whenever a phone column was present, blank or not."
```

---

### Task 2: Tag canonicalisation migration

**Files:**
- Create: `backend/migrations/canonicalise_tag_fields.py`
- Test: `backend/tests/test_tag_canonicalisation.py` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `async def canonicalise_tag_fields(db) -> dict` returning
  `{"leads_renamed": int, "schools_merged": int, "already_clean": bool}`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_tag_canonicalisation.py`:

```python
"""D5 — tags live in `tag_ids` on contacts, schools and leads.

Schools currently carry BOTH `tags` (written by the CRM) and `tag_ids`
(written by CSV import), so tags applied one way are invisible to the other.

Run with:  cd backend && python -m pytest tests/test_tag_canonicalisation.py -q
"""

import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest

from migrations.canonicalise_tag_fields import canonicalise_tag_fields


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture()
def db():
    from mongomock_motor import AsyncMongoMockClient
    return AsyncMongoMockClient()["smartshape_test"]


def test_school_with_both_fields_unions_them(db):
    async def go():
        await db.schools.insert_one({
            "school_id": "sch_both", "tags": ["tag_a", "tag_b"],
            "tag_ids": ["tag_b", "tag_c"],
        })
        await canonicalise_tag_fields(db)
        s = await db.schools.find_one({"school_id": "sch_both"})
        assert sorted(s["tag_ids"]) == ["tag_a", "tag_b", "tag_c"]
        assert "tags" not in s
    _run(go())


def test_school_with_only_legacy_tags_is_migrated(db):
    async def go():
        await db.schools.insert_one({"school_id": "sch_old", "tags": ["tag_x"]})
        await canonicalise_tag_fields(db)
        s = await db.schools.find_one({"school_id": "sch_old"})
        assert s["tag_ids"] == ["tag_x"]
        assert "tags" not in s
    _run(go())


def test_lead_tags_renamed_to_tag_ids(db):
    async def go():
        await db.leads.insert_one({"lead_id": "lead_1", "tags": ["tag_hot"]})
        await canonicalise_tag_fields(db)
        l = await db.leads.find_one({"lead_id": "lead_1"})
        assert l["tag_ids"] == ["tag_hot"]
        assert "tags" not in l
    _run(go())


def test_contacts_are_left_alone(db):
    async def go():
        await db.contacts.insert_one({"contact_id": "con_1", "tag_ids": ["tag_q"]})
        await canonicalise_tag_fields(db)
        c = await db.contacts.find_one({"contact_id": "con_1"})
        assert c["tag_ids"] == ["tag_q"]
    _run(go())


def test_migration_is_idempotent(db):
    async def go():
        await db.schools.insert_one({"school_id": "sch_i", "tags": ["tag_a"]})
        first = await canonicalise_tag_fields(db)
        second = await canonicalise_tag_fields(db)
        assert first["schools_merged"] == 1
        assert second["schools_merged"] == 0
        assert second["already_clean"] is True
        s = await db.schools.find_one({"school_id": "sch_i"})
        assert s["tag_ids"] == ["tag_a"]
    _run(go())
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd backend && python -m pytest tests/test_tag_canonicalisation.py -q
```

Expected: `ModuleNotFoundError: No module named 'migrations.canonicalise_tag_fields'`.

- [ ] **Step 3: Write the migration**

Create `backend/migrations/canonicalise_tag_fields.py`:

```python
"""Canonicalise the tag array field to `tag_ids` on schools and leads.

Schools accumulated two fields: `tag_ids` written by the CSV importer and
`tags` written by the CRM UI. Neither could see the other's tags. Leads use
`tags` only. Contacts already use `tag_ids` and are left untouched.

Non-destructive: schools union the two arrays rather than picking a winner.
Idempotent: after the first pass no document matches the filter.
"""


async def canonicalise_tag_fields(db) -> dict:
    schools_merged = await _merge_schools(db)
    leads_renamed = await _rename_leads(db)
    return {
        "leads_renamed": leads_renamed,
        "schools_merged": schools_merged,
        "already_clean": (schools_merged == 0 and leads_renamed == 0),
    }


async def _merge_schools(db) -> int:
    q = {"tags": {"$exists": True}}
    n = await db.schools.count_documents(q)
    if not n:
        return 0
    async for doc in db.schools.find(q, {"_id": 1, "tags": 1, "tag_ids": 1}):
        merged = list(dict.fromkeys(
            list(doc.get("tag_ids") or []) + list(doc.get("tags") or [])
        ))
        await db.schools.update_one(
            {"_id": doc["_id"]},
            {"$set": {"tag_ids": merged}, "$unset": {"tags": ""}},
        )
    return n


async def _rename_leads(db) -> int:
    q = {"tags": {"$exists": True}}
    n = await db.leads.count_documents(q)
    if not n:
        return 0
    async for doc in db.leads.find(q, {"_id": 1, "tags": 1, "tag_ids": 1}):
        merged = list(dict.fromkeys(
            list(doc.get("tag_ids") or []) + list(doc.get("tags") or [])
        ))
        await db.leads.update_one(
            {"_id": doc["_id"]},
            {"$set": {"tag_ids": merged}, "$unset": {"tags": ""}},
        )
    return n
```

A per-document loop is used rather than an aggregation pipeline update because
`mongomock_motor` does not implement pipeline-form `update_many`, and the
collections are small (~1,300 schools, ~450 leads).

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd backend && python -m pytest tests/test_tag_canonicalisation.py -q
```

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/migrations/canonicalise_tag_fields.py backend/tests/test_tag_canonicalisation.py
git commit -m "feat(migration): canonicalise tag field to tag_ids on schools and leads

Schools carried both tag_ids (from CSV import) and tags (from the CRM UI), so
tags applied through one path were invisible to the other. Unions both arrays
into tag_ids rather than picking a winner; leads rename tags -> tag_ids.
Idempotent and non-destructive."
```

---

### Task 3: Cut every reader and writer over to `tag_ids`

**Files:**
- Modify: `backend/routes/crm_routes.py` (lines 3887, 3944, 5155, 5180, 5315, 6166 and any further hits)
- Modify: `backend/ensure_indexes.py` (near the existing `contacts.tag_ids` index at lines 65-66)
- Test: `backend/tests/test_tag_canonicalisation.py` (extend)

**Interfaces:**
- Consumes: the migration from Task 2.
- Produces: no code reads or writes `schools.tags` or `leads.tags`.

- [ ] **Step 1: Find every remaining occurrence**

```bash
cd backend && grep -rn '"tags"' routes/crm_routes.py routes/admin_routes.py
cd backend && grep -rn '\$unwind.*tags\|\btags\b' routes/crm_routes.py | grep -v tag_ids | head -40
```

Record the full list before editing. The spec cites 3887, 3944, 5155, 5180,
5315 and 6166, but the grep is authoritative — do not trust the list alone.

- [ ] **Step 2: Write the failing regression test**

Append to `backend/tests/test_tag_canonicalisation.py`:

```python
def test_no_source_file_still_writes_legacy_tags_field():
    """Guard against a reintroduced `tags` write on schools or leads."""
    import pathlib
    import re

    root = pathlib.Path(__file__).resolve().parents[1]
    offenders = []
    for name in ("routes/crm_routes.py", "routes/admin_routes.py"):
        text = (root / name).read_text(encoding="utf-8", errors="ignore")
        for i, line in enumerate(text.splitlines(), 1):
            if re.search(r'["\']tags["\']\s*:', line) and "tag_ids" not in line:
                offenders.append(f"{name}:{i}: {line.strip()}")
            if re.search(r'\$(addToSet|pull)["\']?\s*:\s*\{\s*["\']tags["\']', line):
                offenders.append(f"{name}:{i}: {line.strip()}")
    assert not offenders, "legacy `tags` field still written:\n" + "\n".join(offenders)
```

- [ ] **Step 3: Run it to verify it fails**

```bash
cd backend && python -m pytest tests/test_tag_canonicalisation.py::test_no_source_file_still_writes_legacy_tags_field -q
```

Expected: FAIL listing the `schools.tags` and `leads.tags` write sites.

- [ ] **Step 4: Rename every occurrence**

For each site found in Step 1, change the field name to `tag_ids`. The three
shapes to expect:

```python
# bulk tag (crm_routes.py ~3887)
op = {"$addToSet": {"tag_ids": tag_id}} if action == "add" else {"$pull": {"tag_ids": tag_id}}

# PUT /schools/{id} (crm_routes.py ~3944)
if "tag_ids" in body:
    allowed["tag_ids"] = await _resolve_tags(body["tag_ids"], user["email"])

# facet aggregation (crm_routes.py ~5180)
{"$unwind": "$tag_ids"},
```

Accept `tags` as an inbound request-body alias where a request body is parsed,
so the frontend keeps working unchanged:

```python
    incoming_tags = body.get("tag_ids", body.get("tags"))
    if incoming_tags is not None:
        allowed["tag_ids"] = await _resolve_tags(incoming_tags, user["email"])
```

This is a request-shape alias, not a storage shim — nothing writes `tags` to Mongo.

- [ ] **Step 5: Add the missing indexes**

In `backend/ensure_indexes.py`, alongside the existing `contacts.tag_ids` index:

```python
    await _i(db.schools, [("tag_ids", 1)], name="schools_tag_ids")
    await _i(db.leads, [("tag_ids", 1)], name="leads_tag_ids")
```

Use the file's existing `_i()` non-fatal wrapper — a failing index must never
crash startup.

- [ ] **Step 6: Run the guard test and the CRM suites**

```bash
cd backend && python -m pytest tests/test_tag_canonicalisation.py -q
cd backend && python -m pytest tests/test_crm_schools_leads.py tests/test_crm_360.py tests/test_contacts.py -q
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add backend/routes/crm_routes.py backend/ensure_indexes.py backend/tests/test_tag_canonicalisation.py
git commit -m "refactor(tags): read and write tag_ids everywhere; index schools and leads

Completes the canonicalisation started by the migration. Request bodies still
accept a 'tags' key as an inbound alias so the frontend is unchanged, but
nothing writes the legacy field to Mongo. Adds the missing tag_ids indexes on
schools and leads; only contacts had one."
```

---

### Task 4: School owner field — `owner` → `assigned_to`

Same defect class as the tag split: the CSV importer writes `owner` while the
CRM reads `assigned_to`, so imported schools appear unowned in the UI.

**Files:**
- Create: `backend/migrations/canonicalise_school_owner.py`
- Test: `backend/tests/test_tag_canonicalisation.py` (extend)

> **Ruling R3 (pre-flight scan).** An earlier draft of this task also changed the
> `"owner":` write in `admin_routes.py`. That write lives inside `execute_import`,
> which Task 8 deletes wholesale, so the edit would be removed in the same branch.
> This task therefore ships the **migration only**. Verified: no other code writes
> `schools.owner`, and `/export/schools` already reads
> `doc.get("assigned_to") or doc.get("owner")` (`admin_routes.py:1627`), so the
> migration causes no export regression.

**Interfaces:**
- Consumes: nothing.
- Produces: `async def canonicalise_school_owner(db) -> dict` returning `{"schools_migrated": int}`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_tag_canonicalisation.py`:

```python
def test_school_owner_field_migrated_to_assigned_to(db):
    async def go():
        from migrations.canonicalise_school_owner import canonicalise_school_owner
        await db.schools.insert_one({"school_id": "sch_o1", "owner": "rep@x.com"})
        await db.schools.insert_one({
            "school_id": "sch_o2", "owner": "old@x.com",
            "assigned_to": "current@x.com",
        })
        res = await canonicalise_school_owner(db)

        s1 = await db.schools.find_one({"school_id": "sch_o1"})
        assert s1["assigned_to"] == "rep@x.com"
        assert "owner" not in s1

        s2 = await db.schools.find_one({"school_id": "sch_o2"})
        assert s2["assigned_to"] == "current@x.com", "must not clobber a live owner"
        assert "owner" not in s2

        assert res["schools_migrated"] == 2
        assert (await canonicalise_school_owner(db))["schools_migrated"] == 0
    _run(go())
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd backend && python -m pytest tests/test_tag_canonicalisation.py::test_school_owner_field_migrated_to_assigned_to -q
```

Expected: `ModuleNotFoundError: No module named 'migrations.canonicalise_school_owner'`.

- [ ] **Step 3: Write the migration**

Create `backend/migrations/canonicalise_school_owner.py`:

```python
"""Move `schools.owner` (written by the CSV importer) to `assigned_to`.

The CRM scopes and displays school ownership from `assigned_to`, so imported
schools looked unowned. An existing non-empty `assigned_to` always wins — the
importer's value is only used to fill a gap.
"""


async def canonicalise_school_owner(db) -> dict:
    q = {"owner": {"$exists": True}}
    n = await db.schools.count_documents(q)
    if not n:
        return {"schools_migrated": 0}
    async for doc in db.schools.find(q, {"_id": 1, "owner": 1, "assigned_to": 1}):
        current = (doc.get("assigned_to") or "").strip()
        upd = {"$unset": {"owner": ""}}
        legacy = (doc.get("owner") or "").strip()
        if not current and legacy:
            upd["$set"] = {"assigned_to": legacy}
        await db.schools.update_one({"_id": doc["_id"]}, upd)
    return {"schools_migrated": n}


if __name__ == "__main__":
    import asyncio

    from database import db

    print(asyncio.run(canonicalise_school_owner(db)))
```

The `__main__` block is required, not optional: it is the only committed,
reviewed way to run this against production. Keep `from database import db`
**inside** the guard — at module level it would make the test suite and every
importer open a connection to the live database. Match the style of
`backend/migrations/backfill_module_permissions.py` exactly, and confirm
`cd backend && python -c "import migrations.canonicalise_school_owner"`
imports silently without connecting to anything.

- [ ] **Step 4: Confirm no surviving writer of `schools.owner`**

Per ruling R3 this task does not edit `admin_routes.py`. Verify the assumption
behind that ruling instead:

```bash
cd backend && grep -rn '"owner":' routes/ --include=*.py
```

Every hit must be inside `execute_import` (which Task 8 deletes) or be a read,
not a write. If a writer turns up anywhere else, stop and report it — the
ruling's premise is broken and the migration alone would not hold.

- [ ] **Step 5: Run the tests**

```bash
cd backend && python -m pytest tests/test_tag_canonicalisation.py -q
cd backend && python -m pytest tests/test_csv_export.py tests/test_import_endpoints.py -q
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/migrations/canonicalise_school_owner.py backend/tests/test_tag_canonicalisation.py
git commit -m "fix(schools): migrate legacy owner field to assigned_to

The legacy CSV importer wrote schools.owner while the CRM scopes and displays
from assigned_to, so every imported school appeared unowned. Migration fills the
gap without ever clobbering a live assigned_to. The writer itself is removed by
the import-endpoint deletion, so no code change is needed here."
```

---

### Task 5: Tags and notes in the field registry and the engine

The engine has no tags concept at all, so importing through it leaves
`tag_ids` untouched. `notes` is also missing and currently falls into
`custom_fields` instead of the contact's real column.

**Files:**
- Modify: `backend/field_registry.py` (`SEED_FIELDS`, after line 57)
- Modify: `backend/import_engine.py` (`commit_row` contact section)
- Test: `backend/tests/test_contacts_import_upsert.py` (create)

**Interfaces:**
- Consumes: `_strip_blanks()` from Task 1; `tag_ids` canonical field from Task 3.
- Produces: `parse_tag_cell(raw: str) -> list[str]` in `import_engine`; a `tags`
  and a `notes` entry in `SEED_FIELDS`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_contacts_import_upsert.py`:

```python
"""Tags and notes flow through the import engine onto the contact.

Run with:  cd backend && python -m pytest tests/test_contacts_import_upsert.py -q
"""

import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest

import import_engine as ie

IMPORTER = {"email": "importer@smartshape.in", "name": "Importer"}


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture()
def db():
    from mongomock_motor import AsyncMongoMockClient
    return AsyncMongoMockClient()["smartshape_test"]


def test_parse_tag_cell_accepts_pipes_and_commas():
    assert ie.parse_tag_cell("A|B|C") == ["A", "B", "C"]
    assert ie.parse_tag_cell("A, B, C") == ["A", "B", "C"]
    assert ie.parse_tag_cell(" A | B , C ") == ["A", "B", "C"]
    assert ie.parse_tag_cell("A||B") == ["A", "B"]
    assert ie.parse_tag_cell("") == []
    assert ie.parse_tag_cell(None) == []
    assert ie.parse_tag_cell("A|A|B") == ["A", "B"]


def test_tags_cell_replaces_contact_tag_ids(db):
    async def go():
        await db.tags.insert_one({"tag_id": "tag_hot", "name": "Hot Lead"})
        await db.schools.insert_one({
            "school_id": "sch_t", "school_name": "Tag School", "is_deleted": False})
        await db.contacts.insert_one({
            "contact_id": "con_t", "school_id": "sch_t",
            "name": "Tagged Person", "tag_ids": ["tag_stale"]})

        row = {"school_id": "sch_t", "contact_id": "con_t",
               "name": "Tagged Person", "tags": "Hot Lead"}
        await ie.commit_row(db, row, IMPORTER, create_leads=False)

        c = await db.contacts.find_one({"contact_id": "con_t"})
        assert c["tag_ids"] == ["tag_hot"], "a non-blank tags cell is authoritative"
    _run(go())


def test_blank_tags_cell_leaves_existing_tags(db):
    async def go():
        await db.schools.insert_one({
            "school_id": "sch_t", "school_name": "Tag School", "is_deleted": False})
        await db.contacts.insert_one({
            "contact_id": "con_t", "school_id": "sch_t",
            "name": "Tagged Person", "tag_ids": ["tag_keep"]})

        row = {"school_id": "sch_t", "contact_id": "con_t",
               "name": "Tagged Person", "tags": ""}
        await ie.commit_row(db, row, IMPORTER, create_leads=False)

        c = await db.contacts.find_one({"contact_id": "con_t"})
        assert c["tag_ids"] == ["tag_keep"], "blank tags cell must not clear tags (D1)"
    _run(go())


def test_unknown_tag_name_is_created(db):
    async def go():
        await db.schools.insert_one({
            "school_id": "sch_t", "school_name": "Tag School", "is_deleted": False})
        row = {"school_id": "sch_t", "name": "New Person", "tags": "Brand New Tag"}
        await ie.commit_row(db, row, IMPORTER, create_leads=False)

        made = await db.tags.find_one({"name": "Brand New Tag"})
        assert made is not None, "an unseen tag name should be created"
        c = await db.contacts.find_one({"name": "New Person"})
        assert c["tag_ids"] == [made["tag_id"]]
    _run(go())


def test_notes_writes_to_native_column_not_custom_fields(db):
    async def go():
        await db.schools.insert_one({
            "school_id": "sch_n", "school_name": "Note School", "is_deleted": False})
        row = {"school_id": "sch_n", "name": "Noted Person",
               "notes": "Met at expo 2026"}
        await ie.commit_row(db, row, IMPORTER, create_leads=False)

        c = await db.contacts.find_one({"name": "Noted Person"})
        assert c["notes"] == "Met at expo 2026"
        assert "notes" not in (c.get("custom_fields") or {})
    _run(go())
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd backend && python -m pytest tests/test_contacts_import_upsert.py -q
```

Expected: `AttributeError: module 'import_engine' has no attribute 'parse_tag_cell'`
and the tag/notes assertions fail.

- [ ] **Step 3: Add the registry entries**

In `backend/field_registry.py`, add to `SEED_FIELDS` after the `anniversary`
entry (line 57):

```python
    ("notes",              "Notes",                              "contact", "text",   "notes",                "Contact", ["notes", "note", "remarks"]),
    ("tags",               "Tags",                               "contact", "text",   None,                   "Contact", ["tags", "tag", "labels"]),
```

`tags` deliberately has `maps_to=None`: it is not a plain column write, so
`commit_row` handles it explicitly rather than letting `split_values` copy it.
Because `maps_to` is None, `split_values` routes it to
`custom["contact"]["tags"]`, which is where `commit_row` reads it from and then
removes.

- [ ] **Step 4: Add the tag cell parser**

In `backend/import_engine.py`, after `_strip_blanks()`:

```python
def parse_tag_cell(raw) -> list:
    """Split a spreadsheet tag cell into tag names.

    Accepts both separators seen in the wild: exports write pipe-joined
    ("A|B|C") while people type comma-separated ("A, B, C"). Order-preserving
    and de-duplicated; blank segments are dropped.
    """
    s = str(raw or "").strip()
    if not s:
        return []
    parts = [p.strip() for p in _re.split(r"[|,]", s)]
    return list(dict.fromkeys([p for p in parts if p]))
```

- [ ] **Step 5: Apply tags in `commit_row`**

In `commit_row`, immediately after the contact upsert block writes `cid`
(after the `if existing: ... else: ...` that sets `cid`), add:

```python
        # ---- tags: a non-blank cell is authoritative; blank leaves them alone ----
        tag_cell = parts["custom"]["contact"].pop("tags", "")
        tag_names = parse_tag_cell(tag_cell)
        if cid and tag_names:
            from routes.crm_routes import _resolve_tags
            resolved = await _resolve_tags(tag_names, user_email)
            await db.contacts.update_one(
                {"contact_id": cid}, {"$set": {"tag_ids": resolved}})
```

`_resolve_tags` is imported lazily inside the function, matching the existing
`_resolve_import_owner` pattern at line 412, to avoid a module load-order cycle.

The `.pop()` must run before the contact `$set` is built so the raw tag string
never lands in `custom_fields`. Move the `tag_cell = ...` line above the
`cvals = _strip_blanks(...)` assignment from Task 1, keeping the resolution
call after `cid` exists.

- [ ] **Step 6: Run the tests**

```bash
cd backend && python -m pytest tests/test_contacts_import_upsert.py -q
cd backend && python -m pytest tests/test_import_mapping.py tests/test_master_import_e2e.py -q
```

Expected: all pass. `test_import_mapping.py` covers `propose_mapping` and will
catch a malformed `SEED_FIELDS` tuple.

- [ ] **Step 7: Commit**

```bash
git add backend/field_registry.py backend/import_engine.py backend/tests/test_contacts_import_upsert.py
git commit -m "feat(import): tags and notes flow through the engine

The engine had no tags concept, so importing left tag_ids untouched, and notes
fell into custom_fields instead of the contact's real column. Tag cells accept
both pipe and comma separators, fixing the round-trip where a pipe-joined
export re-imported as one tag literally named 'A|B|C'. A blank tags cell leaves
existing tags alone (D1); a non-blank cell is authoritative."
```

---

### Task 6: Contacts-only rows must not mint a school

`commit_row` is school-anchored: it resolves or creates a school before
touching the contact. A contacts CSV row with no school identity would create
a junk school named after nothing.

**Files:**
- Modify: `backend/import_engine.py` (`commit_row` signature and school branch)
- Test: `backend/tests/test_contacts_import_upsert.py` (extend)

**Interfaces:**
- Consumes: `_strip_blanks()` from Task 1.
- Produces: `commit_row(db, row_keyed, user, create_leads, allow_school_create=True)` —
  the new parameter defaults to the current behaviour so the existing caller
  `POST /mail-runs/import` is unaffected.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_contacts_import_upsert.py`:

```python
def test_contacts_only_row_creates_no_school(db):
    async def go():
        row = {"contact_id": "con_solo", "name": "Solo Person",
               "phone": "9998887776"}
        res = await ie.commit_row(db, row, IMPORTER, create_leads=False,
                                  allow_school_create=False)
        assert await db.schools.count_documents({}) == 0, "no junk school"
        assert res["school_id"] is None
        c = await db.contacts.find_one({"contact_id": "con_solo"})
        assert c is not None
        assert c.get("school_id") in (None, "")
    _run(go())


def test_contacts_only_update_keeps_existing_school_link(db):
    async def go():
        await db.schools.insert_one({
            "school_id": "sch_link", "school_name": "Linked School",
            "is_deleted": False})
        await db.contacts.insert_one({
            "contact_id": "con_link", "school_id": "sch_link",
            "name": "Linked Person", "designation": "Principal"})

        row = {"contact_id": "con_link", "name": "Linked Person",
               "designation": "Director"}
        await ie.commit_row(db, row, IMPORTER, create_leads=False,
                            allow_school_create=False)

        c = await db.contacts.find_one({"contact_id": "con_link"})
        assert c["school_id"] == "sch_link", "must not unlink the parent school"
        assert c["designation"] == "Director"
    _run(go())


def test_default_still_creates_a_school(db):
    async def go():
        row = {"school_name": "Fresh School", "name": "Fresh Person"}
        res = await ie.commit_row(db, row, IMPORTER, create_leads=False)
        assert res["school_id"] is not None
        assert await db.schools.count_documents({}) == 1
    _run(go())
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd backend && python -m pytest tests/test_contacts_import_upsert.py -q
```

Expected: `TypeError: commit_row() got an unexpected keyword argument 'allow_school_create'`.

- [ ] **Step 3: Add the parameter and the guard**

Change the signature (line 433):

```python
async def commit_row(db, row_keyed: dict, user: dict, create_leads: bool,
                     allow_school_create: bool = True) -> dict:
```

Add to the docstring's safety rules:

```
    - school: when allow_school_create is False and the row carries no school
      identity at all, no school is resolved or created; the contact is upserted
      with school_id left as-is (never overwritten with None).
```

Replace the school resolution block (currently lines 474-520, from
`res = await resolve_school(...)` through the school `update_one`) with:

```python
    # --- P2.5 school resolution (id → name+city → phone_norm) ---
    has_school_identity = bool(
        (row_keyed.get("school_id") or "").strip()
        or (parts["school"].get("school_name") or "").strip()
        or sch_phone_raw
    )
    if not allow_school_create and not has_school_identity:
        res = {"action": "skip_school", "school_id": None, "candidates": 0}
    else:
        res = await resolve_school(db, row_keyed)

    if res["action"] == "needs_review":
        return {"action": "needs_review", "school_id": None, "contact_id": None,
                "lead_id": None, "warnings": warnings}

    sid = res["school_id"]

    if res["action"] == "create":
        sid = valid_supplied_id(row_keyed.get("school_id")) or f"sch_{_uuid.uuid4().hex[:12]}"
        school_vals = dict(parts["school"])
        if sch_phone_raw or "phone" in school_vals:
            school_vals["phone"] = sch_phone_raw
        doc = {
            "school_id": sid,
            "is_deleted": False,
            "created_by": user_email,
            "created_at": now,
            "import_date": now,
            "custom_fields": parts["custom"]["school"],
            **school_vals,
        }
        if sch_phone_norm:
            doc["phone_norm"] = sch_phone_norm
        doc.update(assign_set)
        await db.schools.insert_one(doc)
    elif res["action"] == "update":
        # Snapshot existing doc before overwriting (safety-critical — never skip)
        old = await db.schools.find_one({"school_id": sid})
        await db.audit_backup.insert_one({
            "kind": "school_pre_import",
            "school_id": sid,
            "snapshot": {k: v for k, v in (old or {}).items() if k != "_id"},
            "at": now,
            "by": user_email,
        })
        upd: dict = _strip_blanks(parts["school"])
        if sch_phone_raw:
            upd["phone"] = sch_phone_raw
        for k, v in _strip_blanks(parts["custom"]["school"]).items():
            upd[f"custom_fields.{k}"] = v
        upd["last_activity_date"] = now
        upd["import_date"] = now
        if sch_phone_norm:
            upd["phone_norm"] = sch_phone_norm
        upd.update(assign_set)
        await db.schools.update_one({"school_id": sid}, {"$set": upd})
    # action == "skip_school": no school is resolved, created or touched
```

The create branch is byte-identical to the original; only the previous bare
`else:` becomes `elif res["action"] == "update":`, so `skip_school` falls
through touching nothing. The update branch body is exactly what Task 1 left in
place — reproduced here in full so this task can be implemented without reading
Task 1's diff.

Because `cdoc` is built with `_strip_blanks` (Task 1) and `sid` is `None` here,
`school_id` is dropped from the `$set` automatically — an existing contact keeps
its school link. No extra guard is needed, and
`test_contacts_only_update_keeps_existing_school_link` proves it.

- [ ] **Step 4: Run the tests**

```bash
cd backend && python -m pytest tests/test_contacts_import_upsert.py tests/test_import_blank_safety.py -q
cd backend && python -m pytest tests/test_master_import_e2e.py tests/test_import_resolve.py -q
```

Expected: all pass. `test_master_import_e2e.py` proves the default-`True`
behaviour is unchanged for the Import Center.

- [ ] **Step 5: Commit**

```bash
git add backend/import_engine.py backend/tests/test_contacts_import_upsert.py
git commit -m "feat(import): allow_school_create guard for contacts-only rows

commit_row is school-anchored and would mint a junk school for a contacts CSV
row carrying no school identity. New parameter defaults to True so the Import
Center path is unchanged; the contacts import passes False."
```

---

### Task 7: Repoint `POST /contacts/import` at the engine

**Files:**
- Modify: `backend/routes/crm_routes.py:4859-4956` (replace the handler body)
- Test: `backend/tests/test_contacts_import_upsert.py` (extend)

**Interfaces:**
- Consumes: `commit_row(..., allow_school_create=False)` from Task 6;
  `parse_tag_cell` from Task 5; `ie.parse_table(filename, content) -> (headers, rows)`;
  `ie.propose_mapping(db, headers) -> list[dict]`;
  `_key_rows(headers, rows, mapping) -> list[dict]` from `routes.dynamic_import_routes`.
- Produces: response shape
  `{"created": int, "updated": int, "skipped": int, "errors": list[str], "error_count": int}`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_contacts_import_upsert.py`:

```python
def _csv_bytes(header: str, rows: list) -> bytes:
    return ("\n".join([header] + rows)).encode("utf-8")


def test_round_trip_updates_instead_of_duplicating(db):
    """The headline case: export -> edit -> re-upload updates the record."""
    async def go():
        await db.schools.insert_one({
            "school_id": "sch_rt", "school_name": "Round Trip School",
            "is_deleted": False})
        await db.contacts.insert_one({
            "contact_id": "con_rt", "school_id": "sch_rt",
            "name": "Alka Kapur", "phone": "1141427627",
            "email": "alka@example.com", "designation": "Principal"})

        # Exactly the export's column order, with phone and email left blank
        # and designation edited — the owner's real workflow.
        row = {
            "contact_id": "con_rt", "name": "Alka Kapur", "phone": "",
            "email": "", "school_name": "Round Trip School",
            "school_id": "sch_rt", "designation": "Director",
        }
        await ie.commit_row(db, row, IMPORTER, create_leads=False,
                            allow_school_create=False)

        assert await db.contacts.count_documents({}) == 1, "must update, not duplicate"
        c = await db.contacts.find_one({"contact_id": "con_rt"})
        assert c["designation"] == "Director"
        assert c["email"] == "alka@example.com"
        assert c["phone"] == "1141427627"
    _run(go())


def test_supplied_contact_id_is_honoured_on_create(db):
    async def go():
        await db.schools.insert_one({
            "school_id": "sch_sup", "school_name": "Supplied School",
            "is_deleted": False})
        row = {"contact_id": "con_chosen", "school_id": "sch_sup",
               "name": "Chosen Id"}
        await ie.commit_row(db, row, IMPORTER, create_leads=False,
                            allow_school_create=False)
        assert await db.contacts.find_one({"contact_id": "con_chosen"}) is not None
    _run(go())


def test_row_with_name_but_no_phone_is_imported(db):
    async def go():
        await db.schools.insert_one({
            "school_id": "sch_np", "school_name": "No Phone School",
            "is_deleted": False})
        row = {"school_id": "sch_np", "name": "Harsimran Kaur Kapany"}
        await ie.commit_row(db, row, IMPORTER, create_leads=False,
                            allow_school_create=False)
        c = await db.contacts.find_one({"name": "Harsimran Kaur Kapany"})
        assert c is not None, "most exported rows have no phone and must still import"
    _run(go())


# The exact header row emitted by GET /export/contacts (admin_routes.py:1569).
EXPORT_HEADERS = [
    "contact_id", "name", "phone", "email", "company", "school_id",
    "designation", "source", "notes", "birthday", "assigned_to", "tags",
    "status", "converted", "lead_id", "created_at",
]


def test_export_headers_map_without_surprises(db):
    """Pin the mapping of our own export's columns.

    propose_mapping falls back to fuzzy matching at ratio >= 0.78, so an
    unmapped column can silently bind to an unrelated field. This asserts the
    columns we care about map correctly and that the ones we do not handle stay
    unmapped rather than fuzzing onto something else.
    """
    async def go():
        from field_registry import seed_field_definitions
        await seed_field_definitions(db)
        mapping = await ie.propose_mapping(db, EXPORT_HEADERS)
        by_source = {m["source"]: m["key"] for m in mapping}

        assert by_source["contact_id"] == "contact_id"
        assert by_source["school_id"] == "school_id"
        assert by_source["lead_id"] == "lead_id"
        assert by_source["name"] == "name"
        assert by_source["email"] == "email"
        assert by_source["phone"] == "phone"
        assert by_source["company"] == "school_name"
        assert by_source["designation"] == "designation"
        assert by_source["notes"] == "notes"
        assert by_source["tags"] == "tags"
        assert by_source["assigned_to"] == "assign_to"

        # Columns with no field definition must not fuzzy-bind to anything.
        for col in ("status", "converted", "created_at"):
            assert by_source[col] is None, (
                f"export column {col!r} fuzzy-mapped to {by_source[col]!r}; "
                "add an explicit field definition or tighten the alias table"
            )
    _run(go())
```

If the last assertion fails, do **not** loosen it. A column binding to the
wrong field silently corrupts data on every import; either add a real field
definition for that column or give the colliding field a more specific alias.

- [ ] **Step 2: Run it to verify it fails**

```bash
cd backend && python -m pytest tests/test_contacts_import_upsert.py -q
```

Expected: the round-trip test fails — the old handler is not yet replaced, and
these tests exercise `commit_row` directly, so they should pass once Tasks 5-6
are in. Run them to confirm they are green **before** editing the route; they
are the contract the route must preserve.

- [ ] **Step 3: Replace the handler body**

In `backend/routes/crm_routes.py`, replace the body of `import_contacts_csv`
(lines 4866-4956, keeping the decorator and signature at 4859-4865) with:

```python
    if request:
        user = await get_current_user(request)
    else:
        user = {"email": "import", "name": "Import"}
    tag_id_list = [t.strip() for t in (tag_ids or "").split(",") if t.strip()]
    extra_note = (global_notes or "").strip()

    content = await file.read()
    try:
        headers, rows = ie.parse_table(file.filename or "upload.csv", content)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read the file: {e}")
    if not rows:
        raise HTTPException(status_code=400, detail="The file has no data rows.")
    mapping = await ie.propose_mapping(db, headers)
    keyed = _key_rows(headers, rows, mapping)

    created = updated = skipped = 0
    errors: list = []

    for idx, row_keyed in enumerate(keyed, start=2):   # row 1 is the header
        try:
            if extra_note and not (row_keyed.get("notes") or "").strip():
                row_keyed["notes"] = extra_note

            if not (ie.valid_supplied_id(row_keyed.get("contact_id"))
                    or (row_keyed.get("name") or "").strip()):
                skipped += 1
                continue

            res = await ie.commit_row(db, row_keyed, user, create_leads=False,
                                      allow_school_create=False)
            if res["action"] == "needs_review":
                skipped += 1
                errors.append(f"Row {idx}: ambiguous school, needs review")
                continue

            cid = res.get("contact_id")
            if cid and tag_id_list:
                await db.contacts.update_one(
                    {"contact_id": cid},
                    {"$addToSet": {"tag_ids": {"$each": tag_id_list}}})

            if res["action"] == "create":
                created += 1
            else:
                updated += 1
        except Exception as e:
            errors.append(f"Row {idx}: {e}")

    total_errors = len(errors)
    return {"created": created, "updated": updated, "skipped": skipped,
            "errors": errors[:50], "error_count": total_errors}
```

Add the two imports at the top of the handler body, matching exactly how
`POST /mail-runs/import` does it at `crm_routes.py:875-876` (both are local
imports there, to avoid a module load-order cycle):

```python
    import import_engine as ie
    from routes.dynamic_import_routes import _key_rows
```

`parse_table` returns `(headers, rows)` in that order — not `(rows, headers)`.
`propose_mapping` returns a **list** of `{source, field_id, key, confidence}`
dicts, not a dict, which is why `_key_rows` exists rather than a direct lookup.
`propose_mapping` already emits `contact_id` / `school_id` / `lead_id` as
high-confidence control keys (`import_engine.py:266-271`), so the ID columns
survive `_key_rows` and reach `commit_row`. That is what makes the round-trip
match by ID.

Two behaviours this deliberately preserves: the request shape (`file`,
`tag_ids`, `global_notes`) is unchanged so the dialog needs no edit, and the
dialog's chip selection is applied with `$addToSet` **after** `commit_row`, so
it adds to whatever the CSV's tags cell resolved rather than replacing it —
matching the precedence table in the spec.

- [ ] **Step 4: Verify the response contract change is handled by the UI**

```bash
cd frontend && grep -rn 'duplicates' src/hooks/useLeadsCRM.js src/components/crm/ src/pages/admin/LeadsCRM.js
```

Wherever the old `duplicates` count is rendered, show the new counts instead:

```javascript
`${r.created} created, ${r.updated} updated, ${r.skipped} skipped`
```

Reporting `updated` is the point of this work — the old UI said "duplicates"
for records it had silently refused to update, which is why the import
appeared to succeed while nothing changed.

- [ ] **Step 5: Run the tests**

```bash
cd backend && python -m pytest tests/test_contacts_import_upsert.py tests/test_contacts.py -q
cd backend && python -m pytest tests/ -q -k "import"
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/routes/crm_routes.py frontend/src/hooks/useLeadsCRM.js backend/tests/test_contacts_import_upsert.py
git commit -m "feat(import): contacts CSV import upserts by contact_id

POST /contacts/import was insert-only: it matched on name+phone, counted a hit
as a duplicate and skipped it, and always minted a fresh con_ id while ignoring
the contact_id column its own export writes. It now routes through
import_engine.commit_row, which matches on the supplied id first.

Validation relaxes from name AND phone to contact_id OR name — most rows in a
real export have no phone and were being rejected outright. Response now
reports created/updated/skipped instead of the misleading 'duplicates'."
```

---

### Task 8: Delete the orphaned insert-only import endpoints

`POST /import/preview` and `/import/execute` are insert-only and their frontend
caller is already dead: `ImportCenter.js` calls only `importSystem.logs()`.
Leaving three CSV importers in place is what caused a fix to land on the wrong
one.

**Files:**
- Modify: `backend/routes/admin_routes.py` (delete `_parse_tag_names`,
  `_resolve_tag_ids`, `preview_import`, `execute_import`)
- Modify: `frontend/src/lib/api.js:915-922` (delete `importSystem.preview/execute`)
- Delete: `backend/tests/test_csv_header_normalization.py`

> **Rulings R1, R2, R4 (pre-flight scan).**
> **R1** — `_normalize_csv_headers` does **not** exist on this branch. It lived
> only in an orphaned commit that was never merged. Do not look for it; delete
> only what Step 1's grep actually finds.
> **R2** — line numbers cited anywhere in this task were read on that orphaned
> commit and are ~79 lines too high. Verified positions on this branch:
> `preview_import` **1040**, `_parse_tag_names` **1091**, `_resolve_tag_ids`
> **1110**, `execute_import` **1150**, and `execute_import` runs to just before
> `/import/logs` at **1349**. Locate by symbol, not by number.
> **R4** — `backend/tests/test_csv_header_normalization.py` is present on disk
> but **untracked**. Use `rm`, not `git rm`, or the task fails on a git error.

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. This task only removes code.

- [ ] **Step 1: Confirm nothing still calls them**

```bash
cd frontend && grep -rn 'importSystem' src/ | grep -v node_modules
cd backend && grep -rn '_normalize_csv_headers\|_parse_tag_names\|_resolve_tag_ids' --include=*.py .
```

Expected: the only `importSystem` hits are the definition in `api.js` and
`ImportCenter.js` calling `.logs()`. If anything else appears, stop and report
it rather than deleting.

- [ ] **Step 2: Delete the backend endpoints and helpers**

Remove from `backend/routes/admin_routes.py`, locating each by symbol:
- `preview_import` (~1040) and its `@router.post("/import/preview")` decorator
- `_parse_tag_names` (~1091) and `_resolve_tag_ids` (~1110)
- `execute_import` (~1150) and its `@router.post("/import/execute")` decorator,
  through to the end of its body — it ends just before
  `@router.get("/import/logs")` at ~1349

Do not search for `_normalize_csv_headers`; per ruling R1 it does not exist on
this branch.

While here, fix the now-stale comment in `export_schools` (~1625) that reads
"`owner` is what the legacy CSV importer wrote (see execute_import above)" —
`execute_import` no longer exists. The `doc.get("assigned_to") or doc.get("owner")`
fallback itself stays: it still serves rows not yet touched by the Task 4
migration.

Keep `importSystem.logs()`'s endpoint and everything under `/export/*` — the
export path is still live and is what produces the round-trip file.

- [ ] **Step 3: Delete the orphaned client methods**

In `frontend/src/lib/api.js`, remove the `preview` and `execute` methods from
the `importSystem` object (lines 915-922), keeping `logs`.

- [ ] **Step 4: Delete the superseded test file**

```bash
rm backend/tests/test_csv_header_normalization.py
```

Use plain `rm`: per ruling R4 the file is untracked on this branch, so `git rm`
would abort with "did not match any files".

It tested `_normalize_csv_headers`, which does not exist here. The engine's
`field_registry.normalize_header` plus its alias table supersede it and are
covered by `tests/test_import_mapping.py`.

- [ ] **Step 5: Verify the app still boots and the suite is green**

```bash
cd backend && python -c "import main; print('import ok')"
cd backend && python -m pytest tests/test_import_blank_safety.py tests/test_tag_canonicalisation.py \
    tests/test_contacts_import_upsert.py tests/test_import_safety.py tests/test_import_resolve.py \
    tests/test_import_mapping.py tests/test_master_import_e2e.py tests/test_import_clean.py \
    tests/test_contacts.py tests/test_csv_export.py -q
```

Expected: `import ok`, and no collection errors or failures.

**Do not run the bare `pytest tests/` here.** `backend/.env` points `MONGO_URL`
at the production MongoDB Atlas cluster, and `database.py:5` calls
`load_dotenv('.env')` — so as soon as any test imports `database`, that URL is
in `os.environ` for every test that follows. `tests/test_import_entry.py:49`
then builds a real `AsyncIOMotorClient` from it.

A name guard at `test_import_entry.py:51` (`assert d.name.endswith("_test")`)
does stop it writing to the production *database*, so this is not a
data-corruption risk. But it still opens a connection to the production
*cluster* and creates a scratch database there, and it is why several suites
appear to "fail" locally when they are really just refusing to run. Keep the
verification list explicit.

- [ ] **Step 6: Commit**

```bash
git add -u backend/routes/admin_routes.py frontend/src/lib/api.js backend/tests/
git commit -m "chore(import): delete the orphaned insert-only import endpoints

/import/preview and /import/execute were insert-only and their frontend caller
was already dead — ImportCenter only calls logs(). Three parallel CSV importers
is why a fix could land on one path and leave the others broken. This leaves
two: the engine for CRM entities, and dies for inventory.

_normalize_csv_headers is superseded by field_registry.normalize_header and its
alias table, so its test file goes with it."
```

---

## Deployment

After Task 8 passes, deploy per the repo's mechanism (`origin/main` auto-deploys
via a VPS timer, ~1-2 minutes):

1. **Take an Atlas snapshot before running any migration.** Both migrations are
   non-destructive by design, but they rewrite fields on every school and lead.
2. Run the migrations against production, in this order:
   ```bash
   cd backend && python -m migrations.canonicalise_tag_fields
   cd backend && python -m migrations.canonicalise_school_owner
   ```
   Each prints its result dict. Both are idempotent — a second run reports zero
   changes, so re-running after an interruption is safe.

   Do **not** invoke these with an inline `python -c`: on this platform that
   mangles Mongo `$` operators, which is exactly the failure you cannot afford
   on a migration whose bad outcome is silent, permanent tag loss. Both modules
   carry an `if __name__ == "__main__":` runner for this reason.
3. **Rebuild the tag indexes, and drop the orphaned ones.** This step is
   mandatory and easy to forget: `ensure_indexes.py` is a manual script — it is
   invoked by nothing, not `connect_db()`, not any Dockerfile, compose file or
   deploy script. Without it the new `tag_ids` indexes never exist in
   production and every tag-filtered query collscans.

   ```bash
   cd backend && python ensure_indexes.py --yes-production
   ```

   Then drop the two indexes the rename orphaned. They now index a field that
   no longer exists, costing a write on every lead and school update:

   ```javascript
   db.leads.dropIndex("tags_1_stage_1")
   db.schools.dropIndex("tags_1_school_name_1")
   ```

   Verify with `db.leads.getIndexes()` that `tag_ids_1_stage_1` exists and
   `tags_1_stage_1` is gone.

   Deliberately NOT done: wiring index creation into application startup. That
   is the obvious fix, but this repo has already taken a production outage from
   a startup-time index failure (a unique index over duplicate data crashed
   `connect_db()`), so it trades a small performance gap for an availability
   risk. Revisit separately, not inside this plan.

4. Merge `feat/crm-grid-upsert` into `main` and push. Verify the deploy by
   bundle content, not by timestamp.
5. Smoke test the real workflow: export contacts, edit one designation and one
   tag cell in Excel, re-upload, confirm the dialog reports `updated` and the
   record changed while its blank columns kept their values.

## Rollback

Tasks 1, 5, 6, 7 and 8 are code-only: revert the commits. Any records already
correctly updated by an ID-matched import stay updated, which is the desired
outcome.

Tasks 2, 3 and 4 involve migrations. Because both union rather than overwrite,
no data is destroyed in either direction, but reverting the code without
reverting the data would leave the CRM reading `tags` on documents that now
only have `tag_ids`. If a revert is needed after the migration has run, restore
from the Atlas snapshot taken in Deployment step 1.
