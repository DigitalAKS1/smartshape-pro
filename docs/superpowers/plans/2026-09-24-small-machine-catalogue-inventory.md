# Small Machine Category — Catalogue Filter + Stock Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a Quotation's Package is tagged as the small-machine package, the auto-generated customer Catalogue shows only small-machine-compatible, in-stock dies; inventory can see stock grouped by machine category.

**Architecture:** Add one optional string field, `machine_category`, to `db.dies` and `db.packages` (values: `"small_machine"` or absent/null = general — fully backward compatible). The existing per-quotation catalogue generator (`GET /catalogue/{token}`) restricts its die query by that field, plus an available-stock guard, only when the quotation's package carries a `machine_category`. Inventory grouping is computed client-side from data already fetched (`GET /dies`) — no new backend endpoint.

**Tech Stack:** FastAPI + Motor/MongoDB (backend), React (frontend), pytest (backend HTTP-integration tests against a running server), Jest + manual `react-dom/client` mounts (frontend, no RTL in this repo).

**Spec:** `docs/superpowers/specs/2026-09-24-small-machine-catalogue-inventory-design.md`

## Global Constraints

- `machine_category` is a plain optional string, not an enum table: `"small_machine"` or absent/`null` = general. No migration needed — existing docs are simply missing the key.
- Do not touch the existing `type` field (die size: standard/large) or `category` field (design motif) — they mean something else already.
- The catalogue query change must be a no-op for any quotation whose package has no `machine_category` — every existing quotation/catalogue must render exactly as it does today.
- Backend tests in this repo are HTTP-integration tests that hit a running backend at `REACT_APP_BACKEND_URL` (see `backend/tests/test_inventory_catalogue.py`, `test_package_quotation.py`) and log in as `info@smartshape.in` / `admin123`. Follow that exact convention: prefix all test-created dies/packages with `TEST_MC_` / `TEST_MC` and delete them in a fixture teardown, the same way the existing suite does.
- Frontend tests in this repo mount components directly via `react-dom/client` + `act` (no `@testing-library/react` — see `frontend/src/components/crm/__tests__/AssignToPicker.test.js`). Follow that pattern, not RTL syntax.

## Review Focus

1. A quotation's package has no `machine_category` (or it was cleared back to null) — the catalogue must still return the full, unfiltered die list exactly as before. (Task 3)
2. A small-machine die is not literally zero-stock but is fully reserved (`reserved_qty >= stock_qty`) — it must still be excluded, since it can't be fulfilled either way. (Task 3)
3. A quotation references a `package_id` whose package document has since been deleted — the catalogue endpoint must not crash and must fall back to the unfiltered list. (Task 3)
4. Once a package is tagged `machine_category = "small_machine"`, updating it back to `null` must actually un-tag it (not get silently ignored/stuck). (Task 2)
5. The frontend grouping helper must bucket a die with `machine_category: ""` (blank/stale) into `"general"`, the same as a die with no `machine_category` key at all — not as its own separate group. (Task 6)

---

### Task 1: Backend — `machine_category` field on Die

**Files:**
- Modify: `backend/routes/inventory_routes.py:34-45` (`DieCreate` model)
- Create: `backend/tests/test_machine_category.py`

**Interfaces:**
- Produces: `DieCreate.machine_category: Optional[str] = None`, accepted by `POST /dies` and (already, via existing pass-through) `PUT /dies/{id}`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_machine_category.py`:

```python
"""
Test suite for the Small Machine Category feature:
- machine_category field on dies and packages
- Catalogue filtering by machine_category (in-stock only)
Client-side stock grouping is a frontend concern (see frontend hook tests).
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
ADMIN_EMAIL = "info@smartshape.in"
ADMIN_PASSWORD = "admin123"


class TestSession:
    session = None

    @classmethod
    def get_session(cls):
        if cls.session is None:
            cls.session = requests.Session()
            cls.session.headers.update({"Content-Type": "application/json"})
            resp = cls.session.post(f"{BASE_URL}/api/auth/login", json={
                "email": ADMIN_EMAIL, "password": ADMIN_PASSWORD,
            })
            if resp.status_code != 200:
                pytest.skip(f"Login failed: {resp.status_code} - {resp.text}")
        return cls.session


@pytest.fixture(scope="module")
def auth_session():
    return TestSession.get_session()


class TestDieMachineCategory:
    """Die create/update round-trips the machine_category field."""

    @pytest.fixture(autouse=True)
    def cleanup(self, auth_session):
        yield
        dies = auth_session.get(f"{BASE_URL}/api/dies?include_archived=true").json()
        for die in dies:
            if die.get('code', '').startswith('TEST_MC_'):
                auth_session.delete(f"{BASE_URL}/api/dies/{die['die_id']}")

    def test_create_die_with_machine_category(self, auth_session):
        code = f"TEST_MC_{uuid.uuid4().hex[:6]}"
        resp = auth_session.post(f"{BASE_URL}/api/dies", json={
            "code": code, "name": "Small Machine Die", "type": "standard",
            "machine_category": "small_machine", "min_level": 5,
        })
        assert resp.status_code == 200, resp.text
        assert resp.json()["machine_category"] == "small_machine"

    def test_create_die_without_machine_category_defaults_to_none(self, auth_session):
        code = f"TEST_MC_{uuid.uuid4().hex[:6]}"
        resp = auth_session.post(f"{BASE_URL}/api/dies", json={
            "code": code, "name": "General Die", "type": "standard", "min_level": 5,
        })
        assert resp.status_code == 200, resp.text
        assert resp.json().get("machine_category") is None

    def test_update_die_machine_category(self, auth_session):
        code = f"TEST_MC_{uuid.uuid4().hex[:6]}"
        create_resp = auth_session.post(f"{BASE_URL}/api/dies", json={
            "code": code, "name": "Die To Tag", "type": "standard", "min_level": 5,
        })
        die_id = create_resp.json()["die_id"]
        update_resp = auth_session.put(f"{BASE_URL}/api/dies/{die_id}", json={
            "machine_category": "small_machine",
        })
        assert update_resp.status_code == 200, update_resp.text
        assert update_resp.json()["machine_category"] == "small_machine"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest backend/tests/test_machine_category.py -v` (with the backend already running and `REACT_APP_BACKEND_URL` set)
Expected: `test_create_die_with_machine_category` FAILs (`machine_category` missing/`None` in response, since `DieCreate` silently drops unknown fields).

- [ ] **Step 3: Add the field to `DieCreate`**

In `backend/routes/inventory_routes.py`, change:

```python
class DieCreate(BaseModel):
    code: str
    name: str
    type: str
    category: Optional[str] = "decorative"
    min_level: int = 5
    description: Optional[str] = None
    stock_qty: int = 0
    video_url: Optional[str] = None
    show_video: bool = False
    show_description: bool = False
    product_type_id: Optional[str] = None
```

to:

```python
class DieCreate(BaseModel):
    code: str
    name: str
    type: str
    category: Optional[str] = "decorative"
    min_level: int = 5
    description: Optional[str] = None
    stock_qty: int = 0
    video_url: Optional[str] = None
    show_video: bool = False
    show_description: bool = False
    product_type_id: Optional[str] = None
    machine_category: Optional[str] = None
```

(`update_die`, `inventory_routes.py:139-168`, already passes through arbitrary body fields — no change needed there; `test_update_die_machine_category` exercises that existing behavior.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest backend/tests/test_machine_category.py::TestDieMachineCategory -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/routes/inventory_routes.py backend/tests/test_machine_category.py
git commit -m "feat(inventory): add machine_category field to Die model"
```

---

### Task 2: Backend — `machine_category` field on Package

**Files:**
- Modify: `backend/routes/inventory_routes.py:419-438` (`create_package`)
- Modify: `backend/routes/inventory_routes.py:441-451` (`update_package`)
- Modify: `backend/tests/test_machine_category.py` (append)

**Interfaces:**
- Produces: `db.packages` docs carry `machine_category: Optional[str]`, settable via `POST /packages` and `PUT /packages/{id}`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_machine_category.py`:

```python
class TestPackageMachineCategory:
    """Package create/update round-trips the machine_category field."""

    created_ids = []

    @pytest.fixture(scope="class", autouse=True)
    def cleanup(self, auth_session):
        yield
        for pkg_id in TestPackageMachineCategory.created_ids:
            auth_session.delete(f"{BASE_URL}/api/packages/{pkg_id}")

    def test_create_package_with_machine_category(self, auth_session):
        resp = auth_session.post(f"{BASE_URL}/api/packages", json={
            "name": f"test_mc_pkg_{uuid.uuid4().hex[:6]}",
            "display_name": "TEST_MC Small Machine Package",
            "base_price": 10000, "gst_pct": 18,
            "machine_category": "small_machine",
            "items": [{"type": "machine", "name": "Small Machine", "qty": 1, "unit_price": 10000, "gst_pct": 18}],
        })
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["machine_category"] == "small_machine"
        TestPackageMachineCategory.created_ids.append(data["package_id"])

    def test_create_package_without_machine_category_defaults_to_none(self, auth_session):
        resp = auth_session.post(f"{BASE_URL}/api/packages", json={
            "name": f"test_mc_pkg_{uuid.uuid4().hex[:6]}",
            "display_name": "TEST_MC General Package",
            "base_price": 5000, "gst_pct": 18, "items": [],
        })
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data.get("machine_category") is None
        TestPackageMachineCategory.created_ids.append(data["package_id"])

    def test_update_package_machine_category_can_be_cleared(self, auth_session):
        create_resp = auth_session.post(f"{BASE_URL}/api/packages", json={
            "name": f"test_mc_pkg_{uuid.uuid4().hex[:6]}",
            "display_name": "TEST_MC Untag Me",
            "base_price": 5000, "gst_pct": 18,
            "machine_category": "small_machine", "items": [],
        })
        pkg_id = create_resp.json()["package_id"]
        TestPackageMachineCategory.created_ids.append(pkg_id)

        tag_check = auth_session.get(f"{BASE_URL}/api/packages")
        pkg = next(p for p in tag_check.json() if p["package_id"] == pkg_id)
        assert pkg["machine_category"] == "small_machine"

        # Review Focus #4: clearing it back to null must actually un-tag it.
        update_resp = auth_session.put(f"{BASE_URL}/api/packages/{pkg_id}", json={
            "machine_category": None,
        })
        assert update_resp.status_code == 200, update_resp.text
        assert update_resp.json().get("machine_category") is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest backend/tests/test_machine_category.py::TestPackageMachineCategory -v`
Expected: FAIL — `create_package` builds a fixed dict that drops `machine_category`, so all three assertions on it fail (missing key reads as `None` even for the "with" case since it's simply never stored, so the first test's `== "small_machine"` assertion fails).

- [ ] **Step 3: Implement**

In `backend/routes/inventory_routes.py`, in `create_package`, change:

```python
    pkg_doc = {
        "package_id": package_id,
        "name": body.get("name", "").lower().replace(" ", "_"),
        "display_name": body.get("display_name", body.get("name", "")),
        "base_price": body.get("base_price", 0),
        "std_die_qty": body.get("std_die_qty", 0),
        "machine_qty": body.get("machine_qty", 0),
        "large_die_qty": body.get("large_die_qty", 0),
        "gst_pct": body.get("gst_pct", 18),
        "items": body.get("items", []),
        "is_active": True,
    }
```

to:

```python
    pkg_doc = {
        "package_id": package_id,
        "name": body.get("name", "").lower().replace(" ", "_"),
        "display_name": body.get("display_name", body.get("name", "")),
        "base_price": body.get("base_price", 0),
        "std_die_qty": body.get("std_die_qty", 0),
        "machine_qty": body.get("machine_qty", 0),
        "large_die_qty": body.get("large_die_qty", 0),
        "gst_pct": body.get("gst_pct", 18),
        "items": body.get("items", []),
        "machine_category": body.get("machine_category"),
        "is_active": True,
    }
```

And in `update_package`, change the `allowed` whitelist:

```python
    for key in ("display_name", "base_price", "std_die_qty", "large_die_qty", "machine_qty", "gst_pct", "items", "is_active"):
```

to:

```python
    for key in ("display_name", "base_price", "std_die_qty", "large_die_qty", "machine_qty", "gst_pct", "items", "is_active", "machine_category"):
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest backend/tests/test_machine_category.py::TestPackageMachineCategory -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/routes/inventory_routes.py backend/tests/test_machine_category.py
git commit -m "feat(packages): add machine_category field to Package model"
```

---

### Task 3: Backend — Catalogue filtering by machine_category + stock guard

**Files:**
- Modify: `backend/routes/quotation_routes.py:1597-1608` (`get_catalogue`)
- Modify: `backend/tests/test_machine_category.py` (append)

**Interfaces:**
- Consumes: `db.dies` docs with `machine_category` (Task 1), `db.packages` docs with `machine_category` (Task 2).
- Produces: `GET /catalogue/{token}` restricts `dies` to the package's `machine_category` (when set) and to dies with `stock_qty - reserved_qty > 0`; unchanged when the package has none.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_machine_category.py`:

```python
class TestCatalogueMachineCategoryFilter:
    """GET /catalogue/{token} restricts to matching, in-stock dies when the
    quotation's package has a machine_category; unaffected otherwise."""

    @pytest.fixture(scope="class", autouse=True)
    def setup_data(self, auth_session):
        cls = TestCatalogueMachineCategoryFilter
        cls.session = auth_session

        sp_resp = auth_session.get(f"{BASE_URL}/api/salespersons")
        sps = sp_resp.json()
        if sps:
            cls.sales_person_id = sps[0]["sales_person_id"]
        else:
            sp_create = auth_session.post(f"{BASE_URL}/api/salespersons", json={
                "name": "TEST_MC Salesperson",
                "email": f"test_mc_sp_{uuid.uuid4().hex[:6]}@smartshape.in",
                "phone": "9876543210",
            })
            cls.sales_person_id = sp_create.json()["sales_person_id"]

        pkg_resp = auth_session.post(f"{BASE_URL}/api/packages", json={
            "name": f"test_mc_pkg_{uuid.uuid4().hex[:6]}",
            "display_name": "TEST_MC Small Machine Package",
            "base_price": 10000, "gst_pct": 18, "machine_category": "small_machine",
            "items": [{"type": "machine", "name": "Small Machine", "qty": 1, "unit_price": 10000, "gst_pct": 18}],
        })
        cls.package_id = pkg_resp.json()["package_id"]

        cls.die_small_in_stock = auth_session.post(f"{BASE_URL}/api/dies", json={
            "code": f"TEST_MC_INSTOCK_{uuid.uuid4().hex[:6]}", "name": "Small Machine Die In Stock",
            "type": "standard", "machine_category": "small_machine", "stock_qty": 10, "min_level": 2,
        }).json()

        # Review Focus #2: zero available stock (fully reserved), not just zero stock_qty.
        cls.die_small_fully_reserved = auth_session.post(f"{BASE_URL}/api/dies", json={
            "code": f"TEST_MC_RESV_{uuid.uuid4().hex[:6]}", "name": "Small Machine Die Fully Reserved",
            "type": "standard", "machine_category": "small_machine", "stock_qty": 5, "min_level": 2,
        }).json()
        auth_session.post(f"{BASE_URL}/api/stock/movement", json={
            "die_id": cls.die_small_fully_reserved["die_id"],
            "movement_type": "allocated_to_sales", "quantity": 5,
            "sales_person_id": cls.sales_person_id,
        })

        cls.die_general = auth_session.post(f"{BASE_URL}/api/dies", json={
            "code": f"TEST_MC_GEN_{uuid.uuid4().hex[:6]}", "name": "General Die",
            "type": "standard", "stock_qty": 10, "min_level": 2,
        }).json()

        yield

        for die in (cls.die_small_in_stock, cls.die_small_fully_reserved, cls.die_general):
            auth_session.delete(f"{BASE_URL}/api/dies/{die['die_id']}")
        auth_session.delete(f"{BASE_URL}/api/packages/{cls.package_id}")

    def _create_quotation(self, package_id):
        cls = TestCatalogueMachineCategoryFilter
        resp = cls.session.post(f"{BASE_URL}/api/quotations", json={
            "package_id": package_id,
            "principal_name": "TEST_MC Principal",
            "school_name": "TEST_MC School",
            "sales_person_id": cls.sales_person_id,
            "lines": [{
                "description": "Small Machine Package", "qty": 1, "unit_price": 10000,
                "gst_pct": 18, "line_subtotal": 10000, "line_gst": 1800, "line_total": 11800,
                "sort_order": 1,
            }],
        })
        assert resp.status_code == 200, resp.text
        return resp.json()

    def test_small_machine_package_catalogue_shows_only_in_stock_small_machine_dies(self):
        cls = TestCatalogueMachineCategoryFilter
        quot = self._create_quotation(cls.package_id)
        resp = requests.get(f"{BASE_URL}/api/catalogue/{quot['catalogue_token']}")
        assert resp.status_code == 200, resp.text
        die_ids = {d["die_id"] for d in resp.json()["dies"]}
        assert cls.die_small_in_stock["die_id"] in die_ids
        assert cls.die_small_fully_reserved["die_id"] not in die_ids
        assert cls.die_general["die_id"] not in die_ids

    def test_package_without_machine_category_shows_unfiltered_catalogue(self):
        # Review Focus #1: no package -> today's behavior, unfiltered.
        cls = TestCatalogueMachineCategoryFilter
        quot = self._create_quotation(None)
        resp = requests.get(f"{BASE_URL}/api/catalogue/{quot['catalogue_token']}")
        assert resp.status_code == 200, resp.text
        die_ids = {d["die_id"] for d in resp.json()["dies"]}
        assert cls.die_general["die_id"] in die_ids

    def test_deleted_package_falls_back_to_unfiltered_catalogue(self):
        # Review Focus #3: package_id points at a package that no longer exists.
        cls = TestCatalogueMachineCategoryFilter
        ghost_pkg = cls.session.post(f"{BASE_URL}/api/packages", json={
            "name": f"test_mc_ghost_{uuid.uuid4().hex[:6]}",
            "display_name": "TEST_MC Ghost Package",
            "base_price": 1000, "gst_pct": 18, "machine_category": "small_machine", "items": [],
        }).json()
        quot = self._create_quotation(ghost_pkg["package_id"])
        cls.session.delete(f"{BASE_URL}/api/packages/{ghost_pkg['package_id']}")

        resp = requests.get(f"{BASE_URL}/api/catalogue/{quot['catalogue_token']}")
        assert resp.status_code == 200, resp.text
        die_ids = {d["die_id"] for d in resp.json()["dies"]}
        assert cls.die_general["die_id"] in die_ids
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest backend/tests/test_machine_category.py::TestCatalogueMachineCategoryFilter -v`
Expected: FAIL on `test_small_machine_package_catalogue_shows_only_in_stock_small_machine_dies` (today's catalogue returns every active die, so `die_general` and `die_small_fully_reserved` are both present).

- [ ] **Step 3: Implement**

In `backend/routes/quotation_routes.py`, change (`get_catalogue`, lines 1597-1608):

```python
    package_id = quot.get("package_id")
    package = None
    if package_id:
        package = await db.packages.find_one({"package_id": package_id}, {"_id": 0})
    dies = await db.dies.find({"is_active": True}, {"_id": 0}).to_list(1000)
    # Only show products whose product type is published to schools. Legacy products
    # with no product_type_id are treated as the built-in (visible) "Dies" type.
    visible_type_ids = {t["product_type_id"] async for t in db.product_types.find(
        {"visible_to_schools": True, "is_active": {"$ne": False}}, {"product_type_id": 1, "_id": 0})}
    visible_type_ids.add("ptype_dies")
    dies = [gate_die_for_customer(d) for d in dies
            if d.get("product_type_id", "ptype_dies") in visible_type_ids]
```

to:

```python
    package_id = quot.get("package_id")
    package = None
    if package_id:
        package = await db.packages.find_one({"package_id": package_id}, {"_id": 0})

    die_filter = {"is_active": True}
    pkg_machine_category = (package or {}).get("machine_category")
    if pkg_machine_category:
        die_filter["machine_category"] = pkg_machine_category
        # Never quote a die the school couldn't actually be fulfilled with.
        die_filter["$expr"] = {"$gt": [
            {"$subtract": ["$stock_qty", {"$ifNull": ["$reserved_qty", 0]}]}, 0]}
    dies = await db.dies.find(die_filter, {"_id": 0}).to_list(1000)
    # Only show products whose product type is published to schools. Legacy products
    # with no product_type_id are treated as the built-in (visible) "Dies" type.
    visible_type_ids = {t["product_type_id"] async for t in db.product_types.find(
        {"visible_to_schools": True, "is_active": {"$ne": False}}, {"product_type_id": 1, "_id": 0})}
    visible_type_ids.add("ptype_dies")
    dies = [gate_die_for_customer(d) for d in dies
            if d.get("product_type_id", "ptype_dies") in visible_type_ids]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest backend/tests/test_machine_category.py -v`
Expected: PASS (all tests in the file, Tasks 1-3)

- [ ] **Step 5: Commit**

```bash
git add backend/routes/quotation_routes.py backend/tests/test_machine_category.py
git commit -m "feat(catalogue): filter catalogue dies by package machine_category and stock"
```

---

### Task 4: Frontend — Die form "Machine Category" field

**Files:**
- Modify: `frontend/src/hooks/useInventory.js:19` (`BLANK_DIE`), `:163-173` (`openEdit`)
- Modify: `frontend/src/components/inventory/DieFormDialog.js:66-81` (create form), `:214-229` (edit form)
- Create: `frontend/src/components/inventory/__tests__/DieFormDialog.test.js`

**Interfaces:**
- Consumes: nothing from Tasks 1-3 (frontend is decoupled by the HTTP API).
- Produces: `newDie.machine_category` / `editForm.machine_category`, saved by the existing `diesApi.create`/`diesApi.update` calls (`frontend/src/lib/api.js:101-102`) with no change needed there, since both just forward whatever object they're given.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/inventory/__tests__/DieFormDialog.test.js`:

```javascript
// Smoke tests: the Die create/edit forms render a Machine Category select
// and report changes via setNewDie/setEditForm, same pattern as the
// existing die-size/category selects.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { CreateDieDialog, EditDieDialog } from '../DieFormDialog';
import { BLANK_DIE } from '../../../hooks/useInventory';

global.IS_REACT_ACT_ENVIRONMENT = true;

function mount(ui) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(ui); });
  return { container, unmount: () => act(() => root.unmount()) };
}

afterEach(() => { document.body.innerHTML = ''; });

test('create form defaults Machine Category to General and reports the change', () => {
  const setNewDie = jest.fn();
  const { unmount } = mount(
    <CreateDieDialog
      open onOpenChange={jest.fn()}
      newDie={BLANK_DIE} setNewDie={setNewDie}
      newDieImagePreview="" handleNewImageSelect={jest.fn()}
      handleCreateDie={jest.fn()} saving={false}
      inputCls="" textPri="" textSec="" textMuted="" dlgCls=""
    />
  );
  const select = document.querySelector('[data-testid="die-machine-category-select"]');
  expect(select.value).toBe('');
  act(() => {
    select.value = 'small_machine';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(setNewDie).toHaveBeenCalledWith({ ...BLANK_DIE, machine_category: 'small_machine' });
  unmount();
});

test('edit form shows the die\'s current Machine Category', () => {
  const setEditForm = jest.fn();
  const editForm = { ...BLANK_DIE, machine_category: 'small_machine' };
  const { unmount } = mount(
    <EditDieDialog
      open onOpenChange={jest.fn()}
      editTarget={{ die_id: 'die_1' }} editForm={editForm} setEditForm={setEditForm}
      handleSaveEdit={jest.fn()} saving={false}
      inputCls="" textPri="" textSec="" textMuted="" dlgCls=""
    />
  );
  const select = document.querySelector('[data-testid="die-machine-category-select"]');
  expect(select.value).toBe('small_machine');
  unmount();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx jest src/components/inventory/__tests__/DieFormDialog.test.js`
Expected: FAIL — `document.querySelector('[data-testid="die-machine-category-select"]')` returns `null` (element doesn't exist yet).

- [ ] **Step 3: Add `machine_category` default and edit-form mapping**

In `frontend/src/hooks/useInventory.js`, change:

```javascript
export const BLANK_DIE = { code:'', name:'', type:'standard', category:'decorative', min_level:5, description:'', stock_qty:0, product_type_id:'', video_url:'', show_video:false, show_description:false };
```

to:

```javascript
export const BLANK_DIE = { code:'', name:'', type:'standard', category:'decorative', min_level:5, description:'', stock_qty:0, product_type_id:'', video_url:'', show_video:false, show_description:false, machine_category:'' };
```

And in `openEdit` (same file), change:

```javascript
  const openEdit = (die) => {
    setEditTarget(die);
    setEditForm({
      code: die.code, name: die.name, type: die.type || 'standard',
      category: die.category || 'decorative', min_level: die.min_level ?? 5,
      description: die.description || '',
      product_type_id: die.product_type_id || '',
      video_url: die.video_url || '',
      show_video: !!die.show_video,
      show_description: !!die.show_description,
    });
```

to:

```javascript
  const openEdit = (die) => {
    setEditTarget(die);
    setEditForm({
      code: die.code, name: die.name, type: die.type || 'standard',
      category: die.category || 'decorative', min_level: die.min_level ?? 5,
      description: die.description || '',
      product_type_id: die.product_type_id || '',
      video_url: die.video_url || '',
      show_video: !!die.show_video,
      show_description: !!die.show_description,
      machine_category: die.machine_category || '',
    });
```

- [ ] **Step 4: Add the select to the create form**

In `frontend/src/components/inventory/DieFormDialog.js`, inside `CreateDieDialog`, change:

```javascript
            <div>
              <Label className={`${textSec} text-xs mb-1 block`}>Category</Label>
              <select value={newDie.category} onChange={e => setNewDie({...newDie, category: e.target.value})}
                className={`w-full h-11 px-3 rounded-md text-sm ${inputCls}`}>
                {CATEGORIES.map(c => <option key={c} value={c}>{CAT_LABELS[c]}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className={`${textSec} text-xs mb-1 block`}>Initial Stock</Label>
```

to:

```javascript
            <div>
              <Label className={`${textSec} text-xs mb-1 block`}>Category</Label>
              <select value={newDie.category} onChange={e => setNewDie({...newDie, category: e.target.value})}
                className={`w-full h-11 px-3 rounded-md text-sm ${inputCls}`}>
                {CATEGORIES.map(c => <option key={c} value={c}>{CAT_LABELS[c]}</option>)}
              </select>
            </div>
          </div>
          <div>
            <Label className={`${textSec} text-xs mb-1 block`}>Machine Category</Label>
            <select value={newDie.machine_category || ''} onChange={e => setNewDie({...newDie, machine_category: e.target.value})}
              className={`w-full h-11 px-3 rounded-md text-sm ${inputCls}`}
              data-testid="die-machine-category-select">
              <option value="">— General —</option>
              <option value="small_machine">Small Machine</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className={`${textSec} text-xs mb-1 block`}>Initial Stock</Label>
```

- [ ] **Step 5: Add the select to the edit form**

In the same file, inside `EditDieDialog`, change:

```javascript
            <div>
              <Label className={`${textSec} text-xs mb-1 block`}>Category</Label>
              <select value={editForm.category} onChange={e => setEditForm({...editForm, category: e.target.value})}
                className={`w-full h-11 px-3 rounded-md text-sm ${inputCls}`}>
                {CATEGORIES.map(c => <option key={c} value={c}>{CAT_LABELS[c]}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className={`${textSec} text-xs mb-1 block`}>Min Level</Label>
```

to:

```javascript
            <div>
              <Label className={`${textSec} text-xs mb-1 block`}>Category</Label>
              <select value={editForm.category} onChange={e => setEditForm({...editForm, category: e.target.value})}
                className={`w-full h-11 px-3 rounded-md text-sm ${inputCls}`}>
                {CATEGORIES.map(c => <option key={c} value={c}>{CAT_LABELS[c]}</option>)}
              </select>
            </div>
          </div>
          <div>
            <Label className={`${textSec} text-xs mb-1 block`}>Machine Category</Label>
            <select value={editForm.machine_category || ''} onChange={e => setEditForm({...editForm, machine_category: e.target.value})}
              className={`w-full h-11 px-3 rounded-md text-sm ${inputCls}`}
              data-testid="die-machine-category-select">
              <option value="">— General —</option>
              <option value="small_machine">Small Machine</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className={`${textSec} text-xs mb-1 block`}>Min Level</Label>
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd frontend && npx jest src/components/inventory/__tests__/DieFormDialog.test.js`
Expected: PASS (2 tests)

- [ ] **Step 7: Commit**

```bash
git add frontend/src/hooks/useInventory.js frontend/src/components/inventory/DieFormDialog.js frontend/src/components/inventory/__tests__/DieFormDialog.test.js
git commit -m "feat(inventory): add Machine Category select to Die create/edit forms"
```

---

### Task 5: Frontend — Package form "Machine Category" field

**Files:**
- Modify: `frontend/src/hooks/usePackageMaster.js:24` (`DEFAULT_FORM`), `:86-111` (`openEdit`, `duplicatePkg`), `:144-155` (`handleSave` payload)
- Modify: `frontend/src/components/packages/PackageFormPanel.js:180-189` (form JSX)
- Create: `frontend/src/components/packages/__tests__/PackageFormPanel.test.js`

**Interfaces:**
- Produces: `form.machine_category`, included in the `packages.create`/`packages.update` payload built in `handleSave`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/packages/__tests__/PackageFormPanel.test.js`:

```javascript
// Smoke test: the package form renders a Machine Category select and
// reports changes via setForm, same pattern as the GST/description fields.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import PackageFormPanel from '../PackageFormPanel';
import { DEFAULT_FORM } from '../../../hooks/usePackageMaster';

global.IS_REACT_ACT_ENVIRONMENT = true;

function mount(ui) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(ui); });
  return { container, unmount: () => act(() => root.unmount()) };
}

afterEach(() => { document.body.innerHTML = ''; });

test('renders Machine Category select and reports changes', () => {
  const setForm = jest.fn();
  const form = { ...DEFAULT_FORM, display_name: 'Small Machine Package', items: [{ type: 'machine', name: 'Machine', qty: 1, unit_price: 10000, gst_pct: 18 }] };
  const { unmount } = mount(
    <PackageFormPanel
      editPkg={null} form={form} setForm={setForm} nameInputRef={{ current: null }}
      saving={false} onSave={jest.fn()} onDiscard={jest.fn()} onRequestDelete={jest.fn()}
      addItem={jest.fn()} removeItem={jest.fn()} updateItem={jest.fn()}
      summary={{ subtotal: 10000, gst: 1800, total: 11800 }}
      textPri="" textSec="" textMuted="" borderCls="" card="" inputCls="" bg=""
    />
  );
  const select = document.querySelector('[data-testid="pkg-machine-category-select"]');
  expect(select.value).toBe('');
  act(() => {
    select.value = 'small_machine';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(setForm).toHaveBeenCalled();
  unmount();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx jest src/components/packages/__tests__/PackageFormPanel.test.js`
Expected: FAIL — the select doesn't exist yet.

- [ ] **Step 3: Add `machine_category` to form state**

In `frontend/src/hooks/usePackageMaster.js`, change:

```javascript
export const DEFAULT_FORM = { display_name: '', gst_pct: 18, description: '', is_active: true, items: [] };
```

to:

```javascript
export const DEFAULT_FORM = { display_name: '', gst_pct: 18, description: '', is_active: true, items: [], machine_category: '' };
```

In `openEdit`, change:

```javascript
  const openEdit = (pkg) => {
    setEditPkg(pkg);
    setForm({
      display_name: pkg.display_name || '',
      gst_pct:      pkg.gst_pct ?? 18,
      description:  pkg.description || '',
      is_active:    pkg.is_active !== false,
      items:        (pkg.items || []).map(i => ({ ...DEFAULT_ITEM, ...i })),
    });
    setEditorOpen(true);
  };
```

to:

```javascript
  const openEdit = (pkg) => {
    setEditPkg(pkg);
    setForm({
      display_name: pkg.display_name || '',
      gst_pct:      pkg.gst_pct ?? 18,
      description:  pkg.description || '',
      is_active:    pkg.is_active !== false,
      items:        (pkg.items || []).map(i => ({ ...DEFAULT_ITEM, ...i })),
      machine_category: pkg.machine_category || '',
    });
    setEditorOpen(true);
  };
```

In `duplicatePkg`, change:

```javascript
    setForm({
      display_name: `${pkg.display_name} (Copy)`,
      gst_pct:      pkg.gst_pct ?? 18,
      description:  pkg.description || '',
      is_active:    true,
      items:        (pkg.items || []).map(i => ({ ...DEFAULT_ITEM, ...i })),
    });
```

to:

```javascript
    setForm({
      display_name: `${pkg.display_name} (Copy)`,
      gst_pct:      pkg.gst_pct ?? 18,
      description:  pkg.description || '',
      is_active:    true,
      items:        (pkg.items || []).map(i => ({ ...DEFAULT_ITEM, ...i })),
      machine_category: pkg.machine_category || '',
    });
```

In `handleSave`, change:

```javascript
      const payload = {
        display_name: form.display_name.trim(),
        name:         form.display_name.trim().toLowerCase().replace(/\s+/g, '_'),
        description:  form.description,
        base_price:   subtotal,
        gst_pct:      form.gst_pct,
        is_active:    form.is_active,
        items:        form.items,
        std_die_qty:  form.items.filter(i => i.type === 'standard_die').reduce((s, i) => s + (i.qty || 0), 0),
        large_die_qty:form.items.filter(i => i.type === 'large_die').reduce((s, i) => s + (i.qty || 0), 0),
        machine_qty:  form.items.filter(i => i.type === 'machine').reduce((s, i) => s + (i.qty || 0), 0),
      };
```

to:

```javascript
      const payload = {
        display_name: form.display_name.trim(),
        name:         form.display_name.trim().toLowerCase().replace(/\s+/g, '_'),
        description:  form.description,
        base_price:   subtotal,
        gst_pct:      form.gst_pct,
        is_active:    form.is_active,
        items:        form.items,
        std_die_qty:  form.items.filter(i => i.type === 'standard_die').reduce((s, i) => s + (i.qty || 0), 0),
        large_die_qty:form.items.filter(i => i.type === 'large_die').reduce((s, i) => s + (i.qty || 0), 0),
        machine_qty:  form.items.filter(i => i.type === 'machine').reduce((s, i) => s + (i.qty || 0), 0),
        machine_category: form.machine_category || null,
      };
```

- [ ] **Step 4: Add the select to `PackageFormPanel`**

In `frontend/src/components/packages/PackageFormPanel.js`, change:

```javascript
            <div className="sm:col-span-2">
              <Label className={`${textMuted} text-[10px] uppercase tracking-wider mb-1.5 block`}>Description</Label>
              <Input
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className={`${inputCls} h-10`}
                placeholder="Brief description…"
              />
            </div>
            <div className="flex flex-col justify-end">
              <Label className={`${textMuted} text-[10px] uppercase tracking-wider mb-1.5 block`}>Status</Label>
```

to:

```javascript
            <div className="sm:col-span-2">
              <Label className={`${textMuted} text-[10px] uppercase tracking-wider mb-1.5 block`}>Description</Label>
              <Input
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className={`${inputCls} h-10`}
                placeholder="Brief description…"
              />
            </div>
            <div>
              <Label className={`${textMuted} text-[10px] uppercase tracking-wider mb-1.5 block`}>Machine Category</Label>
              <select
                value={form.machine_category || ''}
                onChange={e => setForm(f => ({ ...f, machine_category: e.target.value }))}
                className={`w-full ${inputCls} h-10 px-3 rounded-md text-sm`}
                data-testid="pkg-machine-category-select"
              >
                <option value="">— General —</option>
                <option value="small_machine">Small Machine</option>
              </select>
            </div>
            <div className="flex flex-col justify-end">
              <Label className={`${textMuted} text-[10px] uppercase tracking-wider mb-1.5 block`}>Status</Label>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx jest src/components/packages/__tests__/PackageFormPanel.test.js`
Expected: PASS (1 test)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/usePackageMaster.js frontend/src/components/packages/PackageFormPanel.js frontend/src/components/packages/__tests__/PackageFormPanel.test.js
git commit -m "feat(packages): add Machine Category select to Package form"
```

---

### Task 6: Frontend — client-side machine-category stock grouping helper

**Files:**
- Modify: `frontend/src/hooks/useStockManagement.js` (add exported helper, near the top with the other exported constants)
- Create: `frontend/src/hooks/__tests__/useStockManagement.test.js`

**Interfaces:**
- Consumes: a die array shaped like `GET /dies` responses (`stock_qty`, `reserved_qty`, `min_level`, `machine_category`).
- Produces: `groupDiesByMachineCategory(dies)` → `{ [category]: { dieCount, stockQty, reservedQty, lowStock: [...] } }`, category key is `"small_machine"` or `"general"`. Consumed by Task 7.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/hooks/__tests__/useStockManagement.test.js`:

```javascript
import { groupDiesByMachineCategory } from '../useStockManagement';

const die = (over) => ({
  die_id: 'd1', code: 'D1', name: 'Die 1',
  stock_qty: 10, reserved_qty: 0, min_level: 5,
  ...over,
});

test('groups dies by machine_category, general bucket for missing category', () => {
  const dies = [
    die({ die_id: 'd1', machine_category: 'small_machine', stock_qty: 10, reserved_qty: 0 }),
    die({ die_id: 'd2' }), // no machine_category at all
  ];
  const groups = groupDiesByMachineCategory(dies);
  expect(groups.small_machine.dieCount).toBe(1);
  expect(groups.general.dieCount).toBe(1);
});

test('a blank string machine_category is treated the same as missing (Review Focus #5)', () => {
  const dies = [die({ die_id: 'd3', machine_category: '' })];
  const groups = groupDiesByMachineCategory(dies);
  expect(groups.general.dieCount).toBe(1);
  expect(groups['']).toBeUndefined();
});

test('flags a die as low stock when available stock <= min_level', () => {
  const dies = [
    die({ die_id: 'd4', machine_category: 'small_machine', stock_qty: 5, reserved_qty: 4, min_level: 2 }), // available 1 <= 2
    die({ die_id: 'd5', machine_category: 'small_machine', stock_qty: 20, reserved_qty: 0, min_level: 2 }), // available 20 > 2
  ];
  const groups = groupDiesByMachineCategory(dies);
  const lowStockIds = groups.small_machine.lowStock.map(d => d.die_id);
  expect(lowStockIds).toEqual(['d4']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx jest src/hooks/__tests__/useStockManagement.test.js`
Expected: FAIL — `groupDiesByMachineCategory` is not exported yet.

- [ ] **Step 3: Implement the helper**

In `frontend/src/hooks/useStockManagement.js`, add (near the top, after the existing `MOVEMENT_COLORS` export):

```javascript
// Client-side grouping for the "stock by machine category" view — dies is
// already fetched in full via GET /dies (fetchData below), so no separate
// backend endpoint is needed. Missing or blank machine_category both fall
// into the "general" bucket.
export function groupDiesByMachineCategory(dies) {
  const groups = {};
  for (const die of dies) {
    const key = die.machine_category || 'general';
    if (!groups[key]) {
      groups[key] = { dieCount: 0, stockQty: 0, reservedQty: 0, lowStock: [] };
    }
    const g = groups[key];
    g.dieCount += 1;
    g.stockQty += die.stock_qty || 0;
    g.reservedQty += die.reserved_qty || 0;
    const available = (die.stock_qty || 0) - (die.reserved_qty || 0);
    if (available <= (die.min_level ?? 0)) {
      g.lowStock.push(die);
    }
  }
  return groups;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx jest src/hooks/__tests__/useStockManagement.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useStockManagement.js frontend/src/hooks/__tests__/useStockManagement.test.js
git commit -m "feat(stock): add client-side machine-category stock grouping helper"
```

---

### Task 7: Frontend — "Small Machine" stock section on the Stock Management page

**Files:**
- Modify: `frontend/src/hooks/useStockManagement.js` (expose grouped data from the hook)
- Modify: `frontend/src/pages/admin/StockManagement.js:14-26` (destructure), `:200-213` (render)

**Interfaces:**
- Consumes: `groupDiesByMachineCategory` (Task 6), `diesList` (already fetched by `fetchData`, `useStockManagement.js:43-56`).

- [ ] **Step 1: Expose the grouped data from the hook's return value**

In `frontend/src/hooks/useStockManagement.js`, find the hook's `return { ... }` statement (it currently returns `movements, diesList, salesPersonsList, holdings, loading, holdingsLoading, activeTab, setActiveTab, ...` — the same names destructured in `StockManagement.js:16-25`). Add one line right before the closing `};` of that return object:

```javascript
    machineCategoryGroups: groupDiesByMachineCategory(diesList),
```

- [ ] **Step 2: Destructure it in the page**

In `frontend/src/pages/admin/StockManagement.js`, change:

```javascript
  const {
    movements, diesList, salesPersonsList, holdings,
    loading, holdingsLoading,
    activeTab, setActiveTab,
    dialogOpen, setDialogOpen,
    expandedSp, setExpandedSp,
    movementForm, setMovementForm,
    stats, totalHeld,
    handleCreateMovement,
    handleDeleteMovement,
    bulkDeleteMovements,
  } = useStockManagement();
```

to:

```javascript
  const {
    movements, diesList, salesPersonsList, holdings,
    loading, holdingsLoading,
    activeTab, setActiveTab,
    dialogOpen, setDialogOpen,
    expandedSp, setExpandedSp,
    movementForm, setMovementForm,
    stats, totalHeld,
    handleCreateMovement,
    handleDeleteMovement,
    bulkDeleteMovements,
    machineCategoryGroups,
  } = useStockManagement();
```

- [ ] **Step 3: Render the Small Machine section on the holdings tab**

In the same file, change (`StockManagement.js:200-203`):

```javascript
        {/* ── Sales Team Holdings ── */}
        {activeTab === 'holdings' && (
          <div className="space-y-3" data-testid="sales-holdings">
            {holdingsLoading ? (
```

to:

```javascript
        {/* ── Sales Team Holdings ── */}
        {activeTab === 'holdings' && (
          <div className="space-y-3" data-testid="sales-holdings">
            {machineCategoryGroups.small_machine && (
              <div className={`${card} border rounded-xl p-4`} data-testid="small-machine-stock-section">
                <h3 className={`font-semibold text-sm ${textPri} mb-2`}>Small Machine Stock</h3>
                <p className={`text-xs ${textMuted} mb-3`}>
                  {machineCategoryGroups.small_machine.dieCount} dies · {machineCategoryGroups.small_machine.stockQty} in stock · {machineCategoryGroups.small_machine.reservedQty} reserved
                </p>
                {machineCategoryGroups.small_machine.lowStock.length > 0 ? (
                  <ul className="space-y-1">
                    {machineCategoryGroups.small_machine.lowStock.map(die => (
                      <li key={die.die_id} className={`text-xs ${textSec} flex justify-between`}>
                        <span>{die.code} — {die.name}</span>
                        <span className="text-red-400">{(die.stock_qty || 0) - (die.reserved_qty || 0)} available (min {die.min_level})</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-green-500">All small-machine dies above reorder level.</p>
                )}
              </div>
            )}
            {holdingsLoading ? (
```

(`card`, `textPri`, `textSec`, `textMuted` are the same style-variable constants already defined at `StockManagement.js:33-38` and used throughout this file.)

- [ ] **Step 4: Manual verification (no automated test — this step only wires already-tested pieces into a page)**

Run the frontend dev server, log in, open Stock Management → Holdings tab. Confirm:
- If no die has `machine_category = "small_machine"` yet, the section doesn't render (guarded by `machineCategoryGroups.small_machine &&`).
- After tagging a die as Small Machine (Task 4's new form field) with `stock_qty <= min_level`, the section appears and lists it under low stock.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useStockManagement.js frontend/src/pages/admin/StockManagement.js
git commit -m "feat(stock): show a Small Machine stock section on the holdings tab"
```

---

## After implementation (manual, not a coding task)

Once Tasks 1-7 are deployed, the owner (or sales admin) needs to do the one-time data tagging described in the spec: open Product Master and tag the small-machine-compatible dies with Machine Category = Small Machine, and tag the Small Machine package the same way in Package Master. From then on, any quotation built against that package automatically gets a small-machine-only, in-stock catalogue.
