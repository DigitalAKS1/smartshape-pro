from webinar_ics import build_session_ics

def _sess():
    return {"session_id": "sess_x", "title": "Die Workshop", "date": "2099-03-04",
            "time": "10:30", "platform": "zoom", "meeting_link": "https://zoom.us/j/1",
            "description": "Live demo", "location": ""}

def test_ics_has_vevent_and_tzid_and_join():
    ics = build_session_ics(_sess())
    assert "BEGIN:VCALENDAR" in ics and "BEGIN:VEVENT" in ics
    assert "SUMMARY:Die Workshop" in ics
    assert "DTSTART;TZID=Asia/Kolkata:20990304T103000" in ics
    assert "https://zoom.us/j/1" in ics
    assert ics.endswith("\r\n")

def test_ics_physical_uses_location_no_conference():
    s = _sess(); s["platform"] = "physical"; s["meeting_link"] = ""; s["location"] = "Faridabad Center"
    ics = build_session_ics(s)
    assert "LOCATION:Faridabad Center" in ics
    assert "CONFERENCE" not in ics
