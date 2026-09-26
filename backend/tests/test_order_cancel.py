"""Pure-logic tests for order cancel/reopen status guards."""
from routes.order_routes import can_cancel, can_reopen


def test_active_orders_can_cancel():
    for s in ("pending", "confirmed", "partially_dispatched"):
        assert can_cancel(s) is True


def test_gone_or_cancelled_cannot_cancel():
    for s in ("cancelled", "dispatched", "delivered"):
        assert can_cancel(s) is False


def test_only_cancelled_can_reopen():
    assert can_reopen("cancelled") is True
    for s in ("pending", "confirmed", "dispatched", "delivered", ""):
        assert can_reopen(s) is False
