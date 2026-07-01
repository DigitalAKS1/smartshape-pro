"""iCalendar (.ics) for a training session, reusing delegation_routes' RFC-5545 primitives."""
from datetime import datetime, timezone
from routes.delegation_routes import _ics_escape, _ics_dt, _wrap_vcalendar


def build_session_ics(session: dict) -> str:
    dtstart, is_date = _ics_dt(session.get("date", ""), session.get("time", ""))
    dtend, _ = _ics_dt(session.get("date", ""), session.get("time", ""))  # 0-length; clients still add it
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    uid = f"{session.get('session_id','sess')}@smartshape.in"
    join = (session.get("meeting_link") or "").strip()
    lines = ["BEGIN:VEVENT", f"UID:{uid}", f"DTSTAMP:{stamp}", "SEQUENCE:0"]
    if is_date:
        lines += [f"DTSTART;VALUE=DATE:{dtstart}", f"DTEND;VALUE=DATE:{dtstart}"]
    else:
        lines += [f"DTSTART;TZID=Asia/Kolkata:{dtstart}", f"DTEND;TZID=Asia/Kolkata:{dtend}"]
    lines.append(f"SUMMARY:{_ics_escape(session.get('title'))}")
    desc = []
    if join:
        desc.append(f"Join: {join}")
    if session.get("description"):
        desc.append(session["description"])
    if desc:
        lines.append(f"DESCRIPTION:{_ics_escape(chr(10).join(desc))}")
    if session.get("location"):
        lines.append(f"LOCATION:{_ics_escape(session['location'])}")
    if join:
        lines.append(f"URL:{join}")
        lines.append(f'CONFERENCE;VALUE=URI;FEATURE=VIDEO;LABEL="Zoom":{join}')
        lines.append(f"X-GOOGLE-CONFERENCE:{join}")
    lines.append("STATUS:CONFIRMED")
    lines.append("END:VEVENT")
    return _wrap_vcalendar("PUBLISH", [lines])
