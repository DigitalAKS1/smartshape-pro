"""
Delegation buddy (backup owner) tests (Part 3).
Admin logs in as a 'boss'; we set the admin's own employee as buddy so the
admin's completion is recorded as a buddy completion. Self-cleaning ('BudTest').
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


class TestDelegationBuddy:
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
        # the admin's own delegation employee (acts as buddy in tests)
        self.admin_emp = next(
            (e for e in emps if e.get("email") == "info@smartshape.in"), None)
        assert self.admin_emp, "admin must have a synced delegation employee"
        # an owner that is NOT the admin
        self.other = next(e for e in emps if e["emp_id"] != self.admin_emp["emp_id"])
        self._created = []

        yield

        for tid in self._created:
            try:
                self.session.delete(f"{BASE_URL}/api/delegation/tasks/{tid}")
            except Exception:
                pass

    def _create(self, owner_id, buddy_id=""):
        body = {
            "title": f"BudTest {uuid.uuid4().hex[:6]}",
            "task_type": "onetime", "target_date": "2026-12-01",
            "assignee_ids": [owner_id], "buddy_emp_id": buddy_id,
            "delegator_id": self.admin_emp["emp_id"],
        }
        r = self.session.post(f"{BASE_URL}/api/delegation/tasks", json=body)
        assert r.status_code == 200, r.text
        t = r.json()
        self._created.append(t["task_id"])
        return t

    def _instance(self, task_id):
        return self.session.get(f"{BASE_URL}/api/delegation/instances",
                                params={"task_id": task_id}).json()[0]

    def test_01_buddy_fields_on_instance(self):
        t = self._create(self.other["emp_id"], self.admin_emp["emp_id"])
        inst = self._instance(t["task_id"])
        assert inst["buddy_emp_id"] == self.admin_emp["emp_id"]
        assert inst["buddy_name"] == self.admin_emp["name"]
        print("✓ buddy id/name stored on instance")

    def test_02_filter_instances_by_buddy(self):
        t = self._create(self.other["emp_id"], self.admin_emp["emp_id"])
        rows = self.session.get(
            f"{BASE_URL}/api/delegation/instances",
            params={"buddy_emp_id": self.admin_emp["emp_id"], "task_id": t["task_id"]}).json()
        assert rows and rows[0]["task_id"] == t["task_id"]
        print("✓ instances filterable by buddy_emp_id")

    def test_03_buddy_completion_marks_completed_by_buddy(self):
        # owner = other; buddy = admin → admin (logged in) completes as buddy
        t = self._create(self.other["emp_id"], self.admin_emp["emp_id"])
        inst = self._instance(t["task_id"])
        c = self.session.post(
            f"{BASE_URL}/api/delegation/instances/{inst['instance_id']}/complete",
            json={"note": "covered"})
        assert c.status_code == 200, c.text
        assert c.json()["completed_by"] == "buddy"
        print("✓ buddy completion recorded as completed_by=buddy")

    def test_04_owner_completion_marks_completed_by_owner(self):
        # owner = admin, no buddy → admin completes as owner
        t = self._create(self.admin_emp["emp_id"], "")
        inst = self._instance(t["task_id"])
        c = self.session.post(
            f"{BASE_URL}/api/delegation/instances/{inst['instance_id']}/complete",
            json={"note": "done"})
        assert c.status_code == 200, c.text
        assert c.json()["completed_by"] == "owner"
        print("✓ owner completion recorded as completed_by=owner")

    def test_05_update_buddy_propagates_to_pending_instance(self):
        t = self._create(self.other["emp_id"], "")
        inst = self._instance(t["task_id"])
        assert not inst.get("buddy_emp_id")
        u = self.session.put(
            f"{BASE_URL}/api/delegation/tasks/{t['task_id']}",
            json={"buddy_emp_id": self.admin_emp["emp_id"]})
        assert u.status_code == 200, u.text
        after = self._instance(t["task_id"])
        assert after["buddy_emp_id"] == self.admin_emp["emp_id"]
        assert after["buddy_name"] == self.admin_emp["name"]
        print("✓ buddy change propagated to pending instance")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
