# School Item Selection → Order Confirmation: Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Sales/Store a UI to see and act on `awaiting_confirmation` orders (Confirm / Reject / Edit items / Log a call), and give schools a real item-picker in the School Portal — both consuming the backend built in the prior plan (`2026-09-25-school-item-order-confirmation-backend.md`, live on production).

**Architecture:** The internal side adds one new tab to the existing Orders page, reusing the already-built order-detail/item-edit UI (it already has full add/remove/qty editing — it just needs `awaiting_confirmation` added to its editable-status list). The School Portal side extracts the die-selection grid already built for the public catalogue-token page into a shared component, mounts it in the portal behind the school's own session, and submits through one new backend endpoint pair that reuses `create_order_for_quotation` internally rather than duplicating order-creation logic. The School Portal keeps its existing free-text box alongside the new picker (dual flow) for anything not in the catalogue — this is a deliberate, low-risk choice over replacing it outright, see Task 7's rationale.

**Tech Stack:** FastAPI + Motor (backend, Task 1 only, mongomock-tested per the prior plan's convention). React + Tailwind + lucide-react (frontend). Frontend tests via `react-dom/client` + `act()` — this repo has no `@testing-library/react` (see `tests/test_reorder_motion.py`'s frontend-equivalent convention: `ContactsTab.test.js`, `useBulkSelect.test.js`).

**Spec:** `docs/superpowers/specs/2026-09-25-school-item-selection-order-confirmation-design.md` (Sub-projects B and D). Depends on: `docs/superpowers/plans/2026-09-25-school-item-order-confirmation-backend.md` (all 6 tasks + review fixes, merged to `main` at commit `0fe7e65`).

## Global Constraints

- Every new/changed frontend file must still pass `cd frontend && CI=false DISABLE_ESLINT_PLUGIN=true GENERATE_SOURCEMAP=false npx react-scripts build` (this repo's pre-existing `eslint-plugin-react-hooks` resolution issue means the default `CI=true` build fails on unrelated files — always build with the flags above to check for real compile errors).
- `awaiting_confirmation` orders must never be offered as a target in the generic "Change Status" dropdown (`OrdersManagement.js`) — the backend rejects that transition (`update_order_status` 400s on it) by design; Confirm/Reject are the only ways out.
- Reuse the existing `OrderDetailPanel`/`handleAddItem`/`handleUpdateItemQty`/`handleRemoveItem` for item editing on an awaiting order — do not build a second item-editing UI. It already exists and the backend already supports it end-to-end.
- The School Portal's new picker submits to a NEW school-session-authenticated endpoint pair, not the public token-based `/catalogue/{token}` — a school reordering later isn't tied to one quotation the way the public catalogue link is.

## Review Focus

- An `awaiting_confirmation` order must not show up in the main "Orders" tab's default (unfiltered) view — it hasn't been confirmed yet and doesn't belong in the normal fulfillment list. Confirmed by filtering it out of `filteredOrders` when `statusFilter === 'all'` (Task 3) and by giving it its own tab (Task 4/5).
- Rejecting an order with an empty/whitespace-only reason must be blocked client-side (immediate feedback) as well as server-side (already enforced) — a person who doesn't read error toasts closely should still see the Reject button visibly refuse to submit.
- The School Portal catalogue submission (Task 1) must create the order with `sales_person_email` correctly denormalized from the school's `assigned_to` — otherwise the new "own"-scoped RBAC grant means the rep who should see it in the awaiting-confirmation tab can't.
- Confirm/Reject/Log-call buttons in the new tab must be scoped to `canManageSelection` (admin/accounts/store) the same way the rest of `OrdersManagement.js` already gates Manage Selection — a sales rep viewing this tab should still be able to act on their OWN orders (the backend enforces ownership already; the frontend must not additionally hide the buttons from reps who should see them for their own orders).
- Extracting `DieSelectionGrid` out of `CataloguePage.js` must not change that page's existing behavior at all — regression-tested by keeping `CataloguePage.js`'s own package-limit logic (`stdLimit`/`largeLimit`) outside the extracted component, passed in as props.

---

### Task 1: School Portal catalogue browse + submit endpoints (backend)

**Files:**
- Modify: `backend/routes/school_routes.py` (two new endpoints)
- Test: `backend/tests/test_school_portal_catalogue.py` (new)

**Interfaces:**
- Consumes: `create_order_for_quotation` (from `routes.order_routes`, already built), `gate_die_for_customer` (from `media_utils`), `get_current_school` (from `auth_utils`, already imported in `school_routes.py`).
- Produces: `GET /school/catalogue` → `{dies, logo_url, school_name}`. `POST /school/catalogue/submit` (body `{selections: [{die_id, quantity}]}`) → `{message, order}` — consumed by Task 7's frontend picker.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_school_portal_catalogue.py
"""The School Portal's real item-picker: a school browses active, visible
dies and submits a selection, which becomes an awaiting_confirmation order —
reusing create_order_for_quotation (no stock reserved yet, sales_person_email
denormalized from the school's assigned rep) rather than a parallel path.
mongomock — see tests/test_reorder_motion.py."""
import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

import routes.school_routes as sr
import routes.order_routes as ordr


class FakeRequest:
    def __init__(self, body=None):
        self._body = body or {}
        self.cookies = {}
        self.headers = {}

    async def json(self):
        return self._body


SCHOOL = {"school_id": "s1", "school_name": "Delhi Public School", "assigned_to": "parul@ss.in"}


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(sr, "db", d, raising=False)
    monkeypatch.setattr(ordr, "db", d, raising=False)

    async def _me(_request):
        return SCHOOL
    monkeypatch.setattr(sr, "get_current_school", _me)
    return d


def _run(coro):
    return asyncio.run(coro)


async def _seed_dies(db):
    await db.dies.insert_one({"die_id": "d1", "name": "Star", "code": "D-1", "type": "standard",
                              "is_active": True, "stock_qty": 10, "reserved_qty": 0})
    await db.dies.insert_one({"die_id": "d2", "name": "Heart", "code": "D-2", "type": "standard",
                              "is_active": False, "stock_qty": 10, "reserved_qty": 0})  # inactive — hidden


def test_catalogue_lists_only_active_dies(db):
    async def go():
        await _seed_dies(db)
        resp = await sr.school_catalogue(FakeRequest())
        codes = {d["code"] for d in resp["dies"]}
        assert codes == {"D-1"}
        assert resp["school_name"] == "Delhi Public School"
    _run(go())


def test_submitting_a_selection_creates_an_awaiting_confirmation_order(db):
    async def go():
        await _seed_dies(db)
        resp = await sr.school_catalogue_submit(FakeRequest({"selections": [{"die_id": "d1", "quantity": 4}]}))
        assert resp["order"]["order_id"]

        order = await db.orders.find_one({"order_id": resp["order"]["order_id"]}, {"_id": 0})
        assert order["order_status"] == "awaiting_confirmation"
        assert order["sales_person_email"] == "parul@ss.in"
        assert order["school_id"] == "s1"

        die = await db.dies.find_one({"die_id": "d1"}, {"_id": 0})
        assert die["reserved_qty"] == 0, "nothing reserved before Confirm"

        items = await db.order_items.find({"order_id": order["order_id"]}, {"_id": 0}).to_list(10)
        assert items[0]["quantity"] == 4
        assert items[0]["status"] == "awaiting_confirmation"
    _run(go())


def test_submitting_with_nothing_selected_is_a_400(db):
    async def go():
        await _seed_dies(db)
        with pytest.raises(Exception) as exc:
            await sr.school_catalogue_submit(FakeRequest({"selections": []}))
        assert exc.value.status_code == 400
    _run(go())


def test_duplicate_die_ids_are_summed(db):
    async def go():
        await _seed_dies(db)
        await sr.school_catalogue_submit(FakeRequest({"selections": [
            {"die_id": "d1", "quantity": 2}, {"die_id": "d1", "quantity": 3}]}))
        items = await db.order_items.find({}, {"_id": 0}).to_list(10)
        assert len(items) == 1
        assert items[0]["quantity"] == 5
    _run(go())
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_school_portal_catalogue.py -v`
Expected: FAIL — `AttributeError: module 'routes.school_routes' has no attribute 'school_catalogue'`.

- [ ] **Step 3: Add the endpoints**

In `backend/routes/school_routes.py`, add the import (alongside the existing imports near the top):
```python
from media_utils import gate_die_for_customer
```

Then add, right after the existing `school_reorder` endpoint (currently ends around line 184):
```python
@router.get("/school/catalogue")
async def school_catalogue(request: Request):
    """The School Portal's own item-picker source — every active die the
    school is allowed to see, same visibility rule as the public catalogue
    link (quotation_routes.py:1582) minus the package/machine_category
    narrowing, since a Portal reorder isn't tied to one quotation."""
    school = await get_current_school(request)
    dies = await db.dies.find({"is_active": True}, {"_id": 0}).to_list(1000)
    visible_type_ids = {t["product_type_id"] async for t in db.product_types.find(
        {"visible_to_schools": True, "is_active": {"$ne": False}}, {"product_type_id": 1, "_id": 0})}
    visible_type_ids.add("ptype_dies")
    dies = [gate_die_for_customer(d) for d in dies
            if d.get("product_type_id", "ptype_dies") in visible_type_ids]
    company_s = await db.settings.find_one({"type": "company"}, {"_id": 0}) or {}
    logo_raw = company_s.get("logo_url", "")
    fe_url = os.environ.get("FRONTEND_URL", "").rstrip("/")
    logo_url = (fe_url + logo_raw) if logo_raw.startswith("/") else logo_raw
    return {"dies": dies, "logo_url": logo_url, "school_name": school.get("school_name", "")}


@router.post("/school/catalogue/submit")
async def school_catalogue_submit(request: Request):
    """Submitting a Portal Reorder selection: builds a lightweight quotation +
    catalogue selection on the fly (there is no pre-existing quotation to
    submit against, unlike the token-based catalogue flow) and hands off to
    create_order_for_quotation — same order-creation path, same
    awaiting_confirmation deferred-reservation behaviour, no duplicated logic.
    Pricing is intentionally left at 0: this is exactly the case the
    Confirm-call workflow exists for — Sales quotes it when they call."""
    school = await get_current_school(request)
    body = await request.json()
    raw_selections = body.get("selections") or []
    qty_by_die = {}
    for sel in raw_selections:
        die_id = sel.get("die_id") if isinstance(sel, dict) else sel
        if not die_id:
            continue
        qty = max(1, int(sel.get("quantity", 1) or 1) if isinstance(sel, dict) else 1)
        qty_by_die[die_id] = qty_by_die.get(die_id, 0) + qty
    if not qty_by_die:
        raise HTTPException(status_code=400, detail="Select at least one item")

    now_iso = datetime.now(timezone.utc).isoformat()
    quotation_id = f"quot_{uuid.uuid4().hex[:12]}"
    quote_num_count = await db.quotations.count_documents({})
    await db.quotations.insert_one({
        "quotation_id": quotation_id,
        "quote_number": f"REORDER-{datetime.now(timezone.utc).year}-{quote_num_count + 1:04d}",
        "school_id": school["school_id"],
        "school_name": school.get("school_name", ""),
        "sales_person_email": school.get("assigned_to", ""),
        "package_id": None, "package_name": "",
        "lines": [], "grand_total": 0,
        "quotation_status": "pending",
        "source": "school_portal_reorder",
        "created_by": school["school_id"],
        "created_at": now_iso, "updated_at": now_iso,
    })
    selection_id = f"sel_{uuid.uuid4().hex[:12]}"
    await db.catalogue_selections.insert_one({
        "selection_id": selection_id, "quotation_id": quotation_id,
        "submitted_at": now_iso, "source": "school_portal",
    })
    for die_id, qty in qty_by_die.items():
        die = await db.dies.find_one({"die_id": die_id}, {"_id": 0})
        if not die:
            continue
        await db.catalogue_selection_items.insert_one({
            "catalogue_selection_id": selection_id, "die_id": die_id,
            "die_name": die["name"], "die_code": die["code"],
            "die_type": die["type"], "die_image_url": die.get("image_url"),
            "quantity": qty,
        })

    from routes.order_routes import create_order_for_quotation
    order, created = await create_order_for_quotation(
        quotation_id, created_by=school["school_id"], source="school_portal_reorder",
        order_status="awaiting_confirmation",
    )
    await _notify_admin_school_action(school, "submitted a reorder selection")
    return {"message": "Selection submitted successfully",
            "order": {"order_id": order["order_id"], "order_number": order["order_number"]}}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_school_portal_catalogue.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Run the backend order-confirmation suite to confirm no regression**

Run: `cd backend && python -m pytest tests/test_order_confirmation_status.py tests/test_order_confirmation_rbac.py tests/test_order_confirmation_creation.py tests/test_order_confirm_reject.py tests/test_order_confirmation_edit_selection.py tests/test_order_call_log.py tests/test_order_review_fixes.py tests/test_order_cancel.py tests/test_order_diff.py tests/test_school_portal_catalogue.py -v`
Expected: PASS (55 tests: 51 from the prior plan + 4 new here)

- [ ] **Step 6: Commit**

```bash
git add backend/routes/school_routes.py backend/tests/test_school_portal_catalogue.py
git commit -m "feat(school-portal): browse-catalogue + submit endpoints for the real item-picker"
```

---

### Task 2: `lib/api.js` + `ordersUtils.js` — new methods and status entry

**Files:**
- Modify: `frontend/src/lib/api.js` (`orders` export, `schoolAuth` export)
- Modify: `frontend/src/lib/ordersUtils.js` (`ORDER_STATUSES`)

**Interfaces:**
- Produces: `orders.confirm(id)`, `orders.reject(id, reason)`, `orders.logCall(id, data)`, `orders.getCalls(id)` — consumed by Task 3.
- Produces: `schoolAuth.browseCatalogue()`, `schoolAuth.submitCatalogue(selections)` — consumed by Task 7.
- Produces: `ORDER_STATUSES` gains one entry `{id: 'awaiting_confirmation', ...}` — consumed by Task 4/5/6 for badge display. This is a data-only change with no independent test; verified through Task 4/5's component tests asserting the correct label/color render.

- [ ] **Step 1: Add the `orders` methods**

In `frontend/src/lib/api.js`, inside the `orders` export (currently ends with `delete: ...` around line 762), add before the closing `};`:
```js
  // Awaiting-confirmation lifecycle (school/teacher submitted, staff review)
  confirm: (id) => API.post(`/orders/${id}/confirm`),
  reject: (id, reason) => API.post(`/orders/${id}/reject`, { reason }),
  logCall: (id, data) => API.post(`/orders/${id}/calls`, data),
  getCalls: (id) => API.get(`/orders/${id}/calls`),
```

- [ ] **Step 2: Add the `schoolAuth` methods**

In `frontend/src/lib/api.js`, inside the `schoolAuth` export (currently ends with `uploadPO: ...` around line 837), add before the closing `};`:
```js
  // Portal Reorder — real item-picker (alongside the free-text box for anything not in the catalogue)
  browseCatalogue: () => API.get('/school/catalogue'),
  submitCatalogue: (selections) => API.post('/school/catalogue/submit', { selections }),
```

- [ ] **Step 3: Add the status entry**

In `frontend/src/lib/ordersUtils.js`, add `AlertCircle` to the lucide-react import and add the new entry to `ORDER_STATUSES` (as the FIRST entry, since an awaiting order precedes "pending" in the lifecycle):
```js
import { Clock, ShieldCheck, Truck, PackageCheck, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
```
```js
export const ORDER_STATUSES = [
  { id: 'awaiting_confirmation', label: 'Awaiting Confirmation', icon: AlertCircle, color: 'text-amber-400 bg-amber-500/10 border-amber-500/30' },
  { id: 'pending',   label: 'Pending',   icon: Clock,       color: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30' },
  { id: 'confirmed', label: 'Confirmed', icon: ShieldCheck, color: 'text-blue-400 bg-blue-500/10 border-blue-500/30' },
  { id: 'partially_dispatched', label: 'Partially Dispatched', icon: PackageCheck, color: 'text-amber-400 bg-amber-500/10 border-amber-500/30' },
  { id: 'dispatched',label: 'Dispatched',icon: Truck,       color: 'text-purple-400 bg-purple-500/10 border-purple-500/30' },
  { id: 'delivered', label: 'Delivered', icon: CheckCircle, color: 'text-green-400 bg-green-500/10 border-green-500/30' },
  { id: 'cancelled', label: 'Cancelled', icon: XCircle,     color: 'text-red-400 bg-red-500/10 border-red-500/30' },
];
```

- [ ] **Step 4: Verify the build still compiles**

Run: `cd frontend && CI=false DISABLE_ESLINT_PLUGIN=true GENERATE_SOURCEMAP=false npx react-scripts build 2>&1 | tail -20`
Expected: `Compiled successfully` (or pre-existing unrelated warnings only — no new errors referencing `api.js` or `ordersUtils.js`).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api.js frontend/src/lib/ordersUtils.js
git commit -m "feat(orders): API client methods + status entry for awaiting-confirmation"
```

---

### Task 3: `useOrdersManagement.js` — handlers + default-view exclusion

**Files:**
- Modify: `frontend/src/hooks/useOrdersManagement.js`
- Test: `frontend/src/hooks/__tests__/useOrdersManagement.test.js` (new)

**Interfaces:**
- Consumes: `orders.confirm/reject/logCall` (Task 2).
- Produces: `handleConfirmOrder(orderId)`, `handleRejectOrder(orderId, reason)`, `handleLogCall(orderId, data)` — all async, call the API, toast, then `fetchData()`. `filteredOrders` now excludes `awaiting_confirmation` when `statusFilter === 'all'`. `stats.awaitingConfirmation` — count, consumed by Task 5's tab label/stat tile.

- [ ] **Step 1: Write the failing test**

```javascript
// frontend/src/hooks/__tests__/useOrdersManagement.test.js
// The 3 new awaiting-confirmation handlers (Confirm/Reject/Log-call) follow
// the exact call→toast→refetch shape every other mutation here already uses
// (see handleAddItem). filteredOrders must exclude awaiting_confirmation
// orders from the default ('all') view — they haven't been confirmed as
// real orders yet. Probe pattern via react-dom/client — no
// @testing-library/react in this repo (same as ContactsTab.test.js).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

const ok = (data) => Promise.resolve({ data });
const confirmMock = jest.fn(() => ok({ message: 'Order confirmed' }));
const rejectMock = jest.fn(() => ok({ message: 'Order rejected' }));
const logCallMock = jest.fn(() => ok({ note_id: 'n1' }));

let ORDERS = [];

jest.mock('../../lib/api', () => ({
  orders: {
    getAll: () => Promise.resolve({ data: ORDERS }),
    get: (id) => Promise.resolve({ data: ORDERS.find(o => o.order_id === id) }),
    confirm: (...a) => confirmMock(...a),
    reject: (...a) => rejectMock(...a),
    logCall: (...a) => logCallMock(...a),
  },
  holds: { getAll: () => Promise.resolve({ data: [] }) },
  quotations: { getAll: () => Promise.resolve({ data: [] }) },
  dispatches: { getAll: () => Promise.resolve({ data: [] }) },
  dispatchApi: {},
  dies: { getAll: () => Promise.resolve({ data: [] }) },
  downloadBlob: () => {},
}));
jest.mock('../../lib/dataSync', () => ({ useDataSync: () => {}, useAutoRefresh: () => {} }));
jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { email: 'store@ss.in', role: 'store' } }) }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

// eslint-disable-next-line import/first
import useOrdersManagement from '../useOrdersManagement';

global.IS_REACT_ACT_ENVIRONMENT = true;

let api = null;
function Probe() {
  api = useOrdersManagement();
  return null;
}

async function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<Probe />); });
  return { unmount: () => act(() => root.unmount()) };
}

const set = async (fn) => { await act(async () => { await fn(); }); };

let view;
beforeEach(() => {
  ORDERS = [
    { order_id: 'o1', order_number: 'ORD-1', order_status: 'awaiting_confirmation', school_name: 'DPS' },
    { order_id: 'o2', order_number: 'ORD-2', order_status: 'pending', school_name: 'Lotus Valley' },
  ];
  confirmMock.mockClear(); rejectMock.mockClear(); logCallMock.mockClear();
});
afterEach(() => { view && view.unmount(); api = null; });

test('filteredOrders excludes awaiting_confirmation when statusFilter is all', async () => {
  view = await mount();
  expect(api.filteredOrders.map(o => o.order_id)).toEqual(['o2']);
});

test('explicitly filtering by awaiting_confirmation still shows it', async () => {
  view = await mount();
  await set(() => api.setStatusFilter('awaiting_confirmation'));
  expect(api.filteredOrders.map(o => o.order_id)).toEqual(['o1']);
});

test('stats.awaitingConfirmation counts them', async () => {
  view = await mount();
  expect(api.stats.awaitingConfirmation).toBe(1);
});

test('handleConfirmOrder calls the API and refetches', async () => {
  view = await mount();
  await set(() => api.handleConfirmOrder('o1'));
  expect(confirmMock).toHaveBeenCalledWith('o1');
});

test('handleRejectOrder calls the API with the reason', async () => {
  view = await mount();
  await set(() => api.handleRejectOrder('o1', 'Duplicate'));
  expect(rejectMock).toHaveBeenCalledWith('o1', 'Duplicate');
});

test('handleLogCall calls the API with the call data', async () => {
  view = await mount();
  await set(() => api.handleLogCall('o1', { outcome: 'connected', content: 'ok' }));
  expect(logCallMock).toHaveBeenCalledWith('o1', { outcome: 'connected', content: 'ok' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && CI=true npx craco test src/hooks/__tests__/useOrdersManagement.test.js --watchAll=false 2>&1 | tail -30`
Expected: FAIL — `TypeError: api.handleConfirmOrder is not a function` (and the two `filteredOrders`/`stats` tests fail because awaiting_confirmation isn't excluded/counted yet).

- [ ] **Step 3: Add the handlers and update the computed values**

In `frontend/src/hooks/useOrdersManagement.js`, add the three handlers right after `handleRemoveItem` (currently ends around line 114):
```js
  // ── Awaiting-confirmation lifecycle ──────────────────────────────────────
  const handleConfirmOrder = async (orderId) => {
    try {
      await ordersApi.confirm(orderId);
      toast.success('Order confirmed — stock reserved');
      fetchData();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed to confirm order'); }
  };

  const handleRejectOrder = async (orderId, reason) => {
    try {
      await ordersApi.reject(orderId, reason);
      toast.success('Order rejected');
      fetchData();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed to reject order'); }
  };

  const handleLogCall = async (orderId, data) => {
    try {
      await ordersApi.logCall(orderId, data);
      toast.success('Call logged');
      fetchData();
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed to log call'); }
  };
```

Change `filteredOrders` (currently lines 345-356):
```js
  const filteredOrders = ordersList.filter(o => {
    if (statusFilter === 'all' && o.order_status === 'awaiting_confirmation') return false;
    if (statusFilter !== 'all' && o.order_status !== statusFilter) return false;
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      return (
        (o.school_name   || '').toLowerCase().includes(s) ||
        (o.order_number  || '').toLowerCase().includes(s) ||
        (o.quote_number  || '').toLowerCase().includes(s)
      );
    }
    return true;
  });
```

Add to `stats` (currently lines 358-365):
```js
  const stats = {
    total:       ordersList.length,
    awaitingConfirmation: ordersList.filter(o => o.order_status === 'awaiting_confirmation').length,
    pending:     ordersList.filter(o => o.order_status === 'pending').length,
    confirmed:   ordersList.filter(o => o.order_status === 'confirmed').length,
    dispatched:  ordersList.filter(o => o.order_status === 'dispatched').length,
    delivered:   ordersList.filter(o => o.order_status === 'delivered').length,
    activeHolds: holdsList.length,
  };
```

Add to the return object (alongside `handleAddItem, handleUpdateItemQty, handleRemoveItem,` currently line 382):
```js
    handleAddItem, handleUpdateItemQty, handleRemoveItem,
    handleConfirmOrder, handleRejectOrder, handleLogCall,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && CI=true npx craco test src/hooks/__tests__/useOrdersManagement.test.js --watchAll=false 2>&1 | tail -20`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useOrdersManagement.js frontend/src/hooks/__tests__/useOrdersManagement.test.js
git commit -m "feat(orders): Confirm/Reject/Log-call handlers, exclude awaiting orders from default view"
```

---

### Task 4: `OrderDetailPanel.js` — reuse existing item-edit UI for awaiting orders

**Files:**
- Modify: `frontend/src/components/orders/OrderDetailPanel.js`

**Interfaces:**
- Consumes: nothing new. Produces: `EDITABLE_ORDER_STATUSES` and `CANCEL_BLOCK` both updated — no new test file (this is a 2-line data change to constants already exercised structurally by the existing `editable`/`cancellable` logic; verified by the manual check in Step 3, consistent with this file having no pre-existing test suite to extend).

- [ ] **Step 1: Make the change**

In `frontend/src/components/orders/OrderDetailPanel.js`, change (currently lines 13, 15):
```js
const CANCEL_BLOCK = ['cancelled', 'dispatched', 'delivered', 'awaiting_confirmation'];

const EDITABLE_ORDER_STATUSES = ['pending', 'confirmed', 'awaiting_confirmation'];
```

Why both: `EDITABLE_ORDER_STATUSES` turns on the existing add/remove/qty-change UI (already fully built, lines 103-198) for an awaiting order — this is the "Edit Items" action, reusing this panel entirely rather than building a second one. `CANCEL_BLOCK` hides the "Cancel (not finalising)" button on an awaiting order — the backend's `cancel_order` now refuses that status (see the prior plan's review fix #5) and points to Reject instead, so the button must not appear only to 400 when clicked.

- [ ] **Step 2: Verify the build still compiles**

Run: `cd frontend && CI=false DISABLE_ESLINT_PLUGIN=true GENERATE_SOURCEMAP=false npx react-scripts build 2>&1 | tail -20`
Expected: `Compiled successfully` (or pre-existing unrelated warnings only).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/orders/OrderDetailPanel.js
git commit -m "feat(orders): reuse the existing item-edit UI for awaiting-confirmation orders"
```

---

### Task 5: `AwaitingConfirmationTab.js` — the new tab component

**Files:**
- Create: `frontend/src/components/orders/AwaitingConfirmationTab.js`
- Test: `frontend/src/components/orders/__tests__/AwaitingConfirmationTab.test.js` (new)

**Interfaces:**
- Consumes: `ORDER_STATUSES` (Task 2), the `orders` prop (array, pre-filtered by the parent to `order_status === 'awaiting_confirmation'`), and 4 handler props: `onConfirm(orderId)`, `onReject(orderId, reason)`, `onLogCall(orderId, data)`, `onOpenDetail(order)`.
- Produces: default export `AwaitingConfirmationTab({ orders, onConfirm, onReject, onLogCall, onOpenDetail, textPri, textSec, textMuted, inputCls, card, dlgCls })` — consumed by Task 6.

- [ ] **Step 1: Write the failing test**

```javascript
// frontend/src/components/orders/__tests__/AwaitingConfirmationTab.test.js
// Row actions (Confirm / Reject / Log a call / View-Edit) and the two local
// dialogs (Reject needs a reason, Log-call needs an outcome). No
// @testing-library/react in this repo — react-dom/client + act(), same
// pattern as ContactsTab.test.js / useBulkSelect.test.js.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import AwaitingConfirmationTab from '../AwaitingConfirmationTab';

global.IS_REACT_ACT_ENVIRONMENT = true;

const STYLES = { textPri: 'p', textSec: 's', textMuted: 'm', inputCls: 'i', card: 'c', dlgCls: 'd' };
const ORDERS = [
  { order_id: 'o1', order_number: 'ORD-1', school_name: 'DPS', total_items: 2, grand_total: 5000, created_at: '2026-09-25T00:00:00Z' },
];

let root, container;
let onConfirm, onReject, onLogCall, onOpenDetail;

async function mount(orders = ORDERS) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  onConfirm = jest.fn();
  onReject = jest.fn();
  onLogCall = jest.fn();
  onOpenDetail = jest.fn();
  await act(async () => {
    root.render(
      <AwaitingConfirmationTab
        orders={orders}
        onConfirm={onConfirm} onReject={onReject} onLogCall={onLogCall} onOpenDetail={onOpenDetail}
        {...STYLES}
      />
    );
  });
}

const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const setValue = async (el, value) => {
  await act(async () => {
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype
      : el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

afterEach(() => { act(() => root.unmount()); document.body.removeChild(container); });

test('renders one row per order with its number and school', async () => {
  await mount();
  expect(container.querySelector('[data-testid="awaiting-order-ORD-1"]')).toBeTruthy();
  expect(container.textContent).toContain('DPS');
});

test('an empty list shows an empty state instead of a blank page', async () => {
  await mount([]);
  expect(container.textContent.toLowerCase()).toContain('no orders');
});

test('clicking Confirm calls onConfirm with the order id', async () => {
  await mount();
  await click(container.querySelector('[data-testid="confirm-order-ORD-1"]'));
  expect(onConfirm).toHaveBeenCalledWith('o1');
});

test('clicking View/Edit calls onOpenDetail with the order', async () => {
  await mount();
  await click(container.querySelector('[data-testid="edit-order-ORD-1"]'));
  expect(onOpenDetail).toHaveBeenCalledWith(ORDERS[0]);
});

test('Reject requires a reason before it will submit', async () => {
  await mount();
  await click(container.querySelector('[data-testid="reject-order-ORD-1"]'));
  await click(container.querySelector('[data-testid="reject-submit"]'));
  expect(onReject).not.toHaveBeenCalled();
  expect(container.textContent.toLowerCase()).toContain('reason');
});

test('Reject submits the typed reason', async () => {
  await mount();
  await click(container.querySelector('[data-testid="reject-order-ORD-1"]'));
  await setValue(container.querySelector('[data-testid="reject-reason-input"]'), 'Duplicate submission');
  await click(container.querySelector('[data-testid="reject-submit"]'));
  expect(onReject).toHaveBeenCalledWith('o1', 'Duplicate submission');
});

test('Log a call submits the chosen outcome and note', async () => {
  await mount();
  await click(container.querySelector('[data-testid="call-order-ORD-1"]'));
  await setValue(container.querySelector('[data-testid="call-outcome-select"]'), 'connected');
  await setValue(container.querySelector('[data-testid="call-content-input"]'), 'Will confirm 20 units');
  await click(container.querySelector('[data-testid="call-submit"]'));
  expect(onLogCall).toHaveBeenCalledWith('o1', { outcome: 'connected', content: 'Will confirm 20 units' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && CI=true npx craco test src/components/orders/__tests__/AwaitingConfirmationTab.test.js --watchAll=false 2>&1 | tail -20`
Expected: FAIL — `Cannot find module '../AwaitingConfirmationTab'`.

- [ ] **Step 3: Write the component**

```javascript
// frontend/src/components/orders/AwaitingConfirmationTab.js
import React, { useState } from 'react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { formatCurrency, formatDate } from '../../lib/utils';
import { Eye, CheckCircle2, XCircle, Phone } from 'lucide-react';

const CALL_OUTCOMES = [
  ['connected', 'Connected'], ['no_answer', 'No answer'], ['busy', 'Busy'],
  ['wrong_number', 'Wrong number'], ['callback', 'Asked to call back'], ['failed', 'Failed'],
];

export default function AwaitingConfirmationTab({
  orders = [], onConfirm, onReject, onLogCall, onOpenDetail,
  textPri, textSec, textMuted, inputCls, card, dlgCls,
}) {
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState('');

  const [callTarget, setCallTarget] = useState(null);
  const [callForm, setCallForm] = useState({ outcome: '', content: '' });

  const openReject = (order) => { setRejectTarget(order); setRejectReason(''); setRejectError(''); };
  const submitReject = () => {
    if (!rejectReason.trim()) { setRejectError('A reason is required to reject a selection'); return; }
    onReject(rejectTarget.order_id, rejectReason.trim());
    setRejectTarget(null);
  };

  const openCall = (order) => { setCallTarget(order); setCallForm({ outcome: '', content: '' }); };
  const submitCall = () => {
    if (!callForm.outcome) return;
    onLogCall(callTarget.order_id, callForm);
    setCallTarget(null);
  };

  if (orders.length === 0) {
    return (
      <div className={`${card} border rounded-md p-12 text-center`} data-testid="awaiting-empty">
        <p className={textMuted}>No orders awaiting confirmation right now.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="awaiting-confirmation-list">
      {orders.map(order => (
        <div key={order.order_id} className={`${card} border rounded-md p-4`} data-testid={`awaiting-order-${order.order_number}`}>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono text-sm text-[#e94560] font-medium">{order.order_number}</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium border text-amber-400 bg-amber-500/10 border-amber-500/30">
                  Awaiting Confirmation
                </span>
              </div>
              <h3 className={`text-base font-medium ${textPri} truncate`}>{order.school_name}</h3>
              <div className={`flex flex-wrap items-center gap-3 mt-1 text-xs ${textMuted}`}>
                <span>{order.total_items} items</span>
                <span>{formatDate(order.created_at)}</span>
              </div>
            </div>
            <div className="flex items-center justify-between sm:justify-end gap-2 flex-shrink-0">
              <span className={`font-mono text-base sm:text-lg font-bold ${textPri}`}>{formatCurrency(order.grand_total)}</span>
              <div className="flex items-center gap-1.5">
                <Button variant="outline" size="sm" onClick={() => onOpenDetail(order)}
                  className={`border-[var(--border-color)] ${textSec} h-8 w-8 p-0 sm:h-9 sm:w-auto sm:px-3`}
                  data-testid={`edit-order-${order.order_number}`} title="View / edit items">
                  <Eye className="h-3.5 w-3.5" /><span className="hidden sm:inline ml-1">Edit</span>
                </Button>
                <Button size="sm" onClick={() => onConfirm(order.order_id)}
                  className="bg-green-600 hover:bg-green-700 text-white h-8 w-8 p-0 sm:h-9 sm:w-auto sm:px-3"
                  data-testid={`confirm-order-${order.order_number}`} title="Confirm — reserve stock">
                  <CheckCircle2 className="h-3.5 w-3.5" /><span className="hidden sm:inline ml-1">Confirm</span>
                </Button>
                <Button size="sm" variant="outline" onClick={() => openReject(order)}
                  className="border-red-500/40 text-red-400 hover:bg-red-500/10 h-8 w-8 p-0 sm:h-9 sm:w-auto sm:px-3"
                  data-testid={`reject-order-${order.order_number}`} title="Reject">
                  <XCircle className="h-3.5 w-3.5" /><span className="hidden sm:inline ml-1">Reject</span>
                </Button>
                <Button size="sm" variant="outline" onClick={() => openCall(order)}
                  className={`border-[var(--border-color)] ${textSec} h-8 w-8 p-0 sm:h-9 sm:w-auto sm:px-3`}
                  data-testid={`call-order-${order.order_number}`} title="Log a call">
                  <Phone className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      ))}

      {/* Reject dialog */}
      <Dialog open={!!rejectTarget} onOpenChange={(o) => !o && setRejectTarget(null)}>
        <DialogContent className={`${dlgCls} max-w-sm`}>
          <DialogHeader><DialogTitle className={textPri}>Reject selection</DialogTitle></DialogHeader>
          <div className="space-y-2 py-2">
            <p className={`text-xs ${textMuted}`}>{rejectTarget?.order_number} — {rejectTarget?.school_name}</p>
            <textarea rows={3} value={rejectReason}
              onChange={e => { setRejectReason(e.target.value); setRejectError(''); }}
              placeholder="Why is this being rejected?"
              data-testid="reject-reason-input"
              className={`w-full p-2 rounded-md text-sm ${inputCls}`} />
            {rejectError && <p className="text-xs text-red-400">{rejectError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)} className={`border-[var(--border-color)] ${textSec}`}>Cancel</Button>
            <Button onClick={submitReject} data-testid="reject-submit" className="bg-red-600 hover:bg-red-700 text-white">Reject</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Log a call dialog */}
      <Dialog open={!!callTarget} onOpenChange={(o) => !o && setCallTarget(null)}>
        <DialogContent className={`${dlgCls} max-w-sm`}>
          <DialogHeader><DialogTitle className={textPri}>Log a call</DialogTitle></DialogHeader>
          <div className="space-y-2 py-2">
            <p className={`text-xs ${textMuted}`}>{callTarget?.order_number} — {callTarget?.school_name}</p>
            <select value={callForm.outcome} onChange={e => setCallForm(f => ({ ...f, outcome: e.target.value }))}
              data-testid="call-outcome-select"
              className={`w-full h-9 px-2 rounded-md text-sm ${inputCls}`}>
              <option value="">Outcome…</option>
              {CALL_OUTCOMES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
            <textarea rows={3} value={callForm.content}
              onChange={e => setCallForm(f => ({ ...f, content: e.target.value }))}
              placeholder="What was discussed?"
              data-testid="call-content-input"
              className={`w-full p-2 rounded-md text-sm ${inputCls}`} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCallTarget(null)} className={`border-[var(--border-color)] ${textSec}`}>Cancel</Button>
            <Button onClick={submitCall} disabled={!callForm.outcome} data-testid="call-submit" className="bg-[#e94560] hover:bg-[#f05c75] text-white">Log call</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && CI=true npx craco test src/components/orders/__tests__/AwaitingConfirmationTab.test.js --watchAll=false 2>&1 | tail -25`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/orders/AwaitingConfirmationTab.js frontend/src/components/orders/__tests__/AwaitingConfirmationTab.test.js
git commit -m "feat(orders): AwaitingConfirmationTab — Confirm/Reject/Edit/Log-call UI"
```

---

### Task 6: Mount the new tab in `OrdersManagement.js`

**Files:**
- Modify: `frontend/src/pages/admin/OrdersManagement.js`

**Interfaces:**
- Consumes: `AwaitingConfirmationTab` (Task 5), `om.stats.awaitingConfirmation`, `om.handleConfirmOrder/handleRejectOrder/handleLogCall` (Task 3).

- [ ] **Step 0: Extend `canManageSelection` to match the backend's new capability**

The prior (backend) plan's Task 5 already made `_assert_can_edit_selection` scope-aware — a `sales_person` with the new `orders: own` grant can now edit item selections on their OWN orders (any editable status, not just awaiting_confirmation), same as store/accounts could before. The frontend's gate for this UI was written before that grant existed and still excludes them, so "Edit" would show a false "Locked" state to a rep on their own order. Fix (currently line 33):
```js
  const canManageSelection = ['admin', 'accounts', 'store', 'sales_person'].includes(user?.role);
```
This still isn't a security boundary (the backend enforces real ownership regardless of what this constant says — a rep who somehow reaches another rep's order still gets a 403 from the API), it's only what the UI offers to try; extending it here just stops the UI lying about a capability the API already grants.

- [ ] **Step 1: Import the new component**

In `frontend/src/pages/admin/OrdersManagement.js`, add near the other component imports (after `import HoldsTab from '../../components/orders/HoldsTab';`, currently line 23):
```js
import AwaitingConfirmationTab from '../../components/orders/AwaitingConfirmationTab';
```

- [ ] **Step 2: Add a stat tile**

In the stats array (currently lines 68-75), add a new entry right after `'Total'`:
```js
            { label: 'Total',      value: om.stats.total,       color: textPri,          filter: 'all' },
            { label: 'Awaiting',   value: om.stats.awaitingConfirmation, color: 'text-amber-400', tab: 'awaiting' },
            { label: 'Pending',    value: om.stats.pending,     color: 'text-yellow-400', filter: 'pending' },
```

The tile's click handler (currently lines 76-82) special-cases `s.tab === 'holds'`; generalize it to any tab value:
```js
            const active = s.tab ? om.activeTab === s.tab : (om.activeTab === 'orders' && om.statusFilter === s.filter);
            return (
              <button key={s.label} type="button"
                onClick={() => {
                  if (s.tab) { om.setActiveTab(s.tab); }
                  else { om.setActiveTab('orders'); om.setStatusFilter(s.filter); }
                }}
```

- [ ] **Step 3: Add the tab button**

Change the tabs array and its two label lookups (currently lines 99-110):
```js
          {['orders', 'awaiting', 'kanban', 'holds', 'dispatches'].map(tab => (
            <button key={tab} onClick={() => om.setActiveTab(tab)}
              className={`flex-1 px-1 sm:px-4 py-2 rounded text-xs sm:text-sm font-medium transition-all ${om.activeTab === tab ? 'bg-[#e94560] text-white' : `${textSec} hover:bg-[var(--bg-hover)]`}`}
              data-testid={`tab-${tab}`}>
              <span className="sm:hidden">
                {tab === 'orders' ? `Orders (${om.ordersList.length})` : tab === 'awaiting' ? `Awaiting (${om.stats.awaitingConfirmation})` : tab === 'kanban' ? 'Pipeline' : tab === 'holds' ? `Holds (${om.holdsList.length})` : `Dispatch (${om.dispatchList.length})`}
              </span>
              <span className="hidden sm:inline">
                {tab === 'orders' ? `Orders (${om.ordersList.length})` : tab === 'awaiting' ? `Awaiting Confirmation (${om.stats.awaitingConfirmation})` : tab === 'kanban' ? 'Production Pipeline' : tab === 'holds' ? `Hold Monitor (${om.holdsList.length})` : `Dispatches (${om.dispatchList.length})`}
              </span>
            </button>
          ))}
```

- [ ] **Step 4: Add the render block**

Add right before the "Holds tab" block (currently line 277):
```jsx
        {/* Awaiting confirmation tab */}
        {om.activeTab === 'awaiting' && (
          <AwaitingConfirmationTab
            orders={om.ordersList.filter(o => o.order_status === 'awaiting_confirmation')}
            onConfirm={om.handleConfirmOrder}
            onReject={om.handleRejectOrder}
            onLogCall={om.handleLogCall}
            onOpenDetail={om.openDetail}
            textPri={textPri} textSec={textSec} textMuted={textMuted}
            inputCls={inputCls} card={card} dlgCls={dlgCls}
          />
        )}

```

- [ ] **Step 5: Exclude `awaiting_confirmation` from the "Change Status" dropdown**

Find the status dropdown inside the Status Change dialog (currently around line 544, `ORDER_STATUSES.filter(s => s.id !== om.statusTarget.order_status)`) and change it to also exclude the new entry — the backend rejects this transition:
```jsx
                    {ORDER_STATUSES.filter(s => s.id !== om.statusTarget.order_status && s.id !== 'awaiting_confirmation').map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
```

- [ ] **Step 6: Verify the build compiles**

Run: `cd frontend && CI=false DISABLE_ESLINT_PLUGIN=true GENERATE_SOURCEMAP=false npx react-scripts build 2>&1 | tail -20`
Expected: `Compiled successfully` (or pre-existing unrelated warnings only).

- [ ] **Step 7: Manual verification** (this page has no existing test suite to extend; verify by running the app)

Run: `cd frontend && npm start`, log in as a `store` or `admin` user, open Orders & Holds. Confirm: the "Awaiting" stat tile and tab appear; an order created via the backend's `awaiting_confirmation` path (or Task 1/7's new submission flow) shows there with working Confirm/Reject/Log-call buttons; the general "Orders" tab no longer lists it by default. Click "Edit" on an awaiting order — this is Task 4's change: confirm the item add/remove/qty-change UI is unlocked (not shown as "Locked"), and confirm the "Cancel (not finalising)" button does NOT appear for it (Reject is the only way to abandon it, per the backend's guard).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/admin/OrdersManagement.js
git commit -m "feat(orders): mount the Awaiting Confirmation tab in Orders & Holds"
```

---

### Task 7: Extract `DieSelectionGrid` from `CataloguePage.js`

**Files:**
- Create: `frontend/src/components/catalogue/DieSelectionGrid.js`
- Modify: `frontend/src/pages/CataloguePage.js` (use the extracted component)
- Test: `frontend/src/components/catalogue/__tests__/DieSelectionGrid.test.js` (new)

**Interfaces:**
- Produces: default export `DieSelectionGrid({ dies, qtyByDie, onToggle, onQtyChange, backendUrl, typeTab, onTypeTabChange, onVideoPreview })` — pure die-grid rendering + selection/qty UI, no page-level chrome (hero, package limits, submit button) which stays in `CataloguePage.js` and will be reused by Task 8's portal page.

- [ ] **Step 1: Write the failing test**

```javascript
// frontend/src/components/catalogue/__tests__/DieSelectionGrid.test.js
// Extracted from CataloguePage.js so the School Portal picker (Task 8) can
// reuse the exact same selection/qty UI without the catalogue page's
// quotation-specific chrome (package limits, hero). react-dom/client + act().
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import DieSelectionGrid from '../DieSelectionGrid';

global.IS_REACT_ACT_ENVIRONMENT = true;

const DIES = [
  { die_id: 'd1', name: 'Star', code: 'D-1', type: 'standard', category: 'shapes', images: [] },
  { die_id: 'd2', name: 'Heart', code: 'D-2', type: 'large', category: 'shapes', images: [] },
];

let root, container, onToggle, onQtyChange;

async function mount(qtyByDie = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  onToggle = jest.fn();
  onQtyChange = jest.fn();
  await act(async () => {
    root.render(
      <DieSelectionGrid dies={DIES} qtyByDie={qtyByDie} onToggle={onToggle} onQtyChange={onQtyChange} backendUrl="" />
    );
  });
}

const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };

afterEach(() => { act(() => root.unmount()); document.body.removeChild(container); });

test('renders one card per die', async () => {
  await mount();
  expect(container.querySelector('[data-testid="die-card-D-1"]')).toBeTruthy();
  expect(container.querySelector('[data-testid="die-card-D-2"]')).toBeTruthy();
});

test('clicking an unselected card toggles it on', async () => {
  await mount();
  await click(container.querySelector('[data-testid="die-card-D-1"]'));
  expect(onToggle).toHaveBeenCalledWith('d1');
});

test('a selected die shows the quantity stepper', async () => {
  await mount({ d1: 3 });
  expect(container.querySelector('[data-testid="die-qty-D-1"]')).toBeTruthy();
  expect(container.querySelector('[data-testid="die-qty-D-1"]').value).toBe('3');
});

test('an unselected die shows no quantity stepper', async () => {
  await mount({ d1: 3 });
  expect(container.querySelector('[data-testid="die-qty-D-2"]')).toBeFalsy();
});

test('the increase button calls onQtyChange with qty + 1', async () => {
  await mount({ d1: 3 });
  await click(container.querySelector('[aria-label="Increase quantity"]'));
  expect(onQtyChange).toHaveBeenCalledWith('d1', 4);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && CI=true npx craco test src/components/catalogue/__tests__/DieSelectionGrid.test.js --watchAll=false 2>&1 | tail -20`
Expected: FAIL — `Cannot find module '../DieSelectionGrid'`.

- [ ] **Step 3: Write the extracted component**

```javascript
// frontend/src/components/catalogue/DieSelectionGrid.js
import React from 'react';
import { Check, Minus, Plus, PlayCircle } from 'lucide-react';
import MediaGallery from '../media/MediaGallery';

/**
 * The die-selection grid extracted from CataloguePage.js so both the public
 * catalogue-token page and the School Portal's own picker (no quotation/
 * package context) can share the exact same selection UI. Purely
 * presentational: grouping, package-limit badges, hero, and the submit
 * button all stay with whichever page mounts this.
 */
export default function DieSelectionGrid({
  dies = [], qtyByDie = {}, onToggle, onQtyChange, backendUrl = '',
  typeTab = 'all', onTypeTabChange, onVideoPreview,
}) {
  const selectedDies = Object.keys(qtyByDie);

  const typeTabs = [];
  const seenTypes = new Set();
  dies.forEach(d => {
    const id = d.product_type_id || 'ptype_dies';
    if (!seenTypes.has(id)) { seenTypes.add(id); typeTabs.push({ id, name: d.product_type || 'Dies' }); }
  });
  const visibleDies = typeTab === 'all'
    ? dies
    : dies.filter(d => (d.product_type_id || 'ptype_dies') === typeTab);

  const grouped = {};
  visibleDies.forEach(d => {
    const cat = d.category || d.type || 'standard';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(d);
  });

  return (
    <>
      {onTypeTabChange && typeTabs.length > 1 && (
        <div className="flex gap-2 overflow-x-auto no-scrollbar mb-4">
          <button onClick={() => onTypeTabChange('all')}
            className={`shrink-0 px-4 py-2 rounded-full text-sm font-semibold transition-colors ${typeTab === 'all' ? 'bg-[#e94560] text-white' : 'bg-[#1a1a2e] text-[#a0a0b0] border border-[#2d2d44]'}`}>
            All
          </button>
          {typeTabs.map(t => (
            <button key={t.id} onClick={() => onTypeTabChange(t.id)}
              className={`shrink-0 px-4 py-2 rounded-full text-sm font-semibold transition-colors ${typeTab === t.id ? 'bg-[#e94560] text-white' : 'bg-[#1a1a2e] text-[#a0a0b0] border border-[#2d2d44]'}`}>
              {t.name}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-10">
        {Object.entries(grouped).map(([cat, catDies]) => (
          <div key={cat}>
            <h2 className="text-2xl font-bold text-white mb-4 capitalize">{cat.replace(/_/g, ' ')}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4" data-testid={`catalogue-section-${cat}`}>
              {catDies.map((die) => {
                const isSelected = selectedDies.includes(die.die_id);
                return (
                  <div key={die.die_id} onClick={() => onToggle(die.die_id)}
                    className={`relative bg-[#1a1a2e] rounded-lg overflow-hidden cursor-pointer transition-all hover:-translate-y-1 ${isSelected ? 'ring-2 ring-[#e94560] shadow-lg shadow-[#e94560]/20' : 'border border-[#2d2d44] hover:border-[#e94560]/40'}`}
                    data-testid={`die-card-${die.code}`}>
                    {isSelected && (
                      <div className="absolute top-2 right-2 z-10 bg-[#e94560] text-white rounded-full w-6 h-6 flex items-center justify-center"><Check className="h-4 w-4" /></div>
                    )}
                    <div className="relative aspect-square bg-[#0f0f1a]" onClick={(e) => e.stopPropagation()}>
                      <MediaGallery images={die.images} alt={die.name} backendUrl={backendUrl} />
                      {die.video_url && onVideoPreview && (
                        <button type="button" onClick={(e) => { e.stopPropagation(); onVideoPreview(die); }}
                          className="absolute bottom-1.5 left-1.5 z-10 flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/60 text-white text-[10px] font-medium">
                          <PlayCircle className="h-3.5 w-3.5" /> Video
                        </button>
                      )}
                    </div>
                    <div className="p-3">
                      <p className="font-mono text-[10px] text-[#e94560]">{die.code}</p>
                      <h3 className="text-sm font-medium text-white leading-tight mt-0.5 line-clamp-1">{die.name}</h3>
                      <p className="text-[10px] text-[#6b6b80] mt-1 capitalize">{die.type} die</p>
                      {die.description && <p className="text-[10px] text-[#8a8aa0] mt-1 line-clamp-2">{die.description}</p>}
                      {isSelected && (
                        <div className="mt-2 flex items-center justify-between" onClick={(e) => e.stopPropagation()}>
                          <span className="text-[10px] text-[#a0a0b0] uppercase tracking-wide">Qty</span>
                          <div className="flex items-center gap-1">
                            <button type="button" aria-label="Decrease quantity"
                              onClick={() => onQtyChange(die.die_id, (qtyByDie[die.die_id] || 1) - 1)}
                              className="w-6 h-6 rounded bg-[#0f0f1a] border border-[#2d2d44] text-white flex items-center justify-center hover:border-[#e94560]">
                              <Minus className="h-3 w-3" />
                            </button>
                            <input type="number" min="1" value={qtyByDie[die.die_id] || 1}
                              onChange={(e) => onQtyChange(die.die_id, e.target.value)}
                              data-testid={`die-qty-${die.code}`}
                              className="w-12 h-6 text-center text-sm bg-[#0f0f1a] border border-[#2d2d44] rounded text-white" />
                            <button type="button" aria-label="Increase quantity"
                              onClick={() => onQtyChange(die.die_id, (qtyByDie[die.die_id] || 1) + 1)}
                              className="w-6 h-6 rounded bg-[#0f0f1a] border border-[#2d2d44] text-white flex items-center justify-center hover:border-[#e94560]">
                              <Plus className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
```

Note: `onQtyChange(die.die_id, e.target.value)` passes the raw string from the input, and `onQtyChange(die.die_id, (qtyByDie[die.die_id] || 1) - 1)` passes a number from the stepper buttons — this matches `CataloguePage.js`'s existing `setDieQty` exactly (`Math.max(1, parseInt(qty, 10) || 1)` clamps either), so both callers (Task 7's `CataloguePage.js` update below, Task 8's portal page) must clamp in their own `onQtyChange` handler, not inside the grid itself — this keeps the grid a pure "tell the parent what happened" component.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && CI=true npx craco test src/components/catalogue/__tests__/DieSelectionGrid.test.js --watchAll=false 2>&1 | tail -20`
Expected: PASS (5 tests)

- [ ] **Step 5: Refactor `CataloguePage.js` to use it (regression, not a rewrite)**

In `frontend/src/pages/CataloguePage.js`, replace the imports (currently lines 1-8):
```javascript
import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { catalogue } from '../lib/api';
import { Button } from '../components/ui/button';
import { Check } from 'lucide-react';
import { toast } from 'sonner';
import VideoModal from '../components/media/VideoModal';
import DieSelectionGrid from '../components/catalogue/DieSelectionGrid';
```

`DieSelectionGrid` now owns the `typeTab`/grouping logic internally, computed from the FULL `dies` list — so `CataloguePage.js` must pass the unfiltered `dies` array, not its own pre-filtered locals. Delete the now-unused `typeTabs`, `visibleDies`, `grouped` const blocks (currently lines 98-116) and the standalone "Product-type tabs" JSX block (currently lines 165-181) — both are superseded by mounting `DieSelectionGrid` once. Replace the entire "Dies Grid" section (currently lines 165-244, from `{/* Product-type tabs */}` through the closing of the dies-grid `</div>`) with:
```jsx
      <div className="max-w-6xl mx-auto px-4 py-8">
        <DieSelectionGrid
          dies={dies}
          qtyByDie={qtyByDie}
          onToggle={handleToggleDie}
          onQtyChange={setDieQty}
          backendUrl={backendUrl}
          typeTab={typeTab}
          onTypeTabChange={setTypeTab}
          onVideoPreview={setVideoDie}
        />
      </div>
```

- [ ] **Step 6: Verify the build compiles and manually smoke-test the catalogue page**

Run: `cd frontend && CI=false DISABLE_ESLINT_PLUGIN=true GENERATE_SOURCEMAP=false npx react-scripts build 2>&1 | tail -20`
Expected: `Compiled successfully`.

Then `cd frontend && npm start`, open an existing `/my-quote/:token` link (or `/catalogue/:token` per the route), select a die, change its quantity with the steppers, submit. Expected: identical behavior to before the refactor (this is a pure extraction — same DOM, same test ids, same submit payload).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/catalogue/DieSelectionGrid.js frontend/src/components/catalogue/__tests__/DieSelectionGrid.test.js frontend/src/pages/CataloguePage.js
git commit -m "refactor(catalogue): extract DieSelectionGrid for reuse by the School Portal picker"
```

---

### Task 8: Mount the picker in `SchoolDashboard.js` (dual flow — keep the free-text box)

**Files:**
- Modify: `frontend/src/pages/school/SchoolDashboard.js`

**Interfaces:**
- Consumes: `DieSelectionGrid` (Task 7), `schoolAuth.browseCatalogue/submitCatalogue` (Task 2).

**Why dual flow, not a replacement:** the spec's open question was whether to fully replace the free-text "Request a reorder" box or keep it alongside a real picker. Keeping it costs nothing (it already exists and works) and covers anything genuinely not in the catalogue (a repair, a custom ask, a question) that a die-picker can't express — replacing it outright would remove that escape hatch for no benefit. The new picker becomes the PRIMARY way to reorder actual dies; the text box is relabeled as the fallback for everything else.

- [ ] **Step 1: Add state and the fetch/submit handlers**

In `frontend/src/pages/school/SchoolDashboard.js`, add the import (alongside the existing ones, currently line 10):
```js
import DieSelectionGrid from '../../components/catalogue/DieSelectionGrid';
```

Add state (alongside the existing `reorderMsg` state, currently line 44):
```js
  const [reorderMsg, setReorderMsg] = useState('');
  const [catalogueDies, setCatalogueDies] = useState([]);
  const [catalogueOpen, setCatalogueOpen] = useState(false);
  const [qtyByDie, setQtyByDie] = useState({});
  const [catalogueSubmitting, setCatalogueSubmitting] = useState(false);
```

Add the handlers (alongside `requestReorder`, currently ending line 117):
```js
  const openCatalogue = async () => {
    setCatalogueOpen(true);
    if (catalogueDies.length) return;
    try {
      const res = await schoolAuth.browseCatalogue();
      setCatalogueDies(res.data.dies || []);
    } catch { toast.error('Could not load the catalogue'); }
  };

  const toggleCatalogueDie = (dieId) => {
    setQtyByDie(prev => {
      const next = { ...prev };
      if (next[dieId] != null) { delete next[dieId]; } else { next[dieId] = 1; }
      return next;
    });
  };

  const setCatalogueQty = (dieId, qty) => {
    const clamped = Math.max(1, parseInt(qty, 10) || 1);
    setQtyByDie(prev => ({ ...prev, [dieId]: clamped }));
  };

  const submitCatalogueSelection = async () => {
    const selections = Object.entries(qtyByDie).map(([die_id, quantity]) => ({ die_id, quantity }));
    if (selections.length === 0) return toast.error('Select at least one item');
    setCatalogueSubmitting(true);
    try {
      await schoolAuth.submitCatalogue(selections);
      toast.success('Selection submitted — our team will confirm shortly.');
      setQtyByDie({});
      setCatalogueOpen(false);
    } catch (e) { toast.error(e.response?.data?.detail || 'Failed to submit selection'); }
    finally { setCatalogueSubmitting(false); }
  };
```

- [ ] **Step 2: Replace the reorder section's JSX**

Replace the existing reorder card (currently lines 436-442, the `<h3>...Request a reorder...` through its closing `</div>`):
```jsx
            <div className={`${card} border rounded-md p-4 space-y-3`}>
              <h3 className={`text-sm font-medium ${textPri} flex items-center gap-2`}><RefreshCw className="h-4 w-4" /> Reorder dies</h3>
              {!catalogueOpen ? (
                <Button onClick={openCatalogue} className="bg-[#e94560] hover:bg-[#f05c75] text-white">
                  Browse dies to reorder
                </Button>
              ) : (
                <div className="space-y-3">
                  <DieSelectionGrid
                    dies={catalogueDies}
                    qtyByDie={qtyByDie}
                    onToggle={toggleCatalogueDie}
                    onQtyChange={setCatalogueQty}
                    backendUrl={process.env.REACT_APP_BACKEND_URL}
                  />
                  <div className="flex items-center gap-2">
                    <Button onClick={submitCatalogueSelection} disabled={catalogueSubmitting || Object.keys(qtyByDie).length === 0}
                      className="bg-[#e94560] hover:bg-[#f05c75] text-white">
                      {catalogueSubmitting ? 'Submitting…' : `Submit selection (${Object.keys(qtyByDie).length})`}
                    </Button>
                    <Button variant="outline" onClick={() => { setCatalogueOpen(false); setQtyByDie({}); }}
                      className={`border-[var(--border-color)] ${textSec}`}>Cancel</Button>
                  </div>
                </div>
              )}

              <div className="border-t border-[var(--border-color)] pt-3">
                <p className={`text-xs ${textMuted} mb-2`}>Need something not in the catalogue?</p>
                <textarea value={reorderMsg} onChange={e => setReorderMsg(e.target.value)} rows={2}
                  placeholder="Tell us what you'd like…"
                  className={`w-full p-2 rounded-md text-sm ${inputCls}`} />
                <Button onClick={requestReorder} variant="outline" className={`mt-2 border-[var(--border-color)] ${textSec}`}>Send request</Button>
              </div>
            </div>
```

Note this references `inputCls`, which doesn't exist yet in this file's style-token block — check line 48-52 (`textPri`/`textSec`/`textMuted`/`card`/`dlgCls`) and add:
```js
  const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
```

- [ ] **Step 3: Verify the build compiles**

Run: `cd frontend && CI=false DISABLE_ESLINT_PLUGIN=true GENERATE_SOURCEMAP=false npx react-scripts build 2>&1 | tail -20`
Expected: `Compiled successfully`.

- [ ] **Step 4: Manual verification** (this page has no existing test suite to extend)

Run: `cd frontend && npm start`, log in as a school, open the Portal, click "Browse dies to reorder", select a couple of dies with quantities, submit. Expected: success toast, selection clears. Then in the admin Orders & Holds → Awaiting tab, confirm the new order appears with the right school and item count. Also confirm the free-text box still works independently for "something not in the catalogue".

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/school/SchoolDashboard.js
git commit -m "feat(school-portal): real item-picker for reorder, free-text kept as fallback"
```

---

## What this plan does not cover (deliberately)

- A richer School Portal order-tracking view — `GET /school/orders`/`GET /school/orders/{id}` already return the new status + full timeline with zero changes needed (confirmed while researching the backend plan), so the school already sees "Submitted — awaiting confirmation" wherever their orders list already renders a status. A dedicated visual treatment for that one status is a polish item, not a functional gap.
- Any change to the RBAC ownership rule that ties orders to the quotation's `sales_person_email` rather than the school's current assigned rep (backend plan's deferred minor) — out of scope here; the internal tab's list will simply reflect whatever the backend returns.
