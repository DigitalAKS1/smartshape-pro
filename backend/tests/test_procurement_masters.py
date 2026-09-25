"""
Phase-1 procurement endpoint tests against an in-memory async Mongo.

`mongomock_motor` provides an AsyncMongoMockClient that behaves like Motor, so
the real route handlers run end-to-end without ever touching the prod DB.

Auth (`get_current_user`) is overridden via FastAPI dependency_overrides to a
fake admin, so we test the route logic, not the cookie/session layer.
"""
import os
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")
os.environ.setdefault("UPLOADS_DIR", os.path.join(os.path.dirname(__file__), "_uploads_tmp"))

import pytest
from mongomock_motor import AsyncMongoMockClient

import database
import routes.procurement_routes as procurement_routes


@pytest.fixture()
def client(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    # Swap the shared db handle for an in-memory one (per test).
    mock_db = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(database, "db", mock_db)
    monkeypatch.setattr(procurement_routes, "db", mock_db)

    # Routes call get_current_user(request) imperatively, so patch the name the
    # module resolves rather than using FastAPI dependency_overrides.
    async def fake_user(request=None):
        return {"email": "admin@test.in", "role": "admin"}
    monkeypatch.setattr(procurement_routes, "get_current_user", fake_user)

    app = FastAPI()
    app.include_router(procurement_routes.router, prefix="/api")
    tc = TestClient(app)
    tc._mock_db = mock_db
    return tc


def test_vendor_crud(client):
    r = client.post("/api/vendors", json={"name": "Shree Packaging", "state_code": "22", "gstin": "22ABCDE1234F1Z5"})
    assert r.status_code == 200, r.text
    v = r.json()
    assert v["vendor_id"].startswith("ven_")
    assert v["is_active"] is True

    # list
    assert any(x["vendor_id"] == v["vendor_id"] for x in client.get("/api/vendors").json())

    # update
    r = client.put(f"/api/vendors/{v['vendor_id']}", json={"payment_terms": "30 days"})
    assert r.json()["payment_terms"] == "30 days"

    # soft delete -> excluded from default list, present with include_inactive
    client.delete(f"/api/vendors/{v['vendor_id']}")
    assert all(x["vendor_id"] != v["vendor_id"] for x in client.get("/api/vendors").json())
    assert any(x["vendor_id"] == v["vendor_id"] for x in client.get("/api/vendors", params={"include_inactive": True}).json())


def test_vendor_requires_name(client):
    assert client.post("/api/vendors", json={"name": "  "}).status_code == 400


def test_purchase_item_and_unified_catalog(client):
    # a purchase item
    pi = client.post("/api/purchase-items", json={"name": "Corrugated Box", "uom": "box", "hsn": "4819", "gst_pct": 18}).json()
    assert pi["purchase_item_id"].startswith("pitem_")

    # seed a die directly (finished product) so the catalog merges both sources
    import asyncio
    asyncio.run(
        procurement_routes.db.dies.insert_one(
            {"die_id": "die_x1", "name": "Heart Die", "code": "HD-1", "is_active": True, "stock_qty": 5})
    )

    cat = client.get("/api/procurement/item-catalog").json()
    sources = {c["source"] for c in cat}
    assert sources == {"die", "purchase_item"}
    box = next(c for c in cat if c["id"] == pi["purchase_item_id"])
    assert box["item_ref"] == {"source": "purchase_item", "id": pi["purchase_item_id"]}
    assert box["gst_pct"] == 18

    # source + q filters
    only_dies = client.get("/api/procurement/item-catalog", params={"source": "die"}).json()
    assert {c["source"] for c in only_dies} == {"die"}
    found = client.get("/api/procurement/item-catalog", params={"q": "heart"}).json()
    assert len(found) == 1 and found[0]["id"] == "die_x1"


def test_vendor_price_list_upsert(client):
    v = client.post("/api/vendors", json={"name": "V1"}).json()
    pi = client.post("/api/purchase-items", json={"name": "Tape", "gst_pct": 12}).json()
    ref = {"source": "purchase_item", "id": pi["purchase_item_id"]}

    r = client.post("/api/vendor-items", json={"vendor_id": v["vendor_id"], "item_ref": ref, "name": "Tape", "default_rate": 10, "gst_pct": 12})
    assert r.status_code == 200, r.text
    vi_id = r.json()["vendor_item_id"]

    # second post for same (vendor,item) updates instead of duplicating
    r2 = client.post("/api/vendor-items", json={"vendor_id": v["vendor_id"], "item_ref": ref, "name": "Tape", "default_rate": 12})
    assert r2.json()["vendor_item_id"] == vi_id
    rows = client.get("/api/vendor-items", params={"vendor_id": v["vendor_id"]}).json()
    assert len(rows) == 1 and rows[0]["default_rate"] == 12

    # bad ref rejected
    assert client.post("/api/vendor-items", json={"vendor_id": v["vendor_id"], "item_ref": {"source": "bad"}}).status_code == 400


def test_qc_templates_seed_and_create(client):
    seeded = client.get("/api/qc-templates").json()
    assert len(seeded) >= 1  # default template auto-seeded
    t = client.post("/api/qc-templates", json={"name": "Inbound", "checks": [{"label": "Qty ok", "type": "boolean"}]}).json()
    assert t["template_id"].startswith("qct_")
    assert any(x["template_id"] == t["template_id"] for x in client.get("/api/qc-templates").json())


def test_counter_is_sequential(client):
    import asyncio
    async def go():
        a = await procurement_routes.next_number("po", "PO")
        b = await procurement_routes.next_number("po", "PO")
        c = await procurement_routes.next_number("grn", "GRN")
        return a, b, c
    a, b, c = asyncio.run(go())
    assert a == "PO-0001" and b == "PO-0002" and c == "GRN-0001"
