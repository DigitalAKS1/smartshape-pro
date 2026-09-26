"""
Delegation reassignment-with-approval + notifications tests (Part 2).
Runs against a live backend; logs in as admin (a 'boss', so it can approve).
Test tasks use a 'ReTest' title prefix; tasks are archived in teardown and
the residual request/notification docs are cleaned by a DB script after the run.
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


class TestDelegationReassign:
    @pytest.fixture(autouse=True)
    def setup(self):
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        r = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "info@smartshape.in", "password": "admin123"})
        assert r.status_code == 200, f"Login failed: {r.text}"
        token = self.session.cookies.get("access_token")
        if token:
            self.session.headers.update({"Authorization": f"Bearer {token}"})

        self.session.post(f"{BASE_URL}/api/delegation/sync-users", json={})
        emps = self.session.get(f"{BASE_URL}/api/delegation/employees").json()
        assert isinstance(emps, list) and len(emps) >= 2, "Need >=2 delegation employees"
        self.emps = emps
        self._created = []

        yield

        for tid in self._created:
            try:
                self.session.delete(f"{BASE_URL}/api/delegation/tasks/{tid}")
            except Exception:
                pass

    # ── helpers ───────────────────────────────────────────────────────────
    def _create_task(self, assignee_idx=0):
        body = {
            "title": f"ReTest {uuid.uuid4().hex[:6]}",
            "task_type": "onetime", "target_date": "2026-12-01", "priority": "medium",
            "assignee_ids": [self.emps[assignee_idx]["emp_id"]],
            "delegator_id": self.emps[0]["emp_id"],
        }
        r = self.session.post(f"{BASE_URL}/api/delegation/tasks", json=body)
        assert r.status_code == 200, r.text
        task = r.json()
        self._created.append(task["task_id"])
        return task

    def _instance(self, task_id):
        return self.session.get(f"{BASE_URL}/api/delegation/instances",
                                params={"task_id": task_id}).json()[0]

    def _request(self, instance_id, to_emp_id, reason="cover for leave"):
        return self.session.post(
            f"{BASE_URL}/api/delegation/instances/{instance_id}/reassign-request",
            json={"to_emp_id": to_emp_id, "reason": reason})

    # ── tests ─────────────────────────────────────────────────────────────
    def test_01_request_requires_reason(self):
        inst = self._instance(self._create_task()["task_id"])
        r = self.session.post(
            f"{BASE_URL}/api/delegation/instances/{inst['instance_id']}/reassign-request",
            json={"to_emp_id": self.emps[1]["emp_id"], "reason": "  "})
        assert r.status_code == 400
        print("✓ empty reason rejected (400)")

    def test_02_request_to_current_owner_rejected(self):
        task = self._create_task(assignee_idx=0)
        inst = self._instance(task["task_id"])
        r = self._request(inst["instance_id"], self.emps[0]["emp_id"])
        assert r.status_code == 400
        print("✓ reassigning to current owner rejected (400)")

    def test_03_request_creates_pending_and_notifies(self):
        task = self._create_task(assignee_idx=0)
        inst = self._instance(task["task_id"])
        r = self._request(inst["instance_id"], self.emps[1]["emp_id"])
        assert r.status_code == 200, r.text
        req = r.json()
        assert req["status"] == "pending"
        assert req["to_emp_id"] == self.emps[1]["emp_id"]
        # appears in the approvals inbox (admin is boss → sees all)
        inbox = self.session.get(f"{BASE_URL}/api/delegation/reassign-requests",
                                 params={"status": "pending"}).json()
        assert any(x["request_id"] == req["request_id"] for x in inbox)
        print("✓ request created, pending, visible in inbox")

    def test_04_approve_moves_owner_and_increments_count(self):
        task = self._create_task(assignee_idx=0)
        inst = self._instance(task["task_id"])
        req = self._request(inst["instance_id"], self.emps[1]["emp_id"]).json()
        d = self.session.post(
            f"{BASE_URL}/api/delegation/reassign-requests/{req['request_id']}/decide",
            json={"decision": "approved"})
        assert d.status_code == 200, d.text
        assert d.json()["status"] == "approved"
        moved = self._instance(task["task_id"])
        assert moved["emp_id"] == self.emps[1]["emp_id"], "owner should have moved"
        assert moved.get("reassignment_count", 0) >= 1
        assert any(c["field"] == "emp_id" for c in moved.get("change_log", []))
        print("✓ approval moved owner + logged + incremented count")

    def test_05_reject_keeps_owner(self):
        task = self._create_task(assignee_idx=0)
        inst = self._instance(task["task_id"])
        req = self._request(inst["instance_id"], self.emps[1]["emp_id"]).json()
        d = self.session.post(
            f"{BASE_URL}/api/delegation/reassign-requests/{req['request_id']}/decide",
            json={"decision": "rejected", "note": "keep as is"})
        assert d.status_code == 200, d.text
        assert d.json()["status"] == "rejected"
        same = self._instance(task["task_id"])
        assert same["emp_id"] == self.emps[0]["emp_id"], "owner should be unchanged"
        print("✓ rejection keeps original owner")

    def test_06_decide_twice_rejected(self):
        task = self._create_task(assignee_idx=0)
        inst = self._instance(task["task_id"])
        req = self._request(inst["instance_id"], self.emps[1]["emp_id"]).json()
        self.session.post(
            f"{BASE_URL}/api/delegation/reassign-requests/{req['request_id']}/decide",
            json={"decision": "approved"})
        again = self.session.post(
            f"{BASE_URL}/api/delegation/reassign-requests/{req['request_id']}/decide",
            json={"decision": "approved"})
        assert again.status_code == 400
        print("✓ deciding an already-decided request returns 400")

    def test_07_request_on_completed_instance_rejected(self):
        task = self._create_task(assignee_idx=0)
        inst = self._instance(task["task_id"])
        self.session.post(
            f"{BASE_URL}/api/delegation/instances/{inst['instance_id']}/complete",
            json={"note": "done"})
        r = self._request(inst["instance_id"], self.emps[1]["emp_id"])
        assert r.status_code == 400
        print("✓ reassign request on completed instance rejected (400)")

    def test_08_notifications_listed_and_readable(self):
        # admin/boss receives the 'reassign_requested' notification it triggered
        task = self._create_task(assignee_idx=0)
        inst = self._instance(task["task_id"])
        self._request(inst["instance_id"], self.emps[1]["emp_id"])
        notifs = self.session.get(f"{BASE_URL}/api/delegation/notifications").json()
        assert isinstance(notifs, list)
        mine = [n for n in notifs if "ReTest" in (n.get("body") or "")]
        assert mine, "should have a notification referencing the test task"
        nid = mine[0]["notif_id"]
        rd = self.session.post(f"{BASE_URL}/api/delegation/notifications/{nid}/read")
        assert rd.status_code == 200
        print("✓ notifications listed and markable as read")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
