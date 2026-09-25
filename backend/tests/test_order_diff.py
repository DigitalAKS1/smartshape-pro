"""Pure-logic tests for the human-readable order change list."""
from routes.order_routes import build_change_lines


def test_add_remove_adjust():
    lines = build_change_lines([
        {"action": "add", "qty": 50, "code": "D-1", "name": "Star"},
        {"action": "remove", "code": "D-2", "name": "Heart"},
        {"action": "adjust", "code": "D-3", "name": "Round", "old": 100, "new": 120},
    ])
    assert lines == [
        "Added 50 × D-1 Star",
        "Removed D-2 Heart",
        "Changed D-3 Round 100→120",
    ]


def test_empty():
    assert build_change_lines([]) == []


def test_unknown_action_ignored():
    assert build_change_lines([{"action": "noop"}]) == []
