"""
Phase 1 CRM integration tests: pipeline settings, deal value, lost reason,
forecast, funnel, needs-attention.

SAFETY: hits a live backend, which points at the production DB. Every test
creates TEST_-prefixed leads and deletes them in teardown; the settings test
snapshots and restores the crm_pipeline settings doc. Run only against a
backend you are comfortable writing throwaway test rows into.

Run:  cd backend && python -m pytest tests/test_crm_phase1.py -v
"""
import os
import uuid
import requests
import pytest

BASE = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")


def _login():
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/login",
               json={"email": "info@smartshape.in", "password": "admin123"})
    assert r.status_code == 200, f"login failed: {r.text}"
    return s


class TestPipelineSettings:
    @pytest.fixture(autouse=True)
    def setup(self):
        self.s = _login()
        self.original = self.s.get(f"{BASE}/api/pipeline-settings").json()
        yield
        # restore original settings
        self.s.put(f"{BASE}/api/pipeline-settings", json=self.original)

    def test_get_defaults(self):
        r = self.s.get(f"{BASE}/api/pipeline-settings")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["stage_probabilities"]["negotiation"] == 70
        assert d["stage_idle_limits"]["negotiation"] == 3
        assert "Price" in d["lost_reasons"]
        assert d["digest_enabled"] is False

    def test_put_merges(self):
        r = self.s.put(f"{BASE}/api/pipeline-settings", json={
            "stage_probabilities": {"negotiation": 80}, "digest_time": "09:30"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["stage_probabilities"]["negotiation"] == 80
        assert d["stage_probabilities"]["new"] == 10   # default preserved
        assert d["digest_time"] == "09:30"


class TestLeadValueEnrichment:
    @pytest.fixture(autouse=True)
    def setup(self):
        self.s = _login()
        self.lead_id = None
        yield
        if self.lead_id:
            self.s.delete(f"{BASE}/api/leads/{self.lead_id}")

    def test_expected_value_drives_weighted(self):
        uid = uuid.uuid4().hex[:8]
        r = self.s.post(f"{BASE}/api/leads", json={
            "company_name": f"TEST_Val_{uid}", "contact_name": "T",
            "contact_phone": "9000000000", "stage": "negotiation",
            "expected_value": 100000})
        assert r.status_code == 200, r.text
        self.lead_id = r.json()["lead_id"]
        leads = self.s.get(f"{BASE}/api/leads").json()
        lead = next(l for l in leads if l["lead_id"] == self.lead_id)
        assert lead["deal_value"] == 100000
        assert lead["weighted_value"] == 70000   # negotiation default prob 70%


class TestLostReason:
    @pytest.fixture(autouse=True)
    def setup(self):
        self.s = _login()
        self.lead_id = None
        yield
        if self.lead_id:
            self.s.delete(f"{BASE}/api/leads/{self.lead_id}")

    def test_lost_requires_reason(self):
        uid = uuid.uuid4().hex[:8]
        r = self.s.post(f"{BASE}/api/leads", json={
            "company_name": f"TEST_Lost_{uid}", "contact_name": "T",
            "contact_phone": "9000000001", "stage": "negotiation"})
        self.lead_id = r.json()["lead_id"]
        r1 = self.s.put(f"{BASE}/api/leads/{self.lead_id}", json={"stage": "lost"})
        assert r1.status_code == 400, r1.text
        r2 = self.s.put(f"{BASE}/api/leads/{self.lead_id}", json={
            "stage": "lost", "lost_reason": "Price", "lost_reason_note": "too high"})
        assert r2.status_code == 200, r2.text
        assert r2.json()["lost_reason"] == "Price"


class TestForecast:
    @pytest.fixture(autouse=True)
    def setup(self):
        self.s = _login()
        self.lead_id = None
        yield
        if self.lead_id:
            self.s.delete(f"{BASE}/api/leads/{self.lead_id}")

    def test_forecast_shape_and_weighting(self):
        uid = uuid.uuid4().hex[:8]
        r = self.s.post(f"{BASE}/api/leads", json={
            "company_name": f"TEST_Fc_{uid}", "contact_name": "T",
            "contact_phone": "9000000002", "stage": "quoted", "expected_value": 50000})
        self.lead_id = r.json()["lead_id"]
        f = self.s.get(f"{BASE}/api/leads/forecast")
        assert f.status_code == 200, f.text
        d = f.json()
        assert "total_value" in d and "total_weighted" in d
        assert "by_stage" in d and "by_rep" in d
        quoted = d["by_stage"]["quoted"]
        assert quoted["count"] >= 1
        assert quoted["value"] >= 50000
        assert quoted["weighted"] >= 25000   # quoted prob 50%


class TestFunnel:
    @pytest.fixture(autouse=True)
    def setup(self):
        self.s = _login()
        yield

    def test_funnel_shape(self):
        f = self.s.get(f"{BASE}/api/leads/funnel")
        assert f.status_code == 200, f.text
        d = f.json()
        assert "stages" in d and isinstance(d["stages"], list)
        assert {"stage", "count", "advanced_pct", "avg_days"} <= set(d["stages"][0].keys())
        assert "won" in d and "lost" in d
        assert "lost_reasons" in d and isinstance(d["lost_reasons"], dict)


class TestNeedsAttention:
    @pytest.fixture(autouse=True)
    def setup(self):
        self.s = _login()
        self.lead_id = None
        yield
        if self.lead_id:
            self.s.delete(f"{BASE}/api/leads/{self.lead_id}")

    def test_overdue_and_no_action_flag(self):
        uid = uuid.uuid4().hex[:8]
        r = self.s.post(f"{BASE}/api/leads", json={
            "company_name": f"TEST_NA_{uid}", "contact_name": "T",
            "contact_phone": "9000000003", "stage": "contacted",
            "next_followup_date": "2020-01-01"})
        self.lead_id = r.json()["lead_id"]
        a = self.s.get(f"{BASE}/api/leads/needs-attention")
        assert a.status_code == 200, a.text
        rows = a.json()
        mine = next((x for x in rows if x["lead_id"] == self.lead_id), None)
        assert mine is not None, "overdue lead should be flagged"
        assert "overdue" in mine["reasons"]
        assert "no_next_action" in mine["reasons"]
