"""Phase 6 (Mobile/PWA) - Today's Action Dashboard + PWA assets tests."""
import os
from datetime import date, timedelta
import requests
import pytest

BASE = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
ADMIN_EMAIL = "info@smartshape.in"
ADMIN_PASS = "admin123"


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS})
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    return s


# ---- PWA static assets ----
class TestPWAAssets:
    def test_manifest_json(self):
        r = requests.get(f"{BASE}/manifest.json")
        assert r.status_code == 200
        m = r.json()
        assert m["name"] == "SmartShape Pro"
        assert m["short_name"]
        assert m["theme_color"] == "#1a1a2e"
        assert m["display"] == "standalone"
        assert m["start_url"] == "/today"
        assert m["scope"] == "/"
        sizes = [i["sizes"] for i in m["icons"]]
        assert "192x192" in sizes and "512x512" in sizes
        shortcut_urls = [s["url"] for s in m.get("shortcuts", [])]
        for u in ("/today", "/leads", "/visit-planning"):
            assert u in shortcut_urls

    def test_service_worker(self):
        r = requests.get(f"{BASE}/sw.js")
        assert r.status_code == 200
        assert "javascript" in r.headers.get("content-type", "").lower()
        assert len(r.text) > 100

    def test_offline_html(self):
        r = requests.get(f"{BASE}/offline.html")
        assert r.status_code == 200
        assert "html" in r.headers.get("content-type", "").lower()

    def test_icons(self):
        for size, path in (("192", "/icons/icon-192.png"), ("512", "/icons/icon-512.png")):
            r = requests.get(f"{BASE}{path}")
            assert r.status_code == 200
            assert r.headers.get("content-type") == "image/png"
            assert r.content[:8] == b"\x89PNG\r\n\x1a\n"

    def test_index_html_has_pwa_meta(self):
        r = requests.get(f"{BASE}/index.html")
        assert r.status_code == 200
        body = r.text
        assert 'rel="manifest"' in body
        assert 'name="theme-color"' in body
        assert 'apple-mobile-web-app-capable' in body
        assert "serviceWorker" in body and "/sw.js" in body


# ---- Today's Actions endpoint ----
class TestTodayActions:
    def test_get_shape(self, admin_session):
        r = admin_session.get(f"{BASE}/api/today/actions")
        assert r.status_code == 200
        d = r.json()
        for k in ("today", "overdue", "calls_today", "visits_today", "counts", "role"):
            assert k in d, f"missing key {k}"
        for k in ("overdue", "calls_today", "visits_today", "total"):
            assert k in d["counts"]
        assert d["counts"]["total"] == (
            len(d["overdue"]) + len(d["calls_today"]) + len(d["visits_today"])
        )
        assert d["today"] == date.today().isoformat()

    def test_admin_role(self, admin_session):
        r = admin_session.get(f"{BASE}/api/today/actions")
        assert r.json()["role"] == "admin"

    def test_unauthenticated(self):
        r = requests.get(f"{BASE}/api/today/actions")
        assert r.status_code in (401, 403)

    def test_card_meta_fields(self, admin_session):
        d = admin_session.get(f"{BASE}/api/today/actions").json()
        all_cards = d["overdue"] + d["calls_today"] + d["visits_today"]
        if not all_cards:
            pytest.skip("No cards to validate meta")
        sample = all_cards[0]
        for k in ("kind", "school_name", "contact_name", "contact_phone",
                  "stage", "priority", "assigned_name",
                  "due_date", "is_hot"):
            assert k in sample, f"missing meta field: {k}"

    def test_categorization(self, admin_session):
        """Create a lead with today+overdue followups and verify bucketing."""
        today = date.today().isoformat()
        yday = (date.today() - timedelta(days=2)).isoformat()

        # Create 2 test leads
        lead_today = admin_session.post(f"{BASE}/api/leads", json={
            "school_name": "TEST_TODAY_School", "contact_name": "TEST_Today_C",
            "contact_phone": "9999900001", "next_followup_date": today,
            "assigned_to": ADMIN_EMAIL, "lead_type": "hot",
        })
        assert lead_today.status_code in (200, 201), lead_today.text
        lt_id = lead_today.json().get("lead_id")

        lead_over = admin_session.post(f"{BASE}/api/leads", json={
            "school_name": "TEST_OVER_School", "contact_name": "TEST_Over_C",
            "contact_phone": "9999900002", "next_followup_date": yday,
            "assigned_to": ADMIN_EMAIL,
        })
        assert lead_over.status_code in (200, 201)
        lo_id = lead_over.json().get("lead_id")

        d = admin_session.get(f"{BASE}/api/today/actions").json()
        calls_ids = [c["lead_id"] for c in d["calls_today"]]
        overdue_ids = [c["lead_id"] for c in d["overdue"]]
        assert lt_id in calls_ids, f"today lead not in calls_today"
        assert lo_id in overdue_ids, f"overdue lead not in overdue"
        # is_hot
        hot_card = [c for c in d["calls_today"] if c["lead_id"] == lt_id][0]
        assert hot_card["is_hot"] is True

        # Cleanup
        admin_session.delete(f"{BASE}/api/leads/{lt_id}")
        admin_session.delete(f"{BASE}/api/leads/{lo_id}")


# ---- Mark Done ----
class TestTodayMarkDone:
    @pytest.fixture
    def test_lead(self, admin_session):
        today = date.today().isoformat()
        r = admin_session.post(f"{BASE}/api/leads", json={
            "school_name": "TEST_MD_School", "contact_name": "TEST_MD",
            "contact_phone": "9999900010", "next_followup_date": today,
            "assigned_to": ADMIN_EMAIL,
        })
        assert r.status_code in (200, 201)
        lead_id = r.json()["lead_id"]
        yield lead_id
        admin_session.delete(f"{BASE}/api/leads/{lead_id}")

    def test_call_requires_note(self, admin_session, test_lead):
        r = admin_session.post(f"{BASE}/api/today/mark-done", json={
            "kind": "call", "lead_id": test_lead,
            "next_followup_date": (date.today() + timedelta(days=2)).isoformat(),
        })
        assert r.status_code == 400
        assert "note" in r.text.lower()

    def test_call_requires_followup(self, admin_session, test_lead):
        r = admin_session.post(f"{BASE}/api/today/mark-done", json={
            "kind": "call", "lead_id": test_lead, "note": "Called the contact",
        })
        assert r.status_code == 400
        assert "follow" in r.text.lower()

    def test_call_requires_lead_id(self, admin_session):
        r = admin_session.post(f"{BASE}/api/today/mark-done", json={
            "kind": "call", "note": "x",
            "next_followup_date": (date.today() + timedelta(days=1)).isoformat(),
        })
        assert r.status_code == 400

    def test_call_success_and_persistence(self, admin_session, test_lead):
        next_fu = (date.today() + timedelta(days=3)).isoformat()
        r = admin_session.post(f"{BASE}/api/today/mark-done", json={
            "kind": "call", "lead_id": test_lead,
            "note": "Spoke, will revert", "next_followup_date": next_fu,
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert body.get("kind") == "call"
        assert body.get("note_id", "").startswith("cn_")

        # Verify persistence via leads list (individual GET may not exist)
        leads = admin_session.get(f"{BASE}/api/leads").json()
        arr = leads if isinstance(leads, list) else leads.get("leads", [])
        found = next((l for l in arr if l.get("lead_id") == test_lead), None)
        assert found, "lead not found in list"
        assert found.get("next_followup_date") == next_fu
        assert found.get("last_activity_date")

    def test_visit_mark_done(self, admin_session, test_lead):
        # Create a visit plan for today
        today = date.today().isoformat()
        vp = admin_session.post(f"{BASE}/api/visit-plans", json={
            "lead_id": test_lead, "school_name": "TEST_MD_School",
            "visit_date": today, "purpose": "TEST_visit",
            "assigned_to": ADMIN_EMAIL,
        })
        if vp.status_code not in (200, 201):
            pytest.skip(f"visit-plans create not available: {vp.status_code}")
        plan_id = vp.json().get("plan_id")
        assert plan_id

        # Mark done - no followup required for visit
        r = admin_session.post(f"{BASE}/api/today/mark-done", json={
            "kind": "visit", "plan_id": plan_id, "lead_id": test_lead,
            "note": "Visit completed, met principal",
        })
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

        # Verify visit status=completed in feed disappears (filtered out)
        feed = admin_session.get(f"{BASE}/api/today/actions").json()
        visit_plan_ids = [v.get("plan_id") for v in feed["visits_today"]]
        assert plan_id not in visit_plan_ids
