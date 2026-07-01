from datetime import datetime, timezone, timedelta
from webinar_lifecycle import session_start_ist, due_time_stages

IST = timedelta(hours=5, minutes=30)
def _sess(**kw):
    base = {"date":"2099-03-04","time":"15:00",
            "webinar_emails":{"remind_24h":True,"remind_1h":True,"live":True,"noshow":True,"attended":True}}
    base.update(kw); return base

def test_start_is_utc_of_ist_walltime():
    # 15:00 IST == 09:30 UTC
    s = session_start_ist(_sess())
    assert s == datetime(2099,3,4,9,30,tzinfo=timezone.utc)

def test_remind_24h_due_window():
    s = _sess(); start = session_start_ist(s)
    assert "remind_24h" not in due_time_stages(s, start - timedelta(hours=25))  # too early
    assert "remind_24h" in due_time_stages(s, start - timedelta(hours=23))      # within 24h
    assert "remind_24h" not in due_time_stages(s, start + timedelta(minutes=5)) # already started

def test_remind_1h_and_live_and_followups():
    s = _sess(); start = session_start_ist(s)
    assert "remind_1h" in due_time_stages(s, start - timedelta(minutes=30))
    assert "live" in due_time_stages(s, start + timedelta(minutes=5))
    assert "live" not in due_time_stages(s, start + timedelta(minutes=30))
    due = due_time_stages(s, start + timedelta(hours=3))
    assert "noshow" in due and "attended" in due

def test_toggle_off_never_returned():
    s = _sess(webinar_emails={"remind_24h":False,"remind_1h":True,"live":True,"noshow":True,"attended":True})
    start = session_start_ist(s)
    assert "remind_24h" not in due_time_stages(s, start - timedelta(hours=2))

def test_no_date_returns_empty():
    assert session_start_ist({"date":"","time":"10:00"}) is None
    assert due_time_stages({"date":"","time":""}, datetime(2099,1,1,tzinfo=timezone.utc)) == []
