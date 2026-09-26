"""Pure-logic tests for the shortfall drill-down grouping."""
from routes.procurement_routes import group_demand_by_school


def test_groups_and_sorts_by_qty():
    lines = [
        {"school_name": "Alpha", "order_number": "O1", "order_id": "o1", "quantity": 3},
        {"school_name": "Beta", "order_number": "O2", "order_id": "o2", "quantity": 10},
        {"school_name": "Alpha", "order_number": "O3", "order_id": "o3", "quantity": 2},
    ]
    out = group_demand_by_school(lines)
    assert [b["school_name"] for b in out] == ["Beta", "Alpha"]  # Beta(10) before Alpha(5)
    alpha = next(b for b in out if b["school_name"] == "Alpha")
    assert alpha["total_qty"] == 5
    assert alpha["order_count"] == 2


def test_missing_school_becomes_dash():
    out = group_demand_by_school([{"order_number": "O1", "order_id": "o1", "quantity": 1}])
    assert out[0]["school_name"] == "—"


def test_empty():
    assert group_demand_by_school([]) == []
