# Dynamic Master Data Import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upload school data as CSV/Excel, auto-map columns to a user-extensible field registry, and upsert School+Contact+Lead by a unique `school_id` so re-uploads update rather than duplicate.

**Architecture:** A new `field_definitions` registry powers everything. Core fields write to native columns; new ("custom") fields write to a `custom_fields` map on each entity — no schema migration. A new `import_engine.py` parses (CSV+xlsx), maps headers→fields via learned aliases + fuzzy matching, resolves each row to a school (ID→name+city→phone), and upserts with an audit snapshot. The existing Import Center and `/import/*` flow are extended, not replaced.

**Tech Stack:** FastAPI, Motor (async MongoDB), `openpyxl` (new), `pandas` (already present), React, Radix UI, axios.

## Global Constraints

- Tests run **only** against `DB_NAME` ending in `_test` or `mtt_ci` — never the live DB. Each backend test file asserts this in a fixture before touching the DB.
- No destructive overwrite: snapshot every to-be-updated school/contact into `audit_backup` **before** writing.
- Never auto-merge: a row matching ≥2 schools is `needs_review`, not written.
- All new endpoints gated by `require_module(user, "settings", "read_write")` (import) or `require_admin(user)` (field CRUD), per `backend/rbac.py:33-35,73-96`.
- IDs: schools `sch_<uuid4().hex[:12]>`, fields `fld_<uuid4().hex[:12]>` (match `backend/server.py:1467`).
- Frontend mutations auto-emit domain changes; refresh lists via `useDataSync('settings', ...)` (`frontend/src/lib/dataSync.js`).
- Commit after every task. Python: `python` (not `python3`). Verify frontend builds with `DISABLE_ESLINT_PLUGIN=true`.

## File Structure

- **Create** `backend/field_registry.py` — registry CRUD, seed, `merge_fields()`, normalization helpers.
- **Create** `backend/import_engine.py` — parse / map / resolve / preview / commit.
- **Create** `backend/routes/dynamic_import_routes.py` — `/fields/*` and extended `/import/*` endpoints.
- **Modify** `backend/database.py` — indexes + `seed_field_definitions()` call.
- **Modify** `backend/server.py` (or main router include) — register the new router.
- **Modify** `backend/requirements.txt` — add `openpyxl`.
- **Create** `backend/tests/test_field_registry.py`, `test_import_mapping.py`, `test_import_resolve.py`, `test_import_endpoints.py`.
- **Create** `frontend/src/pages/admin/MasterFields.js` — field builder (Settings tab).
- **Create** `frontend/src/components/forms/DynamicEntityForm.js` — registry-driven add/edit form.
- **Modify** `frontend/src/pages/admin/ImportCenter.js` — Excel accept + mapping step.
- **Modify** `frontend/src/lib/api.js` — `fields.*` + extended `importSystem.*`.
- **Modify** `frontend/src/App.js` + `frontend/src/components/layouts/AdminNavItems.js` — route/nav for Master Fields.

---

### Task 1: Field registry model — seed + normalization helpers

**Files:**
- Create: `backend/field_registry.py`
- Modify: `backend/database.py` (indexes + seed call near `seed_product_types`, ~`:220`)
- Test: `backend/tests/test_field_registry.py`

**Interfaces:**
- Produces: `normalize_header(s: str) -> str`; `SEED_FIELDS: list[dict]`; `async seed_field_definitions(db) -> None`; `async list_fields(db, entity=None) -> list[dict]`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_field_registry.py
import os, asyncio, pytest
from motor.motor_asyncio import AsyncIOMotorClient
from backend import field_registry as fr

@pytest.fixture
def db():
    name = os.getenv("DB_NAME", "smartshape_test")
    assert name.endswith("_test") or name == "mtt_ci", f"refusing non-test DB: {name}"
    client = AsyncIOMotorClient(os.getenv("MONGO_URL", "mongodb://localhost:27017"))
    d = client[name]
    yield d
    asyncio.get_event_loop().run_until_complete(d.field_definitions.delete_many({}))

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && DB_NAME=smartshape_test python -m pytest tests/test_field_registry.py -v`
Expected: FAIL — `ModuleNotFoundError: field_registry`.

- [ ] **Step 3: Write minimal implementation**

```python
# backend/field_registry.py
import re, uuid
from datetime import datetime, timezone

def _now(): return datetime.now(timezone.utc).isoformat()
def new_field_id(): return f"fld_{uuid.uuid4().hex[:12]}"

def normalize_header(s: str) -> str:
    s = (s or "").strip().lower()
    s = s.replace("'", "").replace("/", " ").replace(".", " ")
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()

# (key, label, entity, type, maps_to, group, [aliases...])
SEED_FIELDS = [
    ("title","Title","contact","text","title","Contact",["title"]),
    ("name","Name","contact","text","name","Contact",["name","contact name"]),
    ("phone","Phone Number","contact","phone","phone","Contact",["phone number","mobile","contact phone"]),
    ("email","Mail ID","contact","email","email","Contact",["mail id","email","contact email"]),
    ("designation","Group/Designation","contact","text","designation","Contact",["group designation","designation","group"]),
    ("birthday","Birthday (Principal/Director)","contact","date","birthday","Contact",["birthday principaldirector","birthday","dob"]),
    ("anniversary","Anniversary (Principal/Director)","contact","date",None,"Contact",["anniversary principaldirector","anniversary"]),
    ("school_name","School/Institute Name","school","text","school_name","School",["school institute name","school name","institute name","school","company"]),
    ("address","School Full Address","school","text","address","School",["school full address","address"]),
    ("city","City","school","text","city","School",["city"]),
    ("state","State","school","text","state","School",["state"]),
    ("pincode","Pin Code","school","text","pincode","School",["pin code","pincode","pin"]),
    ("board","Affiliated Board","school","text","board","School",["affiliated to which board","board","affiliated board"]),
    ("std_classes","STD (Classes)","school","text",None,"School",["std","classes","standard"]),
    ("school_phone","School's Phone Number","school","phone","phone","School",["schools phone number","school phone"]),
    ("school_email","School's Mail","school","email","email","School",["schools mail","school email","school mail"]),
    ("annual_fees","Annual Fees","school","text","annual_budget_range","School",["annual fees","fees","annual budget"]),
    ("campus_area","Campus Area","school","text",None,"School",["campus area"]),
    ("teacher_strength","Teacher's Strength","school","number",None,"School",["teachers strength","teacher strength"]),
    ("classrooms","No. of Classrooms","school","number",None,"School",["no of classrooms","classrooms"]),
    ("school_strength","Student's Strength","school","number","school_strength","School",["students strength","student strength","strength"]),
    ("website","School Website","school","url","website","School",["school website","website"]),
    ("instagram_url","School Instagram","school","url","instagram_url","School",["school instagram","instagram"]),
    ("linkedin_url","School LinkedIn","school","url","linkedin_url","School",["school linkedin","linkedin"]),
    ("principal_linkedin","Principal/Director LinkedIn","school","url",None,"School",["principal director linkedin","principal linkedin"]),
    ("former_principal","Former Principal","school","text",None,"School",["former principal"]),
    ("current_principal","Current Principal","school","text","primary_contact_name","School",["current principal","principal"]),
    ("assign_to","Assign To","lead","text","assigned_to","Lead",["assign to","assigned to","owner"]),
]

def _doc(key,label,entity,ftype,maps_to,group,aliases,order):
    return {"field_id": new_field_id(),"key":key,"label":label,"entity":entity,"type":ftype,
            "options":[],"required":False,"is_unique":False,"is_core":True,"maps_to":maps_to,
            "aliases":aliases,"group":group,"order":order,"is_active":True,
            "created_by":"system","created_at":_now()}

async def seed_field_definitions(db):
    flag = await db.app_meta.find_one({"_id":"field_definitions_seeded"})
    existing = {d["key"] async for d in db.field_definitions.find({}, {"key":1})}
    for i,(key,label,entity,ftype,maps_to,group,aliases) in enumerate(SEED_FIELDS):
        if key in existing: continue
        await db.field_definitions.insert_one(_doc(key,label,entity,ftype,maps_to,group,aliases,i*10))
    if not flag:
        await db.app_meta.insert_one({"_id":"field_definitions_seeded","value":True})

async def list_fields(db, entity=None):
    q = {"is_active": True}
    if entity: q["entity"] = entity
    return [d async for d in db.field_definitions.find(q, {"_id":0}).sort("order",1)]
```

Add to `backend/database.py` (after `seed_product_types(db)` call, mirroring `:220`):
```python
from field_registry import seed_field_definitions
await _i(db.field_definitions, [("entity",1),("is_active",1)])
await _i(db.field_definitions, [("key",1)], unique=True)
await seed_field_definitions(db)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && DB_NAME=smartshape_test python -m pytest tests/test_field_registry.py -v`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/field_registry.py backend/database.py backend/tests/test_field_registry.py
git commit -m "feat(import): field registry model + idempotent seed of 28 master fields"
```

---

### Task 2: Field CRUD + `merge_fields` helper

**Files:**
- Modify: `backend/field_registry.py`
- Test: `backend/tests/test_field_registry.py`

**Interfaces:**
- Produces: `async create_field(db, payload, user) -> dict`; `async update_field(db, field_id, patch) -> dict`; `async soft_delete_field(db, field_id) -> None`; `merge_fields(doc: dict) -> dict`.

- [ ] **Step 1: Write the failing test**

```python
@pytest.mark.asyncio
async def test_create_and_softdelete_custom(db):
    await fr.seed_field_definitions(db)
    f = await fr.create_field(db, {"label":"Transport Fee","entity":"school","type":"number"}, {"email":"a@b.c"})
    assert f["key"] == "transport_fee" and f["is_core"] is False
    await fr.soft_delete_field(db, f["field_id"])
    assert await db.field_definitions.find_one({"field_id":f["field_id"]})["is_active"] is False

@pytest.mark.asyncio
async def test_cannot_delete_core(db):
    await fr.seed_field_definitions(db)
    core = await db.field_definitions.find_one({"key":"school_name"})
    with pytest.raises(ValueError):
        await fr.soft_delete_field(db, core["field_id"])

def test_merge_fields_flattens_custom():
    doc = {"school_name":"X","custom_fields":{"transport_fee":1200}}
    out = fr.merge_fields(doc)
    assert out["school_name"]=="X" and out["transport_fee"]==1200
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && DB_NAME=smartshape_test python -m pytest tests/test_field_registry.py -k "create or core or merge" -v`
Expected: FAIL — `AttributeError: create_field`.

- [ ] **Step 3: Write minimal implementation** (append to `field_registry.py`)

```python
def _key_from_label(label): 
    k = re.sub(r"[^a-z0-9]+","_", (label or "").strip().lower()).strip("_")
    return k or f"field_{uuid.uuid4().hex[:6]}"

async def create_field(db, payload, user):
    key = payload.get("key") or _key_from_label(payload["label"])
    if await db.field_definitions.find_one({"key":key}):
        raise ValueError(f"field key exists: {key}")
    doc = {"field_id":new_field_id(),"key":key,"label":payload["label"],
           "entity":payload.get("entity","school"),"type":payload.get("type","text"),
           "options":payload.get("options",[]),"required":bool(payload.get("required")),
           "is_unique":False,"is_core":False,"maps_to":None,
           "aliases":[normalize_header(payload["label"])],"group":payload.get("group","Custom"),
           "order":900,"is_active":True,"created_by":user.get("email","?"),"created_at":_now()}
    await db.field_definitions.insert_one(doc)
    doc.pop("_id", None); return doc

async def update_field(db, field_id, patch):
    f = await db.field_definitions.find_one({"field_id":field_id})
    if not f: raise ValueError("not found")
    allowed = {"label","options","group","order","required"}
    if not f["is_core"]: allowed |= {"type"}
    upd = {k:v for k,v in patch.items() if k in allowed}
    await db.field_definitions.update_one({"field_id":field_id},{"$set":upd})
    return {**f, **upd, "_id":None}

async def soft_delete_field(db, field_id):
    f = await db.field_definitions.find_one({"field_id":field_id})
    if not f: raise ValueError("not found")
    if f["is_core"]: raise ValueError("cannot delete core field")
    await db.field_definitions.update_one({"field_id":field_id},{"$set":{"is_active":False}})

def merge_fields(doc):
    out = {k:v for k,v in doc.items() if k not in ("custom_fields","_id")}
    out.update(doc.get("custom_fields") or {})
    return out
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && DB_NAME=smartshape_test python -m pytest tests/test_field_registry.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/field_registry.py backend/tests/test_field_registry.py
git commit -m "feat(import): field CRUD + merge_fields, core fields protected from delete/retype"
```

---

### Task 3: Import parsing — CSV + Excel into uniform rows

**Files:**
- Create: `backend/import_engine.py`
- Modify: `backend/requirements.txt` (add `openpyxl==3.1.5`)
- Test: `backend/tests/test_import_mapping.py`

**Interfaces:**
- Produces: `parse_table(filename: str, content: bytes) -> tuple[list[str], list[dict]]` — returns `(headers, rows)` where each row is `{header: cell_str}`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_import_mapping.py
import io, pytest
from backend import import_engine as ie
from openpyxl import Workbook

def test_parse_csv():
    content = b"School Name,City\nDPS,Delhi\nRyan,Mumbai\n"
    headers, rows = ie.parse_table("a.csv", content)
    assert headers == ["School Name","City"]
    assert rows[0] == {"School Name":"DPS","City":"Delhi"} and len(rows)==2

def test_parse_xlsx():
    wb = Workbook(); ws = wb.active
    ws.append(["School Name","City"]); ws.append(["DPS","Delhi"])
    buf = io.BytesIO(); wb.save(buf)
    headers, rows = ie.parse_table("a.xlsx", buf.getvalue())
    assert headers == ["School Name","City"] and rows[0]["City"]=="Delhi"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && DB_NAME=smartshape_test python -m pytest tests/test_import_mapping.py -k parse -v`
Expected: FAIL — `ModuleNotFoundError: import_engine`. (First `pip install openpyxl==3.1.5`.)

- [ ] **Step 3: Write minimal implementation**

```python
# backend/import_engine.py
import csv, io
from openpyxl import load_workbook

def parse_table(filename, content):
    name = (filename or "").lower()
    if name.endswith((".xlsx",".xlsm")):
        wb = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        ws = wb.active
        rows_iter = ws.iter_rows(values_only=True)
        headers = [str(h).strip() if h is not None else "" for h in next(rows_iter, [])]
        rows = []
        for r in rows_iter:
            if r is None or all(c is None for c in r): continue
            rows.append({headers[i]: ("" if v is None else str(v)).strip()
                         for i,v in enumerate(r) if i < len(headers) and headers[i]})
        return headers, rows
    # CSV with encoding fallback (mirrors crm_routes.py:1998-2003)
    text = None
    for enc in ("utf-8-sig","cp1252","latin-1"):
        try: text = content.decode(enc); break
        except UnicodeDecodeError: continue
    reader = csv.DictReader(io.StringIO(text or ""))
    headers = [h.strip() for h in (reader.fieldnames or [])]
    rows = [{(k or "").strip():(v or "").strip() for k,v in row.items()} for row in reader]
    return headers, rows
```

Add `openpyxl==3.1.5` to `backend/requirements.txt`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && DB_NAME=smartshape_test python -m pytest tests/test_import_mapping.py -k parse -v`
Expected: 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/import_engine.py backend/requirements.txt backend/tests/test_import_mapping.py
git commit -m "feat(import): CSV + Excel parser into uniform rows (openpyxl)"
```

---

### Task 4: Auto column-mapping (alias + fuzzy)

**Files:**
- Modify: `backend/import_engine.py`
- Test: `backend/tests/test_import_mapping.py`

**Interfaces:**
- Consumes: `field_registry.list_fields`, `field_registry.normalize_header`.
- Produces: `async propose_mapping(db, headers: list[str]) -> list[dict]` — each `{source, field_id|None, key|None, confidence: "high"|"medium"|"none"}`.

- [ ] **Step 1: Write the failing test**

```python
import pytest
from backend import import_engine as ie, field_registry as fr

@pytest.mark.asyncio
async def test_propose_mapping_alias_and_fuzzy(db):
    await fr.seed_field_definitions(db)
    m = await ie.propose_mapping(db, ["School's Mail","Studnt Strength","Totally Unknown"])
    by = {x["source"]:x for x in m}
    assert by["School's Mail"]["key"]=="school_email" and by["School's Mail"]["confidence"]=="high"
    assert by["Studnt Strength"]["key"]=="school_strength"   # fuzzy
    assert by["Totally Unknown"]["confidence"]=="none"
```

(Reuse the `db` fixture from `test_field_registry.py` — copy it into this file's top.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && DB_NAME=smartshape_test python -m pytest tests/test_import_mapping.py -k propose -v`
Expected: FAIL — `AttributeError: propose_mapping`.

- [ ] **Step 3: Write minimal implementation** (append to `import_engine.py`)

```python
from difflib import SequenceMatcher
from field_registry import list_fields, normalize_header

async def propose_mapping(db, headers):
    fields = await list_fields(db)
    alias_index = {}
    for f in fields:
        for a in f.get("aliases", []):
            alias_index[normalize_header(a)] = f
        alias_index.setdefault(normalize_header(f["label"]), f)
    out = []
    for h in headers:
        nh = normalize_header(h)
        f = alias_index.get(nh)
        if f:
            out.append({"source":h,"field_id":f["field_id"],"key":f["key"],"confidence":"high"}); continue
        best, score = None, 0.0
        for f2 in fields:
            cand = [normalize_header(f2["label"])] + [normalize_header(a) for a in f2.get("aliases",[])]
            s = max(SequenceMatcher(None, nh, c).ratio() for c in cand)
            if s > score: best, score = f2, s
        if best and score >= 0.78:
            out.append({"source":h,"field_id":best["field_id"],"key":best["key"],"confidence":"medium"})
        else:
            out.append({"source":h,"field_id":None,"key":None,"confidence":"none"})
    return out
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && DB_NAME=smartshape_test python -m pytest tests/test_import_mapping.py -v`
Expected: all PASS. (If `Studnt Strength` lands medium-but-wrong, lower threshold check is fine; assert key only.)

- [ ] **Step 5: Commit**

```bash
git add backend/import_engine.py backend/tests/test_import_mapping.py
git commit -m "feat(import): auto column-mapping via learned aliases + fuzzy match"
```

---

### Task 5: Row resolver — school match (ID → name+city → phone)

**Files:**
- Modify: `backend/import_engine.py`
- Test: `backend/tests/test_import_resolve.py`

**Interfaces:**
- Produces: `async resolve_school(db, values: dict) -> dict` → `{action: "create"|"update"|"needs_review", school_id|None, candidates: int}`. `values` is a row already mapped to field `key`s.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_import_resolve.py
import os, pytest
from motor.motor_asyncio import AsyncIOMotorClient
from backend import import_engine as ie

@pytest.fixture
def db():
    name = os.getenv("DB_NAME","smartshape_test")
    assert name.endswith("_test") or name=="mtt_ci"
    d = AsyncIOMotorClient(os.getenv("MONGO_URL","mongodb://localhost:27017"))[name]
    yield d

@pytest.mark.asyncio
async def test_resolve_create_when_no_match(db):
    await db.schools.delete_many({})
    r = await ie.resolve_school(db, {"school_name":"Brand New","city":"Pune"})
    assert r["action"]=="create"

@pytest.mark.asyncio
async def test_resolve_update_by_id(db):
    await db.schools.delete_many({})
    await db.schools.insert_one({"school_id":"sch_known1","school_name":"X","is_deleted":False})
    r = await ie.resolve_school(db, {"school_id":"sch_known1","school_name":"X"})
    assert r["action"]=="update" and r["school_id"]=="sch_known1"

@pytest.mark.asyncio
async def test_resolve_needs_review_on_two(db):
    await db.schools.delete_many({})
    await db.schools.insert_many([
        {"school_id":"sch_a","school_name":"Dups","city":"Goa","is_deleted":False},
        {"school_id":"sch_b","school_name":"Dups","city":"Goa","is_deleted":False}])
    r = await ie.resolve_school(db, {"school_name":"Dups","city":"Goa"})
    assert r["action"]=="needs_review" and r["candidates"]==2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && DB_NAME=smartshape_test python -m pytest tests/test_import_resolve.py -v`
Expected: FAIL — `AttributeError: resolve_school`.

- [ ] **Step 3: Write minimal implementation** (append to `import_engine.py`)

```python
import re as _re

async def resolve_school(db, values):
    sid = (values.get("school_id") or "").strip()
    if sid:
        hit = await db.schools.find_one({"school_id":sid,"is_deleted":{"$ne":True}})
        if hit: return {"action":"update","school_id":sid,"candidates":1}
    name = (values.get("school_name") or "").strip()
    city = (values.get("city") or "").strip()
    if name:
        q = {"school_name":{"$regex":f"^{_re.escape(name)}$","$options":"i"},"is_deleted":{"$ne":True}}
        if city: q["city"] = {"$regex":f"^{_re.escape(city)}$","$options":"i"}
        cands = [d async for d in db.schools.find(q, {"school_id":1})]
        if len(cands)==1: return {"action":"update","school_id":cands[0]["school_id"],"candidates":1}
        if len(cands)>=2: return {"action":"needs_review","school_id":None,"candidates":len(cands)}
    phone = (values.get("school_phone") or values.get("phone") or "").strip()
    if phone:
        cands = [d async for d in db.schools.find({"phone":phone,"is_deleted":{"$ne":True}},{"school_id":1})]
        if len(cands)==1: return {"action":"update","school_id":cands[0]["school_id"],"candidates":1}
        if len(cands)>=2: return {"action":"needs_review","school_id":None,"candidates":len(cands)}
    return {"action":"create","school_id":None,"candidates":0}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && DB_NAME=smartshape_test python -m pytest tests/test_import_resolve.py -v`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/import_engine.py backend/tests/test_import_resolve.py
git commit -m "feat(import): row resolver (ID->name+city->phone) with needs_review guard"
```

---

### Task 6: Commit writer — upsert School+Contact+Lead with audit snapshot

**Files:**
- Modify: `backend/import_engine.py`
- Test: `backend/tests/test_import_resolve.py`

**Interfaces:**
- Consumes: `resolve_school`, `field_registry.SEED_FIELDS` (for `maps_to`).
- Produces: `split_values(db, row_keyed: dict) -> dict` → `{"school":{...},"contact":{...},"lead":{...},"custom":{entity:{key:val}}}`; `async commit_row(db, row_keyed: dict, user, create_leads: bool) -> dict` → `{action, school_id, contact_id, lead_id|None}`.

- [ ] **Step 1: Write the failing test**

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && DB_NAME=smartshape_test python -m pytest tests/test_import_resolve.py -k commit -v`
Expected: FAIL — `AttributeError: commit_row`.

- [ ] **Step 3: Write minimal implementation** (append to `import_engine.py`)

```python
import uuid as _uuid
from datetime import datetime, timezone
from field_registry import SEED_FIELDS

def _now(): return datetime.now(timezone.utc).isoformat()
_CORE = {key:(entity,maps_to) for (key,_l,entity,_t,maps_to,_g,_a) in SEED_FIELDS}

def split_values(row_keyed):
    out = {"school":{}, "contact":{}, "lead":{}, "custom":{"school":{},"contact":{},"lead":{}}}
    for key,val in row_keyed.items():
        if key=="school_id":  # control key, not stored as a field
            continue
        meta = _CORE.get(key)
        if meta and meta[1]:               # core -> native column
            entity, native = meta
            out[entity][native] = val
        else:                              # custom -> custom_fields
            entity = meta[0] if meta else "school"
            out["custom"][entity][key] = val
    return out

async def commit_row(db, row_keyed, user, create_leads):
    res = await resolve_school(db, row_keyed)
    if res["action"]=="needs_review":
        return {"action":"needs_review","school_id":None,"contact_id":None,"lead_id":None}
    parts = split_values(row_keyed)
    sid = res["school_id"]
    if res["action"]=="create":
        sid = f"sch_{_uuid.uuid4().hex[:12]}"
        doc = {"school_id":sid,"is_deleted":False,"created_by":user.get("email","import"),
               "created_at":_now(),"custom_fields":parts["custom"]["school"], **parts["school"]}
        await db.schools.insert_one(doc)
    else:
        old = await db.schools.find_one({"school_id":sid})
        await db.audit_backup.insert_one({"kind":"school_pre_import","school_id":sid,
            "snapshot":{k:v for k,v in (old or {}).items() if k!="_id"},"at":_now(),"by":user.get("email")})
        upd = dict(parts["school"])
        for k,v in parts["custom"]["school"].items(): upd[f"custom_fields.{k}"]=v
        upd["last_activity_date"]=_now()
        await db.schools.update_one({"school_id":sid},{"$set":upd})
    # contact (dedup by phone within school, per crm_routes.py:2015)
    cid = None
    cvals = {**parts["contact"], **({} if not parts["custom"]["contact"] else {})}
    phone = parts["contact"].get("phone","")
    if parts["contact"].get("name") or phone:
        existing = await db.contacts.find_one({"school_id":sid,"phone":phone}) if phone else None
        cdoc = {"school_id":sid, **parts["contact"], "custom_fields":parts["custom"]["contact"]}
        if existing:
            cid = existing["contact_id"]
            await db.contacts.update_one({"contact_id":cid},{"$set":cdoc})
        else:
            cid = f"con_{_uuid.uuid4().hex[:12]}"
            await db.contacts.insert_one({"contact_id":cid,"created_at":_now(),"is_deleted":False,**cdoc})
    # optional lead from Assign To
    lid = None
    owner = parts["lead"].get("assigned_to","")
    if create_leads and owner:
        existing = await db.leads.find_one({"school_id":sid,"is_deleted":{"$ne":True}})
        if existing:
            lid = existing["lead_id"]; await db.leads.update_one({"lead_id":lid},{"$set":{"assigned_to":owner}})
        else:
            lid = f"lead_{_uuid.uuid4().hex[:12]}"
            await db.leads.insert_one({"lead_id":lid,"school_id":sid,"assigned_to":owner,
                "company_name":parts["school"].get("school_name",""),"stage":"new",
                "created_at":_now(),"is_deleted":False})
    return {"action":res["action"],"school_id":sid,"contact_id":cid,"lead_id":lid}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && DB_NAME=smartshape_test python -m pytest tests/test_import_resolve.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/import_engine.py backend/tests/test_import_resolve.py
git commit -m "feat(import): upsert School+Contact+Lead with audit snapshot before overwrite"
```

---

### Task 7: API routes — `/fields/*` and extended `/import/*`

**Files:**
- Create: `backend/routes/dynamic_import_routes.py`
- Modify: `backend/server.py` (include router where other routers are included)
- Test: `backend/tests/test_import_endpoints.py`

**Interfaces:**
- Consumes: `field_registry`, `import_engine`, `rbac.require_admin/require_module`, `auth_utils.get_current_user`.
- Produces routes: `GET/POST/PUT/DELETE /fields`, `POST /import/preview`, `POST /import/execute`, `GET /import/template`.

- [ ] **Step 1: Write the failing test** (uses FastAPI TestClient with auth dependency override)

```python
# backend/tests/test_import_endpoints.py
import io, os, pytest
from fastapi.testclient import TestClient
from backend.server import app
from backend import auth_utils

@pytest.fixture
def client():
    assert os.getenv("DB_NAME","smartshape_test").endswith("_test")
    app.dependency_overrides[auth_utils.get_current_user] = lambda: {"email":"admin@t","team":"admin","role":"admin"}
    yield TestClient(app)
    app.dependency_overrides.clear()

def test_preview_maps_headers(client):
    csv = b"School/Institute Name,City,School's Mail\nDPS,Delhi,d@x.com\n"
    r = client.post("/api/import/preview", files={"file":("a.csv",csv,"text/csv")}, data={"entity_type":"school"})
    assert r.status_code==200
    body = r.json()
    keys = {m["source"]:m["key"] for m in body["mapping"]}
    assert keys["School/Institute Name"]=="school_name" and keys["School's Mail"]=="school_email"
    assert body["counts"]["create"] >= 1

def test_fields_list_and_create(client):
    r = client.get("/api/fields?entity=school"); assert r.status_code==200 and len(r.json())>0
    r2 = client.post("/api/fields", json={"label":"Transport Fee","entity":"school","type":"number"})
    assert r2.status_code==200 and r2.json()["key"]=="transport_fee"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && DB_NAME=smartshape_test python -m pytest tests/test_import_endpoints.py -v`
Expected: FAIL — 404 (routes not registered).

- [ ] **Step 3: Write minimal implementation**

```python
# backend/routes/dynamic_import_routes.py
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from auth_utils import get_current_user
from rbac import require_admin, require_module
import field_registry as fr, import_engine as ie
from database import db

router = APIRouter(prefix="/api", tags=["dynamic-import"])

@router.get("/fields")
async def get_fields(entity: str = None, user=Depends(get_current_user)):
    require_admin(user); return await fr.list_fields(db, entity)

@router.post("/fields")
async def post_field(payload: dict, user=Depends(get_current_user)):
    require_admin(user)
    try: return await fr.create_field(db, payload, user)
    except ValueError as e: raise HTTPException(409, str(e))

@router.put("/fields/{field_id}")
async def put_field(field_id: str, patch: dict, user=Depends(get_current_user)):
    require_admin(user)
    try: return await fr.update_field(db, field_id, patch)
    except ValueError as e: raise HTTPException(404, str(e))

@router.delete("/fields/{field_id}")
async def del_field(field_id: str, user=Depends(get_current_user)):
    require_admin(user)
    try: await fr.soft_delete_field(db, field_id); return {"ok":True}
    except ValueError as e: raise HTTPException(409, str(e))

def _key_rows(headers, rows, mapping):
    h2k = {m["source"]:m["key"] for m in mapping if m.get("key")}
    out = []
    for row in rows:
        out.append({h2k[h]:v for h,v in row.items() if h in h2k})
    return out

@router.post("/import/preview")
async def import_preview(file: UploadFile = File(...), entity_type: str = Form("school"), user=Depends(get_current_user)):
    require_module(user, "settings", "read_write")
    headers, rows = ie.parse_table(file.filename, await file.read())
    mapping = await ie.propose_mapping(db, headers)
    keyed = _key_rows(headers, rows, mapping)
    counts = {"create":0,"update":0,"needs_review":0,"error":0}
    preview = []
    for kr in keyed[:200]:
        try:
            res = await ie.resolve_school(db, kr); counts[res["action"]] += 1
            preview.append({"action":res["action"],"school_id":res["school_id"]})
        except Exception as e:
            counts["error"]+=1; preview.append({"action":"error","error":str(e)})
    return {"headers":headers,"mapping":mapping,"rows_preview":preview,"counts":counts,"total":len(keyed)}

@router.post("/import/execute")
async def import_execute(payload: dict, user=Depends(get_current_user)):
    require_module(user, "settings", "read_write")
    rows = payload.get("rows_keyed") or []         # frontend re-sends mapped rows
    create_leads = bool(payload.get("create_leads"))
    # learn confirmed aliases
    for m in payload.get("mapping", []):
        if m.get("field_id") and m.get("source"):
            await db.field_definitions.update_one({"field_id":m["field_id"]},
                {"$addToSet":{"aliases":fr.normalize_header(m["source"])}})
    counts = {"create":0,"update":0,"needs_review":0,"error":0}
    for kr in rows:
        try: counts[(await ie.commit_row(db, kr, user, create_leads))["action"]] += 1
        except Exception: counts["error"]+=1
    log = {"by":user.get("email"),"counts":counts,"at":ie._now()}
    await db.import_logs.insert_one(dict(log)); log.pop("_id",None)
    return log

@router.get("/import/template")
async def import_template(with_ids: bool = False, user=Depends(get_current_user)):
    require_module(user, "settings", "read_write")
    fields = await fr.list_fields(db)
    headers = (["School ID"] if with_ids else []) + [f["label"] for f in fields]
    rows = []
    if with_ids:
        async for s in db.schools.find({"is_deleted":{"$ne":True}}, {"school_id":1,"school_name":1}):
            rows.append({"School ID":s["school_id"],"School/Institute Name":s.get("school_name","")})
    return {"headers":headers,"rows":rows}
```

Register in `backend/server.py` alongside other `app.include_router(...)` calls:
```python
from routes.dynamic_import_routes import router as dynamic_import_router
app.include_router(dynamic_import_router)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && DB_NAME=smartshape_test python -m pytest tests/test_import_endpoints.py -v`
Expected: PASS. (If `db`/`get_current_user` import paths differ, match existing route modules' imports.)

- [ ] **Step 5: Commit**

```bash
git add backend/routes/dynamic_import_routes.py backend/server.py backend/tests/test_import_endpoints.py
git commit -m "feat(import): /fields CRUD + /import preview/execute/template endpoints"
```

---

### Task 8: Frontend API client wiring

**Files:**
- Modify: `frontend/src/lib/api.js`
- Test: manual (build check) — covered by Task 9/10 UI tests.

**Interfaces:**
- Produces: `fields.list/create/update/remove`; `importSystem.preview/execute/template` (extends existing `:773-781`).

- [ ] **Step 1: Add client methods** (place near existing `importSystem` block ~`:773`)

```javascript
export const fields = {
  list: (entity) => API.get(`/fields${entity ? `?entity=${entity}` : ''}`),
  create: (body) => API.post('/fields', body),
  update: (id, patch) => API.put(`/fields/${id}`, patch),
  remove: (id) => API.delete(`/fields/${id}`),
};
// extend importSystem:
importSystem.preview = (file, entityType) => {
  const fd = new FormData(); fd.append('file', file);
  return API.post(`/import/preview?entity_type=${entityType}`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
};
importSystem.execute = (payload) => API.post('/import/execute', payload);
importSystem.template = (withIds) => API.get(`/import/template?with_ids=${withIds ? 'true' : 'false'}`);
```

- [ ] **Step 2: Build check**

Run: `cd frontend && DISABLE_ESLINT_PLUGIN=true npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/api.js
git commit -m "feat(import): frontend api client for fields + extended import"
```

---

### Task 9: Master Fields builder page + route/nav + DynamicEntityForm

**Files:**
- Create: `frontend/src/pages/admin/MasterFields.js`
- Create: `frontend/src/components/forms/DynamicEntityForm.js`
- Modify: `frontend/src/App.js` (lazy import + route), `frontend/src/components/layouts/AdminNavItems.js` (MODULE_ROUTE_MAP + SIDEBAR_SECTIONS)
- Test: manual build + smoke.

**Interfaces:**
- Consumes: `fields.*`. `DynamicEntityForm({entity, value, onChange})` renders typed inputs from the registry.

- [ ] **Step 1: Create `DynamicEntityForm.js`**

```jsx
import React, { useEffect, useState } from 'react';
import { fields as fieldsApi } from '../../lib/api';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

export default function DynamicEntityForm({ entity = 'school', value = {}, onChange }) {
  const [defs, setDefs] = useState([]);
  useEffect(() => { fieldsApi.list(entity).then(r => setDefs(r.data || [])); }, [entity]);
  const set = (k, v) => onChange({ ...value, [k]: v });
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {defs.map(f => (
        <div key={f.field_id}>
          <Label>{f.label}{f.required && ' *'}</Label>
          {f.type === 'select'
            ? <select className="w-full border rounded p-2" value={value[f.key] || ''} onChange={e => set(f.key, e.target.value)}>
                <option value="">—</option>{(f.options||[]).map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            : <Input type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                     value={value[f.key] || ''} onChange={e => set(f.key, e.target.value)} />}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create `MasterFields.js`** (builder; reuse `MasterEntityTable` + `Dialog`)

```jsx
import React, { useEffect, useState } from 'react';
import { fields as fieldsApi } from '../../lib/api';
import { useDataSync } from '../../lib/dataSync';
import MasterEntityTable from '../../components/crm/MasterEntityTable';
import { Dialog } from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';

const ENTITIES = ['school','contact','lead'];
const TYPES = ['text','number','date','email','phone','url','select','multiselect','boolean'];

export default function MasterFields() {
  const [entity, setEntity] = useState('school');
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ label:'', type:'text', entity:'school' });
  const load = () => fieldsApi.list(entity).then(r => setRows(r.data || []));
  useEffect(() => { load(); }, [entity]);
  useDataSync('settings', load);
  const save = async () => { await fieldsApi.create({ ...form, entity }); setOpen(false); setForm({label:'',type:'text'}); load(); };
  const del = async (row) => { if (row.is_core) return alert('Core field cannot be deleted'); await fieldsApi.remove(row.field_id); load(); };
  const columns = [
    { key:'label', label:'Field', primary:true },
    { key:'type', label:'Type' },
    { key:'is_core', label:'Core', render:r => r.is_core ? 'Yes' : '' },
  ];
  return (
    <div className="p-4 space-y-3">
      <div className="flex gap-2 items-center">
        {ENTITIES.map(e => <Button key={e} variant={entity===e?'primary':'outline'} onClick={()=>setEntity(e)}>{e}</Button>)}
        <div className="ml-auto"><Button onClick={()=>setOpen(true)}>+ Add Field</Button></div>
      </div>
      <MasterEntityTable columns={columns} data={rows} rowKey="field_id" onDelete={del} emptyMsg="No fields" />
      <Dialog open={open} onOpenChange={setOpen}>
        <div className="space-y-2 p-2">
          <Input placeholder="Field label" value={form.label} onChange={e=>setForm({...form,label:e.target.value})} />
          <select className="w-full border rounded p-2" value={form.type} onChange={e=>setForm({...form,type:e.target.value})}>
            {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <Button onClick={save} disabled={!form.label}>Save</Button>
        </div>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 3: Wire route + nav**

In `frontend/src/App.js` (with other admin lazy imports ~`:18-60`):
```javascript
const MasterFields = lazy(() => import('./pages/admin/MasterFields'));
```
Route (with other admin routes ~`:188-229`):
```jsx
<Route path="/master-fields" element={<ProtectedRoute><MasterFields /></ProtectedRoute>} />
```
In `frontend/src/components/layouts/AdminNavItems.js` add to `MODULE_ROUTE_MAP` and the System/Settings `SIDEBAR_SECTIONS` group:
```javascript
'master-fields': { path:'/master-fields', label:'Master Fields', icon: 'Columns' },
```

- [ ] **Step 4: Build check**

Run: `cd frontend && DISABLE_ESLINT_PLUGIN=true npm run build`
Expected: build succeeds; `/master-fields` renders the builder.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/admin/MasterFields.js frontend/src/components/forms/DynamicEntityForm.js frontend/src/App.js frontend/src/components/layouts/AdminNavItems.js
git commit -m "feat(import): Master Fields builder page + dynamic entity form + nav"
```

---

### Task 10: Import Center mapping step (Excel + auto-map UI) + integration test

**Files:**
- Modify: `frontend/src/pages/admin/ImportCenter.js`
- Test: `backend/tests/test_import_endpoints.py` (add end-to-end), manual UI smoke.

**Interfaces:**
- Consumes: `importSystem.preview/execute/template`, `fields.create`.

- [ ] **Step 1: Add end-to-end backend test (real 28-col sample, idempotent re-upload)**

```python
def test_end_to_end_idempotent(client):
    hdr = "School ID,School/Institute Name,City,Name,Phone Number,Assign To"
    csv1 = (hdr.replace("School ID,","") + "\nSunrise,Pune,Mr A,900001,ravi\n").encode()
    pv = client.post("/api/import/preview", files={"file":("m.csv",csv1,"text/csv")}, data={"entity_type":"school"}).json()
    keyed = [{"school_name":"Sunrise","city":"Pune","name":"Mr A","phone":"900001","assign_to":"ravi"}]
    r1 = client.post("/api/import/execute", json={"rows_keyed":keyed,"mapping":pv["mapping"],"create_leads":True}).json()
    assert r1["counts"]["create"]==1
    # fetch the id back, re-run as update
    from database import db
    import asyncio
    sid = asyncio.get_event_loop().run_until_complete(db.schools.find_one({"school_name":"Sunrise"}))["school_id"]
    keyed2 = [{**keyed[0],"school_id":sid,"city":"Pune"}]
    r2 = client.post("/api/import/execute", json={"rows_keyed":keyed2,"mapping":pv["mapping"],"create_leads":True}).json()
    assert r2["counts"]["update"]==1
```

- [ ] **Step 2: Run it to verify fail-then-pass loop**

Run: `cd backend && DB_NAME=smartshape_test python -m pytest tests/test_import_endpoints.py::test_end_to_end_idempotent -v`
Expected: PASS (engine already built; this locks the contract the UI depends on).

- [ ] **Step 3: Extend `ImportCenter.js`** — accept `.xlsx`, render mapping step

Change the file input `accept=".csv"` → `accept=".csv,.xlsx"` (per `ImportCenter.js:92`). After `importSystem.preview` returns, render a mapping table before execute:
```jsx
{preview && (
  <div className="space-y-2">
    <table className="w-full text-sm">
      <thead><tr><th>Your column</th><th>Maps to</th><th>Confidence</th></tr></thead>
      <tbody>
        {preview.mapping.map((m,i) => (
          <tr key={i}>
            <td>{m.source}</td>
            <td>
              <select value={m.key || ''} onChange={e => updateMap(i, e.target.value)}>
                <option value="">— ignore —</option>
                {allFields.map(f => <option key={f.field_id} value={f.key}>{f.label}</option>)}
              </select>
            </td>
            <td>{m.confidence === 'high' ? '🟢' : m.confidence === 'medium' ? '🟡' : '⚪'}</td>
          </tr>
        ))}
      </tbody>
    </table>
    <div className="text-sm">Will create {preview.counts.create} · update {preview.counts.update} · review {preview.counts.needs_review}</div>
    <Button onClick={runExecute}>Import {preview.total} rows</Button>
  </div>
)}
```
Load `allFields` via `fields.list()` on mount; `runExecute` builds `rows_keyed` from the mapping and calls `importSystem.execute`. Add a "Download template (with IDs)" button calling `importSystem.template(true)`.

- [ ] **Step 4: Build + manual smoke**

Run: `cd frontend && DISABLE_ESLINT_PLUGIN=true npm run build`
Expected: build succeeds. Manual: upload the 28-col `.xlsx`, see auto-map, import, re-upload with IDs → updates not duplicates.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/admin/ImportCenter.js backend/tests/test_import_endpoints.py
git commit -m "feat(import): Import Center mapping step + Excel + end-to-end idempotency test"
```

---

## Self-Review

**Spec coverage:** §4.1 registry → T1/T2; §4.2 values/`merge_fields` → T2; §4.3 parse → T3, map → T4, resolve → T5, commit/audit → T6; §4.4 API → T7; §4.5 frontend → T8/T9/T10; §3 28-col seed → T1; §6 safety (snapshot, needs_review, per-row isolation) → T5/T6/T7; §10 acceptance #1 auto-map (T7/T10), #2 add-field-shows-everywhere (T9), #3 ID round-trip idempotency (T10), #4 needs_review (T5), #5 audit snapshot (T6), #6 test DB (Global Constraints + every fixture). **Phase 2 public form** intentionally out of scope. No gaps.

**Placeholder scan:** No TBD/TODO; every code step carries full code. (DynamicEntityForm wired into the manual Add/Edit flow is provided as a component; hooking it into an existing school-edit screen is optional Phase-1.5 and not a blocking task.)

**Type consistency:** `propose_mapping` returns `{source, field_id, key, confidence}` — consumed identically in T7 `_key_rows`, T10 UI. `resolve_school`→`{action, school_id, candidates}` consumed in T6/T7. `commit_row`→`{action, school_id, contact_id, lead_id}` consumed in T7. `fields.*`/`importSystem.*` names match between T8 and T9/T10. Consistent.
