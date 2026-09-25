"""
Iteration 26: Quotation PDF format fix (industry-standard pre-GST discount layout)
+ Font Size Selector (small/medium/large)

Validates:
- POST /api/quotations: pre-GST discount model (NOT cascaded)
- PUT /api/quotations/{id}: persists font_size_mode, bank_details_override, terms_override
- PUT /api/quotations/{id}: recomputes pricing using same model
- GET /api/quotations/{id}/pdf: valid PDF, contains logo (Image XObject), differs by font_size_mode
"""
import os
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL').rstrip('/')
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "info@smartshape.in"
ADMIN_PWD = "admin123"


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PWD}, timeout=15)
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def package_id(admin_session):
    r = admin_session.get(f"{API}/packages", timeout=15)
    assert r.status_code == 200
    pkgs = r.json()
    assert len(pkgs) > 0, "no packages seeded"
    return pkgs[0]["package_id"]


@pytest.fixture(scope="module")
def sales_person_id(admin_session):
    r = admin_session.get(f"{API}/salespersons", timeout=15)
    assert r.status_code == 200
    sps = r.json()
    assert len(sps) > 0
    return sps[0]["sales_person_id"]


def _build_payload(pkg_id, sp_id, font_mode="medium"):
    # 4 lines with line_subtotal sums to 247650 (matches review spec)
    lines = [
        {"description": "Item A", "product_type": "machine", "qty": 1, "unit_price": 100000,
         "gst_pct": 18, "line_subtotal": 100000, "line_gst": 18000, "line_total": 118000, "sort_order": 1},
        {"description": "Item B", "product_type": "consumable", "qty": 2, "unit_price": 50000,
         "gst_pct": 18, "line_subtotal": 100000, "line_gst": 18000, "line_total": 118000, "sort_order": 2},
        {"description": "Item C", "product_type": "custom", "qty": 1, "unit_price": 47650,
         "gst_pct": 18, "line_subtotal": 47650, "line_gst": 8577, "line_total": 56227, "sort_order": 3},
    ]
    return {
        "package_id": pkg_id,
        "sales_person_id": sp_id,
        "principal_name": "TEST_Principal26",
        "school_name": "TEST_School26",
        "address": "TEST Addr",
        "customer_email": "test26@example.com",
        "customer_phone": "9999999999",
        "customer_gst": "29AAAAA0000A1Z5",
        "discount1_pct": 10,
        "discount2_pct": 5,
        "freight_amount": 6005.75,
        "lines": lines,
        "font_size_mode": font_mode,
    }


# ---- 1. CREATE: pre-GST discount model math ----
def test_create_quotation_pre_gst_discount_model(admin_session, package_id, sales_person_id):
    payload = _build_payload(package_id, sales_person_id, font_mode="medium")
    r = admin_session.post(f"{API}/quotations", json=payload, timeout=20)
    assert r.status_code == 200, f"Create failed: {r.status_code} {r.text}"
    data = r.json()
    qid = data["quotation_id"]

    # Verify computed fields - non-cascaded discounts on items_total
    items_total = 247650.0
    assert abs(data["subtotal"] - items_total) < 0.01, f"subtotal {data['subtotal']} != {items_total}"
    # disc1 = items_total * 10% = 24765
    assert abs(data["disc1_amount"] - 24765.0) < 0.5, f"disc1 {data['disc1_amount']}"
    # disc2 = items_total * 5% = 12382.5  (NOT cascaded - on items_total directly)
    assert abs(data["disc2_amount"] - 12382.5) < 0.5, f"disc2 {data['disc2_amount']}"
    # sub_total_after = 247650 - 24765 - 12382.5 + 6005.75 = 216508.25
    assert abs(data["sub_total_after"] - 216508.25) < 0.5, f"sub_total_after {data['sub_total_after']}"
    # gst = 216508.25 * 0.18 ~= 38971.485
    assert abs(data["gst_amount"] - 38971.485) < 1.0, f"gst {data['gst_amount']}"
    # grand_total ~= 255479.735
    assert abs(data["grand_total"] - 255479.735) < 1.0, f"grand_total {data['grand_total']}"
    assert data["font_size_mode"] == "medium"

    # Persist quotation_id for downstream tests
    pytest.shared_qid_medium = qid


# ---- 2. PUT updates font_size_mode + overrides ----
def test_put_quotation_persists_font_size_and_overrides(admin_session):
    qid = getattr(pytest, "shared_qid_medium", None)
    assert qid, "no quotation_id from previous test"
    body = {
        "font_size_mode": "large",
        "bank_details_override": "TEST Bank | A/c TEST | 1234567890 | IFSC TEST0001",
        "terms_override": "Payment 50% advance\nWarranty 1 year",
    }
    r = admin_session.put(f"{API}/quotations/{qid}", json=body, timeout=15)
    assert r.status_code == 200, f"PUT failed {r.status_code} {r.text}"
    data = r.json()
    assert data["font_size_mode"] == "large"
    assert "TEST Bank" in data["bank_details_override"]
    assert "Payment 50% advance" in data["terms_override"]


# ---- 3. PUT recomputes pricing on lines change (no cascading) ----
def test_put_quotation_recomputes_pricing(admin_session, package_id, sales_person_id):
    # Create fresh
    create = admin_session.post(
        f"{API}/quotations",
        json=_build_payload(package_id, sales_person_id, font_mode="small"),
        timeout=20,
    )
    assert create.status_code == 200
    qid = create.json()["quotation_id"]

    # New lines: items_total = 100000
    new_lines = [{
        "description": "New Item", "product_type": "machine", "qty": 1, "unit_price": 100000,
        "gst_pct": 18, "line_subtotal": 100000, "line_gst": 18000, "line_total": 118000, "sort_order": 1,
    }]
    r = admin_session.put(
        f"{API}/quotations/{qid}",
        json={"lines": new_lines, "discount1_pct": 10, "discount2_pct": 5, "freight_amount": 0},
        timeout=15,
    )
    assert r.status_code == 200, f"PUT recompute failed: {r.text}"
    d = r.json()
    # subtotal=100000, disc1=10000, disc2=5000 (not cascaded), sub_after=85000, gst=15300, grand=100300
    assert abs(d["subtotal"] - 100000) < 0.01
    assert abs(d["disc1_amount"] - 10000) < 0.5
    assert abs(d["disc2_amount"] - 5000) < 0.5, "disc2 must be on items_total, not cascaded"
    assert abs(d["sub_total_after"] - 85000) < 0.5
    assert abs(d["gst_amount"] - 15300) < 0.5
    assert abs(d["grand_total"] - 100300) < 0.5

    # cleanup
    admin_session.delete(f"{API}/quotations/{qid}", timeout=10)


# ---- 4. PDF download: magic bytes + Image XObject (logo) ----
def test_pdf_has_logo_and_valid_magic(admin_session):
    qid = getattr(pytest, "shared_qid_medium", None)
    assert qid
    r = admin_session.get(f"{API}/quotations/{qid}/pdf", timeout=30)
    assert r.status_code == 200, f"PDF download failed: {r.status_code}"
    content = r.content
    assert content[:5] == b"%PDF-", "Not a valid PDF"
    # Image XObject indicates logo embed
    assert b"/Subtype /Image" in content or b"/Subtype/Image" in content, "No Image XObject (logo) in PDF"
    # Save medium PDF size for next test
    pytest.shared_pdf_medium_size = len(content)


# ---- 5. Font scaling: small / medium / large produce different PDFs ----
def test_pdf_font_scaling_produces_different_sizes(admin_session, package_id, sales_person_id):
    sizes = {}
    for mode in ("small", "medium", "large"):
        payload = _build_payload(package_id, sales_person_id, font_mode=mode)
        c = admin_session.post(f"{API}/quotations", json=payload, timeout=20)
        assert c.status_code == 200
        qid = c.json()["quotation_id"]
        p = admin_session.get(f"{API}/quotations/{qid}/pdf", timeout=30)
        assert p.status_code == 200
        assert p.content[:5] == b"%PDF-"
        sizes[mode] = len(p.content)
        admin_session.delete(f"{API}/quotations/{qid}", timeout=10)
    print(f"PDF sizes: {sizes}")
    # At least small != large (rendering differences)
    assert sizes["small"] != sizes["large"], f"small and large PDFs identical: {sizes}"


# ---- 6. PDF with bank/terms overrides + italic fallback ----
def test_pdf_bank_terms_overrides_render(admin_session, package_id, sales_person_id):
    payload = _build_payload(package_id, sales_person_id, font_mode="medium")
    payload["bank_details_override"] = "Bank Z\nA/c 99999"
    payload["terms_override"] = "Net 30\n2% disc on early pay"
    c = admin_session.post(f"{API}/quotations", json=payload, timeout=20)
    assert c.status_code == 200
    qid = c.json()["quotation_id"]
    p = admin_session.get(f"{API}/quotations/{qid}/pdf", timeout=30)
    assert p.status_code == 200
    assert p.content[:5] == b"%PDF-"
    # Cleanup
    admin_session.delete(f"{API}/quotations/{qid}", timeout=10)


# ---- 7. Cleanup the shared medium quotation ----
def test_cleanup_shared(admin_session):
    qid = getattr(pytest, "shared_qid_medium", None)
    if qid:
        admin_session.delete(f"{API}/quotations/{qid}", timeout=10)
