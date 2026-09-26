"""
Delegation task-update + instance soft-edit tests (Part 1).
Runs against a live backend; logs in as admin.

SAFETY: every task created here is tracked and archived (DELETE) in teardown,
so the suite cleans up after itself even against a shared/production DB.
All test tasks use far-future dates and a 'PlanTest' title prefix.
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


class TestDelegationUpdate:
    @pytest.fixture(autouse=True)
    def setup(self):
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        r = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "info@smartshape.in", "password": "admin123"})
        assert r.status_code == 200, f"Login failed: {r.text}"

        # Login sets an httponly (possibly Secure) cookie; over plain http the
        # cookie jar won't auto-resend it, so attach it as a Bearer header.
        token = self.session.cookies.get("access_token")
        if token:
            self.session.headers.update({"Authorization": f"Bearer {token}"})

        # Ensure at least two delegation employees exist (sync from users)
        self.session.post(f"{BASE_URL}/api/delegation/sync-users", json={})
        emps = self.session.get(f"{BASE_URL}/api/delegation/employees").json()
        assert len(emps) >= 2, "Need >=2 delegation employees for these tests"
        self.emps = emps
        self._created = []        # task_ids to clean up

        yield

        # teardown — archive every task we created
        for tid in self._created:
            try:
                self.session.delete(f"{BASE_URL}/api/delegation/tasks/{tid}")
            except Exception:
                pass

    # ── helpers ───────────────────────────────────────────────────────────
    def _create_task(self, **over):
        body = {
            "title": f"PlanTest {uuid.uuid4().hex[:6]}",
            "description": "", "task_type": "onetime",
            "target_date": "2026-12-01", "priority": "medium",
            "assignee_ids": [self.emps[0]["emp_id"]],
            "delegator_id": self.emps[0]["emp_id"],
            "require_verification": False, "requires_image": False, "score": 0,
        }
        body.update(over)
        r = self.session.post(f"{BASE_URL}/api/delegation/tasks", json=body)
        assert r.status_code == 200, f"create failed: {r.text}"
        task = r.json()
        self._created.append(task["task_id"])
        return task

    def _instances(self, task_id):
        return self.session.get(
            f"{BASE_URL}/api/delegation/instances",
            params={"task_id": task_id}).json()

    # ── tests ─────────────────────────────────────────────────────────────
    def test_01_update_title_propagates_to_pending_instances(self):
        task = self._create_task()
        tid = task["task_id"]
        r = self.session.put(f"{BASE_URL}/api/delegation/tasks/{tid}",
                             json={"title": "Renamed Task", "priority": "high"})
        assert r.status_code == 200, r.text
        assert r.json()["title"] == "Renamed Task"
        insts = self._instances(tid)
        assert insts, "should still have an instance"
        assert all(i["task_title"] == "Renamed Task" for i in insts)
        assert all(i["priority"] == "high" for i in insts)
        print("✓ title/priority edit propagated to pending instances")

    def test_02_add_assignee_creates_instance(self):
        task = self._create_task()
        tid = task["task_id"]
        before = self._instances(tid)
        assert len(before) == 1
        r = self.session.put(
            f"{BASE_URL}/api/delegation/tasks/{tid}",
            json={"assignee_ids": [self.emps[0]["emp_id"], self.emps[1]["emp_id"]]})
        assert r.status_code == 200, r.text
        after = self._instances(tid)
        emp_ids = {i["emp_id"] for i in after}
        assert self.emps[1]["emp_id"] in emp_ids, "added assignee should get an instance"
        assert len(after) == 2
        print("✓ adding an assignee creates a pending instance")

    def test_03_remove_assignee_deletes_pending_instance(self):
        task = self._create_task(
            assignee_ids=[self.emps[0]["emp_id"], self.emps[1]["emp_id"]])
        tid = task["task_id"]
        assert len(self._instances(tid)) == 2
        r = self.session.put(
            f"{BASE_URL}/api/delegation/tasks/{tid}",
            json={"assignee_ids": [self.emps[0]["emp_id"]]})
        assert r.status_code == 200, r.text
        after = self._instances(tid)
        assert len(after) == 1
        assert after[0]["emp_id"] == self.emps[0]["emp_id"]
        print("✓ removing an assignee deletes their pending instance")

    def test_04_completed_instance_is_preserved_on_assignee_removal(self):
        task = self._create_task(
            assignee_ids=[self.emps[0]["emp_id"], self.emps[1]["emp_id"]])
        tid = task["task_id"]
        # complete emp[1]'s instance
        insts = self._instances(tid)
        target = next(i for i in insts if i["emp_id"] == self.emps[1]["emp_id"])
        c = self.session.post(
            f"{BASE_URL}/api/delegation/instances/{target['instance_id']}/complete",
            json={"note": "done"})
        assert c.status_code == 200, c.text
        # now remove emp[1] from the task
        r = self.session.put(
            f"{BASE_URL}/api/delegation/tasks/{tid}",
            json={"assignee_ids": [self.emps[0]["emp_id"]]})
        assert r.status_code == 200, r.text
        after = self._instances(tid)
        kept = [i for i in after if i["emp_id"] == self.emps[1]["emp_id"]]
        assert len(kept) == 1 and kept[0]["status"] in ("completed", "verified"), \
            "completed instance must be preserved for history"
        print("✓ completed instance preserved when assignee removed")

    def test_05_patch_instance_soft_edit_logs_change(self):
        task = self._create_task()
        tid = task["task_id"]
        inst = self._instances(tid)[0]
        iid = inst["instance_id"]
        r = self.session.patch(
            f"{BASE_URL}/api/delegation/instances/{iid}",
            json={"due_date": "2026-12-15", "priority": "low",
                  "completion_note": "rescheduled"})
        assert r.status_code == 200, r.text
        out = r.json()
        assert out["due_date"] == "2026-12-15"
        assert out["priority"] == "low"
        assert isinstance(out.get("change_log"), list) and len(out["change_log"]) >= 2
        fields = {c["field"] for c in out["change_log"]}
        assert "due_date" in fields and "priority" in fields
        print("✓ PATCH soft-edit applied and change_log recorded")

    def test_06_patch_instance_noop_when_unchanged(self):
        task = self._create_task()
        inst = self._instances(task["task_id"])[0]
        iid = inst["instance_id"]
        r = self.session.patch(
            f"{BASE_URL}/api/delegation/instances/{iid}",
            json={"priority": inst["priority"]})
        assert r.status_code == 200, r.text
        assert not r.json().get("change_log"), "unchanged value must not log"
        print("✓ PATCH no-op when value unchanged")

    def test_07_patch_missing_instance_404(self):
        r = self.session.patch(
            f"{BASE_URL}/api/delegation/instances/nope_123",
            json={"priority": "low"})
        assert r.status_code == 404
        print("✓ PATCH unknown instance returns 404")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
