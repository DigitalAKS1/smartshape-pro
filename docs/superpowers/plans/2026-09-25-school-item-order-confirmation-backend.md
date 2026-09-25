# School Item Selection → Order Confirmation: Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `awaiting_confirmation` order lifecycle stage so a school/teacher's item selection becomes a real, visible order without reserving stock, and give Sales/Store a Confirm (reserve + proceed), Reject (decline with reason), and optional call-log action before it becomes a normal `pending` order.

**Architecture:** One new order status (`awaiting_confirmation`) and one new order-item status (mirroring it) that both existing reservation code paths already key off of (`COMMITTING_ITEM_STATUSES`) — so "not yet reserved" falls out of the existing live-availability computation rather than a second bookkeeping system. Two new endpoints (`/confirm`, `/reject`) move an order out of that stage; every existing item-edit path is made to respect it so nothing double-reserves. RBAC gains a scoped `orders` grant for `sales_person`, enforced by extending the one function that already gates order edits.

**Tech Stack:** FastAPI + Motor (async MongoDB), pytest + `mongomock_motor.AsyncMongoMockClient` for DB-backed unit tests (no live server/DB — this repo's established pattern, see `tests/test_reorder_motion.py`).

**Spec:** `docs/superpowers/specs/2026-09-25-school-item-selection-order-confirmation-design.md` (Sub-projects A and C — Sub-projects B and D are frontend, covered by a follow-on plan once this one is merged).

## Global Constraints

- Stock reservation (`dies.reserved_qty` and everything `compute_committed()`/`compute_availability()` derive from it) must stay untouched for any order still in `awaiting_confirmation` — this is the entire point of the feature. Every place that currently does `$inc reserved_qty` alongside an order-item write must become conditional on the item's status actually being a committing one.
- Existing behavior for `pending`/`confirmed` orders (created via the manual `POST /orders` route, or already live in production) must not change at all — `create_order_for_quotation`'s new `order_status` parameter defaults to `"pending"`, and every conditional added below must be a no-op when the order was already committing.
- `_assert_can_edit_selection` is the one existing gate for order-item edits; the new scope check must go there too; do not create a second, divergent gate.
- Never touch `timeline_query()` in `crm_contact_calls.py` (contact/lead-scoped) — order call notes get their own listing endpoint.

## Review Focus

- Two `awaiting_confirmation` orders competing for the same limited-stock die: the first Confirm must succeed, the second must not silently oversell — it succeeds too, but raises a `purchase_alerts` doc (Task 4).
- Confirming or rejecting an order that is no longer `awaiting_confirmation` (already confirmed, already cancelled, or double-clicked) must 400, not silently no-op or double-reserve (Task 4).
- A `sales_person` with the new scoped `orders` grant must be blocked (403) from confirming, rejecting, editing, or calling about another rep's order — scope must be enforced by ownership, not just module level (Task 2).
- An order created before this feature (or any `pending`/`confirmed` order) must still reserve stock exactly as before when staff add/remove/change its items — the new conditional must be provably a no-op for the pre-existing path (Task 5, regression test).
- `PUT /orders/{id}/status` (the generic status-change endpoint) must refuse to touch an `awaiting_confirmation` order at all, so nobody can flip it to `confirmed` and skip the reservation Confirm is responsible for (Task 4).

---

### Task 1: Status helpers — what counts as "reserved", what an order-item's status should be

**Files:**
- Modify: `backend/routes/order_routes.py:73` (right after the existing `COMMITTING_ITEM_STATUSES` definition)
- Test: `backend/tests/test_order_confirmation_status.py` (new)

**Interfaces:**
- Produces: `AWAITING_ITEM_STATUS: str = "awaiting_confirmation"`, `_is_committing(status: str) -> bool`, `_active_item_status(order_status: str) -> str` — all module-level in `order_routes.py`, used by Tasks 3, 4, 5.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_order_confirmation_status.py
"""Pure-logic tests for the awaiting-confirmation status helpers.

An order-item's status decides whether it holds stock (compute_committed()
counts on_hold/confirmed/partially_dispatched, order_routes.py:73) — these
helpers are the single place that decides which status a new/edited line
gets, so a school/teacher's submitted selection cannot commit stock before
staff confirm it.
"""
import os

# Set before importing order_routes: it imports database.py, which reads
# MONGO_URL from .env at import time — defensively pin it to a harmless local
# value so this pure-logic test can never accidentally resolve to whatever
# .env happens to point at (see project note: local backend can hit prod).
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

from routes.order_routes import _is_committing, _active_item_status, AWAITING_ITEM_STATUS


def test_committing_statuses_are_recognized():
    for s in ("on_hold", "confirmed", "partially_dispatched"):
        assert _is_committing(s) is True


def test_non_committing_statuses_are_not_committing():
    for s in ("awaiting_confirmation", "removed", "cancelled", "dispatched", "delivered"):
        assert _is_committing(s) is False


def test_awaiting_order_gives_awaiting_item_status():
    assert _active_item_status("awaiting_confirmation") == AWAITING_ITEM_STATUS


def test_any_other_order_status_gives_on_hold():
    for s in ("pending", "confirmed", "partially_dispatched", "dispatched"):
        assert _active_item_status(s) == "on_hold"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_order_confirmation_status.py -v`
Expected: FAIL — `ImportError: cannot import name '_is_committing'` (the names don't exist yet).

- [ ] **Step 3: Add the helpers**

In `backend/routes/order_routes.py`, immediately after the existing line:
```python
COMMITTING_ITEM_STATUSES = ["on_hold", "confirmed", "partially_dispatched"]
```
add:
```python
# An order created from a school/teacher's own selection (catalogue link or
# School Portal reorder) starts here, not "pending" — its lines do NOT commit
# stock (see _is_committing) until Sales/Store calls POST /orders/{id}/confirm.
AWAITING_ITEM_STATUS = "awaiting_confirmation"


def _is_committing(status: str) -> bool:
    """True when this order_item status holds stock — i.e. counts toward
    compute_committed()/compute_availability(). Every place that increments or
    decrements dies.reserved_qty alongside an item write must gate on this,
    so an awaiting-confirmation line never reserves anything."""
    return status in COMMITTING_ITEM_STATUSES


def _active_item_status(order_status: str) -> str:
    """The order_items.status a newly added/edited line should take: the
    normal committing 'on_hold', unless the order itself is still awaiting
    confirmation, in which case the line waits alongside it."""
    return AWAITING_ITEM_STATUS if order_status == "awaiting_confirmation" else "on_hold"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_order_confirmation_status.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/routes/order_routes.py backend/tests/test_order_confirmation_status.py
git commit -m "feat(orders): add awaiting-confirmation status helpers"
```

---

### Task 2: RBAC — scoped `orders` grant for sales, and ownership enforcement

**Files:**
- Modify: `backend/rbac.py:202-207` (`sales_person` entry in `ROLE_DEFAULT_PERMISSIONS`)
- Modify: `backend/routes/order_routes.py:346-439` (`create_order_for_quotation` — denormalize `sales_person_email`)
- Modify: `backend/routes/order_routes.py:593-597` (`_assert_can_edit_selection`)
- Test: `backend/tests/test_order_confirmation_rbac.py` (new)

**Interfaces:**
- Consumes: `require_module`, `sees_all` from `rbac` (already imported in `order_routes.py:14`).
- Produces: `_assert_can_act_on_order(user: dict, order: dict) -> None` (raises `HTTPException(403)`) — used by `_assert_can_edit_selection` (this task) and by Tasks 4 and 6's new endpoints.
- Produces: every `orders` document now carries `sales_person_email: str` (denormalized from its quotation at creation) — Tasks 4 and 6 rely on this field existing.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_order_confirmation_rbac.py
"""Sales gets a scoped orders grant; ownership (not just module level) must
be enforced, or a rep with 'own' scope could act on anyone's order.
mongomock — same pattern as tests/test_reorder_motion.py."""
import asyncio
import os
from datetime import datetime, timezone

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

import rbac
import routes.order_routes as ordr

STORE = {"email": "store@ss.in", "role": "store",
         "module_permissions": {"orders": {"level": "read_write", "scope": "all"}}}
REP_OWN = {"email": "parul@ss.in", "role": "sales_person",
           "module_permissions": {"orders": {"level": "read_write", "scope": "own"}}}
OTHER_REP = {"email": "amit@ss.in", "role": "sales_person",
             "module_permissions": {"orders": {"level": "read_write", "scope": "own"}}}


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(ordr, "db", d, raising=False)
    monkeypatch.setattr(rbac, "MODULE_RBAC_MODE", "enforce")
    return d


def _run(coro):
    return asyncio.run(coro)


def test_sales_person_gets_a_default_orders_grant():
    perms = rbac.default_permissions_for_role("sales_person")
    assert perms["orders"] == {"level": "read_write", "can_download": True, "scope": "own"}


def test_store_can_act_on_any_order(db):
    order = {"order_id": "o1", "sales_person_email": "parul@ss.in", "order_status": "awaiting_confirmation"}
    ordr._assert_can_act_on_order(STORE, order)  # must not raise


def test_owning_rep_can_act_on_their_own_order(db):
    order = {"order_id": "o1", "sales_person_email": "parul@ss.in", "order_status": "awaiting_confirmation"}
    ordr._assert_can_act_on_order(REP_OWN, order)  # must not raise


def test_a_different_rep_is_blocked(db):
    order = {"order_id": "o1", "sales_person_email": "parul@ss.in", "order_status": "awaiting_confirmation"}
    with pytest.raises(Exception) as exc:
        ordr._assert_can_act_on_order(OTHER_REP, order)
    assert "403" in str(exc.value) or "own" in str(exc.value).lower()


def test_order_creation_denormalizes_the_owning_reps_email(db):
    async def go():
        await db.quotations.insert_one({
            "quotation_id": "q1", "quote_number": "Q-1", "school_id": "s1",
            "sales_person_email": "parul@ss.in", "grand_total": 1000,
        })
        order, created = await ordr.create_order_for_quotation(
            "q1", created_by="system", source="catalogue_submit",
            order_status="awaiting_confirmation")
        assert created is True
        assert order["sales_person_email"] == "parul@ss.in"
    _run(go())
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_order_confirmation_rbac.py -v`
Expected: FAIL — `test_sales_person_gets_a_default_orders_grant` fails (`KeyError: 'orders'`); the rest fail with `AttributeError: module 'routes.order_routes' has no attribute '_assert_can_act_on_order'`.

- [ ] **Step 3: Add the grant, the ownership field, and the scope helper**

In `backend/rbac.py`, change the `sales_person` entry (currently lines 202-207):
```python
    "sales_person": {
        "dashboard": _R_OWN, "quotations": _RW_OWN, "leads": _RW_OWN,
        "field_sales": _RW_OWN, "sales_portal": _RW_OWN,
        "leave_management": _RW_OWN, "analytics": _R_OWN,
        "delegation": _RW_OWN, "forms": _RW_OWN,
        "orders": _RW_OWN,
    },
```

In `backend/routes/order_routes.py`, inside `create_order_for_quotation`, add `sales_person_email` to `order_doc` (right after the existing `"lead_id": eff_lead_id,` line in the dict built around line 379-401):
```python
        "lead_id": eff_lead_id,
        "sales_person_email": quot.get("sales_person_email", ""),
```

Then replace `_assert_can_edit_selection` (currently lines 593-597):
```python
def _assert_can_act_on_order(user: dict, order: dict):
    """Shared scope gate for confirm/reject/edit-selection/call-log. The module
    grant decides whether staff may touch orders at all; for an 'own'-scoped
    grant (sales reps) ownership is the order's own sales_person_email,
    denormalised from its quotation at creation — the same ownership rule the
    quotations/leads grants already use (quotation_routes.py: sales_person_email
    comparisons)."""
    require_module(user, "orders", "read_write")
    if not sees_all(user, "orders") and order.get("sales_person_email") != user.get("email"):
        raise HTTPException(status_code=403, detail="You can only act on orders for your own schools")


def _assert_can_edit_selection(user, order):
    _assert_can_act_on_order(user, order)
    if order.get("order_status") not in EDITABLE_ORDER_STATUSES:
        raise HTTPException(status_code=400,
            detail=f"Selection is locked once the order is {order.get('order_status')}")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_order_confirmation_rbac.py -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Run the full existing order test suite to confirm no regression**

Run: `cd backend && python -m pytest tests/test_order_cancel.py tests/test_order_diff.py tests/test_orders_holds.py -v`
Expected: PASS — `_assert_can_edit_selection`'s new ownership check must not break `store`/`accounts` (both `scope="all"` by default, so `sees_all` short-circuits it) editing any order, which is what these existing tests exercise.

- [ ] **Step 6: Commit**

```bash
git add backend/rbac.py backend/routes/order_routes.py backend/tests/test_order_confirmation_rbac.py
git commit -m "feat(rbac): scoped orders grant for sales_person + order ownership enforcement"
```

---

### Task 3: Order creation supports `awaiting_confirmation`, and catalogue submit stops reserving on submit

**Files:**
- Modify: `backend/routes/order_routes.py:346-439` (`create_order_for_quotation` signature + item status + timeline note)
- Modify: `backend/routes/quotation_routes.py:1653-1717` (`submit_catalogue_selection`)
- Test: `backend/tests/test_order_confirmation_creation.py` (new)

**Interfaces:**
- Consumes: `_active_item_status`, `AWAITING_ITEM_STATUS` (Task 1).
- Produces: `create_order_for_quotation(..., order_status: str = "pending")` — the new keyword-only parameter Task 2's test already exercises; every existing caller (the manual `POST /orders` route, `order_routes.py:477`) is unaffected by the default.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_order_confirmation_creation.py
"""An order created with order_status='awaiting_confirmation' must not
commit any stock — its items sit outside compute_committed() until Confirm
runs (Task 4). mongomock — same pattern as tests/test_reorder_motion.py."""
import asyncio
import os
from datetime import datetime, timezone

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

import routes.order_routes as ordr


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(ordr, "db", d, raising=False)
    return d


def _run(coro):
    return asyncio.run(coro)


async def _setup_quotation_and_selection(db):
    await db.quotations.insert_one({
        "quotation_id": "q1", "quote_number": "Q-1", "school_id": "s1", "school_name": "DPS",
        "sales_person_email": "parul@ss.in", "grand_total": 1000,
    })
    await db.dies.insert_one({"die_id": "d1", "name": "Star", "code": "D-1", "type": "standard",
                              "stock_qty": 10, "reserved_qty": 0})
    await db.catalogue_selections.insert_one({"selection_id": "sel1", "quotation_id": "q1"})
    await db.catalogue_selection_items.insert_one({
        "catalogue_selection_id": "sel1", "die_id": "d1", "die_name": "Star",
        "die_code": "D-1", "die_type": "standard", "quantity": 3,
    })


def test_awaiting_confirmation_order_reserves_nothing(db):
    async def go():
        await _setup_quotation_and_selection(db)
        order, created = await ordr.create_order_for_quotation(
            "q1", created_by="system", source="catalogue_submit",
            order_status="awaiting_confirmation")
        assert created is True
        assert order["order_status"] == "awaiting_confirmation"

        items = await db.order_items.find({"order_id": order["order_id"]}, {"_id": 0}).to_list(10)
        assert len(items) == 1
        assert items[0]["status"] == "awaiting_confirmation"

        die = await db.dies.find_one({"die_id": "d1"}, {"_id": 0})
        assert die["reserved_qty"] == 0, "an awaiting-confirmation order must not reserve stock"
        committed = await ordr.compute_committed("d1")
        assert committed == 0, "compute_committed() must not count an awaiting-confirmation line either"
    _run(go())


def test_default_order_status_is_unchanged_for_existing_callers(db):
    async def go():
        await _setup_quotation_and_selection(db)
        order, created = await ordr.create_order_for_quotation("q1", created_by="parul@ss.in", source="manual")
        assert order["order_status"] == "pending"
        items = await db.order_items.find({"order_id": order["order_id"]}, {"_id": 0}).to_list(10)
        assert items[0]["status"] == "on_hold", "manual creation must keep committing stock immediately"
    _run(go())
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_order_confirmation_creation.py -v`
Expected: FAIL — `create_order_for_quotation()` has no `order_status` parameter yet (`TypeError: unexpected keyword argument`), and the order-items loop always writes `status: "on_hold"`.

- [ ] **Step 3: Change `create_order_for_quotation`**

In `backend/routes/order_routes.py`, change the signature (currently lines 346-350):
```python
async def create_order_for_quotation(quotation_id: str, *, created_by: str,
                                     lead_id: Optional[str] = None,
                                     payment_threshold_pct: float = 50.0,
                                     payment_received: float = 0.0,
                                     notes: str = "", source: str = "manual",
                                     order_status: str = "pending"):
```

Change the docstring's first line to mention it, and change `note_text` (currently lines 376-377):
```python
    note_text = notes or (
        "Submitted by school/teacher — awaiting confirmation" if order_status == "awaiting_confirmation"
        else "Auto-created from catalogue submission" if source == "catalogue_submit"
        else "Order created from quotation")
```

Change the `"order_status": "pending",` line inside `order_doc` (currently line 390) to:
```python
        "order_status": order_status,
```

Change the order-items loop (currently lines 417-428):
```python
    item_status = _active_item_status(order_status)
    for item in sel_items:
        await db.order_items.insert_one({
            "order_item_id": f"oi_{uuid.uuid4().hex[:8]}",
            "order_id": order_id,
            "die_id": item.get("die_id"),
            "die_name": item.get("die_name"),
            "die_code": item.get("die_code"),
            "die_type": item.get("die_type"),
            "die_image_url": item.get("die_image_url"),
            "quantity": int(item.get("quantity", 1) or 1),
            "status": item_status,
        })
```

Change the timeline insert's `"status": "pending",` (currently line 433) to:
```python
        "status": order_status,
```

- [ ] **Step 4: Stop reserving stock at catalogue-submit time**

In `backend/routes/quotation_routes.py`, in `submit_catalogue_selection`, replace the per-die loop (currently lines 1653-1683):
```python
    for die_id, qty in qty_by_die.items():
        die = await db.dies.find_one({"die_id": die_id}, {"_id": 0})
        if die:
            await db.catalogue_selection_items.insert_one({
                "catalogue_selection_id": selection_id,
                "die_id": die_id,
                "die_name": die["name"],
                "die_code": die["code"],
                "die_type": die["type"],
                "die_image_url": die.get("image_url"),
                "quantity": qty,
            })
            # Reservation now happens at POST /orders/{id}/confirm (Task 4), not
            # here — an awaiting-confirmation selection must not commit stock
            # before Sales/Store reviews it.
```

And change the auto-order-creation call (currently lines 1707-1710):
```python
            from routes.order_routes import create_order_for_quotation
            order, created = await create_order_for_quotation(
                quot["quotation_id"], created_by="system", source="catalogue_submit",
                order_status="awaiting_confirmation",
            )
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_order_confirmation_creation.py -v`
Expected: PASS (2 tests)

- [ ] **Step 6: Run the full existing order + catalogue test suites to confirm no regression**

Run: `cd backend && python -m pytest tests/test_order_cancel.py tests/test_order_diff.py tests/test_orders_holds.py -v`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/routes/order_routes.py backend/routes/quotation_routes.py backend/tests/test_order_confirmation_creation.py
git commit -m "feat(orders): catalogue submit creates an awaiting-confirmation order, reserves nothing yet"
```

---

### Task 4: Confirm and Reject endpoints, and locking out the generic status endpoint

**Files:**
- Modify: `backend/routes/order_routes.py` (new endpoints, placed after `update_order_production_stage`, i.e. after current line 583; and a guard added inside `update_order_status`, currently lines 489-500)
- Test: `backend/tests/test_order_confirm_reject.py` (new)

**Interfaces:**
- Consumes: `AWAITING_ITEM_STATUS`, `_assert_can_act_on_order`, `_maybe_alert_shortage`, `log_activity` (all already in `order_routes.py` by Tasks 1-2, or pre-existing).
- Produces: `POST /orders/{order_id}/confirm`, `POST /orders/{order_id}/reject` — consumed by the frontend plan's "Orders awaiting confirmation" panel.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_order_confirm_reject.py
"""Confirm reserves stock and moves the order to 'pending'; Reject requires a
reason and moves it to 'cancelled' with nothing to release. Both must refuse
to act twice, and the generic status endpoint must refuse to touch an
awaiting-confirmation order at all. mongomock — see tests/test_reorder_motion.py."""
import asyncio
import json
import os
from datetime import datetime, timezone

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

import rbac
import routes.order_routes as ordr

STORE = {"email": "store@ss.in", "role": "store",
         "module_permissions": {"orders": {"level": "read_write", "scope": "all"}}}


class FakeRequest:
    def __init__(self, body=None):
        self._body = body or {}

    async def json(self):
        return self._body


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(ordr, "db", d, raising=False)
    monkeypatch.setattr(rbac, "MODULE_RBAC_MODE", "enforce")

    async def _me(_request):
        return STORE
    monkeypatch.setattr(ordr, "get_current_user", _me)
    return d


def _run(coro):
    return asyncio.run(coro)


async def _awaiting_order(db, order_id="o1", die_id="d1", qty=3, stock=10):
    await db.dies.insert_one({"die_id": die_id, "name": "Star", "code": "D-1",
                              "type": "standard", "stock_qty": stock, "reserved_qty": 0})
    await db.orders.insert_one({
        "order_id": order_id, "order_number": "ORD-1", "school_id": "s1",
        "sales_person_email": "parul@ss.in", "order_status": "awaiting_confirmation",
        "grand_total": 1000, "total_items": 1,
    })
    await db.order_items.insert_one({
        "order_item_id": f"{order_id}_i1", "order_id": order_id, "die_id": die_id,
        "die_name": "Star", "die_code": "D-1", "die_type": "standard",
        "quantity": qty, "status": "awaiting_confirmation",
    })


def test_confirm_reserves_stock_and_moves_to_pending(db):
    async def go():
        await _awaiting_order(db)
        resp = await ordr.confirm_order("o1", FakeRequest())
        assert resp["message"] == "Order confirmed"

        order = await db.orders.find_one({"order_id": "o1"}, {"_id": 0})
        assert order["order_status"] == "pending"
        item = await db.order_items.find_one({"order_item_id": "o1_i1"}, {"_id": 0})
        assert item["status"] == "on_hold"
        die = await db.dies.find_one({"die_id": "d1"}, {"_id": 0})
        assert die["reserved_qty"] == 3
    _run(go())


def test_two_orders_confirming_the_same_scarce_die_both_succeed_second_raises_alert(db):
    async def go():
        await _awaiting_order(db, order_id="o1", die_id="d1", qty=6, stock=10)
        await db.orders.insert_one({
            "order_id": "o2", "order_number": "ORD-2", "school_id": "s2",
            "sales_person_email": "amit@ss.in", "order_status": "awaiting_confirmation",
            "grand_total": 500, "total_items": 1,
        })
        await db.order_items.insert_one({
            "order_item_id": "o2_i1", "order_id": "o2", "die_id": "d1",
            "die_name": "Star", "die_code": "D-1", "die_type": "standard",
            "quantity": 6, "status": "awaiting_confirmation",
        })

        await ordr.confirm_order("o1", FakeRequest())
        assert (await db.purchase_alerts.count_documents({})) == 0, "first confirm fits in stock"

        await ordr.confirm_order("o2", FakeRequest())  # 6 + 6 = 12 > 10 in stock
        order2 = await db.orders.find_one({"order_id": "o2"}, {"_id": 0})
        assert order2["order_status"] == "pending", "second confirm still succeeds — it does not oversell silently, it alerts"
        alerts = await db.purchase_alerts.find({}, {"_id": 0}).to_list(10)
        assert len(alerts) == 1
        assert alerts[0]["shortage_qty"] == 2
    _run(go())


def test_confirming_twice_is_rejected(db):
    async def go():
        await _awaiting_order(db)
        await ordr.confirm_order("o1", FakeRequest())
        with pytest.raises(Exception) as exc:
            await ordr.confirm_order("o1", FakeRequest())
        assert "400" in str(exc.value) or "awaiting confirmation" in str(exc.value).lower()
    _run(go())


def test_confirming_an_order_with_no_items_still_succeeds(db):
    async def go():
        await db.orders.insert_one({
            "order_id": "o_empty", "order_number": "ORD-3", "school_id": "s3",
            "sales_person_email": "parul@ss.in", "order_status": "awaiting_confirmation",
            "grand_total": 0, "total_items": 0,
        })
        resp = await ordr.confirm_order("o_empty", FakeRequest())
        assert resp["items_reserved"] == 0
        order = await db.orders.find_one({"order_id": "o_empty"}, {"_id": 0})
        assert order["order_status"] == "pending"
    _run(go())


def test_reject_requires_a_reason(db):
    async def go():
        await _awaiting_order(db)
        with pytest.raises(Exception) as exc:
            await ordr.reject_order("o1", FakeRequest({"reason": "  "}))
        assert "400" in str(exc.value) or "reason" in str(exc.value).lower()
    _run(go())


def test_reject_cancels_and_releases_nothing(db):
    async def go():
        await _awaiting_order(db)
        resp = await ordr.reject_order("o1", FakeRequest({"reason": "Duplicate submission"}))
        assert resp["message"] == "Order rejected"

        order = await db.orders.find_one({"order_id": "o1"}, {"_id": 0})
        assert order["order_status"] == "cancelled"
        item = await db.order_items.find_one({"order_item_id": "o1_i1"}, {"_id": 0})
        assert item["status"] == "cancelled"
        die = await db.dies.find_one({"die_id": "d1"}, {"_id": 0})
        assert die["reserved_qty"] == 0, "nothing was reserved, so nothing to release"
    _run(go())


def test_generic_status_endpoint_refuses_an_awaiting_confirmation_order(db):
    async def go():
        await _awaiting_order(db)
        with pytest.raises(Exception) as exc:
            await ordr.update_order_status("o1", FakeRequest({"status": "confirmed"}))
        assert "400" in str(exc.value) or "confirm" in str(exc.value).lower()
        order = await db.orders.find_one({"order_id": "o1"}, {"_id": 0})
        assert order["order_status"] == "awaiting_confirmation", "must not have been changed"
    _run(go())
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_order_confirm_reject.py -v`
Expected: FAIL — `confirm_order`/`reject_order` don't exist yet; the last test fails because `update_order_status` currently has no awaiting-confirmation guard.

- [ ] **Step 3: Add the guard to `update_order_status`**

In `backend/routes/order_routes.py`, inside `update_order_status` (currently lines 489-500), immediately after the existing order lookup:
```python
    order = await db.orders.find_one({"order_id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.get("order_status") == "awaiting_confirmation":
        raise HTTPException(status_code=400,
            detail="This order is awaiting confirmation — use Confirm or Reject, not a direct status change")
```

- [ ] **Step 4: Add the Confirm and Reject endpoints**

In `backend/routes/order_routes.py`, immediately after `update_order_production_stage` (after current line 583), add:
```python
@router.post("/orders/{order_id}/confirm")
async def confirm_order(order_id: str, request: Request):
    """Sales/Store confirms a school/teacher's submitted selection: locks in
    quantities, reserves stock, and moves the order into the normal pending
    lifecycle. A shortage does not block confirmation — it raises the same
    purchase_alerts doc editing an existing order already would."""
    user = await get_current_user(request)
    order = await db.orders.find_one({"order_id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    _assert_can_act_on_order(user, order)
    if order.get("order_status") != "awaiting_confirmation":
        raise HTTPException(status_code=400,
            detail=f"Only an order awaiting confirmation can be confirmed (this one is {order.get('order_status')})")

    items = await db.order_items.find(
        {"order_id": order_id, "status": AWAITING_ITEM_STATUS}, {"_id": 0}).to_list(1000)
    for it in items:
        qty = int(it.get("quantity", 1) or 1)
        await db.order_items.update_one({"order_item_id": it["order_item_id"]}, {"$set": {"status": "on_hold"}})
        await db.dies.update_one({"die_id": it["die_id"]}, {"$inc": {"reserved_qty": qty}})
        die = await db.dies.find_one({"die_id": it["die_id"]}, {"_id": 0})
        if die:
            await _maybe_alert_shortage(die, it["order_item_id"])

    now_iso = datetime.now(timezone.utc).isoformat()
    await db.orders.update_one({"order_id": order_id},
        {"$set": {"order_status": "pending", "updated_at": now_iso}})
    await db.order_timeline.insert_one({
        "timeline_id": f"tl_{uuid.uuid4().hex[:8]}", "order_id": order_id,
        "status": "pending", "note": "Selection confirmed — stock reserved.",
        "updated_by": user["email"], "timestamp": now_iso,
    })
    await log_activity(user["email"], "confirm_order", "order", order_id, "")
    return {"message": "Order confirmed", "items_reserved": len(items)}


@router.post("/orders/{order_id}/reject")
async def reject_order(order_id: str, request: Request):
    """Sales/Store declines a submitted selection. Nothing was reserved for an
    awaiting-confirmation order, so there is no stock to release — a reason is
    mandatory so the school's record shows why."""
    user = await get_current_user(request)
    order = await db.orders.find_one({"order_id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    _assert_can_act_on_order(user, order)
    if order.get("order_status") != "awaiting_confirmation":
        raise HTTPException(status_code=400,
            detail=f"Only an order awaiting confirmation can be rejected (this one is {order.get('order_status')})")

    body = await request.json()
    reason = (body.get("reason") or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="A reason is required to reject a selection")

    now_iso = datetime.now(timezone.utc).isoformat()
    await db.orders.update_one({"order_id": order_id},
        {"$set": {"order_status": "cancelled", "updated_at": now_iso}})
    await db.order_items.update_many(
        {"order_id": order_id, "status": AWAITING_ITEM_STATUS}, {"$set": {"status": "cancelled"}})
    await db.order_timeline.insert_one({
        "timeline_id": f"tl_{uuid.uuid4().hex[:8]}", "order_id": order_id,
        "status": "cancelled", "note": f"Selection rejected: {reason}",
        "updated_by": user["email"], "timestamp": now_iso,
    })
    await log_activity(user["email"], "reject_order", "order", order_id, reason)
    return {"message": "Order rejected"}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_order_confirm_reject.py -v`
Expected: PASS (7 tests)

- [ ] **Step 6: Run the full existing order test suite to confirm no regression**

Run: `cd backend && python -m pytest tests/test_order_cancel.py tests/test_order_diff.py tests/test_orders_holds.py -v`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/routes/order_routes.py backend/tests/test_order_confirm_reject.py
git commit -m "feat(orders): add Confirm and Reject endpoints for awaiting-confirmation orders"
```

---

### Task 5: Make item-edit paths reservation-safe for awaiting-confirmation orders

**Files:**
- Modify: `backend/routes/order_routes.py:589-590` (`EDITABLE_ORDER_STATUSES`, `EDITABLE_ITEM_STATUSES`)
- Modify: `backend/routes/order_routes.py:624-718` (`add_order_item`, `update_order_item_qty`, `remove_order_item`)
- Modify: `backend/routes/order_routes.py:756-820` (`reconcile_order_to_selection`)
- Test: `backend/tests/test_order_confirmation_edit_selection.py` (new)

**Interfaces:**
- Consumes: `_is_committing`, `_active_item_status` (Task 1), `_assert_can_edit_selection` (Task 2, unchanged interface).

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_order_confirmation_edit_selection.py
"""Sales/Store can add/remove/change items on an awaiting-confirmation order
BEFORE confirming — same UI as editing a live order — but none of it may
reserve stock yet. Existing pending/confirmed-order editing must be
byte-for-byte unchanged (regression). mongomock — see test_reorder_motion.py."""
import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

import rbac
import routes.order_routes as ordr

STORE = {"email": "store@ss.in", "role": "store",
         "module_permissions": {"orders": {"level": "read_write", "scope": "all"}}}


class FakeRequest:
    def __init__(self, body=None):
        self._body = body or {}

    async def json(self):
        return self._body


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(ordr, "db", d, raising=False)
    monkeypatch.setattr(rbac, "MODULE_RBAC_MODE", "enforce")

    async def _me(_request):
        return STORE
    monkeypatch.setattr(ordr, "get_current_user", _me)
    return d


def _run(coro):
    return asyncio.run(coro)


async def _die(db, die_id="d1", stock=10):
    await db.dies.insert_one({"die_id": die_id, "name": "Star", "code": "D-1",
                              "type": "standard", "stock_qty": stock, "reserved_qty": 0})


async def _order(db, order_id, status):
    await db.orders.insert_one({"order_id": order_id, "order_number": "ORD-1", "school_id": "s1",
                                "sales_person_email": "parul@ss.in", "order_status": status,
                                "grand_total": 0, "total_items": 0})


# ── New behaviour: awaiting-confirmation orders can be edited without reserving ──

def test_adding_an_item_to_an_awaiting_order_does_not_reserve(db):
    async def go():
        await _die(db)
        await _order(db, "o1", "awaiting_confirmation")
        await ordr.add_order_item("o1", FakeRequest({"die_id": "d1", "quantity": 4}))
        item = await db.order_items.find_one({"order_id": "o1"}, {"_id": 0})
        assert item["status"] == "awaiting_confirmation"
        die = await db.dies.find_one({"die_id": "d1"}, {"_id": 0})
        assert die["reserved_qty"] == 0
    _run(go())


def test_changing_qty_on_an_awaiting_order_does_not_touch_reservation(db):
    async def go():
        await _die(db)
        await _order(db, "o1", "awaiting_confirmation")
        await ordr.add_order_item("o1", FakeRequest({"die_id": "d1", "quantity": 4}))
        item = await db.order_items.find_one({"order_id": "o1"}, {"_id": 0})
        await ordr.update_order_item_qty("o1", item["order_item_id"], FakeRequest({"quantity": 9}))
        die = await db.dies.find_one({"die_id": "d1"}, {"_id": 0})
        assert die["reserved_qty"] == 0
    _run(go())


def test_removing_an_item_from_an_awaiting_order_releases_nothing(db):
    async def go():
        await _die(db)
        await _order(db, "o1", "awaiting_confirmation")
        await ordr.add_order_item("o1", FakeRequest({"die_id": "d1", "quantity": 4}))
        item = await db.order_items.find_one({"order_id": "o1"}, {"_id": 0})
        await ordr.remove_order_item("o1", item["order_item_id"], FakeRequest())
        die = await db.dies.find_one({"die_id": "d1"}, {"_id": 0})
        assert die["reserved_qty"] == 0
    _run(go())


def test_reconcile_on_an_awaiting_order_does_not_reserve(db):
    async def go():
        await _die(db)
        await _order(db, "o1", "awaiting_confirmation")
        summary = await ordr.reconcile_order_to_selection("o1", {"d1": 5})
        assert summary["added"] == 1
        die = await db.dies.find_one({"die_id": "d1"}, {"_id": 0})
        assert die["reserved_qty"] == 0
        item = await db.order_items.find_one({"order_id": "o1"}, {"_id": 0})
        assert item["status"] == "awaiting_confirmation"
    _run(go())


# ── Regression: existing pending/confirmed editing is unchanged ─────────────

def test_adding_an_item_to_a_pending_order_still_reserves_immediately(db):
    async def go():
        await _die(db)
        await _order(db, "o1", "pending")
        await ordr.add_order_item("o1", FakeRequest({"die_id": "d1", "quantity": 4}))
        item = await db.order_items.find_one({"order_id": "o1"}, {"_id": 0})
        assert item["status"] == "on_hold"
        die = await db.dies.find_one({"die_id": "d1"}, {"_id": 0})
        assert die["reserved_qty"] == 4
    _run(go())


def test_removing_an_item_from_a_pending_order_still_releases(db):
    async def go():
        await _die(db)
        await _order(db, "o1", "pending")
        await ordr.add_order_item("o1", FakeRequest({"die_id": "d1", "quantity": 4}))
        item = await db.order_items.find_one({"order_id": "o1"}, {"_id": 0})
        await ordr.remove_order_item("o1", item["order_item_id"], FakeRequest())
        die = await db.dies.find_one({"die_id": "d1"}, {"_id": 0})
        assert die["reserved_qty"] == 0
    _run(go())


def test_reconcile_on_a_pending_order_still_reserves(db):
    async def go():
        await _die(db)
        await _order(db, "o1", "pending")
        await ordr.reconcile_order_to_selection("o1", {"d1": 5})
        die = await db.dies.find_one({"die_id": "d1"}, {"_id": 0})
        assert die["reserved_qty"] == 5
    _run(go())
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_order_confirmation_edit_selection.py -v`
Expected: FAIL — `_assert_can_edit_selection` currently 400s on an `awaiting_confirmation` order (not yet in `EDITABLE_ORDER_STATUSES`), and every write still unconditionally touches `reserved_qty`.

- [ ] **Step 3: Extend the editable-status constants**

In `backend/routes/order_routes.py`, change (currently lines 589-590):
```python
EDITABLE_ORDER_STATUSES = ("awaiting_confirmation", "pending", "confirmed")
EDITABLE_ITEM_STATUSES = ("awaiting_confirmation", "on_hold", "confirmed")
```

- [ ] **Step 4: Make `add_order_item` status- and reservation-aware**

Replace the item-insert + reservation block in `add_order_item` (currently lines 648-656):
```python
    order_item_id = f"oi_{uuid.uuid4().hex[:8]}"
    item_status = _active_item_status(order.get("order_status"))
    await db.order_items.insert_one({
        "order_item_id": order_item_id, "order_id": order_id,
        "die_id": die_id, "die_name": die["name"], "die_code": die["code"],
        "die_type": die["type"], "die_image_url": die.get("image_url"),
        "quantity": qty, "status": item_status,
    })
    if _is_committing(item_status):
        await db.dies.update_one({"die_id": die_id}, {"$inc": {"reserved_qty": qty}})
        await _maybe_alert_shortage({**die, "die_id": die_id}, order_item_id)
```

- [ ] **Step 5: Make `update_order_item_qty` reservation-aware**

Replace the delta-adjust block in `update_order_item_qty` (currently lines 682-687):
```python
    if delta != 0:
        await db.order_items.update_one({"order_item_id": order_item_id}, {"$set": {"quantity": new_qty}})
        if _is_committing(item.get("status")):
            await db.dies.update_one({"die_id": item["die_id"]}, {"$inc": {"reserved_qty": delta}})
            die = await db.dies.find_one({"die_id": item["die_id"]}, {"_id": 0})
            if die:
                await _maybe_alert_shortage(die, order_item_id)
```

- [ ] **Step 6: Make `remove_order_item` reservation-aware**

Replace the release block in `remove_order_item` (currently lines 711-712):
```python
    if _is_committing(item.get("status")):
        await db.dies.update_one({"die_id": item["die_id"]},
                                 {"$inc": {"reserved_qty": -int(item.get("quantity", 1) or 1)}})
```

- [ ] **Step 7: Make `reconcile_order_to_selection` reservation-aware**

In `reconcile_order_to_selection` (currently lines 767-814): add, right after the existing `order = await db.orders.find_one(...)` / not-found check:
```python
    item_status = _active_item_status(order.get("order_status"))
```

Then in the "remove editable lines no longer desired" loop (currently lines 784-789):
```python
    for die_id, it in editable_by_die.items():
        if die_id not in desired:
            if _is_committing(it.get("status")):
                await db.dies.update_one({"die_id": die_id}, {"$inc": {"reserved_qty": -_remaining_qty(it)}})
            await db.order_items.update_one({"order_item_id": it["order_item_id"]}, {"$set": {"status": "removed"}})
            changes.append({"action": "remove", "code": it.get("die_code"), "name": it.get("die_name")})
            removed += 1
```

In the "add" branch (currently lines 792-805):
```python
    for die_id, qty in desired.items():
        if die_id not in present_die_ids:
            die = await db.dies.find_one({"die_id": die_id}, {"_id": 0})
            if not die:
                continue
            await db.order_items.insert_one({
                "order_item_id": f"oi_{uuid.uuid4().hex[:8]}", "order_id": order_id,
                "die_id": die_id, "die_name": die["name"], "die_code": die["code"],
                "die_type": die["type"], "die_image_url": die.get("image_url"),
                "quantity": qty, "status": item_status,
            })
            if _is_committing(item_status):
                await db.dies.update_one({"die_id": die_id}, {"$inc": {"reserved_qty": qty}})
            changes.append({"action": "add", "qty": qty, "code": die["code"], "name": die["name"]})
            added += 1
        elif die_id in editable_by_die:
            cur = int(editable_by_die[die_id].get("quantity", 1) or 1)
            if qty != cur:
                await db.order_items.update_one(
                    {"order_item_id": editable_by_die[die_id]["order_item_id"]}, {"$set": {"quantity": qty}})
                if _is_committing(editable_by_die[die_id].get("status")):
                    await db.dies.update_one({"die_id": die_id}, {"$inc": {"reserved_qty": qty - cur}})
                changes.append({"action": "adjust", "code": editable_by_die[die_id].get("die_code"),
                                "name": editable_by_die[die_id].get("die_name"), "old": cur, "new": qty})
                adjusted += 1
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_order_confirmation_edit_selection.py -v`
Expected: PASS (7 tests)

- [ ] **Step 9: Run the full existing order test suite to confirm no regression**

Run: `cd backend && python -m pytest tests/test_order_cancel.py tests/test_order_diff.py tests/test_orders_holds.py -v`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add backend/routes/order_routes.py backend/tests/test_order_confirmation_edit_selection.py
git commit -m "feat(orders): item-edit paths (single, bulk reconcile) respect awaiting-confirmation status"
```

---

### Task 6: Optional call log on an order

**Files:**
- Modify: `backend/crm_contact_calls.py` (new pure builder)
- Modify: `backend/routes/order_routes.py` (two new endpoints + `cc` import)
- Test: `backend/tests/test_order_call_log.py` (new)

**Interfaces:**
- Produces: `crm_contact_calls.build_order_call_note(order: dict, user: dict, outcome: str, content: str, now_iso: str) -> dict`.
- Produces: `POST /orders/{order_id}/calls`, `GET /orders/{order_id}/calls`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_order_call_log.py
"""A call about a submitted selection is optional — never required to
Confirm/Edit/Reject — and lives in the same call_notes collection as contact
calls, keyed by order_id instead. mongomock — see test_reorder_motion.py."""
import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

import rbac
import routes.order_routes as ordr
import crm_contact_calls as cc

STORE = {"email": "store@ss.in", "role": "store", "name": "Store Team",
         "module_permissions": {"orders": {"level": "read_write", "scope": "all"}}}


class FakeRequest:
    def __init__(self, body=None):
        self._body = body or {}

    async def json(self):
        return self._body


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(ordr, "db", d, raising=False)
    monkeypatch.setattr(rbac, "MODULE_RBAC_MODE", "enforce")

    async def _me(_request):
        return STORE
    monkeypatch.setattr(ordr, "get_current_user", _me)
    return d


def _run(coro):
    return asyncio.run(coro)


def test_build_order_call_note_shape():
    order = {"order_id": "o1"}
    note = cc.build_order_call_note(order, STORE, "connected", "Confirmed qty with the school", "2026-09-25T00:00:00Z")
    assert note["order_id"] == "o1"
    assert note["contact_id"] is None
    assert note["lead_id"] is None
    assert note["outcome"] == "connected"
    assert note["created_by"] == "store@ss.in"


def test_logging_a_call_persists_and_lists(db):
    async def go():
        await db.orders.insert_one({"order_id": "o1", "sales_person_email": "parul@ss.in",
                                    "order_status": "awaiting_confirmation"})
        result = await ordr.log_order_call("o1", FakeRequest({"outcome": "connected", "content": "Will confirm 20 units"}))
        assert result["outcome"] == "connected"

        calls = await ordr.list_order_calls("o1", FakeRequest())
        assert len(calls) == 1
        assert calls[0]["content"] == "Will confirm 20 units"

        timeline = await db.order_timeline.find({"order_id": "o1"}, {"_id": 0}).to_list(10)
        assert any("Call logged" in t["note"] for t in timeline)
    _run(go())


def test_invalid_outcome_rejected(db):
    async def go():
        await db.orders.insert_one({"order_id": "o1", "sales_person_email": "parul@ss.in",
                                    "order_status": "awaiting_confirmation"})
        with pytest.raises(Exception) as exc:
            await ordr.log_order_call("o1", FakeRequest({"outcome": "not-a-real-outcome"}))
        assert "422" in str(exc.value)
    _run(go())


def test_call_logging_never_blocks_confirm(db):
    # No call needed at all — Confirm must work with zero calls logged.
    async def go():
        await db.dies.insert_one({"die_id": "d1", "name": "Star", "code": "D-1",
                                  "type": "standard", "stock_qty": 10, "reserved_qty": 0})
        await db.orders.insert_one({"order_id": "o1", "sales_person_email": "parul@ss.in",
                                    "order_status": "awaiting_confirmation", "total_items": 0})
        assert (await ordr.list_order_calls("o1", FakeRequest())) == []
        resp = await ordr.confirm_order("o1", FakeRequest())
        assert resp["message"] == "Order confirmed"
    _run(go())
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_order_call_log.py -v`
Expected: FAIL — `build_order_call_note` and `log_order_call`/`list_order_calls` don't exist yet.

- [ ] **Step 3: Add the pure builder**

In `backend/crm_contact_calls.py`, after `build_call_note` (currently ending at line 53), add:
```python
def build_order_call_note(order: Dict[str, Any], user: Dict[str, Any],
                          outcome: str, content: str, now_iso: str) -> Dict[str, Any]:
    """Same shape as build_call_note, keyed on an order instead of a contact —
    for a call logged about a school/teacher's submitted item selection.
    Never required before Confirm/Edit/Reject; purely a record of what was
    discussed."""
    return {
        "note_id": f"note_{uuid.uuid4().hex[:12]}",
        "contact_id": None,
        "lead_id": None,
        "order_id": order["order_id"],
        "type": "call",
        "content": content or "",
        "outcome": outcome,
        "created_by": user.get("email", ""),
        "created_by_name": user.get("name", ""),
        "created_at": now_iso,
    }
```

- [ ] **Step 4: Add the endpoints**

In `backend/routes/order_routes.py`, add the import near the top (alongside the existing `from rbac import ...` line, currently line 14):
```python
import crm_contact_calls as cc
```

Then, after the Reject endpoint added in Task 4, add:
```python
@router.post("/orders/{order_id}/calls")
async def log_order_call(order_id: str, request: Request):
    """Optional call note about a submitted selection — never required to
    Confirm, Edit, or Reject; purely a record of what was discussed."""
    user = await get_current_user(request)
    order = await db.orders.find_one({"order_id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    _assert_can_act_on_order(user, order)
    body = await request.json()
    outcome = (body.get("outcome") or "").strip()
    if not cc.is_valid_outcome(outcome):
        raise HTTPException(status_code=422, detail=f"outcome must be one of {list(cc.CALL_OUTCOMES)}")
    now_iso = datetime.now(timezone.utc).isoformat()
    note = cc.build_order_call_note(order, user, outcome, body.get("content", ""), now_iso)
    await db.call_notes.insert_one(dict(note))
    await db.order_timeline.insert_one({
        "timeline_id": f"tl_{uuid.uuid4().hex[:8]}", "order_id": order_id,
        "status": order.get("order_status", "pending"),
        "note": f"Call logged ({outcome}): {body.get('content', '')}".strip(),
        "updated_by": user["email"], "timestamp": now_iso,
    })
    return await db.call_notes.find_one({"note_id": note["note_id"]}, {"_id": 0})


@router.get("/orders/{order_id}/calls")
async def list_order_calls(order_id: str, request: Request):
    user = await get_current_user(request)
    order = await db.orders.find_one({"order_id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    _assert_can_act_on_order(user, order)
    return await db.call_notes.find({"order_id": order_id}, {"_id": 0}).sort("created_at", -1).to_list(200)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_order_call_log.py -v`
Expected: PASS (4 tests)

- [ ] **Step 6: Run the full new test suite together**

Run: `cd backend && python -m pytest tests/test_order_confirmation_status.py tests/test_order_confirmation_rbac.py tests/test_order_confirmation_creation.py tests/test_order_confirm_reject.py tests/test_order_confirmation_edit_selection.py tests/test_order_call_log.py tests/test_order_cancel.py tests/test_order_diff.py tests/test_orders_holds.py -v`
Expected: PASS — every test from every task, plus the pre-existing order suites, green together.

- [ ] **Step 7: Commit**

```bash
git add backend/crm_contact_calls.py backend/routes/order_routes.py backend/tests/test_order_call_log.py
git commit -m "feat(orders): optional call logging on an awaiting-confirmation order"
```

---

## What this plan does not cover (deliberately)

- Any frontend: the "Orders awaiting confirmation" internal panel (Confirm/Edit/Reject/Log-a-call UI) and the School Portal's real item-picker (replacing its free-text Reorder box) are a separate, follow-on plan that consumes the endpoints built here. `GET /school/orders` and `GET /school/orders/{id}` (already existing, `school_routes.py:64-81`) already return an `awaiting_confirmation` order with its full timeline to the school with zero backend changes — confirmed while researching this plan.
- `GET /orders` (the admin order list) is not modified to add an `awaiting_confirmation` filter/tab — that is a frontend-plan concern (which endpoint parameter or client-side filter to use is a UI decision, not a behavior one).
