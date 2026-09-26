import os, uuid, requests, pytest
BASE = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")

def _login():
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/login", json={"email": "info@smartshape.in", "password": "admin123"})
    assert r.status_code == 200, r.text
    return s

class TestPhysicalDripStep:
    @pytest.fixture(autouse=True)
    def setup(self):
        self.s = _login(); self.seq_id = None
        yield
        if self.seq_id:
            self.s.delete(f"{BASE}/api/drip/sequences/{self.seq_id}")

    def test_sequence_stores_physical_step(self):
        uid = uuid.uuid4().hex[:8]
        r = self.s.post(f"{BASE}/api/drip/sequences", json={
            "name": f"TEST_Drip_{uid}", "trigger": "manual", "is_active": False,
            "steps": [{"step_number": 1, "delay_days": 0,
                "message_type": "physical_material", "material_type": "brochure",
                "message_template": "Ship a brochure"}]})
        assert r.status_code == 200, r.text
        self.seq_id = r.json()["sequence_id"]
        seqs = self.s.get(f"{BASE}/api/drip/sequences").json()
        seq = next(x for x in seqs if x["sequence_id"] == self.seq_id)
        step = seq["steps"][0]
        assert step["message_type"] == "physical_material"
        assert step["material_type"] == "brochure"

class TestDripPhysicalHelper:
    @pytest.fixture(autouse=True)
    def setup(self):
        self.s = _login(); self.lead_id = None
        yield
        if self.lead_id:
            self.s.delete(f"{BASE}/api/leads/{self.lead_id}")

    def test_helper_creates_pending_dispatch(self):
        uid = uuid.uuid4().hex[:8]
        r = self.s.post(f"{BASE}/api/leads", json={
            "company_name": f"TEST_DripP_{uid}", "contact_name": "T",
            "contact_phone": "9000000030", "stage": "contacted"})
        self.lead_id = r.json()["lead_id"]
        t = self.s.post(f"{BASE}/api/drip/_test-fire-physical", json={
            "lead_id": self.lead_id, "material_type": "sample", "seq_name": "TEST seq"})
        assert t.status_code == 200, t.text
        disp = self.s.get(f"{BASE}/api/physical-dispatches", params={"lead_id": self.lead_id}).json()
        assert any(d.get("material_type") == "sample" and d.get("auto_from_drip") for d in disp)
