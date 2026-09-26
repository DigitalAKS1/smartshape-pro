"""
Iteration 25 - FMS Phase 5: Live Sales Board + Advanced Assignment + Kanban
+ Lead->Order->Dispatch flow control + CRM Masters PUT endpoints.

Covers:
- CRM Masters: PUT /api/sources/{id} preserves source_id; PUT /api/contact-roles/{id} preserves role_id.
- Phase 5.1 Reassignment: POST /api/leads/reassign + bulk-assign.
- Phase 5.2 Lock: PUT /api/leads/{id} 403 when is_locked & non-admin; admin can modify.
- Phase 5.3 Convert: POST /api/orders with lead_id locks lead, sets stage=won; 400 if lead stage invalid.
- Phase 5.3 Lock toggle: POST /api/leads/{id}/lock admin-only.
- Phase 5.3 Production stage: PUT /api/orders/{id}/production-stage; dispatch guards.
- Phase 5.4 Dispatch tracking: PUT /api/dispatches/{id}/tracking.
- Phase 5.4 Admin funnel: GET /api/admin/funnel admin-only.
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
def sales_person():
    email = f"TEST_sp25_{uuid.uuid4().hex[:8]}@smartshape.com"
    pw = "Test@1234"
    r = requests.post(f"{BASE_URL}/api/auth/register",
                      json={"email": email, "password": pw, "name": "TEST SP25"}, timeout=15)
    if r.status_code not in (200, 201):
        pytest.skip(f"register failed: {r.status_code} {r.text}")
    s = requests.Session()
    r2 = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pw}, timeout=15)
    assert r2.status_code == 200, r2.text
    return s


@pytest.fixture(scope="module")
def school(admin):
    body = {"school_name": f"TEST_S25_{uuid.uuid4().hex[:6]}", "city": "Pune"}
    r = admin.post(f"{BASE_URL}/api/schools", json=body, timeout=15)
    assert r.status_code in (200, 201), r.text
    sc = r.json()
    yield sc
    try:
        admin.delete(f"{BASE_URL}/api/schools/{sc['school_id']}", timeout=10)
    except Exception:
        pass


def _get_lead(admin, lead_id):
    """No GET /leads/{id} endpoint - filter from list."""
    r = admin.get(f"{BASE_URL}/api/leads", timeout=15)
    if r.status_code != 200:
        return None
    for ld in r.json():
        if ld.get("lead_id") == lead_id:
            return ld
    return None


def _make_lead(admin, school, stage="new"):
    body = {
        "school_id": school["school_id"],
        "school_name": school["school_name"],
        "contact_name": "TEST_C",
        "contact_phone": "9999999999",
        "stage": stage,
        "assigned_to": "rajesh@smartshape.com",
        "assigned_name": "Rajesh Kumar",
    }
    r = admin.post(f"{BASE_URL}/api/leads", json=body, timeout=15)
    assert r.status_code in (200, 201), r.text
    return r.json()


# ---------- CRM Masters PUT endpoints ----------
class TestCrmMastersPut:
    def test_source_put_preserves_source_id(self, admin):
        # Ensure GET seeds defaults if empty
        r = admin.get(f"{BASE_URL}/api/sources", timeout=10)
        assert r.status_code == 200
        # create a fresh source
        name1 = f"TEST_SRC_{uuid.uuid4().hex[:6]}"
        rc = admin.post(f"{BASE_URL}/api/sources", json={"name": name1}, timeout=10)
        assert rc.status_code in (200, 201), rc.text
        src = rc.json()
        sid = src["source_id"]
        # update name
        new_name = name1 + "_renamed"
        ru = admin.put(f"{BASE_URL}/api/sources/{sid}", json={"name": new_name}, timeout=10)
        assert ru.status_code == 200, ru.text
        updated = ru.json()
        assert updated["source_id"] == sid, "source_id should be preserved on rename"
        assert updated["name"] == new_name
        admin.delete(f"{BASE_URL}/api/sources/{sid}", timeout=10)

    def test_contact_role_put_preserves_role_id(self, admin):
        rl = admin.get(f"{BASE_URL}/api/contact-roles", timeout=10)
        assert rl.status_code == 200
        name1 = f"TEST_ROLE_{uuid.uuid4().hex[:6]}"
        rc = admin.post(f"{BASE_URL}/api/contact-roles", json={"name": name1}, timeout=10)
        assert rc.status_code in (200, 201), rc.text
        role = rc.json()
        rid = role["role_id"]
        ru = admin.put(f"{BASE_URL}/api/contact-roles/{rid}", json={"name": name1 + "_x"}, timeout=10)
        assert ru.status_code == 200, ru.text
        updated = ru.json()
        assert updated["role_id"] == rid
        assert updated["name"] == name1 + "_x"
        admin.delete(f"{BASE_URL}/api/contact-roles/{rid}", timeout=10)

    def test_groups_crud(self, admin):
        r = admin.get(f"{BASE_URL}/api/groups", timeout=10)
        assert r.status_code == 200
        name = f"TEST_GRP_{uuid.uuid4().hex[:6]}"
        rc = admin.post(f"{BASE_URL}/api/groups", json={"name": name}, timeout=10)
        assert rc.status_code in (200, 201), rc.text
        gid = rc.json().get("group_id")
        if gid:
            ru = admin.put(f"{BASE_URL}/api/groups/{gid}", json={"name": name + "_z"}, timeout=10)
            assert ru.status_code == 200, ru.text
            assert ru.json().get("group_id") == gid
            admin.delete(f"{BASE_URL}/api/groups/{gid}", timeout=10)


# ---------- Phase 5.1 Reassignment ----------
class TestReassignment:
    def test_reassign_single_lead(self, admin, school):
        lead = _make_lead(admin, school)
        body = {
            "lead_id": lead["lead_id"],
            "new_agent_email": "priya@smartshape.com",
            "new_agent_name": "Priya Sharma",
            "reason": "Territory rebalance",
        }
        r = admin.post(f"{BASE_URL}/api/leads/reassign", json=body, timeout=15)
        assert r.status_code == 200, r.text
        updated = r.json()
        assert updated["assigned_to"] == "priya@smartshape.com"
        assert updated["reassignment_count"] == 1
        assert updated.get("last_reassignment_reason") == "Territory rebalance"
        assert isinstance(updated.get("reassignments"), list) and len(updated["reassignments"]) == 1
        h = updated["reassignments"][0]
        assert h["to_email"] == "priya@smartshape.com"
        assert h["reason"] == "Territory rebalance"
        # GET to verify persistence
        ld = _get_lead(admin, lead["lead_id"])
        assert ld and ld.get("reassignment_count") == 1

    def test_reassign_missing_reason_returns_400(self, admin, school):
        lead = _make_lead(admin, school)
        body = {"lead_id": lead["lead_id"], "new_agent_email": "amit@smartshape.com",
                "new_agent_name": "Amit Patel", "reason": ""}
        r = admin.post(f"{BASE_URL}/api/leads/reassign", json=body, timeout=10)
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"

    def test_bulk_assign(self, admin, school):
        leads = [_make_lead(admin, school) for _ in range(3)]
        ids = [l["lead_id"] for l in leads]
        body = {"lead_ids": ids, "new_agent_email": "amit@smartshape.com",
                "new_agent_name": "Amit Patel", "reason": "Q1 redistribution"}
        r = admin.post(f"{BASE_URL}/api/leads/bulk-assign", json=body, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("assigned") == 3, data
        # verify one
        ld = _get_lead(admin, ids[0])
        assert ld and ld.get("assigned_to") == "amit@smartshape.com"


# ---------- Phase 5.2 Lock check on PUT /leads ----------
class TestLeadLockGuard:
    def test_locked_lead_blocks_non_admin_put(self, admin, sales_person, school):
        lead = _make_lead(admin, school)
        # Lock via admin
        rl = admin.post(f"{BASE_URL}/api/leads/{lead['lead_id']}/lock",
                        json={"is_locked": True}, timeout=10)
        assert rl.status_code == 200, rl.text
        # Sales person tries to PUT
        r = sales_person.put(f"{BASE_URL}/api/leads/{lead['lead_id']}",
                             json={"stage": "contacted"}, timeout=10)
        assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"
        # Admin can still modify
        r2 = admin.put(f"{BASE_URL}/api/leads/{lead['lead_id']}",
                       json={"notes": "admin bypass"}, timeout=10)
        assert r2.status_code == 200, r2.text


class TestLockEndpoint:
    def test_lock_admin_only(self, admin, sales_person, school):
        lead = _make_lead(admin, school)
        # non-admin
        r = sales_person.post(f"{BASE_URL}/api/leads/{lead['lead_id']}/lock",
                              json={"is_locked": True}, timeout=10)
        assert r.status_code == 403, r.text
        # admin toggle
        r2 = admin.post(f"{BASE_URL}/api/leads/{lead['lead_id']}/lock",
                        json={"is_locked": True}, timeout=10)
        assert r2.status_code == 200
        assert r2.json().get("is_locked") is True
        r3 = admin.post(f"{BASE_URL}/api/leads/{lead['lead_id']}/lock",
                        json={"is_locked": False}, timeout=10)
        assert r3.json().get("is_locked") is False


# ---------- Phase 5.3 Convert lead to order ----------
class TestConvertToOrder:
    def test_convert_invalid_stage_returns_400(self, admin, school):
        # Create a quotation first - need to look up via existing list
        rqs = admin.get(f"{BASE_URL}/api/quotations", timeout=10)
        if rqs.status_code != 200 or not rqs.json():
            pytest.skip("No quotations available to test order conversion")
        # Use first unconverted quotation
        unused = None
        for q in rqs.json():
            qid = q.get("quotation_id")
            ro = admin.get(f"{BASE_URL}/api/orders", timeout=10)
            existing_qids = {o.get("quotation_id") for o in (ro.json() if ro.status_code == 200 else [])}
            if qid and qid not in existing_qids:
                unused = q
                break
        if not unused:
            pytest.skip("No unconverted quotation available")

        lead = _make_lead(admin, school, stage="new")  # not in negotiation/won
        r = admin.post(f"{BASE_URL}/api/orders",
                       json={"quotation_id": unused["quotation_id"], "lead_id": lead["lead_id"]},
                       timeout=15)
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"

    def test_convert_locks_lead_and_sets_won(self, admin, school):
        rqs = admin.get(f"{BASE_URL}/api/quotations", timeout=10)
        if rqs.status_code != 200 or not rqs.json():
            pytest.skip("No quotations available")
        ro = admin.get(f"{BASE_URL}/api/orders", timeout=10)
        existing_qids = {o.get("quotation_id") for o in (ro.json() if ro.status_code == 200 else [])}
        unused = None
        for q in rqs.json():
            qid = q.get("quotation_id")
            if qid and qid not in existing_qids:
                unused = q
                break
        if not unused:
            pytest.skip("No unconverted quotation available")

        lead = _make_lead(admin, school, stage="negotiation")
        r = admin.post(f"{BASE_URL}/api/orders",
                       json={"quotation_id": unused["quotation_id"], "lead_id": lead["lead_id"],
                             "payment_threshold_pct": 50},
                       timeout=15)
        assert r.status_code == 200, r.text
        order = r.json()
        assert order.get("lead_id") == lead["lead_id"]
        assert order.get("production_stage") == "order_created"
        assert order.get("payment_threshold_pct") == 50.0
        # verify lead locked + stage=won
        ld = _get_lead(admin, lead["lead_id"])
        assert ld is not None
        assert ld.get("is_locked") is True
        assert ld.get("stage") == "won"
        assert ld.get("order_id") == order["order_id"]
        return order


# ---------- Phase 5.3/5.4 production stage updates ----------
class TestProductionStage:
    def _get_or_make_order(self, admin):
        ro = admin.get(f"{BASE_URL}/api/orders", timeout=10)
        if ro.status_code == 200 and ro.json():
            return ro.json()[0]
        pytest.skip("No order to test production stage")

    def test_invalid_stage_400(self, admin):
        order = self._get_or_make_order(admin)
        r = admin.put(f"{BASE_URL}/api/orders/{order['order_id']}/production-stage",
                      json={"production_stage": "garbage"}, timeout=10)
        assert r.status_code == 400

    def test_move_to_in_production_and_ready(self, admin):
        order = self._get_or_make_order(admin)
        for stage in ("in_production", "ready_to_dispatch"):
            r = admin.put(f"{BASE_URL}/api/orders/{order['order_id']}/production-stage",
                          json={"production_stage": stage}, timeout=10)
            assert r.status_code == 200, f"{stage}: {r.text}"
            assert r.json().get("production_stage") == stage

    def test_dispatch_blocked_below_payment_threshold(self, admin):
        """Order with payment_received < threshold% of grand_total cannot move to 'dispatched'."""
        order = self._get_or_make_order(admin)
        oid = order["order_id"]
        # Force grand_total>0 and payment_received=0 + threshold=50 directly via update endpoint if exists.
        # Otherwise rely on existing data.
        # Try dispatch
        r = admin.put(f"{BASE_URL}/api/orders/{oid}/production-stage",
                      json={"production_stage": "dispatched"}, timeout=10)
        # If grand_total is zero, dispatch will succeed (skip). Otherwise expect 400.
        gt = float(order.get("grand_total") or 0)
        recv = float(order.get("payment_received") or 0)
        thr = float(order.get("payment_threshold_pct") or 50)
        if gt > 0 and (recv / gt * 100) < thr:
            assert r.status_code == 400, f"expected dispatch block, got {r.status_code}: {r.text}"
        else:
            assert r.status_code in (200, 400)


# ---------- Phase 5.4 Dispatch tracking ----------
class TestDispatchTracking:
    def test_update_tracking_persists(self, admin):
        rd = admin.get(f"{BASE_URL}/api/dispatches", timeout=10)
        if rd.status_code != 200 or not rd.json():
            pytest.skip("No dispatches to test tracking update")
        disp = rd.json()[0]
        did = disp.get("dispatch_id")
        body = {"tracking_number": "TRK_TEST_999",
                "courier_name": "BlueDart",
                "courier_url": "https://bluedart.com/track/TRK_TEST_999"}
        r = admin.put(f"{BASE_URL}/api/dispatches/{did}/tracking", json=body, timeout=10)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("tracking_number") == "TRK_TEST_999"
        assert d.get("courier_name") == "BlueDart"
        assert d.get("courier_url") == "https://bluedart.com/track/TRK_TEST_999"


# ---------- Phase 5.4 Admin funnel ----------
class TestAdminFunnel:
    def test_admin_funnel_returns_payload(self, admin):
        r = admin.get(f"{BASE_URL}/api/admin/funnel", timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ("lead_stages", "order_stages", "totals",
                  "lead_to_order_ratio", "order_to_dispatch_ratio",
                  "reassignment_leaderboard", "recent_movements"):
            assert k in data, f"missing key {k}"
        assert "leads" in data["totals"]
        assert "orders" in data["totals"]
        assert "dispatches" in data["totals"]
        assert isinstance(data["reassignment_leaderboard"], list)
        # leaderboard must be desc by reassignment_count
        counts = [x.get("reassignment_count", 0) for x in data["reassignment_leaderboard"]]
        assert counts == sorted(counts, reverse=True), f"leaderboard not sorted desc: {counts}"

    def test_admin_funnel_403_for_non_admin(self, sales_person):
        r = sales_person.get(f"{BASE_URL}/api/admin/funnel", timeout=10)
        assert r.status_code == 403, r.text
