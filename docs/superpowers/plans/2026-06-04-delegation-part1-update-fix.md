# Delegation System — Part 1: Update Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the "tasks won't update" bug by expanding the task-update endpoint to accept all editable fields, propagating edits down to pending instances, adding a delegatee soft-edit endpoint, and shipping the missing Edit Task UI.

**Architecture:** The system separates a task definition (`del_tasks`) from per-person/per-date instances (`del_task_instances`). Editing a task now reconciles its `pending` instances to match the new definition (create added assignee/date instances, delete removed pending ones, propagate field changes) while never touching `completed`/`verified` instances. Delegatees soft-edit their own instance (due date / priority / note) via a new `PATCH /instances` that records a `change_log`.

**Tech Stack:** FastAPI + Motor (MongoDB) backend; React (CRA) frontend with axios `delApi` client; pytest integration tests against a running backend.

---

## Reference — current code

- Task update bug: [backend/routes/delegation_routes.py:433-442](../../../backend/routes/delegation_routes.py#L433-L442)
- Instance generator `_make_instance_v2`: [delegation_routes.py:241-262](../../../backend/routes/delegation_routes.py#L241-L262)
- Recurrence helper `_recurring_dates`: [delegation_routes.py:264-287](../../../backend/routes/delegation_routes.py#L264-L287)
- Helpers `now_iso`, `today_str`, `gen_id`: [delegation_routes.py:21-28](../../../backend/routes/delegation_routes.py#L21-L28)
- API client `delApi`: [frontend/src/lib/api.js:644-664](../../../frontend/src/lib/api.js#L644-L664)
- Hook actions (`updateRow`, `completeInst`): [frontend/src/hooks/useDelegationApp.js:182-245](../../../frontend/src/hooks/useDelegationApp.js#L182-L245)
- Bulk form UI pattern: [frontend/src/components/delegation/DelegationTaskForm.js](../../../frontend/src/components/delegation/DelegationTaskForm.js)

## File Structure (Part 1)

- **Modify** `backend/routes/delegation_routes.py` — expand `PUT /tasks/{id}`, add `_resync_pending_instances`, `_make_change`, `PATCH /instances/{id}`.
- **Create** `backend/tests/test_delegation_update.py` — integration tests for update + propagation + soft-edit.
- **Modify** `frontend/src/lib/api.js` — add `instances.patch`.
- **Create** `frontend/src/components/delegation/EditTaskDialog.js` — edit modal (role-gated fields).
- **Modify** `frontend/src/hooks/useDelegationApp.js` — add `updateTask`, `patchInstance`, edit-dialog state.

## Conventions for this plan

- Backend tests are **integration tests** hitting a live server at `REACT_APP_BACKEND_URL`, logging in as admin (`info@smartshape.in` / `admin123`), following the existing `test_NN_` class style (see [test_orders_holds.py](../../../backend/tests/test_orders_holds.py)).
- Run backend tests with the backend running. Command shown per task.
- Commit after every green step.

---

### Task 1: Add change-log + edit constants helpers (backend)

**Files:**
- Modify: `backend/routes/delegation_routes.py` (helpers block near line 28)

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_delegation_update.py`:

```python
"""
Delegation task-update + instance soft-edit tests (Part 1).
Runs against a live backend; logs in as admin.
"""
import os, uuid
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
        # Ensure at least two delegation employees exist (sync from users)
        self.session.post(f"{BASE_URL}/api/delegation/sync-users", json={})
        emps = self.session.get(f"{BASE_URL}/api/delegation/employees").json()
        assert len(emps) >= 2, "Need >=2 delegation employees for these tests"
        self.emps = emps

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
        return r.json()

    def _instances(self, task_id):
        return self.session.get(
            f"{BASE_URL}/api/delegation/instances",
            params={"task_id": task_id}).json()

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_delegation_update.py::TestDelegationUpdate::test_01_update_title_propagates_to_pending_instances -v`
Expected: FAIL — the PUT updates the task title but instances keep the old `task_title` (no propagation yet).

- [ ] **Step 3: Add helper constants and `_make_change` to delegation_routes.py**

Insert just below `gen_id` (after line 28):

```python
def _make_change(by: str, field: str, frm, to, note: str = "") -> dict:
    """One append-only audit entry for an instance change_log."""
    return {"at": now_iso(), "by": by, "field": field, "from": frm, "to": to, "note": note}


# fields a delegator/boss may edit on a task definition
TASK_EDITABLE = (
    "title", "description", "priority", "score", "require_verification",
    "requires_image", "is_active", "task_type", "frequency",
    "target_date", "start_date", "end_date", "assignee_ids", "buddy_emp_id",
)

# fields a delegatee may soft-edit on their own instance
INSTANCE_SOFT_FIELDS = ("due_date", "priority", "completion_note")
```

- [ ] **Step 4: Run the test again (still fails — propagation not wired yet)**

Run: `cd backend && python -m pytest tests/test_delegation_update.py::TestDelegationUpdate::test_01_update_title_propagates_to_pending_instances -v`
Expected: still FAIL (constants exist but `PUT` not changed yet). This task only adds helpers.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/delegation_routes.py backend/tests/test_delegation_update.py
git commit -m "test(delegation): failing update-propagation test + edit helpers"
```

---

### Task 2: Resync helper + expanded `PUT /tasks/{id}` (backend)

**Files:**
- Modify: `backend/routes/delegation_routes.py:433-442` (the `update_task` endpoint) and add `_resync_pending_instances` above it.

- [ ] **Step 1: The failing test already exists** (Task 1, `test_01`). Confirm it still fails.

Run: `cd backend && python -m pytest tests/test_delegation_update.py::TestDelegationUpdate::test_01_update_title_propagates_to_pending_instances -v`
Expected: FAIL.

- [ ] **Step 2: Add `_resync_pending_instances` helper**

Insert directly above the `@router.put("/tasks/{task_id}")` decorator (before line 433):

```python
async def _resync_pending_instances(task: dict):
    """Make PENDING instances match the task definition.
    Never touches completed/verified instances (history is preserved)."""
    task_id = task["task_id"]

    # desired (emp_id, due_date) pairs from the current definition
    if task.get("task_type") == "onetime":
        dates = [task.get("target_date") or today_str()]
    else:
        dates = _recurring_dates(
            task.get("frequency", "custom"),
            task.get("start_date") or today_str(),
            task.get("end_date") or today_str(),
        )
    assignees = task.get("assignees", [])
    emp_by_id = {a["emp_id"]: a for a in assignees}
    desired = {(a["emp_id"], d) for a in assignees for d in dates}

    existing = await db.del_task_instances.find({"task_id": task_id}).to_list(5000)

    # delete pending instances no longer wanted
    kept = []
    for inst in existing:
        key = (inst["emp_id"], inst["due_date"])
        if inst.get("status") == "pending" and key not in desired:
            await db.del_task_instances.delete_one({"instance_id": inst["instance_id"]})
        else:
            kept.append(inst)

    covered = {(i["emp_id"], i["due_date"]) for i in kept}

    # create instances for newly-desired (emp, date) pairs
    freq = "onetime" if task.get("task_type") == "onetime" else task.get("frequency", "custom")
    kw = dict(
        task_id=task_id, task_number=task["task_number"], title=task["title"],
        priority=task.get("priority", "medium"), score=task.get("score", 0),
        require_verification=task.get("require_verification", False),
        requires_image=task.get("requires_image", False),
        delegator_id=task.get("delegator_id"), delegator_name=task.get("delegator_name", ""),
        linked_entity_id=task.get("linked_entity_id"),
        linked_entity_type=task.get("linked_entity_type"),
    )
    new_insts = []
    for (emp_id, d) in desired:
        if (emp_id, d) in covered:
            continue
        emp = emp_by_id.get(emp_id)
        if not emp:
            continue
        new_insts.append(_make_instance_v2(**kw, emp=emp, due=d, freq=freq))
    if new_insts:
        await db.del_task_instances.insert_many(new_insts)

    # propagate field edits to all remaining pending instances
    await db.del_task_instances.update_many(
        {"task_id": task_id, "status": "pending"},
        {"$set": {
            "task_title": task["title"],
            "priority": task.get("priority", "medium"),
            "score": task.get("score", 0),
            "require_verification": task.get("require_verification", False),
            "requires_image": task.get("requires_image", False),
            "updated_at": now_iso(),
        }},
    )

    count = await db.del_task_instances.count_documents({"task_id": task_id})
    await db.del_tasks.update_one({"task_id": task_id}, {"$set": {"instance_count": count}})
```

- [ ] **Step 3: Replace the `update_task` endpoint body**

Replace lines 433-442 (the whole `update_task` function) with:

```python
@router.put("/tasks/{task_id}")
async def update_task(task_id: str, request: Request):
    user = await get_current_user(request)
    body = await request.json()
    task = await db.del_tasks.find_one({"task_id": task_id}, {"_id": 0})
    if not task:
        raise HTTPException(404, "Task not found")

    updates = {k: v for k, v in body.items() if k in TASK_EDITABLE}
    if not updates:
        return task
    updates["updated_at"] = now_iso()
    updates["updated_by"] = user.get("email")

    # if assignees change, refresh the cached assignee details
    if "assignee_ids" in updates:
        assignees = []
        for aid in updates["assignee_ids"]:
            emp = await db.del_employees.find_one(
                {"emp_id": aid},
                {"_id": 0, "emp_id": 1, "name": 1, "department_id": 1, "department_name": 1},
            )
            if emp:
                assignees.append(emp)
        updates["assignees"] = assignees

    await db.del_tasks.update_one({"task_id": task_id}, {"$set": updates})
    new_task = await db.del_tasks.find_one({"task_id": task_id}, {"_id": 0})
    await _resync_pending_instances(new_task)
    return await db.del_tasks.find_one({"task_id": task_id}, {"_id": 0})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_delegation_update.py::TestDelegationUpdate::test_01_update_title_propagates_to_pending_instances -v`
Expected: PASS — instances now carry the new title/priority.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/delegation_routes.py
git commit -m "feat(delegation): expand task update + propagate edits to pending instances"
```

---

### Task 3: Assignee add/remove reconciliation (backend test)

**Files:**
- Modify: `backend/tests/test_delegation_update.py` (add tests)

- [ ] **Step 1: Write the failing tests**

Append to `TestDelegationUpdate`:

```python
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
```

- [ ] **Step 2: Run tests**

Run: `cd backend && python -m pytest tests/test_delegation_update.py -v -k "test_02 or test_03 or test_04"`
Expected: PASS — the `_resync_pending_instances` from Task 2 already handles add/remove and history preservation.

- [ ] **Step 3: If any fail, fix `_resync_pending_instances`**

The likely failure point is the `covered`/`desired` set logic. Confirm: completed instances appear in `kept` (so they're `covered` and never recreated); removed-assignee pending instances are deleted; added-assignee desired pairs are created. No code change expected if Task 2 was implemented verbatim.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/test_delegation_update.py
git commit -m "test(delegation): assignee add/remove reconciliation + history preservation"
```

---

### Task 4: `PATCH /instances/{id}` delegatee soft-edit (backend)

**Files:**
- Modify: `backend/routes/delegation_routes.py` (add endpoint after the `reopen_instance` endpoint, ~line 593)
- Modify: `backend/tests/test_delegation_update.py` (add test)

- [ ] **Step 1: Write the failing test**

Append to `TestDelegationUpdate`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_delegation_update.py -v -k "test_05 or test_06 or test_07"`
Expected: FAIL — no PATCH route (405/404 from FastAPI for unmatched method).

- [ ] **Step 3: Add the PATCH endpoint**

Insert after the `reopen_instance` function (after line 593):

```python
@router.patch("/instances/{instance_id}")
async def patch_instance(instance_id: str, request: Request):
    """Delegatee soft-edit: due_date / priority / completion_note, all change-logged."""
    user = await get_current_user(request)
    body = await request.json()
    inst = await db.del_task_instances.find_one({"instance_id": instance_id}, {"_id": 0})
    if not inst:
        raise HTTPException(404, "Instance not found")

    updates, logs = {}, []
    for f in INSTANCE_SOFT_FIELDS:
        if f in body and body[f] != inst.get(f):
            updates[f] = body[f]
            logs.append(_make_change(user.get("email", ""), f, inst.get(f), body[f]))
    if not updates:
        return inst
    updates["updated_at"] = now_iso()
    await db.del_task_instances.update_one(
        {"instance_id": instance_id},
        {"$set": updates, "$push": {"change_log": {"$each": logs}}},
    )
    return await db.del_task_instances.find_one({"instance_id": instance_id}, {"_id": 0})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_delegation_update.py -v`
Expected: PASS (all of test_01..test_07).

- [ ] **Step 5: Commit**

```bash
git add backend/routes/delegation_routes.py backend/tests/test_delegation_update.py
git commit -m "feat(delegation): PATCH instance soft-edit with change_log"
```

---

### Task 5: API client — add `instances.patch` (frontend)

**Files:**
- Modify: `frontend/src/lib/api.js:651-659` (the `instances` block)

- [ ] **Step 1: Add the patch method**

In the `instances:` object (after the `list:` line at 652), add:

```javascript
    patch:            (id,d) => API.patch(`/delegation/instances/${id}`, d),
```

So the block reads:

```javascript
  instances: {
    list:             (p)    => API.get('/delegation/instances', { params: p }),
    patch:            (id,d) => API.patch(`/delegation/instances/${id}`, d),
    complete:         (id,d) => API.post(`/delegation/instances/${id}/complete`, d),
    completeWithImage:(id,fd)=> API.post(`/delegation/instances/${id}/complete-with-image`, fd),
    verify:           (id)   => API.post(`/delegation/instances/${id}/verify`, {}),
    reopen:           (id)   => API.post(`/delegation/instances/${id}/reopen`, {}),
    bulkComplete:     (data) => API.post('/delegation/instances/bulk-complete', data),
    team:             (id)   => API.get(`/delegation/instances/${id}/team`),
  },
```

- [ ] **Step 2: Verify the frontend compiles**

Run: `cd frontend && npx eslint src/lib/api.js`
Expected: no errors on `api.js`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/api.js
git commit -m "feat(delegation): add instances.patch API client method"
```

---

### Task 6: Hook actions — `updateTask`, `patchInstance`, edit-dialog state (frontend)

**Files:**
- Modify: `frontend/src/hooks/useDelegationApp.js` — add state + actions near the task-actions block (after line 218), and export them in the hook's return object.

- [ ] **Step 1: Add edit-dialog state**

Near the other `useState` declarations at the top of the hook (alongside `drawer`/`saving`), add:

```javascript
  const [editTask, setEditTask] = useState(null);   // task object being edited, or null
  const [savingEdit, setSavingEdit] = useState(false);
```

- [ ] **Step 2: Add the `updateTask` and `patchInstance` actions**

After `handleImageComplete` (after line 218), add:

```javascript
  const updateTask = async (taskId, payload) => {
    setSavingEdit(true);
    try {
      await delApi.tasks.update(taskId, payload);
      toast.success('Task updated');
      setEditTask(null);
      loadInstances(); loadDash(); loadTeamSummary();
      if (drawer) openDrawer(drawer);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Update failed');
    } finally {
      setSavingEdit(false);
    }
  };

  const patchInstance = async (instanceId, payload) => {
    try {
      await delApi.instances.patch(instanceId, payload);
      toast.success('Saved');
      loadInstances();
      if (drawer) openDrawer(drawer);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Save failed');
    }
  };
```

- [ ] **Step 3: Export the new state + actions**

In the hook's returned object (the big `return { ... }`), add these keys alongside the existing exports (e.g. near `completeInst`, `saveAllRows`):

```javascript
    editTask, setEditTask, savingEdit, updateTask, patchInstance,
```

- [ ] **Step 4: Verify compile**

Run: `cd frontend && npx eslint src/hooks/useDelegationApp.js`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useDelegationApp.js
git commit -m "feat(delegation): updateTask + patchInstance hook actions and edit state"
```

---

### Task 7: EditTaskDialog component (frontend)

**Files:**
- Create: `frontend/src/components/delegation/EditTaskDialog.js`

- [ ] **Step 1: Create the component**

```javascript
import React, { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

const PINK = '#e94560';

/**
 * Edit an existing task.
 *  - role 'delegator' | 'boss'  → full edit (all fields)
 *  - role 'delegatee'           → soft edit only (priority); core fields disabled
 * onSave(taskId, payload) is the hook's updateTask.
 */
export default function EditTaskDialog({
  task, role, assignableEmployees = [], saving, onSave, onClose,
  card, textPri, textSec, textMuted, inputCls,
}) {
  const isOwner = role === 'delegator' || role === 'boss';
  const [form, setForm] = useState({
    title: task.title || '',
    description: task.description || '',
    priority: task.priority || 'medium',
    task_type: task.task_type || 'onetime',
    frequency: task.frequency || 'daily',
    target_date: task.target_date || '',
    start_date: task.start_date || '',
    end_date: task.end_date || '',
    assignee_ids: task.assignee_ids || [],
    require_verification: !!task.require_verification,
    requires_image: !!task.requires_image,
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const toggleAssignee = (id) =>
    set('assignee_ids',
      form.assignee_ids.includes(id)
        ? form.assignee_ids.filter(x => x !== id)
        : [...form.assignee_ids, id]);

  const submit = () => {
    if (isOwner && !form.title.trim()) return;
    const payload = isOwner
      ? {
          title: form.title, description: form.description, priority: form.priority,
          task_type: form.task_type,
          frequency: form.task_type === 'recurring' ? form.frequency : 'custom',
          target_date: form.task_type === 'onetime' ? form.target_date : null,
          start_date: form.task_type === 'recurring' ? form.start_date : null,
          end_date: form.task_type === 'recurring' ? form.end_date : null,
          assignee_ids: form.assignee_ids,
          require_verification: form.require_verification,
          requires_image: form.requires_image,
        }
      : { priority: form.priority };
    onSave(task.task_id, payload);
  };

  const lbl = `block text-[11px] font-semibold uppercase tracking-wide mb-1 ${textMuted}`;
  const fld = `w-full h-9 px-2.5 rounded text-sm border border-[var(--border-color)] ${inputCls}`;
  const disabled = !isOwner;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className={`${card} border rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-color)]">
          <div>
            <h2 className={`text-base font-semibold ${textPri}`}>Edit Task</h2>
            <p className={`text-xs ${textMuted} mt-0.5`}>
              {isOwner ? 'Changes apply to pending instances' : 'You can adjust priority'}
            </p>
          </div>
          <button onClick={onClose} className={`p-1.5 rounded-lg hover:bg-[var(--bg-hover)] ${textSec}`}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className={lbl}>Title</label>
            <Input value={form.title} disabled={disabled}
              onChange={e => set('title', e.target.value)}
              className={`h-9 text-sm ${inputCls}`} />
          </div>

          <div>
            <label className={lbl}>Priority</label>
            <select value={form.priority} onChange={e => set('priority', e.target.value)} className={fld}>
              <option value="high">🔴 High</option>
              <option value="medium">🟡 Medium</option>
              <option value="low">🟢 Low</option>
            </select>
          </div>

          {isOwner && (
            <>
              <div>
                <label className={lbl}>Type</label>
                <select value={form.task_type} onChange={e => set('task_type', e.target.value)} className={fld}>
                  <option value="onetime">One-time</option>
                  <option value="recurring">Recurring</option>
                </select>
              </div>

              {form.task_type === 'onetime' ? (
                <div>
                  <label className={lbl}>Date</label>
                  <input type="date" value={form.target_date}
                    onChange={e => set('target_date', e.target.value)} className={fld} />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lbl}>Frequency</label>
                    <select value={form.frequency} onChange={e => set('frequency', e.target.value)} className={fld}>
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </div>
                  <div>
                    <label className={lbl}>Start</label>
                    <input type="date" value={form.start_date}
                      onChange={e => set('start_date', e.target.value)} className={fld} />
                  </div>
                  <div>
                    <label className={lbl}>End</label>
                    <input type="date" value={form.end_date}
                      onChange={e => set('end_date', e.target.value)} className={fld} />
                  </div>
                </div>
              )}

              <div>
                <label className={lbl}>Assign To</label>
                <div className="flex flex-wrap gap-1.5">
                  {assignableEmployees.map(e => {
                    const on = form.assignee_ids.includes(e.emp_id);
                    return (
                      <button key={e.emp_id} onClick={() => toggleAssignee(e.emp_id)}
                        className={`px-2.5 h-8 rounded-full text-xs border transition-colors ${on ? 'text-white border-transparent' : `${textSec} border-[var(--border-color)]`}`}
                        style={on ? { background: PINK } : {}}>
                        {e.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-[var(--border-color)]">
          <Button variant="outline" onClick={onClose}
            className={`h-9 border-[var(--border-color)] ${textSec}`}>Cancel</Button>
          <Button onClick={submit} disabled={saving}
            className="h-9 text-white font-semibold" style={{ background: PINK }}>
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it lints/compiles**

Run: `cd frontend && npx eslint src/components/delegation/EditTaskDialog.js`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/delegation/EditTaskDialog.js
git commit -m "feat(delegation): EditTaskDialog component (role-gated task editing)"
```

---

### Task 8: Wire EditTaskDialog into the app (frontend)

**Files:**
- Modify: `frontend/src/pages/admin/DelegationApp.js` — render `<EditTaskDialog>` when `editTask` is set, and pass an "Edit" trigger into the task list / person drawer.

- [ ] **Step 1: Import and render the dialog**

At the top of `DelegationApp.js`, add the import:

```javascript
import EditTaskDialog from '../../components/delegation/EditTaskDialog';
```

Destructure the new hook values where the hook result is consumed (alongside existing values like `activeRole`, `assignableEmployees`):

```javascript
  const {
    /* ...existing... */
    editTask, setEditTask, savingEdit, updateTask,
  } = del;  // (use whatever the existing hook variable name is)
```

Render the dialog near the other modals/drawers in the returned JSX (e.g. just before the closing wrapper):

```javascript
      {editTask && (
        <EditTaskDialog
          task={editTask}
          role={activeRole}
          assignableEmployees={assignableEmployees}
          saving={savingEdit}
          onSave={updateTask}
          onClose={() => setEditTask(null)}
          card={card} textPri={textPri} textSec={textSec}
          textMuted={textMuted} inputCls={inputCls}
        />
      )}
```

> Note: use the exact theme-variable names already destructured in `DelegationApp.js` (`card`, `textPri`, `textSec`, `textMuted`, `inputCls`). If a name differs, match the existing one.

- [ ] **Step 2: Add an "Edit" trigger in the person drawer**

In `frontend/src/components/delegation/DelegationTaskList.js`, in `DelegationPersonDrawer` where each task row renders its action buttons, add an Edit button that opens the dialog. Pass `setEditTask` (and the task's parent definition) through props. Minimal addition next to the existing Verify/Reopen buttons:

```javascript
            <button
              onClick={() => onEditTask(t)}
              className="px-2 h-7 rounded text-xs border border-[var(--border-color)]">
              Edit
            </button>
```

Thread `onEditTask` from `DelegationApp.js` → `DelegationTaskList` → `DelegationPersonDrawer` as a prop, wired to: for a delegatee soft-edit, open the dialog with the instance's task fields; for an owner, fetch/pass the task object. For Part 1, pass the instance `t` shaped as a task (`{ task_id: t.task_id, title: t.task_title, priority: t.priority, ... }`) so the dialog works for both roles; owner edits resolve server-side by `task_id`.

- [ ] **Step 3: Manual verification (run the app)**

Run the app (per the project's run method) and:
1. Open Delegation → a person's drawer → click **Edit** on a task.
2. As admin (boss): change the title and priority, Save → confirm the task list shows the new title (this is the bug, now fixed).
3. Re-open Edit, change assignees → confirm instances added/removed.

Expected: edits persist and the list reflects them without a delete/recreate.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/admin/DelegationApp.js frontend/src/components/delegation/DelegationTaskList.js
git commit -m "feat(delegation): wire EditTaskDialog into app + drawer edit action"
```

---

### Task 9: Full Part 1 regression + verification

- [ ] **Step 1: Run the full backend suite for this module**

Run: `cd backend && python -m pytest tests/test_delegation_update.py -v`
Expected: all of `test_01`..`test_07` PASS.

- [ ] **Step 2: Confirm no regression in existing delegation behavior**

Manually (or via existing tests) confirm create/complete/verify/reopen still work, and `instance_count` on a task matches its instances after an edit.

- [ ] **Step 3: Commit any fixes, then stop for review**

```bash
git add -A
git commit -m "test(delegation): Part 1 regression pass"
```

---

## Roadmap — Parts 2–5 (separate plans)

Each part below is independently shippable and will get its **own** bite-sized plan written just before execution (per the spec's build sequence). They are NOT detailed here to keep this plan executable and focused.

- **Part 2 — Reassignment with approval:** `del_reassign_requests` + `del_notifications` collections; request / list / decide endpoints with delegator-or-boss authorization; `ReassignTaskDialog`, `ApprovalsInbox`, `NotificationsBell`.
- **Part 3 — Buddy backup owner:** instance `buddy_emp_id`/`completed_by` fields; buddy completion; buddy picker; "Backing up" section.
- **Part 4 — My Day / My Week planner redesign:** `MyPlanner` component + `DelegationApp` tab restructure.
- **Part 5 — Psychology layer:** progress ring, streaks, gentle overdue framing, workload visibility — applied across Parts 1–4 via `frontend-design`.

---

## Self-Review (Part 1)

- **Spec coverage:** Part 1 of the spec (§4.1 expanded `PUT /tasks` + propagation, §4.2 `PATCH /instances`, §5 `EditTaskDialog` + hook actions, §3.1 `updated_at`/`updated_by`) — all have tasks. `buddy_emp_id` is accepted by `TASK_EDITABLE` (forward-compatible) but its UI is intentionally deferred to Part 3.
- **Placeholder scan:** no TBD/TODO; every code step contains full code. The one soft spot is Task 8 Step 2 (threading `onEditTask` through existing components) — exact prop wiring depends on current `DelegationTaskList` props, so it's described with the concrete snippet to add and where.
- **Type consistency:** `updateTask(taskId, payload)`, `patchInstance(instanceId, payload)`, `setEditTask`, `savingEdit`, `_resync_pending_instances`, `TASK_EDITABLE`, `INSTANCE_SOFT_FIELDS`, `_make_change` are used consistently across backend and frontend tasks.
- **Edge cases covered by tests:** propagation to pending only (test_01, test_04), assignee add/remove (test_02/03), history preservation (test_04), soft-edit logging + no-op + 404 (test_05/06/07).
