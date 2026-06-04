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
WEEKLY_OFF = [5, 6]                    # Saturday, Sunday
HOLIDAYS = []


def _ist(y, m, d, hh, mm=0):
    return datetime(y, m, d, hh, mm, tzinfo=IST)


class TestCalculatePlanTime:
    def test_within_same_day(self):
        # Mon 2026-06-01 11:00 IST + 2h -> 13:00 IST same day
        start = _ist(2026, 6, 1, 11, 0)
        end = calculate_plan_time(start, 2, OFFICE_START, OFFICE_END, WEEKLY_OFF, HOLIDAYS)
        assert end.astimezone(IST) == _ist(2026, 6, 1, 13, 0)

    def test_after_hours_friday_starts_monday(self):
        # Fri 2026-06-05 17:50 IST + 2h -> Mon 2026-06-08 11:00 IST (skips Sat eve, Sun)
        start = _ist(2026, 6, 5, 17, 50)
        end = calculate_plan_time(start, 2, OFFICE_START, OFFICE_END, WEEKLY_OFF, HOLIDAYS).astimezone(IST)
        # 10 min left Friday (17:50->18:00), remaining 1h50m into Monday from 10:00 -> 11:50
        assert end == _ist(2026, 6, 8, 11, 50)

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
