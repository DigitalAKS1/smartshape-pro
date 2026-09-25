"""
Phase 2 + 3 flow tests: Requisition lifecycle, Purchase Order GST math
(intra & inter-state), convert-to-PO, and PO PDF generation.

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
        return {"email": "admin@test.in", "role": "admin"}
    monkeypatch.setattr(pr, "get_current_user", fake_user)

    app = FastAPI()
    app.include_router(pr.router, prefix="/api")
    tc = TestClient(app)

    async def seed():
        await mock_db.dies.insert_one({"die_id": "die_1", "name": "Heart Die", "code": "HD-1",
                                       "is_active": True, "stock_qty": 0, "hsn": "8442", "gst_pct": 18})
        await mock_db.settings.insert_one({"type": "company", "name": "SmartShape",
                                           "state_code": "22", "gstin": "22XXXXX0000X1Z0"})
    asyncio.run(seed())
    return tc, mock_db


def _die_line(qty=10, rate=100, gst=18):
    return {"item_ref": {"source": "die", "id": "die_1"}, "qty": qty, "rate": rate, "gst_pct": gst}


def test_requisition_lifecycle_and_convert(ctx):
    tc, db = ctx
    # create draft
    r = tc.post("/api/requisitions", json={"notes": "need dies",
              "lines": [{"item_ref": {"source": "die", "id": "die_1"}, "qty": 10}]})
    assert r.status_code == 200, r.text
    req = r.json()
    assert req["req_no"].startswith("REQ-")
    assert req["status"] == "draft"
    assert req["lines"][0]["name"] == "Heart Die"   # resolved from die master

    rid = req["requisition_id"]
    # cannot convert before approval
    v = tc.post("/api/vendors", json={"name": "Acme", "state_code": "22"}).json()
    assert tc.post(f"/api/requisitions/{rid}/convert-to-po", json={"vendor_id": v["vendor_id"]}).status_code == 400

    # submit -> approve
    assert tc.post(f"/api/requisitions/{rid}/submit").json()["status"] == "submitted"
    appr = tc.post(f"/api/requisitions/{rid}/approve", json={"remark": "ok"}).json()
    assert appr["status"] == "approved" and appr["approval"]["by"] == "admin@test.in"

    # convert -> draft PO with priced lines
    po = tc.post(f"/api/requisitions/{rid}/convert-to-po", json={"vendor_id": v["vendor_id"]}).json()
    assert po["origin"] == "requisition" and po["requisition_id"] == rid
    assert po["status"] == "draft"
    assert po["lines"][0]["qty"] == 10

    # stage logs recorded for both docs
    logs = asyncio.run(db.procurement_stage_logs.find({}, {"_id": 0}).to_list(50))
    assert any(l["doc_type"] == "requisition" and l["to_status"] == "approved" for l in logs)
    assert any(l["doc_type"] == "po" for l in logs)


def test_requisition_converts_only_once(ctx):
    tc, _ = ctx
    rid = tc.post("/api/requisitions", json={"lines": [_die_line()]}).json()["requisition_id"]
    tc.post(f"/api/requisitions/{rid}/submit")
    tc.post(f"/api/requisitions/{rid}/approve")
    v = tc.post("/api/vendors", json={"name": "V", "state_code": "22"}).json()
    assert tc.post(f"/api/requisitions/{rid}/convert-to-po", json={"vendor_id": v["vendor_id"]}).status_code == 200
    # requisition is now 'converted' — a second conversion is rejected
    again = tc.post(f"/api/requisitions/{rid}/convert-to-po", json={"vendor_id": v["vendor_id"]})
    assert again.status_code == 400
    assert tc.get(f"/api/requisitions/{rid}").json()["status"] == "converted"


def test_requisition_locked_after_approval(ctx):
    tc, _ = ctx
    rid = tc.post("/api/requisitions", json={"lines": [_die_line()]}).json()["requisition_id"]
    tc.post(f"/api/requisitions/{rid}/submit")
    tc.post(f"/api/requisitions/{rid}/approve")
    # editing an approved requisition is rejected
    assert tc.put(f"/api/requisitions/{rid}", json={"notes": "x"}).status_code == 400


def test_direct_po_intra_state_gst(ctx):
    tc, _ = ctx
    v = tc.post("/api/vendors", json={"name": "Local Vendor", "state_code": "22"}).json()  # same as company
    po = tc.post("/api/purchase-orders", json={"vendor_id": v["vendor_id"], "origin": "direct",
                                               "lines": [_die_line(qty=10, rate=100, gst=18)]}).json()
    assert po["tax_mode"] == "intra"
    l = po["lines"][0]
    assert l["taxable"] == 1000.0 and l["cgst"] == 90.0 and l["sgst"] == 90.0 and l["igst"] == 0.0
    assert po["subtotal"] == 1000.0 and po["tax_total"] == 180.0 and po["grand_total"] == 1180.0


def test_direct_po_inter_state_gst(ctx):
    tc, _ = ctx
    v = tc.post("/api/vendors", json={"name": "Far Vendor", "state_code": "27"}).json()  # != company 22
    po = tc.post("/api/purchase-orders", json={"vendor_id": v["vendor_id"],
                                               "lines": [_die_line(qty=10, rate=100, gst=18)]}).json()
    assert po["tax_mode"] == "inter"
    l = po["lines"][0]
    assert l["igst"] == 180.0 and l["cgst"] == 0.0 and l["sgst"] == 0.0
    assert po["grand_total"] == 1180.0


def test_po_rate_autofills_from_vendor_pricelist(ctx):
    tc, _ = ctx
    v = tc.post("/api/vendors", json={"name": "PV", "state_code": "22"}).json()
    tc.post("/api/vendor-items", json={"vendor_id": v["vendor_id"],
            "item_ref": {"source": "die", "id": "die_1"}, "default_rate": 55, "gst_pct": 18})
    # line omits rate -> should pull 55 from the price list
    po = tc.post("/api/purchase-orders", json={"vendor_id": v["vendor_id"],
            "lines": [{"item_ref": {"source": "die", "id": "die_1"}, "qty": 2}]}).json()
    assert po["lines"][0]["rate"] == 55.0
    assert po["lines"][0]["taxable"] == 110.0


def test_po_approve_send_and_pdf(ctx):
    tc, _ = ctx
    v = tc.post("/api/vendors", json={"name": "PDF Vendor", "state_code": "27", "gstin": "27AAAAA0000A1Z5"}).json()
    po = tc.post("/api/purchase-orders", json={"vendor_id": v["vendor_id"], "lines": [_die_line()]}).json()
    pid = po["po_id"]
    assert tc.post(f"/api/purchase-orders/{pid}/approve").json()["status"] == "approved"
    assert tc.post(f"/api/purchase-orders/{pid}/send").json()["status"] == "sent"
    # cannot edit a sent PO
    assert tc.put(f"/api/purchase-orders/{pid}", json={"terms": "x"}).status_code == 400

    pdf = tc.get(f"/api/purchase-orders/{pid}/pdf")
    assert pdf.status_code == 200
    assert pdf.headers["content-type"] == "application/pdf"
    assert pdf.content[:5] == b"%PDF-"
    assert len(pdf.content) > 1500
