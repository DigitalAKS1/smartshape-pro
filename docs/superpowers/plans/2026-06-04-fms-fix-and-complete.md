# FMS Fix-and-Complete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four TAT/scoring bugs in the existing FMS, add an audit log, enforce role-based access (field masking + stage edit-locks), build a WhatsApp+Email notification engine on the existing scheduler, and add pause/hold.

**Architecture:** Keep the existing lightweight MongoDB FMS (`backend/routes/fms_routes.py`). Pure time/score helpers are fixed and unit-tested by direct import. The notification engine adds one asyncio loop to the existing `backend/scheduler.py` (no new dependency), sending via the existing `evolution` WhatsApp client and `_smtp_send` email helper, with dedupe via a new `fms_notifications` collection. RBAC reuses `backend/rbac.py`.

**Tech Stack:** Python 3.14, FastAPI, Motor/MongoDB, pytest + requests (HTTP integration tests), httpx (Evolution client), smtplib (SMTP). Frontend: React (CRA).

---

## Reference: spec

Design spec: `docs/superpowers/specs/2026-06-04-fms-fix-and-complete-design.md`. Read it before starting.

## Reference: how to run tests

- **Unit tests** (pure functions, no server needed), run from `backend/`:
  `python -m pytest tests/test_fms_tat_engine.py -v`
- **Integration tests** (need the backend running and `REACT_APP_BACKEND_URL` set), run from `backend/`:
  `python -m pytest tests/test_fms_fix_complete.py -v`
  The backend must be running locally (it writes `backend/backend.log`). `REACT_APP_BACKEND_URL` points at it (e.g. `http://localhost:8000`). Admin login is `info@smartshape.in` / `admin123`.

## File structure

- **Modify** `backend/routes/fms_routes.py` — fix TAT/status/score, add `IST`, `compute_live_tat`, `render_template`, `_log_stage`, `_mask_flow`, `_require_stage_team`, pause/resume endpoints, logs endpoint, customer-notify hook, extended settings whitelist, stage-def `customer_notify`.
- **Modify** `backend/scheduler.py` — add `_fms_send_wa`, `_fms_send_email`, `_resolve_recipient`, `run_fms_sla_check`, `fms_sla_loop`; wire into `start_scheduler`.
- **Create** `backend/tests/test_fms_tat_engine.py` — pure unit tests for TAT/status/score.
- **Create** `backend/tests/test_fms_fix_complete.py` — integration tests for reject, RBAC masking, edit-lock, logs, pause/resume, settings.
- **Modify** `frontend/src/components/fms/FMSDashboard.js` (and/or `FlowDetailPanel.js`) — render `tat_status` with icon+text (accessibility), add pause/resume control, show audit log. (Frontend task is last; backend-driven.)

---

# PHASE 1 — Bug fixes + audit log

### Task 1: IST-correct TAT engine

**Files:**
- Modify: `backend/routes/fms_routes.py` (top, near line 18 imports and lines 40–130)
- Test: `backend/tests/test_fms_tat_engine.py`

- [ ] **Step 1: Write the failing unit test**

Create `backend/tests/test_fms_tat_engine.py`:

```python
"""Pure unit tests for the FMS TAT engine (no server required).
Run from backend/:  python -m pytest tests/test_fms_tat_engine.py -v
"""
from datetime import datetime, timezone, timedelta

from routes.fms_routes import (
    IST,
    calculate_plan_time,
    working_minutes_elapsed,
    tat_status,
    score_stage,
)

OFFICE_START, OFFICE_END = 10, 18      # 10am–6pm IST
WEEKLY_OFF = [6]                       # Sunday
HOLIDAYS = []


def _ist(y, m, d, hh, mm=0):
    return datetime(y, m, d, hh, mm, tzinfo=IST)


class TestCalculatePlanTime:
    def test_within_same_day(self):
        # Mon 2026-06-01 11:00 IST + 2h -> 13:00 IST same day
        start = _ist(2026, 6, 1, 11, 0)
        end = calculate_plan_time(start, 2, OFFICE_START, OFFICE_END, WEEKLY_OFF, HOLIDAYS)
        assert end.astimezone(IST) == _ist(2026, 6, 1, 13, 0)

    def test_after_hours_friday_starts_monday(self):
        # Fri 2026-06-05 17:50 IST + 2h -> Mon 2026-06-08 11:00 IST (skips Sat eve, Sun)
        start = _ist(2026, 6, 5, 17, 50)
        end = calculate_plan_time(start, 2, OFFICE_START, OFFICE_END, WEEKLY_OFF, HOLIDAYS).astimezone(IST)
        # 10 min left Friday (17:50->18:00), remaining 1h50m into Monday from 10:00 -> 11:50
        assert end == _ist(2026, 6, 8, 11, 50)

    def test_holiday_is_skipped(self):
        # Mon 2026-06-01 is a holiday; start Mon 10:00 +1h -> Tue 11:00
        start = _ist(2026, 6, 1, 10, 0)
        end = calculate_plan_time(start, 1, OFFICE_START, OFFICE_END, WEEKLY_OFF, ["2026-06-01"]).astimezone(IST)
        assert end == _ist(2026, 6, 2, 11, 0)

    def test_input_in_utc_is_converted(self):
        # 2026-06-01 05:30 UTC == 11:00 IST ; +1h -> 12:00 IST
        start = datetime(2026, 6, 1, 5, 30, tzinfo=timezone.utc)
        end = calculate_plan_time(start, 1, OFFICE_START, OFFICE_END, WEEKLY_OFF, HOLIDAYS).astimezone(IST)
        assert end == _ist(2026, 6, 1, 12, 0)
```

- [ ] **Step 2: Run it to verify it fails**

Run: `python -m pytest tests/test_fms_tat_engine.py -v`
Expected: FAIL — `ImportError: cannot import name 'IST'` (and possibly assertion failures on the UTC-based math).

- [ ] **Step 3: Add `IST` and rewrite the engine**

In `backend/routes/fms_routes.py`, after the imports (around line 19) add:

```python
IST = timezone(timedelta(hours=5, minutes=30))
```

Replace `calculate_plan_time` (lines ~58–112) with:

```python
def calculate_plan_time(
    from_dt: datetime,
    tat_hours: float,
    office_start: int,
    office_end: int,
    weekly_off: List[int],
    holidays: List[str],
) -> datetime:
    """Add tat_hours of working time to from_dt, respecting IST office hours,
    weekly-off days and holidays. Input may be any tz; result is returned in UTC."""
    if from_dt.tzinfo is None:
        from_dt = from_dt.replace(tzinfo=timezone.utc)
    current = from_dt.astimezone(IST)
    remaining = tat_hours * 60  # minutes
    max_iter, iterations = 5000, 0
    while remaining > 0 and iterations < max_iter:
        iterations += 1
        d = current.date()
        if not _is_working_day(d, weekly_off, holidays):
            current = datetime.combine(d + timedelta(days=1), dtime(office_start, 0), tzinfo=IST)
            continue
        if current.hour < office_start:
            current = current.replace(hour=office_start, minute=0, second=0, microsecond=0)
        if current.hour >= office_end:
            current = datetime.combine(d + timedelta(days=1), dtime(office_start, 0), tzinfo=IST)
            continue
        end_today = current.replace(hour=office_end, minute=0, second=0, microsecond=0)
        slot_mins = (end_today - current).total_seconds() / 60
        if remaining <= slot_mins:
            current += timedelta(minutes=remaining)
            remaining = 0
        else:
            remaining -= slot_mins
            current = datetime.combine(d + timedelta(days=1), dtime(office_start, 0), tzinfo=IST)
    return current.astimezone(timezone.utc)
```

Replace `working_minutes_elapsed` (lines ~114–130) with an IST-based version:

```python
def working_minutes_elapsed(start: datetime, end: datetime,
                             office_start: int, office_end: int,
                             weekly_off: List[int], holidays: List[str]) -> float:
    """Count working minutes (IST office hours, skipping off-days/holidays) between two instants."""
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    if end.tzinfo is None:
        end = end.replace(tzinfo=timezone.utc)
    start, end = start.astimezone(IST), end.astimezone(IST)
    if start >= end:
        return 0.0
    total = 0.0
    cur = start
    while cur < end:
        d = cur.date()
        if _is_working_day(d, weekly_off, holidays):
            day_start = max(cur, datetime.combine(d, dtime(office_start, 0), tzinfo=IST))
            day_end = min(end, datetime.combine(d, dtime(office_end, 0), tzinfo=IST))
            if day_end > day_start:
                total += (day_end - day_start).total_seconds() / 60
        cur = datetime.combine(d + timedelta(days=1), dtime(office_start, 0), tzinfo=IST)
    return total
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `python -m pytest tests/test_fms_tat_engine.py::TestCalculatePlanTime -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/routes/fms_routes.py backend/tests/test_fms_tat_engine.py
git commit -m "fix(fms): compute TAT in IST not UTC

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Real `tat_status` + `score_stage`

**Files:**
- Modify: `backend/routes/fms_routes.py` (lines ~132–154)
- Test: `backend/tests/test_fms_tat_engine.py`

- [ ] **Step 1: Add failing tests**

Append to `backend/tests/test_fms_tat_engine.py`:

```python
class TestTatStatus:
    def test_done_on_time_is_green(self):
        ps = datetime(2026, 6, 1, 4, 0, tzinfo=timezone.utc)
        pd = datetime(2026, 6, 1, 8, 0, tzinfo=timezone.utc)
        ad = datetime(2026, 6, 1, 7, 0, tzinfo=timezone.utc)
        assert tat_status(ps, pd, ad) == "green"

    def test_done_late_is_red(self):
        ps = datetime(2026, 6, 1, 4, 0, tzinfo=timezone.utc)
        pd = datetime(2026, 6, 1, 8, 0, tzinfo=timezone.utc)
        ad = datetime(2026, 6, 1, 9, 0, tzinfo=timezone.utc)
        assert tat_status(ps, pd, ad) == "red"

    def test_open_past_plan_is_overdue(self):
        ps = datetime(2020, 1, 1, 0, 0, tzinfo=timezone.utc)
        pd = datetime(2020, 1, 1, 1, 0, tzinfo=timezone.utc)  # long past
        assert tat_status(ps, pd, None) == "overdue"

    def test_open_early_is_green(self):
        now = datetime.now(timezone.utc)
        ps = now - timedelta(minutes=1)
        pd = now + timedelta(hours=10)   # ~0% elapsed
        assert tat_status(ps, pd, None) == "green"

    def test_open_past_warn_is_orange(self):
        now = datetime.now(timezone.utc)
        ps = now - timedelta(minutes=60)
        pd = now + timedelta(minutes=40)  # 60/100 = 60% elapsed -> orange (>=0.5, <0.8)
        assert tat_status(ps, pd, None) == "orange"


class TestScoreStage:
    def test_on_time_is_100(self):
        ps = datetime(2026, 6, 1, 4, 0, tzinfo=timezone.utc)
        pd = datetime(2026, 6, 1, 8, 0, tzinfo=timezone.utc)
        ad = datetime(2026, 6, 1, 6, 0, tzinfo=timezone.utc)
        assert score_stage(ps, pd, ad) == 100

    def test_one_budget_late_is_50(self):
        ps = datetime(2026, 6, 1, 4, 0, tzinfo=timezone.utc)
        pd = datetime(2026, 6, 1, 8, 0, tzinfo=timezone.utc)   # 240 min budget
        ad = datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc)  # 240 min late
        assert score_stage(ps, pd, ad) == 50

    def test_two_budget_late_is_0(self):
        ps = datetime(2026, 6, 1, 4, 0, tzinfo=timezone.utc)
        pd = datetime(2026, 6, 1, 8, 0, tzinfo=timezone.utc)   # 240 min budget
        ad = datetime(2026, 6, 1, 16, 0, tzinfo=timezone.utc)  # 480 min late
        assert score_stage(ps, pd, ad) == 0

    def test_missing_actual_is_0(self):
        ps = datetime(2026, 6, 1, 4, 0, tzinfo=timezone.utc)
        pd = datetime(2026, 6, 1, 8, 0, tzinfo=timezone.utc)
        assert score_stage(ps, pd, None) == 0
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest tests/test_fms_tat_engine.py::TestTatStatus tests/test_fms_tat_engine.py::TestScoreStage -v`
Expected: FAIL — current `tat_status(planned_dt, actual_dt)` has wrong signature/logic; `score_stage` uses hardcoded 60 min.

- [ ] **Step 3: Rewrite both functions**

Replace `tat_status` (lines ~132–143) and `score_stage` (lines ~145–154) with:

```python
def tat_status(plan_start: Optional[datetime], plan_done: Optional[datetime],
               actual_done: Optional[datetime] = None,
               warn_pct: float = 0.5, red_pct: float = 0.8) -> str:
    """green / orange / red / overdue / pending based on elapsed fraction of the TAT window."""
    if not plan_done or not plan_start:
        return "pending"
    if actual_done:
        return "green" if actual_done <= plan_done else "red"
    now = now_utc()
    total = (plan_done - plan_start).total_seconds()
    if total <= 0:
        return "overdue" if now >= plan_done else "green"
    pct = max(0.0, (now - plan_start).total_seconds() / total)
    if pct >= 1.0:
        return "overdue"
    if pct >= red_pct:
        return "red"
    if pct >= warn_pct:
        return "orange"
    return "green"


def score_stage(plan_start: Optional[datetime], plan_done: Optional[datetime],
                actual_done: Optional[datetime]) -> int:
    """100 = on time or early. Linear down to 0 at 2x-budget late. Missing data = 0."""
    if not plan_start or not plan_done or not actual_done:
        return 0
    planned_mins = max(1.0, (plan_done - plan_start).total_seconds() / 60)
    if actual_done <= plan_done:
        return 100
    late = (actual_done - plan_done).total_seconds() / 60
    return max(0, round(100 - (late / planned_mins) * 50))
```

- [ ] **Step 4: Update call sites of `score_stage` in `complete_stage`**

In `complete_stage` (around line 365–367) the call is `score = score_stage(plan_done, now)`. Replace the block:

```python
    now = now_utc()
    plan_start = datetime.fromisoformat(stage["plan_start"]) if stage.get("plan_start") else now
    plan_done = datetime.fromisoformat(stage["plan_done"]) if stage.get("plan_done") else now

    # Calculate tat status and score
    t_status = "green" if now <= plan_done else "red"
    score = score_stage(plan_start, plan_done, now)
```

- [ ] **Step 5: Run tests to verify pass**

Run: `python -m pytest tests/test_fms_tat_engine.py -v`
Expected: PASS (all tests in the file).

- [ ] **Step 6: Commit**

```bash
git add backend/routes/fms_routes.py backend/tests/test_fms_tat_engine.py
git commit -m "fix(fms): real tat_status thresholds and TAT-relative scoring

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Audit log (`fms_stage_logs`) + helper

**Files:**
- Modify: `backend/routes/fms_routes.py`
- Test: `backend/tests/test_fms_fix_complete.py`

- [ ] **Step 1: Write the failing integration test**

Create `backend/tests/test_fms_fix_complete.py`:

```python
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
    return s


@pytest.fixture(scope="session")
def sales(admin):
    """Fresh sales_person session (default role on register)."""
    email = f"TEST_fms_sp_{uuid.uuid4().hex[:8]}@smartshape.com"
    pw = "Test@1234"
    r = requests.post(f"{BASE_URL}/api/auth/register",
                      json={"email": email, "password": pw, "name": "TEST FMS SP"}, timeout=15)
    if r.status_code not in (200, 201):
        pytest.skip(f"register disabled: {r.status_code} {r.text}")
    s = requests.Session()
    r2 = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pw}, timeout=15)
    assert r2.status_code == 200, r2.text
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
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest tests/test_fms_fix_complete.py::TestAuditLog -v`
Expected: FAIL — `GET /api/fms/flows/{id}/logs` returns 404 (endpoint doesn't exist) or 405.

- [ ] **Step 3: Add the log helper and endpoint**

In `backend/routes/fms_routes.py`, add the helper near the other helpers (after `gen_id`):

```python
async def _log_stage(flow_id: str, stage: dict, action: str,
                     user: Optional[dict] = None, note: str = "",
                     from_status: str = "", to_status: str = ""):
    await db.fms_stage_logs.insert_one({
        "log_id": gen_id("flog"),
        "flow_id": flow_id,
        "stage_id": stage.get("stage_id") if stage else None,
        "stage_label": stage.get("label") if stage else None,
        "action": action,
        "from_status": from_status,
        "to_status": to_status,
        "by": (user or {}).get("email", "system"),
        "note": note,
        "at": now_iso(),
    })
```

Add the endpoint after `get_flow` (around line 233):

```python
@router.get("/flows/{flow_id}/logs")
async def get_flow_logs(flow_id: str, request: Request):
    await get_current_user(request)
    return await db.fms_stage_logs.find(
        {"flow_id": flow_id}, {"_id": 0}
    ).sort("at", 1).to_list(500)
```

- [ ] **Step 4: Call `_log_stage` at every mutation point**

- In `create_flow`, after `await db.fms_stages.insert_many(stage_docs)` (line ~295), before creating the delegation task:
```python
    for sd in stage_docs:
        await _log_stage(flow_id, sd, "created", user, to_status=sd["status"])
```
- In `complete_stage`, after the `update_one` (line ~374):
```python
    await _log_stage(stage["flow_id"], {**stage, **update}, "completed", user,
                     note=body.get("note", ""), from_status=stage["status"],
                     to_status=update["status"])
```
- In `approve_stage`, after its `update_one`:
```python
    await _log_stage(stage["flow_id"], stage, "approved", user, to_status="done")
```
- In `reject_stage` — handled in Task 4.
- In `_advance_flow`, after activating the next stage (line ~442):
```python
    await _log_stage(flow_id, {**next_stage, "stage_id": next_stage["stage_id"]},
                     "activated", None, to_status="active")
```

- [ ] **Step 5: Run the test to verify pass**

Restart the backend (so route changes load), then:
Run: `python -m pytest tests/test_fms_fix_complete.py::TestAuditLog -v`
Expected: PASS.

- [ ] **Step 6: Add index + commit**

In `backend/database.py` find where indexes are created (search `create_index`) and add, following the existing pattern:
```python
    await db.fms_stage_logs.create_index([("flow_id", 1), ("at", 1)])
    await db.fms_stages.create_index([("status", 1), ("plan_done", 1)])
    await db.fms_notifications.create_index([("stage_id", 1), ("kind", 1), ("channel", 1)])
```
If `database.py` has no index-creation block, add these in `main.py` startup after the DB connects (search `@app.on_event("startup")` or the lifespan). Then:

```bash
git add backend/routes/fms_routes.py backend/tests/test_fms_fix_complete.py backend/database.py backend/main.py
git commit -m "feat(fms): append-only stage audit log + indexes

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Fix `reject_stage` (keep rejected state, create redo stage)

**Files:**
- Modify: `backend/routes/fms_routes.py` (lines ~397–411)
- Test: `backend/tests/test_fms_fix_complete.py`

- [ ] **Step 1: Add failing test**

Append to `backend/tests/test_fms_fix_complete.py`:

```python
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
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest tests/test_fms_fix_complete.py::TestReject -v`
Expected: FAIL — current code overwrites `rejected` with `active` on the same stage; no redo stage; `reject_reason` lost.

- [ ] **Step 3: Rewrite `reject_stage`**

Replace `reject_stage` (lines ~397–411) with:

```python
@router.post("/stages/{stage_id}/reject")
async def reject_stage(stage_id: str, request: Request):
    user = await get_current_user(request)
    cfg = await get_fms_settings()
    body = await request.json()
    stage = await db.fms_stages.find_one({"stage_id": stage_id})
    if not stage:
        raise HTTPException(404, "Stage not found")

    # Keep the original stage in 'rejected' state with the reason preserved.
    await db.fms_stages.update_one({"stage_id": stage_id}, {"$set": {
        "status": "rejected",
        "approval_status": "rejected",
        "approval_by": user.get("email"),
        "reject_reason": body.get("reason", ""),
        "rejected_at": now_iso(),
    }})
    await _log_stage(stage["flow_id"], stage, "rejected", user,
                     note=body.get("reason", ""), from_status=stage["status"],
                     to_status="rejected")

    # Create a fresh redo stage at the same order so the flow can proceed.
    now = now_utc()
    plan_done = calculate_plan_time(
        now, stage.get("tat_hours", 4),
        cfg["office_start"], cfg["office_end"], cfg["weekly_off"], cfg["holidays"],
    )
    redo = {
        "stage_id": gen_id("stg"), "flow_id": stage["flow_id"],
        "order": stage["order"], "key": f"{stage['key']}_redo",
        "label": f"{stage['label']} (Redo)", "team": stage["team"],
        "tat_hours": stage.get("tat_hours", 4), "needs_approval": stage.get("needs_approval", False),
        "status": "active",
        "plan_start": now.isoformat(), "plan_done": plan_done.isoformat(),
        "actual_start": now.isoformat(), "actual_done": None,
        "assigned_to": stage.get("assigned_to", ""),
        "customer_notify": stage.get("customer_notify", False),
        "done_by": None, "done_note": "", "approval_status": None, "approval_by": None,
        "tat_status": "pending", "score": None,
    }
    await db.fms_stages.insert_one(redo)
    await _log_stage(stage["flow_id"], redo, "reworked", user, to_status="active")
    return {"message": "Rejected — redo stage created"}
```

- [ ] **Step 4: Run test to verify pass**

Restart backend. Run: `python -m pytest tests/test_fms_fix_complete.py::TestReject -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/fms_routes.py backend/tests/test_fms_fix_complete.py
git commit -m "fix(fms): reject keeps rejected state and spawns a redo stage

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

# PHASE 2 — RBAC

### Task 5: Field masking on read endpoints

**Files:**
- Modify: `backend/routes/fms_routes.py` (imports; `list_flows`, `get_flow`, `fms_dashboard`, `get_payments`)
- Test: `backend/tests/test_fms_fix_complete.py`

- [ ] **Step 1: Add failing test**

Append to `backend/tests/test_fms_fix_complete.py`:

```python
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
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest tests/test_fms_fix_complete.py::TestRbacMasking -v`
Expected: FAIL — sales sees `amount` and `customer_phone` (no masking).

- [ ] **Step 3: Add masking helper and apply it**

In `backend/routes/fms_routes.py` imports (top), add:
```python
from rbac import get_team
```

Add the helper near the other helpers:
```python
# Fields hidden from each team on flow read responses
_MASK_BY_TEAM = {
    "sales": ["amount", "customer_phone"],
    "store": ["amount"],
}

def _mask_flow(flow: dict, team: str) -> dict:
    """Strip sensitive fields from a flow dict for non-privileged teams."""
    hidden = _MASK_BY_TEAM.get(team, [])
    if not hidden:
        return flow
    return {k: ("" if k in hidden else v) for k, v in flow.items()}
```

Apply in each read endpoint:

- `list_flows` (line ~217) — change the body end to:
```python
    user = await get_current_user(request)
    q = {}
    if flow_type: q["flow_type"] = flow_type
    if status:    q["status"]    = status
    flows = await db.fms_flows.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)
    team = get_team(user)
    return [_mask_flow(f, team) for f in flows]
```

- `get_flow` (line ~227) — capture the user and mask:
```python
@router.get("/flows/{flow_id}")
async def get_flow(flow_id: str, request: Request):
    user = await get_current_user(request)
    flow = await db.fms_flows.find_one({"flow_id": flow_id}, {"_id": 0})
    if not flow: raise HTTPException(404, "Flow not found")
    stages = await db.fms_stages.find({"flow_id": flow_id}, {"_id": 0}).sort("order", 1).to_list(50)
    return {**_mask_flow(flow, get_team(user)), "stages": stages}
```
NOTE: `create_flow` calls `get_flow(flow_id, request)` to build its response — that still works (admin/accounts unmasked; if a sales user ever creates a flow they get the masked view, which is correct).

- `fms_dashboard` (line ~637) — mask each flow in `result`:
```python
    user = await get_current_user(request)
    team = get_team(user)
    ...
        result.append({**_mask_flow(flow, team), "stages": stages})
```

- `get_payments` (line ~595) — for sales/store, zero out amounts:
```python
@router.get("/payments/{flow_id}")
async def get_payments(flow_id: str, request: Request):
    user = await get_current_user(request)
    payments = await db.fms_payments.find({"flow_id": flow_id}, {"_id": 0}).sort("created_at", 1).to_list(20)
    flow = await db.fms_flows.find_one({"flow_id": flow_id}, {"_id": 0}) or {}
    if get_team(user) in ("sales", "store"):
        raise HTTPException(403, "Payment data not visible for your role")
    total = flow.get("amount", 0)
    collected = sum(p["amount"] for p in payments)
    balance = total - collected
    return {"payments": payments, "total": total, "collected": collected, "balance": balance,
            "pct_collected": round(collected / total * 100, 1) if total else 0}
```

- [ ] **Step 4: Run test to verify pass**

Restart backend. Run: `python -m pytest tests/test_fms_fix_complete.py::TestRbacMasking -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/fms_routes.py backend/tests/test_fms_fix_complete.py
git commit -m "feat(fms): RBAC field masking on flow reads (sales/store)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Stage edit-lock (write gating)

**Files:**
- Modify: `backend/routes/fms_routes.py` (`complete_stage`, `approve_stage`, `reject_stage`, `submit_qc`, `submit_checklist`)
- Test: `backend/tests/test_fms_fix_complete.py`

- [ ] **Step 1: Add failing test**

Append to `backend/tests/test_fms_fix_complete.py`:

```python
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
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest tests/test_fms_fix_complete.py::TestStageEditLock -v`
Expected: FAIL — any authenticated user can complete any stage (returns 200).

- [ ] **Step 3: Add the gate helper and apply**

In `backend/routes/fms_routes.py`, add near helpers:

```python
# Map a stage's logical team to the user teams allowed to act on it.
# (dispatch/purchase/management/field consolidate under store/admin in this ERP.)
_STAGE_TEAM_ALLOWED = {
    "sales":      {"sales", "admin"},
    "store":      {"store", "admin"},
    "dispatch":   {"store", "admin"},
    "purchase":   {"store", "admin"},
    "accounts":   {"accounts", "admin"},
    "management": {"admin"},
    "field":      {"sales", "admin"},
}

def _require_stage_team(user: dict, stage: dict):
    team = get_team(user)
    allowed = _STAGE_TEAM_ALLOWED.get(stage.get("team", ""), {"admin"})
    if team not in allowed:
        raise HTTPException(403, f"Your role ({team}) cannot act on a {stage.get('team')} stage")
```

Apply the gate right after each handler fetches its stage and confirms it exists:
- `complete_stage` (after the `if not stage` check, ~line 357): `_require_stage_team(user, stage)`
- `approve_stage` (after `if not stage`, ~line 389): `_require_stage_team(user, stage)`
- `reject_stage` (after `if not stage`): `_require_stage_team(user, stage)`
- `submit_qc` (after fetching the stage via `body.stage_id`; fetch it first):
```python
    stage = await db.fms_stages.find_one({"stage_id": body.stage_id}, {"_id": 0})
    if not stage: raise HTTPException(404, "Stage not found")
    _require_stage_team(user, stage)
```
- `submit_checklist` — checklists are a store/dispatch concern; gate by team:
```python
    if get_team(user) not in ("store", "admin"):
        raise HTTPException(403, "Only store/admin can submit the pre-dispatch checklist")
```

- [ ] **Step 4: Run test to verify pass**

Restart backend. Run: `python -m pytest tests/test_fms_fix_complete.py::TestStageEditLock -v`
Expected: PASS.

- [ ] **Step 5: Run the whole FMS suite to confirm no regressions**

Run: `python -m pytest tests/test_fms_fix_complete.py tests/test_fms_tat_engine.py -v`
Expected: all PASS. (Admin acts on all stages in earlier tests, so the gate doesn't break them.)

- [ ] **Step 6: Commit**

```bash
git add backend/routes/fms_routes.py backend/tests/test_fms_fix_complete.py
git commit -m "feat(fms): stage edit-lock — only stage's team or admin may act

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

# PHASE 3 — Notification engine

### Task 7: Extend settings (thresholds + templates)

**Files:**
- Modify: `backend/routes/fms_routes.py` (`get_fms_settings`, `update_settings`)
- Test: `backend/tests/test_fms_fix_complete.py`

- [ ] **Step 1: Add failing test**

Append:

```python
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
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest tests/test_fms_fix_complete.py::TestSettings -v`
Expected: FAIL — settings lack notification keys.

- [ ] **Step 3: Extend `get_fms_settings` and the `update_settings` whitelist**

Replace `get_fms_settings` (lines ~46–53) with:

```python
_DEFAULT_TEMPLATES = {
    "staff_warning":  "Reminder: {stage} for {title} ({ref}) is due by {due}.",
    "staff_escalate": "URGENT: {stage} for {title} ({ref}) is nearly overdue (due {due}).",
    "staff_breach":   "OVERDUE: {stage} for {title} ({ref}) missed its deadline ({due}).",
    "manager_breach": "{assignee} missed {stage} for {title} ({ref}), due {due}.",
    "customer_stage": "Hi {customer_name}, update on your order {ref}: {stage} is complete.",
}

async def get_fms_settings() -> dict:
    s = await db.fms_settings.find_one({"type": "fms"}, {"_id": 0}) or {}
    return {
        "office_start":  s.get("office_start", DEFAULT_OFFICE_START),
        "office_end":    s.get("office_end",   DEFAULT_OFFICE_END),
        "weekly_off":    s.get("weekly_off",   DEFAULT_WEEKLY_OFF),
        "holidays":      s.get("holidays",     []),
        "status_warning_pct":  s.get("status_warning_pct", 0.5),
        "status_red_pct":      s.get("status_red_pct", 0.8),
        "notify_warning_pct":  s.get("notify_warning_pct", 0.5),
        "notify_escalate_pct": s.get("notify_escalate_pct", 0.2),
        "notify_on_breach":    s.get("notify_on_breach", True),
        "notify_channels":     s.get("notify_channels", ["whatsapp", "email"]),
        "templates":           {**_DEFAULT_TEMPLATES, **(s.get("templates") or {})},
    }
```

In `update_settings` (line ~189), extend the whitelist:
```python
    safe = {k: v for k, v in body.items() if k in (
        "office_start", "office_end", "weekly_off", "holidays",
        "status_warning_pct", "status_red_pct",
        "notify_warning_pct", "notify_escalate_pct", "notify_on_breach",
        "notify_channels", "templates",
    )}
```

- [ ] **Step 4: Run test to verify pass**

Restart backend. Run: `python -m pytest tests/test_fms_fix_complete.py::TestSettings -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/fms_routes.py backend/tests/test_fms_fix_complete.py
git commit -m "feat(fms): notification thresholds + message templates in settings

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: `compute_live_tat` (pause-aware) + `render_template` helpers

**Files:**
- Modify: `backend/routes/fms_routes.py`
- Test: `backend/tests/test_fms_tat_engine.py`

- [ ] **Step 1: Add failing unit tests**

Append to `backend/tests/test_fms_tat_engine.py`:

```python
from routes.fms_routes import render_template, pct_remaining


class TestRenderTemplate:
    def test_substitutes_placeholders(self):
        tpl = "Reminder: {stage} for {title} ({ref}) due {due}"
        out = render_template(tpl, stage="QC", title="Order#9", ref="FLOW1", due="2026-06-05")
        assert out == "Reminder: QC for Order#9 (FLOW1) due 2026-06-05"

    def test_missing_key_left_blank(self):
        out = render_template("Hi {customer_name}", customer_name="")
        assert out == "Hi "


class TestPctRemaining:
    def test_half_remaining(self):
        from datetime import datetime, timezone, timedelta
        now = datetime.now(timezone.utc)
        ps = now - timedelta(hours=1)
        pd = now + timedelta(hours=1)   # 1h of 2h left -> 0.5
        assert abs(pct_remaining(ps, pd) - 0.5) < 0.05

    def test_overdue_is_zero(self):
        from datetime import datetime, timezone, timedelta
        now = datetime.now(timezone.utc)
        ps = now - timedelta(hours=2)
        pd = now - timedelta(hours=1)
        assert pct_remaining(ps, pd) == 0.0
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest tests/test_fms_tat_engine.py::TestRenderTemplate tests/test_fms_tat_engine.py::TestPctRemaining -v`
Expected: FAIL — `render_template`, `pct_remaining` not defined.

- [ ] **Step 3: Add the helpers**

In `backend/routes/fms_routes.py`, add near the TAT helpers:

```python
def render_template(tpl: str, **kw) -> str:
    """Safe template fill: unknown placeholders render blank, never raise."""
    class _Blank(dict):
        def __missing__(self, k): return ""
    try:
        return tpl.format_map(_Blank(kw))
    except Exception:
        return tpl

def pct_remaining(plan_start: datetime, plan_done: datetime,
                  paused_intervals: Optional[list] = None) -> float:
    """Fraction of the TAT window still remaining (0..1). Subtracts paused time."""
    now = now_utc()
    total = (plan_done - plan_start).total_seconds()
    if total <= 0:
        return 0.0 if now >= plan_done else 1.0
    paused = _paused_seconds(paused_intervals or [], plan_start, now)
    elapsed = max(0.0, (now - plan_start).total_seconds() - paused)
    rem = 1.0 - (elapsed / total)
    return max(0.0, min(1.0, rem))

def _paused_seconds(intervals: list, lo: datetime, hi: datetime) -> float:
    """Total seconds of paused intervals that fall within [lo, hi]."""
    total = 0.0
    for iv in intervals:
        try:
            a = datetime.fromisoformat(iv["from"])
            b = datetime.fromisoformat(iv["to"]) if iv.get("to") else hi
        except Exception:
            continue
        a = max(a, lo); b = min(b, hi)
        if b > a:
            total += (b - a).total_seconds()
    return total
```

- [ ] **Step 4: Run tests to verify pass**

Run: `python -m pytest tests/test_fms_tat_engine.py -v`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add backend/routes/fms_routes.py backend/tests/test_fms_tat_engine.py
git commit -m "feat(fms): render_template + pause-aware pct_remaining helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: SLA notification loop in scheduler

**Files:**
- Modify: `backend/scheduler.py`
- Test: manual + `backend/tests/test_fms_fix_complete.py` (dedupe via direct DB-free API assertion)

Because sends go to real WhatsApp/email, the loop checks an env flag `FMS_NOTIFY_DRY_RUN` to log instead of send during tests. The dedupe logic is what we assert.

- [ ] **Step 1: Add send helpers, recipient resolver, and the loop to `scheduler.py`**

At the top of `backend/scheduler.py`, add imports:
```python
import os
from services.evolution_client import evolution
from routes.fms_routes import get_fms_settings, render_template, pct_remaining
```

Add before `start_scheduler`:

```python
FMS_DRY_RUN = os.getenv("FMS_NOTIFY_DRY_RUN", "0") == "1"


async def _fms_send_wa(phone: str, text: str) -> tuple[bool, str]:
    if not phone:
        return False, "no_phone"
    if FMS_DRY_RUN:
        log.info(f"[fms][dry] WA -> {phone}: {text[:60]}")
        return True, ""
    try:
        await evolution.send_text(phone, text)
        return True, ""
    except Exception as e:
        return False, str(e)[:200]


async def _fms_send_email(to_email: str, subject: str, body: str) -> tuple[bool, str]:
    if not to_email or "@" not in to_email:
        return False, "no_email"
    if FMS_DRY_RUN:
        log.info(f"[fms][dry] EMAIL -> {to_email}: {subject}")
        return True, ""
    cfg = await _email_cfg()
    if not cfg:
        return False, "email_not_configured"
    se, ap, sn = cfg
    try:
        await asyncio.to_thread(_smtp_send, se, ap, sn, to_email, subject, body)
        return True, ""
    except Exception as e:
        return False, str(e)[:200]


async def _resolve_recipient(email: str) -> dict:
    """Return {name, email, phone} for a staff member, looking in users then del_employees."""
    if not email:
        return {}
    u = await db.users.find_one({"email": email}, {"_id": 0}) or {}
    emp = await db.del_employees.find_one({"email": email}, {"_id": 0}) or {}
    return {
        "name": u.get("name") or emp.get("name") or email,
        "email": email,
        "phone": u.get("phone") or u.get("mobile") or emp.get("phone") or "",
        "manager_email": emp.get("manager_email") or "",
        "department_id": emp.get("department_id", ""),
    }


async def _fms_already_sent(stage_id: str, kind: str, channel: str) -> bool:
    return bool(await db.fms_notifications.find_one(
        {"stage_id": stage_id, "kind": kind, "channel": channel, "status": "sent"}))


async def _fms_record(flow_id, stage_id, kind, channel, recipient, ok, err):
    await db.fms_notifications.insert_one({
        "notif_id": f"fnotif_{uuid.uuid4().hex[:10]}",
        "flow_id": flow_id, "stage_id": stage_id, "kind": kind,
        "channel": channel, "recipient": recipient,
        "status": "sent" if ok else "failed", "error": err,
        "sent_at": datetime.now(timezone.utc).isoformat(),
    })


async def _fms_notify(flow, stage, kind, channels, templates, recipient):
    """Send `kind` notification to `recipient` over each channel, deduped, recorded."""
    tpl = templates.get(kind, "")
    due = (stage.get("plan_done") or "")[:16].replace("T", " ")
    text = render_template(
        tpl, stage=stage.get("label", ""), title=flow.get("title", ""),
        ref=flow.get("reference_id") or flow.get("flow_id", ""),
        due=due, customer_name=flow.get("customer_name", ""),
        assignee=recipient.get("name", ""),
    )
    subject = f"[SmartShape FMS] {stage.get('label','')}"
    for ch in channels:
        if await _fms_already_sent(stage["stage_id"], kind, ch):
            continue
        if ch == "whatsapp":
            ok, err = await _fms_send_wa(recipient.get("phone", ""), text)
        elif ch == "email":
            ok, err = await _fms_send_email(recipient.get("email", ""), subject, text)
        else:
            ok, err = False, "unknown_channel"
        await _fms_record(flow["flow_id"], stage["stage_id"], kind, ch,
                          recipient.get("email") or recipient.get("phone"), ok, err)


async def run_fms_sla_check():
    cfg = await get_fms_settings()
    channels = cfg["notify_channels"]
    templates = cfg["templates"]
    now = datetime.now(timezone.utc)

    stages = await db.fms_stages.find({"status": "active"}, {"_id": 0}).to_list(1000)
    for stage in stages:
        if not stage.get("plan_start") or not stage.get("plan_done"):
            continue
        ps = datetime.fromisoformat(stage["plan_start"])
        pd = datetime.fromisoformat(stage["plan_done"])
        rem = pct_remaining(ps, pd, stage.get("paused_intervals"))
        flow = await db.fms_flows.find_one({"flow_id": stage["flow_id"]}, {"_id": 0})
        if not flow or flow.get("status") not in ("active", "blocked"):
            continue
        recipient = await _resolve_recipient(stage.get("assigned_to", ""))

        # breach
        if cfg["notify_on_breach"] and now >= pd:
            await _fms_notify(flow, stage, "staff_breach", channels, templates, recipient)
            mgr = recipient.get("manager_email")
            if mgr:
                mgr_r = await _resolve_recipient(mgr)
                await _fms_notify(flow, stage, "manager_breach", channels, templates, mgr_r)
        # escalate
        elif rem <= cfg["notify_escalate_pct"]:
            await _fms_notify(flow, stage, "staff_escalate", channels, templates, recipient)
        # warning
        elif rem <= cfg["notify_warning_pct"]:
            await _fms_notify(flow, stage, "staff_warning", channels, templates, recipient)


async def fms_sla_loop():
    log.info("[scheduler] FMS SLA checker started (interval: 5 min)")
    while True:
        try:
            await run_fms_sla_check()
        except Exception as exc:
            log.error(f"[fms sla loop] {exc}")
        await asyncio.sleep(300)
```

- [ ] **Step 2: Wire into `start_scheduler`**

In `start_scheduler` (line ~523), add:
```python
    asyncio.create_task(fms_sla_loop())
    log.info("[scheduler] FMS SLA loop running")
```
And update the final log line count from "4 background jobs" to "5".

- [ ] **Step 3: Verify import does not create a cycle**

Run from `backend/`: `python -c "import scheduler"`
Expected: no `ImportError` / no circular-import error. (`routes.fms_routes` does not import `scheduler`, so this is safe.)

- [ ] **Step 4: Manual dry-run verification**

With backend stopped, run a one-shot dry-run from `backend/`:
```bash
FMS_NOTIFY_DRY_RUN=1 python -c "import asyncio, scheduler; asyncio.run(scheduler.run_fms_sla_check())"
```
Expected: runs without error; logs `[fms][dry]` lines only if active stages are near/over deadline. (On Windows PowerShell: `$env:FMS_NOTIFY_DRY_RUN=1; python -c "..."`.)

- [ ] **Step 5: Add dedupe integration test**

Append to `backend/tests/test_fms_fix_complete.py`:

```python
class TestNotificationDedupe:
    def test_breach_notifications_dedupe(self, admin):
        # A flow whose first stage is already overdue: set a tiny TAT via custom template
        tmpl = admin.post(f"{BASE_URL}/api/fms/templates", json={
            "name": f"TEST_FAST_{uuid.uuid4().hex[:5]}",
            "stages": [{"key": "fast", "label": "Fast Stage", "team": "sales",
                        "tat_hours": 0.0001, "needs_approval": False}],
        }, timeout=15)
        assert tmpl.status_code in (200, 201), tmpl.text
        tid = tmpl.json()["template_id"]
        flow = admin.post(f"{BASE_URL}/api/fms/flows", json={
            "flow_type": "order", "template_id": tid, "title": "TEST breach",
            "customer_name": "C", "customer_phone": "9000000000", "amount": 1,
        }, timeout=20).json()
        # Trigger two SLA passes via the debug endpoint (Task 9b)
        r1 = admin.post(f"{BASE_URL}/api/fms/_run-sla?dry=1", timeout=20)
        assert r1.status_code == 200, r1.text
        r2 = admin.post(f"{BASE_URL}/api/fms/_run-sla?dry=1", timeout=20)
        assert r2.status_code == 200, r2.text
        # notifications for this flow's stage: exactly one 'sent' per (kind, channel)
        notifs = admin.get(f"{BASE_URL}/api/fms/_notifications/{flow['flow_id']}", timeout=15).json()
        seen = {}
        for n in notifs:
            if n["status"] != "sent":
                continue
            k = (n["stage_id"], n["kind"], n["channel"])
            seen[k] = seen.get(k, 0) + 1
        assert all(v == 1 for v in seen.values()), f"dedupe failed: {seen}"
```

- [ ] **Step 6: Add the admin-only debug endpoints (Task 9b)**

In `backend/routes/fms_routes.py`, add (admin-gated):
```python
from rbac import require_admin

@router.post("/_run-sla")
async def debug_run_sla(request: Request, dry: int = 0):
    user = await get_current_user(request)
    require_admin(user)
    import os as _os
    if dry:
        _os.environ["FMS_NOTIFY_DRY_RUN"] = "1"
    from scheduler import run_fms_sla_check   # local import avoids cycle at module load
    await run_fms_sla_check()
    return {"ok": True}

@router.get("/_notifications/{flow_id}")
async def debug_notifications(flow_id: str, request: Request):
    user = await get_current_user(request)
    require_admin(user)
    return await db.fms_notifications.find({"flow_id": flow_id}, {"_id": 0}).to_list(200)
```

- [ ] **Step 7: Run test to verify pass**

Restart backend with `FMS_NOTIFY_DRY_RUN=1` set in its environment (so the debug run records `sent` without real sends). Run:
`python -m pytest tests/test_fms_fix_complete.py::TestNotificationDedupe -v`
Expected: PASS — each (stage, kind, channel) recorded exactly once across two passes.

- [ ] **Step 8: Commit**

```bash
git add backend/scheduler.py backend/routes/fms_routes.py backend/tests/test_fms_fix_complete.py
git commit -m "feat(fms): SLA notification loop (WhatsApp+Email) with dedupe

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Customer-notify-on-stage-complete

**Files:**
- Modify: `backend/routes/fms_routes.py` (stage defs add `customer_notify`; `complete_stage`/`approve_stage` send)
- Test: `backend/tests/test_fms_fix_complete.py`

- [ ] **Step 1: Add `customer_notify` to stage defs and stage docs**

In each stage in `ORDER_STAGES` that should notify the customer, add `"customer_notify": True`. Set it on `dispatch` and `delivery_confirm`:
```python
    {"key": "dispatch",          "label": "Dispatch",              "team": "dispatch",   "tat_hours": 4,   "needs_approval": False, "customer_notify": True},
    ...
    {"key": "delivery_confirm",  "label": "Delivery Confirmation", "team": "sales",      "tat_hours": 48,  "needs_approval": False, "customer_notify": True},
```
In `create_flow`'s stage_doc construction (line ~273), add the field:
```python
            "customer_notify": sd.get("customer_notify", False),
```

- [ ] **Step 2: Add the customer-send helper and call it on completion**

Add to `fms_routes.py`:
```python
async def _maybe_notify_customer(flow: dict, stage: dict):
    if not stage.get("customer_notify"):
        return
    cfg = await get_fms_settings()
    tpl = cfg["templates"].get("customer_stage", "")
    text = render_template(
        tpl, stage=stage.get("label", ""),
        ref=flow.get("reference_id") or flow.get("flow_id", ""),
        customer_name=flow.get("customer_name", ""),
        title=flow.get("title", ""),
    )
    from scheduler import _fms_send_wa, _fms_send_email   # local import avoids cycle
    if "whatsapp" in cfg["notify_channels"] and flow.get("customer_phone"):
        ok, err = await _fms_send_wa(flow["customer_phone"], text)
        await db.fms_notifications.insert_one({
            "notif_id": gen_id("fnotif"), "flow_id": flow["flow_id"], "stage_id": stage["stage_id"],
            "kind": "customer_stage", "channel": "whatsapp", "recipient": flow["customer_phone"],
            "status": "sent" if ok else "failed", "error": err, "sent_at": now_iso(),
        })
    if "email" in cfg["notify_channels"] and flow.get("customer_email"):
        ok, err = await _fms_send_email(flow["customer_email"], "Order update", text)
        await db.fms_notifications.insert_one({
            "notif_id": gen_id("fnotif"), "flow_id": flow["flow_id"], "stage_id": stage["stage_id"],
            "kind": "customer_stage", "channel": "email", "recipient": flow["customer_email"],
            "status": "sent" if ok else "failed", "error": err, "sent_at": now_iso(),
        })
```

Call it in `complete_stage` (non-approval path, just before `_advance_flow`) and in `approve_stage` (before `_advance_flow`):
```python
    flow = await db.fms_flows.find_one({"flow_id": stage["flow_id"]}, {"_id": 0})
    if flow:
        await _maybe_notify_customer(flow, {**stage, **update})
```
(In `approve_stage`, use the stage as-is since it's now done.)

- [ ] **Step 2b: Add `customer_email` to `FlowCreate`**

In `FlowCreate` (line ~204) add:
```python
    customer_email: Optional[str] = ""
```
And include it in `flow_doc` in `create_flow`:
```python
        "customer_email": body.customer_email,
```

- [ ] **Step 3: Add the test**

Append to `backend/tests/test_fms_fix_complete.py`:

```python
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
```

- [ ] **Step 4: Run test (backend in DRY_RUN) to verify pass**

Run: `python -m pytest tests/test_fms_fix_complete.py::TestCustomerNotify -v`
Expected: PASS — a `customer_stage` notification is recorded when dispatch completes.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/fms_routes.py backend/tests/test_fms_fix_complete.py
git commit -m "feat(fms): notify customer on flagged stage completion

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

# PHASE 4 — Pause / hold

### Task 11: Pause & resume endpoints with TAT shift

**Files:**
- Modify: `backend/routes/fms_routes.py`
- Test: `backend/tests/test_fms_fix_complete.py`

- [ ] **Step 1: Add failing test**

Append:

```python
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
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest tests/test_fms_fix_complete.py::TestPauseResume -v`
Expected: FAIL — pause/resume endpoints return 404.

- [ ] **Step 3: Add the endpoints**

In `backend/routes/fms_routes.py`, add after `reject_stage`:

```python
@router.post("/stages/{stage_id}/pause")
async def pause_stage(stage_id: str, request: Request):
    user = await get_current_user(request)
    body = await request.json()
    stage = await db.fms_stages.find_one({"stage_id": stage_id})
    if not stage:
        raise HTTPException(404, "Stage not found")
    _require_stage_team(user, stage)
    if stage["status"] != "active":
        raise HTTPException(400, "Only active stages can be paused")
    intervals = stage.get("paused_intervals", [])
    intervals.append({"from": now_iso(), "to": None, "reason": body.get("reason", "")})
    await db.fms_stages.update_one({"stage_id": stage_id},
        {"$set": {"status": "paused", "paused_intervals": intervals}})
    await _log_stage(stage["flow_id"], stage, "paused", user,
                     note=body.get("reason", ""), from_status="active", to_status="paused")
    return {"message": "Stage paused"}


@router.post("/stages/{stage_id}/resume")
async def resume_stage(stage_id: str, request: Request):
    user = await get_current_user(request)
    cfg = await get_fms_settings()
    stage = await db.fms_stages.find_one({"stage_id": stage_id})
    if not stage:
        raise HTTPException(404, "Stage not found")
    _require_stage_team(user, stage)
    if stage["status"] != "paused":
        raise HTTPException(400, "Stage is not paused")
    intervals = stage.get("paused_intervals", [])
    if intervals and intervals[-1].get("to") is None:
        intervals[-1]["to"] = now_iso()
    # Shift plan_done forward by the working-time spent in the just-closed pause.
    last = intervals[-1]
    paused_from = datetime.fromisoformat(last["from"])
    paused_to = datetime.fromisoformat(last["to"])
    paused_work_mins = working_minutes_elapsed(
        paused_from, paused_to, cfg["office_start"], cfg["office_end"],
        cfg["weekly_off"], cfg["holidays"])
    old_pd = datetime.fromisoformat(stage["plan_done"])
    new_pd = calculate_plan_time(old_pd, paused_work_mins / 60.0,
        cfg["office_start"], cfg["office_end"], cfg["weekly_off"], cfg["holidays"])
    await db.fms_stages.update_one({"stage_id": stage_id}, {"$set": {
        "status": "active", "paused_intervals": intervals,
        "plan_done": new_pd.isoformat()}})
    await _log_stage(stage["flow_id"], stage, "resumed", user,
                     from_status="paused", to_status="active")
    return {"message": "Stage resumed", "plan_done": new_pd.isoformat()}
```

- [ ] **Step 4: Run test to verify pass**

Restart backend. Run: `python -m pytest tests/test_fms_fix_complete.py::TestPauseResume -v`
Expected: PASS.

- [ ] **Step 5: Run the full backend FMS suite**

Run: `python -m pytest tests/test_fms_tat_engine.py tests/test_fms_fix_complete.py -v`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/routes/fms_routes.py backend/tests/test_fms_fix_complete.py
git commit -m "feat(fms): pause/hold with deadline shift on resume

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Frontend — accessible status colors, pause control, audit log

**Files:**
- Modify: `frontend/src/components/fms/FMSDashboard.js`, `frontend/src/components/fms/FlowDetailPanel.js`, `frontend/src/hooks/useFlowManagement.js`
- Verify: visual check in the running app

- [ ] **Step 1: Map `tat_status` to icon + text + color (not color alone)**

In whichever FMS component renders a stage status badge, replace any color-only rendering with a map (accessibility — research caveat: color must be supplemented). Add near the top of `FMSDashboard.js`:
```javascript
const TAT_BADGE = {
  green:   { color: "#16a34a", icon: "✓", label: "On track" },
  orange:  { color: "#f59e0b", icon: "▲", label: "Due soon" },
  red:     { color: "#ef4444", icon: "▲", label: "At risk" },
  overdue: { color: "#b91c1c", icon: "✕", label: "Overdue" },
  pending: { color: "#9ca3af", icon: "•", label: "Pending" },
};
```
Render `{icon} {label}` with the color, so it is legible without color perception.

- [ ] **Step 2: Add pause/resume buttons + reason prompt**

In `useFlowManagement.js`, add API calls:
```javascript
const pauseStage = (stageId, reason) =>
  api.post(`/fms/stages/${stageId}/pause`, { reason });
const resumeStage = (stageId) =>
  api.post(`/fms/stages/${stageId}/resume`, {});
```
Export them and wire a "Pause"/"Resume" button into `FlowDetailPanel.js` for the active/paused stage, prompting for a reason on pause.

- [ ] **Step 3: Show the audit log in the detail panel**

In `useFlowManagement.js` add:
```javascript
const fetchLogs = (flowId) => api.get(`/fms/flows/${flowId}/logs`);
```
In `FlowDetailPanel.js`, fetch on open and render a simple timeline: `{at} — {action} by {by} {note}`.

- [ ] **Step 4: Verify in the running app**

Use the `run` skill (or start frontend + backend) and:
- Open a flow → confirm status badges show icon+text+color.
- Pause a stage → it shows "Paused"; resume → returns to active.
- Confirm the audit log lists `created` / `completed` / `paused` / `resumed`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/fms/FMSDashboard.js frontend/src/components/fms/FlowDetailPanel.js frontend/src/hooks/useFlowManagement.js
git commit -m "feat(fms): accessible status badges, pause control, audit log UI

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification

- [ ] Run the full FMS backend suite from `backend/`: `python -m pytest tests/test_fms_tat_engine.py tests/test_fms_fix_complete.py -v` — all PASS.
- [ ] Confirm the scheduler logs "5 background jobs running" on backend startup (check `backend/backend.log`).
- [ ] Confirm production runs a single backend worker (or the `fms_sla_loop` is guarded), so notifications are not duplicated (spec §10 risk).
- [ ] Spot-check: as a sales user, `GET /api/fms/flows/{id}` has empty `amount`/`customer_phone`.

## Self-review notes (author)

- **Spec coverage:** B1–B4 (Tasks 1–4), notifications/settings/loop/customer (Tasks 7–10), RBAC masking + edit-lock (Tasks 5–6), audit log (Task 3), pause/hold (Task 11), accessible dashboard (Task 12). All spec sections mapped.
- **Type/name consistency:** `tat_status`, `score_stage` signatures changed in Task 2 and the only in-file caller (`complete_stage`) is updated in the same task. `render_template`/`pct_remaining` defined in Task 8 before use in Task 9/10. `_require_stage_team` defined in Task 6 before use in Task 11. `_fms_send_wa/_fms_send_email` defined in Task 9 before the local-import use in Task 10.
- **Dry-run:** notification sends honor `FMS_NOTIFY_DRY_RUN=1` so integration tests never hit real WhatsApp/email.
