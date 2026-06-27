# GRN Receive-with-Reject + Admin Select-and-Delete — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let receiving split each line into Accepted/Rejected (auto vendor return for rejects), and give admins a select-and-delete with stock reversal for GRN / Stock Movement / PO / Vendor Return / Challan.

**Architecture:** Backend changes in `procurement_routes.py` + `inventory_routes.py`, reusing `audit_backup.snapshot_and_delete` for backup+delete and adding a stock-reversal helper that runs *before* the snapshot. Frontend changes in the QC dialog and the procurement/stock list pages, plus new delete methods on the `procurement` + `stock` API clients.

**Tech Stack:** FastAPI + Motor (MongoDB), React (CRA/craco), axios, sonner.

## Global Constraints

- Admin-only deletes: gate on `get_team(user) == "admin"` → else `HTTPException(403)`.
- Every delete reverses stock effects FIRST, then `snapshot_and_delete(...)` for restorability.
- New GRN line fields default to 0/empty; existing GRNs must read normally.
- Frontend builds OFF-box: `node_modules/.bin/craco build` (DISABLE_ESLINT_PLUGIN=true).
- Reuse existing helpers: `_apply_stock_in`, `_reverse_movement` (new), `snapshot_and_delete`, `require_module`, `get_team`.

---

## PART A — Receiving with Good/Rejected split

### Task A1: QC accepts received/rejected quantities; stock only the accepted

**Files:**
- Modify: `backend/routes/procurement_routes.py` (`submit_qc` ~L1106-1159, `_advance_po_after_qc` ~L1162-1192)
- Test: `backend/tests/test_grn_reject.py` (create)

**Interfaces:**
- Produces: GRN line now carries `received_qty`, `rejected_qty`, `accepted_qty`, `reject_reason`, derived `qc_status` (`accepted`|`partial_reject`|`rejected`). `_apply_stock_in(item_ref, accepted_qty, …)` unchanged signature.

- [ ] **Step 1: Write failing test** `backend/tests/test_grn_reject.py`

```python
import pytest
from backend.routes import procurement_routes as pr

def test_accepted_is_received_minus_rejected():
    line = {"po_line_index": 0, "received_qty": 2, "rejected_qty": 1}
    out = pr._normalize_qc_line(line, {"po_line_index": 0, "item_ref": {}, "received_qty": 0})
    assert out["accepted_qty"] == 1
    assert out["qc_status"] == "partial_reject"

def test_reject_requires_reason():
    with pytest.raises(Exception):
        pr._normalize_qc_line({"po_line_index": 0, "received_qty": 2, "rejected_qty": 2, "reject_reason": ""},
                              {"po_line_index": 0, "item_ref": {}})
```

- [ ] **Step 2: Run test, expect fail** — `python -m pytest backend/tests/test_grn_reject.py -q` → FAIL (`_normalize_qc_line` undefined).

- [ ] **Step 3: Add `_normalize_qc_line` helper + rewire `submit_qc`**

Add helper above `submit_qc`:

```python
def _normalize_qc_line(upd: dict, existing: dict) -> dict:
    received = float(upd.get("received_qty", existing.get("received_qty", 0)) or 0)
    rejected = float(upd.get("rejected_qty", existing.get("rejected_qty", 0)) or 0)
    if rejected < 0 or received < 0 or rejected > received:
        raise HTTPException(status_code=400, detail="rejected_qty must be between 0 and received_qty")
    reason = (upd.get("reject_reason", existing.get("reject_reason", "")) or "").strip()
    if rejected > 0 and not reason:
        raise HTTPException(status_code=400, detail="A rejection reason is required when rejected_qty > 0")
    accepted = round2(received - rejected)
    status = "rejected" if (received > 0 and rejected == received) else ("partial_reject" if rejected > 0 else "accepted")
    return {**existing, "received_qty": round2(received), "rejected_qty": round2(rejected),
            "accepted_qty": accepted, "reject_reason": reason, "qc_status": status,
            "remark": upd.get("remark", existing.get("remark", reason))}
```

In `submit_qc`, replace the per-line merge/stock loop body with:

```python
    new_lines = []
    stocked = 0
    for l in g["lines"]:
        merged = _normalize_qc_line(incoming.get(l["po_line_index"], {}), l)
        if merged["accepted_qty"] > 0:
            await _apply_stock_in(merged["item_ref"], merged["accepted_qty"],
                                  grn_id, g.get("grn_no"), user["email"])
            stocked += 1
        new_lines.append(merged)
```

In `_advance_po_after_qc`, change the accumulation to use accepted:

```python
    for ql in qc_lines:
        idx = ql.get("po_line_index")
        if isinstance(idx, int) and 0 <= idx < len(lines):
            prev = float(lines[idx].get("received_qty", 0) or 0)
            lines[idx]["received_qty"] = round2(prev + float(ql.get("accepted_qty", 0) or 0))
```

(Remove the `if ql.get("qc_status") != "ok": continue` guard.)

- [ ] **Step 4: Run test, expect pass** — `python -m pytest backend/tests/test_grn_reject.py -q` → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(grn): accept/reject quantities per line; stock only accepted"`

### Task A2: Auto-create vendor return from rejected lines

**Files:**
- Modify: `backend/routes/procurement_routes.py` (`create_return` ~L1205, `submit_qc`)

**Interfaces:**
- Consumes: A1's normalized lines (`rejected_qty`, `reject_reason`).
- Produces: `_build_vendor_return(grn, rejected_lines, user)` returns the inserted vendor_return doc; `submit_qc` calls it when any `rejected_qty > 0`.

- [ ] **Step 1: Extract `_build_vendor_return` from `create_return`**

```python
async def _build_vendor_return(g: dict, rejected_lines: list, user: dict) -> dict:
    grand = round2(sum(float(l["qty"] or 0) * float(l["rate"] or 0) for l in rejected_lines))
    return_id = _new_id("ret")
    return_no = await next_number("return", "RET")
    doc = {"return_id": return_id, "return_no": return_no, "grn_id": g["grn_id"],
           "grn_no": g.get("grn_no"), "vendor_id": g.get("vendor_id"),
           "vendor_name": g.get("vendor_name"), "lines": rejected_lines,
           "grand_total": grand, "created_by": user["email"], "created_at": _now()}
    await db.vendor_returns.insert_one(doc)
    await db.goods_receipts.update_one({"grn_id": g["grn_id"]}, {"$set": {"return_id": return_id}})
    return await db.vendor_returns.find_one({"return_id": return_id}, {"_id": 0})
```

Rewrite `create_return` to build `return_lines` from `rejected_qty>0` lines and delegate to the helper:

```python
    return_lines = [
        {"item_ref": l["item_ref"], "name": l["name"], "qty": l.get("rejected_qty", 0),
         "rate": l.get("rate", 0), "reason": l.get("reject_reason") or l.get("remark") or "Rejected at QC"}
        for l in g.get("lines", []) if float(l.get("rejected_qty", 0) or 0) > 0
    ]
    if not return_lines:
        raise HTTPException(status_code=400, detail="No rejected quantities to return")
    return await _build_vendor_return(g, return_lines, user)
```

- [ ] **Step 2: Auto-call from `submit_qc`** — after the GRN/PO updates, before `return`:

```python
    rejected_lines = [
        {"item_ref": l["item_ref"], "name": l["name"], "qty": l["rejected_qty"],
         "rate": l.get("rate", 0), "reason": l.get("reject_reason") or "Rejected at QC"}
        for l in new_lines if float(l.get("rejected_qty", 0) or 0) > 0
    ]
    if rejected_lines:
        g2 = await db.goods_receipts.find_one({"grn_id": grn_id}, {"_id": 0})
        if not g2.get("return_id"):
            try:
                await _build_vendor_return(g2, rejected_lines, user)
            except Exception as _e:
                logging.warning(f"Auto vendor-return failed for {grn_id}: {_e}")
```

- [ ] **Step 3: Verify** — `python -c "import ast; ast.parse(open('backend/routes/procurement_routes.py',encoding='utf-8').read())"` → no error.

- [ ] **Step 4: Commit** — `git commit -am "feat(grn): auto vendor return from rejected quantities"`

### Task A3: QC dialog — Received / Rejected / Accepted columns + required reason

**Files:**
- Modify: `frontend/src/components/procurement/ReceivingQC.js` (QCDialog)

- [ ] **Step 1: State maps rejected_qty + reason**

In the `setLines` mapper use: `received_qty`, `rejected_qty: l.rejected_qty || 0`, `reject_reason: l.reject_reason || l.remark || ''` (drop `qc_status` select).

- [ ] **Step 2: Table columns** — replace headers with `['', 'Item', 'Ordered', 'Received', 'Rejected', 'Accepted', 'Reason']`; per row:
  - Received: number input bound to `received_qty`.
  - Rejected: number input bound to `rejected_qty` (min 0, max received).
  - Accepted: read-only `Math.max(0, (Number(l.received_qty)||0) - (Number(l.rejected_qty)||0))`.
  - Reason: `select` of `QC_REASONS`, shown/required when `rejected_qty > 0`.

- [ ] **Step 3: Submit payload** — post `{ lines: lines.map(l => ({ po_line_index, received_qty:Number(l.received_qty)||0, rejected_qty:Number(l.rejected_qty)||0, reject_reason:l.reject_reason })) }`. Block with a toast if any line has `rejected_qty>0 && !reject_reason`.

- [ ] **Step 4: Build** — `cd frontend && DISABLE_ESLINT_PLUGIN=true ./node_modules/.bin/craco build` → success; grep build for `Accepted`.

- [ ] **Step 5: Commit** — `git commit -am "feat(grn-ui): received/rejected/accepted columns + required reason"`

---

## PART B — Admin select-and-delete with reversal

### Task B1: Stock reversal helper + DELETE stock movement

**Files:**
- Modify: `backend/routes/inventory_routes.py` (add `_reverse_movement`, `DELETE /stock/movements/{id}`)
- Test: `backend/tests/test_admin_delete.py` (create)

**Interfaces:**
- Produces: `async def _reverse_movement(mov: dict)` adjusts `dies`/`purchase_items` `stock_qty` to undo a movement; `DELETE /stock/movements/{movement_id}` (admin) reverses + snapshots + deletes.

- [ ] **Step 1: Add `_reverse_movement`**

```python
_INBOUND = {"purchase_in", "stock_in", "returnable_in", "returned_from_sales"}
_OUTBOUND = {"stock_out", "returnable_out", "allocated_to_sales"}

async def _reverse_movement(mov: dict):
    mtype = mov.get("movement_type"); qty = float(mov.get("quantity", 0) or 0)
    ref = mov.get("item_ref") or {}
    src = ref.get("source") or ("die" if mov.get("die_id") else None)
    _id = ref.get("id") or mov.get("die_id") or mov.get("purchase_item_id")
    coll = "dies" if src == "die" else "purchase_items" if src == "purchase_item" else ("dies" if mov.get("die_id") else None)
    key = "die_id" if coll == "dies" else "purchase_item_id"
    if not coll or not _id: return
    if mtype == "physical_adjustment":
        if mov.get("system_qty") is not None:
            await db[coll].update_one({key: _id}, {"$set": {"stock_qty": int(mov["system_qty"])}})
    elif mtype in _INBOUND:
        await db[coll].update_one({key: _id}, {"$inc": {"stock_qty": -qty}})
    elif mtype in _OUTBOUND:
        await db[coll].update_one({key: _id}, {"$inc": {"stock_qty": qty}})
```

- [ ] **Step 2: Add admin DELETE endpoint** (import `get_team`, `snapshot_and_delete`)

```python
@router.delete("/stock/movements/{movement_id}")
async def delete_stock_movement(movement_id: str, request: Request):
    user = await get_current_user(request)
    if get_team(user) != "admin":
        raise HTTPException(status_code=403, detail="Admins only")
    mov = await db.stock_movements.find_one({"movement_id": movement_id}, {"_id": 0})
    if not mov:
        raise HTTPException(status_code=404, detail="Movement not found")
    await _reverse_movement(mov)
    await snapshot_and_delete([("stock_movements", {"movement_id": movement_id})],
        root_type="stock_movement", root_id=movement_id,
        root_label=f"{mov.get('movement_type')} {mov.get('quantity')}", deleted_by=user["email"])
    return {"message": "Deleted and stock reversed"}
```

- [ ] **Step 3: Test reversal math** in `backend/tests/test_admin_delete.py` (monkeypatch `db`); assert inbound delete decrements, outbound increments. Run → PASS.

- [ ] **Step 4: Commit** — `git commit -am "feat(stock): admin delete movement with reversal"`

### Task B2: DELETE GRN (reverse purchase_in + roll back PO) and PO cascade

**Files:**
- Modify: `backend/routes/procurement_routes.py`

**Interfaces:**
- Produces: `_delete_grn_internal(grn, user)` reverses every `stock_movements` with `reference_id==grn_id`, subtracts `accepted_qty` from PO lines + recomputes PO status, snapshots+deletes the GRN and its vendor_returns. `DELETE /goods-receipts/{grn_id}` and `DELETE /purchase-orders/{po_id}` (cascade) call it.

- [ ] **Step 1: Add `_delete_grn_internal`** — reverse movements, adjust PO, snapshot GRN+returns+its movements, delete.

```python
async def _delete_grn_internal(g: dict, user: dict):
    grn_id = g["grn_id"]
    movs = await db.stock_movements.find({"reference_id": grn_id}, {"_id": 0}).to_list(10000)
    from inventory_routes import _reverse_movement  # reuse the inventory reversal
    for m in movs:
        await _reverse_movement(m)
    # roll back PO received_qty by this GRN's accepted quantities, recompute status
    if g.get("po_id"):
        po = await db.purchase_orders.find_one({"po_id": g["po_id"]}, {"_id": 0})
        if po:
            lines = po.get("lines", [])
            for gl in g.get("lines", []):
                idx = gl.get("po_line_index")
                if isinstance(idx, int) and 0 <= idx < len(lines):
                    lines[idx]["received_qty"] = round2(max(0.0,
                        float(lines[idx].get("received_qty",0) or 0) - float(gl.get("accepted_qty",0) or 0)))
            any_recv = any(float(l.get("received_qty",0) or 0) > 0 for l in lines)
            status = "partially_received" if any_recv else "sent"
            await db.purchase_orders.update_one({"po_id": po["po_id"]},
                {"$set": {"lines": lines, "status": status, "updated_at": _now()}})
    await snapshot_and_delete([
        ("goods_receipts", {"grn_id": grn_id}),
        ("vendor_returns", {"grn_id": grn_id}),
        ("stock_movements", {"reference_id": grn_id}),
    ], root_type="grn", root_id=grn_id, root_label=g.get("grn_no",""), deleted_by=user["email"])
```

- [ ] **Step 2: Add the two endpoints**

```python
@router.delete("/goods-receipts/{grn_id}")
async def delete_grn(grn_id: str, request: Request):
    user = await get_current_user(request)
    if get_team(user) != "admin": raise HTTPException(status_code=403, detail="Admins only")
    g = await db.goods_receipts.find_one({"grn_id": grn_id}, {"_id": 0})
    if not g: raise HTTPException(status_code=404, detail="GRN not found")
    await _delete_grn_internal(g, user)
    return {"message": "GRN deleted and stock reversed"}

@router.delete("/purchase-orders/{po_id}")
async def delete_po(po_id: str, request: Request):
    user = await get_current_user(request)
    if get_team(user) != "admin": raise HTTPException(status_code=403, detail="Admins only")
    po = await db.purchase_orders.find_one({"po_id": po_id}, {"_id": 0})
    if not po: raise HTTPException(status_code=404, detail="PO not found")
    for g in await db.goods_receipts.find({"po_id": po_id}, {"_id": 0}).to_list(10000):
        await _delete_grn_internal(g, user)
    await snapshot_and_delete([("purchase_orders", {"po_id": po_id})],
        root_type="po", root_id=po_id, root_label=po.get("po_no",""), deleted_by=user["email"])
    return {"message": "PO and its receipts deleted; stock reversed"}
```

- [ ] **Step 3: Verify** — `python -c "import ast; ast.parse(open('backend/routes/procurement_routes.py',encoding='utf-8').read())"`.

- [ ] **Step 4: Commit** — `git commit -am "feat(procurement): admin delete GRN + PO cascade with reversal"`

### Task B3: DELETE vendor return + challan

**Files:**
- Modify: `backend/routes/procurement_routes.py` (vendor return), challan route file (locate via `grep -rn '/challans'`).

- [ ] **Step 1: DELETE vendor return** (no stock effect; clear grn link)

```python
@router.delete("/vendor-returns/{return_id}")
async def delete_vendor_return(return_id: str, request: Request):
    user = await get_current_user(request)
    if get_team(user) != "admin": raise HTTPException(status_code=403, detail="Admins only")
    r = await db.vendor_returns.find_one({"return_id": return_id}, {"_id": 0})
    if not r: raise HTTPException(status_code=404, detail="Return not found")
    if r.get("grn_id"):
        await db.goods_receipts.update_one({"grn_id": r["grn_id"]}, {"$unset": {"return_id": ""}})
    await snapshot_and_delete([("vendor_returns", {"return_id": return_id})],
        root_type="vendor_return", root_id=return_id, root_label=r.get("return_no",""), deleted_by=user["email"])
    return {"message": "Return deleted"}
```

- [ ] **Step 2: DELETE challan** — reverse its `returnable_out`/`returnable_in` movements (`reference_id==challan_id`) then snapshot+delete the challan.

```python
@router.delete("/challans/{challan_id}")
async def delete_challan(challan_id: str, request: Request):
    user = await get_current_user(request)
    if get_team(user) != "admin": raise HTTPException(status_code=403, detail="Admins only")
    c = await db.challans.find_one({"challan_id": challan_id}, {"_id": 0})
    if not c: raise HTTPException(status_code=404, detail="Challan not found")
    from inventory_routes import _reverse_movement
    for m in await db.stock_movements.find({"reference_id": challan_id}, {"_id": 0}).to_list(10000):
        await _reverse_movement(m)
    await snapshot_and_delete([("challans", {"challan_id": challan_id}),
        ("stock_movements", {"reference_id": challan_id})],
        root_type="challan", root_id=challan_id, root_label=c.get("challan_no",""), deleted_by=user["email"])
    return {"message": "Challan deleted and stock reversed"}
```

- [ ] **Step 3: Verify + commit** — ast parse both files; `git commit -am "feat(procurement): admin delete vendor return + challan"`

### Task B4: Frontend — API delete methods + admin delete buttons

**Files:**
- Modify: `frontend/src/lib/api.js` (procurement.{purchaseOrders,goodsReceipts,vendorReturns,challans}.delete; stock.deleteMovement)
- Modify: `frontend/src/pages/admin/Procurement.js`, `frontend/src/components/procurement/ReceivingQC.js` (GRN + Returns delete), `frontend/src/pages/admin/StockManagement.js` (movement delete)

- [ ] **Step 1: API methods**

```js
// in stock client: deleteMovement: (id) => API.delete(`/stock/movements/${id}`),
// purchaseOrders: remove: (id) => API.delete(`/purchase-orders/${id}`),
// goodsReceipts: remove: (id) => API.delete(`/goods-receipts/${id}`),
// vendorReturns: remove: (id) => API.delete(`/vendor-returns/${id}`),
// challans: remove: (id) => API.delete(`/challans/${id}`),
```

- [ ] **Step 2: Admin-gated delete buttons** — in each list, when `user.role === 'admin'`, render a trash button per row (and/or row checkboxes + "Delete selected"); on confirm call the API method, then refetch (the axios interceptor already emits the domain change). Use a `window.confirm` naming the record and the stock reversal.

- [ ] **Step 3: Build** — `DISABLE_ESLINT_PLUGIN=true ./node_modules/.bin/craco build` → success.

- [ ] **Step 4: Commit** — `git commit -am "feat(ui): admin select-and-delete for PO/GRN/movement/return/challan"`

### Task B5: Deploy

- [ ] Rebuild bundle, commit `frontend/build` + source, `git push origin HEAD:main`, poll live for the new `main.*.js`, verify HTTP 200.

---

## Self-Review

- **Spec coverage:** Part A (A1 accept/reject math + stock-accepted, A2 auto return, A3 UI) ✓; Part B (B1 movement, B2 GRN+PO cascade, B3 return+challan, B4 UI, B5 deploy) ✓; admin gating ✓; audit backup ✓; stock reversal ✓.
- **Type consistency:** `_reverse_movement` defined in inventory_routes, imported into procurement_routes for GRN/challan; `_normalize_qc_line`/`_build_vendor_return`/`_delete_grn_internal` used consistently.
- **Note:** verify `round2`, `_new_id`, `next_number`, `_now`, `get_team` are importable in each file at implementation time; add imports if missing.
