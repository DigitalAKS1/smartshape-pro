# backend/tests/test_order_confirmation_status.py
"""Pure-logic tests for the awaiting-confirmation status helpers.

An order-item's status decides whether it holds stock (compute_committed()
counts on_hold/confirmed/partially_dispatched, order_routes.py:73) — these
helpers are the single place that decides which status a new/edited line
gets, so a school/teacher's submitted selection cannot commit stock before
staff confirm it.
"""
import os

# Set before importing order_routes: it imports database.py, which reads
# MONGO_URL from .env at import time — defensively pin it to a harmless local
# value so this pure-logic test can never accidentally resolve to whatever
# .env happens to point at (see project note: local backend can hit prod).
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

from routes.order_routes import _is_committing, _active_item_status, AWAITING_ITEM_STATUS


def test_committing_statuses_are_recognized():
    for s in ("on_hold", "confirmed", "partially_dispatched"):
        assert _is_committing(s) is True


def test_non_committing_statuses_are_not_committing():
    for s in ("awaiting_confirmation", "removed", "cancelled", "dispatched", "delivered"):
        assert _is_committing(s) is False


def test_awaiting_order_gives_awaiting_item_status():
    assert _active_item_status("awaiting_confirmation") == AWAITING_ITEM_STATUS


def test_any_other_order_status_gives_on_hold():
    for s in ("pending", "confirmed", "partially_dispatched", "dispatched"):
        assert _active_item_status(s) == "on_hold"
