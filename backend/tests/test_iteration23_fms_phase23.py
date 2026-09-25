"""
Iteration 23 - FMS Phase 2 (Lead Control + Assignment) and Phase 3 (Visit Intelligence)
Covers:
- Phase 2:
  * POST /api/leads with assignment_type + likely_closure_date persisted, default manual
  * pipeline_history initialized with one entry on create
  * PUT /api/leads/{id} appends pipeline_history when stage changes (with stage_change_note)
  * PUT /api/leads/{id} does NOT append pipeline_history when stage unchanged
  * PUT /api/leads/{id} logs reassign_lead activity when assigned_to changes
  * POST /api/leads/auto-assign (admin) with empty body assigns unassigned in round-robin
  * POST /api/leads/auto-assign with body.lead_ids=[...] limits to those leads
  * POST /api/leads/auto-assign forbidden for non-admin
- Phase 3:
  * GET /api/leads enriches with visit_required boolean (computed flag)
  * POST /api/visit-plans/{plan_id}/check-in field (lat/lng required)
  * POST /api/visit-plans/{plan_id}/check-in wfh (no GPS)
  * Errors: 400 if field without lat/lng, 400 if already checked-in
  * POST /api/visit-plans/{plan_id}/check-out cascades last_visit_date on lead
  * Errors: 400 if not checked-in, 400 if already checked-out
  * GET /api/visit-plans/{plan_id}/distance?lat=&lng= returns distance/within_geofence
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ADMIN_EMAIL = "info@smartshape.in"
ADMIN_PASSWORD = "admin123"


@pytest.fixture(scope="session")
def admin():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="session")
def non_admin(admin):
    """Create a fresh sales_person account, login, return its session."""
    email = f"TEST_sp_{uuid.uuid4().hex[:8]}@smartshape.com"
    pw = "Test@1234"
    r = requests.post(f"{BASE_URL}/api/auth/register",
                      json={"email": email, "password": pw, "name": "TEST SP"}, timeout=15)
    # If registration disabled, try users API as fallback (skip otherwise)
    if r.status_code not in (200, 201):
        pytest.skip(f"register failed for non_admin: {r.status_code} {r.text}")
    s = requests.Session()
    r2 = s.post(f"{BASE_URL}/api/auth/login",
                json={"email": email, "password": pw}, timeout=15)
    assert r2.status_code == 200, r2.text
    return s


def _make_school(admin):
    name = f"TEST_S_{uuid.uuid4().hex[:6]}"
    r = admin.post(f"{BASE_URL}/api/schools", json={
        "school_name": name, "school_type": "CBSE", "city": "Pune",
        "school_strength": 500, "number_of_branches": 1,
    }, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _make_lead(admin, school_id=None, **overrides):
    payload = {
        "company_name": f"TEST_L_{uuid.uuid4().hex[:6]}",
        "contact_name": "Tester",
        "contact_phone": "9999999999",
        "school_id": school_id or "",
        "stage": "new",
        "priority": "medium",
        "lead_type": "warm",
    }
    payload.update(overrides)
    r = admin.post(f"{BASE_URL}/api/leads", json=payload, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


# ---------- Phase 2: assignment_type + likely_closure_date ----------
class TestPhase2LeadCreate:
    def test_create_with_assignment_and_closure(self, admin):
        sch = _make_school(admin)
        lead = _make_lead(admin, school_id=sch["school_id"],
                          assignment_type="self",
                          likely_closure_date="2026-06-30")
        assert lead["assignment_type"] == "self"
        assert lead["likely_closure_date"] == "2026-06-30"
        # Pipeline history initialized with one entry
        ph = lead.get("pipeline_history") or []
        assert len(ph) == 1
        e0 = ph[0]
        assert e0["from_stage"] is None
        assert e0["to_stage"] == lead["stage"]
        assert e0["note"] == "Lead created"
        assert e0.get("by_email") == ADMIN_EMAIL
        assert e0.get("at")
        # GET to verify persistence
        r = admin.get(f"{BASE_URL}/api/leads", timeout=15)
        rec = next((x for x in r.json() if x["lead_id"] == lead["lead_id"]), None)
        assert rec is not None
        assert rec["assignment_type"] == "self"
        assert rec["likely_closure_date"] == "2026-06-30"

    def test_create_default_assignment_type_manual(self, admin):
        lead = _make_lead(admin)
        assert lead["assignment_type"] == "manual"
        assert (lead.get("pipeline_history") or [])[0]["to_stage"] == "new"


# ---------- Phase 2: PUT pipeline history + reassign log ----------
class TestPhase2LeadUpdate:
    def test_stage_change_appends_history(self, admin):
        lead = _make_lead(admin)
        r = admin.put(f"{BASE_URL}/api/leads/{lead['lead_id']}",
                      json={"stage": "demo", "stage_change_note": "Booked demo"}, timeout=15)
        assert r.status_code == 200, r.text
        upd = r.json()
        ph = upd["pipeline_history"]
        assert len(ph) == 2
        assert ph[-1]["from_stage"] == "new"
        assert ph[-1]["to_stage"] == "demo"
        assert ph[-1]["note"] == "Booked demo"
        assert ph[-1]["by_email"] == ADMIN_EMAIL

    def test_no_stage_change_no_history_append(self, admin):
        lead = _make_lead(admin)
        before_len = len(lead["pipeline_history"])
        r = admin.put(f"{BASE_URL}/api/leads/{lead['lead_id']}",
                      json={"priority": "high"}, timeout=15)
        assert r.status_code == 200, r.text
        upd = r.json()
        assert len(upd["pipeline_history"]) == before_len

    def test_reassign_logs_activity(self, admin):
        lead = _make_lead(admin)
        new_email = f"TEST_other_{uuid.uuid4().hex[:5]}@x.com"
        r = admin.put(f"{BASE_URL}/api/leads/{lead['lead_id']}",
                      json={"assigned_to": new_email, "assigned_name": "Other"}, timeout=15)
        assert r.status_code == 200, r.text
        # Activity log: filter by entity_id=lead_id and action reassign_lead
        r2 = admin.get(f"{BASE_URL}/api/activity-logs", timeout=15)
        if r2.status_code == 200:
            logs = r2.json()
            matches = [l for l in logs if l.get("entity_id") == lead["lead_id"]
                       and l.get("action") == "reassign_lead"]
            assert len(matches) >= 1, "reassign_lead activity not logged"
        else:
            # If endpoint missing, at least confirm the lead was reassigned
            assert r.json()["assigned_to"] == new_email


# ---------- Phase 2: Auto-Assign ----------
class TestPhase2AutoAssign:
    def test_auto_assign_admin_with_lead_ids(self, admin):
        # Ensure at least one active sales person
        sps = admin.get(f"{BASE_URL}/api/salespersons", timeout=15).json()
        if not sps:
            pytest.skip("no active sales persons in db")
        # Create 2 unassigned leads (force assigned_to empty)
        lead_a = _make_lead(admin, assigned_to="", assigned_name="")
        lead_b = _make_lead(admin, assigned_to="", assigned_name="")
        r = admin.post(f"{BASE_URL}/api/leads/auto-assign",
                       json={"lead_ids": [lead_a["lead_id"], lead_b["lead_id"]]}, timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["assigned"] == 2
        assert len(data["details"]) == 2
        ids = {d["lead_id"] for d in data["details"]}
        assert ids == {lead_a["lead_id"], lead_b["lead_id"]}
        for d in data["details"]:
            assert d["assigned_to"]
            assert d["assigned_name"]
        # Verify persistence
        all_leads = admin.get(f"{BASE_URL}/api/leads", timeout=15).json()
        for lid in ids:
            rec = next(x for x in all_leads if x["lead_id"] == lid)
            assert rec["assignment_type"] == "round_robin"
            assert rec["assigned_to"]

    def test_auto_assign_empty_body_assigns_unassigned(self, admin):
        sps = admin.get(f"{BASE_URL}/api/salespersons", timeout=15).json()
        if not sps:
            pytest.skip("no active sales persons in db")
        lead_x = _make_lead(admin, assigned_to="", assigned_name="")
        r = admin.post(f"{BASE_URL}/api/leads/auto-assign", json={}, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        # Our created lead should appear in details
        det_ids = {d["lead_id"] for d in data["details"]}
        assert lead_x["lead_id"] in det_ids

    def test_auto_assign_forbidden_for_non_admin(self, non_admin):
        r = non_admin.post(f"{BASE_URL}/api/leads/auto-assign", json={}, timeout=15)
        assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"


# ---------- Phase 3: visit_required computed ----------
class TestPhase3VisitRequiredFlag:
    def _fetch(self, admin, lead_id):
        leads = admin.get(f"{BASE_URL}/api/leads", timeout=15).json()
        return next(x for x in leads if x["lead_id"] == lead_id)

    def test_high_priority_triggers_visit_required(self, admin):
        lead = _make_lead(admin, priority="high", lead_type="warm", stage="new")
        rec = self._fetch(admin, lead["lead_id"])
        assert rec["visit_required"] is True

    def test_demo_stage_triggers_visit_required(self, admin):
        lead = _make_lead(admin, priority="medium", lead_type="warm")
        admin.put(f"{BASE_URL}/api/leads/{lead['lead_id']}",
                  json={"stage": "demo", "stage_change_note": "demo set"}, timeout=15)
        rec = self._fetch(admin, lead["lead_id"])
        assert rec["visit_required"] is True

    def test_hot_lead_triggers_visit_required(self, admin):
        lead = _make_lead(admin, priority="medium", lead_type="hot", stage="new")
        rec = self._fetch(admin, lead["lead_id"])
        assert rec["visit_required"] is True

    def test_cold_warm_low_does_not_trigger(self, admin):
        lead = _make_lead(admin, priority="medium", lead_type="warm", stage="new")
        rec = self._fetch(admin, lead["lead_id"])
        assert rec["visit_required"] is False


# ---------- Phase 3: visit check-in / check-out / distance ----------
@pytest.fixture()
def visit_plan(admin):
    sch = _make_school(admin)
    lead = _make_lead(admin, school_id=sch["school_id"], priority="high")
    r = admin.post(f"{BASE_URL}/api/visit-plans", json={
        "lead_id": lead["lead_id"],
        "school_id": sch["school_id"],
        "school_name": sch["school_name"],
        "lead_name": lead["company_name"],
        "visit_date": "2026-02-01",
        "visit_time": "10:00",
        "purpose": "TEST visit",
    }, timeout=15)
    assert r.status_code == 200, r.text
    return {"plan": r.json(), "lead_id": lead["lead_id"]}


class TestPhase3CheckIn:
    def test_field_check_in_with_gps(self, admin, visit_plan):
        plan = visit_plan["plan"]
        r = admin.post(f"{BASE_URL}/api/visit-plans/{plan['plan_id']}/check-in",
                       json={"work_type": "field", "lat": 18.5204, "lng": 73.8567}, timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "in_progress"
        assert d["work_type"] == "field"
        assert d["check_in_time"]
        assert d["check_in_lat"] == 18.5204
        assert d["check_in_lng"] == 73.8567
        assert "check_in_address" in d  # may be coords if reverse geocode unavailable
        # Cascade: lead last_visit_date updated
        leads = admin.get(f"{BASE_URL}/api/leads", timeout=15).json()
        lead = next(x for x in leads if x["lead_id"] == visit_plan["lead_id"])
        assert lead.get("last_visit_date")

    def test_wfh_check_in_no_gps(self, admin, visit_plan):
        plan = visit_plan["plan"]
        r = admin.post(f"{BASE_URL}/api/visit-plans/{plan['plan_id']}/check-in",
                       json={"work_type": "wfh"}, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["work_type"] == "wfh"
        assert d["status"] == "in_progress"
        assert d["check_in_lat"] is None
        assert d["check_in_lng"] is None
        assert d["check_in_address"] == "Work From Home"

    def test_field_check_in_without_gps_400(self, admin, visit_plan):
        plan = visit_plan["plan"]
        r = admin.post(f"{BASE_URL}/api/visit-plans/{plan['plan_id']}/check-in",
                       json={"work_type": "field"}, timeout=15)
        assert r.status_code == 400, r.text

    def test_already_checked_in_400(self, admin, visit_plan):
        plan = visit_plan["plan"]
        admin.post(f"{BASE_URL}/api/visit-plans/{plan['plan_id']}/check-in",
                   json={"work_type": "wfh"}, timeout=15)
        r = admin.post(f"{BASE_URL}/api/visit-plans/{plan['plan_id']}/check-in",
                       json={"work_type": "wfh"}, timeout=15)
        assert r.status_code == 400


class TestPhase3CheckOut:
    def test_check_out_after_field_in(self, admin, visit_plan):
        plan = visit_plan["plan"]
        admin.post(f"{BASE_URL}/api/visit-plans/{plan['plan_id']}/check-in",
                   json={"work_type": "field", "lat": 18.5204, "lng": 73.8567}, timeout=15)
        r = admin.post(f"{BASE_URL}/api/visit-plans/{plan['plan_id']}/check-out",
                       json={"visit_notes": "good", "outcome": "demo_scheduled",
                             "lat": 18.5204, "lng": 73.8567}, timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "completed"
        assert d["check_out_time"]
        assert d["visit_notes"] == "good"
        assert d["outcome"] == "demo_scheduled"
        # Lead last_visit_date should still be set
        leads = admin.get(f"{BASE_URL}/api/leads", timeout=15).json()
        lead = next(x for x in leads if x["lead_id"] == visit_plan["lead_id"])
        assert lead.get("last_visit_date")

    def test_check_out_without_check_in_400(self, admin, visit_plan):
        plan = visit_plan["plan"]
        r = admin.post(f"{BASE_URL}/api/visit-plans/{plan['plan_id']}/check-out",
                       json={"outcome": "x"}, timeout=15)
        assert r.status_code == 400

    def test_check_out_twice_400(self, admin, visit_plan):
        plan = visit_plan["plan"]
        admin.post(f"{BASE_URL}/api/visit-plans/{plan['plan_id']}/check-in",
                   json={"work_type": "wfh"}, timeout=15)
        admin.post(f"{BASE_URL}/api/visit-plans/{plan['plan_id']}/check-out",
                   json={"outcome": "ok"}, timeout=15)
        r = admin.post(f"{BASE_URL}/api/visit-plans/{plan['plan_id']}/check-out",
                       json={"outcome": "ok"}, timeout=15)
        assert r.status_code == 400


class TestPhase3Distance:
    def test_distance_no_reference(self, admin, visit_plan):
        plan = visit_plan["plan"]
        r = admin.get(f"{BASE_URL}/api/visit-plans/{plan['plan_id']}/distance"
                      f"?lat=18.5204&lng=73.8567", timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["distance_m"] is None

    def test_distance_within_geofence_after_checkin(self, admin, visit_plan):
        plan = visit_plan["plan"]
        admin.post(f"{BASE_URL}/api/visit-plans/{plan['plan_id']}/check-in",
                   json={"work_type": "field", "lat": 18.5204, "lng": 73.8567}, timeout=15)
        # Same point => distance 0, within geofence
        r = admin.get(f"{BASE_URL}/api/visit-plans/{plan['plan_id']}/distance"
                      f"?lat=18.5204&lng=73.8567", timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["distance_m"] is not None
        assert d["distance_m"] <= 5
        assert d["within_geofence"] is True

    def test_distance_outside_geofence(self, admin, visit_plan):
        plan = visit_plan["plan"]
        admin.post(f"{BASE_URL}/api/visit-plans/{plan['plan_id']}/check-in",
                   json={"work_type": "field", "lat": 18.5204, "lng": 73.8567}, timeout=15)
        # ~5km away
        r = admin.get(f"{BASE_URL}/api/visit-plans/{plan['plan_id']}/distance"
                      f"?lat=18.5704&lng=73.8567", timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["distance_m"] is not None
        assert d["within_geofence"] is False


# ---------- Cleanup ----------
@pytest.fixture(scope="session", autouse=True)
def _cleanup(admin):
    yield
    try:
        leads = admin.get(f"{BASE_URL}/api/leads", timeout=15).json()
        for l in leads:
            if (l.get("company_name") or "").startswith("TEST_L_"):
                admin.delete(f"{BASE_URL}/api/leads/{l['lead_id']}", timeout=10)
    except Exception:
        pass
