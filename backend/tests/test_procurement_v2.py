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


def test_purchase_item_accepts_code(ctx):
    tc, _ = ctx
    pi = tc.post("/api/purchase-items", json={"name": "Box", "code": "PKG-01"}).json()
    assert pi["code"] == "PKG-01"


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


def test_grn_received_date(ctx):
    tc, _ = ctx
    po = _po_with_line(tc)
    tc.post(f"/api/purchase-orders/{po['po_id']}/approve")
    grn = tc.post(f"/api/purchase-orders/{po['po_id']}/receive").json()
    assert "received_date" in grn and grn["received_date"]  # defaulted
    upd = tc.put(f"/api/goods-receipts/{grn['grn_id']}", json={"received_date": "2026-06-01", "lines": []}).json()
    assert upd["received_date"] == "2026-06-01"


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


def test_demand_from_sales_orders(ctx):
    tc, db = ctx
    async def seed_orders():
        await db.orders.insert_one({"order_id": "ord_1", "order_number": "ORD-1", "order_status": "confirmed"})
        await db.orders.insert_one({"order_id": "ord_2", "order_number": "ORD-2", "order_status": "delivered"})
        await db.order_items.insert_one({"order_item_id": "oi_1", "order_id": "ord_1", "die_id": "die_1", "quantity": 15, "status": "confirmed"})
        await db.order_items.insert_one({"order_item_id": "oi_2", "order_id": "ord_2", "die_id": "die_1", "quantity": 99, "status": "delivered"})
    asyncio.run(seed_orders())
    rows = tc.get("/api/procurement/demand").json()
    row = next(r for r in rows if r["die_id"] == "die_1")
    assert row["required_qty"] == 15
    assert row["physical_qty"] == 12 and row["available_qty"] == 8
    assert row["shortfall_qty"] == 7
    assert row["code"] == "HD-1"


def test_packing_list_pdf(ctx):
    tc, _ = ctx
    po = _po_with_line(tc)
    r = tc.get(f"/api/purchase-orders/{po['po_id']}/packing-list-pdf")
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.content[:5] == b"%PDF-"


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


def test_challan_record_return_closes(ctx):
    tc, _ = ctx
    ch = tc.post("/api/challans", json={
        "type": "returnable_out", "direction": "outbound", "party_name": "X",
        "lines": [{"item_ref": {"source": "die", "id": "die_1"}, "qty": 10}],
    }).json()
    cid = ch["challan_id"]
    r1 = tc.post(f"/api/challans/{cid}/record-return", json={"lines": [{"index": 0, "returned_qty": 4}]}).json()
    assert r1["status"] == "partially_returned" and r1["lines"][0]["returned_qty"] == 4
    r2 = tc.post(f"/api/challans/{cid}/record-return", json={"lines": [{"index": 0, "returned_qty": 6}]}).json()
    assert r2["status"] == "closed" and r2["lines"][0]["returned_qty"] == 10


def test_challan_pdf_and_from_vendor_return(ctx):
    tc, db = ctx
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
