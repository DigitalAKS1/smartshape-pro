"""Collaborative calendar events tests. Live test server; self-cleaning ('EvtTest')."""
import os, uuid
import pytest, requests
BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


class TestEvents:
    @pytest.fixture(autouse=True)
    def setup(self):
        self.s = requests.Session()
        self.s.headers.update({"Content-Type": "application/json"})
        r = self.s.post(f"{BASE_URL}/api/auth/login", json={"email": "info@smartshape.in", "password": "admin123"})
        assert r.status_code == 200, r.text
        tok = self.s.cookies.get("access_token")
        if tok:
            self.s.headers.update({"Authorization": f"Bearer {tok}"})
        self.s.post(f"{BASE_URL}/api/delegation/sync-users", json={})
        emps = self.s.get(f"{BASE_URL}/api/delegation/employees").json()
        self.admin = next(e for e in emps if e.get("email") == "info@smartshape.in")
        self._evts = []
        yield
        for eid in self._evts:
            try:
                self.s.delete(f"{BASE_URL}/api/delegation/events/{eid}")
            except Exception:
                pass

    def _create(self, **over):
        body = {"title": f"EvtTest {uuid.uuid4().hex[:6]}", "date": "2026-12-20",
                "start_time": "10:00", "end_time": "11:00"}
        body.update(over)
        r = self.s.post(f"{BASE_URL}/api/delegation/events", json=body)
        if r.status_code == 200:
            self._evts.append(r.json()["event_id"])
        return r

    def test_01_create_adds_creator_and_shows_in_agenda(self):
        r = self._create()
        assert r.status_code == 200, r.text
        ev = r.json()
        assert any(c["email"] == "info@smartshape.in" and c["response"] == "accepted" for c in ev["collaborators"])
        ag = self.s.get(f"{BASE_URL}/api/delegation/agenda", params={"from": "2026-12-01", "to": "2026-12-31"}).json()
        mine = next((e for e in ag["events"] if e["source"] == "event" and e["entity_id"] == ev["event_id"]), None)
        assert mine and "edit" in mine["actions"] and mine["start_time"] == "10:00"
        print("✓ create adds creator + shows in agenda")

    def test_02_validation(self):
        assert self.s.post(f"{BASE_URL}/api/delegation/events", json={"date": "2026-12-20", "title": ""}).status_code == 400
        assert self.s.post(f"{BASE_URL}/api/delegation/events", json={"title": "x"}).status_code == 400
        assert self._create(start_time="11:00", end_time="10:00").status_code == 400
        print("✓ validation 400s")

    def test_03_collaborator_sees_via_teamview(self):
        emp = self.s.post(f"{BASE_URL}/api/delegation/employees", json={
            "name": "EvtTest Collab", "roles": ["delegatee"], "email": f"evt{uuid.uuid4().hex[:6]}@x.com"}).json()
        try:
            ev = self._create(collaborator_emp_ids=[emp["emp_id"]]).json()
            ag = self.s.get(f"{BASE_URL}/api/delegation/agenda",
                            params={"from": "2026-12-01", "to": "2026-12-31", "emp_id": emp["emp_id"]}).json()
            found = next((e for e in ag["events"] if e["source"] == "event" and e["entity_id"] == ev["event_id"]), None)
            assert found and "respond" in found["actions"]
        finally:
            self.s.delete(f"{BASE_URL}/api/delegation/employees/{emp['emp_id']}")
        print("✓ collaborator sees event (team-view) with respond action")

    def test_04_external_email_collaborator(self):
        ev = self._create(collaborator_emails=["client@abc.edu"]).json()
        assert any(c["type"] == "email" and c["email"] == "client@abc.edu" for c in ev["collaborators"])
        print("✓ external email collaborator stored")

    def test_05_cancel_removes_from_agenda(self):
        ev = self._create().json()
        assert self.s.delete(f"{BASE_URL}/api/delegation/events/{ev['event_id']}").status_code == 200
        ag = self.s.get(f"{BASE_URL}/api/delegation/agenda", params={"from": "2026-12-01", "to": "2026-12-31"}).json()
        assert not any(e["entity_id"] == ev["event_id"] for e in ag["events"])
        self._evts.remove(ev["event_id"])
        print("✓ cancel removes from agenda")
