# Plan A — Visits & Demo from the School Profile

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a rep plan a field visit directly from the School Profile, and when a lead moves to the `demo` stage (or via a "Plan Demo" button) choose **Physical workshop** (auto-creates a linked `visit_plan` that shows in the Visit Planning sheet) or **Online workshop** (captures date/time + meeting link and auto-sends the link to the contact on WhatsApp).

**Architecture:** Reuse the existing `visit_plans` collection and `POST /visit-plans` (in `backend/routes/field_routes.py`) — a visit created from the profile is the *same* record the Visit Planning sheet reads, so linkage is automatic. Add a thin `POST /leads/{lead_id}/schedule-demo` endpoint in `crm_routes.py` that (a) sets stage→demo + demo fields, (b) for physical creates a `visit_plan` and stores its id on the lead, (c) for online stores the link and WhatsApp-sends it. Frontend adds a Plan-Visit button (Visits tab) and a demo chooser (stage-change interception + "Plan Demo" button).

**Tech Stack:** FastAPI + Motor (MongoDB), React (CRA), pytest integration tests hitting `${REACT_APP_BACKEND_URL}/api` logged in as `info@smartshape.in`.

**Safety:** The backend points at the **production DB** and live WhatsApp scheduler. Integration tests must create `TEST_`-prefixed leads/visits and delete them in teardown. The online-demo WhatsApp send must be gated by an env flag `DEMO_WA_DRY_RUN` (logs instead of sends) so tests never message real contacts.

---

## File Structure
- `backend/routes/crm_routes.py` — add lead demo fields to `update_lead` allow-list; add `_send_demo_wa()` helper; add `POST /leads/{lead_id}/schedule-demo`.
- `backend/routes/field_routes.py` — no change (reuse `POST /visit-plans`); read it for the exact create shape.
- `frontend/src/lib/api.js` — add `leads.scheduleDemo` + reuse `visitPlans.create`.
- `frontend/src/components/crm/DemoChooserDialog.js` — NEW: Physical/Online chooser + scheduling form.
- `frontend/src/components/school/PlanVisitButton.js` — NEW: button + visit form used on the profile Visits tab.
- `frontend/src/components/crm/LeadDetailPanel.js` — intercept stage→demo to open the chooser; add a "Plan Demo" button.
- `frontend/src/components/school/SchoolOrdersSection.js` — add the Plan-Visit button to `SchoolVisitsSection`.
- `frontend/src/hooks/useSchoolProfile.js` — expose `reload` (already done in a prior change) for refresh after creating a visit.
- `backend/tests/test_plan_a_demo.py` — NEW integration tests.

---

## Task 1: Lead demo fields + schedule-demo endpoint (physical → visit_plan)

**Files:**
- Modify: `backend/routes/crm_routes.py` (update_lead allow-list ~line 1256; new endpoint after `leads_needs_attention`)
- Test: `backend/tests/test_plan_a_demo.py`

- [ ] **Step 1: Write the failing test**

```python
import os, uuid, requests, pytest
BASE = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")

def _login():
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/login", json={"email": "info@smartshape.in", "password": "admin123"})
    assert r.status_code == 200, r.text
    return s

class TestScheduleDemoPhysical:
    @pytest.fixture(autouse=True)
    def setup(self):
        self.s = _login()
        self.lead_id = None
        self.plan_id = None
        yield
        if self.plan_id:
            self.s.delete(f"{BASE}/api/visit-plans/{self.plan_id}")
        if self.lead_id:
            self.s.delete(f"{BASE}/api/leads/{self.lead_id}")

    def test_physical_demo_creates_visit_plan(self):
        uid = uuid.uuid4().hex[:8]
        r = self.s.post(f"{BASE}/api/leads", json={
            "company_name": f"TEST_Demo_{uid}", "contact_name": "T",
            "contact_phone": "9000000010", "stage": "contacted"})
        self.lead_id = r.json()["lead_id"]
        d = self.s.post(f"{BASE}/api/leads/{self.lead_id}/schedule-demo", json={
            "format": "physical", "demo_date": "2026-07-01", "demo_time": "11:00",
            "address": "School campus, Noida", "purpose": "Robotics workshop demo"})
        assert d.status_code == 200, d.text
        lead = d.json()
        assert lead["stage"] == "demo"
        assert lead["demo_format"] == "physical"
        assert lead["demo_visit_plan_id"]
        self.plan_id = lead["demo_visit_plan_id"]
        # the visit plan exists and is linked to this lead + school
        plans = self.s.get(f"{BASE}/api/visit-plans").json()
        plan = next(p for p in plans if p["plan_id"] == self.plan_id)
        assert plan["lead_id"] == self.lead_id
        assert plan["visit_date"] == "2026-07-01"
        assert plan["status"] == "planned"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_plan_a_demo.py::TestScheduleDemoPhysical -v`
Expected: FAIL — 404 on `/api/leads/{id}/schedule-demo`.

- [ ] **Step 3: Implement (allow-list fields, WA helper, endpoint)**

In `update_lead`, add the demo keys to the allow-list tuple (the `for k in (...)` block):

```python
              "expected_value", "lost_reason", "lost_reason_note",
              "demo_format", "demo_date", "demo_time", "demo_link", "demo_visit_plan_id",
              "referred_by_contact_id", "referral_reward_status"):
```

Add a WhatsApp helper near the other helpers (after `log_activity`, ~line 90):

```python
import os as _os
DEMO_WA_DRY_RUN = _os.getenv("DEMO_WA_DRY_RUN", "0") == "1"

async def _send_demo_wa(phone: str, message: str) -> bool:
    """Direct WhatsApp send via the configured provider (mirrors dispatch auto-WA)."""
    if not phone:
        return False
    if DEMO_WA_DRY_RUN:
        import logging as _log
        _log.getLogger("crm").info(f"[demo][dry] WA -> {phone}: {message[:60]}")
        return True
    wa = await db.settings.find_one({"type": "whatsapp"}, {"_id": 0})
    if not wa or not wa.get("username"):
        return False
    import httpx as _httpx
    try:
        async with _httpx.AsyncClient(timeout=15) as client:
            await client.post("https://app.messageautosender.com/message/new", data={
                "username": wa["username"], "password": wa["password"],
                "receiverMobileNo": phone, "message": message})
        await db.whatsapp_logs.insert_one({
            "log_id": f"wal_{uuid.uuid4().hex[:10]}", "phone": phone, "body": message,
            "send_mode": "demo_link", "status": "sent", "sent_by": "system",
            "sent_at": datetime.now(timezone.utc).isoformat()})
        return True
    except Exception:
        return False
```

Add the endpoint after `leads_needs_attention`:

```python
@router.post("/leads/{lead_id}/schedule-demo")
async def schedule_demo(lead_id: str, request: Request):
    user = await get_current_user(request)
    body = await request.json()
    fmt = body.get("format")
    if fmt not in ("physical", "online"):
        raise HTTPException(status_code=400, detail="format must be 'physical' or 'online'")
    lead = await db.leads.find_one({"lead_id": lead_id}, {"_id": 0})
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    now_iso = datetime.now(timezone.utc).isoformat()
    demo_date = body.get("demo_date", "")
    demo_time = body.get("demo_time", "")
    update = {
        "stage": "demo", "demo_format": fmt,
        "demo_date": demo_date, "demo_time": demo_time,
        "updated_at": now_iso, "last_activity_date": now_iso,
    }

    if fmt == "physical":
        plan_id = f"vp_{uuid.uuid4().hex[:12]}"
        await db.visit_plans.insert_one({
            "plan_id": plan_id, "lead_id": lead_id,
            "lead_name": lead.get("contact_name", ""),
            "school_name": lead.get("company_name", ""),
            "school_id": lead.get("school_id", ""),
            "contact_person": lead.get("contact_name", ""),
            "contact_phone": lead.get("contact_phone", ""),
            "assigned_to": body.get("assigned_to") or lead.get("assigned_to", ""),
            "assigned_name": lead.get("assigned_name", ""),
            "visit_date": demo_date, "visit_time": demo_time,
            "purpose": body.get("purpose") or "Demo / Workshop",
            "planned_address": body.get("address", ""),
            "status": "planned",
            "created_by": user["email"], "created_at": now_iso,
        })
        update["demo_visit_plan_id"] = plan_id
        await log_activity(user["email"], "schedule_demo_physical", "lead", lead_id,
                           details=f"Physical workshop {demo_date} {demo_time}")
    else:  # online
        link = body.get("demo_link", "")
        update["demo_link"] = link
        contact_name = lead.get("contact_name", "Sir/Madam")
        msg = (f"Dear {contact_name}, your SmartShape online workshop is scheduled for "
               f"{demo_date} {demo_time}.\nJoin here: {link}")
        sent = await _send_demo_wa(lead.get("contact_phone", ""), msg)
        await log_activity(user["email"], "schedule_demo_online", "lead", lead_id,
                           details=f"Online workshop {demo_date} {demo_time} | WA sent={sent}")

    # record the stage change in pipeline_history if newly entering demo
    if lead.get("stage") != "demo":
        hist = lead.get("pipeline_history", []) or []
        hist.append({"from_stage": lead.get("stage"), "to_stage": "demo",
                     "by_email": user["email"], "by_name": user["name"],
                     "at": now_iso, "note": f"Demo scheduled ({fmt})"})
        update["pipeline_history"] = hist

    await db.leads.update_one({"lead_id": lead_id}, {"$set": update})
    if lead.get("school_id"):
        await touch_last_activity("school", lead["school_id"])
    return await db.leads.find_one({"lead_id": lead_id}, {"_id": 0})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_plan_a_demo.py::TestScheduleDemoPhysical -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/crm_routes.py backend/tests/test_plan_a_demo.py
git commit -m "feat(crm): schedule-demo endpoint — physical creates linked visit_plan"
```

---

## Task 2: Online demo path (dry-run WhatsApp)

**Files:**
- Test: `backend/tests/test_plan_a_demo.py`

- [ ] **Step 1: Write the failing test** (the endpoint already supports online from Task 1; this verifies it)

```python
class TestScheduleDemoOnline:
    @pytest.fixture(autouse=True)
    def setup(self):
        self.s = _login()
        self.lead_id = None
        yield
        if self.lead_id:
            self.s.delete(f"{BASE}/api/leads/{self.lead_id}")

    def test_online_demo_stores_link_no_visit(self):
        uid = uuid.uuid4().hex[:8]
        r = self.s.post(f"{BASE}/api/leads", json={
            "company_name": f"TEST_DemoO_{uid}", "contact_name": "T",
            "contact_phone": "9000000011", "stage": "contacted"})
        self.lead_id = r.json()["lead_id"]
        d = self.s.post(f"{BASE}/api/leads/{self.lead_id}/schedule-demo", json={
            "format": "online", "demo_date": "2026-07-02", "demo_time": "16:00",
            "demo_link": "https://meet.example.com/abc"})
        assert d.status_code == 200, d.text
        lead = d.json()
        assert lead["stage"] == "demo"
        assert lead["demo_format"] == "online"
        assert lead["demo_link"] == "https://meet.example.com/abc"
        assert not lead.get("demo_visit_plan_id")
```

- [ ] **Step 2: Run with the WA dry-run flag so no real message sends**

Run: `cd backend && DEMO_WA_DRY_RUN=1 python -m pytest tests/test_plan_a_demo.py::TestScheduleDemoOnline -v`
(PowerShell: `$env:DEMO_WA_DRY_RUN=1; python -m pytest tests/test_plan_a_demo.py::TestScheduleDemoOnline -v`)
Expected: PASS — but note this hits the running server's env. To truly avoid sends, restart the backend with `DEMO_WA_DRY_RUN=1` set, OR run against a non-prod backend.

- [ ] **Step 3: No new code** — Task 1 implemented the online branch. If the test fails, fix the online branch in `schedule_demo`.

- [ ] **Step 4: Commit (test only)**

```bash
git add backend/tests/test_plan_a_demo.py
git commit -m "test(crm): online schedule-demo stores link, no visit plan"
```

---

## Task 3: API bindings

**Files:**
- Modify: `frontend/src/lib/api.js` (the `leads` object)

- [ ] **Step 1: Add the binding** (no test — thin wrapper)

In the `leads` object, add:

```javascript
  scheduleDemo: (id, data) => API.post(`/leads/${id}/schedule-demo`, data),
```

(`visitPlans.create` already exists — reused as-is.)

- [ ] **Step 2: Verify build**

Run: `cd frontend && npm run build`
Expected: `Compiled` (warnings ok).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/api.js
git commit -m "feat(crm): api binding for schedule-demo"
```

---

## Task 4: DemoChooserDialog component

**Files:**
- Create: `frontend/src/components/crm/DemoChooserDialog.js`

- [ ] **Step 1: Create the component**

```javascript
import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { toast } from 'sonner';
import { leads as leadsApi } from '../../lib/api';
import { useTheme } from '../../contexts/ThemeContext';

/**
 * Physical-vs-Online workshop chooser + scheduling form.
 * onDone(updatedLead) is called after a successful schedule.
 */
export default function DemoChooserDialog({ open, onOpenChange, lead, onDone }) {
  const { isDark } = useTheme();
  const [format, setFormat] = useState('physical');
  const [form, setForm] = useState({ demo_date: '', demo_time: '', address: '', demo_link: '', purpose: '' });
  const [saving, setSaving] = useState(false);
  const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
  const dlg = isDark ? 'bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)]' : 'bg-white text-[var(--text-primary)]';
  const textSec = 'text-[var(--text-secondary)]';

  const submit = async () => {
    if (!form.demo_date || !form.demo_time) { toast.error('Pick a date and time'); return; }
    if (format === 'online' && !form.demo_link) { toast.error('Add a meeting link'); return; }
    setSaving(true);
    try {
      const r = await leadsApi.scheduleDemo(lead.lead_id, { format, ...form });
      toast.success(format === 'physical' ? 'Demo planned — visit added to the planning sheet' : 'Online demo scheduled — link sent');
      onOpenChange(false);
      onDone && onDone(r.data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to schedule demo');
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${dlg} w-[calc(100vw-1rem)] sm:max-w-md`}>
        <DialogHeader><DialogTitle>Plan Demo / Workshop</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-2">
            {['physical', 'online'].map(f => (
              <button key={f} onClick={() => setFormat(f)}
                className={`py-2 rounded-md text-sm font-medium border capitalize ${format === f ? 'bg-[#e94560] text-white border-transparent' : `${textSec} border-[var(--border-color)]`}`}
                data-testid={`demo-format-${f}`}>
                {f === 'physical' ? 'Physical workshop' : 'Online workshop'}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className={`${textSec} text-xs`}>Date</Label><Input type="date" value={form.demo_date} onChange={e => setForm({ ...form, demo_date: e.target.value })} className={inputCls} data-testid="demo-date" /></div>
            <div><Label className={`${textSec} text-xs`}>Time</Label><Input type="time" value={form.demo_time} onChange={e => setForm({ ...form, demo_time: e.target.value })} className={inputCls} data-testid="demo-time" /></div>
          </div>
          {format === 'physical' ? (
            <>
              <div><Label className={`${textSec} text-xs`}>Address</Label><Input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="Where is the workshop?" className={inputCls} /></div>
              <div><Label className={`${textSec} text-xs`}>Purpose</Label><Input value={form.purpose} onChange={e => setForm({ ...form, purpose: e.target.value })} placeholder="e.g. Robotics kit demo" className={inputCls} /></div>
            </>
          ) : (
            <div><Label className={`${textSec} text-xs`}>Meeting link</Label><Input value={form.demo_link} onChange={e => setForm({ ...form, demo_link: e.target.value })} placeholder="https://meet..." className={inputCls} data-testid="demo-link" /></div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-[var(--border-color)] text-[var(--text-secondary)]">Cancel</Button>
          <Button onClick={submit} disabled={saving} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="demo-submit">
            {saving ? 'Scheduling…' : 'Schedule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify build** — `cd frontend && npm run build` → `Compiled`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/crm/DemoChooserDialog.js
git commit -m "feat(crm): DemoChooserDialog (physical/online workshop)"
```

---

## Task 5: Wire the chooser into LeadDetailPanel (stage→demo + Plan Demo button)

**Files:**
- Modify: `frontend/src/components/crm/LeadDetailPanel.js`

- [ ] **Step 1: Import + state**

Add import near the top:

```javascript
import DemoChooserDialog from './DemoChooserDialog';
```

After the existing `const [lostNote, setLostNote] = React.useState('');` add:

```javascript
  const [demoOpen, setDemoOpen] = React.useState(false);
```

- [ ] **Step 2: Intercept stage→demo in `handleStageClick`**

Replace the existing `handleStageClick` (the function defined after the null guard) with:

```javascript
  const handleStageClick = (stageId) => {
    if (stageId === 'lost' && detailLead.stage !== 'lost') {
      setLostReason(''); setLostNote(''); setLostOpen(true);
      return;
    }
    if (stageId === 'demo' && detailLead.stage !== 'demo') {
      setDemoOpen(true);
      return;
    }
    changeStage(detailLead.lead_id, stageId);
  };
```

- [ ] **Step 3: Add a "Plan Demo" button** in the header action row (next to the WhatsApp/reassign/edit buttons). After the calendar button add:

```javascript
                <Button size="sm" variant="ghost" onClick={() => setDemoOpen(true)} className="text-purple-400" data-testid="plan-demo-btn"><Calendar className="h-4 w-4" /></Button>
```

- [ ] **Step 4: Render the dialog** — just before the closing `</>` of the component (next to the lost-reason dialog), add:

```javascript
      <DemoChooserDialog
        open={demoOpen}
        onOpenChange={setDemoOpen}
        lead={detailLead}
        onDone={(updated) => { setDetailLead(updated); fetchData(); }}
      />
```

- [ ] **Step 5: Verify build + commit**

Run: `cd frontend && npm run build` → `Compiled`.

```bash
git add frontend/src/components/crm/LeadDetailPanel.js
git commit -m "feat(crm): demo chooser on stage->demo + Plan Demo button"
```

---

## Task 6: Plan-Visit button on the School Profile Visits tab

**Files:**
- Create: `frontend/src/components/school/PlanVisitButton.js`
- Modify: `frontend/src/components/school/SchoolOrdersSection.js` (SchoolVisitsSection)

- [ ] **Step 1: Create the button + form**

```javascript
import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { toast } from 'sonner';
import { CalendarPlus } from 'lucide-react';
import { visitPlans as visitPlansApi } from '../../lib/api';

/**
 * "Plan Visit" button for the School Profile. Creates a visit_plan linked to the
 * school (and shows in the central Visit Planning sheet). onDone refreshes the profile.
 */
export default function PlanVisitButton({ school, onDone }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ visit_date: '', visit_time: '', purpose: '', planned_address: '' });
  const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';

  const submit = async () => {
    if (!form.visit_date || !form.visit_time) { toast.error('Pick a date and time'); return; }
    setSaving(true);
    try {
      await visitPlansApi.create({
        school_id: school.school_id,
        school_name: school.school_name,
        contact_person: school.primary_contact_name || '',
        contact_phone: school.phone || '',
        purpose: form.purpose || 'School visit',
        visit_date: form.visit_date, visit_time: form.visit_time,
        planned_address: form.planned_address || school.address || '',
      });
      toast.success('Visit planned — added to the Visit Planning sheet');
      setOpen(false);
      setForm({ visit_date: '', visit_time: '', purpose: '', planned_address: '' });
      onDone && onDone();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to plan visit');
    } finally { setSaving(false); }
  };

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="plan-visit-btn">
        <CalendarPlus className="mr-1.5 h-3.5 w-3.5" /> Plan Visit
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)] w-[calc(100vw-1rem)] sm:max-w-md">
          <DialogHeader><DialogTitle>Plan Visit — {school.school_name}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-[var(--text-secondary)] text-xs">Date</Label><Input type="date" value={form.visit_date} onChange={e => setForm({ ...form, visit_date: e.target.value })} className={inputCls} data-testid="visit-date" /></div>
              <div><Label className="text-[var(--text-secondary)] text-xs">Time</Label><Input type="time" value={form.visit_time} onChange={e => setForm({ ...form, visit_time: e.target.value })} className={inputCls} data-testid="visit-time" /></div>
            </div>
            <div><Label className="text-[var(--text-secondary)] text-xs">Purpose</Label><Input value={form.purpose} onChange={e => setForm({ ...form, purpose: e.target.value })} placeholder="Reason for the visit" className={inputCls} /></div>
            <div><Label className="text-[var(--text-secondary)] text-xs">Address</Label><Input value={form.planned_address} onChange={e => setForm({ ...form, planned_address: e.target.value })} placeholder="Defaults to school address" className={inputCls} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} className="border-[var(--border-color)] text-[var(--text-secondary)]">Cancel</Button>
            <Button onClick={submit} disabled={saving} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="visit-submit">{saving ? 'Saving…' : 'Plan Visit'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 2: Render it in `SchoolVisitsSection`**

In `frontend/src/components/school/SchoolOrdersSection.js`, find the `SchoolVisitsSection` function. Add the import at the top of the file:

```javascript
import PlanVisitButton from './PlanVisitButton';
```

Change the component signature to accept `school` and `onDone`, and render the button in its header. The section currently renders a heading then the list; wrap the heading row so it includes the button. Locate the `SchoolVisitsSection` return and add, as the first child of its outer container:

```javascript
      <div className="flex items-center justify-between mb-3">
        <p className={`text-sm font-semibold ${tk.t1}`}>Visits & Meetings</p>
        {school && <PlanVisitButton school={school} onDone={onDone} />}
      </div>
```

- [ ] **Step 3: Pass `school` + `onDone` from SchoolProfile**

In `frontend/src/pages/admin/SchoolProfile.js`, find where `SchoolVisitsSection` is rendered (in the `visits` tab):

```javascript
          {sp.activeTab === 'visits' && (
            <SchoolVisitsSection visits={visits} meetings={meetings} tk={tk} />
          )}
```

Replace with:

```javascript
          {sp.activeTab === 'visits' && (
            <SchoolVisitsSection visits={visits} meetings={meetings} tk={tk} school={school} onDone={sp.reload} />
          )}
```

- [ ] **Step 4: Verify build**

Run: `cd frontend && npm run build` → `Compiled`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/school/PlanVisitButton.js frontend/src/components/school/SchoolOrdersSection.js frontend/src/pages/admin/SchoolProfile.js
git commit -m "feat(crm): Plan Visit button on School Profile (links to Visit Planning sheet)"
```

---

## Task 7: Manual verification on a running app

- [ ] **Step 1:** Start backend (with `DEMO_WA_DRY_RUN=1` to avoid real sends) + frontend, log in as admin.
- [ ] **Step 2:** Open a School Profile → **Visits** tab → click **Plan Visit** → fill date/time → save → confirm it appears here AND in **Visit Planning** page (same `visit_plans` record).
- [ ] **Step 3:** Open a lead → click a stage chip **Demo** → chooser appears → pick **Physical** → date/time/address → Schedule → confirm a new planned visit shows in the Visit Planning sheet and `lead.demo_visit_plan_id` is set.
- [ ] **Step 4:** Repeat with **Online** → confirm `[demo][dry] WA -> …` appears in the backend log (no real message) and the lead shows `demo_format=online` + link.

---

## Self-Review notes
- **Spec coverage:** plan visit from profile (T6) ✓; demo physical/online chooser, both stage-change + button (T4/T5) ✓; physical → auto visit_plan in the sheet (T1) ✓; online → date/time+link, auto-send WhatsApp (T1/T2) ✓.
- **Reuse:** physical demo and Plan-Visit both write to the same `visit_plans` collection the central sheet reads → linkage is automatic, no duplication.
- **Prod-safety:** WA send gated by `DEMO_WA_DRY_RUN`; tests create+delete `TEST_` leads and the created visit plan.
- **Type consistency:** `schedule_demo` writes `demo_format`/`demo_date`/`demo_time`/`demo_link`/`demo_visit_plan_id`; the same keys are in `update_lead`'s allow-list and read by the frontend.
