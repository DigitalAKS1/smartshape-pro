"""Pure due-time computation helpers for the Zoom webinar email lifecycle.

No DB access, no I/O, no wall-clock reads. Every function takes an explicit
`now: datetime` so behavior is fully deterministic and testable. SmartShape
operates in IST (Asia/Kolkata = UTC+05:30); sessions store their scheduled
`date` ("YYYY-MM-DD") and `time` ("HH:MM", may be empty) as IST wall-clock
values.
"""

from datetime import datetime, timezone, timedelta

IST_OFFSET = timedelta(hours=5, minutes=30)


def session_start_ist(session: dict):
    """Parse session['date'] + session['time'] as an Asia/Kolkata wall-clock
    instant and return it as a timezone-aware UTC datetime.

    Returns None if `date` is missing/unparseable. A missing/blank `time`
    defaults to "00:00".
    """
    if not session:
        return None
    date_str = (session.get("date") or "").strip()
    if not date_str:
        return None
    time_str = (session.get("time") or "").strip() or "00:00"
    try:
        naive = datetime.strptime(f"{date_str} {time_str}", "%Y-%m-%d %H:%M")
    except ValueError:
        return None
    # naive is IST wall-clock; convert to UTC by subtracting the IST offset.
    return naive.replace(tzinfo=timezone.utc) - IST_OFFSET


def due_time_stages(session: dict, now: datetime) -> list:
    """Return which time-based email stages are due for `session` at `now`.

    `now` must be a timezone-aware UTC datetime. Honors per-session
    `webinar_emails` toggles — a stage whose toggle is False is never
    returned. `confirm` is not time-based and is never returned here.
    """
    start = session_start_ist(session)
    if start is None:
        return []

    toggles = (session or {}).get("webinar_emails") or {}

    def enabled(stage):
        return toggles.get(stage, True)

    due = []

    if enabled("remind_24h") and (now >= start - timedelta(hours=24)) and (now < start):
        due.append("remind_24h")

    if enabled("remind_1h") and (now >= start - timedelta(hours=1)) and (now < start):
        due.append("remind_1h")

    if enabled("live") and (start <= now <= start + timedelta(minutes=15)):
        due.append("live")

    if enabled("noshow") and (now >= start + timedelta(hours=2)):
        due.append("noshow")

    if enabled("attended") and (now >= start + timedelta(hours=2)):
        due.append("attended")

    return due
