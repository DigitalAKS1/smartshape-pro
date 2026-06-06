# Plan B — Leads from the School Profile (create + convert-with-message)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From a School Profile, let a rep (1) create a new lead for that school in two clicks, and (2) convert one of the school's contacts into a lead and optionally fire an intro WhatsApp to that contact in the same action.

**Architecture:** Reuse `POST /leads` (already prefills nothing about the school — we pass `school_id`/`company_name`). Extend the existing `POST /contacts/{contact_id}/convert-to-lead` to accept an optional `intro_message`; when present, WhatsApp it to the contact via a dry-run-gated helper. Frontend adds a focused "Create Lead" dialog and a "Convert → Lead" dialog on the profile (the profile already loads `rolesList`/`sourcesList`/`spList` for the contact form, so we reuse those).

**Tech Stack:** FastAPI + Motor (MongoDB), React (CRA), pytest integration tests against `${REACT_APP_BACKEND_URL}/api`.

**Safety:** Production DB + live WhatsApp. The intro send is gated by `INTRO_WA_DRY_RUN`. Tests create `TEST_` contacts/leads and delete them in teardown.

---

## File Structure
- `backend/routes/crm_routes.py` — add `_send_intro_wa()` helper; extend `convert_contact_to_lead` to accept + send `intro_message`.
- `frontend/src/components/school/SchoolLeadQuickCreate.js` — NEW: focused create-lead dialog for a school.
- `frontend/src/components/school/ConvertContactDialog.js` — NEW: convert-to-lead + optional intro message.
- `frontend/src/components/school/SchoolLeadsSection.js` — add the "Create Lead" button.
- `frontend/src/components/school/SchoolContactsSection.js` — wire the convert button to the new dialog.
- `frontend/src/pages/admin/SchoolProfile.js` — render the two dialogs; pass the master lists already loaded there.
- `frontend/src/lib/api.js` — add `contacts.convertToLead` (if missing).
- `backend/tests/test_plan_b_leads.py` — NEW integration tests.

---

## Task 1: Convert-to-lead accepts an intro message

**Files:**
- Modify: `backend/routes/crm_routes.py` (`convert_contact_to_lead`; helper near `log_activity`)
- Test: `backend/tests/test_plan_b_leads.py`

- [ ] **Step 1: Write the failing test**

```python
import os, uuid, requests, pytest
BASE = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")

def _login():
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/login", json={"email": "info@smartshape.in", "password": "admin123"})
    assert r.status_code == 200, r.text
    return s

class TestConvertWithIntro:
    @pytest.fixture(autouse=True)
    def setup(self):
        self.s = _login()
        self.contact_id = None
        self.lead_id = None
        yield
        if self.lead_id:
            self.s.delete(f"{BASE}/api/leads/{self.lead_id}")
        if self.contact_id:
            self.s.delete(f"{BASE}/api/contacts/{self.contact_id}")

    def test_convert_returns_lead_and_marks_contact(self):
        uid = uuid.uuid4().hex[:8]
        c = self.s.post(f"{BASE}/api/contacts", json={
            "name": f"TEST_Conv_{uid}", "phone": "9000000020", "email": f"t{uid}@x.com"})
        self.contact_id = c.json()["contact_id"]
        r = self.s.post(f"{BASE}/api/contacts/{self.contact_id}/convert-to-lead", json={
            "lead_type": "warm", "priority": "medium",
            "intro_message": "Hi, thanks for your interest in SmartShape!"})
        assert r.status_code == 200, r.text
        lead = r.json()
        assert lead.get("lead_id")
        self.lead_id = lead["lead_id"]
        assert lead.get("converted_from_contact") == self.contact_id
```

- [ ] **Step 2: Run test to verify it fails (or passes partially)**

Run: `cd backend && INTRO_WA_DRY_RUN=1 python -m pytest tests/test_plan_b_leads.py::TestConvertWithIntro -v`
Expected: FAIL if the endpoint rejects `intro_message`, or if the response shape differs. (If it already returns the lead, the test may pass except for the send — implement Step 3 to handle `intro_message`.)

- [ ] **Step 3: Implement the helper + send**

Add the helper near `log_activity` (~line 90) — independent of Plan A (distinct name):

```python
import os as _os
INTRO_WA_DRY_RUN = _os.getenv("INTRO_WA_DRY_RUN", "0") == "1"

async def _send_intro_wa(phone: str, message: str) -> bool:
    if not phone or not message:
        return False
    if INTRO_WA_DRY_RUN:
        import logging as _log
        _log.getLogger("crm").info(f"[intro][dry] WA -> {phone}: {message[:60]}")
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
            "send_mode": "lead_intro", "status": "sent", "sent_by": "system",
            "sent_at": datetime.now(timezone.utc).isoformat()})
        return True
    except Exception:
        return False
```

In `convert_contact_to_lead`, just before the final `return ...`, add:

```python
    intro = (body.get("intro_message") or "").strip()
    if intro:
        await _send_intro_wa(lead_doc.get("contact_phone", ""), intro)
```

(Use the variable name the endpoint already uses for the new lead document; if it is not `lead_doc`, read the created lead first: `created = await db.leads.find_one({"lead_id": lead_id}, {"_id": 0})` and send to `created["contact_phone"]`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && INTRO_WA_DRY_RUN=1 python -m pytest tests/test_plan_b_leads.py::TestConvertWithIntro -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/crm_routes.py backend/tests/test_plan_b_leads.py
git commit -m "feat(crm): convert-to-lead can fire an intro WhatsApp"
```

---

## Task 2: API binding for convert-to-lead

**Files:**
- Modify: `frontend/src/lib/api.js` (the `contacts` object)

- [ ] **Step 1: Ensure the binding exists** (add if missing)

In the `contacts` object add:

```javascript
  convertToLead: (id, data) => API.post(`/contacts/${id}/convert-to-lead`, data),
```

- [ ] **Step 2: Build + commit**

```bash
cd frontend && npm run build   # Compiled
git add frontend/src/lib/api.js
git commit -m "feat(crm): api binding contacts.convertToLead"
```

---

## Task 3: "Create Lead" dialog on the profile Leads tab

**Files:**
- Create: `frontend/src/components/school/SchoolLeadQuickCreate.js`
- Modify: `frontend/src/components/school/SchoolLeadsSection.js`
- Modify: `frontend/src/pages/admin/SchoolProfile.js`

- [ ] **Step 1: Create the focused dialog**

```javascript
import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { toast } from 'sonner';
import { leads as leadsApi } from '../../lib/api';

/**
 * Create a lead for a known school (school_id/company prefilled).
 * rolesList / sourcesList / spList are passed from the profile (already loaded there).
 */
export default function SchoolLeadQuickCreate({ open, onOpenChange, school, rolesList = [], sourcesList = [], spList = [], onDone }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    contact_name: '', contact_phone: '', contact_email: '',
    contact_role_id: '', designation: '', lead_type: 'warm', priority: 'medium',
    interested_product: '', assigned_to: '', source_id: '', source: '',
  });
  const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
  const textSec = 'text-[var(--text-secondary)]';

  const submit = async () => {
    if (!form.contact_name.trim() || !form.contact_phone.trim()) { toast.error('Contact name and phone required'); return; }
    setSaving(true);
    try {
      const sp = spList.find(s => s.email === form.assigned_to);
      await leadsApi.create({
        ...form,
        school_id: school.school_id,
        company_name: school.school_name,
        assigned_name: sp ? sp.name : '',
      });
      toast.success('Lead created');
      onOpenChange(false);
      onDone && onDone();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Failed to create lead');
    } finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)] w-[calc(100vw-1rem)] sm:max-w-md max-h-[88dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>New Lead — {school.school_name}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div><Label className={`${textSec} text-xs`}>Contact Name *</Label><Input value={form.contact_name} onChange={e => setForm({ ...form, contact_name: e.target.value })} className={inputCls} data-testid="ql-name" /></div>
            <div><Label className={`${textSec} text-xs`}>Phone *</Label><Input value={form.contact_phone} onChange={e => setForm({ ...form, contact_phone: e.target.value })} className={inputCls} data-testid="ql-phone" /></div>
          </div>
          <div><Label className={`${textSec} text-xs`}>Email</Label><Input value={form.contact_email} onChange={e => setForm({ ...form, contact_email: e.target.value })} className={inputCls} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className={`${textSec} text-xs`}>Role</Label>
              <select value={form.contact_role_id} onChange={e => { const r = rolesList.find(x => x.role_id === e.target.value); setForm({ ...form, contact_role_id: e.target.value, designation: r?.name || form.designation }); }} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`}>
                <option value="">Select role</option>
                {rolesList.map(r => <option key={r.role_id} value={r.role_id}>{r.name}</option>)}
              </select>
            </div>
            <div>
              <Label className={`${textSec} text-xs`}>Source</Label>
              <select value={form.source_id} onChange={e => { const s = sourcesList.find(x => x.source_id === e.target.value); setForm({ ...form, source_id: e.target.value, source: s?.name || '' }); }} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`}>
                <option value="">Select source</option>
                {sourcesList.map(s => <option key={s.source_id} value={s.source_id}>{s.name}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className={`${textSec} text-xs`}>Type</Label>
              <select value={form.lead_type} onChange={e => setForm({ ...form, lead_type: e.target.value })} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`}>
                <option value="hot">Hot</option><option value="warm">Warm</option><option value="cold">Cold</option>
              </select>
            </div>
            <div>
              <Label className={`${textSec} text-xs`}>Priority</Label>
              <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`}>
                <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
              </select>
            </div>
            <div>
              <Label className={`${textSec} text-xs`}>Assign To</Label>
              <select value={form.assigned_to} onChange={e => setForm({ ...form, assigned_to: e.target.value })} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`}>
                <option value="">Unassigned</option>
                {spList.map(sp => <option key={sp.email} value={sp.email}>{sp.name}</option>)}
              </select>
            </div>
          </div>
          <div><Label className={`${textSec} text-xs`}>Interested Product</Label><Input value={form.interested_product} onChange={e => setForm({ ...form, interested_product: e.target.value })} className={inputCls} placeholder="e.g. Robotics kit" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-[var(--border-color)] text-[var(--text-secondary)]">Cancel</Button>
          <Button onClick={submit} disabled={saving} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="ql-submit">{saving ? 'Creating…' : 'Create Lead'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Add the button to `SchoolLeadsSection`**

In `frontend/src/components/school/SchoolLeadsSection.js`, accept an `onCreate` prop and render a button in the section header. Add to the section's top row:

```javascript
        <Button onClick={onCreate} size="sm" className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="create-lead-on-profile">
          + Create Lead
        </Button>
```

(Import `Button` from `'../ui/button'` if not already imported.)

- [ ] **Step 3: Wire it in SchoolProfile**

In `frontend/src/pages/admin/SchoolProfile.js`:

Add import:

```javascript
import SchoolLeadQuickCreate from '../../components/school/SchoolLeadQuickCreate';
```

Add state (near the other dialog state):

```javascript
  const [leadCreateOpen, setLeadCreateOpen] = useState(false);
```

Pass `onCreate` to the leads section:

```javascript
          {sp.activeTab === 'leads' && (
            <SchoolLeadsSection leads={filteredLeads} stageFilter={sp.stageFilter} setStageFilter={sp.setStageFilter} tk={tk}
              onCreate={() => setLeadCreateOpen(true)} />
          )}
```

(Match the existing `SchoolLeadsSection` props; only `onCreate` is new.)

Render the dialog near the other dialogs:

```javascript
      <SchoolLeadQuickCreate
        open={leadCreateOpen}
        onOpenChange={setLeadCreateOpen}
        school={school}
        rolesList={rolesList}
        sourcesList={sourcesList}
        spList={spList}
        onDone={sp.reload}
      />
```

- [ ] **Step 4: Build + commit**

```bash
cd frontend && npm run build   # Compiled
git add frontend/src/components/school/SchoolLeadQuickCreate.js frontend/src/components/school/SchoolLeadsSection.js frontend/src/pages/admin/SchoolProfile.js
git commit -m "feat(crm): Create Lead from the School Profile Leads tab"
```

---

## Task 4: Convert contact → lead (with intro message) on the profile

**Files:**
- Create: `frontend/src/components/school/ConvertContactDialog.js`
- Modify: `frontend/src/components/school/SchoolContactsSection.js`
- Modify: `frontend/src/pages/admin/SchoolProfile.js`

- [ ] **Step 1: Create the convert dialog**

```javascript
import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { toast } from 'sonner';
import { contacts as contactsApi } from '../../lib/api';

const DEFAULT_INTRO = 'Hi {name}, thank you for your interest in SmartShape. Our team will reach out shortly!';

/**
 * Convert a contact to a lead, optionally firing an intro WhatsApp.
 * `contact` is the contact row; onDone refreshes the profile.
 */
export default function ConvertContactDialog({ open, onOpenChange, contact, spList = [], onDone }) {
  const [saving, setSaving] = useState(false);
  const [leadType, setLeadType] = useState('warm');
  const [assignedTo, setAssignedTo] = useState('');
  const [sendIntro, setSendIntro] = useState(true);
  const [intro, setIntro] = useState(DEFAULT_INTRO);
  const inputCls = 'bg-[var(--bg-primary)] border-[var(--border-color)] text-[var(--text-primary)]';
  const textSec = 'text-[var(--text-secondary)]';

  const submit = async () => {
    if (!contact) return;
    setSaving(true);
    try {
      const message = sendIntro
        ? intro.replace('{name}', (contact.name || '').split(' ')[0] || 'there')
        : '';
      await contactsApi.convertToLead(contact.contact_id, {
        lead_type: leadType, priority: 'medium',
        assigned_to: assignedTo || undefined,
        intro_message: message,
      });
      toast.success(sendIntro ? 'Converted to lead — intro sent' : 'Converted to lead');
      onOpenChange(false);
      onDone && onDone();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Convert failed');
    } finally { setSaving(false); }
  };

  if (!contact) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[var(--bg-card)] border-[var(--border-color)] text-[var(--text-primary)] w-[calc(100vw-1rem)] sm:max-w-md">
        <DialogHeader><DialogTitle>Convert to Lead — {contact.name}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className={`${textSec} text-xs`}>Lead Type</Label>
              <select value={leadType} onChange={e => setLeadType(e.target.value)} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`}>
                <option value="hot">Hot</option><option value="warm">Warm</option><option value="cold">Cold</option>
              </select>
            </div>
            <div>
              <Label className={`${textSec} text-xs`}>Assign To</Label>
              <select value={assignedTo} onChange={e => setAssignedTo(e.target.value)} className={`w-full h-10 px-3 rounded-md text-sm ${inputCls}`}>
                <option value="">Me / default</option>
                {spList.map(sp => <option key={sp.email} value={sp.email}>{sp.name}</option>)}
              </select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            <input type="checkbox" checked={sendIntro} onChange={e => setSendIntro(e.target.checked)} data-testid="send-intro-toggle" />
            Send intro WhatsApp to {contact.phone || 'contact'}
          </label>
          {sendIntro && (
            <div>
              <Label className={`${textSec} text-xs`}>Intro message</Label>
              <textarea value={intro} onChange={e => setIntro(e.target.value)} rows={3}
                className={`w-full px-3 py-2 rounded-md text-sm resize-none border ${inputCls}`} />
              <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{'{name}'} is replaced with the contact's first name.</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-[var(--border-color)] text-[var(--text-secondary)]">Cancel</Button>
          <Button onClick={submit} disabled={saving} className="bg-[#e94560] hover:bg-[#f05c75] text-white" data-testid="convert-submit">{saving ? 'Converting…' : 'Convert'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Wire the convert button in `SchoolContactsSection`**

In `frontend/src/components/school/SchoolContactsSection.js`, accept an `onConvert` prop and call `onConvert(contact)` from the existing convert (↓) button. Find the convert/down-arrow button in the contact row and set its onClick:

```javascript
                onClick={() => onConvert(contact)}
```

If no convert button exists yet, add one in the row's action group:

```javascript
              <button onClick={() => onConvert(contact)} className="text-[var(--text-muted)] hover:text-[#e94560]" title="Convert to lead" data-testid={`convert-${contact.contact_id}`}>↓</button>
```

- [ ] **Step 3: Wire it in SchoolProfile**

Add import + state:

```javascript
import ConvertContactDialog from '../../components/school/ConvertContactDialog';
```
```javascript
  const [convertTarget, setConvertTarget] = useState(null);
```

Pass `onConvert` to the contacts section (find where `SchoolContactsSection` is rendered):

```javascript
              openEditContact={sp.openEditContact}
              onConvert={(c) => setConvertTarget(c)} />
```

Render the dialog:

```javascript
      <ConvertContactDialog
        open={!!convertTarget}
        onOpenChange={(v) => { if (!v) setConvertTarget(null); }}
        contact={convertTarget}
        spList={spList}
        onDone={sp.reload}
      />
```

- [ ] **Step 4: Build + commit**

```bash
cd frontend && npm run build   # Compiled
git add frontend/src/components/school/ConvertContactDialog.js frontend/src/components/school/SchoolContactsSection.js frontend/src/pages/admin/SchoolProfile.js
git commit -m "feat(crm): convert contact to lead (with intro WhatsApp) from profile"
```

---

## Task 5: Manual verification

- [ ] **Step 1:** Start backend with `INTRO_WA_DRY_RUN=1` + frontend; log in as admin.
- [ ] **Step 2:** School Profile → **Leads** tab → **Create Lead** → fill name/phone → save → lead appears in the tab and the LEADS counter increments.
- [ ] **Step 3:** **Contacts** tab → convert (↓) on a contact → choose type, keep "Send intro" on → Convert → backend log shows `[intro][dry] WA -> …`; the contact now shows converted and a new lead exists.

---

## Self-Review notes
- **Spec coverage:** create lead from profile (T3) ✓; convert contact→lead (T4) ✓; "and message" → intro WhatsApp on convert (T1/T4) ✓.
- **Reuse:** `rolesList/sourcesList/spList` already loaded on the profile for the contact form are reused; `POST /leads` and `convert-to-lead` reused.
- **Independence from Plan A:** uses its own `_send_intro_wa` helper + `INTRO_WA_DRY_RUN` flag (no shared symbol), so this plan executes on its own.
- **Prod-safety:** intro send gated; tests create+delete `TEST_` contacts/leads.
