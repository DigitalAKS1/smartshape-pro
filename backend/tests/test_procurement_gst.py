"""
Pure unit tests for procurement GST calculation (no DB connection).

We set a dummy MONGO_URL so `database.py` imports cleanly; Motor connects
lazily (only on a real query), and these tests never issue one — so prod is
never touched.
"""
import os
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

from routes.procurement_routes import compute_gst_line, round2  # noqa: E402


def test_intra_state_splits_into_cgst_sgst():
    r = compute_gst_line(qty=10, rate=100, gst_pct=18, tax_mode="intra")
    assert r["taxable"] == 1000.0
    assert r["cgst"] == 90.0       # 9%
    assert r["sgst"] == 90.0       # 9%
    assert r["igst"] == 0.0
    assert r["line_total"] == 1180.0


def test_inter_state_uses_igst_only():
    r = compute_gst_line(qty=10, rate=100, gst_pct=18, tax_mode="inter")
    assert r["taxable"] == 1000.0
    assert r["cgst"] == 0.0
    assert r["sgst"] == 0.0
    assert r["igst"] == 180.0
    assert r["line_total"] == 1180.0


def test_zero_gst_item():
    r = compute_gst_line(qty=5, rate=20, gst_pct=0, tax_mode="intra")
    assert r["taxable"] == 100.0
    assert r["cgst"] == 0.0 and r["sgst"] == 0.0 and r["igst"] == 0.0
    assert r["line_total"] == 100.0


def test_rounding_is_two_dp():
    # 3 * 33.33 = 99.99 taxable; 18% intra -> 8.9991 each side -> 9.0
    r = compute_gst_line(qty=3, rate=33.33, gst_pct=18, tax_mode="intra")
    assert r["taxable"] == 99.99
    assert r["cgst"] == 9.0
    assert r["sgst"] == 9.0
    assert r["line_total"] == round2(99.99 + 9.0 + 9.0)


def test_handles_none_and_strings_safely():
    r = compute_gst_line(qty=None, rate=None, gst_pct=None, tax_mode="inter")
    assert r["taxable"] == 0.0
    assert r["line_total"] == 0.0
