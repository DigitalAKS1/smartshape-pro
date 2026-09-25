"""Pure-logic tests for the daily 'Orders Received' report formatter.

No DB / network — only the text builder is exercised.
"""
from scheduler import _format_orders_report


def test_empty_returns_none():
    assert _format_orders_report([], "2026-06-15") is None


def test_two_orders_summary():
    orders = [
        {"school_name": "Sunrise Public School", "grand_total": 12000, "order_number": "ORD-2026-1"},
        {"school_name": "Green Valley", "grand_total": 8000.5, "order_number": "ORD-2026-2"},
    ]
    text = _format_orders_report(orders, "2026-06-15")
    assert "Total orders: 2" in text
    assert "Sunrise Public School" in text
    assert "Green Valley" in text
    assert "2026-06-15" in text
    # total value 20000 (rounded, with thousands sep)
    assert "20,000" in text


def test_truncates_long_lists():
    orders = [{"school_name": f"S{i}", "grand_total": 100, "order_number": f"O{i}"} for i in range(20)]
    text = _format_orders_report(orders, "2026-06-15")
    assert "Total orders: 20" in text
    assert "more" in text
