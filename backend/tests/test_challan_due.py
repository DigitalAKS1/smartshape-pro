"""Pure-logic tests for the returnable-challan due filter."""
from scheduler import _challans_due

TODAY = "2026-06-15"


def _c(status, date, **extra):
    return {"status": status, "expected_return_date": date, **extra}


def test_closed_excluded():
    assert _challans_due([_c("closed", "2026-06-10")], TODAY) == []


def test_no_date_excluded():
    assert _challans_due([_c("open", None)], TODAY) == []


def test_future_date_excluded():
    assert _challans_due([_c("open", "2026-06-20")], TODAY) == []


def test_today_included():
    out = _challans_due([_c("open", TODAY)], TODAY)
    assert len(out) == 1


def test_past_and_partial_included():
    out = _challans_due([
        _c("open", "2026-06-10"),
        _c("partially_returned", "2026-06-01"),
        _c("closed", "2026-06-01"),
    ], TODAY)
    assert len(out) == 2
