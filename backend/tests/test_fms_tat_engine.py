"""Pure unit tests for the FMS TAT engine (no server required).
Run from backend/:  python -m pytest tests/test_fms_tat_engine.py -v
"""
from datetime import datetime, timezone, timedelta

from routes.fms_routes import (
    IST,
    calculate_plan_time,
    working_minutes_elapsed,
    tat_status,
    score_stage,
)

OFFICE_START, OFFICE_END = 10, 18      # 10am–6pm IST
WEEKLY_OFF = [6]                       # Sunday only (Sat is a working day)
HOLIDAYS = []


def _ist(y, m, d, hh, mm=0):
    return datetime(y, m, d, hh, mm, tzinfo=IST)


class TestCalculatePlanTime:
    def test_within_same_day(self):
        # Mon 2026-06-01 11:00 IST + 2h -> 13:00 IST same day
        start = _ist(2026, 6, 1, 11, 0)
        end = calculate_plan_time(start, 2, OFFICE_START, OFFICE_END, WEEKLY_OFF, HOLIDAYS)
        assert end.astimezone(IST) == _ist(2026, 6, 1, 13, 0)

    def test_after_hours_friday_spills_to_saturday(self):
        # Sat is a working day (only Sun off). Fri 2026-06-05 17:50 IST + 2h:
        # 10 min Fri (17:50->18:00), remaining 1h50m from Sat 10:00 -> 11:50 Sat.
        start = _ist(2026, 6, 5, 17, 50)
        end = calculate_plan_time(start, 2, OFFICE_START, OFFICE_END, WEEKLY_OFF, HOLIDAYS).astimezone(IST)
        assert end == _ist(2026, 6, 6, 11, 50)

    def test_saturday_evening_skips_sunday_to_monday(self):
        # Sat 2026-06-06 17:30 IST + 1h: 30 min Sat (17:30->18:00), Sun skipped,
        # remaining 30 min from Mon 2026-06-08 10:00 -> 10:30 Mon.
        start = _ist(2026, 6, 6, 17, 30)
        end = calculate_plan_time(start, 1, OFFICE_START, OFFICE_END, WEEKLY_OFF, HOLIDAYS).astimezone(IST)
        assert end == _ist(2026, 6, 8, 10, 30)

    def test_holiday_is_skipped(self):
        # Mon 2026-06-01 is a holiday; start Mon 10:00 +1h -> Tue 11:00
        start = _ist(2026, 6, 1, 10, 0)
        end = calculate_plan_time(start, 1, OFFICE_START, OFFICE_END, WEEKLY_OFF, ["2026-06-01"]).astimezone(IST)
        assert end == _ist(2026, 6, 2, 11, 0)

    def test_input_in_utc_is_converted(self):
        # 2026-06-01 05:30 UTC == 11:00 IST ; +1h -> 12:00 IST
        start = datetime(2026, 6, 1, 5, 30, tzinfo=timezone.utc)
        end = calculate_plan_time(start, 1, OFFICE_START, OFFICE_END, WEEKLY_OFF, HOLIDAYS).astimezone(IST)
        assert end == _ist(2026, 6, 1, 12, 0)


class TestTatStatus:
    def test_done_on_time_is_green(self):
        ps = datetime(2026, 6, 1, 4, 0, tzinfo=timezone.utc)
        pd = datetime(2026, 6, 1, 8, 0, tzinfo=timezone.utc)
        ad = datetime(2026, 6, 1, 7, 0, tzinfo=timezone.utc)
        assert tat_status(ps, pd, ad) == "green"

    def test_done_late_is_red(self):
        ps = datetime(2026, 6, 1, 4, 0, tzinfo=timezone.utc)
        pd = datetime(2026, 6, 1, 8, 0, tzinfo=timezone.utc)
        ad = datetime(2026, 6, 1, 9, 0, tzinfo=timezone.utc)
        assert tat_status(ps, pd, ad) == "red"

    def test_open_past_plan_is_overdue(self):
        ps = datetime(2020, 1, 1, 0, 0, tzinfo=timezone.utc)
        pd = datetime(2020, 1, 1, 1, 0, tzinfo=timezone.utc)  # long past
        assert tat_status(ps, pd, None) == "overdue"

    def test_open_early_is_green(self):
        now = datetime.now(timezone.utc)
        ps = now - timedelta(minutes=1)
        pd = now + timedelta(hours=10)   # ~0% elapsed
        assert tat_status(ps, pd, None) == "green"

    def test_open_past_warn_is_orange(self):
        now = datetime.now(timezone.utc)
        ps = now - timedelta(minutes=60)
        pd = now + timedelta(minutes=40)  # 60/100 = 60% elapsed -> orange (>=0.5, <0.8)
        assert tat_status(ps, pd, None) == "orange"


class TestScoreStage:
    def test_on_time_is_100(self):
        ps = datetime(2026, 6, 1, 4, 0, tzinfo=timezone.utc)
        pd = datetime(2026, 6, 1, 8, 0, tzinfo=timezone.utc)
        ad = datetime(2026, 6, 1, 6, 0, tzinfo=timezone.utc)
        assert score_stage(ps, pd, ad) == 100

    def test_one_budget_late_is_50(self):
        ps = datetime(2026, 6, 1, 4, 0, tzinfo=timezone.utc)
        pd = datetime(2026, 6, 1, 8, 0, tzinfo=timezone.utc)   # 240 min budget
        ad = datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc)  # 240 min late
        assert score_stage(ps, pd, ad) == 50

    def test_two_budget_late_is_0(self):
        ps = datetime(2026, 6, 1, 4, 0, tzinfo=timezone.utc)
        pd = datetime(2026, 6, 1, 8, 0, tzinfo=timezone.utc)   # 240 min budget
        ad = datetime(2026, 6, 1, 16, 0, tzinfo=timezone.utc)  # 480 min late
        assert score_stage(ps, pd, ad) == 0

    def test_missing_actual_is_0(self):
        ps = datetime(2026, 6, 1, 4, 0, tzinfo=timezone.utc)
        pd = datetime(2026, 6, 1, 8, 0, tzinfo=timezone.utc)
        assert score_stage(ps, pd, None) == 0
