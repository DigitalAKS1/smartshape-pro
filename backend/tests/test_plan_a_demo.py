import os, uuid, requests, pytest
BASE = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")

def _login():
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/login", json={"email": "info@smartshape.in", "password": "admin123"})
    assert r.status_code == 200, r.text
    return s

class TestScheduleDemoPhysical:
    @pytest.fixture(autouse=True)
    def setup(self):
        self.s = _login()
        self.lead_id = None
        self.plan_id = None
        yield
        if self.plan_id:
            self.s.delete(f"{BASE}/api/visit-plans/{self.plan_id}")
        if self.lead_id:
            self.s.delete(f"{BASE}/api/leads/{self.lead_id}")

    def test_physical_demo_creates_visit_plan(self):
        uid = uuid.uuid4().hex[:8]
        r = self.s.post(f"{BASE}/api/leads", json={
            "company_name": f"TEST_Demo_{uid}", "contact_name": "T",
            "contact_phone": "9000000010", "stage": "contacted"})
        self.lead_id = r.json()["lead_id"]
        d = self.s.post(f"{BASE}/api/leads/{self.lead_id}/schedule-demo", json={
            "format": "physical", "demo_date": "2026-07-01", "demo_time": "11:00",
            "address": "School campus, Noida", "purpose": "Robotics workshop demo"})
        assert d.status_code == 200, d.text
        lead = d.json()
        assert lead["stage"] == "demo"
        assert lead["demo_format"] == "physical"
        assert lead["demo_visit_plan_id"]
        self.plan_id = lead["demo_visit_plan_id"]
        plans = self.s.get(f"{BASE}/api/visit-plans").json()
        plan = next(p for p in plans if p["plan_id"] == self.plan_id)
        assert plan["lead_id"] == self.lead_id
        assert plan["visit_date"] == "2026-07-01"
        assert plan["status"] == "planned"


class TestScheduleDemoOnline:
    @pytest.fixture(autouse=True)
    def setup(self):
        self.s = _login()
        self.lead_id = None
        yield
        if self.lead_id:
            self.s.delete(f"{BASE}/api/leads/{self.lead_id}")

    def test_online_demo_stores_link_no_visit(self):
        uid = uuid.uuid4().hex[:8]
        r = self.s.post(f"{BASE}/api/leads", json={
            "company_name": f"TEST_DemoO_{uid}", "contact_name": "T",
            "contact_phone": "9000000011", "stage": "contacted"})
        self.lead_id = r.json()["lead_id"]
        d = self.s.post(f"{BASE}/api/leads/{self.lead_id}/schedule-demo", json={
            "format": "online", "demo_date": "2026-07-02", "demo_time": "16:00",
            "demo_link": "https://meet.example.com/abc"})
        assert d.status_code == 200, d.text
        lead = d.json()
        assert lead["stage"] == "demo"
        assert lead["demo_format"] == "online"
        assert lead["demo_link"] == "https://meet.example.com/abc"
        assert not lead.get("demo_visit_plan_id")
