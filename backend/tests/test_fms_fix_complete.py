"""Integration tests for FMS fix-and-complete. Backend must be running.
Run from backend/:  python -m pytest tests/test_fms_fix_complete.py -v
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8000").rstrip("/")
ADMIN_EMAIL = "info@smartshape.in"
ADMIN_PASSWORD = "admin123"


@pytest.fixture(scope="session")
def admin():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    # Force-set secure cookies so they are sent over plain HTTP (test environment only)
    for cookie in r.cookies:
        s.cookies.set(cookie.name, cookie.value, domain=cookie.domain or "127.0.0.1",
                      path=cookie.path or "/")
    return s


@pytest.fixture(scope="session")
def sales(admin):
    """Fresh sales_person session (default role on register)."""
    email = f"TEST_fms_sp_{uuid.uuid4().hex[:8]}@smartshape.com"
    pw = "Test@1234"
    r = admin.post(f"{BASE_URL}/api/auth/register",
                   json={"email": email, "password": pw, "name": "TEST FMS SP", "role": "sales_person"}, timeout=15)
    if r.status_code not in (200, 201):
        pytest.skip(f"register failed: {r.status_code} {r.text}")
    s = requests.Session()
    r2 = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pw}, timeout=15)
    assert r2.status_code == 200, r2.text
    for cookie in r2.cookies:
        s.cookies.set(cookie.name, cookie.value, domain=cookie.domain or "127.0.0.1",
                      path=cookie.path or "/")
    return s


def _make_flow(admin, **overrides):
    body = {
        "flow_type": "order",
        "title": f"TEST_FLOW_{uuid.uuid4().hex[:6]}",
        "customer_name": "Test Customer",
        "customer_phone": "9999900000",
        "amount": 50000,
    }
    body.update(overrides)
    r = admin.post(f"{BASE_URL}/api/fms/flows", json=body, timeout=20)
    assert r.status_code in (200, 201), r.text
    return r.json()


def _first_active_stage(flow):
    for s in flow["stages"]:
        if s["status"] == "active":
            return s
    return flow["stages"][0]


class TestAuditLog:
    def test_flow_creation_logs_and_complete_logs(self, admin):
        flow = _make_flow(admin)
        fid = flow["flow_id"]
        stage = _first_active_stage(flow)
        # complete first stage (crm_confirm, no approval)
        r = admin.post(f"{BASE_URL}/api/fms/stages/{stage['stage_id']}/complete",
                       json={"note": "done by test"}, timeout=15)
        assert r.status_code == 200, r.text
        logs = admin.get(f"{BASE_URL}/api/fms/flows/{fid}/logs", timeout=15)
        assert logs.status_code == 200, logs.text
        actions = [l["action"] for l in logs.json()]
        assert "created" in actions
        assert "completed" in actions


class TestReject:
    def test_reject_keeps_rejected_and_adds_redo(self, admin):
        flow = _make_flow(admin)
        fid = flow["flow_id"]
        # qc_check (order 2) needs approval; advance to it by completing the two before it
        # Complete stage order 0 and 1 (crm_confirm, inventory_check)
        def reget():
            return admin.get(f"{BASE_URL}/api/fms/flows/{fid}", timeout=15).json()
        f = flow
        for _ in range(3):
            st = _first_active_stage(f)
            if st["key"] == "qc_check":
                break
            admin.post(f"{BASE_URL}/api/fms/stages/{st['stage_id']}/complete", json={}, timeout=15)
            f = reget()
        # qc_check completed -> pending_approval, then reject
        st = _first_active_stage(f)
        assert st["key"] == "qc_check", f"expected qc_check, got {st['key']}"
        admin.post(f"{BASE_URL}/api/fms/stages/{st['stage_id']}/complete", json={}, timeout=15)
        rr = admin.post(f"{BASE_URL}/api/fms/stages/{st['stage_id']}/reject",
                        json={"reason": "bad sample"}, timeout=15)
        assert rr.status_code == 200, rr.text
        f = reget()
        stages = f["stages"]
        rejected = [s for s in stages if s["stage_id"] == st["stage_id"]][0]
        assert rejected["status"] == "rejected", rejected
        assert rejected.get("reject_reason") == "bad sample"
        # a redo stage exists, active, same order
        redo = [s for s in stages if s.get("key", "").endswith("_redo") and s["order"] == st["order"]]
        assert redo and redo[0]["status"] == "active", stages


class TestRbacMasking:
    def test_sales_cannot_see_amount_or_phone(self, admin, sales):
        flow = _make_flow(admin, amount=77777, customer_phone="9123456789")
        fid = flow["flow_id"]
        # admin sees full
        af = admin.get(f"{BASE_URL}/api/fms/flows/{fid}", timeout=15).json()
        assert af.get("amount") == 77777
        assert af.get("customer_phone") == "9123456789"
        # sales sees masked
        sf = sales.get(f"{BASE_URL}/api/fms/flows/{fid}", timeout=15)
        assert sf.status_code == 200, sf.text
        d = sf.json()
        assert not d.get("amount"), f"amount leaked to sales: {d.get('amount')}"
        assert not d.get("customer_phone"), f"phone leaked to sales: {d.get('customer_phone')}"


class TestStageEditLock:
    def test_sales_cannot_complete_store_stage(self, admin, sales):
        flow = _make_flow(admin)
        fid = flow["flow_id"]
        # advance to inventory_check (team=store)
        st = _first_active_stage(flow)  # crm_confirm (team=sales)
        admin.post(f"{BASE_URL}/api/fms/stages/{st['stage_id']}/complete", json={}, timeout=15)
        f = admin.get(f"{BASE_URL}/api/fms/flows/{fid}", timeout=15).json()
        store_stage = _first_active_stage(f)
        assert store_stage["team"] == "store", store_stage
        # sales user tries to complete a store stage -> 403
        r = sales.post(f"{BASE_URL}/api/fms/stages/{store_stage['stage_id']}/complete",
                       json={}, timeout=15)
        assert r.status_code == 403, r.text


class TestSettings:
    def test_settings_have_notification_defaults(self, admin):
        r = admin.get(f"{BASE_URL}/api/fms/settings", timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "notify_warning_pct" in d and "notify_escalate_pct" in d
        assert "templates" in d and "staff_warning" in d["templates"]
        assert "notify_channels" in d

    def test_settings_persist_thresholds(self, admin):
        r = admin.put(f"{BASE_URL}/api/fms/settings",
                      json={"notify_warning_pct": 0.6}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["notify_warning_pct"] == 0.6
        # restore
        admin.put(f"{BASE_URL}/api/fms/settings", json={"notify_warning_pct": 0.5}, timeout=15)


class TestNotificationDedupe:
    def test_breach_notifications_dedupe(self, admin):
        # Create a flow, then seed its first stage as OVERDUE directly in the DB so the
        # test is independent of office-hours TAT / time-of-day. Assign to the admin
        # email so the email channel resolves a recipient (records 'sent' in dry-run).
        # Requires DB_NAME=smartshape_test in the pytest env (matches the test backend).
        import asyncio
        from datetime import datetime, timezone, timedelta
        from database import db

        flow = _make_flow(admin, title="TEST breach", customer_phone="9000000000")
        fid = flow["flow_id"]
        stage = _first_active_stage(flow)
        sid = stage["stage_id"]

        now = datetime.now(timezone.utc)
        async def _seed():
            await db.fms_stages.update_one({"stage_id": sid}, {"$set": {
                "status": "active",
                "assigned_to": "info@smartshape.in",
                "plan_start": (now - timedelta(hours=2)).isoformat(),
                "plan_done": (now - timedelta(hours=1)).isoformat(),
            }})
        asyncio.run(_seed())

        # Two SLA passes via the debug endpoint (Task 9b)
        r1 = admin.post(f"{BASE_URL}/api/fms/_run-sla?dry=1", timeout=120)
        assert r1.status_code == 200, r1.text
        r2 = admin.post(f"{BASE_URL}/api/fms/_run-sla?dry=1", timeout=120)
        assert r2.status_code == 200, r2.text

        notifs = admin.get(f"{BASE_URL}/api/fms/_notifications/{fid}", timeout=30).json()
        seen = {}
        for n in notifs:
            if n["status"] != "sent":
                continue
            k = (n["stage_id"], n["kind"], n["channel"])
            seen[k] = seen.get(k, 0) + 1
        assert seen, f"expected at least one 'sent' notification, got: {notifs}"
        assert all(v == 1 for v in seen.values()), f"dedupe failed: {seen}"


class TestCustomerNotify:
    def test_dispatch_completion_records_customer_notification(self, admin):
        flow = _make_flow(admin, customer_phone="9000011111")
        fid = flow["flow_id"]
        # advance to dispatch stage, completing/approving as needed
        def reget(): return admin.get(f"{BASE_URL}/api/fms/flows/{fid}", timeout=15).json()
        f = flow
        for _ in range(8):
            st = _first_active_stage(f)
            if st["key"] == "dispatch":
                break
            # QC stage needs approval flow
            admin.post(f"{BASE_URL}/api/fms/stages/{st['stage_id']}/complete", json={}, timeout=15)
            f = reget()
            st2 = next((s for s in f["stages"] if s["status"] == "pending_approval"), None)
            if st2:
                admin.post(f"{BASE_URL}/api/fms/stages/{st2['stage_id']}/approve", json={}, timeout=15)
                f = reget()
        st = _first_active_stage(f)
        assert st["key"] == "dispatch", f"did not reach dispatch: {st['key']}"
        admin.post(f"{BASE_URL}/api/fms/stages/{st['stage_id']}/complete", json={}, timeout=15)
        notifs = admin.get(f"{BASE_URL}/api/fms/_notifications/{fid}", timeout=15).json()
        cust = [n for n in notifs if n["kind"] == "customer_stage"]
        assert cust, f"no customer notification recorded: {notifs}"


class TestPauseResume:
    def test_pause_then_resume_shifts_deadline(self, admin):
        flow = _make_flow(admin)
        fid = flow["flow_id"]
        st = _first_active_stage(flow)
        before = admin.get(f"{BASE_URL}/api/fms/flows/{fid}", timeout=15).json()
        pd_before = next(s for s in before["stages"] if s["stage_id"] == st["stage_id"])["plan_done"]
        # pause
        rp = admin.post(f"{BASE_URL}/api/fms/stages/{st['stage_id']}/pause",
                        json={"reason": "waiting on customer"}, timeout=15)
        assert rp.status_code == 200, rp.text
        paused = admin.get(f"{BASE_URL}/api/fms/flows/{fid}", timeout=15).json()
        ps = next(s for s in paused["stages"] if s["stage_id"] == st["stage_id"])
        assert ps["status"] == "paused"
        # resume
        rr = admin.post(f"{BASE_URL}/api/fms/stages/{st['stage_id']}/resume", json={}, timeout=15)
        assert rr.status_code == 200, rr.text
        after = admin.get(f"{BASE_URL}/api/fms/flows/{fid}", timeout=15).json()
        sa = next(s for s in after["stages"] if s["stage_id"] == st["stage_id"])
        assert sa["status"] == "active"
        assert sa["plan_done"] >= pd_before, "deadline should not move earlier after resume"
        assert sa.get("paused_intervals"), "paused interval not recorded"
