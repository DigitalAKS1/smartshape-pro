"""
Phase 4 + 5 tests: Goods Receipt (verification), QC checklist with
OK/Hold/Return, stock-in on OK, vendor return creation + PDF.

In-memory async Mongo via mongomock_motor; prod is never touched.
"""
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
                                       "is_active": True, "stock_qty": 0, "gst_pct": 18})
        await mock_db.purchase_items.insert_one({"purchase_item_id": "pitem_1", "name": "Box",
                                                 "is_active": True, "stock_qty": 0, "uom": "box", "gst_pct": 12})
        await mock_db.settings.insert_one({"type": "company", "name": "SmartShape", "state_code": "22"})
    asyncio.run(seed())
    return tc, mock_db


def _approved_po(tc):
    v = tc.post("/api/vendors", json={"name": "Acme", "state_code": "22"}).json()
    po = tc.post("/api/purchase-orders", json={"vendor_id": v["vendor_id"], "lines": [
        {"item_ref": {"source": "die", "id": "die_1"}, "qty": 5, "rate": 100, "gst_pct": 18},
        {"item_ref": {"source": "purchase_item", "id": "pitem_1"}, "qty": 8, "rate": 10, "gst_pct": 12},
    ]}).json()
    tc.post(f"/api/purchase-orders/{po['po_id']}/approve")
    return po


def test_receive_requires_approved_po(ctx):
    tc, _ = ctx
    v = tc.post("/api/vendors", json={"name": "X"}).json()
    po = tc.post("/api/purchase-orders", json={"vendor_id": v["vendor_id"],
                 "lines": [{"item_ref": {"source": "die", "id": "die_1"}, "qty": 1, "rate": 1}]}).json()
    # still draft -> cannot receive
    assert tc.post(f"/api/purchase-orders/{po['po_id']}/receive").status_code == 400


def test_grn_prefilled_from_po(ctx):
    tc, _ = ctx
    po = _approved_po(tc)
    grn = tc.post(f"/api/purchase-orders/{po['po_id']}/receive").json()
    assert grn["grn_no"].startswith("GRN-")
    assert grn["status"] == "pending_qc"
    assert len(grn["lines"]) == 2
    assert grn["lines"][0]["ordered_qty"] == 5
    assert grn["lines"][0]["received_qty"] == 5  # defaults to ordered


def test_qc_ok_stocks_in_return_held(ctx):
    tc, db = ctx
    po = _approved_po(tc)
    grn = tc.post(f"/api/purchase-orders/{po['po_id']}/receive").json()
    gid = grn["grn_id"]

    # line 0 (die, qty5) OK -> stock in; line 1 (box, qty8) Return -> held
    r = tc.post(f"/api/goods-receipts/{gid}/qc", json={"lines": [
        {"po_line_index": 0, "qc_status": "ok", "received_qty": 5, "remark": "good"},
        {"po_line_index": 1, "qc_status": "return", "received_qty": 8, "remark": "damaged"},
    ]})
    assert r.status_code == 200, r.text
    g = r.json()
    assert g["status"] == "qc_done"
    assert g["lines"][0]["qc_status"] == "ok" and g["lines"][1]["qc_status"] == "return"

    # die stocked in (+5), purchase item NOT (held)
    die = asyncio.run(db.dies.find_one({"die_id": "die_1"}, {"_id": 0}))
    box = asyncio.run(db.purchase_items.find_one({"purchase_item_id": "pitem_1"}, {"_id": 0}))
    assert die["stock_qty"] == 5
    assert box["stock_qty"] == 0

    # exactly one stock movement, of type purchase_in for the die
    movements = asyncio.run(db.stock_movements.find({}, {"_id": 0}).to_list(10))
    assert len(movements) == 1
    assert movements[0]["movement_type"] == "purchase_in" and movements[0]["die_id"] == "die_1"

    # line 1 was returned (not accepted) -> PO is only partially received
    po2 = tc.get(f"/api/purchase-orders/{po['po_id']}").json()
    assert po2["status"] == "partially_received"
    assert po2["lines"][0]["received_qty"] == 5 and po2["lines"][1]["received_qty"] == 0

    # QC cannot be submitted twice
    assert tc.post(f"/api/goods-receipts/{gid}/qc", json={"lines": []}).status_code == 400


def test_create_return_and_pdf(ctx):
    tc, _ = ctx
    po = _approved_po(tc)
    grn = tc.post(f"/api/purchase-orders/{po['po_id']}/receive").json()
    gid = grn["grn_id"]
    tc.post(f"/api/goods-receipts/{gid}/qc", json={"lines": [
        {"po_line_index": 0, "qc_status": "ok", "received_qty": 5},
        {"po_line_index": 1, "qc_status": "return", "received_qty": 8, "remark": "wrong size"},
    ]})
    ret = tc.post(f"/api/goods-receipts/{gid}/create-return").json()
    assert ret["return_no"].startswith("RET-")
    assert len(ret["lines"]) == 1
    assert ret["grand_total"] == 80.0  # 8 * 10

    pdf = tc.get(f"/api/vendor-returns/{ret['return_id']}/pdf")
    assert pdf.status_code == 200 and pdf.content[:5] == b"%PDF-"


def test_create_return_requires_flagged_lines(ctx):
    tc, _ = ctx
    po = _approved_po(tc)
    grn = tc.post(f"/api/purchase-orders/{po['po_id']}/receive").json()
    gid = grn["grn_id"]
    tc.post(f"/api/goods-receipts/{gid}/qc", json={"lines": [
        {"po_line_index": 0, "qc_status": "ok", "received_qty": 5},
        {"po_line_index": 1, "qc_status": "ok", "received_qty": 8},
    ]})
    assert tc.post(f"/api/goods-receipts/{gid}/create-return").status_code == 400


def test_invalid_qc_status_rejected(ctx):
    tc, _ = ctx
    po = _approved_po(tc)
    grn = tc.post(f"/api/purchase-orders/{po['po_id']}/receive").json()
    gid = grn["grn_id"]
    assert tc.post(f"/api/goods-receipts/{gid}/qc", json={"lines": [
        {"po_line_index": 0, "qc_status": "maybe"}]}).status_code == 400


def test_only_one_open_grn_per_po(ctx):
    tc, _ = ctx
    po = _approved_po(tc)
    assert tc.post(f"/api/purchase-orders/{po['po_id']}/receive").status_code == 200
    # second receive while the first is still pending QC is rejected
    assert tc.post(f"/api/purchase-orders/{po['po_id']}/receive").status_code == 400


def test_qc_double_submit_does_not_double_stock(ctx):
    tc, db = ctx
    po = _approved_po(tc)
    gid = tc.post(f"/api/purchase-orders/{po['po_id']}/receive").json()["grn_id"]
    payload = {"lines": [{"po_line_index": 0, "qc_status": "ok", "received_qty": 5},
                         {"po_line_index": 1, "qc_status": "ok", "received_qty": 8}]}
    assert tc.post(f"/api/goods-receipts/{gid}/qc", json=payload).status_code == 200
    assert tc.post(f"/api/goods-receipts/{gid}/qc", json=payload).status_code == 400
    die = asyncio.run(db.dies.find_one({"die_id": "die_1"}, {"_id": 0}))
    assert die["stock_qty"] == 5  # not 10


def test_return_note_created_once(ctx):
    tc, _ = ctx
    po = _approved_po(tc)
    gid = tc.post(f"/api/purchase-orders/{po['po_id']}/receive").json()["grn_id"]
    tc.post(f"/api/goods-receipts/{gid}/qc", json={"lines": [
        {"po_line_index": 0, "qc_status": "ok", "received_qty": 5},
        {"po_line_index": 1, "qc_status": "return", "received_qty": 8}]})
    assert tc.post(f"/api/goods-receipts/{gid}/create-return").status_code == 200
    assert tc.post(f"/api/goods-receipts/{gid}/create-return").status_code == 400


def test_purchase_item_stock_qty_not_editable(ctx):
    tc, db = ctx
    pi = tc.post("/api/purchase-items", json={"name": "Glue", "stock_qty": 3}).json()
    tc.put(f"/api/purchase-items/{pi['purchase_item_id']}", json={"stock_qty": 999, "name": "Glue2"})
    got = asyncio.run(db.purchase_items.find_one({"purchase_item_id": pi["purchase_item_id"]}, {"_id": 0}))
    assert got["stock_qty"] == 3 and got["name"] == "Glue2"


def test_full_receipt_marks_po_received(ctx):
    tc, _ = ctx
    po = _approved_po(tc)
    gid = tc.post(f"/api/purchase-orders/{po['po_id']}/receive").json()["grn_id"]
    tc.post(f"/api/goods-receipts/{gid}/qc", json={"lines": [
        {"po_line_index": 0, "qc_status": "ok", "received_qty": 5},
        {"po_line_index": 1, "qc_status": "ok", "received_qty": 8}]})
    assert tc.get(f"/api/purchase-orders/{po['po_id']}").json()["status"] == "received"


def test_partial_receipt_then_remainder(ctx):
    tc, db = ctx
    po = _approved_po(tc)  # die qty5, box qty8
    # GRN1: accept 3 of die, return all 8 boxes
    gid1 = tc.post(f"/api/purchase-orders/{po['po_id']}/receive").json()["grn_id"]
    tc.post(f"/api/goods-receipts/{gid1}/qc", json={"lines": [
        {"po_line_index": 0, "qc_status": "ok", "received_qty": 3},
        {"po_line_index": 1, "qc_status": "return", "received_qty": 8}]})
    p1 = tc.get(f"/api/purchase-orders/{po['po_id']}").json()
    assert p1["status"] == "partially_received"
    assert p1["lines"][0]["received_qty"] == 3

    # GRN2 prefills only the outstanding: 2 die + 8 box
    grn2 = tc.post(f"/api/purchase-orders/{po['po_id']}/receive").json()
    out = {l["po_line_index"]: l["outstanding_qty"] for l in grn2["lines"]}
    assert out == {0: 2, 1: 8}
    # accept the remainder fully
    tc.post(f"/api/goods-receipts/{grn2['grn_id']}/qc", json={"lines": [
        {"po_line_index": 0, "qc_status": "ok", "received_qty": 2},
        {"po_line_index": 1, "qc_status": "ok", "received_qty": 8}]})
    p2 = tc.get(f"/api/purchase-orders/{po['po_id']}").json()
    assert p2["status"] == "received"
    assert p2["lines"][0]["received_qty"] == 5 and p2["lines"][1]["received_qty"] == 8
    # die stocked-in cumulatively 3 + 2 = 5
    die = asyncio.run(db.dies.find_one({"die_id": "die_1"}, {"_id": 0}))
    assert die["stock_qty"] == 5

    # fully received PO can't be received again
    assert tc.post(f"/api/purchase-orders/{po['po_id']}/receive").status_code == 400


def test_close_partial_po(ctx):
    tc, _ = ctx
    po = _approved_po(tc)
    gid = tc.post(f"/api/purchase-orders/{po['po_id']}/receive").json()["grn_id"]
    tc.post(f"/api/goods-receipts/{gid}/qc", json={"lines": [
        {"po_line_index": 0, "qc_status": "ok", "received_qty": 5},
        {"po_line_index": 1, "qc_status": "hold", "received_qty": 8}]})
    assert tc.get(f"/api/purchase-orders/{po['po_id']}").json()["status"] == "partially_received"
    closed = tc.post(f"/api/purchase-orders/{po['po_id']}/close")
    assert closed.status_code == 200 and closed.json()["status"] == "closed"


def test_dashboard_summary(ctx):
    tc, _ = ctx
    # build some state: an approved+received PO, an open requisition, a return
    po = _approved_po(tc)
    gid = tc.post(f"/api/purchase-orders/{po['po_id']}/receive").json()["grn_id"]
    tc.post(f"/api/goods-receipts/{gid}/qc", json={"lines": [
        {"po_line_index": 0, "qc_status": "ok", "received_qty": 5},
        {"po_line_index": 1, "qc_status": "return", "received_qty": 8}]})
    tc.post(f"/api/goods-receipts/{gid}/create-return")
    rid = tc.post("/api/requisitions", json={"lines": [
        {"item_ref": {"source": "die", "id": "die_1"}, "qty": 2}]}).json()["requisition_id"]
    tc.post(f"/api/requisitions/{rid}/submit")

    s = tc.get("/api/procurement/summary").json()
    # line 1 returned -> PO is partially received, still counts as committed spend
    assert s["purchase_orders"]["by_status"].get("partially_received") == 1
    assert s["purchase_orders"]["committed_value"] == po["grand_total"]
    assert s["requisitions"]["needs_approval"] == 1
    assert s["returns"]["count"] == 1 and s["returns"]["value"] == 80.0
    assert s["vendors_active"] >= 1
    assert any(v["vendor"] == "Acme" for v in s["top_vendors"])
    assert len(s["recent_pos"]) >= 1
