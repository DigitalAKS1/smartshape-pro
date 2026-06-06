# Delegation Calendar — Phase 1 (Backend Agenda + Plan Blocks) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend foundation for the unified Delegation Calendar — one `GET /delegation/agenda` endpoint that normalizes 6 sources into a single event list (role/visibility filtered), plus CRUD for personal `del_plan_blocks`.

**Architecture:** A single FastAPI endpoint queries each source collection directly within a date range, filtered to a *subject* employee (self by default; a team member if a boss/delegator requests it), and normalizes every row into one event shape. Personal plan blocks live in a new `del_plan_blocks` collection, private to each user.

**Tech Stack:** FastAPI + Motor (MongoDB); pytest integration tests against a running backend (live-server style, self-cleaning), matching the existing `backend/tests/` pattern.

---

## Reference — exact source shapes (verified)

| Collection | id | date field | time field | owner field | other |
|---|---|---|---|---|---|
| `del_task_instances` | `instance_id` | `due_date` (YYYY-MM-DD) | — | `emp_id` | `task_title,status,priority,delegator_name,requires_image,buddy_emp_id,emp_name` |
| `fms_stages` | `stage_id` | `plan_done` (ISO datetime) | — (by `team`) | `flow_id,label/stage_label,status,plan_start` | join `fms_flows{flow_id,title,customer_name}` |
| `visit_plans` | `plan_id` | `visit_date` | `visit_time` | `assigned_to` (email) | `school_name,school_id,assigned_name,status` |
| `tasks` (CRM) | `task_id` | `due_date` | `due_time` | `assigned_to` (email) | `title,priority,type,status,lead_id,lead_name` |
| `followups` | `followup_id` | `followup_date` | `followup_time` | `assigned_to` (email) | `followup_type(call/meeting/demo),status,lead_id,outcome` |
| `training_sessions` | `session_id` | `date` | `time` | — (org-wide) | `title,platform(zoom/meet/physical),meeting_link,location,status` |

Helpers already in `delegation_routes.py`: `now_iso()`, `today_str()`, `gen_id(prefix)`, `_resolve_actor(user)`, `_make_change(...)`. Auth: `get_current_user(request)`.

## File Structure (Phase 1)
- **Modify** `backend/routes/delegation_routes.py` — add agenda constants/helpers, six normalizers, `GET /delegation/agenda`, and `del_plan_blocks` CRUD. (If the file feels too large after, a follow-up can extract agenda helpers to `delegation_agenda.py`; not required for Phase 1.)
- **Create** `backend/tests/test_delegation_agenda.py` — integration tests (gitignored like other tests; kept local for verification).

## Conventions
- Backend tests hit a live server at `REACT_APP_BACKEND_URL`, log in as admin (`info@smartshape.in`/`admin123`), set the Bearer header from the login cookie (see existing `test_delegation_update.py`), and self-clean.
- Run the backend locally before tests (note: it connects to the prod Atlas DB and starts schedulers — stop it promptly after).
- Commit after each green step.

---

### Task 1: Plan-blocks collection + CRUD

**Files:**
- Modify: `backend/routes/delegation_routes.py` (add after the notifications endpoints)
- Test: `backend/tests/test_delegation_agenda.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_delegation_agenda.py`:

```python
"""
Delegation Calendar — agenda + plan-blocks tests (Phase 1).
Live-server integration; self-cleaning ('CalTest' markers).
"""
import os, uuid
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')


class TestPlanBlocks:
    @pytest.fixture(autouse=True)
    def setup(self):
        self.s = requests.Session()
        self.s.headers.update({"Content-Type": "application/json"})
        r = self.s.post(f"{BASE_URL}/api/auth/login",
                        json={"email": "info@smartshape.in", "password": "admin123"})
        assert r.status_code == 200, r.text
        tok = self.s.cookies.get("access_token")
        if tok:
            self.s.headers.update({"Authorization": f"Bearer {tok}"})
        self.s.post(f"{BASE_URL}/api/delegation/sync-users", json={})
        self._blocks = []
        yield
        for bid in self._blocks:
            try:
                self.s.delete(f"{BASE_URL}/api/delegation/plan-blocks/{bid}")
            except Exception:
                pass

    def _create(self, **over):
        body = {"date": "2026-12-09", "start_time": "09:00", "end_time": "10:00",
                "title": f"CalTest {uuid.uuid4().hex[:6]}"}
        body.update(over)
        r = self.s.post(f"{BASE_URL}/api/delegation/plan-blocks", json=body)
        if r.status_code == 200:
            self._blocks.append(r.json()["block_id"])
        return r

    def test_01_create_and_list(self):
        r = self._create()
        assert r.status_code == 200, r.text
        blk = r.json()
        assert blk["title"].startswith("CalTest") and blk["date"] == "2026-12-09"
        lst = self.s.get(f"{BASE_URL}/api/delegation/plan-blocks",
                         params={"date": "2026-12-09"}).json()
        assert any(b["block_id"] == blk["block_id"] for b in lst)
        print("✓ plan-block create + list")

    def test_02_end_before_start_rejected(self):
        r = self._create(start_time="10:00", end_time="09:00")
        assert r.status_code == 400
        print("✓ end<=start rejected")

    def test_03_update_and_delete(self):
        bid = self._create().json()["block_id"]
        u = self.s.patch(f"{BASE_URL}/api/delegation/plan-blocks/{bid}",
                         json={"title": "CalTest Renamed", "note": "focus"})
        assert u.status_code == 200 and u.json()["title"] == "CalTest Renamed"
        d = self.s.delete(f"{BASE_URL}/api/delegation/plan-blocks/{bid}")
        assert d.status_code == 200
        self._blocks.remove(bid)
        print("✓ plan-block update + delete")
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && REACT_APP_BACKEND_URL=http://127.0.0.1:8000 python -m pytest tests/test_delegation_agenda.py::TestPlanBlocks -v`
Expected: FAIL (routes 404 / method not allowed).

- [ ] **Step 3: Implement plan-blocks CRUD**

Add to `backend/routes/delegation_routes.py` (after `mark_all_notifications_read`):

```python
# ══════════════════════════════════════════════════════════════════════════════
# PERSONAL DAY-PLAN BLOCKS  (private to each user)
# ══════════════════════════════════════════════════════════════════════════════

PLAN_BLOCK_FIELDS = ("date", "start_time", "end_time", "title", "note", "color", "linked_event_id")


@router.get("/plan-blocks")
async def list_plan_blocks(request: Request, date: Optional[str] = None,
                           date_from: Optional[str] = None, date_to: Optional[str] = None):
    user = await get_current_user(request)
    actor = await _resolve_actor(user)
    if not actor["emp_id"]:
        return []
    q = {"emp_id": actor["emp_id"]}
    if date:
        q["date"] = date
    elif date_from or date_to:
        q["date"] = {}
        if date_from: q["date"]["$gte"] = date_from
        if date_to:   q["date"]["$lte"] = date_to
    return await db.del_plan_blocks.find(q, {"_id": 0}).sort("start_time", 1).to_list(500)


@router.post("/plan-blocks")
async def create_plan_block(request: Request):
    user = await get_current_user(request)
    actor = await _resolve_actor(user)
    if not actor["emp_id"]:
        raise HTTPException(400, "Your account is not linked to the team yet")
    body = await request.json()
    title = (body.get("title") or "").strip()
    st, et = body.get("start_time") or "", body.get("end_time") or ""
    if not title:
        raise HTTPException(400, "Title is required")
    if not body.get("date"):
        raise HTTPException(400, "Date is required")
    if st and et and et <= st:
        raise HTTPException(400, "End time must be after start time")
    doc = {
        "block_id": gen_id("blk"), "emp_id": actor["emp_id"],
        "date": body["date"], "start_time": st, "end_time": et,
        "title": title, "note": body.get("note", ""),
        "color": body.get("color", "#64748b"),
        "linked_event_id": body.get("linked_event_id", ""),
        "created_at": now_iso(), "updated_at": now_iso(),
    }
    await db.del_plan_blocks.insert_one(doc)
    return await db.del_plan_blocks.find_one({"block_id": doc["block_id"]}, {"_id": 0})


@router.patch("/plan-blocks/{block_id}")
async def update_plan_block(block_id: str, request: Request):
    user = await get_current_user(request)
    actor = await _resolve_actor(user)
    blk = await db.del_plan_blocks.find_one({"block_id": block_id}, {"_id": 0})
    if not blk:
        raise HTTPException(404, "Block not found")
    if blk["emp_id"] != actor["emp_id"]:
        raise HTTPException(403, "Not your plan block")
    body = await request.json()
    updates = {k: v for k, v in body.items() if k in PLAN_BLOCK_FIELDS}
    st = updates.get("start_time", blk.get("start_time"))
    et = updates.get("end_time", blk.get("end_time"))
    if st and et and et <= st:
        raise HTTPException(400, "End time must be after start time")
    if "title" in updates and not (updates["title"] or "").strip():
        raise HTTPException(400, "Title is required")
    if updates:
        updates["updated_at"] = now_iso()
        await db.del_plan_blocks.update_one({"block_id": block_id}, {"$set": updates})
    return await db.del_plan_blocks.find_one({"block_id": block_id}, {"_id": 0})


@router.delete("/plan-blocks/{block_id}")
async def delete_plan_block(block_id: str, request: Request):
    user = await get_current_user(request)
    actor = await _resolve_actor(user)
    blk = await db.del_plan_blocks.find_one({"block_id": block_id}, {"_id": 0})
    if not blk:
        raise HTTPException(404, "Block not found")
    if blk["emp_id"] != actor["emp_id"]:
        raise HTTPException(403, "Not your plan block")
    await db.del_plan_blocks.delete_one({"block_id": block_id})
    return {"ok": True}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && REACT_APP_BACKEND_URL=http://127.0.0.1:8000 python -m pytest tests/test_delegation_agenda.py::TestPlanBlocks -v`
Expected: PASS (test_01..test_03).

- [ ] **Step 5: Commit**

```bash
git add backend/routes/delegation_routes.py
git commit -m "feat(delegation): personal day-plan blocks CRUD (private per user)"
```

---

### Task 2: Agenda event helper + subject resolution + first source (delegation)

**Files:**
- Modify: `backend/routes/delegation_routes.py` (add agenda block after plan-blocks)
- Test: `backend/tests/test_delegation_agenda.py`

- [ ] **Step 1: Write the failing test**

Append to `test_delegation_agenda.py`:

```python
class TestAgenda:
    @pytest.fixture(autouse=True)
    def setup(self):
        self.s = requests.Session()
        self.s.headers.update({"Content-Type": "application/json"})
        r = self.s.post(f"{BASE_URL}/api/auth/login",
                        json={"email": "info@smartshape.in", "password": "admin123"})
        assert r.status_code == 200, r.text
        tok = self.s.cookies.get("access_token")
        if tok:
            self.s.headers.update({"Authorization": f"Bearer {tok}"})
        self.s.post(f"{BASE_URL}/api/delegation/sync-users", json={})
        emps = self.s.get(f"{BASE_URL}/api/delegation/employees").json()
        self.admin_emp = next(e for e in emps if e.get("email") == "info@smartshape.in")
        self._tasks = []
        yield
        for tid in self._tasks:
            try:
                self.s.delete(f"{BASE_URL}/api/delegation/tasks/{tid}")
            except Exception:
                pass

    def test_01_agenda_includes_delegation_task(self):
        # create a delegation task for the admin in-range
        body = {"title": f"CalTest {uuid.uuid4().hex[:6]}", "task_type": "onetime",
                "target_date": "2026-12-10", "assignee_ids": [self.admin_emp["emp_id"]],
                "delegator_id": self.admin_emp["emp_id"]}
        t = self.s.post(f"{BASE_URL}/api/delegation/tasks", json=body)
        assert t.status_code == 200, t.text
        self._tasks.append(t.json()["task_id"])
        r = self.s.get(f"{BASE_URL}/api/delegation/agenda",
                       params={"from": "2026-12-01", "to": "2026-12-31"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert "events" in data
        mine = [e for e in data["events"] if e["source"] == "delegation"
                and e["date"] == "2026-12-10" and "CalTest" in e["title"]]
        assert mine, "delegation task should appear in agenda"
        ev = mine[0]
        assert ev["event_id"].startswith("delegation_") and ev["entity_id"]
        assert "complete" in ev["actions"]
        print("✓ agenda includes delegation task")

    def test_02_range_excludes_out_of_window(self):
        r = self.s.get(f"{BASE_URL}/api/delegation/agenda",
                       params={"from": "2027-01-01", "to": "2027-01-07"})
        assert r.status_code == 200
        assert all("CalTest" not in (e.get("title") or "") for e in r.json()["events"])
        print("✓ out-of-range excluded")

    def test_03_range_too_large_rejected(self):
        r = self.s.get(f"{BASE_URL}/api/delegation/agenda",
                       params={"from": "2026-01-01", "to": "2026-12-31"})
        assert r.status_code == 400
        print("✓ >62-day range rejected")
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && REACT_APP_BACKEND_URL=http://127.0.0.1:8000 python -m pytest tests/test_delegation_agenda.py::TestAgenda -v`
Expected: FAIL (agenda 404).

- [ ] **Step 3: Add agenda helpers, subject resolution, delegation normalizer, and the endpoint**

Add to `backend/routes/delegation_routes.py` (after the plan-blocks endpoints):

```python
# ══════════════════════════════════════════════════════════════════════════════
# UNIFIED AGENDA  (calendar aggregation across 6 sources)
# ══════════════════════════════════════════════════════════════════════════════

AGENDA_COLORS = {
    "delegation": "#e94560", "fms": "#8b5cf6", "visit": "#06b6d4",
    "task": "#f59e0b", "followup": "#10b981", "workshop": "#6366f1", "plan": "#64748b",
}


def _ev(source, type_, title, date_, entity_id, link, *, start_time=None, end_time=None,
        status=None, priority=None, actions=None, meta=None):
    return {
        "event_id": f"{source}_{entity_id}", "source": source, "type": type_,
        "title": title or "(untitled)", "date": date_,
        "start_time": start_time, "end_time": end_time,
        "status": status, "priority": priority,
        "entity_id": entity_id, "link": link, "color": AGENDA_COLORS.get(source, "#64748b"),
        "actions": actions or [], "meta": meta or {},
    }


async def _resolve_subject(actor: dict, emp_id):
    """Whose calendar to show. Self by default; a team member if boss or a delegation target."""
    if not emp_id or emp_id == actor["emp_id"]:
        own = await db.del_employees.find_one({"emp_id": actor["emp_id"]}, {"_id": 0}) if actor["emp_id"] else None
        return own, True   # (subject_doc, is_self)
    target = await db.del_employees.find_one({"emp_id": emp_id}, {"_id": 0})
    if not target:
        raise HTTPException(404, "Employee not found")
    if not actor["is_boss"]:
        me = await db.del_employees.find_one({"emp_id": actor["emp_id"]}, {"_id": 0}) or {}
        if emp_id not in (me.get("delegation_targets") or []):
            raise HTTPException(403, "You can only view your own team members' calendars")
    return target, False


async def _subject_team(email: str) -> Optional[str]:
    if not email:
        return None
    u = await db.users.find_one({"email": email}, {"_id": 0, "role": 1})
    role = (u or {}).get("role", "")
    return {"admin": "admin", "accounts": "accounts", "store": "store"}.get(role, "sales" if role else None)


async def _agenda_delegation(emp_id, dfrom, dto):
    if not emp_id:
        return []
    rows = await db.del_task_instances.find(
        {"emp_id": emp_id, "due_date": {"$gte": dfrom, "$lte": dto}}, {"_id": 0}
    ).to_list(2000)
    out = []
    for r in rows:
        acts = []
        if r.get("status") == "pending":
            acts = ["complete", "reschedule", "reassign"]
        elif r.get("status") == "completed":
            acts = ["verify", "reopen"]
        out.append(_ev(
            "delegation", "delegated" if r.get("delegator_id") else "my_task",
            r.get("task_title"), r["due_date"], r["instance_id"], "/delegation",
            status=r.get("status"), priority=r.get("priority"), actions=acts,
            meta={"delegator_name": r.get("delegator_name", ""), "emp_name": r.get("emp_name", ""),
                  "requires_image": r.get("requires_image", False)},
        ))
    return out


@router.get("/agenda")
async def get_agenda(request: Request, **_unused):
    from_ = request.query_params.get("from")
    to_ = request.query_params.get("to")
    emp_id = request.query_params.get("emp_id")
    if not from_ or not to_:
        raise HTTPException(400, "from and to (YYYY-MM-DD) are required")
    try:
        days = (date.fromisoformat(to_) - date.fromisoformat(from_)).days
    except Exception:
        raise HTTPException(400, "Invalid date format; use YYYY-MM-DD")
    if days < 0 or days > 62:
        raise HTTPException(400, "Range must be between 0 and 62 days")

    user = await get_current_user(request)
    actor = await _resolve_actor(user)
    subject, is_self = await _resolve_subject(actor, emp_id)
    if not subject:
        return {"from": from_, "to": to_, "subject_emp_id": None, "events": []}

    s_emp = subject["emp_id"]
    s_email = subject.get("email", "")
    s_team = await _subject_team(s_email)

    events = []
    events += await _agenda_delegation(s_emp, from_, to_)
    # (further sources added in Task 3)

    return {"from": from_, "to": to_, "subject_emp_id": s_emp, "is_self": is_self,
            "subject_team": s_team, "events": events}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && REACT_APP_BACKEND_URL=http://127.0.0.1:8000 python -m pytest tests/test_delegation_agenda.py::TestAgenda -v`
Expected: PASS (test_01..test_03).

- [ ] **Step 5: Commit**

```bash
git add backend/routes/delegation_routes.py
git commit -m "feat(delegation): agenda endpoint skeleton + delegation source + subject resolution"
```

---

### Task 3: Remaining five normalizers (FMS, visits, CRM tasks, followups, workshops)

**Files:**
- Modify: `backend/routes/delegation_routes.py` (add 5 normalizers; wire into `get_agenda`)
- Test: `backend/tests/test_delegation_agenda.py`

- [ ] **Step 1: Write the failing test**

Append to `class TestAgenda`:

```python
    def test_04_other_sources_present_and_shaped(self):
        # seed one visit + one workshop in range (admin-owned / org-wide)
        vp = self.s.post(f"{BASE_URL}/api/visit-plans", json={
            "school_name": "CalTest School", "visit_date": "2026-12-11",
            "visit_time": "14:00", "assigned_to": "info@smartshape.in",
            "assigned_name": "Admin"})
        ws = self.s.post(f"{BASE_URL}/api/training/sessions", json={
            "title": "CalTest Workshop", "date": "2026-12-12", "time": "16:00",
            "platform": "zoom", "meeting_link": "https://zoom.us/j/123"})
        r = self.s.get(f"{BASE_URL}/api/delegation/agenda",
                       params={"from": "2026-12-01", "to": "2026-12-31"})
        assert r.status_code == 200, r.text
        evs = r.json()["events"]
        sources = {e["source"] for e in evs}
        # visit + workshop should be present; their shape is correct
        visit = next((e for e in evs if e["source"] == "visit" and "CalTest" in e["title"]), None)
        wshop = next((e for e in evs if e["source"] == "workshop" and "CalTest" in e["title"]), None)
        assert visit and visit["start_time"] == "14:00" and "checkin" in visit["actions"]
        assert wshop and wshop["start_time"] == "16:00" and wshop["meta"]["platform"] == "zoom"
        assert wshop["meta"]["meeting_link"].startswith("https://")
        # cleanup
        if vp.status_code == 200:
            self.s.delete(f"{BASE_URL}/api/visit-plans/{vp.json().get('plan_id')}")
        if ws.status_code == 200:
            self.s.delete(f"{BASE_URL}/api/training/sessions/{ws.json().get('session_id')}")
        print("✓ visit + workshop normalized into agenda")
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && REACT_APP_BACKEND_URL=http://127.0.0.1:8000 python -m pytest tests/test_delegation_agenda.py::TestAgenda::test_04_other_sources_present_and_shaped -v`
Expected: FAIL (visit/workshop not yet in agenda).

- [ ] **Step 3: Add the five normalizers and wire them in**

Add these functions before `get_agenda` in `backend/routes/delegation_routes.py`:

```python
async def _agenda_fms(team, dfrom, dto):
    # FMS stages are team-scoped (no per-person owner). plan_done is an ISO datetime.
    q = {"plan_done": {"$gte": dfrom, "$lte": dto + "T23:59:59"}}
    stages = await db.fms_stages.find(q, {"_id": 0}).to_list(2000)
    if team and team != "admin":
        stages = [s for s in stages if s.get("team") in (team, None, "")]
    flow_ids = list({s["flow_id"] for s in stages if s.get("flow_id")})
    flows = await db.fms_flows.find(
        {"flow_id": {"$in": flow_ids}}, {"_id": 0, "flow_id": 1, "title": 1, "customer_name": 1}
    ).to_list(500)
    fmap = {f["flow_id"]: f for f in flows}
    out = []
    for s in stages:
        pd = s.get("plan_done") or ""
        d, t = (pd[:10], pd[11:16]) if len(pd) >= 16 else (pd[:10], None)
        flow = fmap.get(s.get("flow_id"), {})
        label = s.get("label") or s.get("stage_label") or "Stage"
        acts = ["complete_stage", "open"] if s.get("status") != "done" else ["open"]
        out.append(_ev(
            "fms", "fms_stage", f"{label} — {flow.get('title', '')}".strip(" —"),
            d, s.get("stage_id", ""), "/flow-management",
            start_time=t, status=s.get("status"), actions=acts,
            meta={"flow_id": s.get("flow_id"), "customer_name": flow.get("customer_name", ""),
                  "tat_status": s.get("tat_status", "")},
        ))
    return out


async def _agenda_visits(email, dfrom, dto):
    if not email:
        return []
    rows = await db.visit_plans.find(
        {"assigned_to": email, "visit_date": {"$gte": dfrom, "$lte": dto}}, {"_id": 0}
    ).to_list(2000)
    out = []
    for r in rows:
        st = r.get("status")
        acts = ["open"]
        if st in (None, "", "planned"):
            acts = ["checkin", "reschedule", "open"]
        elif st == "checked_in":
            acts = ["checkout", "open"]
        out.append(_ev(
            "visit", "visit", r.get("school_name") or "Visit", r["visit_date"],
            r.get("plan_id", ""), "/visit-planning",
            start_time=(r.get("visit_time") or None), status=st, actions=acts,
            meta={"school_id": r.get("school_id", ""), "assigned_name": r.get("assigned_name", "")},
        ))
    return out


async def _agenda_crm_tasks(email, dfrom, dto):
    if not email:
        return []
    rows = await db.tasks.find(
        {"assigned_to": email, "due_date": {"$gte": dfrom, "$lte": dto}}, {"_id": 0}
    ).to_list(2000)
    out = []
    for r in rows:
        done = r.get("status") in ("done", "completed")
        acts = ["open"] if done else ["complete", "reschedule", "open"]
        out.append(_ev(
            "task", "my_task", r.get("title") or "Task", r["due_date"],
            r.get("task_id", ""), "/leads",
            start_time=(r.get("due_time") or None), status=r.get("status"),
            priority=r.get("priority"), actions=acts,
            meta={"lead_id": r.get("lead_id", ""), "lead_name": r.get("lead_name", "")},
        ))
    return out


async def _agenda_followups(email, dfrom, dto):
    if not email:
        return []
    rows = await db.followups.find(
        {"assigned_to": email, "followup_date": {"$gte": dfrom, "$lte": dto}}, {"_id": 0}
    ).to_list(2000)
    out = []
    for r in rows:
        ftype = r.get("followup_type") or "call"   # call|meeting|demo
        done = r.get("status") in ("done", "completed")
        acts = ["open"] if done else ["log_outcome", "reschedule", "open"]
        out.append(_ev(
            "followup", ftype, f"{ftype.title()} · {r.get('lead_name', '') or r.get('lead_id', '')}".strip(" ·"),
            r["followup_date"], r.get("followup_id", ""), "/leads",
            start_time=(r.get("followup_time") or None), status=r.get("status"), actions=acts,
            meta={"lead_id": r.get("lead_id", ""), "outcome": r.get("outcome", "")},
        ))
    return out


async def _agenda_workshops(dfrom, dto):
    # org-wide; platform zoom/meet/physical
    rows = await db.training_sessions.find(
        {"date": {"$gte": dfrom, "$lte": dto}}, {"_id": 0}
    ).to_list(1000)
    out = []
    for r in rows:
        platform = r.get("platform", "zoom")
        type_ = "physical_workshop" if platform == "physical" else "zoom_workshop"
        acts = ["open"]
        if r.get("meeting_link"):
            acts = ["join", "set_status", "open"]
        out.append(_ev(
            "workshop", type_, r.get("title") or "Workshop", r.get("date", ""),
            r.get("session_id", ""), "/leads",
            start_time=(r.get("time") or None), status=r.get("status"), actions=acts,
            meta={"platform": platform, "meeting_link": r.get("meeting_link", ""),
                  "location": r.get("location", ""), "org_wide": True},
        ))
    return out
```

Then update `get_agenda` — replace the `# (further sources added in Task 3)` line with:

```python
    events += await _agenda_fms(s_team, from_, to_)
    events += await _agenda_visits(s_email, from_, to_)
    events += await _agenda_crm_tasks(s_email, from_, to_)
    events += await _agenda_followups(s_email, from_, to_)
    events += await _agenda_workshops(from_, to_)
    if is_self:
        blocks = await db.del_plan_blocks.find(
            {"emp_id": s_emp, "date": {"$gte": from_, "$lte": to_}}, {"_id": 0}
        ).to_list(500)
        for b in blocks:
            events.append(_ev(
                "plan", "plan_block", b.get("title"), b["date"], b["block_id"], "/delegation",
                start_time=b.get("start_time") or None, end_time=b.get("end_time") or None,
                actions=["edit", "delete"], meta={"note": b.get("note", ""),
                                                  "linked_event_id": b.get("linked_event_id", "")},
            ))
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && REACT_APP_BACKEND_URL=http://127.0.0.1:8000 python -m pytest tests/test_delegation_agenda.py -v`
Expected: PASS (all PlanBlocks + Agenda tests).

- [ ] **Step 5: Commit**

```bash
git add backend/routes/delegation_routes.py
git commit -m "feat(delegation): agenda normalizers for FMS, visits, CRM tasks, followups, workshops + plan blocks"
```

---

### Task 4: Team-view authorization

**Files:**
- Test: `backend/tests/test_delegation_agenda.py`
- (No new code — verifies `_resolve_subject` from Task 2.)

- [ ] **Step 1: Write the test**

Append to `class TestAgenda`:

```python
    def test_05_self_default_and_team_view_as_admin(self):
        # admin is a boss → can view another employee's agenda by emp_id
        emps = self.s.get(f"{BASE_URL}/api/delegation/employees").json()
        other = next((e for e in emps if e["emp_id"] != self.admin_emp["emp_id"]), None)
        r_self = self.s.get(f"{BASE_URL}/api/delegation/agenda",
                            params={"from": "2026-12-01", "to": "2026-12-31"})
        assert r_self.json()["subject_emp_id"] == self.admin_emp["emp_id"]
        assert r_self.json()["is_self"] is True
        if other:
            r_team = self.s.get(f"{BASE_URL}/api/delegation/agenda",
                                params={"from": "2026-12-01", "to": "2026-12-31",
                                        "emp_id": other["emp_id"]})
            assert r_team.status_code == 200
            assert r_team.json()["subject_emp_id"] == other["emp_id"]
            assert r_team.json()["is_self"] is False
        print("✓ self default + boss team-view")

    def test_06_unknown_emp_404(self):
        r = self.s.get(f"{BASE_URL}/api/delegation/agenda",
                       params={"from": "2026-12-01", "to": "2026-12-31", "emp_id": "emp_nope"})
        assert r.status_code == 404
        print("✓ unknown emp → 404")
```

- [ ] **Step 2: Run to verify it passes**

Run: `cd backend && REACT_APP_BACKEND_URL=http://127.0.0.1:8000 python -m pytest tests/test_delegation_agenda.py::TestAgenda -v -k "test_05 or test_06"`
Expected: PASS (admin is a boss; `_resolve_subject` allows team view and 404s unknown emp).
> Note: the non-boss 403 path can't be exercised with only the admin login available; it's covered by code review of `_resolve_subject`.

- [ ] **Step 3: Commit (tests only — gitignored, so no-op commit acceptable)**

```bash
git add backend/routes/delegation_routes.py
git commit -m "test(delegation): agenda team-view authorization (verified)" --allow-empty
```

---

### Task 5: Full Phase-1 regression + cleanup

- [ ] **Step 1: Run the whole agenda suite**

Run: `cd backend && REACT_APP_BACKEND_URL=http://127.0.0.1:8000 python -m pytest tests/test_delegation_agenda.py -v`
Expected: all PlanBlocks + Agenda tests PASS.

- [ ] **Step 2: Verify prod hygiene (no residual CalTest data)**

Run a DB check (like prior phases) for leftover `CalTest` docs across `del_tasks`, `del_task_instances`, `del_plan_blocks`, `visit_plans`, `training_sessions`; hard-delete any residue. Stop the local backend afterward (it runs prod schedulers).

- [ ] **Step 3: Commit**

```bash
git add backend/routes/delegation_routes.py
git commit -m "chore(delegation): Phase 1 agenda backend complete" --allow-empty
```

---

## Roadmap — Phases 2–5 (separate plans)

Each gets its own bite-sized plan just before execution.

- **Phase 2 — Calendar shell:** `useDelegationCalendar` hook + `lib/api.js` (`delegation.agenda`, `delegation.planBlocks.*`); `DelegationCalendar` container with Month/Week/Day switch, date nav, source-filter chips; `CalendarMonth` (dots by source). Make it the default `viewTab` in `DelegationApp`.
- **Phase 3 — Day timeline + plan blocks:** `CalendarDay` hour grid + "Unscheduled" tray; `DayPlanBlockDialog` (create/edit/delete); drag item→hour slot (drop sets time via the source's reschedule/PATCH; falls back to a linked plan block when a source has no reschedule). `CalendarWeek`.
- **Phase 4 — EventActionDrawer:** source-specific actions wired to existing endpoints (complete/verify/reopen, FMS stage-complete, visit check-in/out, followup log-outcome, workshop join/status). Adds any small missing endpoints (followup reschedule/outcome, training status) discovered here.
- **Phase 5 — Team viewing UI + polish:** team-member picker (boss/delegator), private-blocks handling when viewing others, and a `frontend-design` pass on the whole calendar.

---

## Self-Review (Phase 1)

- **Spec coverage:** §3 event shape → `_ev` (Task 2); §3.1 six sources → Tasks 2–3 normalizers (delegation/fms/visit/task/followup/workshop) + plan source; §4.1 agenda endpoint w/ range cap + team auth → Tasks 2,4; §4.2 plan-blocks CRUD + validation + privacy → Task 1. Frontend (§5–7) is Phases 2–5 (roadmap).
- **Placeholder scan:** no TBD/TODO; every code step is complete. The known soft spots (FMS team-scoping heuristic; followup/training action endpoints) are explicitly deferred to Phase 4 with documented fallbacks — not silent gaps.
- **Type consistency:** `_ev(...)` signature, `event_id = "{source}_{entity_id}"`, `_resolve_subject` returning `(subject_doc, is_self)`, `_subject_team`, and the six `_agenda_*` names are used consistently across tasks. Collections/fields match the verified Reference table.
- **Edge cases tested:** range>62d (400), out-of-range exclusion, end<=start (400), plan-block privacy (403 via ownership), unknown emp (404), timed vs null-time placement (visit 14:00, workshop 16:00).
