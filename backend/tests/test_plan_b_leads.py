import os, uuid, requests, pytest
BASE = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")

def _login():
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/login", json={"email": "info@smartshape.in", "password": "admin123"})
    assert r.status_code == 200, r.text
    return s

class TestConvertWithIntro:
    @pytest.fixture(autouse=True)
    def setup(self):
        self.s = _login()
        self.contact_id = None
        self.lead_id = None
        yield
        if self.lead_id:
            self.s.delete(f"{BASE}/api/leads/{self.lead_id}")
        if self.contact_id:
            self.s.delete(f"{BASE}/api/contacts/{self.contact_id}")

    def test_convert_returns_lead_and_marks_contact(self):
        uid = uuid.uuid4().hex[:8]
        c = self.s.post(f"{BASE}/api/contacts", json={
            "name": f"TEST_Conv_{uid}", "phone": "9000000020", "email": f"t{uid}@x.com"})
        self.contact_id = c.json()["contact_id"]
        r = self.s.post(f"{BASE}/api/contacts/{self.contact_id}/convert-to-lead", json={
            "lead_type": "warm", "priority": "medium",
            "intro_message": "Hi, thanks for your interest in SmartShape!"})
        assert r.status_code == 200, r.text
        lead = r.json()
        assert lead.get("lead_id")
        self.lead_id = lead["lead_id"]
        assert lead.get("converted_from_contact") == self.contact_id
