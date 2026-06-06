# Plan C — Drip from the School Profile + "Physical Material" drip step

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) From a School Profile, enroll one of the school's leads into a drip sequence. (2) Add a new drip step type **"physical_material"** so a sequence can, at a chosen day offset, automatically queue a physical material dispatch (creating a `physical_dispatches` record + a rep task to actually ship it) instead of sending WhatsApp/email.

**Architecture:** Reuse `drip_sequences`/`drip_enrollments` and `POST /drip/enroll`. The sequence step schema gains `message_type: "physical_material"` + `material_type`. The hourly drip executor (`scheduler.py → run_drip_executor`) gets a third branch that calls a new importable helper `create_physical_from_drip(...)` (in `crm_routes.py`) which inserts a pending `physical_dispatches` doc and a CRM `tasks` record for the assigned rep. The profile gets an "Enroll in Drip" dialog.

**Tech Stack:** FastAPI + Motor, React (CRA), pytest integration tests against `${REACT_APP_BACKEND_URL}/api`.

**Safety:** Production DB + live schedulers. Running the *full* drip executor against prod can fire real WhatsApp/email for unrelated enrollments — so the executor change is verified via an **isolated helper test** + a documented dry-run, never by running the whole loop against prod. Tests create `TEST_` leads/sequences and delete them.

---

## File Structure
- `backend/routes/drip_routes.py` — confirm step persistence accepts `material_type` (allow-list); no validation that blocks `physical_material`.
- `backend/routes/crm_routes.py` — add `create_physical_from_drip(lead, material_type, seq_name)` (importable, used by the executor).
- `backend/scheduler.py` — in `run_drip_executor`, add the `physical_material` branch calling `create_physical_from_drip`.
- `frontend/src/components/marketing/DripsTab.js` — step editor: add "Physical material" message type + material_type select.
- `frontend/src/components/school/EnrollDripDialog.js` — NEW: pick a school lead + sequence, enroll.
- `frontend/src/components/school/SchoolLeadsSection.js` — add an "Enroll in Drip" button.
- `frontend/src/pages/admin/SchoolProfile.js` — render the dialog; needs `GET /drip/sequences`.
- `frontend/src/lib/api.js` — add `drip` bindings if missing.
- `backend/tests/test_plan_c_drip.py` — NEW integration tests.

---

## Task 1: Sequence step persists `physical_material` + `material_type`

**Files:**
- Modify: `backend/routes/drip_routes.py` (sequence create/update — ensure step fields incl. `material_type` are stored)
- Test: `backend/tests/test_plan_c_drip.py`

- [ ] **Step 1: Write the failing test**

```python
import os, uuid, requests, pytest
BASE = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")

def _login():
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/login", json={"email": "info@smartshape.in", "password": "admin123"})
    assert r.status_code == 200, r.text
    return s

class TestPhysicalDripStep:
    @pytest.fixture(autouse=True)
    def setup(self):
        self.s = _login()
        self.seq_id = None
        yield
        if self.seq_id:
            self.s.delete(f"{BASE}/api/drip/sequences/{self.seq_id}")

    def test_sequence_stores_physical_step(self):
        uid = uuid.uuid4().hex[:8]
        r = self.s.post(f"{BASE}/api/drip/sequences", json={
            "name": f"TEST_Drip_{uid}", "trigger": "manual", "is_active": False,
            "steps": [{
                "step_number": 1, "delay_days": 0,
                "message_type": "physical_material", "material_type": "brochure",
                "message_template": "Ship a brochure"}]})
        assert r.status_code == 200, r.text
        self.seq_id = r.json()["sequence_id"]
        seqs = self.s.get(f"{BASE}/api/drip/sequences").json()
        seq = next(x for x in seqs if x["sequence_id"] == self.seq_id)
        step = seq["steps"][0]
        assert step["message_type"] == "physical_material"
        assert step["material_type"] == "brochure"
```

- [ ] **Step 2: Run test to verify it fails (or passes)**

Run: `cd backend && python -m pytest tests/test_plan_c_drip.py::TestPhysicalDripStep -v`
Expected: FAIL if `material_type` is stripped when steps are stored. If it passes already (endpoint stores steps verbatim), skip Step 3.

- [ ] **Step 3: Ensure steps keep `material_type`**

Open `backend/routes/drip_routes.py`, find the sequence create handler (`@router.post("/sequences")`). If it copies steps field-by-field (a whitelist), add `material_type` to the per-step allow-list. If it stores `body["steps"]` verbatim, no change is needed. Concretely, ensure the stored step includes:

```python
        step_doc = {
            "step_number": st.get("step_number"),
            "delay_days": int(st.get("delay_days", 0) or 0),
            "message_type": st.get("message_type", "whatsapp"),
            "message_template": st.get("message_template", ""),
            "message_plain": st.get("message_plain", st.get("message_template", "")),
            "attachment_id": st.get("attachment_id"),
            "material_type": st.get("material_type", ""),   # NEW
        }
```

Apply the same to the update handler (`@router.put("/sequences/{sequence_id}")`) if it rebuilds steps.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_plan_c_drip.py::TestPhysicalDripStep -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/drip_routes.py backend/tests/test_plan_c_drip.py
git commit -m "feat(drip): sequence steps persist physical_material + material_type"
```

---

## Task 2: `create_physical_from_drip` helper + isolated test

**Files:**
- Modify: `backend/routes/crm_routes.py` (new helper near `log_activity`)
- Test: `backend/tests/test_plan_c_drip.py`

- [ ] **Step 1: Write the failing test** (drives a TEST lead through the helper via a tiny admin trigger endpoint we add in this task)

```python
class TestDripPhysicalHelper:
    @pytest.fixture(autouse=True)
    def setup(self):
        self.s = _login()
        self.lead_id = None
        yield
        if self.lead_id:
            self.s.delete(f"{BASE}/api/leads/{self.lead_id}")

    def test_helper_creates_pending_dispatch(self):
        uid = uuid.uuid4().hex[:8]
        r = self.s.post(f"{BASE}/api/leads", json={
            "company_name": f"TEST_DripP_{uid}", "contact_name": "T",
            "contact_phone": "9000000030", "stage": "contacted"})
        self.lead_id = r.json()["lead_id"]
        # admin trigger that calls the helper once for this lead (no full executor)
        t = self.s.post(f"{BASE}/api/drip/_test-fire-physical", json={
            "lead_id": self.lead_id, "material_type": "sample", "seq_name": "TEST seq"})
        assert t.status_code == 200, t.text
        # a pending physical dispatch now exists for the lead
        disp = self.s.get(f"{BASE}/api/physical-dispatches", params={"lead_id": self.lead_id}).json()
        assert any(d.get("material_type") == "sample" and d.get("auto_from_drip") for d in disp)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_plan_c_drip.py::TestDripPhysicalHelper -v`
Expected: FAIL — helper + trigger endpoint do not exist.

- [ ] **Step 3: Implement the helper + a guarded test-trigger endpoint**

Add the helper near `log_activity` in `crm_routes.py`:

```python
async def create_physical_from_drip(lead: dict, material_type: str, seq_name: str) -> str:
    """Queue a physical dispatch + a rep task from a drip step. Returns dispatch_id."""
    now_iso = datetime.now(timezone.utc).isoformat()
    dispatch_id = f"pd_{uuid.uuid4().hex[:12]}"
    await db.physical_dispatches.insert_one({
        "dispatch_id": dispatch_id,
        "lead_id": lead.get("lead_id", ""),
        "lead_name": lead.get("contact_name", ""),
        "material_type": material_type or "brochure",
        "description": f"Auto-queued by drip: {seq_name}",
        "courier_name": "", "tracking_number": "", "sent_date": "",
        "received_confirmed": False,
        "auto_from_drip": True, "needs_dispatch": True,
        "created_by": "system", "created_at": now_iso,
    })
    # rep task so a human actually ships it
    await db.tasks.insert_one({
        "task_id": f"task_{uuid.uuid4().hex[:10]}",
        "title": f"Ship {material_type or 'material'} → {lead.get('company_name', '')}",
        "description": f"Auto-created by drip sequence '{seq_name}'. Add courier + tracking after shipping.",
        "type": "other", "lead_id": lead.get("lead_id", ""),
        "assigned_to": lead.get("assigned_to", ""),
        "due_date": "", "due_time": "", "priority": "medium",
        "status": "pending", "created_by": "system", "created_at": now_iso,
    })
    return dispatch_id
```

Add the guarded test-trigger endpoint (admin-only; exists so we can verify the helper without running the whole executor) — put it in `backend/routes/drip_routes.py`:

```python
from routes.crm_routes import create_physical_from_drip  # add near the top imports

@router.post("/_test-fire-physical")
async def _test_fire_physical(request: Request):
    user = await get_current_user(request)
    if get_team(user) != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    body = await request.json()
    lead = await db.leads.find_one({"lead_id": body.get("lead_id")}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    did = await create_physical_from_drip(lead, body.get("material_type", "brochure"), body.get("seq_name", "drip"))
    return {"dispatch_id": did}
```

(Ensure `drip_routes.py` imports `get_team` from `rbac` and `db` from `database`; mirror the imports already used in that file.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_plan_c_drip.py::TestDripPhysicalHelper -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/crm_routes.py backend/routes/drip_routes.py backend/tests/test_plan_c_drip.py
git commit -m "feat(drip): create_physical_from_drip helper (+ guarded test trigger)"
```

---

## Task 3: Wire the executor branch

**Files:**
- Modify: `backend/scheduler.py` (`run_drip_executor`, the per-step send block)

- [ ] **Step 1: Add the import**

Near the top of `scheduler.py`, extend the crm import to include the helper:

```python
from routes.crm_routes import create_physical_from_drip
```

- [ ] **Step 2: Add the branch**

In `run_drip_executor`, find the send block:

```python
            if msg_type == "whatsapp" and wa_cfg:
                ...
            elif msg_type == "email" and email_cfg:
                ...
```

Add a branch before the WhatsApp one (so it runs even when WA/email aren't configured):

```python
            if msg_type == "physical_material":
                try:
                    await create_physical_from_drip(lead, step.get("material_type", "brochure"), seq.get("name", "drip"))
                    sent = True
                except Exception as e:
                    err_detail = str(e)[:200]
            elif msg_type == "whatsapp" and wa_cfg:
                ...
            elif msg_type == "email" and email_cfg:
                ...
```

(Keep the existing whatsapp/email branches; just change the first `if` to `elif` and prepend the `physical_material` branch as shown. `sent`/`err_detail` are the variables the surrounding code already uses to log the step.)

- [ ] **Step 3: Compile + manual dry-run verification (do NOT run the full loop on prod)**

Run: `cd backend && python -m py_compile scheduler.py routes/crm_routes.py routes/drip_routes.py` → no errors.

Manual verification procedure (safe): the helper is already proven by Task 2's `_test-fire-physical`. The executor branch is a thin call to that same helper. To verify wiring without firing other people's drips, run the import check:

```bash
cd backend && python -c "import scheduler; print('executor import OK')"
```

Expected: `executor import OK` (confirms `create_physical_from_drip` is importable into the executor).

- [ ] **Step 4: Commit**

```bash
git add backend/scheduler.py
git commit -m "feat(drip): executor fires physical_material steps via create_physical_from_drip"
```

---

## Task 4: Drip step editor — "Physical material" type

**Files:**
- Modify: `frontend/src/components/marketing/DripsTab.js`

- [ ] **Step 1: Add the option + material picker**

In the step editor where `message_type` is chosen (a `<select>` with `whatsapp`/`email`), add a third option:

```javascript
                  <option value="physical_material">Physical material</option>
```

Below the message-type select, render a material picker only when `physical_material` is selected. Find the per-step render and add:

```javascript
                {step.message_type === 'physical_material' && (
                  <select
                    value={step.material_type || 'brochure'}
                    onChange={e => updateStep(idx, { ...step, material_type: e.target.value })}
                    className="h-9 px-2 rounded text-sm bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]"
                    data-testid={`step-material-${idx}`}>
                    <option value="brochure">Brochure</option>
                    <option value="sample">Sample</option>
                    <option value="catalogue">Catalogue</option>
                    <option value="kit">Kit</option>
                    <option value="gift">Gift</option>
                  </select>
                )}
```

(Use the existing step-update function name in this file — it may be `updateStep`, `setStep`, or an inline setter. Match the existing pattern for editing a step's fields; the message-template editor can be hidden for `physical_material` since the material picker replaces it.)

- [ ] **Step 2: Build + commit**

```bash
cd frontend && npm run build   # Compiled
git add frontend/src/components/marketing/DripsTab.js
git commit -m "feat(drip): physical-material step type in the sequence editor"
```

---

## Task 5: API bindings for drip

**Files:**
- Modify: `frontend/src/lib/api.js`

- [ ] **Step 1: Add bindings if missing**

```javascript
// Drip sequences / enrollment
export const drip = {
  sequences: () => API.get('/drip/sequences'),
  enroll: (data) => API.post('/drip/enroll', data),
  enrollments: (params) => API.get('/drip/enrollments', { params }),
  cancelEnrollment: (id) => API.put(`/drip/enrollments/${id}/cancel`),
};
```

(If a `dripSequences` export already exists and is used elsewhere, keep it and just ensure `sequences()` + `enroll()` are available; do not duplicate.)

- [ ] **Step 2: Build + commit**

```bash
cd frontend && npm run build   # Compiled
git add frontend/src/lib/api.js
git commit -m "feat(drip): api bindings for sequences + enroll"
```

---

## Task 6: Enroll-in-Drip dialog on the School Profile

**Files:**
- Create: `frontend/src/components/school/EnrollDripDialog.js`
- Modify: `frontend/src/components/school/SchoolLeadsSection.js`
- Modify: `frontend/src/pages/admin/SchoolProfile.js`

- [ ] **Step 1: Create the dialog**

```javascript
import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { toast } from 'sonner';
import { drip as dripApi } from '../../lib/api';

/**
 * Enroll one of the school's leads into a drip sequence.
 * `leads` = the school's leads (from the profile).
 */
export default function EnrollDripDialog({ open, onOpenChange, leads = [], onDone }) {
  const [sequences, setSequences] = useState([]);
  const [leadId, setLeadId] = useState('');
  const [seqId, setSeqId] = useState('');
  const [saving, setSaving] = useState(false);
  const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
  const textSec = 'text-[var(--text-secondary)]';

  useEffect(() => {
    if (!open) return;
    dripApi.sequences().then(r => setSequences((r.data || []).filter(s => s.is_active))).catch(() => {});
  }, [open]);

  const submit = async () => {
    if (!leadId || !seqId) { toast.error('Pick a lead and a sequence'); return; }
    setSaving(true);
    try {
      await dripApi.enroll({ lead_id: leadId, sequence_id: seqId });
      toast.success('Lead enrolled in drip');
      onOpenChange(false);
      onDone && onDone();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Enroll failed');
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)] w-[calc(100vw-1rem)] sm:max-w-md">
        <DialogHeader><DialogTitle>Enroll Lead in Drip</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label className={`${textSec} text-xs`}>Lead</Label>
            <select value={leadId} onChange={e => setLeadId(e.target.value)} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`} data-testid="enroll-lead">
              <option value="">Select a lead</option>
              {leads.map(l => <option key={l.lead_id} value={l.lead_id}>{l.contact_name} · {l.stage}</option>)}
            </select>
          </div>
          <div>
            <Label className={`${textSec} text-xs`}>Sequence</Label>
            <select value={seqId} onChange={e => setSeqId(e.target.value)} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`} data-testid="enroll-seq">
              <option value="">Select a sequence</option>
              {sequences.map(s => <option key={s.sequence_id} value={s.sequence_id}>{s.name} ({(s.steps || []).length} steps)</option>)}
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-[var(--border-color)] text-[var(--text-secondary)]">Cancel</Button>
          <Button onClick={submit} disabled={saving} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="enroll-submit">{saving ? 'Enrolling…' : 'Enroll'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Add the button to `SchoolLeadsSection`**

Accept an `onEnroll` prop and render next to the Create-Lead button (from Plan B; if Plan B isn't applied, place it in the section header):

```javascript
        <Button onClick={onEnroll} size="sm" variant="outline" className="border-[var(--border-color)] text-[var(--text-secondary)]" data-testid="enroll-drip-btn">
          Enroll in Drip
        </Button>
```

- [ ] **Step 3: Wire it in SchoolProfile**

Add import + state:

```javascript
import EnrollDripDialog from '../../components/school/EnrollDripDialog';
```
```javascript
  const [enrollOpen, setEnrollOpen] = useState(false);
```

Pass `onEnroll` to the leads section (add to the existing `SchoolLeadsSection` render):

```javascript
              onEnroll={() => setEnrollOpen(true)}
```

Render the dialog (`leads` is the school's full leads array from `profile`):

```javascript
      <EnrollDripDialog
        open={enrollOpen}
        onOpenChange={setEnrollOpen}
        leads={leads}
        onDone={sp.reload}
      />
```

- [ ] **Step 4: Build + commit**

```bash
cd frontend && npm run build   # Compiled
git add frontend/src/components/school/EnrollDripDialog.js frontend/src/components/school/SchoolLeadsSection.js frontend/src/pages/admin/SchoolProfile.js
git commit -m "feat(drip): Enroll a school's lead in a drip from the profile"
```

---

## Task 7: Manual verification

- [ ] **Step 1:** Marketing & WhatsApp → Drips → create a sequence with a **Physical material** step (day 0, material = sample), `trigger = manual`, active.
- [ ] **Step 2:** School Profile → Leads → **Enroll in Drip** → pick a lead + that sequence → Enroll.
- [ ] **Step 3 (safe helper proof):** Confirm the physical path by checking `_test-fire-physical` produced a dispatch in Task 2 (already tested). For the live executor, when it next runs (hourly) the day-0 step fires → a **pending** dispatch appears in Dispatch Tracking and a rep task is created. (Do not force-run the whole executor on prod.)

---

## Self-Review notes
- **Spec coverage:** enroll a school's lead into drip from the profile (T6) ✓; create + schedule marketing material = existing DripsTab sequence editor, now incl. physical step (T4) ✓; "physical material send as part of drip" → new step type + executor branch creating a dispatch + rep task (T1/T2/T3) ✓.
- **Prod-safety:** executor branch verified via an isolated helper + guarded admin trigger, never by running the full loop on prod; tests create+delete `TEST_` rows.
- **Independence:** Task 6's button coexists with Plan B's buttons; if Plan B isn't applied, the Enroll button still renders (its own prop). `create_physical_from_drip` is the single source of truth used by both the test trigger and the executor (DRY).
- **Type consistency:** step field `material_type` is stored (T1), read by the executor (T3) and the editor (T4); `create_physical_from_drip(lead, material_type, seq_name)` signature is identical in the helper, the trigger, and the executor call.
