# Offline Mail — Endorsement, Drip Linking & Plan-vs-Actual Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Offline Mail's unit of truth from the run down to the individual mail touch, so the owner can print a "Book Post" endorsement, see which drip sequence sent what, and know exactly which pieces were actually posted versus merely planned.

**Architecture:** Every `mail_touches` document gains a three-state lifecycle (`planned → printed → sent/not_sent`) with a planned date and an actual date. Printing stamps `printed_at` automatically; an end-of-day verify sheet stamps the outcome; unsent pieces re-plan onto a new date without disturbing the drip sequence clock. Every report — gap report, Today's Post queue, sequence drill-down — is a query over those touches. All backend work lives in the existing `backend/routes/crm_routes.py` and `backend/routes/drip_routes.py`; no new services.

**Tech Stack:** FastAPI + Motor/MongoDB (backend), reportlab (sticker PDFs), React 19 + Tailwind (frontend), pytest + mongomock_motor + pypdf (tests).

**Spec:** `docs/superpowers/specs/2026-09-02-mail-verification-gap-design.md` — read it before starting. This plan implements spec sections P1, P2 and P3. P4 (filter/tag alignment) is a separate subsystem and gets its own plan.

## Global Constraints

- **Worktree:** all work happens in `F:/ss-mail` on branch `feat/mail-verify-gap`. Never work in `F:/SMARTSHAPE APP` (that checkout is on the stale `feat/module-rbac` fork) and never merge that branch.
- **Tests are gitignored.** `.gitignore` line 89 (`tests/`) means new files under `backend/tests/` are untracked. Write them, run them, but **do not** `git add -f` them — the house pattern for the last ~20 features is source-and-build commits only. Commits in this plan therefore list source files explicitly.
- **Never `git add -A`.** Add named paths only.
- **Run tests from `F:/ss-mail/backend`** with `python -m pytest` (not `python3` — that is a broken Store stub on this machine).
- **Frontend build:** `DISABLE_ESLINT_PLUGIN=true`, `NODE_OPTIONS=--max-old-space-size=4096`, and an inline `REACT_APP_BACKEND_URL=https://app.smartshape.in` (mandatory when building outside the primary worktree, or the bundle fetches `undefined`).
- **Sticker text scale** is clamped to `0.8`–`1.3`. **Verify statuses** are exactly `pending | sent | not_sent | skipped`. **Slip policy:** a re-planned touch never modifies its enrolment's `next_step_at`.
- **Route ordering:** every new static `/mail-runs/<word>` route MUST be declared above `/mail-runs/{run_id}`, or FastAPI matches the word as a `run_id`.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `backend/routes/crm_routes.py` | Sticker rendering, mail runs, touches, verify/replan/gap/queue endpoints | Modify |
| `backend/routes/drip_routes.py` | Sequence deliveries drill-down endpoint | Modify |
| `backend/scheduler.py` | Passes sequence ids into drip mailers; JOB14 overdue nudge | Modify |
| `backend/database.py` | Non-fatal `mail_touches` lifecycle backfill on boot | Modify |
| `frontend/src/lib/api.js` | Client methods for the new endpoints | Modify |
| `frontend/src/components/mail/MailAddressSheet.js` | Endorsement/text-size options; **Verify & post** tab | Modify |
| `frontend/src/components/mail/TodayPostQueue.js` | Cross-run "post today" queue + combined print | Create |
| `frontend/src/components/mail/GapReportPanel.js` | Plan-vs-actual reporting panel | Create |
| `frontend/src/pages/admin/OfflineMail.js` | Hosts the queue + gap panel; drip badge on runs | Modify |
| `frontend/src/components/marketing/DripsTab.js` | Sequence deliveries table + "mailers waiting to print" | Modify |

`MailAddressSheet.js` is already 329 lines and this plan adds a second mode to it. Extract the verify table into `frontend/src/components/mail/VerifyPostTable.js` (Task 15) so neither file grows unwieldy.

---

# PHASE P1 — Postal endorsement + font size

### Task 1: Sticker endorsement and text scale in `_render_label`

**Files:**
- Modify: `backend/routes/crm_routes.py` (`_render_label`, ~line 1120)
- Test: `backend/tests/test_sticker_endorsement.py`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `_render_label(c, x, y, w, h, sch, token, company, base_url, logo=None, frame=True, endorsement="", endorsement_pt=0, text_scale=1.0)` and module-level helper `_clamp_scale(v) -> float`. Task 2 calls `_build_stickers_pdf` with the same three new keyword arguments.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_sticker_endorsement.py`:

```python
"""Sticker labels: printable postal endorsement (Book Post / Open Post) and a
user-controlled text scale. Text is asserted by extracting it from the PDF."""
import io
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from pypdf import PdfReader

import routes.crm_routes as crm

SCHOOL = {
    "school_id": "s1", "school_name": "Air Force School 3Brd",
    "address": "Sector 31B", "city": "Chandigarh", "state": "Chandigarh",
    "pincode": "160030",
}
COMPANY = {"company_name": "Divine Computers Private Limited",
           "address": "1st Floor Plot 601, Sector 16A", "city": "Faridabad",
           "state": "Haryana", "pincode": "121002"}


def _text(pdf_bytes, page=0):
    return PdfReader(io.BytesIO(pdf_bytes)).pages[page].extract_text()


def _pdf(**kw):
    touches = [{"school_id": "s1", "qr_token": "tok1"}]
    return crm._build_stickers_pdf(touches, {"s1": SCHOOL}, COMPANY,
                                   "https://app.smartshape.in", show_logo=False, **kw)


def test_endorsement_prints_on_the_label():
    txt = _text(_pdf(endorsement="Book Post"))
    assert "Book Post" in txt
    assert "Air Force School" in txt      # address block survives


def test_no_endorsement_by_default():
    assert "Book Post" not in _text(_pdf())


def test_text_scale_is_clamped_both_ways():
    assert crm._clamp_scale(5) == 1.3
    assert crm._clamp_scale(0.1) == 0.8
    assert crm._clamp_scale(None) == 1.0
    assert crm._clamp_scale("1.1") == pytest.approx(1.1)


def test_address_block_survives_extreme_scales():
    for ts in (0.8, 1.3):
        txt = _text(_pdf(endorsement="Open Post", text_scale=ts))
        assert "Air Force School" in txt, f"school name lost at scale {ts}"
        assert "160030" in txt, f"pincode lost at scale {ts}"
        assert "Open Post" in txt


def test_endorsement_on_a4_four_up_and_small_label():
    assert "Book Post" in _text(_pdf(layout="a4", endorsement="Book Post"))
    small = _text(_pdf(size="75x50", endorsement="Book Post"))
    assert "Air Force School" in small     # compact branch still renders the school
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /f/ss-mail/backend && python -m pytest tests/test_sticker_endorsement.py -q`
Expected: FAIL — `AttributeError: module 'routes.crm_routes' has no attribute '_clamp_scale'`, and the endorsement assertions fail because `_build_stickers_pdf` rejects the unexpected keyword argument.

- [ ] **Step 3: Add the clamp helper**

In `backend/routes/crm_routes.py`, directly above `_parse_sticker_size`:

```python
def _clamp_scale(v):
    """Sticker text scale — user-controlled, but bounded so a label can never be
    scaled into unreadability or off its own edges."""
    try:
        return max(0.8, min(1.3, float(v)))
    except (TypeError, ValueError):
        return 1.0
```

- [ ] **Step 4: Thread the parameters through `_render_label`**

Change the signature:

```python
def _render_label(c, x, y, w, h, sch, token, company, base_url, logo=None, frame=True,
                  endorsement="", endorsement_pt=0, text_scale=1.0):
```

Immediately after the `m = max(...)` / `ix, iw = ...` lines, add:

```python
    ts = _clamp_scale(text_scale)
    endorsement = str(endorsement or "").strip()
```

In the **compact branch** (`if h < 45 * mm:`) multiply the two font sizes and draw the endorsement above the name, only when it fits:

```python
        f_name = max(6, min(9.5, (h / mm) * 0.30)) * ts
        f_body = max(5, f_name * 0.8)
        qsz = max(9 * mm, min(h - 2 * m, w * 0.30))
        tw = w - qsz - 3 * m
        cy = y + h - m - f_name
        if endorsement:
            e_sz = float(endorsement_pt) if endorsement_pt else f_name * 0.8
            if c.stringWidth(endorsement, "Helvetica-Bold", e_sz) <= tw:
                c.setFont("Helvetica-Bold", e_sz)
                c.drawString(ix, cy, endorsement)
                cy -= e_sz * 1.15
```

In the **full branch**, apply `ts` to the four clamped font sizes:

```python
    f_lbl  = max(5.5, min(9, 8 * scale)) * ts
    f_body = max(6.5, min(11, 11 * scale)) * ts
    f_name = max(8, min(15, 14 * scale)) * ts
    f_pin  = max(7, min(13, 12 * scale)) * ts
```

- [ ] **Step 5: Draw the endorsement and make the TO block self-fitting**

Replace the block that computes `block_h`, `free` and `cy` (just before the `for text, font, sz in to_lines:` loop) with:

```python
    def _lh(sz):
        return sz * 1.18
    block_h = sum(_lh(sz) for _, _, sz in to_lines)

    top = y + h - m
    if endorsement:
        # Right-aligned above "To," — where the clerk looks, and clear of the
        # address block, which wraps to the full inner width.
        e_sz = float(endorsement_pt) if endorsement_pt else f_name * 0.8
        c.setFont("Helvetica-Bold", e_sz)
        c.drawRightString(x + w - m, top - e_sz, endorsement[:40])
        top -= e_sz * 1.25

    # A larger text scale must never push the address into the From block: if the
    # lines no longer fit the top zone, shrink them proportionally to fit.
    top_h = top - dv
    if block_h > top_h > 0:
        shrink = top_h / block_h
        to_lines = [(t, f, sz * shrink) for t, f, sz in to_lines]
        block_h = top_h

    cy = top - max(0.0, top_h - block_h) * 0.30     # 30% of slack above
    for text, font, sz in to_lines:
        c.setFont(font, sz); c.drawString(ix, cy - sz, text); cy -= _lh(sz)
```

- [ ] **Step 6: Thread the parameters through `_build_stickers_pdf`**

Change its signature to add `endorsement="", endorsement_pt=0, text_scale=1.0`, then pass them to **both** `_render_label` call sites (the A4 4-up loop and the thermal loop):

```python
            _render_label(c, cx, cyy, cw, ch, schools_by_id.get(t.get("school_id"), {}),
                          t.get("qr_token", ""), company, base_url, logo=logo, frame=False,
                          endorsement=endorsement, endorsement_pt=endorsement_pt,
                          text_scale=text_scale)
```

```python
        _render_label(c, 0, 0, W, H, schools_by_id.get(t.get("school_id"), {}),
                      t.get("qr_token", ""), company, base_url, logo=logo,
                      endorsement=endorsement, endorsement_pt=endorsement_pt,
                      text_scale=text_scale)
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd /f/ss-mail/backend && python -m pytest tests/test_sticker_endorsement.py -q`
Expected: 5 passed.

- [ ] **Step 8: Commit**

```bash
cd /f/ss-mail && git add backend/routes/crm_routes.py
git commit -m "feat(mail): printable postal endorsement + text scale on address stickers"
```

---

### Task 2: Sticker endpoint accepts the new options and falls back to company defaults

**Files:**
- Modify: `backend/routes/crm_routes.py` (`mail_run_stickers`, ~line 1320)
- Test: `backend/tests/test_sticker_endorsement.py` (append)

**Interfaces:**
- Consumes: `_build_stickers_pdf(..., endorsement, endorsement_pt, text_scale)` from Task 1.
- Produces: `GET /mail-runs/{run_id}/stickers.pdf` honouring query params `endorsement`, `endorsement_pt`, `text_scale`; company settings keys `sticker_endorsement`, `sticker_endorsement_pt`, `sticker_text_scale`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_sticker_endorsement.py`:

```python
import asyncio
from mongomock_motor import AsyncMongoMockClient

ADMIN = {"email": "admin@smartshape.in", "name": "Admin", "role": "admin", "roles": ["admin"]}


class FakeRequest:
    def __init__(self, params=None):
        self.query_params = params or {}


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(crm, "db", d)

    async def _fake(_r):
        return ADMIN
    monkeypatch.setattr(crm, "get_current_user", _fake)
    return d


async def _seed(d, company_extra=None):
    await d.mail_runs.insert_one({"run_id": "R1", "name": "Run", "school_ids": ["s1"]})
    await d.mail_touches.insert_one({"touch_id": "t1", "run_id": "R1",
                                     "school_id": "s1", "qr_token": "tok1"})
    await d.schools.insert_one(dict(SCHOOL))
    await d.settings.insert_one({"type": "company", **COMPANY, **(company_extra or {})})


async def _pdf_bytes(resp):
    chunks = [c async for c in resp.body_iterator]
    return b"".join(chunks)


def test_query_param_endorsement_reaches_the_pdf(db):
    async def go():
        await _seed(db)
        r = await crm.mail_run_stickers("R1", FakeRequest({"endorsement": "Book Post"}))
        assert "Book Post" in _text(await _pdf_bytes(r))
    asyncio.run(go())


def test_company_default_endorsement_is_used_when_no_param(db):
    async def go():
        await _seed(db, {"sticker_endorsement": "Open Post"})
        r = await crm.mail_run_stickers("R1", FakeRequest({}))
        assert "Open Post" in _text(await _pdf_bytes(r))
    asyncio.run(go())


def test_query_param_overrides_the_company_default(db):
    async def go():
        await _seed(db, {"sticker_endorsement": "Open Post"})
        r = await crm.mail_run_stickers("R1", FakeRequest({"endorsement": "Book Post"}))
        txt = _text(await _pdf_bytes(r))
        assert "Book Post" in txt and "Open Post" not in txt
    asyncio.run(go())
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /f/ss-mail/backend && python -m pytest tests/test_sticker_endorsement.py -q -k "endorsement_reaches or company_default or overrides"`
Expected: FAIL — the generated PDF contains no endorsement text.

- [ ] **Step 3: Read the options in the endpoint**

In `mail_run_stickers`, after `size = qp.get("size") or "100x150"`, add:

```python
    # Endorsement ("Book Post" / "Open Post") + text size: per-batch query params
    # win, else the saved Settings → Company defaults.
    endorsement = qp.get("endorsement")
    if endorsement is None:
        endorsement = company.get("sticker_endorsement", "")
    endorsement_pt = qp.get("endorsement_pt") or company.get("sticker_endorsement_pt") or 0
    try:
        endorsement_pt = float(endorsement_pt)
    except (TypeError, ValueError):
        endorsement_pt = 0
    text_scale = _clamp_scale(qp.get("text_scale") or company.get("sticker_text_scale") or 1.0)
```

- [ ] **Step 4: Pass them into the builder**

```python
    pdf = _build_stickers_pdf(touches, schools_by_id, company, base, orientation=orientation,
                              size=size, layout=layout, from_override=from_override,
                              show_logo=show_logo, endorsement=endorsement,
                              endorsement_pt=endorsement_pt, text_scale=text_scale)
```

- [ ] **Step 5: Allow the settings endpoint to persist the three new fields**

Find the company-settings save handler (`grep -n "sticker_tagline" backend/routes/settings_routes.py`) and add `"sticker_endorsement"`, `"sticker_endorsement_pt"`, `"sticker_text_scale"` to its allowed-fields list, alongside the existing `sticker_tagline` and `sticker_contact`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd /f/ss-mail/backend && python -m pytest tests/test_sticker_endorsement.py -q`
Expected: 8 passed.

- [ ] **Step 7: Commit**

```bash
cd /f/ss-mail && git add backend/routes/crm_routes.py backend/routes/settings_routes.py
git commit -m "feat(mail): stickers.pdf honours endorsement + text-size options, saved as company defaults"
```

---

### Task 3: Endorsement and text-size controls in the print-options panel

**Files:**
- Modify: `frontend/src/components/mail/MailAddressSheet.js`

**Interfaces:**
- Consumes: the query params from Task 2.
- Produces: `opts.endorsement`, `opts.endorsementPt`, `opts.textScale` in the sheet's print state; `buildPrintParams()` emits `endorsement` / `endorsement_pt` / `text_scale`.

- [ ] **Step 1: Extend the print-options state**

In `MailAddressSheet.js`, change the `opts` initial state:

```js
  const [opts, setOpts] = useState({ format: '100x150', orientation: 'portrait', customW: '100', customH: '150', skipIncomplete: true, showLogo: true, endorsement: '', endorsementPt: 0, textScale: 1 });
```

Load the saved defaults inside the existing `settingsApi.getCompany()` effect, right after `setLogoUrl(...)`:

```js
      setOpts(o => ({ ...o,
        endorsement: c.sticker_endorsement || '',
        endorsementPt: Number(c.sticker_endorsement_pt || 0),
        textScale: Number(c.sticker_text_scale || 1) }));
```

- [ ] **Step 2: Emit the params**

In `buildPrintParams()`, before `return p;`:

```js
    if (opts.endorsement.trim()) p.endorsement = opts.endorsement.trim();
    if (opts.endorsementPt > 0) p.endorsement_pt = opts.endorsementPt;
    if (Number(opts.textScale) !== 1) p.text_scale = opts.textScale;
```

- [ ] **Step 3: Add the UI block**

Insert directly above the `{/* Sender (From) + logo */}` block:

```jsx
            {/* Postal endorsement — what you write by hand today ("Open Post") */}
            <div className="rounded-lg border border-[var(--border-color)] p-3 space-y-2.5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Postal endorsement</div>
              <p className="text-[11px] text-[var(--text-muted)] -mt-1">Prints in the top-right of the label — what decides the tariff at the counter.</p>
              <div className="flex flex-wrap gap-1.5">
                {['Book Post', 'Open Post', 'Printed Matter', 'Book Packet'].map(x => (
                  <button key={x} type="button" onClick={() => setOpts(o => ({ ...o, endorsement: o.endorsement === x ? '' : x }))}
                    className={`h-7 px-2.5 rounded-full text-[11px] font-semibold border transition-colors ${opts.endorsement === x ? 'bg-[#e94560] text-white border-[#e94560]' : 'border-[var(--border-color)] text-[var(--text-secondary)]'}`}
                    data-testid={`endorse-${x.replace(/\s/g, '-').toLowerCase()}`}>{x}</button>
                ))}
              </div>
              <input className={cell} placeholder="Or type your own (leave blank for none)" value={opts.endorsement}
                onChange={e => setOpts(o => ({ ...o, endorsement: e.target.value }))} data-testid="endorsement-input" />
              <div className="grid sm:grid-cols-2 gap-3">
                <Stepper label="Endorsement size" value={opts.endorsementPt} suffix="pt" min={0} max={40} step={1}
                  hint={opts.endorsementPt === 0 ? 'auto' : null}
                  onChange={v => setOpts(o => ({ ...o, endorsementPt: v }))} testId="endorsement-pt" />
                <Stepper label="Text size (whole label)" value={Math.round(opts.textScale * 100)} suffix="%" min={80} max={130} step={5}
                  onChange={v => setOpts(o => ({ ...o, textScale: v / 100 }))} testId="text-scale" />
              </div>
            </div>
```

- [ ] **Step 4: Add the `Stepper` component**

At the bottom of `MailAddressSheet.js`, above the default export's closing brace is not valid — add it as a module-level component **after** the default export function:

```jsx
/** Small +/- numeric control. `hint` replaces the number when set (e.g. "auto"). */
function Stepper({ label, value, suffix, min, max, step, onChange, hint, testId }) {
  const clamp = (v) => Math.max(min, Math.min(max, v));
  const btn = 'h-8 w-8 rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[#e94560] hover:border-[#e94560] text-base leading-none font-semibold disabled:opacity-40';
  return (
    <div>
      <label className="block text-[11px] text-[var(--text-muted)] mb-1">{label}</label>
      <div className="flex items-center gap-2">
        <button type="button" className={btn} disabled={value <= min} onClick={() => onChange(clamp(value - step))} data-testid={`${testId}-dec`}>−</button>
        <span className="min-w-[3.5rem] text-center text-[13px] font-mono font-semibold text-[var(--text-primary)]" data-testid={`${testId}-val`}>
          {hint || `${value}${suffix}`}
        </span>
        <button type="button" className={btn} disabled={value >= max} onClick={() => onChange(clamp(value + step))} data-testid={`${testId}-inc`}>+</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Persist them with "Save as default"**

In `saveFromAsDefault`, extend the payload:

```js
      await settingsApi.saveCompany({ company_name: from.company_name, address: from.address, city: from.city, state: from.state, pincode: from.pincode, sticker_tagline: from.sticker_tagline, sticker_contact: from.sticker_contact, sticker_endorsement: opts.endorsement, sticker_endorsement_pt: opts.endorsementPt, sticker_text_scale: opts.textScale });
```

- [ ] **Step 6: Verify the build compiles**

Run:
```bash
cd /f/ss-mail/frontend && DISABLE_ESLINT_PLUGIN=true NODE_OPTIONS=--max-old-space-size=4096 REACT_APP_BACKEND_URL=https://app.smartshape.in npx react-scripts build
```
Expected: "Compiled successfully" (warnings are fine).

- [ ] **Step 7: Commit**

```bash
cd /f/ss-mail && git add frontend/src/components/mail/MailAddressSheet.js
git commit -m "feat(mail): endorsement chips + font-size steppers in the sticker print options"
```

---

# PHASE P2 — Real drip↔mail linking

### Task 4: Drip mailers get per-sequence runs and back-linked touches

**Files:**
- Modify: `backend/routes/crm_routes.py` (`create_physical_from_drip`, ~line 159)
- Modify: `backend/scheduler.py` (~line 457, the `physical_material` branch)
- Test: `backend/tests/test_drip_mail_linking.py`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `create_physical_from_drip(lead, material_type, seq_name, material_name="", sequence_id="", enrollment_id="", step_number=0, planned_date="")`. Every drip touch carries `sequence_id`, `enrollment_id`, `step_number`, `source="drip"`, `planned_date`. Runs carry `sequence_id` + `sequence_name`. Task 12 joins on `enrollment_id` + `step_number`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_drip_mail_linking.py`:

```python
"""Drip physical steps produce ONE mail run per (sequence, piece, day), and every
touch back-links to the enrolment + step so the sequence drill-down can join it."""
import asyncio
import os
from datetime import datetime, timezone

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

import routes.crm_routes as crm

LEAD = {"lead_id": "L1", "school_id": "s1", "contact_name": "Principal",
        "company_name": "Air Force School", "assigned_to": "rep@smartshape.in"}
TODAY = datetime.now(timezone.utc).strftime("%Y-%m-%d")


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(crm, "db", d)
    return d


def test_touch_backlinks_to_sequence_and_step(db):
    async def go():
        await crm.create_physical_from_drip(
            LEAD, "brochure", "Principal Pitch", material_name="2026 Catalogue",
            sequence_id="SEQ1", enrollment_id="E1", step_number=3, planned_date=TODAY)
        t = await db.mail_touches.find_one({"school_id": "s1"}, {"_id": 0})
        assert t["sequence_id"] == "SEQ1"
        assert t["enrollment_id"] == "E1"
        assert t["step_number"] == 3
        assert t["source"] == "drip"
        assert t["planned_date"] == TODAY
        assert t["item_name"] == "2026 Catalogue"
    asyncio.run(go())


def test_two_sequences_same_day_get_two_runs(db):
    async def go():
        await crm.create_physical_from_drip(LEAD, "brochure", "Seq A", sequence_id="A",
                                            enrollment_id="E1", step_number=1)
        await crm.create_physical_from_drip({**LEAD, "school_id": "s2"}, "brochure",
                                            "Seq B", sequence_id="B",
                                            enrollment_id="E2", step_number=1)
        runs = await db.mail_runs.find({}, {"_id": 0}).to_list(None)
        assert len(runs) == 2
        assert {r["sequence_id"] for r in runs} == {"A", "B"}
        assert {r["sequence_name"] for r in runs} == {"Seq A", "Seq B"}
    asyncio.run(go())


def test_two_piece_types_same_sequence_get_two_runs(db):
    async def go():
        await crm.create_physical_from_drip(LEAD, "brochure", "Seq A", sequence_id="A",
                                            enrollment_id="E1", step_number=1)
        await crm.create_physical_from_drip({**LEAD, "school_id": "s2"}, "sample",
                                            "Seq A", sequence_id="A",
                                            enrollment_id="E2", step_number=2)
        runs = await db.mail_runs.find({}, {"_id": 0}).to_list(None)
        assert len(runs) == 2
        assert {r["piece_type"] for r in runs} == {"brochure", "sample"}
    asyncio.run(go())


def test_same_sequence_and_piece_share_one_run(db):
    async def go():
        for i, sid in enumerate(("s1", "s2", "s3")):
            await crm.create_physical_from_drip({**LEAD, "school_id": sid}, "brochure",
                                                "Seq A", sequence_id="A",
                                                enrollment_id=f"E{i}", step_number=1)
        runs = await db.mail_runs.find({}, {"_id": 0}).to_list(None)
        assert len(runs) == 1
        assert await db.mail_touches.count_documents({"run_id": runs[0]["run_id"]}) == 3
        assert sorted(runs[0]["school_ids"]) == ["s1", "s2", "s3"]
        assert runs[0]["counts"]["sent"] == 3
    asyncio.run(go())


def test_same_school_twice_is_not_duplicated(db):
    async def go():
        for _ in range(2):
            await crm.create_physical_from_drip(LEAD, "brochure", "Seq A", sequence_id="A",
                                                enrollment_id="E1", step_number=1)
        assert await db.mail_touches.count_documents({"school_id": "s1"}) == 1
    asyncio.run(go())


def test_legacy_run_without_sequence_id_is_reused(db):
    """A run created by the previous code path must not cause a second run (and a
    second posting) when the new code deploys mid-day."""
    async def go():
        await db.mail_runs.insert_one({
            "run_id": "LEGACY", "name": f"Drip Mailers — {TODAY}", "is_drip_run": True,
            "send_date": TODAY, "piece_type": "brochure", "school_ids": [],
            "counts": {"sent": 0, "delivered": 0, "responded": 0, "appointments": 0}})
        await crm.create_physical_from_drip(LEAD, "brochure", "Seq A", sequence_id="A",
                                            enrollment_id="E1", step_number=1)
        assert await db.mail_runs.count_documents({}) == 1
        t = await db.mail_touches.find_one({"school_id": "s1"}, {"_id": 0})
        assert t["run_id"] == "LEGACY"
    asyncio.run(go())


def test_lead_without_school_still_queues_the_dispatch(db):
    async def go():
        did = await crm.create_physical_from_drip({"lead_id": "L9"}, "brochure", "Seq A")
        assert did.startswith("pd_")
        assert await db.mail_touches.count_documents({}) == 0
    asyncio.run(go())
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /f/ss-mail/backend && python -m pytest tests/test_drip_mail_linking.py -q`
Expected: FAIL — `create_physical_from_drip() got an unexpected keyword argument 'sequence_id'`.

- [ ] **Step 3: Rewrite the mailer section of `create_physical_from_drip`**

Change the signature:

```python
async def create_physical_from_drip(lead: dict, material_type: str, seq_name: str,
                                    material_name: str = "", sequence_id: str = "",
                                    enrollment_id: str = "", step_number: int = 0,
                                    planned_date: str = "") -> str:
```

Then replace the whole `if sid:` block with:

```python
    sid = lead.get("school_id", "")
    if sid:
        try:
            today = now.strftime("%Y-%m-%d")
            piece = material_type or "brochure"
            planned = planned_date or today
            # One run per (sequence, piece, day) so a brochure step and a sample step
            # of two sequences don't collapse into one unprintable pile.
            run = await db.mail_runs.find_one(
                {"is_drip_run": True, "send_date": today,
                 "sequence_id": sequence_id, "piece_type": piece},
                {"_id": 0, "run_id": 1})
            if not run:
                # Mid-day deploy safety: reuse a run made by the older, coarser key
                # rather than creating a second run and posting a school twice.
                run = await db.mail_runs.find_one(
                    {"is_drip_run": True, "send_date": today, "piece_type": piece,
                     "sequence_id": {"$exists": False}},
                    {"_id": 0, "run_id": 1})
            if not run:
                run_id = f"run_{uuid.uuid4().hex[:10]}"
                label = f"{seq_name} · {piece} — {today}" if seq_name else f"Drip Mailers — {today}"
                await db.mail_runs.insert_one({
                    "run_id": run_id, "name": label, "area_id": "",
                    "piece_type": piece, "deal_type_target": "", "school_ids": [],
                    "send_date": today, "courier": "", "tracking_no": "", "courier_cost": 0,
                    "status": "planned", "is_drip_run": True,
                    "sequence_id": sequence_id, "sequence_name": seq_name,
                    "created_by": "system", "created_at": now_iso,
                    "counts": {"sent": 0, "delivered": 0, "responded": 0, "appointments": 0}})
            else:
                run_id = run["run_id"]
            if not await db.mail_touches.find_one({"run_id": run_id, "school_id": sid},
                                                  {"_id": 0, "touch_id": 1}):
                await db.mail_touches.insert_one({
                    "touch_id": f"mt_{uuid.uuid4().hex[:10]}", "run_id": run_id, "school_id": sid,
                    "lead_id": lead.get("lead_id", ""), "piece_type": piece,
                    "item_name": item, "posted_at": None,
                    "qr_token": uuid.uuid4().hex[:16], "delivery_status": "pending",
                    "responded": False, "responded_at": None, "response_channel": "",
                    "appointment": False, "next_action_date": "", "outcome_note": "",
                    "owner": lead.get("assigned_to", "") or "system", "created_at": now_iso,
                    # lifecycle + drip back-links
                    "planned_date": planned, "verify_status": "pending",
                    "printed_at": None, "print_batch_id": "", "replan_count": 0,
                    "source": "drip", "sequence_id": sequence_id,
                    "enrollment_id": enrollment_id, "step_number": step_number})
                await db.mail_runs.update_one(
                    {"run_id": run_id}, {"$addToSet": {"school_ids": sid}, "$inc": {"counts.sent": 1}})
        except Exception:
            pass  # mailer is best-effort; the dispatch + task already exist
    return dispatch_id
```

- [ ] **Step 4: Pass the ids from the scheduler**

In `backend/scheduler.py`, in the `if msg_type == "physical_material":` branch, replace the call with:

```python
                    await create_physical_from_drip(
                        lead, step.get("material_type", "brochure"), seq.get("name", "drip"),
                        material_name=step.get("material_name", ""),
                        sequence_id=enr["sequence_id"], enrollment_id=enr["enrollment_id"],
                        step_number=step["step_number"],
                        planned_date=(enrolled_at + timedelta(days=step["delay_days"])).strftime("%Y-%m-%d"))
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd /f/ss-mail/backend && python -m pytest tests/test_drip_mail_linking.py tests/test_drip_physical_mailer.py -q`
Expected: all passed — including the pre-existing `test_drip_physical_mailer.py`, which must not regress.

- [ ] **Step 6: Commit**

```bash
cd /f/ss-mail && git add backend/routes/crm_routes.py backend/scheduler.py
git commit -m "feat(mail): drip mailers get per-sequence runs and enrolment back-links"
```

---

### Task 5: Surface drip runs in Offline Mail and link them from the sequence card

**Files:**
- Modify: `frontend/src/pages/admin/OfflineMail.js`
- Modify: `frontend/src/components/marketing/DripsTab.js`

**Interfaces:**
- Consumes: `run.sequence_id` / `run.sequence_name` / `run.is_drip_run` from Task 4.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Add the drip badge to the desktop run table**

In `OfflineMail.js`, replace the run-name cell:

```jsx
                        <td className="py-2.5 pr-3 text-[var(--text-primary)] font-medium">
                          {r.name}
                          {r.is_drip_run && (
                            <span className="ml-1.5 align-middle text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#e94560]/10 text-[#e94560]"
                              title={r.sequence_name ? `Auto-created by the "${r.sequence_name}" sequence` : 'Auto-created by a drip sequence'}>
                              Drip
                            </span>
                          )}
                        </td>
```

- [ ] **Step 2: Add the same badge to the mobile card**

In the mobile card block, replace the sub-line:

```jsx
                          <p className="text-[11px] text-[var(--text-muted)] capitalize">
                            {r.is_drip_run ? (r.sequence_name || 'Drip') : areaName(r.area_id)} · {r.piece_type}{r.courier ? ` · ${r.courier}` : ''}
                          </p>
```

- [ ] **Step 3: Show waiting mailers on the sequence card**

In `DripsTab.js`, add to the imports:

```js
import { mailRuns } from '../../lib/api';
import { useNavigate } from 'react-router-dom';
```

Inside `DripsTab`, add:

```js
  const navigate = useNavigate();
  const [pending, setPending] = useState({});   // { sequence_id: pending_count }
  React.useEffect(() => {
    mailRuns.getAll()
      .then(r => {
        const acc = {};
        (r.data || []).forEach(run => {
          if (run.is_drip_run && run.sequence_id && run.status !== 'closed') {
            acc[run.sequence_id] = (acc[run.sequence_id] || 0) + (run.counts?.pending ?? run.counts?.sent ?? 0);
          }
        });
        setPending(acc);
      })
      .catch(() => {});
  }, []);
```

- [ ] **Step 4: Render the link in the card header**

Directly above the `<Switch ...>` in the card header:

```jsx
                {pending[d.sequence_id] > 0 && (
                  <button onClick={() => navigate('/offline-mail')}
                    className="h-7 px-2 rounded-lg bg-[#e94560]/10 text-[#e94560] text-[10px] font-semibold flex-shrink-0"
                    title="Mailers queued by this sequence are waiting to be printed and posted"
                    data-testid={`waiting-print-${d.sequence_id}`}>
                    {pending[d.sequence_id]} to print
                  </button>
                )}
```

Note: `d.sequence_id` comes through `mapSeq` — confirm with `grep -n "sequence_id" frontend/src/lib/marketingUtils.js` and use whatever key it exposes (`d.id` mirrors it if `sequence_id` is not mapped).

- [ ] **Step 5: Verify the build compiles**

Run:
```bash
cd /f/ss-mail/frontend && DISABLE_ESLINT_PLUGIN=true NODE_OPTIONS=--max-old-space-size=4096 REACT_APP_BACKEND_URL=https://app.smartshape.in npx react-scripts build
```
Expected: "Compiled successfully".

- [ ] **Step 6: Commit**

```bash
cd /f/ss-mail && git add frontend/src/pages/admin/OfflineMail.js frontend/src/components/marketing/DripsTab.js
git commit -m "feat(mail): drip badge on runs and 'N to print' on the sequence card"
```

---

# PHASE P3 — Three-state lifecycle, verification, gap report

### Task 6: Backfill the lifecycle fields onto existing touches

**Files:**
- Modify: `backend/database.py`
- Test: `backend/tests/test_mail_touch_backfill.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `backfill_mail_touch_lifecycle(db) -> dict` with keys `scanned`, `updated`. Called non-fatally from the same boot path as the existing index helpers.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_mail_touch_backfill.py`:

```python
"""Legacy mail touches get the lifecycle fields. Critically: touches on a run that
was already marked 'posted' must backfill as SENT, or the whole mailing history
would suddenly report as never-posted and every ROI number would collapse."""
import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

from database import backfill_mail_touch_lifecycle


@pytest.fixture()
def db():
    return AsyncMongoMockClient()["smartshape_test"]


def test_legacy_touch_on_posted_run_backfills_as_sent(db):
    async def go():
        await db.mail_runs.insert_one({"run_id": "R1", "status": "posted",
                                       "send_date": "2026-07-01",
                                       "created_at": "2026-07-01T00:00:00+00:00"})
        await db.mail_touches.insert_one({"touch_id": "t1", "run_id": "R1",
                                          "school_id": "s1",
                                          "posted_at": "2026-07-02T05:00:00+00:00"})
        res = await backfill_mail_touch_lifecycle(db)
        assert res["updated"] == 1
        t = await db.mail_touches.find_one({"touch_id": "t1"}, {"_id": 0})
        assert t["verify_status"] == "sent"
        assert t["posted_at"] == "2026-07-02T05:00:00+00:00"   # preserved
        assert t["planned_date"] == "2026-07-01"
        assert t["replan_count"] == 0
        assert t["source"] == "manual"
    asyncio.run(go())


def test_legacy_touch_on_planned_run_backfills_as_pending(db):
    async def go():
        await db.mail_runs.insert_one({"run_id": "R1", "status": "planned",
                                       "send_date": "2026-08-01"})
        await db.mail_touches.insert_one({"touch_id": "t1", "run_id": "R1", "school_id": "s1"})
        await backfill_mail_touch_lifecycle(db)
        t = await db.mail_touches.find_one({"touch_id": "t1"}, {"_id": 0})
        assert t["verify_status"] == "pending"
        assert t["planned_date"] == "2026-08-01"
    asyncio.run(go())


def test_planned_date_falls_back_to_run_created_at(db):
    async def go():
        await db.mail_runs.insert_one({"run_id": "R1", "status": "planned", "send_date": "",
                                       "created_at": "2026-08-09T11:00:00+00:00"})
        await db.mail_touches.insert_one({"touch_id": "t1", "run_id": "R1", "school_id": "s1"})
        await backfill_mail_touch_lifecycle(db)
        t = await db.mail_touches.find_one({"touch_id": "t1"}, {"_id": 0})
        assert t["planned_date"] == "2026-08-09"
    asyncio.run(go())


def test_backfill_is_idempotent_and_never_overwrites(db):
    async def go():
        await db.mail_runs.insert_one({"run_id": "R1", "status": "posted", "send_date": "2026-07-01"})
        await db.mail_touches.insert_one({"touch_id": "t1", "run_id": "R1", "school_id": "s1",
                                          "verify_status": "not_sent", "planned_date": "2026-07-05",
                                          "replan_count": 2, "source": "drip"})
        first = await backfill_mail_touch_lifecycle(db)
        second = await backfill_mail_touch_lifecycle(db)
        assert first["updated"] == 0 and second["updated"] == 0
        t = await db.mail_touches.find_one({"touch_id": "t1"}, {"_id": 0})
        assert t["verify_status"] == "not_sent" and t["replan_count"] == 2
    asyncio.run(go())


def test_orphan_touch_without_a_run_still_backfills(db):
    async def go():
        await db.mail_touches.insert_one({"touch_id": "t1", "run_id": "GONE", "school_id": "s1"})
        await backfill_mail_touch_lifecycle(db)
        t = await db.mail_touches.find_one({"touch_id": "t1"}, {"_id": 0})
        assert t["verify_status"] == "pending" and t["planned_date"] == ""
    asyncio.run(go())
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /f/ss-mail/backend && python -m pytest tests/test_mail_touch_backfill.py -q`
Expected: FAIL — `ImportError: cannot import name 'backfill_mail_touch_lifecycle' from 'database'`.

- [ ] **Step 3: Implement the backfill**

Add to `backend/database.py`:

```python
async def backfill_mail_touch_lifecycle(target_db) -> dict:
    """Give every pre-lifecycle mail touch a planned date and a verify status.

    A touch on a run that was already marked 'posted' backfills as SENT — the old
    UI stamped the whole run at once, and treating that history as 'pending' would
    make every past campaign read as never-posted. Idempotent: only writes fields
    that are missing, so it is safe to run on every boot.
    """
    scanned = updated = 0
    runs = {}
    cursor = target_db.mail_touches.find({"verify_status": {"$exists": False}}, {"_id": 0})
    async for t in cursor:
        scanned += 1
        rid = t.get("run_id", "")
        if rid not in runs:
            runs[rid] = await target_db.mail_runs.find_one(
                {"run_id": rid}, {"_id": 0, "status": 1, "send_date": 1, "created_at": 1}) or {}
        run = runs[rid]
        planned = str(run.get("send_date") or "").strip() or str(run.get("created_at") or "")[:10]
        was_posted = run.get("status") in ("posted", "closed") or bool(t.get("posted_at"))
        res = await target_db.mail_touches.update_one({"touch_id": t["touch_id"]}, {"$set": {
            "planned_date": planned,
            "verify_status": "sent" if was_posted else "pending",
            "printed_at": t.get("printed_at"),
            "print_batch_id": t.get("print_batch_id", ""),
            "replan_count": int(t.get("replan_count", 0) or 0),
            "source": t.get("source", "manual"),
        }})
        updated += res.modified_count
    return {"scanned": scanned, "updated": updated}
```

- [ ] **Step 4: Call it non-fatally on boot**

Find the existing startup helper (`grep -n "def _i\|async def connect_db" backend/database.py`) and, at the end of `connect_db()`, add:

```python
    try:
        await backfill_mail_touch_lifecycle(db)
    except Exception as e:            # never let a backfill break startup
        logging.getLogger("database").warning(f"mail-touch backfill skipped: {e}")
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd /f/ss-mail/backend && python -m pytest tests/test_mail_touch_backfill.py -q`
Expected: 5 passed.

- [ ] **Step 6: Commit**

```bash
cd /f/ss-mail && git add backend/database.py
git commit -m "feat(mail): idempotent lifecycle backfill for legacy mail touches"
```

---

### Task 7: Printing stamps `printed_at` and a print batch

**Files:**
- Modify: `backend/routes/crm_routes.py` (`mail_run_stickers`)
- Test: `backend/tests/test_mail_print_batch.py`

**Interfaces:**
- Consumes: `mail_run_stickers` from Task 2.
- Produces: touches carry `printed_at` (ISO) and `print_batch_id` (`pb_<hex12>`) after a sticker download. Task 10's gap report reads them for print-to-post leakage.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_mail_print_batch.py`:

```python
"""Printing IS the event — downloading stickers stamps printed_at, so the owner can
later ask 'we printed 37 and posted 29, where are the other 8?'."""
import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

import routes.crm_routes as crm

ADMIN = {"email": "admin@smartshape.in", "name": "Admin", "role": "admin", "roles": ["admin"]}
FULL = {"school_id": "s1", "school_name": "A School", "address": "1 Road",
        "city": "Delhi", "state": "Delhi", "pincode": "110001"}
BLANK = {"school_id": "s2", "school_name": "B School"}      # no address → incomplete


class FakeRequest:
    def __init__(self, params=None):
        self.query_params = params or {}


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(crm, "db", d)

    async def _fake(_r):
        return ADMIN
    monkeypatch.setattr(crm, "get_current_user", _fake)
    return d


async def _seed(d):
    await d.mail_runs.insert_one({"run_id": "R1", "name": "Run", "school_ids": ["s1", "s2"]})
    await d.mail_touches.insert_many([
        {"touch_id": "t1", "run_id": "R1", "school_id": "s1", "qr_token": "k1", "verify_status": "pending"},
        {"touch_id": "t2", "run_id": "R1", "school_id": "s2", "qr_token": "k2", "verify_status": "pending"},
    ])
    await d.schools.insert_many([dict(FULL), dict(BLANK)])
    await d.settings.insert_one({"type": "company", "company_name": "SmartShape"})


def test_printing_stamps_printed_at_and_a_batch_id(db):
    async def go():
        await _seed(db)
        await crm.mail_run_stickers("R1", FakeRequest({}))
        ts = await db.mail_touches.find({}, {"_id": 0}).to_list(None)
        assert all(t["printed_at"] for t in ts)
        assert len({t["print_batch_id"] for t in ts}) == 1
        assert ts[0]["print_batch_id"].startswith("pb_")
    asyncio.run(go())


def test_skipped_incomplete_addresses_are_not_marked_printed(db):
    async def go():
        await _seed(db)
        await crm.mail_run_stickers("R1", FakeRequest({"skip_incomplete": "1"}))
        t1 = await db.mail_touches.find_one({"touch_id": "t1"}, {"_id": 0})
        t2 = await db.mail_touches.find_one({"touch_id": "t2"}, {"_id": 0})
        assert t1["printed_at"]          # complete address → printed
        assert not t2.get("printed_at")  # skipped → never printed
    asyncio.run(go())


def test_reprint_opens_a_new_batch(db):
    async def go():
        await _seed(db)
        await crm.mail_run_stickers("R1", FakeRequest({}))
        first = (await db.mail_touches.find_one({"touch_id": "t1"}, {"_id": 0}))["print_batch_id"]
        await crm.mail_run_stickers("R1", FakeRequest({}))
        second = (await db.mail_touches.find_one({"touch_id": "t1"}, {"_id": 0}))["print_batch_id"]
        assert first != second
    asyncio.run(go())
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /f/ss-mail/backend && python -m pytest tests/test_mail_print_batch.py -q`
Expected: FAIL — `printed_at` is absent (`KeyError` / assertion failure).

- [ ] **Step 3: Stamp the batch in `mail_run_stickers`**

Immediately **after** the `skip_incomplete` filtering line (so only the touches actually rendered are stamped) and before the `_build_stickers_pdf` call:

```python
    # Printing is the event: stamp the batch so "printed but never posted" is
    # answerable later. Only the labels actually rendered are marked.
    batch_id = f"pb_{uuid.uuid4().hex[:12]}"
    printed_iso = datetime.now(timezone.utc).isoformat()
    if touches:
        await db.mail_touches.update_many(
            {"touch_id": {"$in": [t["touch_id"] for t in touches if t.get("touch_id")]}},
            {"$set": {"printed_at": printed_iso, "print_batch_id": batch_id}})
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /f/ss-mail/backend && python -m pytest tests/test_mail_print_batch.py tests/test_sticker_endorsement.py -q`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
cd /f/ss-mail && git add backend/routes/crm_routes.py
git commit -m "feat(mail): printing stamps printed_at + a print batch on each touch"
```

---

### Task 8: Verify endpoint — mark sent / not sent, with undo

**Files:**
- Modify: `backend/routes/crm_routes.py` (new endpoints above `/mail-runs/{run_id}`)
- Test: `backend/tests/test_mail_verify.py`

**Interfaces:**
- Consumes: touch lifecycle fields from Tasks 4/6/7.
- Produces:
  - `_recompute_run_counts(run_id) -> dict` — recomputes `counts.verified_sent/not_sent/pending` and the derived `status`, returns the run.
  - `POST /mail-runs/{run_id}/verify` — handler `verify_mail_run(run_id, request)`.
  - Ledger events keyed `dedup_key=f"mailtouch:{touch_id}"`.
  - Per-school follow-up cadence via existing `_create_mail_cadence`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_mail_verify.py`:

```python
"""Per-school verification: what was ACTUALLY posted. Replaces the old all-or-nothing
run status, and — importantly — only schools whose piece really went out get the
follow-up cadence ("did the mailer reach you?")."""
import asyncio
import json
import os
from datetime import datetime, timezone

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

import routes.crm_routes as crm

ADMIN = {"email": "admin@smartshape.in", "name": "Admin", "role": "admin", "roles": ["admin"]}
TODAY = datetime.now(timezone.utc).strftime("%Y-%m-%d")


class FakeRequest:
    def __init__(self, body=None):
        self._body = body or {}
        self.query_params = {}

    async def json(self):
        return self._body

    async def body(self):
        return json.dumps(self._body).encode()


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(crm, "db", d)

    async def _fake(_r):
        return ADMIN
    monkeypatch.setattr(crm, "get_current_user", _fake)
    return d


async def _seed(d, n=3):
    await d.mail_runs.insert_one({
        "run_id": "R1", "name": "Run", "send_date": TODAY, "status": "planned",
        "school_ids": [f"s{i}" for i in range(1, n + 1)], "courier_cost": 300,
        "counts": {"sent": n, "delivered": 0, "responded": 0, "appointments": 0}})
    await d.mail_touches.insert_many([
        {"touch_id": f"t{i}", "run_id": "R1", "school_id": f"s{i}", "qr_token": f"k{i}",
         "planned_date": TODAY, "verify_status": "pending", "replan_count": 0,
         "piece_type": "brochure", "owner": "rep@smartshape.in"}
        for i in range(1, n + 1)])
    for i in range(1, n + 1):
        await d.schools.insert_one({"school_id": f"s{i}", "school_name": f"School {i}",
                                    "assigned_to": "rep@smartshape.in"})


def test_partial_verify_updates_counts_and_keeps_run_open(db):
    async def go():
        await _seed(db)
        res = await crm.verify_mail_run("R1", FakeRequest({"rows": [
            {"touch_id": "t1", "verify_status": "sent"},
            {"touch_id": "t2", "verify_status": "not_sent", "reason": "address missing"},
        ], "posted_date": TODAY}))
        assert res["counts"]["verified_sent"] == 1
        assert res["counts"]["not_sent"] == 1
        assert res["counts"]["pending"] == 1
        assert res["status"] == "planned"        # still open — one piece unresolved
        t1 = await db.mail_touches.find_one({"touch_id": "t1"}, {"_id": 0})
        assert t1["verify_status"] == "sent" and t1["posted_at"][:10] == TODAY
        assert t1["verified_by"] == ADMIN["email"]
        t2 = await db.mail_touches.find_one({"touch_id": "t2"}, {"_id": 0})
        assert t2["reason"] == "address missing" and not t2["posted_at"]
    asyncio.run(go())


def test_all_resolved_derives_posted_status(db):
    async def go():
        await _seed(db, n=2)
        res = await crm.verify_mail_run("R1", FakeRequest(
            {"select_all": True, "verify_status": "sent", "posted_date": TODAY}))
        assert res["counts"]["verified_sent"] == 2 and res["counts"]["pending"] == 0
        assert res["status"] == "posted"
    asyncio.run(go())


def test_only_verified_schools_get_the_followup_cadence(db):
    """The live bug this fixes: marking a run posted used to schedule 'did the mailer
    reach you?' calls for schools whose mailer was never actually sent."""
    async def go():
        await _seed(db, n=3)
        await crm.verify_mail_run("R1", FakeRequest({"rows": [
            {"touch_id": "t1", "verify_status": "sent"},
            {"touch_id": "t2", "verify_status": "not_sent", "reason": "no stock"},
        ], "posted_date": TODAY}))
        acts = await db.crm_activities.find({"source": "mail_cadence"}, {"_id": 0}).to_list(None)
        assert {a["school_id"] for a in acts} == {"s1"}
    asyncio.run(go())


def test_verify_is_idempotent_on_the_ledger(db):
    async def go():
        await _seed(db, n=1)
        for _ in range(3):
            await crm.verify_mail_run("R1", FakeRequest({"rows": [
                {"touch_id": "t1", "verify_status": "sent"}], "posted_date": TODAY}))
        assert await db.engagement_events.count_documents({"dedup_key": "mailtouch:t1"}) <= 1
        assert await db.crm_activities.count_documents({"source": "mail_cadence"}) == len(crm.DEFAULT_MAIL_CADENCE)
    asyncio.run(go())


def test_undo_restores_pending_and_clears_the_actual_date(db):
    async def go():
        await _seed(db, n=1)
        await crm.verify_mail_run("R1", FakeRequest({"rows": [
            {"touch_id": "t1", "verify_status": "sent"}], "posted_date": TODAY}))
        res = await crm.verify_mail_run("R1", FakeRequest({"touch_ids": ["t1"], "undo": True}))
        t = await db.mail_touches.find_one({"touch_id": "t1"}, {"_id": 0})
        assert t["verify_status"] == "pending"
        assert not t["posted_at"] and not t.get("verified_by")
        assert res["counts"]["pending"] == 1
        assert await db.engagement_events.count_documents({"dedup_key": "mailtouch:t1"}) == 0
    asyncio.run(go())


def test_unknown_run_is_404(db):
    async def go():
        with pytest.raises(crm.HTTPException) as e:
            await crm.verify_mail_run("NOPE", FakeRequest({"rows": []}))
        assert e.value.status_code == 404
    asyncio.run(go())


def test_invalid_status_is_rejected(db):
    async def go():
        await _seed(db, n=1)
        with pytest.raises(crm.HTTPException) as e:
            await crm.verify_mail_run("R1", FakeRequest({"rows": [
                {"touch_id": "t1", "verify_status": "delivered"}]}))
        assert e.value.status_code == 400
    asyncio.run(go())
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /f/ss-mail/backend && python -m pytest tests/test_mail_verify.py -q`
Expected: FAIL — `module 'routes.crm_routes' has no attribute 'verify_mail_run'`.

- [ ] **Step 3: Add the count/status recomputation helper**

In `crm_routes.py`, above the `@router.put("/mail-runs/{run_id}/status")` handler:

```python
VERIFY_STATUSES = ("pending", "sent", "not_sent", "skipped")


async def _recompute_run_counts(run_id: str):
    """Run status is DERIVED from its touches, never set blind: 'planned' while any
    piece is unresolved, 'posted' once every piece is sent or deliberately skipped.
    'closed' is only ever set by an explicit user action."""
    touches = await db.mail_touches.find({"run_id": run_id},
                                         {"_id": 0, "verify_status": 1}).to_list(None)
    tally = {s: 0 for s in VERIFY_STATUSES}
    for t in touches:
        tally[t.get("verify_status", "pending")] = tally.get(t.get("verify_status", "pending"), 0) + 1
    run = await db.mail_runs.find_one({"run_id": run_id}, {"_id": 0, "status": 1})
    _set = {
        "counts.verified_sent": tally["sent"],
        "counts.not_sent": tally["not_sent"],
        "counts.pending": tally["pending"] + tally["skipped"] * 0,
    }
    if (run or {}).get("status") != "closed":
        _set["status"] = "posted" if (touches and tally["pending"] == 0) else "planned"
    await db.mail_runs.update_one({"run_id": run_id}, {"$set": _set})
    return await db.mail_runs.find_one({"run_id": run_id}, {"_id": 0})
```

- [ ] **Step 4: Implement the verify endpoint**

Add immediately below `_recompute_run_counts` (it is a static sub-path of `{run_id}` so ordering is safe, but keep it above the `{run_id}` GET for consistency):

```python
@router.post("/mail-runs/{run_id}/verify")
async def verify_mail_run(run_id: str, request: Request):
    """Record what was ACTUALLY posted, one school at a time.

    Body is either {rows: [{touch_id, verify_status, posted_date?, reason?}]},
    {select_all: true, verify_status, posted_date?}, or {touch_ids: [...], undo: true}.
    Only schools verified as sent get the follow-up cadence — a school whose piece
    never went out must not be asked "did the mailer reach you?".
    """
    user = await get_current_user(request)
    run = await db.mail_runs.find_one({"run_id": run_id}, {"_id": 0})
    if not run:
        raise HTTPException(status_code=404, detail="Mail run not found")
    body = await _parse_json_body(request)
    now_iso = datetime.now(timezone.utc).isoformat()

    if body.get("undo"):
        ids = body.get("touch_ids") or []
        await db.mail_touches.update_many(
            {"run_id": run_id, "touch_id": {"$in": ids}},
            {"$set": {"verify_status": "pending", "posted_at": None,
                      "verified_by": "", "verified_at": None, "reason": ""}})
        for tid in ids:
            await db.engagement_events.delete_many({"dedup_key": f"mailtouch:{tid}"})
        return await _recompute_run_counts(run_id)

    posted_date = (body.get("posted_date") or "").strip()
    posted_iso = f"{posted_date}T00:00:00+00:00" if posted_date else now_iso
    if body.get("select_all"):
        status = body.get("verify_status", "sent")
        touch_ids = [t["touch_id"] for t in await db.mail_touches.find(
            {"run_id": run_id, "verify_status": "pending"}, {"_id": 0, "touch_id": 1}).to_list(None)]
        rows = [{"touch_id": tid, "verify_status": status} for tid in touch_ids]
    else:
        rows = body.get("rows") or []

    for r in rows:
        status = r.get("verify_status")
        if status not in VERIFY_STATUSES:
            raise HTTPException(status_code=400, detail=f"Invalid verify_status: {status}")

    newly_sent = []
    for r in rows:
        tid, status = r.get("touch_id"), r["verify_status"]
        touch = await db.mail_touches.find_one({"run_id": run_id, "touch_id": tid}, {"_id": 0})
        if not touch:
            continue
        was_sent = touch.get("verify_status") == "sent"
        actual = (r.get("posted_date") or posted_date)
        _set = {"verify_status": status, "verified_by": user["email"], "verified_at": now_iso,
                "reason": (r.get("reason") or "").strip()}
        _set["posted_at"] = (f"{actual}T00:00:00+00:00" if actual else posted_iso) if status == "sent" else None
        await db.mail_touches.update_one({"touch_id": tid}, {"$set": _set})
        if status == "sent" and not was_sent:
            newly_sent.append({**touch, "posted_at": _set["posted_at"]})

    for t in newly_sent:
        try:
            from services.engagement import log_engagement_event
            await log_engagement_event(
                channel="mail", kind=f"{t.get('piece_type', 'mailer')} posted",
                title=f"{t.get('item_name') or t.get('piece_type', 'Mailer')} posted",
                school_id=t.get("school_id", ""), lead_id=t.get("lead_id", ""),
                status="sent", direction="out", by=user["email"], at=t["posted_at"],
                meta={"run_id": run_id, "touch_id": t["touch_id"]},
                dedup_key=f"mailtouch:{t['touch_id']}")
        except Exception as e:
            logging.getLogger("crm").warning(f"[mail] ledger log failed: {e}")
        # Follow-up cadence, per school, only for pieces that really went out.
        already = await db.crm_activities.count_documents(
            {"batch_id": run_id, "school_id": t.get("school_id", ""), "source": "mail_cadence"})
        if not already:
            await _create_mail_cadence({**run, "school_ids": [t.get("school_id", "")]},
                                       t["posted_at"], user)

    return await _recompute_run_counts(run_id)
```

Confirm `import logging` is present at the top of `crm_routes.py`; add it if not.

- [ ] **Step 5: Route the legacy status dropdown through verification**

Replace the body of `update_mail_run_status` so `posted` no longer blind-stamps every touch:

```python
@router.put("/mail-runs/{run_id}/status")
async def update_mail_run_status(run_id: str, request: Request):
    user = await get_current_user(request)
    body = await request.json()
    status = body.get("status")
    if status not in ("planned", "posted", "closed"):
        raise HTTPException(status_code=400, detail="Invalid status")
    if status == "posted":
        # "Posted" now means "every pending piece really went out" — it routes
        # through verification so the per-school truth (and cadence) stays honest.
        return await verify_mail_run(run_id, _StatusVerifyRequest(user))
    await db.mail_runs.update_one({"run_id": run_id}, {"$set": {"status": status}})
    return await db.mail_runs.find_one({"run_id": run_id}, {"_id": 0})


class _StatusVerifyRequest:
    """Adapts the legacy status dropdown onto the verify endpoint's body shape."""
    def __init__(self, user):
        self._user = user
        self.query_params = {}

    async def json(self):
        return {"select_all": True, "verify_status": "sent"}

    async def body(self):
        return json.dumps(await self.json()).encode()
```

`verify_mail_run` calls `get_current_user(request)`, which will re-resolve from this adapter — confirm `get_current_user` tolerates it, and if not, refactor the verify body into a `_do_verify(run_id, user, body)` helper called by both. Check with:
`grep -n "async def get_current_user" -A 15 backend/auth_utils.py`

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd /f/ss-mail/backend && python -m pytest tests/test_mail_verify.py tests/test_mail_run_delete_sync.py -q`
Expected: all passed.

- [ ] **Step 7: Commit**

```bash
cd /f/ss-mail && git add backend/routes/crm_routes.py
git commit -m "feat(mail): per-school verification with undo; cadence only for pieces really posted"
```

---

### Task 9: Re-plan endpoint — move unsent pieces to a new date

**Files:**
- Modify: `backend/routes/crm_routes.py`
- Test: `backend/tests/test_mail_replan.py`

**Interfaces:**
- Consumes: `_recompute_run_counts` from Task 8.
- Produces: `POST /mail-runs/{run_id}/replan` — handler `replan_mail_run(run_id, request)`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_mail_replan.py`:

```python
"""Unsent pieces move to a new date. The sequence clock does NOT move with them —
a postage delay must never stall the WhatsApp/call cadence behind it (spec 7.4)."""
import asyncio
import json
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

import routes.crm_routes as crm

ADMIN = {"email": "admin@smartshape.in", "name": "Admin", "role": "admin", "roles": ["admin"]}


class FakeRequest:
    def __init__(self, body=None):
        self._body = body or {}
        self.query_params = {}

    async def json(self):
        return self._body

    async def body(self):
        return json.dumps(self._body).encode()


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(crm, "db", d)

    async def _fake(_r):
        return ADMIN
    monkeypatch.setattr(crm, "get_current_user", _fake)
    return d


async def _seed(d):
    await d.mail_runs.insert_one({"run_id": "R1", "name": "Run", "status": "planned",
                                  "send_date": "2026-09-01", "school_ids": ["s1", "s2", "s3"]})
    await d.mail_touches.insert_many([
        {"touch_id": "t1", "run_id": "R1", "school_id": "s1", "planned_date": "2026-09-01",
         "verify_status": "sent", "replan_count": 0, "enrollment_id": "E1"},
        {"touch_id": "t2", "run_id": "R1", "school_id": "s2", "planned_date": "2026-09-01",
         "verify_status": "not_sent", "replan_count": 0, "enrollment_id": "E2"},
        {"touch_id": "t3", "run_id": "R1", "school_id": "s3", "planned_date": "2026-09-01",
         "verify_status": "pending", "replan_count": 1, "enrollment_id": "E3"},
    ])
    await d.drip_enrollments.insert_many([
        {"enrollment_id": f"E{i}", "next_step_at": "2026-09-05T00:00:00+00:00",
         "current_step": 1, "status": "active"} for i in (1, 2, 3)])


def test_replan_moves_pending_and_not_sent(db):
    async def go():
        await _seed(db)
        res = await crm.replan_mail_run("R1", FakeRequest(
            {"select_pending": True, "new_date": "2026-09-10"}))
        assert res["moved"] == 2
        for tid, expected in (("t2", 1), ("t3", 2)):
            t = await db.mail_touches.find_one({"touch_id": tid}, {"_id": 0})
            assert t["planned_date"] == "2026-09-10"
            assert t["verify_status"] == "pending"
            assert t["replan_count"] == expected
    asyncio.run(go())


def test_sent_touches_never_move(db):
    async def go():
        await _seed(db)
        await crm.replan_mail_run("R1", FakeRequest({"select_pending": True,
                                                     "new_date": "2026-09-10"}))
        t1 = await db.mail_touches.find_one({"touch_id": "t1"}, {"_id": 0})
        assert t1["planned_date"] == "2026-09-01" and t1["verify_status"] == "sent"
    asyncio.run(go())


def test_explicitly_replanning_a_sent_touch_is_rejected(db):
    async def go():
        await _seed(db)
        with pytest.raises(crm.HTTPException) as e:
            await crm.replan_mail_run("R1", FakeRequest(
                {"touch_ids": ["t1"], "new_date": "2026-09-10"}))
        assert e.value.status_code == 400
    asyncio.run(go())


def test_the_drip_clock_is_untouched(db):
    """Spec 7.4, asserted: re-planning a mail touch must not move its enrolment."""
    async def go():
        await _seed(db)
        await crm.replan_mail_run("R1", FakeRequest({"select_pending": True,
                                                     "new_date": "2026-09-10"}))
        for e in await db.drip_enrollments.find({}, {"_id": 0}).to_list(None):
            assert e["next_step_at"] == "2026-09-05T00:00:00+00:00"
            assert e["current_step"] == 1
    asyncio.run(go())


def test_missing_date_is_rejected(db):
    async def go():
        await _seed(db)
        with pytest.raises(crm.HTTPException) as e:
            await crm.replan_mail_run("R1", FakeRequest({"select_pending": True}))
        assert e.value.status_code == 400
    asyncio.run(go())
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /f/ss-mail/backend && python -m pytest tests/test_mail_replan.py -q`
Expected: FAIL — `module 'routes.crm_routes' has no attribute 'replan_mail_run'`.

- [ ] **Step 3: Implement the endpoint**

Add below `verify_mail_run`:

```python
@router.post("/mail-runs/{run_id}/replan")
async def replan_mail_run(run_id: str, request: Request):
    """Push the pieces that didn't go out onto a new date.

    Deliberately does NOT touch the drip enrolment schedule: a postage delay must
    never stall the WhatsApp and call cadence behind it (design spec 7.4).
    """
    await get_current_user(request)
    run = await db.mail_runs.find_one({"run_id": run_id}, {"_id": 0})
    if not run:
        raise HTTPException(status_code=404, detail="Mail run not found")
    body = await _parse_json_body(request)
    new_date = (body.get("new_date") or "").strip()
    if not new_date:
        raise HTTPException(status_code=400, detail="new_date is required")

    movable = {"pending", "not_sent"}
    if body.get("select_pending"):
        touches = await db.mail_touches.find(
            {"run_id": run_id, "verify_status": {"$in": list(movable)}}, {"_id": 0}).to_list(None)
    else:
        ids = body.get("touch_ids") or []
        touches = await db.mail_touches.find(
            {"run_id": run_id, "touch_id": {"$in": ids}}, {"_id": 0}).to_list(None)
        blocked = [t["touch_id"] for t in touches if t.get("verify_status") not in movable]
        if blocked:
            raise HTTPException(status_code=400,
                detail=f"Already posted, cannot be re-planned: {', '.join(blocked)}")

    for t in touches:
        await db.mail_touches.update_one({"touch_id": t["touch_id"]}, {
            "$set": {"planned_date": new_date, "verify_status": "pending", "reason": ""},
            "$inc": {"replan_count": 1}})
    run = await _recompute_run_counts(run_id)
    return {**run, "moved": len(touches), "new_date": new_date}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /f/ss-mail/backend && python -m pytest tests/test_mail_replan.py -q`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
cd /f/ss-mail && git add backend/routes/crm_routes.py
git commit -m "feat(mail): re-plan unsent pieces onto a new date without moving the drip clock"
```

---

### Task 10: Gap report — planned vs actual, and why

**Files:**
- Modify: `backend/routes/crm_routes.py`
- Test: `backend/tests/test_mail_gap_report.py`

**Interfaces:**
- Consumes: touch lifecycle fields.
- Produces: `GET /mail-runs/gap-report` — handler `mail_gap_report(request)`. Response: `{rows: [...], totals: {...}, reasons: [{reason, count}], group_by}`. Each row: `{key, label, planned, sent, not_sent, pending, printed_not_posted, on_time_pct, avg_days_late, replans, postage_exposure}`.

**Declared above `/mail-runs/{run_id}`** — see Global Constraints.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_mail_gap_report.py`:

```python
"""Plan vs actual. Counts say work slipped; the reason Pareto, postage exposure and
print-to-post leakage say what to fix."""
import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

import routes.crm_routes as crm

ADMIN = {"email": "admin@smartshape.in", "name": "Admin", "role": "admin", "roles": ["admin"]}


class FakeRequest:
    def __init__(self, params=None):
        self.query_params = params or {}


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(crm, "db", d)

    async def _fake(_r):
        return ADMIN
    monkeypatch.setattr(crm, "get_current_user", _fake)
    return d


async def _seed(d):
    await d.mail_runs.insert_one({"run_id": "R1", "name": "Rohini brochures",
                                  "sequence_id": "SEQ1", "sequence_name": "Principal Pitch",
                                  "send_date": "2026-09-01", "courier_cost": 500,
                                  "school_ids": ["s1", "s2", "s3", "s4"]})
    await d.mail_touches.insert_many([
        # on time
        {"touch_id": "t1", "run_id": "R1", "school_id": "s1", "owner": "a@x.com",
         "planned_date": "2026-09-01", "posted_at": "2026-09-01T00:00:00+00:00",
         "verify_status": "sent", "replan_count": 0, "printed_at": "2026-09-01T00:00:00+00:00"},
        # 3 days late
        {"touch_id": "t2", "run_id": "R1", "school_id": "s2", "owner": "a@x.com",
         "planned_date": "2026-09-01", "posted_at": "2026-09-04T00:00:00+00:00",
         "verify_status": "sent", "replan_count": 1, "printed_at": "2026-09-01T00:00:00+00:00"},
        # printed but never posted
        {"touch_id": "t3", "run_id": "R1", "school_id": "s3", "owner": "b@x.com",
         "planned_date": "2026-09-01", "posted_at": None, "verify_status": "pending",
         "replan_count": 0, "printed_at": "2026-09-01T00:00:00+00:00"},
        # refused, with a reason
        {"touch_id": "t4", "run_id": "R1", "school_id": "s4", "owner": "b@x.com",
         "planned_date": "2026-09-01", "posted_at": None, "verify_status": "not_sent",
         "reason": "address missing", "replan_count": 0, "printed_at": None},
    ])
    for i in range(1, 5):
        await d.schools.insert_one({"school_id": f"s{i}", "school_name": f"School {i}"})


def test_totals_and_on_time(db):
    async def go():
        await _seed(db)
        res = await crm.mail_gap_report(FakeRequest({"group_by": "run"}))
        t = res["totals"]
        assert t["planned"] == 4 and t["sent"] == 2
        assert t["not_sent"] == 1 and t["pending"] == 1
        assert t["printed_not_posted"] == 1          # t3
        assert t["avg_days_late"] == pytest.approx(1.5)   # (0 + 3) / 2
        assert t["on_time_pct"] == pytest.approx(50.0)    # 1 of 2 sent on time
        assert t["replans"] == 1
    asyncio.run(go())


def test_postage_exposure_is_the_budget_on_pieces_that_never_went(db):
    async def go():
        await _seed(db)
        res = await crm.mail_gap_report(FakeRequest({"group_by": "run"}))
        # 500 / 4 planned = 125 per piece; 1 not_sent → 125 exposed
        assert res["rows"][0]["postage_exposure"] == pytest.approx(125.0)
    asyncio.run(go())


def test_reason_pareto_is_ordered(db):
    async def go():
        await _seed(db)
        await db.mail_touches.insert_many([
            {"touch_id": f"x{i}", "run_id": "R1", "school_id": "s1",
             "planned_date": "2026-09-01", "verify_status": "not_sent",
             "reason": "no stock", "replan_count": 0} for i in range(3)])
        res = await crm.mail_gap_report(FakeRequest({}))
        assert res["reasons"][0] == {"reason": "no stock", "count": 3}
        assert res["reasons"][1] == {"reason": "address missing", "count": 1}
    asyncio.run(go())


def test_group_by_owner_and_sequence(db):
    async def go():
        await _seed(db)
        by_owner = await crm.mail_gap_report(FakeRequest({"group_by": "owner"}))
        assert {r["key"] for r in by_owner["rows"]} == {"a@x.com", "b@x.com"}
        assert next(r for r in by_owner["rows"] if r["key"] == "a@x.com")["sent"] == 2
        by_seq = await crm.mail_gap_report(FakeRequest({"group_by": "sequence"}))
        assert by_seq["rows"][0]["label"] == "Principal Pitch"
    asyncio.run(go())


def test_touch_without_planned_date_is_excluded_from_lateness(db):
    async def go():
        await _seed(db)
        await db.mail_touches.insert_one({
            "touch_id": "t9", "run_id": "R1", "school_id": "s1", "planned_date": "",
            "posted_at": "2026-09-20T00:00:00+00:00", "verify_status": "sent", "replan_count": 0})
        res = await crm.mail_gap_report(FakeRequest({"group_by": "run"}))
        assert res["totals"]["avg_days_late"] == pytest.approx(1.5)   # unchanged
    asyncio.run(go())


def test_date_range_filters(db):
    async def go():
        await _seed(db)
        res = await crm.mail_gap_report(FakeRequest({"from": "2026-10-01", "to": "2026-10-31"}))
        assert res["totals"]["planned"] == 0 and res["rows"] == []
    asyncio.run(go())
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /f/ss-mail/backend && python -m pytest tests/test_mail_gap_report.py -q`
Expected: FAIL — `module 'routes.crm_routes' has no attribute 'mail_gap_report'`.

- [ ] **Step 3: Implement the report**

Add directly **above** `@router.get("/mail-runs/{run_id}")`, next to the existing `analytics` route and its ordering comment:

```python
def _days_late(planned: str, posted_at: str):
    """Whole days between the planned date and the actual posting date, or None when
    either is missing — a touch with no plan is excluded rather than counted on time."""
    if not planned or not posted_at:
        return None
    try:
        p = datetime.fromisoformat(planned).date()
        a = datetime.fromisoformat(str(posted_at).replace("Z", "+00:00")).date()
    except ValueError:
        return None
    return (a - p).days


@router.get("/mail-runs/gap-report")
async def mail_gap_report(request: Request):
    """Planned vs actual across every mail touch, grouped, with the reasons behind
    the gap. MUST stay above /mail-runs/{run_id} or FastAPI eats 'gap-report'."""
    await get_current_user(request)
    qp = request.query_params
    group_by = qp.get("group_by") or "run"
    filt = {}
    d_from, d_to = qp.get("from"), qp.get("to")
    if d_from or d_to:
        rng = {}
        if d_from: rng["$gte"] = d_from
        if d_to:   rng["$lte"] = d_to
        filt["planned_date"] = rng

    touches = await db.mail_touches.find(filt, {"_id": 0}).to_list(None)
    runs = {r["run_id"]: r for r in await db.mail_runs.find({}, {"_id": 0}).to_list(None)}
    schools = {s["school_id"]: s for s in await db.schools.find(
        {}, {"_id": 0, "school_id": 1, "school_name": 1}).to_list(None)}

    def _key_label(t):
        run = runs.get(t.get("run_id"), {})
        if group_by == "sequence":
            return run.get("sequence_id") or "_none", run.get("sequence_name") or "Not from a sequence"
        if group_by == "owner":
            o = t.get("owner") or "unassigned"
            return o, o
        if group_by == "school":
            sid = t.get("school_id", "")
            return sid, schools.get(sid, {}).get("school_name", "(deleted school)")
        return t.get("run_id", ""), run.get("name", "(deleted run)")

    groups, reasons = {}, {}
    for t in touches:
        key, label = _key_label(t)
        g = groups.setdefault(key, {"key": key, "label": label, "planned": 0, "sent": 0,
                                    "not_sent": 0, "pending": 0, "printed_not_posted": 0,
                                    "replans": 0, "_late": [], "postage_exposure": 0.0})
        st = t.get("verify_status", "pending")
        g["planned"] += 1
        g["replans"] += int(t.get("replan_count", 0) or 0)
        if st == "sent":
            g["sent"] += 1
            dl = _days_late(t.get("planned_date", ""), t.get("posted_at"))
            if dl is not None:
                g["_late"].append(dl)
        elif st == "not_sent":
            g["not_sent"] += 1
            r = (t.get("reason") or "").strip() or "no reason given"
            reasons[r] = reasons.get(r, 0) + 1
        elif st == "pending":
            g["pending"] += 1
        if st != "sent" and t.get("printed_at"):
            g["printed_not_posted"] += 1
        # Budgeted postage riding on a piece that never went out.
        run = runs.get(t.get("run_id"), {})
        n = len(run.get("school_ids") or []) or 1
        if st == "not_sent":
            g["postage_exposure"] += float(run.get("courier_cost") or 0) / n

    rows = []
    for g in groups.values():
        late = g.pop("_late")
        g["avg_days_late"] = round(sum(late) / len(late), 2) if late else None
        g["on_time_pct"] = round(100.0 * sum(1 for d in late if d <= 0) / len(late), 2) if late else None
        g["postage_exposure"] = round(g["postage_exposure"], 2)
        rows.append(g)
    rows.sort(key=lambda r: (-(r["pending"] + r["not_sent"]), -r["planned"]))

    all_late = [d for t in touches if t.get("verify_status") == "sent"
                for d in [_days_late(t.get("planned_date", ""), t.get("posted_at"))] if d is not None]
    totals = {
        "planned": sum(r["planned"] for r in rows),
        "sent": sum(r["sent"] for r in rows),
        "not_sent": sum(r["not_sent"] for r in rows),
        "pending": sum(r["pending"] for r in rows),
        "printed_not_posted": sum(r["printed_not_posted"] for r in rows),
        "replans": sum(r["replans"] for r in rows),
        "postage_exposure": round(sum(r["postage_exposure"] for r in rows), 2),
        "avg_days_late": round(sum(all_late) / len(all_late), 2) if all_late else None,
        "on_time_pct": round(100.0 * sum(1 for d in all_late if d <= 0) / len(all_late), 2) if all_late else None,
    }
    return {"group_by": group_by, "rows": rows, "totals": totals,
            "reasons": sorted([{"reason": k, "count": v} for k, v in reasons.items()],
                              key=lambda x: -x["count"])}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /f/ss-mail/backend && python -m pytest tests/test_mail_gap_report.py -q`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
cd /f/ss-mail && git add backend/routes/crm_routes.py
git commit -m "feat(mail): gap report — planned vs actual with reason Pareto and postage exposure"
```

---

### Task 11: Today's Post queue across every run

**Files:**
- Modify: `backend/routes/crm_routes.py`
- Test: `backend/tests/test_mail_today_queue.py`

**Interfaces:**
- Consumes: touch lifecycle fields; `_build_stickers_pdf` from Task 1.
- Produces:
  - `GET /mail-runs/today-queue?date=` — handler `mail_today_queue(request)`, returning `{date, total, overdue, groups: [{run_id, run_name, sequence_name, piece_type, is_drip_run, count, overdue, touch_ids}]}`.
  - `GET /mail-runs/queue-stickers.pdf?date=` — handler `mail_queue_stickers(request)`, one combined PDF across runs.
- Both declared **above** `/mail-runs/{run_id}`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_mail_today_queue.py`:

```python
"""One queue for the person actually doing the posting — drip mailers and manual runs
are the same job. Overdue pieces from earlier days come along and sort first."""
import asyncio
import io
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient
from pypdf import PdfReader

import routes.crm_routes as crm

ADMIN = {"email": "admin@smartshape.in", "name": "Admin", "role": "admin", "roles": ["admin"]}


class FakeRequest:
    def __init__(self, params=None):
        self.query_params = params or {}


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(crm, "db", d)

    async def _fake(_r):
        return ADMIN
    monkeypatch.setattr(crm, "get_current_user", _fake)
    return d


async def _seed(d):
    await d.mail_runs.insert_many([
        {"run_id": "R1", "name": "Rohini brochures", "piece_type": "brochure",
         "school_ids": ["s1", "s2"]},
        {"run_id": "R2", "name": "Pitch · sample — today", "piece_type": "sample",
         "is_drip_run": True, "sequence_id": "SEQ1", "sequence_name": "Principal Pitch",
         "school_ids": ["s3"]},
    ])
    await d.mail_touches.insert_many([
        {"touch_id": "t1", "run_id": "R1", "school_id": "s1", "qr_token": "k1",
         "planned_date": "2026-09-02", "verify_status": "pending"},
        {"touch_id": "t2", "run_id": "R1", "school_id": "s2", "qr_token": "k2",
         "planned_date": "2026-08-28", "verify_status": "pending"},     # overdue
        {"touch_id": "t3", "run_id": "R2", "school_id": "s3", "qr_token": "k3",
         "planned_date": "2026-09-02", "verify_status": "pending"},
        {"touch_id": "t4", "run_id": "R1", "school_id": "s4", "qr_token": "k4",
         "planned_date": "2026-09-02", "verify_status": "sent"},        # done
        {"touch_id": "t5", "run_id": "R1", "school_id": "s5", "qr_token": "k5",
         "planned_date": "2026-09-20", "verify_status": "pending"},     # future
    ])
    for i in range(1, 6):
        await d.schools.insert_one({"school_id": f"s{i}", "school_name": f"School {i}",
                                    "address": "1 Road", "city": "Delhi",
                                    "state": "Delhi", "pincode": "110001"})
    await d.settings.insert_one({"type": "company", "company_name": "SmartShape"})


def test_queue_includes_due_and_overdue_only(db):
    async def go():
        await _seed(db)
        res = await crm.mail_today_queue(FakeRequest({"date": "2026-09-02"}))
        assert res["total"] == 3          # t1, t2, t3 — not the sent or future ones
        assert res["overdue"] == 1        # t2
    asyncio.run(go())


def test_queue_groups_by_run_and_names_the_sequence(db):
    async def go():
        await _seed(db)
        res = await crm.mail_today_queue(FakeRequest({"date": "2026-09-02"}))
        by_run = {g["run_id"]: g for g in res["groups"]}
        assert by_run["R1"]["count"] == 2 and by_run["R1"]["overdue"] == 1
        assert by_run["R2"]["sequence_name"] == "Principal Pitch"
        assert by_run["R2"]["is_drip_run"] is True
        assert sorted(by_run["R1"]["touch_ids"]) == ["t1", "t2"]
    asyncio.run(go())


def test_groups_with_overdue_work_sort_first(db):
    async def go():
        await _seed(db)
        res = await crm.mail_today_queue(FakeRequest({"date": "2026-09-02"}))
        assert res["groups"][0]["run_id"] == "R1"
    asyncio.run(go())


def test_combined_print_spans_runs_in_one_pdf(db):
    async def go():
        await _seed(db)
        resp = await crm.mail_queue_stickers(FakeRequest({"date": "2026-09-02"}))
        data = b"".join([c async for c in resp.body_iterator])
        reader = PdfReader(io.BytesIO(data))
        assert len(reader.pages) == 3        # one label per queued touch
        all_text = " ".join(p.extract_text() for p in reader.pages)
        assert "School 1" in all_text and "School 3" in all_text
    asyncio.run(go())


def test_combined_print_stamps_every_queued_touch(db):
    async def go():
        await _seed(db)
        await crm.mail_queue_stickers(FakeRequest({"date": "2026-09-02"}))
        for tid in ("t1", "t2", "t3"):
            t = await db.mail_touches.find_one({"touch_id": tid}, {"_id": 0})
            assert t["printed_at"] and t["print_batch_id"].startswith("pb_")
        untouched = await db.mail_touches.find_one({"touch_id": "t5"}, {"_id": 0})
        assert not untouched.get("printed_at")
    asyncio.run(go())


def test_empty_queue_is_not_an_error(db):
    async def go():
        await _seed(db)
        res = await crm.mail_today_queue(FakeRequest({"date": "2020-01-01"}))
        assert res["total"] == 0 and res["groups"] == []
    asyncio.run(go())
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /f/ss-mail/backend && python -m pytest tests/test_mail_today_queue.py -q`
Expected: FAIL — `module 'routes.crm_routes' has no attribute 'mail_today_queue'`.

- [ ] **Step 3: Implement the queue endpoint**

Add above `@router.get("/mail-runs/{run_id}")`:

```python
async def _queued_touches(date_str: str):
    """Every piece that should already be in the post: due today or overdue."""
    return await db.mail_touches.find(
        {"verify_status": "pending", "planned_date": {"$lte": date_str, "$ne": ""}},
        {"_id": 0}).to_list(None)


@router.get("/mail-runs/today-queue")
async def mail_today_queue(request: Request):
    """The posting job for today, across every run — drip mailers and manual runs
    are one task to the person carrying the bundle to the counter."""
    await get_current_user(request)
    today = request.query_params.get("date") or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    touches = await _queued_touches(today)
    runs = {r["run_id"]: r for r in await db.mail_runs.find({}, {"_id": 0}).to_list(None)}

    groups = {}
    for t in touches:
        rid = t.get("run_id", "")
        run = runs.get(rid, {})
        g = groups.setdefault(rid, {
            "run_id": rid, "run_name": run.get("name", "(deleted run)"),
            "sequence_name": run.get("sequence_name", ""),
            "is_drip_run": bool(run.get("is_drip_run")),
            "piece_type": run.get("piece_type", t.get("piece_type", "")),
            "count": 0, "overdue": 0, "touch_ids": []})
        g["count"] += 1
        g["touch_ids"].append(t["touch_id"])
        if t.get("planned_date", "") < today:
            g["overdue"] += 1

    rows = sorted(groups.values(), key=lambda g: (-g["overdue"], -g["count"]))
    return {"date": today, "total": len(touches),
            "overdue": sum(g["overdue"] for g in rows), "groups": rows}


@router.get("/mail-runs/queue-stickers.pdf")
async def mail_queue_stickers(request: Request):
    """One combined sticker PDF for the whole day's queue — the printer gets loaded
    once, not once per run."""
    await get_current_user(request)
    qp = request.query_params
    today = qp.get("date") or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    touches = await _queued_touches(today)
    ids = [t["school_id"] for t in touches]
    schools = await db.schools.find({"school_id": {"$in": ids}}, {"_id": 0}).to_list(None)
    schools_by_id = {s["school_id"]: s for s in schools}
    if qp.get("skip_incomplete") in ("1", "true", "yes"):
        touches = _complete_touches(touches, schools_by_id)
    company = await db.settings.find_one({"type": "company"}, {"_id": 0}) or {}
    base = (_os.environ.get("FRONTEND_URL") or "https://app.smartshape.in").rstrip("/")

    endorsement = qp.get("endorsement")
    if endorsement is None:
        endorsement = company.get("sticker_endorsement", "")
    try:
        endorsement_pt = float(qp.get("endorsement_pt") or company.get("sticker_endorsement_pt") or 0)
    except (TypeError, ValueError):
        endorsement_pt = 0
    text_scale = _clamp_scale(qp.get("text_scale") or company.get("sticker_text_scale") or 1.0)

    if touches:
        batch_id = f"pb_{uuid.uuid4().hex[:12]}"
        await db.mail_touches.update_many(
            {"touch_id": {"$in": [t["touch_id"] for t in touches]}},
            {"$set": {"printed_at": datetime.now(timezone.utc).isoformat(),
                      "print_batch_id": batch_id}})

    pdf = _build_stickers_pdf(
        touches, schools_by_id, company, base,
        orientation=("landscape" if qp.get("orientation") == "landscape" else "portrait"),
        size=(qp.get("size") or "100x150"),
        layout=("a4" if qp.get("layout") == "a4" else "label"),
        show_logo=(qp.get("no_logo") not in ("1", "true", "yes")),
        endorsement=endorsement, endorsement_pt=endorsement_pt, text_scale=text_scale)
    return StreamingResponse(io.BytesIO(pdf), media_type="application/pdf",
                             headers={"Content-Disposition": f'attachment; filename="post-{today}.pdf"'})
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /f/ss-mail/backend && python -m pytest tests/test_mail_today_queue.py -q`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
cd /f/ss-mail && git add backend/routes/crm_routes.py
git commit -m "feat(mail): Today's Post queue across runs + one combined sticker print"
```

---

### Task 12: Sequence deliveries drill-down

**Files:**
- Modify: `backend/routes/drip_routes.py`
- Test: `backend/tests/test_drip_deliveries.py`

**Interfaces:**
- Consumes: `drip_step_logs`, `drip_enrollments`, and the drip-linked `mail_touches` from Task 4.
- Produces: `GET /drip/sequences/{sequence_id}/deliveries` — handler `sequence_deliveries(sequence_id, request)`, returning `{sequence_id, sequence_name, rows: [...], totals: {...}}`. Row keys: `school_id, school_name, owner, step_number, channel, item, planned_date, actual_date, status, run_id, touch_id`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_drip_deliveries.py`:

```python
"""What did this sequence actually send, to which school, and when — including the
steps that have NOT fired yet, which is what makes the gap visible at all."""
import asyncio
import os
from datetime import datetime, timezone, timedelta

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

import routes.drip_routes as drip

ADMIN = {"email": "admin@smartshape.in", "name": "Admin", "role": "admin", "roles": ["admin"],
         "assigned_modules": {"leads": {"level": "read_write_delete", "scope": "all"}}}


class FakeRequest:
    def __init__(self, params=None):
        self.query_params = params or {}


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(drip, "db", d)

    async def _fake(_r):
        return ADMIN
    monkeypatch.setattr(drip, "get_current_user", _fake)
    monkeypatch.setattr(drip, "require_module", lambda *a, **k: None)
    return d


async def _seed(d):
    enrolled = datetime(2026, 9, 1, tzinfo=timezone.utc)
    await d.drip_sequences.insert_one({
        "sequence_id": "SEQ1", "name": "Principal Pitch", "steps": [
            {"step_number": 1, "delay_days": 0, "message_type": "whatsapp", "message_template": "Hi"},
            {"step_number": 2, "delay_days": 3, "message_type": "physical_material",
             "material_type": "brochure", "material_name": "2026 Catalogue"},
            {"step_number": 3, "delay_days": 7, "message_type": "call_task", "message_template": "Call"},
        ]})
    await d.drip_enrollments.insert_one({
        "enrollment_id": "E1", "sequence_id": "SEQ1", "lead_id": "L1",
        "current_step": 2, "status": "active", "enrolled_at": enrolled.isoformat(),
        "next_step_at": (enrolled + timedelta(days=7)).isoformat()})
    await d.leads.insert_one({"lead_id": "L1", "school_id": "s1",
                              "company_name": "Air Force School",
                              "assigned_to": "rep@smartshape.in"})
    await d.schools.insert_one({"school_id": "s1", "school_name": "Air Force School"})
    await d.drip_step_logs.insert_many([
        {"log_id": "l1", "enrollment_id": "E1", "sequence_id": "SEQ1", "lead_id": "L1",
         "step_number": 1, "message_type": "whatsapp", "status": "sent",
         "fired_at": "2026-09-01T10:00:00+00:00"},
        {"log_id": "l2", "enrollment_id": "E1", "sequence_id": "SEQ1", "lead_id": "L1",
         "step_number": 2, "message_type": "physical_material", "status": "sent",
         "fired_at": "2026-09-04T10:00:00+00:00"},
    ])
    await d.mail_touches.insert_one({
        "touch_id": "t1", "run_id": "R1", "school_id": "s1", "sequence_id": "SEQ1",
        "enrollment_id": "E1", "step_number": 2, "piece_type": "brochure",
        "item_name": "2026 Catalogue", "planned_date": "2026-09-04",
        "posted_at": "2026-09-06T00:00:00+00:00", "verify_status": "sent"})


def test_fired_steps_appear_with_school_and_channel(db):
    async def go():
        await _seed(db)
        res = await drip.sequence_deliveries("SEQ1", FakeRequest())
        by_step = {r["step_number"]: r for r in res["rows"]}
        assert by_step[1]["school_name"] == "Air Force School"
        assert by_step[1]["channel"] == "whatsapp"
        assert by_step[1]["owner"] == "rep@smartshape.in"
        assert by_step[1]["status"] == "sent"
    asyncio.run(go())


def test_physical_row_takes_its_truth_from_the_mail_touch(db):
    async def go():
        await _seed(db)
        res = await drip.sequence_deliveries("SEQ1", FakeRequest())
        row = next(r for r in res["rows"] if r["step_number"] == 2)
        assert row["actual_date"] == "2026-09-06"        # verified posting, not the fire time
        assert row["planned_date"] == "2026-09-04"
        assert row["item"] == "2026 Catalogue"
        assert row["run_id"] == "R1" and row["touch_id"] == "t1"
    asyncio.run(go())


def test_unfired_steps_show_as_planned(db):
    async def go():
        await _seed(db)
        res = await drip.sequence_deliveries("SEQ1", FakeRequest())
        row = next(r for r in res["rows"] if r["step_number"] == 3)
        assert row["status"] == "planned"
        assert row["actual_date"] == ""
        assert row["planned_date"] == "2026-09-08"       # enrolled 01 Sep + 7 days
    asyncio.run(go())


def test_totals_count_the_gap(db):
    async def go():
        await _seed(db)
        res = await drip.sequence_deliveries("SEQ1", FakeRequest())
        assert res["totals"]["sent"] == 2
        assert res["totals"]["planned"] == 1
        assert res["sequence_name"] == "Principal Pitch"
    asyncio.run(go())


def test_filters_narrow_the_rows(db):
    async def go():
        await _seed(db)
        assert len((await drip.sequence_deliveries("SEQ1", FakeRequest({"channel": "whatsapp"})))["rows"]) == 1
        assert len((await drip.sequence_deliveries("SEQ1", FakeRequest({"status": "planned"})))["rows"]) == 1
        assert len((await drip.sequence_deliveries("SEQ1", FakeRequest({"step": "2"})))["rows"]) == 1
    asyncio.run(go())


def test_unknown_sequence_is_404(db):
    async def go():
        with pytest.raises(drip.HTTPException) as e:
            await drip.sequence_deliveries("NOPE", FakeRequest())
        assert e.value.status_code == 404
    asyncio.run(go())
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /f/ss-mail/backend && python -m pytest tests/test_drip_deliveries.py -q`
Expected: FAIL — `module 'routes.drip_routes' has no attribute 'sequence_deliveries'`.

- [ ] **Step 3: Implement the endpoint**

Add to `backend/routes/drip_routes.py`, after `list_enrollments`:

```python
_CHANNEL_OF = {"whatsapp": "whatsapp", "email": "email",
               "physical_material": "mail", "call_task": "call"}


@router.get("/drip/sequences/{sequence_id}/deliveries")
async def sequence_deliveries(sequence_id: str, request: Request):
    """One row per (enrolment x step) — fired or not. The unfired rows are the point:
    without them 'planned but not done' is invisible."""
    user = await get_current_user(request)
    require_module(user, "leads", "read")
    seq = await db.drip_sequences.find_one({"sequence_id": sequence_id}, {"_id": 0})
    if not seq:
        raise HTTPException(404, "Sequence not found")
    steps = {s["step_number"]: s for s in sorted(seq.get("steps", []),
                                                 key=lambda s: s["step_number"])}

    enrolments = await db.drip_enrollments.find({"sequence_id": sequence_id},
                                                {"_id": 0}).to_list(2000)
    lead_ids = [e["lead_id"] for e in enrolments]
    leads = {l["lead_id"]: l for l in await db.leads.find(
        {"lead_id": {"$in": lead_ids}}, {"_id": 0}).to_list(None)}
    schools = {s["school_id"]: s for s in await db.schools.find(
        {}, {"_id": 0, "school_id": 1, "school_name": 1}).to_list(None)}
    logs = {}
    for lg in await db.drip_step_logs.find({"sequence_id": sequence_id}, {"_id": 0}).to_list(5000):
        logs[(lg["enrollment_id"], lg["step_number"])] = lg
    touches = {}
    for t in await db.mail_touches.find({"sequence_id": sequence_id}, {"_id": 0}).to_list(5000):
        touches[(t.get("enrollment_id", ""), t.get("step_number", 0))] = t

    def _plus_days(enrolled_at, days):
        raw = str(enrolled_at or "")
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        try:
            return (datetime.fromisoformat(raw) + timedelta(days=days)).strftime("%Y-%m-%d")
        except ValueError:
            return ""

    rows = []
    for enr in enrolments:
        lead = leads.get(enr["lead_id"], {})
        sid = lead.get("school_id", "")
        school_name = schools.get(sid, {}).get("school_name") or lead.get("company_name", "")
        for n, step in steps.items():
            log = logs.get((enr["enrollment_id"], n))
            touch = touches.get((enr["enrollment_id"], n))
            planned = _plus_days(enr.get("enrolled_at"), step.get("delay_days", 0))
            if touch:
                # A physical step's truth is the verified posting, not the fire time.
                status = {"sent": "sent", "not_sent": "not_sent",
                          "skipped": "skipped"}.get(touch.get("verify_status"), "printed"
                                                    if touch.get("printed_at") else "queued")
                actual = str(touch.get("posted_at") or "")[:10]
                planned = touch.get("planned_date") or planned
            elif log:
                status = "sent" if log.get("status") == "sent" else "failed"
                actual = str(log.get("fired_at") or "")[:10]
            else:
                status = "planned" if enr.get("status") == "active" else "cancelled"
                actual = ""
            rows.append({
                "enrollment_id": enr["enrollment_id"], "lead_id": enr["lead_id"],
                "school_id": sid, "school_name": school_name or "(no school)",
                "owner": lead.get("assigned_to", ""), "step_number": n,
                "channel": _CHANNEL_OF.get(step.get("message_type", ""), step.get("message_type", "")),
                "item": step.get("material_name") or step.get("material_type") or "",
                "planned_date": planned, "actual_date": actual, "status": status,
                "run_id": (touch or {}).get("run_id", ""),
                "touch_id": (touch or {}).get("touch_id", ""),
            })

    qp = request.query_params
    if qp.get("status"):
        rows = [r for r in rows if r["status"] == qp["status"]]
    if qp.get("channel"):
        rows = [r for r in rows if r["channel"] == qp["channel"]]
    if qp.get("step"):
        rows = [r for r in rows if str(r["step_number"]) == str(qp["step"])]
    rows.sort(key=lambda r: (r["school_name"], r["step_number"]))

    totals = {}
    for r in rows:
        totals[r["status"]] = totals.get(r["status"], 0) + 1
    totals.setdefault("sent", 0)
    totals.setdefault("planned", 0)
    return {"sequence_id": sequence_id, "sequence_name": seq.get("name", ""),
            "rows": rows, "totals": totals}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /f/ss-mail/backend && python -m pytest tests/test_drip_deliveries.py -q`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
cd /f/ss-mail && git add backend/routes/drip_routes.py
git commit -m "feat(drip): sequence deliveries drill-down — what went where, fired or not"
```

---

### Task 13: Evening nudge for overdue post

**Files:**
- Modify: `backend/scheduler.py`
- Test: `backend/tests/test_mail_overdue_nudge.py`

**Interfaces:**
- Consumes: touch lifecycle fields.
- Produces: `run_mail_overdue_nudge()` in `scheduler.py`, plus `mail_overdue_loop()` registered alongside the other loops. Writes `crm_notifications` rows with `kind="mail_overdue"` and a `dedup_key` of `mailnudge:{run_id}:{date}`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_mail_overdue_nudge.py`:

```python
"""Surface slipped post instead of waiting to be asked — but stay quiet unless the
owner opted in, and never nag twice about the same run on the same day."""
import asyncio
import os
from datetime import datetime, timezone, timedelta

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

import scheduler as sch

TODAY = datetime.now(timezone.utc).strftime("%Y-%m-%d")
OLD = (datetime.now(timezone.utc) - timedelta(days=5)).strftime("%Y-%m-%d")
PRINTED_2D = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()


@pytest.fixture()
def db(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(sch, "db", d)
    return d


async def _optin(d, on=True):
    await d.settings.insert_one({"type": "notifications", "mail_overdue_nudge": on})


async def _run_with_overdue(d):
    await d.mail_runs.insert_one({"run_id": "R1", "name": "Rohini brochures",
                                  "created_by": "owner@smartshape.in"})
    await d.mail_touches.insert_one({
        "touch_id": "t1", "run_id": "R1", "school_id": "s1", "owner": "rep@smartshape.in",
        "planned_date": OLD, "verify_status": "pending", "printed_at": PRINTED_2D})


def test_no_notification_when_opted_out(db):
    async def go():
        await _optin(db, False)
        await _run_with_overdue(db)
        await sch.run_mail_overdue_nudge()
        assert await db.crm_notifications.count_documents({}) == 0
    asyncio.run(go())


def test_notifies_the_run_owner_when_opted_in(db):
    async def go():
        await _optin(db)
        await _run_with_overdue(db)
        await sch.run_mail_overdue_nudge()
        n = await db.crm_notifications.find_one({"kind": "mail_overdue"}, {"_id": 0})
        assert n is not None
        assert n["user_email"] == "rep@smartshape.in"
        assert "Rohini brochures" in n["message"]
    asyncio.run(go())


def test_does_not_nag_twice_in_one_day(db):
    async def go():
        await _optin(db)
        await _run_with_overdue(db)
        await sch.run_mail_overdue_nudge()
        await sch.run_mail_overdue_nudge()
        assert await db.crm_notifications.count_documents({"kind": "mail_overdue"}) == 1
    asyncio.run(go())


def test_silent_when_nothing_is_overdue(db):
    async def go():
        await _optin(db)
        await db.mail_runs.insert_one({"run_id": "R1", "name": "Run"})
        await db.mail_touches.insert_one({"touch_id": "t1", "run_id": "R1", "school_id": "s1",
                                          "planned_date": TODAY, "verify_status": "pending"})
        await sch.run_mail_overdue_nudge()
        assert await db.crm_notifications.count_documents({}) == 0
    asyncio.run(go())


def test_sent_pieces_are_never_overdue(db):
    async def go():
        await _optin(db)
        await db.mail_runs.insert_one({"run_id": "R1", "name": "Run"})
        await db.mail_touches.insert_one({"touch_id": "t1", "run_id": "R1", "school_id": "s1",
                                          "planned_date": OLD, "verify_status": "sent"})
        await sch.run_mail_overdue_nudge()
        assert await db.crm_notifications.count_documents({}) == 0
    asyncio.run(go())
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /f/ss-mail/backend && python -m pytest tests/test_mail_overdue_nudge.py -q`
Expected: FAIL — `module 'scheduler' has no attribute 'run_mail_overdue_nudge'`.

- [ ] **Step 3: Implement the job**

Add to `backend/scheduler.py`, next to the other job functions:

```python
async def run_mail_overdue_nudge():
    """JOB14 — post that was planned but never went out. Opt-in, once per run per day.

    Two deliberately quiet thresholds: printed but unposted for over a day, and
    planned but never printed for over three days.
    """
    cfg = await db.settings.find_one({"type": "notifications"}, {"_id": 0}) or {}
    if not cfg.get("mail_overdue_nudge"):
        return

    now = datetime.now(timezone.utc)
    today = now.strftime("%Y-%m-%d")
    printed_cut = (now - timedelta(days=1)).isoformat()
    planned_cut = (now - timedelta(days=3)).strftime("%Y-%m-%d")

    overdue = await db.mail_touches.find({
        "verify_status": "pending",
        "planned_date": {"$lt": today, "$ne": ""},
        "$or": [
            {"printed_at": {"$ne": None, "$lt": printed_cut}},
            {"printed_at": None, "planned_date": {"$lt": planned_cut}},
        ],
    }, {"_id": 0}).to_list(2000)
    if not overdue:
        return

    by_run = {}
    for t in overdue:
        by_run.setdefault(t.get("run_id", ""), []).append(t)

    for run_id, touches in by_run.items():
        dedup = f"mailnudge:{run_id}:{today}"
        if await db.crm_notifications.find_one({"dedup_key": dedup}, {"_id": 0, "_id": 0}):
            continue
        run = await db.mail_runs.find_one({"run_id": run_id}, {"_id": 0}) or {}
        owner = touches[0].get("owner") or run.get("created_by") or ""
        if not owner:
            continue
        n = len(touches)
        await db.crm_notifications.insert_one({
            "notification_id": f"notif_{uuid.uuid4().hex[:10]}",
            "user_email": owner, "kind": "mail_overdue", "dedup_key": dedup,
            "title": "Post still waiting to go out",
            "message": (f"{n} piece{'s' if n != 1 else ''} from "
                        f"\"{run.get('name', 'a mail run')}\" {'were' if n != 1 else 'was'} "
                        f"planned earlier and haven't been posted yet."),
            "link": "/offline-mail", "read": False,
            "created_at": now.isoformat()})
        log.info(f"[mail] overdue nudge → {owner}: {n} piece(s) on run {run_id}")


async def mail_overdue_loop():
    log.info("[scheduler] mail overdue nudge started (interval: 6 hr)")
    while True:
        try:
            await run_mail_overdue_nudge()
        except Exception as exc:
            log.error(f"[mail overdue loop] {exc}")
        await asyncio.sleep(6 * 60 * 60)
```

Register it next to the other `asyncio.create_task(...)` calls (~line 1764):

```python
    asyncio.create_task(mail_overdue_loop())
```

Confirm `timedelta` and `uuid` are imported at the top of `scheduler.py`; add them if not.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /f/ss-mail/backend && python -m pytest tests/test_mail_overdue_nudge.py -q`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
cd /f/ss-mail && git add backend/scheduler.py
git commit -m "feat(mail): opt-in evening nudge when planned post never went out"
```

---

### Task 14: API client methods

**Files:**
- Modify: `frontend/src/lib/api.js`

**Interfaces:**
- Consumes: endpoints from Tasks 8–12.
- Produces: `mailRuns.verify`, `mailRuns.undoVerify`, `mailRuns.replan`, `mailRuns.gapReport`, `mailRuns.todayQueue`, `mailRuns.queueStickers`, and `dripSequences.deliveries` — used by Tasks 15–18.

- [ ] **Step 1: Extend the `mailRuns` client**

In `frontend/src/lib/api.js`, inside the `mailRuns` object (before its closing brace):

```js
  verify: (id, payload) => API.post(`/mail-runs/${id}/verify`, payload),
  undoVerify: (id, touch_ids) => API.post(`/mail-runs/${id}/verify`, { undo: true, touch_ids }),
  replan: (id, payload) => API.post(`/mail-runs/${id}/replan`, payload),
  gapReport: (params = {}) => API.get('/mail-runs/gap-report', { params }),
  todayQueue: (date) => API.get('/mail-runs/today-queue', { params: date ? { date } : {} }),
  // _ts cache-buster, same reason as stickers(): browsers cache identical blob URLs.
  queueStickers: (params = {}) => API.get('/mail-runs/queue-stickers.pdf', { params: { ...params, _ts: Date.now() }, responseType: 'blob' }),
```

- [ ] **Step 2: Extend the drip client**

Find the `dripSequences` export (`grep -n "dripSequences" frontend/src/lib/api.js`) and add:

```js
  deliveries: (id, params = {}) => API.get(`/drip/sequences/${id}/deliveries`, { params }),
```

- [ ] **Step 3: Verify the build compiles**

Run:
```bash
cd /f/ss-mail/frontend && DISABLE_ESLINT_PLUGIN=true NODE_OPTIONS=--max-old-space-size=4096 REACT_APP_BACKEND_URL=https://app.smartshape.in npx react-scripts build
```
Expected: "Compiled successfully".

- [ ] **Step 4: Commit**

```bash
cd /f/ss-mail && git add frontend/src/lib/api.js
git commit -m "feat(mail): API client for verify, replan, gap report, post queue, deliveries"
```

---

### Task 15: Verify & post table

**Files:**
- Create: `frontend/src/components/mail/VerifyPostTable.js`
- Modify: `frontend/src/components/mail/MailAddressSheet.js`

**Interfaces:**
- Consumes: `mailRuns.verify` / `undoVerify` / `replan` (Task 14); the `addresses` response.
- Produces: `<VerifyPostTable runId rows onChanged />` — `rows` are the address rows enriched with `touch_id`, `verify_status`, `planned_date`, `posted_at`; `onChanged()` refetches.

- [ ] **Step 1: Return the lifecycle fields from the addresses endpoint**

In `backend/routes/crm_routes.py`, `get_mail_run_addresses` builds `rows` from `ids` only, which loses the touch. Rewrite the loop to iterate touches:

```python
    rows = []
    for t in touches:
        sid = t["school_id"]
        s = by_id.get(sid, {"school_id": sid, "school_name": "(deleted school)"})
        rows.append({
            "school_id": sid,
            "touch_id": t.get("touch_id", ""),
            "school_name": s.get("school_name", ""),
            "primary_contact_name": s.get("primary_contact_name", ""),
            "address": s.get("address", ""), "city": s.get("city", ""),
            "state": s.get("state", ""), "pincode": s.get("pincode", ""),
            "phone": s.get("phone", ""),
            "missing": _addr_missing(s),
            "verify_status": t.get("verify_status", "pending"),
            "planned_date": t.get("planned_date", ""),
            "posted_at": t.get("posted_at"),
            "printed_at": t.get("printed_at"),
            "reason": t.get("reason", ""),
            "replan_count": int(t.get("replan_count", 0) or 0),
        })
    return {"run_id": run_id, "rows": rows, "total": len(rows),
            "missing_count": sum(1 for r in rows if r["missing"]),
            "pending_count": sum(1 for r in rows if r["verify_status"] == "pending")}
```

Add a test to `backend/tests/test_mail_verify.py`:

```python
def test_addresses_carry_the_lifecycle_fields(db):
    async def go():
        await _seed(db, n=1)
        res = await crm.get_mail_run_addresses("R1", FakeRequest())
        row = res["rows"][0]
        assert row["touch_id"] == "t1"
        assert row["verify_status"] == "pending"
        assert row["planned_date"] == TODAY
        assert res["pending_count"] == 1
    asyncio.run(go())
```

Run: `cd /f/ss-mail/backend && python -m pytest tests/test_mail_verify.py -q` — expected: all passed.

- [ ] **Step 2: Create the component**

Create `frontend/src/components/mail/VerifyPostTable.js`:

```jsx
import React, { useState, useMemo } from 'react';
import { toast } from 'sonner';
import { mailRuns } from '../../lib/api';
import { Check, X, Undo2, CalendarClock } from 'lucide-react';

const today = () => new Date().toISOString().slice(0, 10);

const PILL = {
  sent:     { label: 'Sent',     cls: 'bg-[#2E7D5B]/10 text-[#2E7D5B] border-[#2E7D5B]/30' },
  not_sent: { label: 'Not sent', cls: 'bg-[#C4402E]/10 text-[#C4402E] border-[#C4402E]/30' },
  skipped:  { label: 'Skipped',  cls: 'bg-[var(--bg-primary)] text-[var(--text-muted)] border-[var(--border-color)]' },
  pending:  { label: 'Pending',  cls: 'bg-[#9A6A15]/10 text-[#9A6A15] border-[#9A6A15]/30' },
};

/**
 * End-of-day truth: which of these pieces actually went into the post.
 * Everything unresolved can be moved to a new date in one action.
 */
export default function VerifyPostTable({ runId, rows, onChanged }) {
  const [sel, setSel] = useState({});           // { touch_id: true }
  const [reasons, setReasons] = useState({});   // { touch_id: string }
  const [date, setDate] = useState(today());
  const [moveDate, setMoveDate] = useState(today());
  const [busy, setBusy] = useState(false);

  const pending = useMemo(() => rows.filter(r => r.verify_status === 'pending'), [rows]);
  const sentCount = rows.filter(r => r.verify_status === 'sent').length;
  const selected = Object.keys(sel).filter(k => sel[k]);
  const allPendingSelected = pending.length > 0 && pending.every(r => sel[r.touch_id]);

  const toggle = (id) => setSel(s => ({ ...s, [id]: !s[id] }));
  const selectAllPending = () => setSel(allPendingSelected ? {} : Object.fromEntries(pending.map(r => [r.touch_id, true])));

  const mark = async (status) => {
    if (!selected.length) { toast('Select the rows first'); return; }
    setBusy(true);
    try {
      await mailRuns.verify(runId, {
        posted_date: date,
        rows: selected.map(id => ({ touch_id: id, verify_status: status, reason: reasons[id] || '' })),
      });
      toast.success(`${selected.length} marked ${status === 'sent' ? 'sent' : 'not sent'}`);
      setSel({});
      onChanged();
    } catch { toast.error('Could not save'); }
    finally { setBusy(false); }
  };

  const undo = async (touchId) => {
    setBusy(true);
    try { await mailRuns.undoVerify(runId, [touchId]); onChanged(); }
    catch { toast.error('Undo failed'); }
    finally { setBusy(false); }
  };

  const moveRemaining = async () => {
    if (!pending.length) { toast('Nothing left to move'); return; }
    if (!window.confirm(`Move ${pending.length} unposted piece(s) to ${moveDate}?`)) return;
    setBusy(true);
    try {
      const r = await mailRuns.replan(runId, { select_pending: true, new_date: moveDate });
      toast.success(`${r.data.moved} moved to ${moveDate}`);
      onChanged();
    } catch (e) { toast.error(e?.response?.data?.detail || 'Could not re-plan'); }
    finally { setBusy(false); }
  };

  const cell = 'h-8 rounded-md px-2 text-[12px] bg-[var(--bg-primary)] border border-[var(--border-color)] text-[var(--text-primary)]';
  const btn = 'inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-[var(--border-color)] text-[12px] font-semibold text-[var(--text-secondary)] hover:text-[#e94560] hover:border-[#e94560] disabled:opacity-50';

  return (
    <div data-testid="verify-post-table">
      <table className="w-full text-sm border-separate border-spacing-y-1.5">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] text-left">
            <th className="pr-2 w-8">
              <input type="checkbox" className="accent-[#e94560]" checked={allPendingSelected}
                onChange={selectAllPending} title="Select all pending" data-testid="select-all-pending" />
            </th>
            <th className="pr-2">School</th>
            <th className="pr-2 w-[12%]">Planned</th>
            <th className="pr-2 w-[12%]">Posted</th>
            <th className="pr-2 w-[14%]">Status</th>
            <th className="pr-2 w-[24%]">If not sent — why</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const p = PILL[r.verify_status] || PILL.pending;
            const isPending = r.verify_status === 'pending';
            return (
              <tr key={r.touch_id} data-testid={`verify-row-${r.touch_id}`}>
                <td className="pr-2 align-middle">
                  <input type="checkbox" className="accent-[#e94560]" checked={!!sel[r.touch_id]}
                    onChange={() => toggle(r.touch_id)} disabled={!isPending} />
                </td>
                <td className="pr-2 align-middle">
                  <div className="text-[13px] font-semibold text-[var(--text-primary)] leading-tight">{r.school_name}</div>
                  <div className="text-[11px] text-[var(--text-muted)]">
                    {r.printed_at ? 'sticker printed' : 'not printed yet'}
                    {r.replan_count > 0 ? ` · moved ${r.replan_count}×` : ''}
                  </div>
                </td>
                <td className="pr-2 align-middle text-[12px] font-mono text-[var(--text-secondary)]">{r.planned_date || '—'}</td>
                <td className="pr-2 align-middle text-[12px] font-mono text-[var(--text-secondary)]">{(r.posted_at || '').slice(0, 10) || '—'}</td>
                <td className="pr-2 align-middle">
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${p.cls}`}>{p.label}</span>
                  {!isPending && (
                    <button onClick={() => undo(r.touch_id)} disabled={busy} title="Undo this"
                      className="ml-1.5 text-[var(--text-muted)] hover:text-[#e94560] align-middle">
                      <Undo2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </td>
                <td className="pr-2 align-middle">
                  {isPending ? (
                    <input className={cell + ' w-full'} placeholder="e.g. address missing, no stock"
                      value={reasons[r.touch_id] || ''}
                      onChange={e => setReasons(x => ({ ...x, [r.touch_id]: e.target.value }))} />
                  ) : (
                    <span className="text-[12px] text-[var(--text-muted)]">{r.reason || '—'}</span>
                  )}
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && <tr><td colSpan="6" className="py-10 text-center text-[var(--text-muted)]">No schools in this run.</td></tr>}
        </tbody>
      </table>

      <div className="sticky bottom-0 mt-3 flex flex-wrap items-center gap-2 pt-3 border-t border-[var(--border-color)] bg-[var(--bg-card)]">
        <span className="text-xs text-[var(--text-muted)] mr-auto" data-testid="verify-summary">
          <b className="text-[var(--text-primary)]">{sentCount}</b> of {rows.length} verified sent
          {pending.length > 0 ? ` · ${pending.length} pending` : ''}
          {selected.length > 0 ? ` · ${selected.length} selected` : ''}
        </span>
        <label className="text-[11px] text-[var(--text-muted)]">Posted on</label>
        <input type="date" className={cell} value={date} onChange={e => setDate(e.target.value)} data-testid="posted-date" />
        <button className={btn} disabled={busy || !selected.length} onClick={() => mark('sent')} data-testid="mark-sent">
          <Check className="h-3.5 w-3.5" /> Mark selected sent
        </button>
        <button className={btn} disabled={busy || !selected.length} onClick={() => mark('not_sent')} data-testid="mark-not-sent">
          <X className="h-3.5 w-3.5" /> Not sent
        </button>
        <span className="w-px h-6 bg-[var(--border-color)] mx-1" />
        <input type="date" className={cell} value={moveDate} onChange={e => setMoveDate(e.target.value)} data-testid="move-date" />
        <button className={btn} disabled={busy || !pending.length} onClick={moveRemaining} data-testid="move-remaining">
          <CalendarClock className="h-3.5 w-3.5" /> Move remaining ({pending.length})
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add the tab to `MailAddressSheet`**

Import it and add a `mode` state:

```js
import VerifyPostTable from './VerifyPostTable';
```
```js
  const [mode, setMode] = useState('addresses');   // 'addresses' | 'verify'
```

Add the tab strip directly below the header block (above the status banner):

```jsx
        <div className="px-5 pt-3 flex items-center gap-1">
          {[['addresses', 'Addresses'], ['verify', 'Verify & post']].map(([k, label]) => (
            <button key={k} onClick={() => setMode(k)} data-testid={`tab-${k}`}
              className={`h-8 px-3 rounded-lg text-[12px] font-semibold transition-colors ${mode === k ? 'bg-[#e94560] text-white' : 'text-[var(--text-secondary)] hover:text-[#e94560]'}`}>
              {label}
            </button>
          ))}
        </div>
```

Wrap the existing `<table>` in the scroll area so it only renders in `addresses` mode, and render the verify table otherwise:

```jsx
          ) : mode === 'verify' ? (
            <VerifyPostTable runId={runId} rows={rows} onChanged={load} />
          ) : (
```

- [ ] **Step 4: Verify the build compiles**

Run:
```bash
cd /f/ss-mail/frontend && DISABLE_ESLINT_PLUGIN=true NODE_OPTIONS=--max-old-space-size=4096 REACT_APP_BACKEND_URL=https://app.smartshape.in npx react-scripts build
```
Expected: "Compiled successfully".

- [ ] **Step 5: Commit**

```bash
cd /f/ss-mail && git add backend/routes/crm_routes.py frontend/src/components/mail/VerifyPostTable.js frontend/src/components/mail/MailAddressSheet.js
git commit -m "feat(mail): Verify & post sheet — per-school truth, undo, move remaining"
```

---

### Task 16: Today's Post queue on the Offline Mail page

**Files:**
- Create: `frontend/src/components/mail/TodayPostQueue.js`
- Modify: `frontend/src/pages/admin/OfflineMail.js`

**Interfaces:**
- Consumes: `mailRuns.todayQueue` / `queueStickers` (Task 14).
- Produces: `<TodayPostQueue onOpenRun={(run_id, name) => …} />`.

- [ ] **Step 1: Create the component**

Create `frontend/src/components/mail/TodayPostQueue.js`:

```jsx
import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { mailRuns } from '../../lib/api';
import { Printer, AlertTriangle, PackageCheck } from 'lucide-react';
import { useDataSync } from '../../lib/dataSync';

/**
 * The posting job for today, across every run — a drip mailer and a manual run are
 * the same task to whoever carries the bundle to the counter.
 */
export default function TodayPostQueue({ onOpenRun }) {
  const [q, setQ] = useState({ total: 0, overdue: 0, groups: [] });
  const [printing, setPrinting] = useState(false);

  const load = useCallback(async () => {
    try { const r = await mailRuns.todayQueue(); setQ(r.data || { total: 0, overdue: 0, groups: [] }); }
    catch { /* the page already surfaces load errors */ }
  }, []);
  useEffect(() => { load(); }, [load]);
  useDataSync('mail', load);

  const printAll = async () => {
    setPrinting(true);
    try {
      const res = await mailRuns.queueStickers({ skip_incomplete: '1' });
      const url = URL.createObjectURL(res.data);
      const w = window.open(url, '_blank');
      if (!w) {
        const a = document.createElement('a');
        a.href = url; a.download = `post-${q.date}.pdf`; a.rel = 'noopener'; a.style.display = 'none';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      load();
    } catch { toast.error('Could not build the print batch'); }
    finally { setPrinting(false); }
  };

  if (!q.total) return null;

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl p-5 border-l-4"
      style={{ borderLeftColor: q.overdue ? '#C4402E' : '#e94560' }} data-testid="today-post-queue">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div>
          <h2 className="text-lg font-medium text-[var(--text-primary)] flex items-center gap-2">
            <PackageCheck className="h-4 w-4 text-[#e94560]" /> To post today
          </h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            <b className="text-[var(--text-secondary)]">{q.total}</b> piece{q.total !== 1 ? 's' : ''} across {q.groups.length} run{q.groups.length !== 1 ? 's' : ''}
            {q.overdue > 0 && <span className="text-[#C4402E] font-semibold"> · {q.overdue} overdue from earlier</span>}
          </p>
        </div>
        <button onClick={printAll} disabled={printing} data-testid="print-all-queue"
          className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-[#e94560] hover:bg-[#f05c75] text-white text-sm font-semibold disabled:opacity-50">
          <Printer className="h-4 w-4" /> {printing ? 'Preparing…' : 'Print all stickers'}
        </button>
      </div>
      <div className="grid gap-2">
        {q.groups.map(g => (
          <button key={g.run_id} onClick={() => onOpenRun(g.run_id, g.run_name)} data-testid={`queue-run-${g.run_id}`}
            className="flex items-center justify-between gap-3 p-3 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-color)] text-left hover:border-[#e94560]">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
                {g.run_name}
                {g.is_drip_run && <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#e94560]/10 text-[#e94560]">Drip</span>}
              </p>
              <p className="text-[11px] text-[var(--text-muted)] capitalize">
                {g.piece_type}{g.sequence_name ? ` · ${g.sequence_name}` : ''}
              </p>
            </div>
            <span className="flex items-center gap-2 flex-shrink-0 text-[12px] font-mono">
              {g.overdue > 0 && (
                <span className="inline-flex items-center gap-1 text-[#C4402E] font-semibold">
                  <AlertTriangle className="h-3.5 w-3.5" /> {g.overdue}
                </span>
              )}
              <b className="text-[var(--text-primary)]">{g.count}</b>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Mount it at the top of Offline Mail**

In `OfflineMail.js`, import it and render it as the first child of the `<div className="grid gap-6">`, above the hot-leads card:

```js
import TodayPostQueue from '../../components/mail/TodayPostQueue';
```
```jsx
            <TodayPostQueue onOpenRun={(run_id, name) => setSheetRun({ run_id, name })} />
```

- [ ] **Step 3: Verify the build compiles**

Run:
```bash
cd /f/ss-mail/frontend && DISABLE_ESLINT_PLUGIN=true NODE_OPTIONS=--max-old-space-size=4096 REACT_APP_BACKEND_URL=https://app.smartshape.in npx react-scripts build
```
Expected: "Compiled successfully".

- [ ] **Step 4: Commit**

```bash
cd /f/ss-mail && git add frontend/src/components/mail/TodayPostQueue.js frontend/src/pages/admin/OfflineMail.js
git commit -m "feat(mail): Today's Post queue with one-click combined sticker print"
```

---

### Task 17: Gap report panel

**Files:**
- Create: `frontend/src/components/mail/GapReportPanel.js`
- Modify: `frontend/src/pages/admin/OfflineMail.js`

**Interfaces:**
- Consumes: `mailRuns.gapReport` (Task 14).
- Produces: `<GapReportPanel />`.

- [ ] **Step 1: Create the component**

Create `frontend/src/components/mail/GapReportPanel.js`:

```jsx
import React, { useState, useEffect, useCallback } from 'react';
import { mailRuns } from '../../lib/api';
import { GitCompareArrows } from 'lucide-react';

const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const GROUPS = [['run', 'By run'], ['sequence', 'By sequence'], ['owner', 'By rep'], ['school', 'By school']];

/** Planned vs actual: how much slipped, and — via the reason Pareto — what to fix. */
export default function GapReportPanel() {
  const [groupBy, setGroupBy] = useState('run');
  const [data, setData] = useState({ rows: [], totals: {}, reasons: [] });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await mailRuns.gapReport({ group_by: groupBy }); setData(r.data); }
    catch { /* non-fatal panel */ }
    finally { setLoading(false); }
  }, [groupBy]);
  useEffect(() => { load(); }, [load]);

  const t = data.totals || {};
  if (!loading && !t.planned) return null;

  const kpis = [
    { label: 'Planned', val: t.planned ?? 0 },
    { label: 'Posted', val: t.sent ?? 0 },
    { label: 'Not sent', val: t.not_sent ?? 0, bad: (t.not_sent || 0) > 0 },
    { label: 'Still pending', val: t.pending ?? 0, bad: (t.pending || 0) > 0 },
    { label: 'Printed, not posted', val: t.printed_not_posted ?? 0, bad: (t.printed_not_posted || 0) > 0 },
    { label: 'On time', val: t.on_time_pct == null ? '—' : `${t.on_time_pct}%` },
    { label: 'Avg days late', val: t.avg_days_late == null ? '—' : t.avg_days_late },
    { label: 'Postage at risk', val: inr(t.postage_exposure) },
  ];

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl p-5" data-testid="gap-report">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div>
          <h2 className="text-lg font-medium text-[var(--text-primary)] flex items-center gap-2">
            <GitCompareArrows className="h-4 w-4 text-[#e94560]" /> Plan vs Actual
          </h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">What you planned to post against what really went out.</p>
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {GROUPS.map(([k, label]) => (
            <button key={k} onClick={() => setGroupBy(k)} data-testid={`gap-group-${k}`}
              className={`h-8 px-2.5 rounded-lg text-[11px] font-semibold border transition-colors ${groupBy === k ? 'bg-[#e94560] text-white border-[#e94560]' : 'border-[var(--border-color)] text-[var(--text-secondary)]'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {kpis.map((k, i) => (
          <div key={i} className={`rounded-xl p-3 border ${k.bad ? 'border-[#C4402E]/40 bg-[#C4402E]/5' : 'border-[var(--border-color)] bg-[var(--bg-primary)]'}`}>
            <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">{k.label}</div>
            <div className="mt-1 text-xl font-bold text-[var(--text-primary)]">{k.val}</div>
          </div>
        ))}
      </div>

      {data.reasons?.length > 0 && (
        <div className="mb-4">
          <div className="text-[11px] uppercase tracking-wide text-[var(--text-muted)] mb-1.5">Why pieces didn't go out</div>
          <div className="flex flex-wrap gap-1.5">
            {data.reasons.map(r => (
              <span key={r.reason} className="text-[11px] px-2 py-1 rounded-full bg-[#C4402E]/10 text-[#C4402E] border border-[#C4402E]/25">
                {r.reason} · <b>{r.count}</b>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] text-left">
              <th className="py-2 pr-3">{GROUPS.find(g => g[0] === groupBy)[1].replace('By ', '')}</th>
              <th className="py-2 pr-3">Planned</th><th className="py-2 pr-3">Posted</th>
              <th className="py-2 pr-3">Not sent</th><th className="py-2 pr-3">Pending</th>
              <th className="py-2 pr-3" title="Stickers printed but never posted">Leaked</th>
              <th className="py-2 pr-3">On time</th><th className="py-2 pr-3">Avg late</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map(r => (
              <tr key={r.key} className="border-t border-[var(--border-color)]" data-testid={`gap-row-${r.key}`}>
                <td className="py-2.5 pr-3 text-[var(--text-primary)] font-medium">{r.label}</td>
                <td className="py-2.5 pr-3 font-mono">{r.planned}</td>
                <td className="py-2.5 pr-3 font-mono text-[#2E7D5B] font-semibold">{r.sent}</td>
                <td className="py-2.5 pr-3 font-mono" style={{ color: r.not_sent ? '#C4402E' : undefined }}>{r.not_sent}</td>
                <td className="py-2.5 pr-3 font-mono" style={{ color: r.pending ? '#9A6A15' : undefined }}>{r.pending}</td>
                <td className="py-2.5 pr-3 font-mono" style={{ color: r.printed_not_posted ? '#C4402E' : undefined }}>{r.printed_not_posted}</td>
                <td className="py-2.5 pr-3 font-mono">{r.on_time_pct == null ? '—' : `${r.on_time_pct}%`}</td>
                <td className="py-2.5 pr-3 font-mono">{r.avg_days_late == null ? '—' : r.avg_days_late}</td>
              </tr>
            ))}
            {!loading && data.rows.length === 0 && <tr><td colSpan="8" className="py-6 text-center text-[var(--text-muted)]">Nothing posted or planned yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Mount it in Offline Mail**

Import and render it directly below the Campaign Performance block:

```js
import GapReportPanel from '../../components/mail/GapReportPanel';
```
```jsx
            <GapReportPanel />
```

- [ ] **Step 3: Verify the build compiles**

Run:
```bash
cd /f/ss-mail/frontend && DISABLE_ESLINT_PLUGIN=true NODE_OPTIONS=--max-old-space-size=4096 REACT_APP_BACKEND_URL=https://app.smartshape.in npx react-scripts build
```
Expected: "Compiled successfully".

- [ ] **Step 4: Commit**

```bash
cd /f/ss-mail && git add frontend/src/components/mail/GapReportPanel.js frontend/src/pages/admin/OfflineMail.js
git commit -m "feat(mail): Plan vs Actual panel with reason Pareto and postage exposure"
```

---

### Task 18: Sequence deliveries table in DripsTab

**Files:**
- Modify: `frontend/src/components/marketing/DripsTab.js`

**Interfaces:**
- Consumes: `dripSequences.deliveries` (Task 14).
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Add deliveries state and loader**

In `DripsTab`, add:

```js
  const [deliveries, setDeliveries] = useState(null);   // { id, loading, rows, totals }

  async function openDeliveries(d) {
    if (deliveries?.id === d.id) { setDeliveries(null); return; }
    setDeliveries({ id: d.id, loading: true, rows: [], totals: {} });
    try {
      const r = await dripApi.deliveries(d.sequence_id || d.id);
      setDeliveries({ id: d.id, loading: false, rows: r.data.rows || [], totals: r.data.totals || {} });
    } catch {
      toast.error('Could not load deliveries');
      setDeliveries(null);
    }
  }
```

- [ ] **Step 2: Add the trigger button**

In the expanded-steps block, next to the existing "Edit sequence" button, wrap both in a two-column row:

```jsx
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button onClick={() => startEdit(d)}
                    className={`h-8 rounded-lg border ${tk.bdr} text-xs ${tk.tm} ${tk.hov} flex items-center justify-center gap-1.5 transition-colors`}>
                    <Pencil className="h-3 w-3" /> Edit sequence
                  </button>
                  <button onClick={() => openDeliveries(d)} data-testid={`deliveries-${d.id}`}
                    className={`h-8 rounded-lg border ${tk.bdr} text-xs ${tk.tm} ${tk.hov} flex items-center justify-center gap-1.5 transition-colors`}>
                    <ChevronRight className="h-3 w-3" /> What was sent, and where
                  </button>
                </div>
```

- [ ] **Step 3: Render the table**

Directly below that row, inside the same expanded block:

```jsx
                {deliveries?.id === d.id && (
                  <div className="mt-3 border-t border-[var(--border-color)] pt-3" data-testid="deliveries-table">
                    {deliveries.loading ? (
                      <p className={`text-xs ${tk.tm} py-4 text-center`}>Loading…</p>
                    ) : (
                      <>
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {Object.entries(deliveries.totals).map(([k, v]) => (
                            <span key={k} className={`text-[10px] px-2 py-0.5 rounded-full ${k === 'sent' ? 'bg-green-500/15 text-green-500' : k === 'not_sent' || k === 'failed' ? 'bg-red-500/15 text-red-400' : 'bg-[var(--accent)]/10 text-[var(--accent)]'}`}>
                              {k.replace('_', ' ')} · {v}
                            </span>
                          ))}
                        </div>
                        <div className="overflow-x-auto max-h-72 overflow-y-auto">
                          <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-[var(--bg-primary)]">
                              <tr className={`text-[10px] uppercase tracking-wide ${tk.tm} text-left`}>
                                <th className="py-1.5 pr-2">School</th><th className="py-1.5 pr-2">Step</th>
                                <th className="py-1.5 pr-2">Channel</th><th className="py-1.5 pr-2">Item</th>
                                <th className="py-1.5 pr-2">Planned</th><th className="py-1.5 pr-2">Actual</th>
                                <th className="py-1.5 pr-2">Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {deliveries.rows.map((r, i) => (
                                <tr key={i} className="border-t border-[var(--border-color)]">
                                  <td className="py-1.5 pr-2">
                                    {r.school_id ? (
                                      <button onClick={() => navigate(`/schools/${r.school_id}`)}
                                        className={`${tk.t1} font-medium hover:text-[var(--accent)] hover:underline text-left`}>
                                        {r.school_name}
                                      </button>
                                    ) : <span className={tk.tm}>{r.school_name}</span>}
                                  </td>
                                  <td className={`py-1.5 pr-2 font-mono ${tk.tm}`}>{r.step_number}</td>
                                  <td className={`py-1.5 pr-2 capitalize ${tk.tm}`}>{r.channel}</td>
                                  <td className={`py-1.5 pr-2 ${tk.tm}`}>{r.item || '—'}</td>
                                  <td className={`py-1.5 pr-2 font-mono ${tk.tm}`}>{r.planned_date || '—'}</td>
                                  <td className={`py-1.5 pr-2 font-mono ${tk.tm}`}>{r.actual_date || '—'}</td>
                                  <td className="py-1.5 pr-2">
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${r.status === 'sent' ? 'bg-green-500/15 text-green-500' : r.status === 'not_sent' || r.status === 'failed' ? 'bg-red-500/15 text-red-400' : 'bg-yellow-500/15 text-yellow-600'}`}>
                                      {r.status.replace('_', ' ')}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                              {deliveries.rows.length === 0 && (
                                <tr><td colSpan="7" className={`py-6 text-center ${tk.tm}`}>Nobody is enrolled in this sequence yet.</td></tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                  </div>
                )}
```

Confirm the school-profile route path with `grep -n "schools/:" frontend/src/App.js` and use the real one.

- [ ] **Step 4: Verify the build compiles**

Run:
```bash
cd /f/ss-mail/frontend && DISABLE_ESLINT_PLUGIN=true NODE_OPTIONS=--max-old-space-size=4096 REACT_APP_BACKEND_URL=https://app.smartshape.in npx react-scripts build
```
Expected: "Compiled successfully".

- [ ] **Step 5: Commit**

```bash
cd /f/ss-mail && git add frontend/src/components/marketing/DripsTab.js
git commit -m "feat(drip): clickable deliveries table — what each sequence sent, where, and when"
```

---

### Task 19: Full regression, build, and deploy

**Files:**
- Modify: `frontend/build/**` (the committed production bundle)

- [ ] **Step 1: Run the entire backend suite**

Run: `cd /f/ss-mail/backend && python -m pytest tests/ -q`
Expected: every test passes. Pay particular attention to pre-existing suites that touch changed code — `test_mail_run_delete_sync.py`, `test_drip_physical_mailer.py`, `test_drip_call_task.py`, `test_enroll_schools.py`, `test_engagement_ledger.py`. If any regress, fix the source, not the test.

- [ ] **Step 2: Build the production bundle**

Run:
```bash
cd /f/ss-mail/frontend && DISABLE_ESLINT_PLUGIN=true NODE_OPTIONS=--max-old-space-size=4096 REACT_APP_BACKEND_URL=https://app.smartshape.in npx react-scripts build
```
Expected: "Compiled successfully"; note the new `main.<hash>.js` filename.

- [ ] **Step 3: Confirm the bundle is not pointing at `undefined`**

Run: `cd /f/ss-mail/frontend && grep -c "app.smartshape.in" build/static/js/main.*.js`
Expected: at least 1. A zero here means the inline `REACT_APP_BACKEND_URL` was missed and the deploy would break every API call.

- [ ] **Step 4: Commit the bundle**

```bash
cd /f/ss-mail && git add frontend/build
git commit -m "build: production bundle for offline-mail verification + gap reporting"
```

- [ ] **Step 5: Report before merging**

Do **not** merge to `main` or deploy automatically. Report to the owner: the branch name, the bundle hash, the full test count, and the two behaviour changes that need a decision — the run `status` dropdown is now derived from verification, and the follow-up cadence now fires per verified school instead of for the whole run. Merging to `main` triggers the production auto-deploy, so that is the owner's call.

---

## Self-Review

**Spec coverage.** P1 §5 → Tasks 1–3. P2 §6 → Tasks 4–5. P3 §7.1 endpoints → Tasks 8–12; §7.2 verify sheet → Task 15; §7.3 gap UI → Task 17; §7.4 slip policy → asserted in Task 9 Step 1; §7.5 three states → Tasks 6, 7; §7.6 Today's Post → Tasks 11, 16; §7.7 nudge → Task 13; §7.8 gap "why" → Task 10; §7.9 undo → Task 8. §4 data model → Tasks 4, 6, 7. §9 edge cases → covered by tests in Tasks 6–11. §10 testing → each task's test step. §11 rollout → Task 19. **P4 (§8) is deliberately not in this plan** — separate subsystem, separate plan.

**Type consistency.** `verify_status` values are `pending|sent|not_sent|skipped` everywhere (`VERIFY_STATUSES` in Task 8, the test fixtures, `PILL` in Task 15, the gap report branches in Task 10). `touch_id` is the identifier used by verify, replan, the queue, and the deliveries join. `_recompute_run_counts` (Task 8) is the single writer of `counts.*` and `status`, called by both Task 8 and Task 9. `_clamp_scale` (Task 1) is reused by Tasks 2 and 11. `print_batch_id` is `pb_<hex12>` in both Task 7 and Task 11.

**Known risk flagged for the executor.** Task 8 Step 5 adapts the legacy status dropdown onto the verify handler with `_StatusVerifyRequest`. If `get_current_user` cannot accept that adapter, refactor the verify body into `_do_verify(run_id, user, body)` and have both callers use it — the step says so explicitly rather than leaving it to be discovered.
