# FMS Action-Nodes + Flow-to-Flow Linking (Phase B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an FMS stage fire actions on lifecycle events — spawn another flow (`start_flow`), generate certificates (`generate_certificate`), or send a templated message (`send_message`) — idempotently and audited.

**Architecture:** A new pure-ish module `backend/fms_actions.py` holds the dispatcher `run_stage_actions(flow, stage, event)`, a pure `eval_condition`, and the three action executors. Stage definitions gain an optional `actions` list copied into stage docs (like the existing `customer_notify`). The dispatcher is called from `complete_stage`/`approve_stage`/`reject_stage` (in `fms_routes.py`) and the SLA-loop overdue path (in `scheduler.py`). Idempotency + audit via `fms_action_logs` (one fire per `(stage_id, action_index, event)`), the same pattern as `fms_notifications`/`cert_items`.

**Tech Stack:** Python 3.14, FastAPI, Motor/MongoDB, reuses cert pipeline (`cert_routes`/`scheduler.run_cert_pass`) and FMS notification send (`evolution`/SMTP). pytest + requests. Frontend: React.

---

## Reference: spec
`docs/superpowers/specs/2026-06-04-fms-action-nodes-design.md`. Read it before starting.

## Reference: branch, build env, test harness
- Branch `feat/fms-action-nodes` (cut from `feat/certs-build`) in the worktree `F:\SMARTSHAPE APP\.claude\worktrees\certs`. `cd` there for everything. Do NOT touch `F:\SMARTSHAPE APP`.
- Test backend: ONE instance the controller runs from the worktree:
  `DB_NAME=smartshape_test FMS_NOTIFY_DRY_RUN=1 CERT_DRY_RUN=1 python -m uvicorn main:app --host 127.0.0.1 --port 8000` (no `--reload`; Atlas startup ~60-70s).
- **Do NOT start/stop/kill any backend/python/uvicorn process.** Confirm RED, implement, commit; the controller restarts + verifies green.
- Integration tests run from `...\certs\backend`:
  `DB_NAME=smartshape_test REACT_APP_BACKEND_URL=http://127.0.0.1:8000 python -m pytest tests/test_fms_actions.py -v`
- `tests/` is gitignored — never `git add -f` test files; commit implementation only. Trailer on every commit: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## Key existing call sites (in `backend/routes/fms_routes.py` on this branch)
- `FlowCreate` model — line ~310; `create_flow` — ~351; stage_doc construction copies `customer_notify` — ~394 (add `actions` next to it).
- `_maybe_notify_customer` — ~470 (customer-notify, called from complete/approve).
- `complete_stage` — ~499; `approve_stage` — ~543; `reject_stage` — ~561; `_advance_flow` — ~656.
- Helpers available: `gen_id`, `now_iso`, `now_utc`, `get_fms_settings`, `db`, `render_template`, `calculate_plan_time`, `_log_stage`.

## File structure
- **Create** `backend/fms_actions.py` — `eval_condition` (pure), `run_stage_actions`, `_action_already_fired`, `_log_action`, `_execute_action` + per-type executors. Imports `db`; imports `scheduler`/`cert` helpers LOCALLY inside executors to avoid cycles.
- **Modify** `backend/routes/fms_routes.py` — add `actions` to stage defs + stage_doc copy; call `run_stage_actions` from complete/approve/reject; add `parent_flow_id`/`spawned_flow_ids` to flow docs; expose an internal `create_child_flow(...)` helper used by the `start_flow` executor.
- **Modify** `backend/scheduler.py` — in the FMS SLA loop overdue branch, dispatch `on_overdue` (local import).
- **Modify** `backend/database.py` — `fms_action_logs` index.
- **Modify (frontend)** the FMS template builder (`frontend/src/components/fms/FlowFormDialog.js`) — per-stage Actions sub-editor.
- **Test** `backend/tests/test_fms_action_unit.py` (pure), `backend/tests/test_fms_actions.py` (integration).

---

# PHASE 1 — Backend

### Task 1: `actions` plumbing + `eval_condition` + action log

**Files:**
- Create: `backend/fms_actions.py`
- Modify: `backend/routes/fms_routes.py` (stage_doc copy ~394; `FlowCreate`/flow_doc for linkage), `backend/database.py`
- Test: `backend/tests/test_fms_action_unit.py`

- [ ] **Step 1: Write failing unit tests**

Create `backend/tests/test_fms_action_unit.py`:
```python
"""Pure unit tests for FMS action helpers. No server/DB needed.
Run from backend/:  python -m pytest tests/test_fms_action_unit.py -v
"""
from fms_actions import eval_condition


class TestEvalCondition:
    def test_null_condition_is_true(self):
        assert eval_condition(None, {"amount": 10}) is True

    def test_gt_true(self):
        assert eval_condition({"field": "amount", "op": ">", "value": 50000}, {"amount": 77777}) is True

    def test_gt_false(self):
        assert eval_condition({"field": "amount", "op": ">", "value": 50000}, {"amount": 1000}) is False

    def test_eq_string(self):
        assert eval_condition({"field": "flow_type", "op": "==", "value": "order"}, {"flow_type": "order"}) is True

    def test_missing_field_is_false(self):
        assert eval_condition({"field": "nope", "op": ">", "value": 1}, {"amount": 5}) is False

    def test_unknown_op_is_false(self):
        assert eval_condition({"field": "amount", "op": "~", "value": 1}, {"amount": 5}) is False
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest tests/test_fms_action_unit.py -v`
Expected: FAIL — `ModuleNotFoundError: fms_actions`.

- [ ] **Step 3: Create `fms_actions.py` with `eval_condition` + log helpers**

Create `backend/fms_actions.py`:
```python
"""FMS stage action-nodes: dispatcher + executors. Reuses the cert pipeline and
notification senders. Idempotent + audited via fms_action_logs."""
from datetime import datetime, timezone
from typing import Optional, Dict, Any
import uuid

from database import db


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def _gen_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


_OPS = {
    ">":  lambda a, b: a > b,
    ">=": lambda a, b: a >= b,
    "<":  lambda a, b: a < b,
    "<=": lambda a, b: a <= b,
    "==": lambda a, b: a == b,
    "!=": lambda a, b: a != b,
}

def eval_condition(cond: Optional[Dict[str, Any]], flow: Dict[str, Any]) -> bool:
    """Null condition => True. Otherwise compare flow[field] op value. Unknown op /
    missing field => False. Numeric compares coerce both sides to float when possible."""
    if not cond:
        return True
    field = cond.get("field")
    op = cond.get("op")
    if field not in flow or op not in _OPS:
        return False
    left, right = flow.get(field), cond.get("value")
    try:
        lf, rf = float(left), float(right)
        return _OPS[op](lf, rf)
    except (TypeError, ValueError):
        return _OPS[op](left, right)


async def _action_already_fired(stage_id: str, action_index: int, event: str) -> bool:
    return bool(await db.fms_action_logs.find_one(
        {"stage_id": stage_id, "action_index": action_index, "event": event,
         "status": {"$in": ["fired", "skipped_condition"]}}))

async def _log_action(flow_id, stage_id, action_index, event, atype, status, result_ref=None, error=None):
    await db.fms_action_logs.insert_one({
        "log_id": _gen_id("falog"), "flow_id": flow_id, "stage_id": stage_id,
        "action_index": action_index, "event": event, "type": atype,
        "status": status, "result_ref": result_ref, "error": error, "at": _now_iso(),
    })
```

- [ ] **Step 4: Plumb `actions` through stage docs + add flow linkage fields**

In `backend/routes/fms_routes.py`:
- In the stage_doc construction (~line 394, next to `"customer_notify": sd.get("customer_notify", False),`) add:
```python
            "actions": sd.get("actions", []),
```
- In `FlowCreate` (~line 310) add optional linkage input:
```python
    parent_flow_id: Optional[str] = None
    spawn_depth: Optional[int] = 0
```
- In the flow_doc built by `create_flow` add:
```python
        "parent_flow_id": body.parent_flow_id,
        "spawned_flow_ids": [],
        "spawn_depth": body.spawn_depth or 0,
```

- [ ] **Step 5: Add the index**

In `backend/database.py`, after the cert index block add:
```python
    await db.fms_action_logs.create_index(
        [("stage_id", 1), ("action_index", 1), ("event", 1)], background=True)
```

- [ ] **Step 6: Run unit tests + import gate**

Run: `python -m pytest tests/test_fms_action_unit.py -v` → PASS (6).
Run: `python -c "import fms_actions, routes.fms_routes"` → exit 0.

- [ ] **Step 7: Commit**
```bash
git add backend/fms_actions.py backend/routes/fms_routes.py backend/database.py
git commit -m "feat(fms): action plumbing — actions field, eval_condition, action log, flow linkage"
```

---

### Task 2: Dispatcher + `send_message` action, wired into complete/approve/reject

**Files:**
- Modify: `backend/fms_actions.py`, `backend/routes/fms_routes.py`
- Test: `backend/tests/test_fms_actions.py`

- [ ] **Step 1: Write the failing integration test**

Create `backend/tests/test_fms_actions.py`:
```python
"""Integration tests for FMS action-nodes. Backend must be running (dry-run).
Run from backend/:
  DB_NAME=smartshape_test REACT_APP_BACKEND_URL=http://127.0.0.1:8000 python -m pytest tests/test_fms_actions.py -v
"""
import os, uuid, pytest, requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://127.0.0.1:8000").rstrip("/")
ADMIN_EMAIL, ADMIN_PASSWORD = "info@smartshape.in", "admin123"


@pytest.fixture(scope="session")
def admin():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    for c in r.cookies:
        s.cookies.set(c.name, c.value, domain=c.domain or "127.0.0.1", path=c.path or "/")
    return s


def _template_with_action(admin, action):
    """Create an FMS template whose single stage carries one action."""
    body = {
        "name": f"TEST_ACT_{uuid.uuid4().hex[:5]}",
        "stages": [{"key": "s1", "label": "Stage 1", "team": "sales",
                    "tat_hours": 4, "needs_approval": False, "actions": [action]}],
    }
    r = admin.post(f"{BASE_URL}/api/fms/templates", json=body, timeout=15)
    assert r.status_code in (200, 201), r.text
    return r.json()["template_id"]


def _make_flow(admin, template_id, **over):
    body = {"flow_type": "order", "template_id": template_id, "title": f"AF_{uuid.uuid4().hex[:5]}",
            "customer_name": "Amit", "customer_phone": "9000000001", "customer_email": "a@x.com", "amount": 77777}
    body.update(over)
    r = admin.post(f"{BASE_URL}/api/fms/flows", json=body, timeout=20)
    assert r.status_code in (200, 201), r.text
    return r.json()


class TestSendMessageAction:
    def test_on_complete_send_message_fires_once(self, admin):
        action = {"event": "on_complete", "type": "send_message",
                  "params": {"to": "customer", "channels": ["email"], "template": "Hi {customer_name}, {stage} done."}}
        tid = _template_with_action(admin, action)
        flow = _make_flow(admin, tid)
        fid = flow["flow_id"]
        st = flow["stages"][0]
        r = admin.post(f"{BASE_URL}/api/fms/stages/{st['stage_id']}/complete", json={}, timeout=20)
        assert r.status_code == 200, r.text
        # action log shows exactly one fired send_message for this stage/event
        logs = admin.get(f"{BASE_URL}/api/fms/flows/{fid}/action-logs", timeout=15)
        assert logs.status_code == 200, logs.text
        fired = [l for l in logs.json() if l["type"] == "send_message" and l["status"] == "fired"]
        assert len(fired) == 1, logs.json()
```

- [ ] **Step 2: Run to verify failure**

Run: `DB_NAME=smartshape_test REACT_APP_BACKEND_URL=http://127.0.0.1:8000 python -m pytest tests/test_fms_actions.py::TestSendMessageAction -v`
Expected: FAIL — `/fms/flows/{id}/action-logs` 404 and no dispatch.

- [ ] **Step 3: Add dispatcher + send_message executor**

Append to `backend/fms_actions.py`:
```python
def _render(tpl: str, flow: dict, stage: dict) -> str:
    from routes.fms_routes import render_template
    return render_template(tpl, customer_name=flow.get("customer_name", ""),
                           title=flow.get("title", ""), ref=flow.get("reference_id") or flow.get("flow_id", ""),
                           stage=stage.get("label", ""))


async def _exec_send_message(action, flow, stage):
    params = action.get("params", {})
    text = _render(params.get("template", ""), flow, stage)
    channels = params.get("channels", ["whatsapp", "email"])
    from scheduler import _fms_send_wa, _fms_send_email   # local import avoids cycle
    to = params.get("to", "customer")
    phone = flow.get("customer_phone", "") if to == "customer" else ""
    email = flow.get("customer_email", "") if to == "customer" else ""
    if to == "staff":
        emp = await db.del_employees.find_one({"email": stage.get("assigned_to", "")}, {"_id": 0}) or {}
        u = await db.users.find_one({"email": stage.get("assigned_to", "")}, {"_id": 0}) or {}
        phone = u.get("phone") or emp.get("phone") or ""
        email = stage.get("assigned_to", "")
    notif_id = _gen_id("fanotif")
    if "whatsapp" in channels and phone:
        await _fms_send_wa(phone, text)
    if "email" in channels and email and "@" in email:
        await _fms_send_email(email, "Update", text)
    return notif_id


async def _execute_action(action, flow, stage):
    atype = action.get("type")
    if atype == "send_message":
        return await _exec_send_message(action, flow, stage)
    if atype == "start_flow":
        return await _exec_start_flow(action, flow, stage)       # Task 3
    if atype == "generate_certificate":
        return await _exec_generate_certificate(action, flow, stage)  # Task 4
    raise ValueError(f"unknown action type: {atype}")


async def run_stage_actions(flow: dict, stage: dict, event: str):
    for idx, action in enumerate(stage.get("actions", []) or []):
        if action.get("event") != event:
            continue
        if await _action_already_fired(stage["stage_id"], idx, event):
            continue
        if not eval_condition(action.get("condition"), flow):
            await _log_action(flow["flow_id"], stage["stage_id"], idx, event,
                              action.get("type"), "skipped_condition")
            continue
        try:
            ref = await _execute_action(action, flow, stage)
            await _log_action(flow["flow_id"], stage["stage_id"], idx, event,
                              action.get("type"), "fired", result_ref=ref)
        except Exception as e:
            await _log_action(flow["flow_id"], stage["stage_id"], idx, event,
                              action.get("type"), "failed", error=str(e)[:200])
```
Add stubs so imports resolve before Tasks 3/4 implement them — at the bottom of `fms_actions.py`:
```python
async def _exec_start_flow(action, flow, stage):
    raise NotImplementedError("start_flow")           # implemented in Task 3

async def _exec_generate_certificate(action, flow, stage):
    raise NotImplementedError("generate_certificate")  # implemented in Task 4
```

- [ ] **Step 4: Wire dispatcher into stage lifecycle + add action-logs endpoint**

In `backend/routes/fms_routes.py`:
- Add the endpoint near `get_flow_logs`:
```python
@router.get("/flows/{flow_id}/action-logs")
async def get_flow_action_logs(flow_id: str, request: Request):
    await get_current_user(request)
    return await db.fms_action_logs.find({"flow_id": flow_id}, {"_id": 0}).sort("at", 1).to_list(500)
```
- In `complete_stage` (non-approval path) and `approve_stage`, right where `_maybe_notify_customer` is called, also call:
```python
    flow = await db.fms_flows.find_one({"flow_id": stage["flow_id"]}, {"_id": 0})
    if flow:
        from fms_actions import run_stage_actions
        await run_stage_actions(flow, {**stage, **(update if 'update' in dir() else {})}, "on_complete")
```
  (Use the already-fetched `flow`/`stage` variables in scope; ensure the stage dict has `stage_id`, `assigned_to`, `actions`.)
- In `reject_stage`, after the stage is marked rejected:
```python
    flow = await db.fms_flows.find_one({"flow_id": stage["flow_id"]}, {"_id": 0})
    if flow:
        from fms_actions import run_stage_actions
        await run_stage_actions(flow, stage, "on_reject")
```

- [ ] **Step 5: Run test (controller restarts) to verify pass; import gate first**

`python -c "import fms_actions, routes.fms_routes, scheduler"` → exit 0.
Run: `DB_NAME=smartshape_test REACT_APP_BACKEND_URL=http://127.0.0.1:8000 python -m pytest tests/test_fms_actions.py::TestSendMessageAction -v`
Expected: PASS.

- [ ] **Step 6: Commit**
```bash
git add backend/fms_actions.py backend/routes/fms_routes.py
git commit -m "feat(fms): action dispatcher + send_message, wired into stage lifecycle"
```

---

### Task 3: `start_flow` action (flow-to-flow linking)

**Files:**
- Modify: `backend/fms_actions.py`, `backend/routes/fms_routes.py`
- Test: `backend/tests/test_fms_actions.py`

- [ ] **Step 1: Add failing test**

Append to `backend/tests/test_fms_actions.py`:
```python
class TestStartFlowAction:
    def test_completion_spawns_linked_child(self, admin):
        # target template the child flow will use
        child_tid = admin.post(f"{BASE_URL}/api/fms/templates", json={
            "name": f"CHILD_{uuid.uuid4().hex[:5]}",
            "stages": [{"key": "c1", "label": "Child Stage", "team": "sales", "tat_hours": 4, "needs_approval": False}],
        }, timeout=15).json()["template_id"]
        action = {"event": "on_complete", "type": "start_flow",
                  "params": {"template_id": child_tid, "title_suffix": " - Onboarding",
                             "carry": ["customer_name", "customer_phone", "customer_email", "amount"]}}
        tid = _template_with_action(admin, action)
        parent = _make_flow(admin, tid)
        pid = parent["flow_id"]
        st = parent["stages"][0]
        admin.post(f"{BASE_URL}/api/fms/stages/{st['stage_id']}/complete", json={}, timeout=20)
        # parent now has a spawned child
        p = admin.get(f"{BASE_URL}/api/fms/flows/{pid}", timeout=15).json()
        assert p.get("spawned_flow_ids"), p
        child_id = p["spawned_flow_ids"][0]
        child = admin.get(f"{BASE_URL}/api/fms/flows/{child_id}", timeout=15).json()
        assert child["parent_flow_id"] == pid
        assert child["customer_name"] == "Amit"
        assert child["spawn_depth"] == 1
```

- [ ] **Step 2: Run to verify failure**

Run: `DB_NAME=smartshape_test REACT_APP_BACKEND_URL=http://127.0.0.1:8000 python -m pytest tests/test_fms_actions.py::TestStartFlowAction -v`
Expected: FAIL — `_exec_start_flow` raises NotImplementedError → action logged failed → no spawned child.

- [ ] **Step 3: Implement `create_child_flow` helper + `_exec_start_flow`**

In `backend/routes/fms_routes.py`, add a reusable internal creator (factor out of `create_flow` if convenient, else a thin wrapper that builds a `FlowCreate` and calls the existing creation logic). Minimal wrapper:
```python
async def create_child_flow(template_id: str, title: str, carry: dict,
                            parent_flow_id: str, spawn_depth: int, request: Request) -> dict:
    body = FlowCreate(flow_type="order", template_id=template_id, title=title,
                      customer_name=carry.get("customer_name", ""),
                      customer_phone=carry.get("customer_phone", ""),
                      customer_email=carry.get("customer_email", ""),
                      reference_id=carry.get("reference_id"),
                      amount=carry.get("amount", 0),
                      parent_flow_id=parent_flow_id, spawn_depth=spawn_depth)
    return await create_flow(body, request)
```
(Adapt the field list to `FlowCreate`'s actual fields; `create_flow` returns the created flow via `get_flow`.)

In `backend/fms_actions.py`, replace the `_exec_start_flow` stub:
```python
MAX_SPAWN_DEPTH = 5

async def _exec_start_flow(action, flow, stage):
    if (flow.get("spawn_depth", 0) or 0) >= MAX_SPAWN_DEPTH:
        raise ValueError("max spawn depth reached")
    params = action.get("params", {})
    carry_fields = params.get("carry", ["customer_name", "customer_phone", "customer_email", "reference_id", "amount"])
    carry = {f: flow.get(f) for f in carry_fields}
    title = f"{flow.get('title','')}{params.get('title_suffix','')}"
    from routes.fms_routes import create_child_flow, _make_request_proxy  # see note
    child = await create_child_flow(params["template_id"], title, carry,
                                    flow["flow_id"], (flow.get("spawn_depth", 0) or 0) + 1,
                                    _make_request_proxy(flow.get("created_by")))
    await db.cert_  # (no-op placeholder removed)
    await db.fms_flows.update_one({"flow_id": flow["flow_id"]},
                                  {"$push": {"spawned_flow_ids": child["flow_id"]}})
    return child["flow_id"]
```
NOTE on the request object: `create_flow` calls `get_current_user(request)`. To call it from the dispatcher (which has no HTTP request), add a tiny helper in `fms_routes.py` that bypasses auth for internal calls — refactor `create_flow` so its core logic lives in `async def _create_flow_core(body, user_email)` and both the route and `create_child_flow` call the core. Replace the `_make_request_proxy` approach with:
```python
# in fms_routes.py
async def _create_flow_core(body: FlowCreate, user_email: str) -> dict:
    ...   # the existing body of create_flow, using user_email instead of get_current_user

@router.post("/flows")
async def create_flow(body: FlowCreate, request: Request):
    user = await get_current_user(request)
    return await _create_flow_core(body, user.get("email"))

async def create_child_flow(template_id, title, carry, parent_flow_id, spawn_depth, created_by):
    body = FlowCreate(flow_type="order", template_id=template_id, title=title,
                      customer_name=carry.get("customer_name",""), customer_phone=carry.get("customer_phone",""),
                      customer_email=carry.get("customer_email",""), reference_id=carry.get("reference_id"),
                      amount=carry.get("amount",0) or 0, parent_flow_id=parent_flow_id, spawn_depth=spawn_depth)
    return await _create_flow_core(body, created_by)
```
And in `_exec_start_flow`, call:
```python
    from routes.fms_routes import create_child_flow
    child = await create_child_flow(params["template_id"], title, carry,
                                    flow["flow_id"], (flow.get("spawn_depth",0) or 0)+1,
                                    flow.get("created_by", "fms-action"))
    await db.fms_flows.update_one({"flow_id": flow["flow_id"]},
                                  {"$push": {"spawned_flow_ids": child["flow_id"]}})
    return child["flow_id"]
```
(Remove the erroneous `await db.cert_...` placeholder line entirely.)

- [ ] **Step 4: Run test to verify pass**

Run: `DB_NAME=smartshape_test REACT_APP_BACKEND_URL=http://127.0.0.1:8000 python -m pytest tests/test_fms_actions.py::TestStartFlowAction -v`
Expected: PASS — child created, linked, depth=1, customer carried.

- [ ] **Step 5: Commit**
```bash
git add backend/fms_actions.py backend/routes/fms_routes.py
git commit -m "feat(fms): start_flow action — spawn linked child flow with carry + depth guard"
```

---

### Task 4: `generate_certificate` action

**Files:**
- Modify: `backend/fms_actions.py`
- Test: `backend/tests/test_fms_actions.py`

- [ ] **Step 1: Add failing test**

Append to `backend/tests/test_fms_actions.py`:
```python
import io
from PIL import Image

def _png(w=600, h=400):
    b = io.BytesIO(); Image.new("RGB", (w, h), "white").save(b, "PNG"); return b.getvalue()

class TestGenerateCertificateAction:
    def test_completion_creates_cert_batch(self, admin):
        # a cert template to render with
        url = admin.post(f"{BASE_URL}/api/certs/templates/background",
                         files={"file": ("bg.png", _png(), "image/png")}, timeout=30).json()["url"]
        ctid = admin.post(f"{BASE_URL}/api/certs/templates", json={
            "name": f"CT_{uuid.uuid4().hex[:5]}", "background_url": url, "orientation": "landscape",
            "width_px": 600, "height_px": 400,
            "fields": [{"key": "name", "x": 300, "y": 200, "size": 28, "color": "#000", "align": "center"}],
        }, timeout=15).json()["template_id"]
        action = {"event": "on_complete", "type": "generate_certificate",
                  "params": {"cert_template_id": ctid, "channels": ["email"],
                             "shared_values": {"date": "2026-06-04", "theme": "Onboarding", "expert": "R.V."}}}
        tid = _template_with_action(admin, action)
        flow = _make_flow(admin, tid)
        st = flow["stages"][0]
        admin.post(f"{BASE_URL}/api/fms/stages/{st['stage_id']}/complete", json={}, timeout=20)
        # action log records a fired generate_certificate with a batch_id result_ref
        logs = admin.get(f"{BASE_URL}/api/fms/flows/{flow['flow_id']}/action-logs", timeout=15).json()
        gen = [l for l in logs if l["type"] == "generate_certificate" and l["status"] == "fired"]
        assert gen and gen[0]["result_ref"], logs
        bid = gen[0]["result_ref"]
        # the cert batch exists with one item for this customer
        batch = admin.get(f"{BASE_URL}/api/certs/batches/{bid}", timeout=15).json()
        assert batch["counts"]["total"] == 1
        assert batch["items"][0]["name"] == "Amit"
```

- [ ] **Step 2: Run to verify failure**

Run: `DB_NAME=smartshape_test REACT_APP_BACKEND_URL=http://127.0.0.1:8000 python -m pytest tests/test_fms_actions.py::TestGenerateCertificateAction -v`
Expected: FAIL — `_exec_generate_certificate` raises NotImplementedError.

- [ ] **Step 3: Implement `_exec_generate_certificate`**

In `backend/fms_actions.py`, replace the stub. It directly creates a `cert_batch` + one `cert_item` for the flow's customer and sets status so the cert loop generates+sends (reuse the cert collections directly to avoid HTTP):
```python
async def _exec_generate_certificate(action, flow, stage):
    params = action.get("params", {})
    cert_template_id = params.get("cert_template_id")
    tpl = await db.cert_templates.find_one({"template_id": cert_template_id}, {"_id": 0})
    if not tpl:
        raise ValueError("cert template not found")
    bid = _gen_id("cbatch")
    item = {
        "item_id": _gen_id("citem"), "batch_id": bid,
        "name": flow.get("customer_name", ""), "phone": flow.get("customer_phone", ""),
        "email": flow.get("customer_email", ""),
        "pdf_url": None, "gen_status": "pending", "gen_error": None,
        "delivery": {"whatsapp": {"status": "pending", "at": None, "error": None},
                     "email": {"status": "pending", "at": None, "error": None}},
        "created_at": _now_iso(),
    }
    batch = {
        "batch_id": bid, "title": f"Cert: {flow.get('title','')}",
        "template_id": cert_template_id, "source": "manual", "session_id": None,
        "shared_values": params.get("shared_values", {}),
        "channels": params.get("channels", ["whatsapp", "email"]),
        "status": "generating",   # cert_loop will generate, then we flip to sending
        "counts": {"total": 1, "generated": 0, "sent_whatsapp": 0, "sent_email": 0, "failed": 0},
        "created_by": flow.get("created_by", "fms-action"), "created_at": _now_iso(),
        "origin_flow_id": flow["flow_id"],
    }
    await db.cert_batches.insert_one(batch)
    await db.cert_items.insert_one(item)
    # ensure delivery happens after generation: a follow-up flip is handled by cert_loop
    # (status generating -> ready); set to sending so the same loop delivers too.
    await db.cert_batches.update_one({"batch_id": bid}, {"$set": {"status": "sending"}}) \
        if False else None  # keep 'generating'; see note
    return bid
```
NOTE: the cert loop's `_generate_pending_certs` sets a batch `generating -> ready`, and `_deliver_pending_certs` only sends batches in `sending`. For the action flow we want generate THEN send without a manual step. Simplest: leave status `generating`; the test only asserts the batch + item exist and generation occurs. To also auto-send, add to `scheduler._generate_pending_certs`: when a batch finishes generating AND has `origin_flow_id` set (i.e., action-created), set status to `sending` instead of `ready`. Implement that one-line branch in this task:
```python
# in scheduler._generate_pending_certs, replace the final per-batch line:
final_status = "sending" if batch.get("origin_flow_id") else "ready"
await db.cert_batches.update_one({"batch_id": batch["batch_id"]}, {"$set": {"status": final_status}})
```

- [ ] **Step 4: Run test to verify pass**

Run: `DB_NAME=smartshape_test REACT_APP_BACKEND_URL=http://127.0.0.1:8000 python -m pytest tests/test_fms_actions.py::TestGenerateCertificateAction -v`
Expected: PASS — batch created with 1 item named "Amit", action log fired with batch_id.

- [ ] **Step 5: Commit**
```bash
git add backend/fms_actions.py backend/scheduler.py
git commit -m "feat(fms): generate_certificate action — auto cert batch for flow customer"
```

---

### Task 5: `on_overdue` dispatch from the SLA loop

**Files:**
- Modify: `backend/scheduler.py`
- Test: `backend/tests/test_fms_actions.py`

- [ ] **Step 1: Add failing test**

Append to `backend/tests/test_fms_actions.py`:
```python
class TestOnOverdueAction:
    def test_overdue_fires_action_once(self, admin):
        import asyncio
        from datetime import datetime, timezone, timedelta
        from database import db
        action = {"event": "on_overdue", "type": "send_message",
                  "params": {"to": "customer", "channels": ["email"], "template": "Overdue: {stage}"}}
        tid = _template_with_action(admin, action)
        flow = _make_flow(admin, tid)
        st = flow["stages"][0]
        sid = st["stage_id"]
        now = datetime.now(timezone.utc)
        async def _seed():
            await db.fms_stages.update_one({"stage_id": sid}, {"$set": {
                "status": "active",
                "plan_start": (now - timedelta(hours=2)).isoformat(),
                "plan_done": (now - timedelta(hours=1)).isoformat()}})
        asyncio.run(_seed())
        # run the SLA loop twice via the existing debug endpoint
        admin.post(f"{BASE_URL}/api/fms/_run-sla?dry=1", timeout=120)
        admin.post(f"{BASE_URL}/api/fms/_run-sla?dry=1", timeout=120)
        logs = admin.get(f"{BASE_URL}/api/fms/flows/{flow['flow_id']}/action-logs", timeout=15).json()
        fired = [l for l in logs if l["event"] == "on_overdue" and l["status"] == "fired"]
        assert len(fired) == 1, logs
```
(Requires `DB_NAME=smartshape_test` in the pytest env — the run command sets it.)

- [ ] **Step 2: Run to verify failure**

Run: `DB_NAME=smartshape_test REACT_APP_BACKEND_URL=http://127.0.0.1:8000 python -m pytest tests/test_fms_actions.py::TestOnOverdueAction -v`
Expected: FAIL — no `on_overdue` dispatch in the SLA loop.

- [ ] **Step 3: Dispatch on_overdue in the SLA loop**

In `backend/scheduler.py`'s `run_fms_sla_check`, in the breach branch (where `now >= pd`), after the existing breach-notification logic, add:
```python
            if stage.get("actions"):
                from fms_actions import run_stage_actions
                await run_stage_actions(flow, stage, "on_overdue")
```
(The `run_stage_actions` idempotency log ensures it fires once even though the loop runs every 5 min / the test runs it twice.)

- [ ] **Step 4: Run test to verify pass; import gate**

`python -c "import scheduler, fms_actions"` → exit 0.
Run: `DB_NAME=smartshape_test REACT_APP_BACKEND_URL=http://127.0.0.1:8000 python -m pytest tests/test_fms_actions.py::TestOnOverdueAction -v`
Expected: PASS — fired exactly once across two loop passes.

- [ ] **Step 5: Run the FULL action suite + FMS regression**

Run: `python -m pytest tests/test_fms_action_unit.py -v` and
`DB_NAME=smartshape_test REACT_APP_BACKEND_URL=http://127.0.0.1:8000 python -m pytest tests/test_fms_actions.py -v`
Expected: all PASS.

- [ ] **Step 6: Commit**
```bash
git add backend/scheduler.py
git commit -m "feat(fms): dispatch on_overdue actions from the SLA loop"
```

---

# PHASE 2 — Frontend

### Task 6: Per-stage Actions editor in the FMS template builder

**Files:**
- Modify: `frontend/src/components/fms/FlowFormDialog.js` (and/or the template editor component that edits a template's `stages`)

- [ ] **Step 1: Locate the stage editor**

Read `frontend/src/components/fms/FlowFormDialog.js` and any template-editing component to find where a template's `stages` array is edited (each stage's key/label/team/tat_hours/needs_approval). Confirm whether template stage editing lives there or in another component (search for `tat_hours` and `needs_approval` in `frontend/src/components/fms/` and `frontend/src/hooks/useFlowManagement.js`).

- [ ] **Step 2: Add an Actions sub-editor per stage**

For each stage row, add a collapsible "Actions" section that edits `stage.actions` (array). Each action row:
- `event` select: `on_complete` / `on_overdue` / `on_reject`
- `type` select: `start_flow` / `generate_certificate` / `send_message`
- type-specific params:
  - `start_flow`: template picker (list FMS templates) + optional title suffix
  - `generate_certificate`: cert-template picker (`certsApi.listTemplates`) + date/theme/expert + channel checkboxes
  - `send_message`: to (customer/staff) + channels + a message textarea with `{customer_name}/{stage}/{title}/{ref}` hint
- optional condition row: field + op select + value
- "Add action" / remove buttons.
Persist `actions` inside each stage object so it round-trips through the existing template save (templates already store `stages`); no new API needed.

- [ ] **Step 3: Verify build sanity**

Re-read for balanced JSX, state immutability when editing nested `stages[i].actions[j]`, and that saving includes `actions`. Optional `npx eslint` on the changed file.

- [ ] **Step 4: Manual verification (controller)**

Controller loads the app, edits a template, adds an `on_complete → send_message` action to a stage, saves, creates a flow from it, completes the stage, and confirms an action-log entry.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/components/fms/FlowFormDialog.js
git commit -m "feat(fms): per-stage Actions editor in template builder"
```

---

## Final verification
- [ ] Unit: `python -m pytest tests/test_fms_action_unit.py -v` — PASS.
- [ ] Integration: `DB_NAME=smartshape_test REACT_APP_BACKEND_URL=http://127.0.0.1:8000 python -m pytest tests/test_fms_actions.py -v` — all PASS.
- [ ] Cert + FMS regression (the action wiring touched shared files): run `tests/test_cert_pipeline.py` and any FMS integration tests present — still PASS.
- [ ] Confirm no import cycle: `python -c "import scheduler, fms_actions, routes.fms_routes, routes.cert_routes"` exit 0.
- [ ] Spawn-depth guard works (a depth-5 flow does not spawn further).

## Self-review notes (author)
- **Spec coverage:** actions plumbing + eval_condition + log (Task 1), dispatcher + send_message + wiring (Task 2), start_flow + linkage + depth guard (Task 3), generate_certificate (Task 4), on_overdue (Task 5), template-builder UI (Task 6). All spec sections mapped.
- **Type/name consistency:** `run_stage_actions(flow, stage, event)`, `eval_condition(cond, flow)`, `_execute_action` dispatch keys (`send_message`/`start_flow`/`generate_certificate`) consistent across tasks. `_exec_start_flow`/`_exec_generate_certificate` declared as stubs in Task 2, implemented in Tasks 3/4. `create_child_flow`/`_create_flow_core` introduced together in Task 3. `origin_flow_id` written by the action (Task 4) and read by `scheduler._generate_pending_certs` (Task 4 same change).
- **Idempotency:** `_action_already_fired` checks `fired`/`skipped_condition` so neither re-fires; the `on_overdue` loop relies on this.
- **Dry-run:** `send_message`/`generate_certificate` delivery honor the existing `FMS_NOTIFY_DRY_RUN`/`CERT_DRY_RUN` flags via the reused senders.
- **Cycle safety:** `fms_actions` imports `scheduler`/`routes.fms_routes` only inside functions; `scheduler`/`fms_routes` import `fms_actions` only inside functions. Verified by the import-gate steps.
- **Known refactor:** Task 3 factors `create_flow` into `_create_flow_core(body, user_email)` so child flows can be created without an HTTP request — this is a targeted improvement, not unrelated refactoring.
