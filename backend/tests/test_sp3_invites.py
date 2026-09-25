"""SP3 — ICS email invites + subscribe feed. Live test server; self-cleaning ('EvtTest').

Run the server with the send-safe guard ON so NO real email is ever sent:
  cd backend && DB_NAME=smartshape_test CALENDAR_INVITE_DRY_RUN=1 \
    python -m uvicorn main:app --host 127.0.0.1 --port 8000 --log-level warning
  REACT_APP_BACKEND_URL=http://127.0.0.1:8000 python -m pytest tests/test_sp3_invites.py -v -m "not no_dry_run"

The single `no_dry_run` test must run against a server started WITHOUT the guard.
"""
import os, uuid
import pytest, requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
PFX = "EvtTest"


class TestSP3:
    @pytest.fixture(autouse=True)
    def setup(self):
        self.s = requests.Session()
        self.s.headers.update({"Content-Type": "application/json"})
        r = self.s.post(f"{BASE}/api/auth/login",
                        json={"email": "info@smartshape.in", "password": "admin123"})
        assert r.status_code == 200, r.text
        tok = self.s.cookies.get("access_token")
        if tok:
            self.s.headers.update({"Authorization": f"Bearer {tok}"})
        self.s.post(f"{BASE}/api/delegation/sync-users", json={})
        self._evts = []
        yield
        for eid in self._evts:
            try:
                self.s.delete(f"{BASE}/api/delegation/events/{eid}")
            except Exception:
                pass

    def _create(self, **over):
        body = {"title": f"{PFX} {uuid.uuid4().hex[:6]}", "date": "2026-12-20",
                "start_time": "10:00", "end_time": "11:00",
                "collaborator_emails": [f"{PFX.lower()}.client@example.com"]}
        body.update(over)
        r = self.s.post(f"{BASE}/api/delegation/events", json=body)
        assert r.status_code == 200, r.text
        ev = r.json()
        self._evts.append(ev["event_id"])
        return ev

    def _invite(self, eid, kind="request"):
        return self.s.post(f"{BASE}/api/delegation/events/{eid}/invite", json={"kind": kind})

    # ── ICS builder characterization ─────────────────────────────────────────
    def test_01_event_ics_still_publish(self):
        ev = self._create()
        r = self.s.get(f"{BASE}/api/delegation/events/{ev['event_id']}.ics")
        assert r.status_code == 200, r.text
        body = r.text
        assert "METHOD:PUBLISH" in body
        assert f"UID:{ev['event_id']}@smartshape.in" in body
        assert f"SUMMARY:{ev['title']}" in body

    # ── invite endpoint ──────────────────────────────────────────────────────
    def test_02_first_invite_request_seq0(self):
        ev = self._create(collaborator_emails=[f"{PFX.lower()}.a@example.com",
                                               f"{PFX.lower()}.b@example.com"])
        r = self._invite(ev["event_id"])
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["dry_run"] is True
        assert d["sequence"] == 0
        assert d["method"] == "REQUEST"
        assert set(d["sent"]) == {f"{PFX.lower()}.a@example.com", f"{PFX.lower()}.b@example.com"}
        assert "METHOD:REQUEST" in d["ics_preview"]
        assert "RSVP=TRUE" in d["ics_preview"]

    def test_03_second_invite_bumps_sequence_same_uid(self):
        ev = self._create()
        self._invite(ev["event_id"])
        d = self._invite(ev["event_id"]).json()
        assert d["sequence"] == 1
        assert f"UID:{ev['event_id']}@smartshape.in" in d["ics_preview"]

    def test_04_cancel_invite_method_cancel(self):
        ev = self._create()
        self._invite(ev["event_id"])
        d = self._invite(ev["event_id"], kind="cancel").json()
        assert d["method"] == "CANCEL"
        assert d["sequence"] == 1
        assert "STATUS:CANCELLED" in d["ics_preview"]

    def test_05_invite_excludes_creator(self):
        # creator is auto-added as a collaborator; must NOT be emailed
        ev = self._create(collaborator_emails=[f"{PFX.lower()}.x@example.com"])
        d = self._invite(ev["event_id"]).json()
        assert "info@smartshape.in" not in d["sent"]
        assert d["sent"] == [f"{PFX.lower()}.x@example.com"]

    def test_06_invite_non_creator_403(self):
        ev = self._create()
        bad = requests.Session()
        bad.headers.update({"Content-Type": "application/json",
                            "Authorization": "Bearer not-a-real-token"})
        r = bad.post(f"{BASE}/api/delegation/events/{ev['event_id']}/invite",
                     json={"kind": "request"})
        assert r.status_code in (401, 403)

    def test_07_invite_missing_event_404(self):
        r = self._invite("evt_doesnotexist")
        assert r.status_code == 404

    # ── agenda meta ──────────────────────────────────────────────────────────
    def test_08_agenda_meta_invited_flag(self):
        ev = self._create()
        self._invite(ev["event_id"])
        ag = self.s.get(f"{BASE}/api/delegation/agenda",
                        params={"from": "2026-12-01", "to": "2026-12-31"}).json()
        item = next(e for e in ag["events"]
                    if e["source"] == "event" and e["entity_id"] == ev["event_id"])
        assert item["meta"]["invited"] is True
        assert item["meta"]["sequence"] == 0

    # ── subscribe feed ───────────────────────────────────────────────────────
    def test_09_feed_link_and_public_feed(self):
        ev = self._create(title=f"{PFX} feedme")
        r = self.s.get(f"{BASE}/api/delegation/calendar-feed")
        assert r.status_code == 200, r.text
        link = r.json()
        assert "token=" in link["url"]
        assert link["webcal_url"].startswith("webcal://")
        pub = requests.get(link["url"].replace("https://app.smartshape.in", BASE))
        assert pub.status_code == 200
        assert "BEGIN:VCALENDAR" in pub.text
        assert f"{PFX} feedme" in pub.text

    def test_10_public_feed_excludes_cancelled(self):
        ev = self._create(title=f"{PFX} tocancel")
        self.s.delete(f"{BASE}/api/delegation/events/{ev['event_id']}")
        self._evts.remove(ev["event_id"])
        link = self.s.get(f"{BASE}/api/delegation/calendar-feed").json()
        pub = requests.get(link["url"].replace("https://app.smartshape.in", BASE))
        assert f"{PFX} tocancel" not in pub.text

    def test_11_feed_bad_token_404(self):
        pub = requests.get(f"{BASE}/api/delegation/calendar.ics", params={"token": "nope"})
        assert pub.status_code == 404

    def test_12_feed_rotate_invalidates_old(self):
        old = self.s.get(f"{BASE}/api/delegation/calendar-feed").json()["url"]
        self.s.post(f"{BASE}/api/delegation/calendar-feed/rotate", json={})
        pub = requests.get(old.replace("https://app.smartshape.in", BASE))
        assert pub.status_code == 404

    # ── Z1: Zoom / branded join link ─────────────────────────────────────────
    def test_14_meeting_link_branded_in_invite(self):
        ev = self._create(title=f"{PFX} zoom", meeting_provider="zoom",
                          meeting_link="https://zoom.us/j/123456789")
        d = self._invite(ev["event_id"]).json()
        ics = d["ics_preview"]
        branded = f"/zoom/{ev['event_id']}"
        # branded in-app link (NOT the raw zoom url) is what attendees get
        assert branded in ics
        assert "CONFERENCE;VALUE=URI" in ics
        assert "X-GOOGLE-CONFERENCE" in ics
        assert "https://zoom.us/j/123456789" not in ics  # raw link stays server-side

    def test_15_zoom_resolve_public(self):
        ev = self._create(title=f"{PFX} resolve", meeting_provider="zoom",
                          meeting_link="https://zoom.us/j/999")
        # public — no auth header
        r = requests.get(f"{BASE}/api/delegation/zoom/{ev['event_id']}/resolve")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["meeting_link"] == "https://zoom.us/j/999"
        assert d["meeting_provider"] == "zoom"

    def test_16_resolve_missing_404(self):
        r = requests.get(f"{BASE}/api/delegation/zoom/evt_nope/resolve")
        assert r.status_code == 404

    def test_17_no_meeting_no_conference(self):
        ev = self._create(title=f"{PFX} plain")
        d = self._invite(ev["event_id"]).json()
        assert "CONFERENCE" not in d["ics_preview"]
        assert "/zoom/" not in d["ics_preview"]

    # ── Z1.1: per-user default meeting link setting ──────────────────────────
    def test_18_calendar_settings_roundtrip(self):
        r = self.s.put(f"{BASE}/api/delegation/calendar-settings",
                       json={"default_meeting_provider": "zoom",
                             "default_meeting_link": "https://zoom.us/j/MYROOM"})
        assert r.status_code == 200, r.text
        g = self.s.get(f"{BASE}/api/delegation/calendar-settings").json()
        assert g["default_meeting_provider"] == "zoom"
        assert g["default_meeting_link"] == "https://zoom.us/j/MYROOM"
        assert "webcal_url" in g and g["webcal_url"].startswith("webcal://")
        # reset so we don't leave a default on the admin account
        self.s.put(f"{BASE}/api/delegation/calendar-settings",
                   json={"default_meeting_provider": "", "default_meeting_link": ""})

    # ── email-disabled (NON dry-run server only) ─────────────────────────────
    @pytest.mark.no_dry_run
    def test_13_invite_email_disabled_400(self):
        ev = self._create()
        # disable email in the test DB
        prev = self.s.get(f"{BASE}/api/settings/email").json()
        self.s.post(f"{BASE}/api/settings/email", json={
            "sender_name": "T", "sender_email": "", "gmail_app_password": "", "enabled": False})
        try:
            r = self._invite(ev["event_id"])
            assert r.status_code == 400
        finally:
            self.s.post(f"{BASE}/api/settings/email", json=prev)
