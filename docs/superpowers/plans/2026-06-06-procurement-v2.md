# Procurement v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the live procurement module with editing, item codes, stock visibility (physical + available), receiving dates + sortable lists, a PO balance report, sales-order demand planning, a price-free packing list PDF, and a returnable-challan subsystem.

**Architecture:** Backend = FastAPI + Motor (MongoDB), append to `backend/routes/procurement_routes.py` and `procurement_pdf.py`; tests use `mongomock_motor` (never prod). Frontend = React + Tailwind, extend `frontend/src/pages/admin/Procurement.js` + `components/procurement/` and `frontend/src/lib/api.js`. Reuse existing helpers (`_item_display`, `_price_po_line`, `next_number`, `compute_gst_line`, ReportLab patterns).

**Tech Stack:** FastAPI, Motor, ReportLab, pytest+mongomock_motor; React 19, Radix UI, Tailwind, axios.

**Verification model:** Backend tasks are TDD with pytest (`backend/tests/test_procurement_*.py`, gitignored, run locally). Frontend has no RTL harness in this repo, so frontend tasks verify with (a) `npx babel` parse, (b) `CI=false npx craco build`, and (c) an explicit manual click-through checklist — the same gate used to ship v1.

**Conventions (must match):**
- IDs: `f"{prefix}_{uuid.uuid4().hex[:12]}"` via `_new_id(prefix)`. Timestamps: `_now()` (ISO-8601 UTC).
- RBAC: every route `await get_current_user(request)`; mutations `require_teams(user, "admin", "store")`; admin-only for approvals/masters.
- Money rounding via `round2`. GST via `compute_gst_line`.
- Frontend money: `inr(n)` helper already in `Procurement.js`. Images: `imgSrc(url)` helper.

---

## Phase 0 — Shared line-shape additions (item code + stock fields)

Adds `code` to every resolved line and exposes `reserved_qty`/`available_qty` in the item catalog. Everything downstream (display, demand, reports) depends on this, so it ships first.

### Task 0.1: `_item_display` returns item code

**Files:**
- Modify: `backend/routes/procurement_routes.py` (function `_item_display`, ~line 263)
- Test: `backend/tests/test_procurement_v2.py` (create)

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_procurement_v2.py
import os
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")
os.environ.setdefault("UPLOADS_DIR", os.path.join(os.path.dirname(__file__), "_uploads_tmp"))

import asyncio
import pytest
from mongomock_motor import AsyncMongoMockClient
import database
import routes.procurement_routes as pr


@pytest.fixture()
def ctx(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    mock_db = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(database, "db", mock_db)
    monkeypatch.setattr(pr, "db", mock_db)

    async def fake_user(request=None):
        return {"email": "store@test.in", "role": "admin"}
    monkeypatch.setattr(pr, "get_current_user", fake_user)

    app = FastAPI()
    app.include_router(pr.router, prefix="/api")
    tc = TestClient(app)

    async def seed():
        await mock_db.dies.insert_one({"die_id": "die_1", "name": "Heart Die", "code": "HD-1",
                                       "is_active": True, "stock_qty": 12, "reserved_qty": 4, "gst_pct": 18})
        await mock_db.settings.insert_one({"type": "company", "name": "SmartShape", "state_code": "22"})
    asyncio.run(seed())
    return tc, mock_db


def test_item_display_includes_code(ctx):
    _, _ = ctx
    disp = asyncio.run(pr._item_display({"source": "die", "id": "die_1"}))
    assert disp["code"] == "HD-1"
    assert disp["name"] == "Heart Die"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest backend/tests/test_procurement_v2.py::test_item_display_includes_code -q`
Expected: FAIL with `KeyError: 'code'`

- [ ] **Step 3: Add `code` to `_item_display` return values**

In `_item_display`, add `"code"` to each branch:

```python
    if src == "die":
        d = await db.dies.find_one({"die_id": _id}, {"_id": 0}) or {}
        return {"name": d.get("name", _id), "code": d.get("code", ""),
                "image_url": d.get("image_url"),
                "hsn": d.get("hsn", ""), "gst_pct": d.get("gst_pct", 0),
                "uom": "pcs", "default_rate": d.get("purchase_rate", 0) or 0}
    if src == "purchase_item":
        it = await db.purchase_items.find_one({"purchase_item_id": _id}, {"_id": 0}) or {}
        return {"name": it.get("name", _id), "code": it.get("code", ""),
                "image_url": it.get("image_url"),
                "hsn": it.get("hsn", ""), "gst_pct": it.get("gst_pct", 0),
                "uom": it.get("uom", "pcs"), "default_rate": it.get("default_rate", 0) or 0}
    return {"name": str(_id), "code": "", "image_url": None, "hsn": "", "gst_pct": 0,
            "uom": "pcs", "default_rate": 0}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest backend/tests/test_procurement_v2.py::test_item_display_includes_code -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/routes/procurement_routes.py
git commit -m "feat(procurement): _item_display returns item code"
```

### Task 0.2: `code` field on purchase items master

**Files:**
- Modify: `backend/routes/procurement_routes.py` (`PurchaseItemIn`, ~line 215)
- Test: `backend/tests/test_procurement_v2.py`

- [ ] **Step 1: Write the failing test**

```python
def test_purchase_item_accepts_code(ctx):
    tc, _ = ctx
    pi = tc.post("/api/purchase-items", json={"name": "Box", "code": "PKG-01"}).json()
    assert pi["code"] == "PKG-01"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest backend/tests/test_procurement_v2.py::test_purchase_item_accepts_code -q`
Expected: FAIL (`code` missing / KeyError)

- [ ] **Step 3: Add `code` to the model**

In `class PurchaseItemIn(BaseModel)` add the field:

```python
class PurchaseItemIn(BaseModel):
    name: str
    code: Optional[str] = ""
    category: Optional[str] = ""
    uom: Optional[str] = "pcs"
    hsn: Optional[str] = ""
    gst_pct: float = 0
    default_rate: float = 0
    min_level: int = 0
    stock_qty: int = 0
    is_active: bool = True
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest backend/tests/test_procurement_v2.py::test_purchase_item_accepts_code -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/routes/procurement_routes.py
git commit -m "feat(procurement): purchase items carry a code"
```

### Task 0.3: Lines carry `code`; catalog exposes reserved/available

**Files:**
- Modify: `backend/routes/procurement_routes.py` (`_build_req_lines` ~line 626, `_price_po_line` ~line 500, `create_goods_receipt` line block ~line 853, `item_catalog` ~line 290)
- Test: `backend/tests/test_procurement_v2.py`

- [ ] **Step 1: Write the failing test**

```python
def _po_with_line(tc):
    v = tc.post("/api/vendors", json={"name": "Acme", "state_code": "22"}).json()
    return tc.post("/api/purchase-orders", json={"vendor_id": v["vendor_id"], "lines": [
        {"item_ref": {"source": "die", "id": "die_1"}, "qty": 3, "rate": 100, "gst_pct": 18}]}).json()


def test_po_line_has_code(ctx):
    tc, _ = ctx
    po = _po_with_line(tc)
    assert po["lines"][0]["code"] == "HD-1"


def test_requisition_line_has_code(ctx):
    tc, _ = ctx
    req = tc.post("/api/requisitions", json={"lines": [
        {"item_ref": {"source": "die", "id": "die_1"}, "qty": 2}]}).json()
    assert req["lines"][0]["code"] == "HD-1"


def test_grn_line_has_code(ctx):
    tc, _ = ctx
    po = _po_with_line(tc)
    tc.post(f"/api/purchase-orders/{po['po_id']}/approve")
    grn = tc.post(f"/api/purchase-orders/{po['po_id']}/receive").json()
    assert grn["lines"][0]["code"] == "HD-1"


def test_catalog_exposes_available(ctx):
    tc, _ = ctx
    rows = tc.get("/api/procurement/item-catalog").json()
    die = next(r for r in rows if r["id"] == "die_1")
    assert die["stock_qty"] == 12
    assert die["reserved_qty"] == 4
    assert die["available_qty"] == 8
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest backend/tests/test_procurement_v2.py -q -k "code or available"`
Expected: FAIL (`KeyError: 'code'` / `'reserved_qty'`)

- [ ] **Step 3: Add `code` to line builders and stock fields to catalog**

In `_price_po_line`, after `name = ...`, add `code`:

```python
    code = raw.get("code") or vp.get("code") or disp.get("code") or ""
    gst = compute_gst_line(qty, rate, gst_pct, tax_mode)
    return {
        "item_ref": ref, "name": name, "code": code, "image_url": disp.get("image_url"),
        "hsn": hsn, "qty": qty, "uom": uom, "rate": round2(rate), "gst_pct": gst_pct,
        **gst,
    }
```

In `_build_req_lines`, include `code`:

```python
        out.append({
            "item_ref": ref,
            "name": raw.get("name") or disp.get("name"),
            "code": raw.get("code") or disp.get("code") or "",
            "image_url": disp.get("image_url"),
            "qty": float(raw.get("qty") or 0),
            "uom": raw.get("uom") or disp.get("uom") or "pcs",
            "est_rate": float(raw.get("est_rate") or disp.get("default_rate") or 0),
        })
```

In `create_goods_receipt`, add `code` to each receipt line (resolve from the PO line, which now has it):

```python
        lines.append({
            "po_line_index": i, "item_ref": l["item_ref"], "name": l["name"],
            "code": l.get("code", ""),
            "image_url": l.get("image_url"), "ordered_qty": ordered,
            "outstanding_qty": outstanding, "received_qty": outstanding,
            "rate": l.get("rate", 0),
            "qc_status": "pending", "qc_template_id": None, "qc_results": [], "remark": "",
        })
```

In `item_catalog`, for the `die` rows add reserved/available (and keep code which already exists):

```python
            rows.append({
                "item_ref": {"source": "die", "id": d.get("die_id")},
                "source": "die",
                "id": d.get("die_id"),
                "name": d.get("name"),
                "code": d.get("code"),
                "image_url": d.get("image_url"),
                "uom": "pcs",
                "hsn": d.get("hsn", ""),
                "gst_pct": d.get("gst_pct", 0),
                "default_rate": d.get("purchase_rate", 0) or 0,
                "stock_qty": d.get("stock_qty", 0),
                "reserved_qty": d.get("reserved_qty", 0),
                "available_qty": (d.get("stock_qty", 0) or 0) - (d.get("reserved_qty", 0) or 0),
            })
```

And for the `purchase_item` rows (no reservations), add zero reserved + available == stock:

```python
                "stock_qty": it.get("stock_qty", 0),
                "reserved_qty": 0,
                "available_qty": it.get("stock_qty", 0) or 0,
            })
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest backend/tests/test_procurement_v2.py -q -k "code or available"`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/routes/procurement_routes.py
git commit -m "feat(procurement): lines carry item code; catalog exposes reserved/available stock"
```

---

## Phase 1 — Requisition editing (frontend)

Backend `PUT /requisitions/{id}` already supports editing notes + lines for `draft`/`rejected` status. This phase adds the Edit UI.

### Task 1.1: Add "Edit" button + edit mode to RequisitionsTab

**Files:**
- Modify: `frontend/src/pages/admin/Procurement.js` (component `RequisitionsTab`)

- [ ] **Step 1: Add edit state and an editing-aware form**

In `RequisitionsTab`, add an `editingId` state next to the existing form state:

```javascript
  const [editingId, setEditingId] = useState(null);  // requisition_id being edited, or null
```

Replace `openNew` and add `openEdit`:

```javascript
  const openNew = () => { setEditingId(null); setNotes(''); setLines([]); setFormOpen(true); };
  const openEdit = (req) => {
    setEditingId(req.requisition_id);
    setNotes(req.notes || '');
    setLines((req.lines || []).map(l => ({
      item_ref: l.item_ref, name: l.name, code: l.code, image_url: l.image_url,
      uom: l.uom, qty: l.qty, default_rate: l.est_rate,
    })));
    setFormOpen(true);
  };
```

- [ ] **Step 2: Make `save` create OR update**

Replace the `save` function body:

```javascript
  const save = async () => {
    if (lines.length === 0) { toast.error('Add at least one item'); return; }
    const payload = {
      notes,
      lines: lines.map(l => ({ item_ref: l.item_ref, qty: Number(l.qty) || 1, uom: l.uom, name: l.name, code: l.code, est_rate: l.default_rate })),
    };
    try {
      if (editingId) await procurement.requisitions.update(editingId, payload);
      else await procurement.requisitions.create(payload);
      toast.success(editingId ? 'Requisition updated' : 'Requisition created');
      setFormOpen(false); load();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Save failed'); }
  };
```

- [ ] **Step 3: Add an Edit button on draft/rejected rows**

In the per-requisition row action group, before the `submit` button add:

```javascript
                {(req.status === 'draft' || req.status === 'rejected') &&
                  <Button size="sm" variant="outline" onClick={() => openEdit(req)} className="border-[var(--border-color)] text-[var(--text-secondary)] h-7" data-testid={`edit-req-${req.requisition_id}`}>Edit</Button>}
```

- [ ] **Step 4: Update the dialog title to reflect edit mode**

Change the requisition dialog header:

```javascript
          <DialogHeader><DialogTitle className={textPri}>{editingId ? 'Edit Requisition' : 'New Requisition'}</DialogTitle></DialogHeader>
```

- [ ] **Step 5: Verify parse + build**

Run: `cd frontend && node -e "require('@babel/core').transformFileSync('src/pages/admin/Procurement.js',{presets:[['@babel/preset-react'],['@babel/preset-env',{targets:{node:'current'}}]]});console.log('OK')"`
Expected: `OK`
Run: `cd frontend && CI=false npx craco build 2>&1 | grep -E "Compiled|Failed"`
Expected: `Compiled` (with warnings ok)

- [ ] **Step 6: Manual check**

On `/procurement` → Requisitions: create a draft → click **Edit** → change qty / add an item / remove a line → Save → reopen Edit and confirm changes persisted. Submit it, confirm Edit button disappears (only draft/rejected editable).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/admin/Procurement.js
git commit -m "feat(procurement): edit draft/rejected requisitions"
```

---

## Phase 2 — Draft PO editing (frontend)

Backend `PUT /purchase-orders/{id}` already edits `terms`/`expected_date`/`lines` (recomputing GST) for `draft` POs only. This phase adds an Edit action in the PO detail dialog. Vendor stays fixed (tax mode is derived from it); to change vendor, cancel and recreate.

### Task 2.1: Edit-draft-PO in the detail dialog

**Files:**
- Modify: `frontend/src/pages/admin/Procurement.js` (component `PurchaseOrdersTab`)

- [ ] **Step 1: Add edit state**

In `PurchaseOrdersTab`, add:

```javascript
  const [editPo, setEditPo] = useState(null);     // po being edited (draft only)
  const [editLines, setEditLines] = useState([]);
  const [editTerms, setEditTerms] = useState('');
  const [editExpected, setEditExpected] = useState('');
  const [editPickerOpen, setEditPickerOpen] = useState(false);
```

- [ ] **Step 2: Add open/save handlers**

```javascript
  const openEdit = (po) => {
    setEditPo(po);
    setEditTerms(po.terms || '');
    setEditExpected(po.expected_date ? String(po.expected_date).slice(0, 10) : '');
    setEditLines((po.lines || []).map(l => ({
      item_ref: l.item_ref, name: l.name, code: l.code, image_url: l.image_url,
      uom: l.uom, gst_pct: l.gst_pct, qty: l.qty, rate: l.rate, default_rate: l.rate,
    })));
  };
  const saveEdit = async () => {
    if (editLines.length === 0) { toast.error('Add at least one item'); return; }
    try {
      await procurement.purchaseOrders.update(editPo.po_id, {
        terms: editTerms, expected_date: editExpected || null,
        lines: editLines.map(l => ({ item_ref: l.item_ref, qty: Number(l.qty) || 1, rate: Number(l.rate ?? l.default_rate) || 0, gst_pct: l.gst_pct, uom: l.uom, name: l.name, code: l.code })),
      });
      toast.success('Purchase order updated');
      setEditPo(null);
      const d = await procurement.purchaseOrders.get(detail.po_id); setDetail(d.data);
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Update failed'); }
  };
```

- [ ] **Step 3: Add an "Edit" button for draft POs in the detail footer**

In the PO detail `DialogFooter`, add (only for draft):

```javascript
                {detail.status === 'draft' && <Button variant="outline" onClick={() => openEdit(detail)} className="border-[var(--border-color)] text-[var(--text-secondary)]" data-testid="po-edit">Edit</Button>}
```

- [ ] **Step 4: Add the edit dialog (reuses LineRows + ItemPicker) at the end of the component's returned JSX, before the closing `</div>`**

```javascript
      <Dialog open={!!editPo} onOpenChange={(o) => { if (!o) setEditPo(null); }}>
        <DialogContent className={`${dlgCls} w-[calc(100vw-1rem)] sm:max-w-2xl max-h-[90dvh] overflow-y-auto`}>
          <DialogHeader><DialogTitle className={textPri}>Edit PO {editPo?.po_no}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><Label className={`${textSec} text-xs`}>Expected Date</Label><Input type="date" value={editExpected} onChange={e => setEditExpected(e.target.value)} className={inputCls} /></div>
              <div><Label className={`${textSec} text-xs`}>Terms</Label><Input value={editTerms} onChange={e => setEditTerms(e.target.value)} className={inputCls} /></div>
            </div>
            <div className="flex items-center justify-between">
              <Label className={`${textSec} text-xs`}>Items</Label>
              <Button size="sm" variant="outline" onClick={() => setEditPickerOpen(true)} className="border-[var(--border-color)] text-[var(--text-secondary)] h-7"><Plus className="h-3 w-3 mr-1" />Add Items</Button>
            </div>
            <LineRows lines={editLines} setLines={setEditLines} withRate />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditPo(null)} className="border-[var(--border-color)] text-[var(--text-secondary)]">Cancel</Button>
            <Button onClick={saveEdit} className="bg-[#e94560] hover:bg-[#f05c75] text-white">Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ItemPicker open={editPickerOpen} onClose={() => setEditPickerOpen(false)} onConfirm={(p) => setEditLines(prev => [...prev, ...p])} />
```

- [ ] **Step 5: Verify parse + build**

Run: `cd frontend && CI=false npx craco build 2>&1 | grep -E "Compiled|Failed"`
Expected: `Compiled`

- [ ] **Step 6: Manual check**

Create a draft PO → open it → **Edit** → change a qty/rate, add an item → Save → confirm totals (subtotal/tax/grand) recomputed and the line list updated. Approve the PO → confirm the Edit button is gone (non-draft not editable).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/admin/Procurement.js
git commit -m "feat(procurement): edit draft purchase orders"
```

---

## Phase 3 — Item code + stock visibility (physical & available)

Surfaces `code` next to every item name, and shows **Physical** (`stock_qty`) and **Available** (`stock_qty - reserved_qty`) in the item picker.

### Task 3.1: Show code + stock in ItemPicker cards

**Files:**
- Modify: `frontend/src/components/procurement/ItemPicker.js`

- [ ] **Step 1: Render code + physical/available in each card**

In the card body, replace the name/meta block with:

```javascript
                      <div className="min-w-0 flex-1">
                        <p className={`${textPri} text-sm font-medium truncate`}>{row.name}</p>
                        {row.code ? <p className="text-[11px] font-mono text-[#e94560] truncate">{row.code}</p> : null}
                        <p className={`${textMuted} text-[11px]`}>{row.source === 'die' ? 'Product' : 'Material'} · {row.uom}</p>
                        <p className={`${textMuted} text-[11px]`}>Phys {row.stock_qty ?? 0} · Avail {row.available_qty ?? row.stock_qty ?? 0}</p>
                        {row.default_rate ? <p className={`${textSec} text-[11px]`}>₹{Number(row.default_rate).toLocaleString('en-IN')}</p> : null}
                      </div>
```

- [ ] **Step 2: Carry `code` + stock into the confirmed line objects**

In the `confirm` function's mapped object, add the fields:

```javascript
      .map(({ row, qty }) => ({
        item_ref: row.item_ref, name: row.name, code: row.code, image_url: row.image_url,
        uom: row.uom, hsn: row.hsn, gst_pct: row.gst_pct,
        default_rate: row.default_rate, stock_qty: row.stock_qty, available_qty: row.available_qty,
        qty: Number(qty),
      }));
```

- [ ] **Step 3: Show code in LineRows (Procurement.js)**

In `Procurement.js` `LineRows`, replace the name/meta block:

```javascript
          <div className="min-w-0 flex-1">
            <p className={`${textPri} text-sm font-medium truncate`}>{l.name}{l.code ? <span className="ml-2 text-[11px] font-mono text-[#e94560]">{l.code}</span> : null}</p>
            <p className={`${textMuted} text-[11px]`}>{l.item_ref?.source === 'die' ? 'Product' : 'Material'} · {l.uom || 'pcs'}{l.gst_pct ? ` · GST ${l.gst_pct}%` : ''}{(l.stock_qty != null) ? ` · Phys ${l.stock_qty}/Avail ${l.available_qty ?? l.stock_qty}` : ''}</p>
          </div>
```

- [ ] **Step 4: Show code column in the PO detail table**

In `PurchaseOrdersTab` detail table header, add `'Code'` after `'Item'`:

```javascript
                    <thead><tr className="bg-[var(--bg-primary)]">{['', 'Item', 'Code', 'HSN', 'Qty', 'Recv', 'Rate', 'Taxable', detail.tax_mode === 'intra' ? 'CGST' : 'IGST', detail.tax_mode === 'intra' ? 'SGST' : '', 'Total'].filter(Boolean).map((h, hi) => <th key={`${h}-${hi}`} className={`text-left text-[11px] uppercase py-2 px-2 ${textMuted}`}>{h}</th>)}</tr></thead>
```

And add the code cell right after the item name cell in each row:

```javascript
                          <td className={`py-2 px-2 ${textPri}`}>{l.name}</td>
                          <td className={`py-2 px-2 ${textMuted} font-mono text-xs`}>{l.code || '—'}</td>
```

- [ ] **Step 5: Verify build**

Run: `cd frontend && CI=false npx craco build 2>&1 | grep -E "Compiled|Failed"`
Expected: `Compiled`

- [ ] **Step 6: Manual check**

Open the item picker → cards show the code (pink mono) and `Phys N · Avail M`. Add items → the chosen-lines list and the PO detail show the code column.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/procurement/ItemPicker.js frontend/src/pages/admin/Procurement.js
git commit -m "feat(procurement): show item code + physical/available stock in picker and lines"
```

### Task 3.2: Show code in Purchase Item Master table

**Files:**
- Modify: `frontend/src/pages/admin/ProcurementMasters.js`

- [ ] **Step 1: Add a Code column + form field**

In `itemColumns`, add after the image column:

```javascript
    { key: 'code', label: 'Code', mono: true },
```

In `EMPTY_ITEM` add `code: ''`, and in the Purchase Item dialog add a field next to Category:

```javascript
                <div><Label className={`${textSec} text-xs`}>Code</Label><Input value={itemForm.code} onChange={e => setItemForm({ ...itemForm, code: e.target.value })} className={inputCls} placeholder="PKG-01" /></div>
```

And include `code` in the `saveItem` payload (it is already spread via `...itemForm`).

- [ ] **Step 2: Verify build**

Run: `cd frontend && CI=false npx craco build 2>&1 | grep -E "Compiled|Failed"`
Expected: `Compiled`

- [ ] **Step 3: Manual check**

Procurement Masters → Purchase Items → add an item with a Code → it shows in the table and flows into the picker.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/admin/ProcurementMasters.js
git commit -m "feat(procurement): purchase item code field + column"
```

---

## Phase 4 — Receiving date, sortable lists, close

Adds an editable `received_date` to goods receipts, sortable PO/GRN tables, and surfaces the existing PO close action (already added in v1) plus a GRN received-date display.

### Task 4.1: Goods receipt `received_date`

**Files:**
- Modify: `backend/routes/procurement_routes.py` (`create_goods_receipt`, `update_goods_receipt`)
- Test: `backend/tests/test_procurement_v2.py`

- [ ] **Step 1: Write the failing test**

```python
def test_grn_received_date(ctx):
    tc, _ = ctx
    po = _po_with_line(tc)
    tc.post(f"/api/purchase-orders/{po['po_id']}/approve")
    grn = tc.post(f"/api/purchase-orders/{po['po_id']}/receive").json()
    assert "received_date" in grn and grn["received_date"]  # defaulted
    upd = tc.put(f"/api/goods-receipts/{grn['grn_id']}", json={"received_date": "2026-06-01", "lines": []}).json()
    assert upd["received_date"] == "2026-06-01"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest backend/tests/test_procurement_v2.py::test_grn_received_date -q`
Expected: FAIL (`KeyError: 'received_date'`)

- [ ] **Step 3: Default + accept received_date**

In `create_goods_receipt`, add to the GRN doc (use date portion of `_now()`):

```python
    doc = {
        "grn_id": grn_id, "grn_no": grn_no, "po_id": po_id, "po_no": po.get("po_no"),
        "vendor_id": po.get("vendor_id"), "vendor_name": po.get("vendor_name"),
        "status": "pending_qc", "lines": lines, "received_by": user["email"],
        "received_date": _now()[:10],
        "timeline": [_timeline_entry("created", user["email"])],
        "created_at": _now(), "updated_at": _now(),
    }
```

In `update_goods_receipt`, allow editing it (before the `lines` merge):

```python
    body = await request.json()
    set_extra = {}
    if "received_date" in body:
        set_extra["received_date"] = body["received_date"]
    incoming = {l.get("po_line_index"): l for l in body.get("lines", [])}
    new_lines = []
    for l in g["lines"]:
        upd = incoming.get(l["po_line_index"], {})
        new_lines.append({
            **l,
            "received_qty": float(upd.get("received_qty", l.get("received_qty", 0)) or 0),
            "remark": upd.get("remark", l.get("remark", "")),
        })
    await db.goods_receipts.update_one({"grn_id": grn_id},
                                       {"$set": {"lines": new_lines, "updated_at": _now(), **set_extra}})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest backend/tests/test_procurement_v2.py::test_grn_received_date -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/routes/procurement_routes.py
git commit -m "feat(procurement): goods receipt received_date (default today, editable)"
```

### Task 4.2: Received date editor + display in QC dialog

**Files:**
- Modify: `frontend/src/components/procurement/ReceivingQC.js`
- Modify: `frontend/src/lib/api.js` (already has `goodsReceipts.update` — confirm)

- [ ] **Step 1: Add a received-date input to the QC dialog**

In `QCDialog`, add state and an input. After the `done` definition add:

```javascript
  const [recvDate, setRecvDate] = useState('');
  useEffect(() => { setRecvDate(grn?.received_date || ''); }, [grn]);
```

In the dialog body, above the table, add:

```javascript
            <div className="flex items-center gap-2 mb-2">
              <span className={`text-xs ${textMuted}`}>Receiving date</span>
              {done ? <span className={`text-sm ${textSec}`}>{recvDate || '—'}</span> :
                <Input type="date" value={recvDate} onChange={e => setRecvDate(e.target.value)} className={`${inputCls} h-8 w-44 text-sm`} />}
            </div>
```

- [ ] **Step 2: Persist received-date on QC submit**

In `submit`, before calling `submitQc`, save the date if changed:

```javascript
    setSaving(true);
    try {
      if (!done && recvDate && recvDate !== grn.received_date) {
        await procurement.goodsReceipts.update(grn.grn_id, { received_date: recvDate, lines: [] });
      }
      const r = await procurement.goodsReceipts.submitQc(grn.grn_id, {
```

- [ ] **Step 3: Show received date in the GRN list row**

In `ReceivingTab`'s goods-receipt rows, add to the meta span:

```javascript
                <span className={`text-xs ${textMuted}`}>{grn.po_no} · {grn.vendor_name} · {grn.received_date || ''}</span>
```

- [ ] **Step 4: Verify build**

Run: `cd frontend && CI=false npx craco build 2>&1 | grep -E "Compiled|Failed"`
Expected: `Compiled`

- [ ] **Step 5: Manual check**

Open a GRN → set the receiving date → submit QC → reopen and confirm the date shows (read-only after qc_done). The GRN list shows the date.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/procurement/ReceivingQC.js
git commit -m "feat(procurement): receiving date in QC dialog + GRN list"
```

### Task 4.3: Sortable PO and GRN lists

**Files:**
- Modify: `frontend/src/pages/admin/Procurement.js` (PO table), `frontend/src/components/procurement/ReceivingQC.js` (GRN list)

- [ ] **Step 1: Add a reusable sort hook inline in Procurement.js (top-level, after helpers)**

```javascript
function useSorted(rows, initialKey) {
  const [sort, setSort] = React.useState({ key: initialKey, dir: 'desc' });
  const sorted = React.useMemo(() => {
    const r = [...(rows || [])];
    r.sort((a, b) => {
      const av = a[sort.key] ?? '', bv = b[sort.key] ?? '';
      const cmp = (typeof av === 'number' && typeof bv === 'number') ? av - bv : String(av).localeCompare(String(bv));
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return r;
  }, [rows, sort]);
  const toggle = (key) => setSort(s => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }));
  return { sorted, sort, toggle };
}
```

- [ ] **Step 2: Use it in the PO table**

In `PurchaseOrdersTab`, after `load`, add:

```javascript
  const { sorted: sortedPos, sort, toggle } = useSorted(list, 'created_at');
```

Make the headers clickable and iterate `sortedPos` instead of `list`:

```javascript
          <thead><tr className="bg-[var(--bg-primary)]">
            {[['po_no', 'PO No'], ['vendor_name', 'Vendor'], [null, 'Items'], ['grand_total', 'Total'], ['status', 'Status'], ['created_at', 'Date']].map(([key, label]) => (
              <th key={label} onClick={() => key && toggle(key)} className={`text-left text-xs uppercase py-2.5 px-3 ${textMuted} ${key ? 'cursor-pointer select-none' : ''}`}>
                {label}{key && sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
              </th>
            ))}
            <th className={`text-left text-xs uppercase py-2.5 px-3 ${textMuted}`}></th>
          </tr></thead>
          <tbody>
            {sortedPos.map(po => (
```

Add a Date cell to each PO row (before the arrow cell):

```javascript
                <td className={`py-2.5 px-3 ${textMuted} text-xs`}>{(po.created_at || '').slice(0, 10)}</td>
```

- [ ] **Step 3: Sort GRN list by received_date in ReceivingQC.js**

In `ReceivingTab`, sort the GRNs newest-first before rendering:

```javascript
      const sortedGrns = [...grns].sort((a, b) => String(b.received_date || b.created_at || '').localeCompare(String(a.received_date || a.created_at || '')));
```

Render `sortedGrns.map(...)` instead of `grns.map(...)`.

- [ ] **Step 4: Verify build**

Run: `cd frontend && CI=false npx craco build 2>&1 | grep -E "Compiled|Failed"`
Expected: `Compiled`

- [ ] **Step 5: Manual check**

Click PO column headers → rows reorder, arrow indicator flips. GRNs list newest received first.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/admin/Procurement.js frontend/src/components/procurement/ReceivingQC.js
git commit -m "feat(procurement): sortable PO table + sorted GRN list"
```

---

## Phase 5 — PO balance report

A report of every active PO line: ordered, received, and balance (ordered − received).

### Task 5.1: Backend `/procurement/po-report`

**Files:**
- Modify: `backend/routes/procurement_routes.py` (add endpoint near `procurement_summary`)
- Test: `backend/tests/test_procurement_v2.py`

- [ ] **Step 1: Write the failing test**

```python
def test_po_report_balance(ctx):
    tc, _ = ctx
    po = _po_with_line(tc)  # die_1 qty 3
    tc.post(f"/api/purchase-orders/{po['po_id']}/approve")
    grn = tc.post(f"/api/purchase-orders/{po['po_id']}/receive").json()
    tc.post(f"/api/goods-receipts/{grn['grn_id']}/qc", json={"lines": [
        {"po_line_index": 0, "qc_status": "ok", "received_qty": 2}]})
    rep = tc.get("/api/procurement/po-report").json()
    row = next(r for r in rep if r["po_no"] == po["po_no"] and r["code"] == "HD-1")
    assert row["ordered_qty"] == 3 and row["received_qty"] == 2 and row["balance_qty"] == 1
    assert row["status"] == "partially_received"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest backend/tests/test_procurement_v2.py::test_po_report_balance -q`
Expected: FAIL (404 — endpoint not found)

- [ ] **Step 3: Add the endpoint**

```python
@router.get("/procurement/po-report")
async def po_report(request: Request, only_open: bool = True):
    """Per-line ordered/received/balance across purchase orders."""
    await get_current_user(request)
    query = {}
    if only_open:
        query["status"] = {"$in": ["approved", "sent", "partially_received"]}
    rows = []
    async for po in db.purchase_orders.find(query, {"_id": 0}):
        for l in po.get("lines", []):
            ordered = float(l.get("qty", 0) or 0)
            received = float(l.get("received_qty", 0) or 0)
            rows.append({
                "po_id": po["po_id"], "po_no": po.get("po_no"),
                "vendor_name": po.get("vendor_name"), "status": po.get("status"),
                "expected_date": po.get("expected_date"),
                "item_ref": l.get("item_ref"), "name": l.get("name"), "code": l.get("code", ""),
                "uom": l.get("uom", "pcs"),
                "ordered_qty": ordered, "received_qty": received,
                "balance_qty": round2(ordered - received),
            })
    rows.sort(key=lambda r: (r.get("expected_date") or "9999", r.get("po_no") or ""))
    return rows
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest backend/tests/test_procurement_v2.py::test_po_report_balance -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/routes/procurement_routes.py
git commit -m "feat(procurement): PO balance report endpoint"
```

### Task 5.2: Frontend — PO Report under the Dashboard tab

**Files:**
- Modify: `frontend/src/lib/api.js` (add `procurement.poReport`)
- Modify: `frontend/src/pages/admin/Procurement.js` (`DashboardTab`)

- [ ] **Step 1: Add the API method**

In the `procurement` object in `api.js`, near `summary`:

```javascript
  poReport: (onlyOpen = true) => API.get('/procurement/po-report', { params: { only_open: onlyOpen } }),
```

- [ ] **Step 2: Render a balance table in DashboardTab**

In `DashboardTab`, add state + load:

```javascript
  const [report, setReport] = useState([]);
  useEffect(() => { procurement.poReport().then(r => setReport(r.data || [])).catch(() => {}); }, []);
```

Append a section after the three-column grid (before the component's closing `</div>`):

```javascript
      <div className={`${card} border rounded-md p-4`}>
        <h3 className={`text-sm font-medium ${textPri} mb-3`}>Open PO balances ({report.length} lines)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="bg-[var(--bg-primary)]">{['PO', 'Vendor', 'Item', 'Code', 'Ordered', 'Received', 'Balance', 'Status'].map(h => <th key={h} className={`text-left text-[11px] uppercase py-2 px-2 ${textMuted}`}>{h}</th>)}</tr></thead>
            <tbody>
              {report.map((r, i) => (
                <tr key={i} className="border-t border-[var(--border-color)]">
                  <td className={`py-2 px-2 ${textPri}`}>{r.po_no}</td>
                  <td className={`py-2 px-2 ${textSec}`}>{r.vendor_name}</td>
                  <td className={`py-2 px-2 ${textSec}`}>{r.name}</td>
                  <td className={`py-2 px-2 ${textMuted} font-mono text-xs`}>{r.code || '—'}</td>
                  <td className={`py-2 px-2 ${textSec}`}>{r.ordered_qty}</td>
                  <td className={`py-2 px-2 ${textSec}`}>{r.received_qty}</td>
                  <td className={`py-2 px-2 font-medium ${r.balance_qty > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>{r.balance_qty}</td>
                  <td className="py-2 px-2"><Badge map={PO_STATUS} value={r.status} /></td>
                </tr>
              ))}
              {report.length === 0 && <tr><td colSpan={8} className={`py-6 text-center ${textMuted}`}>No open PO balances.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
```

- [ ] **Step 3: Verify build**

Run: `cd frontend && CI=false npx craco build 2>&1 | grep -E "Compiled|Failed"`
Expected: `Compiled`

- [ ] **Step 4: Manual check**

Create a PO, receive part of it → Dashboard shows the line with Ordered/Received/Balance and amber balance until fully received.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api.js frontend/src/pages/admin/Procurement.js
git commit -m "feat(procurement): PO balance report on dashboard"
```

---

## Phase 6 — Demand from sales orders

When raising a PO, suggest items from open sales orders with required vs available vs shortfall, and let the buyer add the shortfall or full quantity.

**Demand definition (locked):** for each `die_id`, `required_qty` = Σ `order_items.quantity` where the item's order has `order_status` in `("pending","confirmed")` and the item `status` not in `("cancelled","released","delivered")`. `physical_qty` = `dies.stock_qty`, `reserved_qty` = `dies.reserved_qty`, `available_qty` = `stock_qty - reserved_qty`, `shortfall_qty` = `max(0, required_qty - available_qty)`.

### Task 6.1: Backend `/procurement/demand`

**Files:**
- Modify: `backend/routes/procurement_routes.py`
- Test: `backend/tests/test_procurement_v2.py`

- [ ] **Step 1: Write the failing test**

```python
def test_demand_from_sales_orders(ctx):
    tc, db = ctx
    # die_1 has stock 12, reserved 4 -> available 8
    async def seed_orders():
        await db.orders.insert_one({"order_id": "ord_1", "order_number": "ORD-1", "order_status": "confirmed"})
        await db.orders.insert_one({"order_id": "ord_2", "order_number": "ORD-2", "order_status": "delivered"})  # closed -> ignored
        await db.order_items.insert_one({"order_item_id": "oi_1", "order_id": "ord_1", "die_id": "die_1", "quantity": 15, "status": "confirmed"})
        await db.order_items.insert_one({"order_item_id": "oi_2", "order_id": "ord_2", "die_id": "die_1", "quantity": 99, "status": "delivered"})
    asyncio.run(seed_orders())
    rows = tc.get("/api/procurement/demand").json()
    row = next(r for r in rows if r["die_id"] == "die_1")
    assert row["required_qty"] == 15
    assert row["physical_qty"] == 12 and row["available_qty"] == 8
    assert row["shortfall_qty"] == 7   # 15 - 8
    assert row["code"] == "HD-1"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest backend/tests/test_procurement_v2.py::test_demand_from_sales_orders -q`
Expected: FAIL (404)

- [ ] **Step 3: Add the endpoint**

```python
_OPEN_ORDER_STATUSES = ("pending", "confirmed")
_DEAD_ITEM_STATUSES = ("cancelled", "released", "delivered")


@router.get("/procurement/demand")
async def sales_order_demand(request: Request, shortfall_only: bool = False):
    """Required quantities from open sales orders vs available stock."""
    await get_current_user(request)
    open_ids = [o["order_id"] async for o in db.orders.find(
        {"order_status": {"$in": list(_OPEN_ORDER_STATUSES)}}, {"_id": 0, "order_id": 1})]
    required = {}  # die_id -> qty
    if open_ids:
        async for it in db.order_items.find(
                {"order_id": {"$in": open_ids}}, {"_id": 0, "die_id": 1, "quantity": 1, "status": 1}):
            if it.get("status") in _DEAD_ITEM_STATUSES:
                continue
            did = it.get("die_id")
            if did:
                required[did] = required.get(did, 0) + float(it.get("quantity", 0) or 0)
    rows = []
    for did, req_qty in required.items():
        d = await db.dies.find_one({"die_id": did}, {"_id": 0}) or {}
        phys = float(d.get("stock_qty", 0) or 0)
        reserved = float(d.get("reserved_qty", 0) or 0)
        avail = phys - reserved
        shortfall = max(0.0, round2(req_qty - avail))
        if shortfall_only and shortfall <= 0:
            continue
        rows.append({
            "die_id": did, "item_ref": {"source": "die", "id": did},
            "name": d.get("name", did), "code": d.get("code", ""), "image_url": d.get("image_url"),
            "uom": "pcs", "gst_pct": d.get("gst_pct", 0), "default_rate": d.get("purchase_rate", 0) or 0,
            "required_qty": round2(req_qty), "physical_qty": phys, "reserved_qty": reserved,
            "available_qty": round2(avail), "shortfall_qty": shortfall,
        })
    rows.sort(key=lambda r: -r["shortfall_qty"])
    return rows
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest backend/tests/test_procurement_v2.py::test_demand_from_sales_orders -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/routes/procurement_routes.py
git commit -m "feat(procurement): sales-order demand endpoint (required/available/shortfall)"
```

### Task 6.2: Frontend — "Demand from Sales Orders" panel in PO builder

**Files:**
- Modify: `frontend/src/lib/api.js` (add `procurement.demand`)
- Create: `frontend/src/components/procurement/DemandPanel.js`
- Modify: `frontend/src/pages/admin/Procurement.js` (`PurchaseOrdersTab` new-PO dialog)

- [ ] **Step 1: Add the API method**

```javascript
  demand: (shortfallOnly = false) => API.get('/procurement/demand', { params: { shortfall_only: shortfallOnly } }),
```

- [ ] **Step 2: Create DemandPanel.js**

```javascript
import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { procurement } from '../../lib/api';

const textPri = 'text-[var(--text-primary)]';
const textSec = 'text-[var(--text-secondary)]';
const textMuted = 'text-[var(--text-muted)]';

/**
 * DemandPanel — modal listing open-sales-order demand. onAdd(line) appends a PO line.
 * Each line: { item_ref, name, code, uom, gst_pct, default_rate, qty }.
 */
export default function DemandPanel({ open, onClose, onAdd }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [shortfallOnly, setShortfallOnly] = useState(true);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    procurement.demand(shortfallOnly).then(r => setRows(r.data || [])).catch(() => {}).finally(() => setLoading(false));
  }, [open, shortfallOnly]);

  const add = (r, qty) => {
    if (qty <= 0) return;
    onAdd({ item_ref: r.item_ref, name: r.name, code: r.code, uom: r.uom, gst_pct: r.gst_pct, default_rate: r.default_rate, qty });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)] w-[calc(100vw-1rem)] sm:max-w-3xl max-h-[90dvh] flex flex-col">
        <DialogHeader><DialogTitle className={textPri}>Required from Sales Orders</DialogTitle></DialogHeader>
        <label className={`flex items-center gap-2 text-xs ${textSec}`}>
          <input type="checkbox" checked={shortfallOnly} onChange={e => setShortfallOnly(e.target.checked)} /> Show only items short of stock
        </label>
        <div className="overflow-y-auto flex-1 mt-2">
          <table className="w-full text-sm">
            <thead><tr className="bg-[var(--bg-primary)]">{['Item', 'Code', 'Required', 'Physical', 'Available', 'Shortfall', ''].map(h => <th key={h} className={`text-left text-[11px] uppercase py-2 px-2 ${textMuted}`}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-[var(--border-color)]">
                  <td className={`py-2 px-2 ${textPri}`}>{r.name}</td>
                  <td className={`py-2 px-2 ${textMuted} font-mono text-xs`}>{r.code || '—'}</td>
                  <td className={`py-2 px-2 ${textSec}`}>{r.required_qty}</td>
                  <td className={`py-2 px-2 ${textSec}`}>{r.physical_qty}</td>
                  <td className={`py-2 px-2 ${textSec}`}>{r.available_qty}</td>
                  <td className={`py-2 px-2 font-medium ${r.shortfall_qty > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>{r.shortfall_qty}</td>
                  <td className="py-2 px-2 whitespace-nowrap">
                    <Button size="sm" variant="outline" disabled={r.shortfall_qty <= 0} onClick={() => add(r, r.shortfall_qty)} className="border-[var(--border-color)] text-[var(--text-secondary)] h-7 mr-1">+ Shortfall</Button>
                    <Button size="sm" variant="ghost" onClick={() => add(r, r.required_qty)} className={`${textSec} h-7`}>+ Full</Button>
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 && <tr><td colSpan={7} className={`py-8 text-center ${textMuted}`}>No open sales-order demand.</td></tr>}
            </tbody>
          </table>
        </div>
        <DialogFooter><Button onClick={onClose} className="bg-[#e94560] hover:bg-[#f05c75] text-white">Done</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Wire DemandPanel into the new-PO dialog**

In `Procurement.js`, import it at the top:

```javascript
import DemandPanel from '../../components/procurement/DemandPanel';
```

In `PurchaseOrdersTab`, add state `const [demandOpen, setDemandOpen] = useState(false);`. In the new-PO dialog Items header, add a button next to "Add Items":

```javascript
              <Button size="sm" variant="outline" onClick={() => setDemandOpen(true)} className="border-[var(--border-color)] text-[var(--text-secondary)] h-7 ml-2">From Sales Orders</Button>
```

At the end of the component (near the existing `<ItemPicker .../>`), add:

```javascript
      <DemandPanel open={demandOpen} onClose={() => setDemandOpen(false)} onAdd={(line) => setLines(prev => [...prev, line])} />
```

- [ ] **Step 4: Verify build**

Run: `cd frontend && CI=false npx craco build 2>&1 | grep -E "Compiled|Failed"`
Expected: `Compiled`

- [ ] **Step 5: Manual check**

Create an open sales order (Orders module) for a product with low stock → in Procurement → new PO → **From Sales Orders** → see required/available/shortfall → click **+ Shortfall** → the line is added to the PO with the shortfall qty.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/api.js frontend/src/components/procurement/DemandPanel.js frontend/src/pages/admin/Procurement.js
git commit -m "feat(procurement): demand-from-sales-orders panel in PO builder"
```

---

## Phase 7 — Packing list PDF (quantity only, no price)

A price-free packing slip for a PO: item code, name, qty, uom. No rates/GST/totals.

### Task 7.1: Backend packing-list PDF + endpoint

**Files:**
- Modify: `backend/routes/procurement_pdf.py` (add `generate_packing_list_pdf`)
- Modify: `backend/routes/procurement_routes.py` (add endpoint)
- Test: `backend/tests/test_procurement_v2.py`

- [ ] **Step 1: Write the failing test**

```python
def test_packing_list_pdf(ctx):
    tc, _ = ctx
    po = _po_with_line(tc)
    r = tc.get(f"/api/purchase-orders/{po['po_id']}/packing-list-pdf")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.content[:5] == b"%PDF-"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest backend/tests/test_procurement_v2.py::test_packing_list_pdf -q`
Expected: FAIL (404)

- [ ] **Step 3: Add the PDF generator (in procurement_pdf.py)**

```python
def generate_packing_list_pdf(po: dict, vendor: dict, company: dict) -> bytes:
    """Price-free packing slip: code, item, qty, uom only."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_RIGHT

    NAVY = colors.Color(0.102, 0.102, 0.180)
    GRAY = colors.Color(0.42, 0.42, 0.50)
    BORDER = colors.Color(0.80, 0.80, 0.86)
    WHITE = colors.white
    FONT, FONTB = _register_fonts()
    S = getSampleStyleSheet()

    def ps(name, **kw):
        if name not in S:
            S.add(ParagraphStyle(name=name, **kw))
    ps('Co', fontSize=14, leading=17, fontName=FONTB, textColor=NAVY)
    ps('Sub', fontSize=7.5, leading=10, fontName=FONT, textColor=GRAY)
    ps('Title', fontSize=20, leading=23, fontName=FONTB, textColor=NAVY, alignment=TA_RIGHT)
    ps('Meta', fontSize=8.5, leading=11, fontName=FONT, textColor=NAVY, alignment=TA_RIGHT)
    ps('Hc', fontSize=8, leading=10, fontName=FONTB, textColor=WHITE)
    ps('Cl', fontSize=8.5, leading=11, fontName=FONT, textColor=NAVY)

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=14 * mm, rightMargin=14 * mm,
                            topMargin=12 * mm, bottomMargin=12 * mm)
    el = [
        Table([[
            [Paragraph(company.get("name", "SmartShape") or "SmartShape", S['Co']),
             Paragraph(company.get("address", "") or "", S['Sub'])],
            [Paragraph("PACKING LIST", S['Title']),
             Paragraph(po.get("po_no", ""), S['Meta']),
             Paragraph("Vendor: " + (vendor.get("name", "") or ""), S['Meta'])],
        ]], colWidths=[100 * mm, 82 * mm]),
        Spacer(1, 8),
    ]
    rows = [[Paragraph(h, S['Hc']) for h in ["#", "Code", "Item", "Qty", "UOM"]]]
    for i, l in enumerate(po.get("lines", []), 1):
        rows.append([
            Paragraph(str(i), S['Cl']),
            Paragraph(str(l.get("code", "") or "-"), S['Cl']),
            Paragraph(str(l.get("name", "")), S['Cl']),
            Paragraph(f"{l.get('qty', 0):g}", S['Cl']),
            Paragraph(str(l.get("uom", "")), S['Cl']),
        ])
    tbl = Table(rows, colWidths=[10 * mm, 34 * mm, 96 * mm, 20 * mm, 22 * mm], repeatRows=1)
    tbl.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), NAVY),
        ('GRID', (0, 0), (-1, -1), 0.4, BORDER),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [WHITE, colors.Color(0.975, 0.975, 0.99)]),
        ('TOPPADDING', (0, 0), (-1, -1), 4), ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]))
    el.append(tbl)
    el.append(Spacer(1, 14))
    el.append(Paragraph("Received in good condition (sign): ____________________", S['Cl']))
    doc.build(el)
    return buf.getvalue()
```

- [ ] **Step 4: Add the endpoint (in procurement_routes.py, after `purchase_order_pdf`)**

```python
@router.get("/purchase-orders/{po_id}/packing-list-pdf")
async def purchase_order_packing_list(po_id: str, request: Request):
    await get_current_user(request)
    po = await db.purchase_orders.find_one({"po_id": po_id}, {"_id": 0})
    if not po:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    vendor = await db.vendors.find_one({"vendor_id": po.get("vendor_id")}, {"_id": 0}) or {}
    company = await db.settings.find_one({"type": "company"}, {"_id": 0}) or {}
    from routes.procurement_pdf import generate_packing_list_pdf
    from fastapi.responses import StreamingResponse
    import io as _io
    pdf = generate_packing_list_pdf(po, vendor, company)
    return StreamingResponse(_io.BytesIO(pdf), media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{po.get("po_no", "PO")}-packing-list.pdf"'})
```

- [ ] **Step 5: Run test to verify it passes**

Run: `python -m pytest backend/tests/test_procurement_v2.py::test_packing_list_pdf -q`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/routes/procurement_pdf.py backend/routes/procurement_routes.py
git commit -m "feat(procurement): price-free packing list PDF"
```

### Task 7.2: Frontend — Packing List button

**Files:**
- Modify: `frontend/src/lib/api.js` (add `downloadPackingList`)
- Modify: `frontend/src/pages/admin/Procurement.js` (PO detail footer)

- [ ] **Step 1: Add the API method (inside `purchaseOrders`)**

```javascript
    downloadPackingList: (id, poNo) => downloadFile(`/purchase-orders/${id}/packing-list-pdf`, `${poNo || 'PO'}-packing-list.pdf`),
```

- [ ] **Step 2: Add the button to the PO detail footer (next to the PDF button)**

```javascript
                <Button variant="outline" onClick={() => procurement.purchaseOrders.downloadPackingList(detail.po_id, detail.po_no).catch(() => toast.error('Download failed'))} className="border-[var(--border-color)] text-[var(--text-secondary)]"><Download className="h-3.5 w-3.5 mr-1" />Packing List</Button>
```

- [ ] **Step 3: Verify build**

Run: `cd frontend && CI=false npx craco build 2>&1 | grep -E "Compiled|Failed"`
Expected: `Compiled`

- [ ] **Step 4: Manual check**

Open a PO → **Packing List** → PDF downloads showing code/item/qty/uom and NO prices.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api.js frontend/src/pages/admin/Procurement.js
git commit -m "feat(procurement): packing-list download button"
```

---

## Phase 8 — Returnable challan subsystem

A `challans` collection covering three types: `returnable_out` (goods we send out that must return), `returnable_in` (vendor-supplied returnable goods we must return), and `vendor_return_delivery` (a delivery challan accompanying rejected goods back to the vendor). Tracks dispatched vs returned quantities, with a price-free challan PDF.

**Document shape (locked):**
```
challan_id, challan_no ("DC-0001"), type, direction ("outbound"|"inbound"),
party_type ("vendor"|"other"), vendor_id?, party_name, ref_type?, ref_id?,
challan_date, expected_return_date?, notes,
lines: [{item_ref, code, name, uom, qty, returned_qty}],
status ("open"|"partially_returned"|"closed"), timeline[], created_by, created_at, updated_at
```

### Task 8.1: Backend challan CRUD + counter + index

**Files:**
- Modify: `backend/routes/procurement_routes.py`
- Modify: `backend/database.py` (index)
- Test: `backend/tests/test_procurement_v2.py`

- [ ] **Step 1: Write the failing test**

```python
def test_challan_create_and_list(ctx):
    tc, _ = ctx
    v = tc.post("/api/vendors", json={"name": "JobWork Co"}).json()
    ch = tc.post("/api/challans", json={
        "type": "returnable_out", "direction": "outbound",
        "party_type": "vendor", "vendor_id": v["vendor_id"], "party_name": "JobWork Co",
        "challan_date": "2026-06-06", "notes": "for plating",
        "lines": [{"item_ref": {"source": "die", "id": "die_1"}, "qty": 10}],
    }).json()
    assert ch["challan_no"].startswith("DC-")
    assert ch["status"] == "open"
    assert ch["lines"][0]["code"] == "HD-1" and ch["lines"][0]["returned_qty"] == 0
    assert any(c["challan_id"] == ch["challan_id"] for c in tc.get("/api/challans").json())
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest backend/tests/test_procurement_v2.py::test_challan_create_and_list -q`
Expected: FAIL (404)

- [ ] **Step 3: Add CRUD endpoints**

```python
# ==================== RETURNABLE CHALLANS ====================

_CHALLAN_TYPES = ("returnable_out", "returnable_in", "vendor_return_delivery")


async def _build_challan_lines(raw_lines):
    out = []
    for raw in raw_lines or []:
        ref = raw.get("item_ref") or {}
        disp = await _item_display(ref)
        out.append({
            "item_ref": ref, "name": raw.get("name") or disp.get("name"),
            "code": raw.get("code") or disp.get("code") or "",
            "uom": raw.get("uom") or disp.get("uom") or "pcs",
            "qty": float(raw.get("qty") or 0), "returned_qty": 0.0,
        })
    return out


@router.get("/challans")
async def list_challans(request: Request, type: Optional[str] = None, status: Optional[str] = None):
    await get_current_user(request)
    query = {}
    if type:
        query["type"] = type
    if status:
        query["status"] = status
    return await db.challans.find(query, {"_id": 0}).sort("created_at", -1).to_list(2000)


@router.get("/challans/{challan_id}")
async def get_challan(challan_id: str, request: Request):
    await get_current_user(request)
    c = await db.challans.find_one({"challan_id": challan_id}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Challan not found")
    return c


@router.post("/challans")
async def create_challan(request: Request):
    user = await get_current_user(request)
    require_teams(user, "admin", "store")
    body = await request.json()
    ctype = body.get("type")
    if ctype not in _CHALLAN_TYPES:
        raise HTTPException(status_code=400, detail="invalid challan type")
    if not body.get("lines"):
        raise HTTPException(status_code=400, detail="At least one line is required")
    cid = _new_id("chal")
    cno = await next_number("challan", "DC")
    doc = {
        "challan_id": cid, "challan_no": cno, "type": ctype,
        "direction": body.get("direction", "outbound"),
        "party_type": body.get("party_type", "vendor"),
        "vendor_id": body.get("vendor_id"), "party_name": body.get("party_name", ""),
        "ref_type": body.get("ref_type"), "ref_id": body.get("ref_id"),
        "challan_date": body.get("challan_date") or _now()[:10],
        "expected_return_date": body.get("expected_return_date"),
        "notes": body.get("notes", ""),
        "lines": await _build_challan_lines(body.get("lines", [])),
        "status": "open",
        "timeline": [_timeline_entry("created", user["email"])],
        "created_by": user["email"], "created_at": _now(), "updated_at": _now(),
    }
    await db.challans.insert_one(doc)
    return await db.challans.find_one({"challan_id": cid}, {"_id": 0})
```

In `backend/database.py`, in the Procurement index block, add:

```python
    await db.challans.create_index([("type", 1), ("status", 1), ("created_at", -1)], background=True)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest backend/tests/test_procurement_v2.py::test_challan_create_and_list -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/routes/procurement_routes.py backend/database.py
git commit -m "feat(procurement): returnable challan create/list/get + index"
```

### Task 8.2: Record returns + auto-close

**Files:**
- Modify: `backend/routes/procurement_routes.py`
- Test: `backend/tests/test_procurement_v2.py`

- [ ] **Step 1: Write the failing test**

```python
def test_challan_record_return_closes(ctx):
    tc, _ = ctx
    ch = tc.post("/api/challans", json={
        "type": "returnable_out", "direction": "outbound", "party_name": "X",
        "lines": [{"item_ref": {"source": "die", "id": "die_1"}, "qty": 10}],
    }).json()
    cid = ch["challan_id"]
    # partial return -> partially_returned
    r1 = tc.post(f"/api/challans/{cid}/record-return", json={"lines": [{"index": 0, "returned_qty": 4}]}).json()
    assert r1["status"] == "partially_returned" and r1["lines"][0]["returned_qty"] == 4
    # full return -> closed
    r2 = tc.post(f"/api/challans/{cid}/record-return", json={"lines": [{"index": 0, "returned_qty": 6}]}).json()
    assert r2["status"] == "closed" and r2["lines"][0]["returned_qty"] == 10
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest backend/tests/test_procurement_v2.py::test_challan_record_return_closes -q`
Expected: FAIL (404)

- [ ] **Step 3: Add the record-return endpoint**

```python
@router.post("/challans/{challan_id}/record-return")
async def record_challan_return(challan_id: str, request: Request):
    """Add returned quantities per line; set status open/partially_returned/closed."""
    user = await get_current_user(request)
    require_teams(user, "admin", "store")
    c = await db.challans.find_one({"challan_id": challan_id}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Challan not found")
    if c.get("status") == "closed":
        raise HTTPException(status_code=400, detail="Challan already closed")
    body = await request.json()
    add = {int(l["index"]): float(l.get("returned_qty", 0) or 0) for l in body.get("lines", [])}
    lines = c.get("lines", [])
    for idx, qty in add.items():
        if 0 <= idx < len(lines):
            prev = float(lines[idx].get("returned_qty", 0) or 0)
            cap = float(lines[idx].get("qty", 0) or 0)
            lines[idx]["returned_qty"] = round2(min(cap, prev + qty))
    fully = all(float(l.get("returned_qty", 0) or 0) >= float(l.get("qty", 0) or 0) for l in lines)
    any_ret = any(float(l.get("returned_qty", 0) or 0) > 0 for l in lines)
    status = "closed" if fully else ("partially_returned" if any_ret else "open")
    await db.challans.update_one(
        {"challan_id": challan_id},
        {"$set": {"lines": lines, "status": status, "updated_at": _now()},
         "$push": {"timeline": _timeline_entry("return_recorded", user["email"])}})
    return await db.challans.find_one({"challan_id": challan_id}, {"_id": 0})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest backend/tests/test_procurement_v2.py::test_challan_record_return_closes -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/routes/procurement_routes.py
git commit -m "feat(procurement): record returnable-challan returns with auto-close"
```

### Task 8.3: Challan PDF + create-from-vendor-return helper

**Files:**
- Modify: `backend/routes/procurement_pdf.py` (add `generate_challan_pdf`)
- Modify: `backend/routes/procurement_routes.py` (PDF endpoint + create-from-return)
- Test: `backend/tests/test_procurement_v2.py`

- [ ] **Step 1: Write the failing test**

```python
def test_challan_pdf_and_from_vendor_return(ctx):
    tc, db = ctx
    # seed a vendor_return to convert into a delivery challan
    async def seed():
        await db.vendors.insert_one({"vendor_id": "ven_z", "name": "RetVend", "is_active": True})
        await db.vendor_returns.insert_one({"return_id": "ret_1", "return_no": "RET-0001",
            "vendor_id": "ven_z", "vendor_name": "RetVend", "grn_no": "GRN-1",
            "lines": [{"item_ref": {"source": "die", "id": "die_1"}, "name": "Heart Die", "qty": 3, "rate": 100, "reason": "damaged"}],
            "grand_total": 300, "created_at": "2026-06-06T00:00:00+00:00"})
    asyncio.run(seed())
    ch = tc.post("/api/vendor-returns/ret_1/challan").json()
    assert ch["type"] == "vendor_return_delivery" and ch["lines"][0]["qty"] == 3
    pdf = tc.get(f"/api/challans/{ch['challan_id']}/pdf")
    assert pdf.status_code == 200 and pdf.content[:5] == b"%PDF-"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest backend/tests/test_procurement_v2.py::test_challan_pdf_and_from_vendor_return -q`
Expected: FAIL (404)

- [ ] **Step 3: Add `generate_challan_pdf` (in procurement_pdf.py)**

```python
def generate_challan_pdf(challan: dict, company: dict) -> bytes:
    """Price-free returnable/delivery challan: code, item, qty, uom, returned."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_RIGHT

    NAVY = colors.Color(0.102, 0.102, 0.180)
    GRAY = colors.Color(0.42, 0.42, 0.50)
    BORDER = colors.Color(0.80, 0.80, 0.86)
    WHITE = colors.white
    FONT, FONTB = _register_fonts()
    S = getSampleStyleSheet()

    def ps(name, **kw):
        if name not in S:
            S.add(ParagraphStyle(name=name, **kw))
    ps('Co', fontSize=14, leading=17, fontName=FONTB, textColor=NAVY)
    ps('Sub', fontSize=7.5, leading=10, fontName=FONT, textColor=GRAY)
    ps('Title', fontSize=18, leading=21, fontName=FONTB, textColor=NAVY, alignment=TA_RIGHT)
    ps('Meta', fontSize=8.5, leading=11, fontName=FONT, textColor=NAVY, alignment=TA_RIGHT)
    ps('Hc', fontSize=8, leading=10, fontName=FONTB, textColor=WHITE)
    ps('Cl', fontSize=8.5, leading=11, fontName=FONT, textColor=NAVY)

    titles = {"returnable_out": "RETURNABLE CHALLAN (OUT)",
              "returnable_in": "RETURNABLE CHALLAN (IN)",
              "vendor_return_delivery": "DELIVERY CHALLAN — RETURN"}
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=14 * mm, rightMargin=14 * mm,
                            topMargin=12 * mm, bottomMargin=12 * mm)
    el = [
        Table([[
            [Paragraph(company.get("name", "SmartShape") or "SmartShape", S['Co']),
             Paragraph(company.get("address", "") or "", S['Sub'])],
            [Paragraph(titles.get(challan.get("type"), "CHALLAN"), S['Title']),
             Paragraph(challan.get("challan_no", ""), S['Meta']),
             Paragraph("Party: " + (challan.get("party_name", "") or ""), S['Meta']),
             Paragraph("Date: " + (challan.get("challan_date", "") or ""), S['Meta'])],
        ]], colWidths=[100 * mm, 82 * mm]),
        Spacer(1, 8),
    ]
    rows = [[Paragraph(h, S['Hc']) for h in ["#", "Code", "Item", "Qty", "UOM", "Returned"]]]
    for i, l in enumerate(challan.get("lines", []), 1):
        rows.append([
            Paragraph(str(i), S['Cl']), Paragraph(str(l.get("code", "") or "-"), S['Cl']),
            Paragraph(str(l.get("name", "")), S['Cl']), Paragraph(f"{l.get('qty', 0):g}", S['Cl']),
            Paragraph(str(l.get("uom", "")), S['Cl']), Paragraph(f"{l.get('returned_qty', 0):g}", S['Cl']),
        ])
    tbl = Table(rows, colWidths=[10 * mm, 30 * mm, 80 * mm, 20 * mm, 20 * mm, 22 * mm], repeatRows=1)
    tbl.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), NAVY),
        ('GRID', (0, 0), (-1, -1), 0.4, BORDER),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [WHITE, colors.Color(0.975, 0.975, 0.99)]),
        ('TOPPADDING', (0, 0), (-1, -1), 4), ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]))
    el.append(tbl)
    el.append(Spacer(1, 14))
    if challan.get("notes"):
        el.append(Paragraph("Notes: " + challan["notes"], S['Cl']))
    el.append(Spacer(1, 10))
    el.append(Paragraph("Sender: ______________   Receiver: ______________", S['Cl']))
    doc.build(el)
    return buf.getvalue()
```

- [ ] **Step 4: Add the PDF endpoint + create-from-vendor-return (procurement_routes.py)**

```python
@router.get("/challans/{challan_id}/pdf")
async def challan_pdf(challan_id: str, request: Request):
    await get_current_user(request)
    c = await db.challans.find_one({"challan_id": challan_id}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Challan not found")
    company = await db.settings.find_one({"type": "company"}, {"_id": 0}) or {}
    from routes.procurement_pdf import generate_challan_pdf
    from fastapi.responses import StreamingResponse
    import io as _io
    pdf = generate_challan_pdf(c, company)
    return StreamingResponse(_io.BytesIO(pdf), media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{c.get("challan_no", "challan")}.pdf"'})


@router.post("/vendor-returns/{return_id}/challan")
async def challan_from_vendor_return(return_id: str, request: Request):
    """Create a delivery challan for the rejected goods of a vendor return."""
    user = await get_current_user(request)
    require_teams(user, "admin", "store")
    ret = await db.vendor_returns.find_one({"return_id": return_id}, {"_id": 0})
    if not ret:
        raise HTTPException(status_code=404, detail="Return not found")
    raw_lines = [{"item_ref": l.get("item_ref"), "name": l.get("name"), "qty": l.get("qty", 0)}
                 for l in ret.get("lines", [])]
    cid = _new_id("chal")
    cno = await next_number("challan", "DC")
    doc = {
        "challan_id": cid, "challan_no": cno, "type": "vendor_return_delivery",
        "direction": "outbound", "party_type": "vendor",
        "vendor_id": ret.get("vendor_id"), "party_name": ret.get("vendor_name", ""),
        "ref_type": "vendor_return", "ref_id": return_id,
        "challan_date": _now()[:10], "expected_return_date": None,
        "notes": f"Return goods for {ret.get('return_no')} (GRN {ret.get('grn_no')})",
        "lines": await _build_challan_lines(raw_lines),
        "status": "open", "timeline": [_timeline_entry("created", user["email"])],
        "created_by": user["email"], "created_at": _now(), "updated_at": _now(),
    }
    await db.challans.insert_one(doc)
    return await db.challans.find_one({"challan_id": cid}, {"_id": 0})
```

- [ ] **Step 5: Run test to verify it passes**

Run: `python -m pytest backend/tests/test_procurement_v2.py::test_challan_pdf_and_from_vendor_return -q`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/routes/procurement_pdf.py backend/routes/procurement_routes.py
git commit -m "feat(procurement): challan PDF + create delivery challan from vendor return"
```

### Task 8.4: Frontend — Challans tab

**Files:**
- Modify: `frontend/src/lib/api.js` (add `procurement.challans`)
- Create: `frontend/src/components/procurement/ChallansTab.js`
- Modify: `frontend/src/pages/admin/Procurement.js` (add the tab)

- [ ] **Step 1: Add the API group (inside `procurement`, before the closing `}`)**

```javascript
  challans: {
    getAll: (params = {}) => API.get('/challans', { params }),
    get: (id) => API.get(`/challans/${id}`),
    create: (data) => API.post('/challans', data),
    recordReturn: (id, lines) => API.post(`/challans/${id}/record-return`, { lines }),
    fromVendorReturn: (returnId) => API.post(`/vendor-returns/${returnId}/challan`),
    downloadPdf: (id, no) => downloadFile(`/challans/${id}/pdf`, `${no || 'challan'}.pdf`),
  },
```

- [ ] **Step 2: Create ChallansTab.js**

```javascript
import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Plus, Download, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { procurement } from '../../lib/api';
import ItemPicker from './ItemPicker';

const card = 'bg-[var(--bg-card)] border-[var(--border-color)]';
const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
const textPri = 'text-[var(--text-primary)]';
const textSec = 'text-[var(--text-secondary)]';
const textMuted = 'text-[var(--text-muted)]';
const dlgCls = 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)]';

const TYPE_LABELS = { returnable_out: 'Returnable (Out)', returnable_in: 'Returnable (In)', vendor_return_delivery: 'Return Delivery' };
const STATUS_MAP = { open: 'bg-blue-500/15 text-blue-300', partially_returned: 'bg-amber-500/15 text-amber-300', closed: 'bg-emerald-500/15 text-emerald-400' };

export default function ChallansTab() {
  const [list, setList] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState({ type: 'returnable_out', direction: 'outbound', party_type: 'vendor', vendor_id: '', party_name: '', challan_date: '', notes: '', lines: [] });

  const load = useCallback(() => { procurement.challans.getAll().then(r => setList(r.data || [])).catch(() => {}); }, []);
  useEffect(() => { load(); procurement.vendors.getAll().then(r => setVendors(r.data || [])).catch(() => {}); }, [load]);

  const openNew = () => { setForm({ type: 'returnable_out', direction: 'outbound', party_type: 'vendor', vendor_id: '', party_name: '', challan_date: '', notes: '', lines: [] }); setFormOpen(true); };
  const save = async () => {
    if (form.lines.length === 0) { toast.error('Add at least one item'); return; }
    try {
      await procurement.challans.create({
        ...form,
        party_name: form.party_name || vendors.find(v => v.vendor_id === form.vendor_id)?.name || '',
        lines: form.lines.map(l => ({ item_ref: l.item_ref, name: l.name, code: l.code, uom: l.uom, qty: Number(l.qty) || 1 })),
      });
      toast.success('Challan created'); setFormOpen(false); load();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Save failed'); }
  };
  const recordReturn = async (ch, idx, qty) => {
    try {
      const r = await procurement.challans.recordReturn(ch.challan_id, [{ index: idx, returned_qty: Number(qty) || 0 }]);
      setDetail(r.data); load();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Failed'); }
  };

  return (
    <div className={`${card} border rounded-md p-5`}>
      <div className="flex items-center justify-between mb-4">
        <h2 className={`text-lg font-medium ${textPri}`}>Challans ({list.length})</h2>
        <Button onClick={openNew} size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white"><Plus className="mr-1 h-3 w-3" />New Challan</Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="bg-[var(--bg-primary)]">{['Challan', 'Type', 'Party', 'Date', 'Items', 'Status', ''].map(h => <th key={h} className={`text-left text-xs uppercase py-2.5 px-3 ${textMuted}`}>{h}</th>)}</tr></thead>
          <tbody>
            {list.map(ch => (
              <tr key={ch.challan_id} className="border-t border-[var(--border-color)] hover:bg-[var(--bg-hover)] cursor-pointer" onClick={() => setDetail(ch)}>
                <td className={`py-2.5 px-3 ${textPri} font-medium`}>{ch.challan_no}</td>
                <td className={`py-2.5 px-3 ${textSec}`}>{TYPE_LABELS[ch.type] || ch.type}</td>
                <td className={`py-2.5 px-3 ${textSec}`}>{ch.party_name}</td>
                <td className={`py-2.5 px-3 ${textMuted}`}>{ch.challan_date}</td>
                <td className={`py-2.5 px-3 ${textSec}`}>{ch.lines?.length || 0}</td>
                <td className="py-2.5 px-3"><span className={`text-[10px] px-2 py-0.5 rounded font-medium ${STATUS_MAP[ch.status] || ''}`}>{(ch.status || '').replace('_', ' ')}</span></td>
                <td className="py-2.5 px-3 text-right"><Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); procurement.challans.downloadPdf(ch.challan_id, ch.challan_no).catch(() => toast.error('Download failed')); }} className={`${textSec} h-7`}><Download className="h-3.5 w-3.5" /></Button></td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={7} className={`py-10 text-center ${textMuted}`}>No challans yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {/* New challan dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className={`${dlgCls} w-[calc(100vw-1rem)] sm:max-w-lg max-h-[88dvh] overflow-y-auto`}>
          <DialogHeader><DialogTitle className={textPri}>New Challan</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className={`${textSec} text-xs`}>Type</Label>
                <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value, direction: e.target.value === 'returnable_in' ? 'inbound' : 'outbound' })} className={`mt-1 h-9 px-3 rounded text-sm ${inputCls} block w-full`}>
                  <option value="returnable_out">Returnable (Out)</option>
                  <option value="returnable_in">Returnable (In)</option>
                  <option value="vendor_return_delivery">Return Delivery</option>
                </select>
              </div>
              <div>
                <Label className={`${textSec} text-xs`}>Vendor</Label>
                <select value={form.vendor_id} onChange={e => setForm({ ...form, vendor_id: e.target.value })} className={`mt-1 h-9 px-3 rounded text-sm ${inputCls} block w-full`}>
                  <option value="">Select…</option>
                  {vendors.map(v => <option key={v.vendor_id} value={v.vendor_id}>{v.name}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className={`${textSec} text-xs`}>Party name (if not vendor)</Label><Input value={form.party_name} onChange={e => setForm({ ...form, party_name: e.target.value })} className={inputCls} /></div>
              <div><Label className={`${textSec} text-xs`}>Challan date</Label><Input type="date" value={form.challan_date} onChange={e => setForm({ ...form, challan_date: e.target.value })} className={inputCls} /></div>
            </div>
            <div><Label className={`${textSec} text-xs`}>Notes</Label><Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className={inputCls} /></div>
            <div className="flex items-center justify-between">
              <Label className={`${textSec} text-xs`}>Items</Label>
              <Button size="sm" variant="outline" onClick={() => setPickerOpen(true)} className="border-[var(--border-color)] text-[var(--text-secondary)] h-7"><Plus className="h-3 w-3 mr-1" />Add Items</Button>
            </div>
            {form.lines.length === 0 ? <p className={`text-xs ${textMuted} text-center py-4`}>No items yet.</p> : (
              <div className="space-y-1.5">
                {form.lines.map((l, i) => (
                  <div key={i} className={`flex items-center gap-2 ${card} border rounded-md p-2`}>
                    <div className="flex-1 min-w-0"><p className={`${textPri} text-sm truncate`}>{l.name}{l.code ? <span className="ml-2 text-[11px] font-mono text-[#e94560]">{l.code}</span> : null}</p></div>
                    <Input type="number" min="1" value={l.qty} onChange={e => setForm({ ...form, lines: form.lines.map((x, j) => j === i ? { ...x, qty: e.target.value } : x) })} className={`${inputCls} h-8 w-20 text-sm`} />
                    <Button size="sm" variant="ghost" onClick={() => setForm({ ...form, lines: form.lines.filter((_, j) => j !== i) })} className="text-red-400 h-8">✕</Button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} className="border-[var(--border-color)] text-[var(--text-secondary)]">Cancel</Button>
            <Button onClick={save} className="bg-[#e94560] hover:bg-[#f05c75] text-white">Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail / record-return dialog */}
      <Dialog open={!!detail} onOpenChange={(o) => { if (!o) setDetail(null); }}>
        <DialogContent className={`${dlgCls} w-[calc(100vw-1rem)] sm:max-w-2xl max-h-[90dvh] overflow-y-auto`}>
          {detail && (
            <>
              <DialogHeader><DialogTitle className={textPri}>{detail.challan_no} · {TYPE_LABELS[detail.type]}</DialogTitle></DialogHeader>
              <table className="w-full text-sm">
                <thead><tr className="bg-[var(--bg-primary)]">{['Item', 'Code', 'Qty', 'Returned', ''].map(h => <th key={h} className={`text-left text-[11px] uppercase py-2 px-2 ${textMuted}`}>{h}</th>)}</tr></thead>
                <tbody>
                  {detail.lines.map((l, i) => {
                    const bal = (l.qty || 0) - (l.returned_qty || 0);
                    return (
                      <tr key={i} className="border-t border-[var(--border-color)]">
                        <td className={`py-2 px-2 ${textPri}`}>{l.name}</td>
                        <td className={`py-2 px-2 ${textMuted} font-mono text-xs`}>{l.code || '—'}</td>
                        <td className={`py-2 px-2 ${textSec}`}>{l.qty}</td>
                        <td className={`py-2 px-2 ${textSec}`}>{l.returned_qty}</td>
                        <td className="py-2 px-2">
                          {detail.status !== 'closed' && bal > 0 && (
                            <Button size="sm" variant="outline" onClick={() => recordReturn(detail, i, bal)} className="border-[var(--border-color)] text-[var(--text-secondary)] h-7"><RotateCcw className="h-3 w-3 mr-1" />Return {bal}</Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <DialogFooter>
                <Button variant="outline" onClick={() => procurement.challans.downloadPdf(detail.challan_id, detail.challan_no).catch(() => toast.error('Download failed'))} className="border-[var(--border-color)] text-[var(--text-secondary)]"><Download className="h-3.5 w-3.5 mr-1" />PDF</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <ItemPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onConfirm={(picked) => setForm(f => ({ ...f, lines: [...f.lines, ...picked] }))} />
    </div>
  );
}
```

- [ ] **Step 3: Add the Challans tab to Procurement.js**

Import at top:

```javascript
import ChallansTab from '../../components/procurement/ChallansTab';
```

Add `FileBox` to the lucide import (or reuse `RotateCcw`). In the tab bar array add `['challans', 'Challans', RotateCcw]`, and in the render add:

```javascript
        {tab === 'challans' && <ChallansTab />}
```

- [ ] **Step 4: Add a "Return Challan" button on vendor returns (ReceivingQC.js ReturnsTab)**

In `ReturnsTab`'s action cell, add next to the PDF download:

```javascript
                  <Button size="sm" variant="ghost" onClick={() => procurement.challans.fromVendorReturn(r.return_id).then(res => { toast.success(`Challan ${res.data?.challan_no} created`); procurement.challans.downloadPdf(res.data.challan_id, res.data.challan_no); }).catch(() => toast.error('Failed'))} className={`${textSec} h-7`} title="Create delivery challan"><RotateCcw className="h-3.5 w-3.5" /></Button>
```

(Add `RotateCcw` to the ReceivingQC.js lucide import — it is already imported.)

- [ ] **Step 5: Verify build**

Run: `cd frontend && CI=false npx craco build 2>&1 | grep -E "Compiled|Failed"`
Expected: `Compiled`

- [ ] **Step 6: Manual check**

Procurement → Challans → New Challan (returnable out, pick vendor + items) → Save → open it → **Return N** records a partial/full return (status flips partially_returned → closed) → **PDF** downloads (qty + returned, no price). From Returns tab, the return-challan button creates a delivery challan from a vendor return.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/api.js frontend/src/components/procurement/ChallansTab.js frontend/src/components/procurement/ReceivingQC.js frontend/src/pages/admin/Procurement.js
git commit -m "feat(procurement): returnable challans tab + return-delivery from vendor return"
```

---

## Final verification

### Task F.1: Full backend suite + frontend build

- [ ] **Step 1: Run all procurement backend tests**

Run: `cd backend && python -m pytest tests/test_procurement_gst.py tests/test_procurement_masters.py tests/test_procurement_flow.py tests/test_procurement_qc.py tests/test_procurement_v2.py -q -p no:cacheprovider`
Expected: all PASS (existing 32 + new v2 tests)

- [ ] **Step 2: Production build**

Run: `cd frontend && CI=false npx craco build 2>&1 | grep -E "Compiled|Failed"`
Expected: `Compiled`

- [ ] **Step 3: Final commit (if any pending)**

```bash
git add -A
git commit -m "chore(procurement): v2 complete"
```

- [ ] **Step 4: Deploy** — push to `main`; the VPS `ss-autodeploy.timer` rebuilds within ~2 min. Confirm:

```bash
git push origin main
```

Then watch: `ssh root@srv1667373.hstgr.cloud "tail -f /var/log/ss-autodeploy.log"` until `deploy OK`.

---

## Notes / deferred (YAGNI)

- Editing vendor on a draft PO (would change tax mode) — not supported; cancel + recreate instead.
- Challan stock effects (sending returnable goods out does NOT decrement `stock_qty` here) — treated as a tracking document only, matching how dispatches/returns are modeled. Add stock movements later if needed.
- Demand uses `dies` only (sales orders reference `die_id`); raw `purchase_items` have no sales demand by definition.
