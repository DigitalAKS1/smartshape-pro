# Certificate Pipeline (Phase A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate one personalized certificate PDF per attendee from a designer-made PNG template, and deliver each via WhatsApp + email exactly once per channel.

**Architecture:** New self-contained backend module (`cert_routes.py`) using Pillow to overlay text fields on an uploaded PNG background and save a PDF; files stored on local disk under `uploads/certificates/` and served via a static mount (mirroring the existing `/uploads/whatsapp` pattern) so Evolution can fetch them by URL. A background `cert_loop` in `scheduler.py` does generation + delivery with per-attendee-per-channel idempotency (same pattern as `fms_notifications`). New React "Certificates" page with a drag-to-position template designer.

**Tech Stack:** Python 3.14, FastAPI, Motor/MongoDB, Pillow (image overlay), ReportLab fonts (already used), Evolution API (`evolution.send_document`), smtplib (email attachments), pytest + requests. Frontend: React (CRA).

---

## Reference: spec
`docs/superpowers/specs/2026-06-04-certificate-pipeline-design.md`. Read it before starting.

## Reference: how to run tests
- **Unit tests** (pure, no server), from `backend/`: `python -m pytest tests/test_cert_generation.py -v`
- **Integration tests** (need the test backend running), from `backend/`:
  `DB_NAME=smartshape_test REACT_APP_BACKEND_URL=http://127.0.0.1:8000 python -m pytest tests/test_cert_pipeline.py -v`
  The controller runs ONE backend on `http://127.0.0.1:8000` with `DB_NAME=smartshape_test` and `CERT_DRY_RUN=1` (so no real WhatsApp/email is sent), WITHOUT `--reload`. **Do NOT start/stop/kill any backend process** — if a route 404s because the backend hasn't reloaded your code, report it; the controller restarts and verifies green.
- `tests/` is gitignored — do NOT `git add -f` test files; commit implementation files only.
- Commit trailer for every commit: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## File structure
- **Create** `backend/routes/cert_routes.py` — all `/certs` endpoints (templates, batches, attendees, generate, send, preview).
- **Create** `backend/cert_engine.py` — pure generation + helpers (`resolve_field_value`, `render_certificate_pdf`, `sanitize_filename`, `_text_anchor`). Pure so it unit-tests without a server/DB.
- **Modify** `backend/main.py` — register `cert_router`; add `/uploads/certificates` static mount.
- **Modify** `backend/scheduler.py` — add `cert_loop` + `_cert_send_email_attachment` + delivery helpers; wire into `start_scheduler`.
- **Modify** `backend/database.py` — add `cert_*` indexes.
- **Create (frontend)** `frontend/src/lib/api.js` additions, `frontend/src/hooks/useCertificates.js`, `frontend/src/pages/admin/Certificates.js`, `frontend/src/components/certs/{TemplateDesigner,BatchCreator,BatchDetail}.js`.
- **Test** `backend/tests/test_cert_generation.py` (unit), `backend/tests/test_cert_pipeline.py` (integration).

---

# PHASE 1 — Backend foundation

### Task 1: Module skeleton, static mount, indexes

**Files:**
- Create: `backend/routes/cert_routes.py`
- Modify: `backend/main.py`, `backend/database.py`
- Test: `backend/tests/test_cert_pipeline.py`

- [ ] **Step 1: Write the failing integration test**

Create `backend/tests/test_cert_pipeline.py`:
```python
"""Integration tests for the certificate pipeline. Backend must be running.
Run from backend/:
  DB_NAME=smartshape_test REACT_APP_BACKEND_URL=http://127.0.0.1:8000 python -m pytest tests/test_cert_pipeline.py -v
"""
import os, uuid, pytest, requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://127.0.0.1:8000").rstrip("/")
ADMIN_EMAIL, ADMIN_PASSWORD = "info@smartshape.in", "admin123"


@pytest.fixture(scope="session")
def admin():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    for c in r.cookies:
        s.cookies.set(c.name, c.value, domain=c.domain or "127.0.0.1", path=c.path or "/")
    return s


class TestCertHealth:
    def test_templates_endpoint_exists(self, admin):
        r = admin.get(f"{BASE_URL}/api/certs/templates", timeout=15)
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)
```

- [ ] **Step 2: Run to verify it fails**

Run: `DB_NAME=smartshape_test REACT_APP_BACKEND_URL=http://127.0.0.1:8000 python -m pytest tests/test_cert_pipeline.py::TestCertHealth -v`
Expected: FAIL — 404 (route not mounted).

- [ ] **Step 3: Create the router skeleton**

Create `backend/routes/cert_routes.py`:
```python
"""Certificate pipeline — generate personalized cert PDFs and deliver via WhatsApp/email."""
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
import uuid, os

from database import db
from auth_utils import get_current_user
from rbac import require_admin

router = APIRouter(prefix="/certs", tags=["certs"])

CERT_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads", "certificates")
os.makedirs(CERT_DIR, exist_ok=True)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def gen_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


@router.get("/templates")
async def list_templates(request: Request):
    await get_current_user(request)
    return await db.cert_templates.find({"is_active": {"$ne": False}}, {"_id": 0}).sort("created_at", -1).to_list(100)
```

- [ ] **Step 4: Register router + static mount in `main.py`**

In `backend/main.py`, near the other `include_router` calls (after `procurement_router`, ~line 93) add:
```python
from routes.cert_routes import router as cert_router
app.include_router(cert_router, prefix="/api")
```
After the existing WhatsApp static mount (~line 98) add:
```python
_CERT_UPLOADS = os.path.join(os.path.dirname(__file__), "uploads", "certificates")
os.makedirs(_CERT_UPLOADS, exist_ok=True)
app.mount("/uploads/certificates", StaticFiles(directory=_CERT_UPLOADS), name="cert_uploads")
```

- [ ] **Step 5: Add indexes in `database.py`**

In `backend/database.py`, after the FMS index block (~line 123) add:
```python
    # ── Certificates ─────────────────────────────────────────────────────────
    await db.cert_templates.create_index("is_active", background=True)
    await db.cert_batches.create_index([("created_at", -1)], background=True)
    await db.cert_items.create_index([("batch_id", 1), ("gen_status", 1)], background=True)
```

- [ ] **Step 6: Ensure uploads/certificates is gitignored**

Check `.gitignore` has a line covering `backend/uploads/` (the WhatsApp uploads already live there). If `uploads/` is not ignored, add:
```
backend/uploads/
```
Run: `git check-ignore backend/uploads/certificates` — expected: prints the path (ignored). If not ignored, add the line and commit it.

- [ ] **Step 7: Verify import + test green (controller restarts backend)**

Local gate: `python -c "import routes.cert_routes"` exits 0. Then report; the controller restarts the backend and runs:
`DB_NAME=smartshape_test REACT_APP_BACKEND_URL=http://127.0.0.1:8000 python -m pytest tests/test_cert_pipeline.py::TestCertHealth -v`
Expected: PASS.

- [ ] **Step 8: Commit**
```bash
git add backend/routes/cert_routes.py backend/main.py backend/database.py
git commit -m "feat(certs): module skeleton, static mount, indexes"
```

---

### Task 2: Certificate generation engine (pure, unit-tested)

**Files:**
- Create: `backend/cert_engine.py`
- Test: `backend/tests/test_cert_generation.py`

- [ ] **Step 1: Write failing unit tests**

Create `backend/tests/test_cert_generation.py`:
```python
"""Pure unit tests for the certificate engine. No server/DB needed.
Run from backend/:  python -m pytest tests/test_cert_generation.py -v
"""
import os, tempfile
from PIL import Image
from cert_engine import resolve_field_value, sanitize_filename, render_certificate_pdf


class TestResolveFieldValue:
    def test_name_comes_from_attendee(self):
        item = {"name": "Amit Sharma"}
        shared = {"date": "2026-06-04", "theme": "Sales 101", "expert": "R. Verma"}
        assert resolve_field_value("name", item, shared) == "Amit Sharma"

    def test_shared_fields(self):
        item = {"name": "X"}
        shared = {"date": "2026-06-04", "theme": "Sales 101", "expert": "R. Verma"}
        assert resolve_field_value("theme", item, shared) == "Sales 101"
        assert resolve_field_value("expert", item, shared) == "R. Verma"

    def test_unknown_field_blank(self):
        assert resolve_field_value("nope", {"name": "X"}, {}) == ""


class TestSanitizeFilename:
    def test_strips_unsafe_chars(self):
        assert sanitize_filename("Amit / Sharma*?") == "Amit__Sharma"

    def test_non_empty_fallback(self):
        assert sanitize_filename("") == "certificate"


class TestRenderCertificatePdf:
    def test_writes_valid_pdf(self):
        # tiny 400x300 white background
        with tempfile.TemporaryDirectory() as d:
            bg = os.path.join(d, "bg.png")
            Image.new("RGB", (400, 300), "white").save(bg)
            out = os.path.join(d, "cert.pdf")
            fields = [{"key": "name", "x": 200, "y": 150, "size": 24,
                       "color": "#000000", "align": "center"}]
            render_certificate_pdf(
                background_path=bg, out_path=out, fields=fields,
                item={"name": "Amit Sharma"},
                shared={"date": "2026-06-04", "theme": "T", "expert": "E"},
            )
            assert os.path.exists(out)
            with open(out, "rb") as f:
                assert f.read(4) == b"%PDF"
```

- [ ] **Step 2: Run to verify failure**

Run: `python -m pytest tests/test_cert_generation.py -v`
Expected: FAIL — `ModuleNotFoundError: cert_engine`.

- [ ] **Step 3: Implement `cert_engine.py`**

Create `backend/cert_engine.py`:
```python
"""Pure certificate rendering — Pillow overlay on a PNG background, saved as PDF.
No DB/server imports so it is unit-testable in isolation."""
import os, re
from typing import List, Dict, Any, Optional
from PIL import Image, ImageDraw, ImageFont

# Bundled fallback font; DejaVu ships with Pillow's test data on some systems,
# otherwise Pillow's load_default is used (fixed size). Prefer a real TTF for sizing.
_FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "C:\\Windows\\Fonts\\arial.ttf",
    "C:\\Windows\\Fonts\\Arial.ttf",
]

def _load_font(size: int) -> ImageFont.FreeTypeFont:
    for p in _FONT_CANDIDATES:
        if os.path.isfile(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    # last resort — fixed-size default (size arg ignored)
    return ImageFont.load_default()


def resolve_field_value(key: str, item: Dict[str, Any], shared: Dict[str, Any]) -> str:
    if key == "name":
        return str(item.get("name", "") or "")
    if key in ("date", "theme", "expert"):
        return str((shared or {}).get(key, "") or "")
    return ""


def sanitize_filename(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]", "_", (name or "").strip())
    cleaned = re.sub(r"_+", "_", cleaned).strip("_")
    return cleaned or "certificate"


def _anchor_x(draw: ImageDraw.ImageDraw, text: str, font, x: int, align: str) -> int:
    if align == "left":
        return x
    bbox = draw.textbbox((0, 0), text, font=font)
    w = bbox[2] - bbox[0]
    if align == "right":
        return x - w
    return x - w // 2  # center


def render_certificate_pdf(background_path: str, out_path: str,
                           fields: List[Dict[str, Any]],
                           item: Dict[str, Any], shared: Dict[str, Any]) -> str:
    """Overlay fields onto the background PNG and save a single-page PDF at out_path."""
    img = Image.open(background_path).convert("RGB")
    draw = ImageDraw.Draw(img)
    for f in fields:
        text = resolve_field_value(f.get("key", ""), item, shared)
        if not text:
            continue
        font = _load_font(int(f.get("size", 24)))
        color = f.get("color", "#000000")
        x = int(f.get("x", 0)); y = int(f.get("y", 0))
        ax = _anchor_x(draw, text, font, x, f.get("align", "center"))
        draw.text((ax, y), text, fill=color, font=font)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    img.save(out_path, "PDF", resolution=150.0)
    return out_path
```

- [ ] **Step 4: Run unit tests to verify pass**

Run: `python -m pytest tests/test_cert_generation.py -v`
Expected: PASS (all).

- [ ] **Step 5: Commit**
```bash
git add backend/cert_engine.py
git commit -m "feat(certs): pure Pillow->PDF generation engine"
```

---

### Task 3: Template CRUD + background PNG upload

**Files:**
- Modify: `backend/routes/cert_routes.py`
- Test: `backend/tests/test_cert_pipeline.py`

- [ ] **Step 1: Add failing test**

Append to `backend/tests/test_cert_pipeline.py`:
```python
import io
from PIL import Image

def _png_bytes(w=600, h=400):
    buf = io.BytesIO(); Image.new("RGB", (w, h), "white").save(buf, "PNG"); return buf.getvalue()


class TestTemplates:
    def test_upload_bg_then_create_template(self, admin):
        # upload background
        files = {"file": ("bg.png", _png_bytes(), "image/png")}
        up = admin.post(f"{BASE_URL}/api/certs/templates/background", files=files, timeout=30)
        assert up.status_code == 200, up.text
        url = up.json()["url"]
        assert "/uploads/certificates/" in url
        # create template
        body = {
            "name": f"TEST_TPL_{uuid.uuid4().hex[:5]}",
            "background_url": url, "orientation": "landscape",
            "width_px": 600, "height_px": 400,
            "fields": [{"key": "name", "x": 300, "y": 200, "size": 28,
                        "color": "#222222", "align": "center"}],
        }
        r = admin.post(f"{BASE_URL}/api/certs/templates", json=body, timeout=15)
        assert r.status_code in (200, 201), r.text
        tid = r.json()["template_id"]
        # appears in list
        lst = admin.get(f"{BASE_URL}/api/certs/templates", timeout=15).json()
        assert any(t["template_id"] == tid for t in lst)
```

- [ ] **Step 2: Run to verify failure**

Run: `DB_NAME=smartshape_test REACT_APP_BACKEND_URL=http://127.0.0.1:8000 python -m pytest tests/test_cert_pipeline.py::TestTemplates -v`
Expected: FAIL — 404 on `/certs/templates/background`.

- [ ] **Step 3: Implement upload + create + update + delete**

In `backend/routes/cert_routes.py` add imports at top:
```python
from fastapi import UploadFile, File
```
Append endpoints:
```python
@router.post("/templates/background")
async def upload_background(request: Request, file: UploadFile = File(...)):
    await get_current_user(request)
    ext = (file.filename.rsplit(".", 1)[-1] if "." in (file.filename or "") else "png").lower()
    if ext not in ("png", "jpg", "jpeg"):
        raise HTTPException(400, "Background must be PNG or JPG")
    fname = f"tpl_{uuid.uuid4().hex[:12]}.{ext}"
    path = os.path.join(CERT_DIR, fname)
    with open(path, "wb") as fh:
        fh.write(await file.read())
    return {"url": f"/uploads/certificates/{fname}", "filename": fname}


class TemplateField(BaseModel):
    key: str            # name | date | theme | expert
    x: int
    y: int
    size: int = 24
    color: str = "#000000"
    align: str = "center"   # left | center | right

class TemplateCreate(BaseModel):
    name: str
    background_url: str
    orientation: str = "landscape"
    width_px: int
    height_px: int
    fields: List[TemplateField]

@router.post("/templates")
async def create_template(body: TemplateCreate, request: Request):
    user = await get_current_user(request)
    require_admin(user)
    tid = gen_id("ctpl")
    doc = {"template_id": tid, **body.dict(), "is_active": True,
           "created_by": user.get("email"), "created_at": now_iso()}
    await db.cert_templates.insert_one(doc)
    return await db.cert_templates.find_one({"template_id": tid}, {"_id": 0})

@router.put("/templates/{template_id}")
async def update_template(template_id: str, request: Request):
    user = await get_current_user(request); require_admin(user)
    body = await request.json()
    safe = {k: v for k, v in body.items()
            if k in ("name", "background_url", "orientation", "width_px", "height_px", "fields", "is_active")}
    if safe:
        await db.cert_templates.update_one({"template_id": template_id}, {"$set": safe})
    return await db.cert_templates.find_one({"template_id": template_id}, {"_id": 0})

@router.delete("/templates/{template_id}")
async def delete_template(template_id: str, request: Request):
    user = await get_current_user(request); require_admin(user)
    await db.cert_templates.update_one({"template_id": template_id}, {"$set": {"is_active": False}})
    return {"ok": True}
```

- [ ] **Step 4: Run test (controller restarts backend) to verify pass**

Run: `DB_NAME=smartshape_test REACT_APP_BACKEND_URL=http://127.0.0.1:8000 python -m pytest tests/test_cert_pipeline.py::TestTemplates -v`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add backend/routes/cert_routes.py
git commit -m "feat(certs): template CRUD + background upload"
```

---

### Task 4: Batches + attendees (manual + session import)

**Files:**
- Modify: `backend/routes/cert_routes.py`
- Test: `backend/tests/test_cert_pipeline.py`

- [ ] **Step 1: Add failing tests**

Append to `backend/tests/test_cert_pipeline.py`:
```python
def _make_template(admin):
    files = {"file": ("bg.png", _png_bytes(), "image/png")}
    url = admin.post(f"{BASE_URL}/api/certs/templates/background", files=files, timeout=30).json()["url"]
    body = {"name": f"TPL_{uuid.uuid4().hex[:5]}", "background_url": url,
            "orientation": "landscape", "width_px": 600, "height_px": 400,
            "fields": [{"key": "name", "x": 300, "y": 200, "size": 28, "color": "#000", "align": "center"}]}
    return admin.post(f"{BASE_URL}/api/certs/templates", json=body, timeout=15).json()["template_id"]


class TestBatchesManual:
    def test_create_manual_batch_with_attendees(self, admin):
        tid = _make_template(admin)
        body = {
            "title": "TEST manual batch", "template_id": tid, "source": "manual",
            "shared_values": {"date": "2026-06-04", "theme": "Sales 101", "expert": "R. Verma"},
            "channels": ["whatsapp", "email"],
            "attendees": [
                {"name": "Amit Sharma", "phone": "9000000001", "email": "amit@example.com"},
                {"name": "Bina Rao", "phone": "9000000002", "email": "bina@example.com"},
            ],
        }
        r = admin.post(f"{BASE_URL}/api/certs/batches", json=body, timeout=20)
        assert r.status_code in (200, 201), r.text
        batch = r.json()
        bid = batch["batch_id"]
        assert batch["counts"]["total"] == 2
        detail = admin.get(f"{BASE_URL}/api/certs/batches/{bid}", timeout=15).json()
        assert len(detail["items"]) == 2
        assert {i["name"] for i in detail["items"]} == {"Amit Sharma", "Bina Rao"}


class TestBatchesSession:
    def test_import_from_session(self, admin):
        # seed a training session + registrations directly via DB
        import asyncio
        from database import db
        sid = f"sess_{uuid.uuid4().hex[:8]}"
        async def _seed():
            await db.session_registrations.insert_many([
                {"session_id": sid, "name": "Carl Dsouza", "phone": "9000000003", "email": "carl@example.com"},
                {"session_id": sid, "name": "Deepa Nair", "phone": "9000000004", "email": "deepa@example.com"},
            ])
        asyncio.run(_seed())
        tid = _make_template(admin)
        body = {"title": "TEST session batch", "template_id": tid, "source": "session",
                "session_id": sid,
                "shared_values": {"date": "2026-06-04", "theme": "T", "expert": "E"},
                "channels": ["email"]}
        r = admin.post(f"{BASE_URL}/api/certs/batches", json=body, timeout=20)
        assert r.status_code in (200, 201), r.text
        assert r.json()["counts"]["total"] == 2
```

- [ ] **Step 2: Run to verify failure**

Run: `DB_NAME=smartshape_test REACT_APP_BACKEND_URL=http://127.0.0.1:8000 python -m pytest tests/test_cert_pipeline.py::TestBatchesManual tests/test_cert_pipeline.py::TestBatchesSession -v`
Expected: FAIL — 404 on `/certs/batches`.

- [ ] **Step 3: Implement batch create + detail + add attendees**

Append to `backend/routes/cert_routes.py`:
```python
class Attendee(BaseModel):
    name: str
    phone: Optional[str] = ""
    email: Optional[str] = ""

class BatchCreate(BaseModel):
    title: str
    template_id: str
    source: str = "manual"            # manual | session
    session_id: Optional[str] = None
    shared_values: Dict[str, Any] = {}
    channels: List[str] = ["whatsapp", "email"]
    attendees: Optional[List[Attendee]] = None


def _new_item(batch_id: str, name: str, phone: str, email: str) -> dict:
    return {
        "item_id": gen_id("citem"), "batch_id": batch_id,
        "name": name, "phone": phone or "", "email": email or "",
        "pdf_url": None, "gen_status": "pending", "gen_error": None,
        "delivery": {
            "whatsapp": {"status": "pending", "at": None, "error": None},
            "email": {"status": "pending", "at": None, "error": None},
        },
        "created_at": now_iso(),
    }

@router.post("/batches")
async def create_batch(body: BatchCreate, request: Request):
    user = await get_current_user(request); require_admin(user)
    bid = gen_id("cbatch")
    # gather attendees
    rows: List[dict] = []
    if body.source == "session" and body.session_id:
        regs = await db.session_registrations.find({"session_id": body.session_id}, {"_id": 0}).to_list(1000)
        for r in regs:
            rows.append(_new_item(bid, r.get("name") or r.get("principal_name") or "",
                                  r.get("phone") or r.get("contact_phone") or "",
                                  r.get("email") or r.get("customer_email") or ""))
    else:
        for a in (body.attendees or []):
            rows.append(_new_item(bid, a.name, a.phone or "", a.email or ""))
    rows = [r for r in rows if r["name"].strip()]
    batch = {
        "batch_id": bid, "title": body.title, "template_id": body.template_id,
        "source": body.source, "session_id": body.session_id,
        "shared_values": body.shared_values, "channels": body.channels,
        "status": "draft",
        "counts": {"total": len(rows), "generated": 0, "sent_whatsapp": 0, "sent_email": 0, "failed": 0},
        "created_by": user.get("email"), "created_at": now_iso(),
    }
    await db.cert_batches.insert_one(batch)
    if rows:
        await db.cert_items.insert_many(rows)
    return await db.cert_batches.find_one({"batch_id": bid}, {"_id": 0})

@router.get("/batches")
async def list_batches(request: Request):
    await get_current_user(request)
    return await db.cert_batches.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)

@router.get("/batches/{batch_id}")
async def get_batch(batch_id: str, request: Request):
    await get_current_user(request)
    batch = await db.cert_batches.find_one({"batch_id": batch_id}, {"_id": 0})
    if not batch:
        raise HTTPException(404, "Batch not found")
    items = await db.cert_items.find({"batch_id": batch_id}, {"_id": 0}).to_list(2000)
    return {**batch, "items": items}

@router.post("/batches/{batch_id}/attendees")
async def add_attendees(batch_id: str, request: Request):
    user = await get_current_user(request); require_admin(user)
    body = await request.json()
    rows = [_new_item(batch_id, a.get("name", ""), a.get("phone", ""), a.get("email", ""))
            for a in body.get("attendees", []) if a.get("name", "").strip()]
    if rows:
        await db.cert_items.insert_many(rows)
        await db.cert_batches.update_one({"batch_id": batch_id}, {"$inc": {"counts.total": len(rows)}})
    return {"added": len(rows)}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `DB_NAME=smartshape_test REACT_APP_BACKEND_URL=http://127.0.0.1:8000 python -m pytest tests/test_cert_pipeline.py::TestBatchesManual tests/test_cert_pipeline.py::TestBatchesSession -v`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add backend/routes/cert_routes.py
git commit -m "feat(certs): batches + attendees (manual + session import)"
```

---

### Task 5: Generate endpoint + generation in cert_loop

**Files:**
- Modify: `backend/routes/cert_routes.py`, `backend/scheduler.py`
- Test: `backend/tests/test_cert_pipeline.py`

- [ ] **Step 1: Add failing test**

Append to `backend/tests/test_cert_pipeline.py`:
```python
class TestGenerate:
    def test_generate_produces_pdfs(self, admin):
        tid = _make_template(admin)
        body = {"title": "GEN", "template_id": tid, "source": "manual",
                "shared_values": {"date": "2026-06-04", "theme": "T", "expert": "E"},
                "channels": ["email"],
                "attendees": [{"name": "Amit Sharma", "email": "amit@example.com"}]}
        bid = admin.post(f"{BASE_URL}/api/certs/batches", json=body, timeout=20).json()["batch_id"]
        g = admin.post(f"{BASE_URL}/api/certs/batches/{bid}/generate", timeout=20)
        assert g.status_code == 200, g.text
        # generation runs in the cert_loop; trigger it synchronously via debug endpoint
        run = admin.post(f"{BASE_URL}/api/certs/_run-loop", timeout=120)
        assert run.status_code == 200, run.text
        detail = admin.get(f"{BASE_URL}/api/certs/batches/{bid}", timeout=15).json()
        it = detail["items"][0]
        assert it["gen_status"] == "generated", it
        assert it["pdf_url"] and "/uploads/certificates/" in it["pdf_url"]
```

- [ ] **Step 2: Run to verify failure**

Run: `DB_NAME=smartshape_test REACT_APP_BACKEND_URL=http://127.0.0.1:8000 python -m pytest tests/test_cert_pipeline.py::TestGenerate -v`
Expected: FAIL — 404 on `/certs/batches/{id}/generate`.

- [ ] **Step 3: Add generate endpoint + the processing function + debug runner**

In `backend/routes/cert_routes.py` append:
```python
@router.post("/batches/{batch_id}/generate")
async def generate_batch(batch_id: str, request: Request):
    user = await get_current_user(request); require_admin(user)
    await db.cert_batches.update_one({"batch_id": batch_id}, {"$set": {"status": "generating"}})
    return {"ok": True, "message": "Generation queued"}

@router.post("/_run-loop")
async def debug_run_loop(request: Request):
    """Admin-only: run one pass of the cert generation+delivery loop synchronously (tests/manual)."""
    user = await get_current_user(request); require_admin(user)
    from scheduler import run_cert_pass
    await run_cert_pass()
    return {"ok": True}
```

In `backend/scheduler.py` add near the FMS helpers:
```python
import os
from cert_engine import render_certificate_pdf, sanitize_filename

CERT_DRY_RUN = os.getenv("CERT_DRY_RUN", "0") == "1"
_CERT_DIR = os.path.join(os.path.dirname(__file__), "uploads", "certificates")
_PUBLIC_BASE = os.getenv("PUBLIC_BASE", "").rstrip("/")


async def _generate_pending_certs():
    batches = await db.cert_batches.find({"status": "generating"}, {"_id": 0}).to_list(100)
    for batch in batches:
        tpl = await db.cert_templates.find_one({"template_id": batch["template_id"]}, {"_id": 0})
        if not tpl:
            await db.cert_batches.update_one({"batch_id": batch["batch_id"]}, {"$set": {"status": "draft"}})
            continue
        bg_url = tpl.get("background_url", "")
        bg_file = bg_url.split("/uploads/certificates/")[-1] if "/uploads/certificates/" in bg_url else bg_url
        bg_path = os.path.join(_CERT_DIR, bg_file)
        items = await db.cert_items.find({"batch_id": batch["batch_id"], "gen_status": "pending"}, {"_id": 0}).to_list(2000)
        for it in items:
            out_name = f"{it['item_id']}.pdf"
            out_path = os.path.join(_CERT_DIR, out_name)
            try:
                render_certificate_pdf(bg_path, out_path, tpl.get("fields", []),
                                       {"name": it["name"]}, batch.get("shared_values", {}))
                await db.cert_items.update_one({"item_id": it["item_id"]}, {"$set": {
                    "gen_status": "generated", "pdf_url": f"/uploads/certificates/{out_name}"}})
                await db.cert_batches.update_one({"batch_id": batch["batch_id"]}, {"$inc": {"counts.generated": 1}})
            except Exception as e:
                await db.cert_items.update_one({"item_id": it["item_id"]}, {"$set": {
                    "gen_status": "failed", "gen_error": str(e)[:200]}})
                await db.cert_batches.update_one({"batch_id": batch["batch_id"]}, {"$inc": {"counts.failed": 1}})
        await db.cert_batches.update_one({"batch_id": batch["batch_id"]}, {"$set": {"status": "ready"}})


async def run_cert_pass():
    """One pass: generate pending, then deliver (delivery added in Task 6)."""
    await _generate_pending_certs()
    await _deliver_pending_certs()   # defined in Task 6


async def _deliver_pending_certs():
    return  # implemented in Task 6
```

- [ ] **Step 4: Run test (controller restarts) to verify pass**

Run: `DB_NAME=smartshape_test REACT_APP_BACKEND_URL=http://127.0.0.1:8000 python -m pytest tests/test_cert_pipeline.py::TestGenerate -v`
Expected: PASS — item `generated`, `pdf_url` set. Local gate first: `python -c "import scheduler"` exits 0.

- [ ] **Step 5: Commit**
```bash
git add backend/routes/cert_routes.py backend/scheduler.py
git commit -m "feat(certs): generation pass (Pillow->PDF) via cert loop"
```

---

### Task 6: Delivery (WhatsApp + email) — idempotent + send endpoint + loop wiring

**Files:**
- Modify: `backend/scheduler.py`, `backend/routes/cert_routes.py`
- Test: `backend/tests/test_cert_pipeline.py`

- [ ] **Step 1: Add failing test**

Append to `backend/tests/test_cert_pipeline.py`:
```python
class TestDeliveryDedupe:
    def test_send_is_idempotent(self, admin):
        tid = _make_template(admin)
        body = {"title": "SEND", "template_id": tid, "source": "manual",
                "shared_values": {"date": "2026-06-04", "theme": "T", "expert": "E"},
                "channels": ["whatsapp", "email"],
                "attendees": [{"name": "Amit Sharma", "phone": "9000000001", "email": "amit@example.com"}]}
        bid = admin.post(f"{BASE_URL}/api/certs/batches", json=body, timeout=20).json()["batch_id"]
        admin.post(f"{BASE_URL}/api/certs/batches/{bid}/generate", timeout=20)
        admin.post(f"{BASE_URL}/api/certs/_run-loop", timeout=120)            # generate
        admin.post(f"{BASE_URL}/api/certs/batches/{bid}/send", timeout=20)
        admin.post(f"{BASE_URL}/api/certs/_run-loop", timeout=120)            # deliver pass 1
        admin.post(f"{BASE_URL}/api/certs/_run-loop", timeout=120)            # deliver pass 2
        it = admin.get(f"{BASE_URL}/api/certs/batches/{bid}", timeout=15).json()["items"][0]
        # dry-run: both channels sent exactly once (status sent, no error)
        assert it["delivery"]["whatsapp"]["status"] == "sent", it
        assert it["delivery"]["email"]["status"] == "sent", it
        # counts not double-incremented
        b = admin.get(f"{BASE_URL}/api/certs/batches/{bid}", timeout=15).json()
        assert b["counts"]["sent_whatsapp"] == 1
        assert b["counts"]["sent_email"] == 1
```

- [ ] **Step 2: Run to verify failure**

Run: `DB_NAME=smartshape_test REACT_APP_BACKEND_URL=http://127.0.0.1:8000 python -m pytest tests/test_cert_pipeline.py::TestDeliveryDedupe -v`
Expected: FAIL — 404 on `/certs/batches/{id}/send` (and delivery is a no-op stub).

- [ ] **Step 3: Implement email-attachment helper + delivery**

In `backend/scheduler.py`, add the attachment email helper near `_smtp_send`:
```python
def _smtp_send_attachment(sender_email, app_password, sender_name, to_email,
                          subject, body, file_path, filename):
    from email.mime.base import MIMEBase
    from email import encoders
    msg = MIMEMultipart()
    msg["From"] = f"{sender_name} <{sender_email}>"
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.attach(MIMEText(body, "plain"))
    with open(file_path, "rb") as fh:
        part = MIMEBase("application", "pdf")
        part.set_payload(fh.read())
    encoders.encode_base64(part)
    part.add_header("Content-Disposition", f'attachment; filename="{filename}"')
    msg.attach(part)
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=30) as smtp:
        smtp.login(sender_email, app_password)
        smtp.sendmail(sender_email, [to_email], msg.as_string())
```

Replace the `_deliver_pending_certs` stub from Task 5 with:
```python
async def _deliver_pending_certs():
    batches = await db.cert_batches.find({"status": {"$in": ["sending", "ready"]}}, {"_id": 0}).to_list(100)
    for batch in batches:
        if batch.get("status") != "sending":
            continue
        channels = batch.get("channels", [])
        items = await db.cert_items.find(
            {"batch_id": batch["batch_id"], "gen_status": "generated"}, {"_id": 0}).to_list(2000)
        for it in items:
            for ch in channels:
                d = (it.get("delivery") or {}).get(ch, {})
                if d.get("status") == "sent":
                    continue   # idempotent: never resend
                ok, err = await _cert_send_one(ch, it, batch)
                if ok is None:
                    new_status = "skipped"
                elif ok:
                    new_status = "sent"
                else:
                    new_status = "failed"
                await db.cert_items.update_one({"item_id": it["item_id"]},
                    {"$set": {f"delivery.{ch}.status": new_status,
                              f"delivery.{ch}.at": datetime.now(timezone.utc).isoformat(),
                              f"delivery.{ch}.error": err}})
                if new_status == "sent":
                    field = "sent_whatsapp" if ch == "whatsapp" else "sent_email"
                    await db.cert_batches.update_one({"batch_id": batch["batch_id"]},
                                                     {"$inc": {f"counts.{field}": 1}})
        await db.cert_batches.update_one({"batch_id": batch["batch_id"]}, {"$set": {"status": "done"}})


async def _cert_send_one(channel: str, it: dict, batch: dict):
    """Returns (ok, err): ok True=sent, False=failed, None=skipped (no contact)."""
    fname = f"certificate_{sanitize_filename(it['name'])}.pdf"
    pdf_url = it.get("pdf_url", "")
    local_pdf = os.path.join(_CERT_DIR, pdf_url.split("/uploads/certificates/")[-1]) if pdf_url else ""
    caption = f"Certificate — {batch.get('shared_values', {}).get('theme', '')}".strip()
    if channel == "whatsapp":
        if not it.get("phone"):
            return None, "no_phone"
        if CERT_DRY_RUN:
            log.info(f"[cert][dry] WA doc -> {it['phone']}: {fname}")
            return True, None
        try:
            full_url = f"{_PUBLIC_BASE}{pdf_url}" if _PUBLIC_BASE else pdf_url
            await evolution.send_document(it["phone"], full_url, fname, caption)
            return True, None
        except Exception as e:
            return False, str(e)[:200]
    if channel == "email":
        if not it.get("email") or "@" not in it["email"]:
            return None, "no_email"
        if CERT_DRY_RUN:
            log.info(f"[cert][dry] EMAIL -> {it['email']}: {fname}")
            return True, None
        cfg = await _email_cfg()
        if not cfg:
            return False, "email_not_configured"
        se, ap, sn = cfg
        try:
            await asyncio.to_thread(_smtp_send_attachment, se, ap, sn, it["email"],
                                    "Your Certificate", "Please find your certificate attached.",
                                    local_pdf, fname)
            return True, None
        except Exception as e:
            return False, str(e)[:200]
    return None, "unknown_channel"
```

Add the `send` endpoint in `cert_routes.py`:
```python
@router.post("/batches/{batch_id}/send")
async def send_batch(batch_id: str, request: Request):
    user = await get_current_user(request); require_admin(user)
    await db.cert_batches.update_one({"batch_id": batch_id}, {"$set": {"status": "sending"}})
    return {"ok": True, "message": "Delivery queued"}
```

- [ ] **Step 4: Run test (controller restarts, CERT_DRY_RUN=1) to verify pass**

Local gate: `python -c "import scheduler"` exits 0. Then:
Run: `DB_NAME=smartshape_test REACT_APP_BACKEND_URL=http://127.0.0.1:8000 python -m pytest tests/test_cert_pipeline.py::TestDeliveryDedupe -v`
Expected: PASS — both channels `sent` once; counts == 1 after two passes.

- [ ] **Step 5: Commit**
```bash
git add backend/scheduler.py backend/routes/cert_routes.py
git commit -m "feat(certs): idempotent WhatsApp+email delivery"
```

---

### Task 7: Wire cert_loop into startup + preview endpoint

**Files:**
- Modify: `backend/scheduler.py`, `backend/routes/cert_routes.py`
- Test: `backend/tests/test_cert_pipeline.py`

- [ ] **Step 1: Add failing test for preview**

Append to `backend/tests/test_cert_pipeline.py`:
```python
class TestPreview:
    def test_preview_returns_pdf(self, admin):
        tid = _make_template(admin)
        body = {"title": "PREV", "template_id": tid, "source": "manual",
                "shared_values": {"date": "2026-06-04", "theme": "T", "expert": "E"},
                "channels": ["email"],
                "attendees": [{"name": "Amit Sharma", "email": "a@example.com"}]}
        bid = admin.post(f"{BASE_URL}/api/certs/batches", json=body, timeout=20).json()["batch_id"]
        item_id = admin.get(f"{BASE_URL}/api/certs/batches/{bid}", timeout=15).json()["items"][0]["item_id"]
        r = admin.get(f"{BASE_URL}/api/certs/items/{item_id}/preview", timeout=30)
        assert r.status_code == 200, r.text
        assert r.content[:4] == b"%PDF"
```

- [ ] **Step 2: Run to verify failure**

Run: `DB_NAME=smartshape_test REACT_APP_BACKEND_URL=http://127.0.0.1:8000 python -m pytest tests/test_cert_pipeline.py::TestPreview -v`
Expected: FAIL — 404 on preview.

- [ ] **Step 3: Implement preview + wire loop**

In `cert_routes.py` add:
```python
from fastapi.responses import FileResponse
import tempfile

@router.get("/items/{item_id}/preview")
async def preview_item(item_id: str, request: Request):
    await get_current_user(request)
    it = await db.cert_items.find_one({"item_id": item_id}, {"_id": 0})
    if not it:
        raise HTTPException(404, "Item not found")
    batch = await db.cert_batches.find_one({"batch_id": it["batch_id"]}, {"_id": 0}) or {}
    tpl = await db.cert_templates.find_one({"template_id": batch.get("template_id")}, {"_id": 0})
    if not tpl:
        raise HTTPException(404, "Template not found")
    from cert_engine import render_certificate_pdf
    bg_url = tpl.get("background_url", "")
    bg_file = bg_url.split("/uploads/certificates/")[-1] if "/uploads/certificates/" in bg_url else bg_url
    bg_path = os.path.join(CERT_DIR, bg_file)
    out_path = os.path.join(tempfile.gettempdir(), f"preview_{item_id}.pdf")
    render_certificate_pdf(bg_path, out_path, tpl.get("fields", []),
                           {"name": it["name"]}, batch.get("shared_values", {}))
    return FileResponse(out_path, media_type="application/pdf", filename="preview.pdf")
```

In `backend/scheduler.py`, add the loop runner and wire it into `start_scheduler`:
```python
async def cert_loop():
    log.info("[scheduler] cert loop started (interval: 30s)")
    while True:
        try:
            await run_cert_pass()
        except Exception as exc:
            log.error(f"[cert loop] {exc}")
        await asyncio.sleep(30)
```
In `start_scheduler` add:
```python
    asyncio.create_task(cert_loop())
    log.info("[scheduler] cert loop running")
```

- [ ] **Step 4: Run test to verify pass**

Run: `DB_NAME=smartshape_test REACT_APP_BACKEND_URL=http://127.0.0.1:8000 python -m pytest tests/test_cert_pipeline.py::TestPreview -v`
Expected: PASS.

- [ ] **Step 5: Run the FULL cert backend suite (regression)**

Run: `python -m pytest tests/test_cert_generation.py -v` (unit) and
`DB_NAME=smartshape_test REACT_APP_BACKEND_URL=http://127.0.0.1:8000 python -m pytest tests/test_cert_pipeline.py -v` (integration)
Expected: all PASS.

- [ ] **Step 6: Commit**
```bash
git add backend/scheduler.py backend/routes/cert_routes.py
git commit -m "feat(certs): item preview + cert_loop wired into startup"
```

---

# PHASE 2 — Frontend

### Task 8: API client + hook + page shell + nav

**Files:**
- Modify: `frontend/src/lib/api.js`, the admin nav, `frontend/src/App.js` (route)
- Create: `frontend/src/hooks/useCertificates.js`, `frontend/src/pages/admin/Certificates.js`

- [ ] **Step 1: Read existing patterns**

Read `frontend/src/lib/api.js` (see how `fms` API object is structured), `frontend/src/hooks/useFlowManagement.js` (hook pattern), `frontend/src/pages/admin/FlowManagement.js` (page pattern), and how routes/nav register an admin page (search `FlowManagement` in `frontend/src/App.js` and the admin nav component). Match these patterns exactly.

- [ ] **Step 2: Add the `certs` API client**

In `frontend/src/lib/api.js`, add a `certs` object mirroring the `fms` one:
```javascript
export const certsApi = {
  listTemplates: () => api.get('/certs/templates'),
  uploadBackground: (formData) => api.post('/certs/templates/background', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  createTemplate: (body) => api.post('/certs/templates', body),
  updateTemplate: (id, body) => api.put(`/certs/templates/${id}`, body),
  deleteTemplate: (id) => api.delete(`/certs/templates/${id}`),
  listBatches: () => api.get('/certs/batches'),
  getBatch: (id) => api.get(`/certs/batches/${id}`),
  createBatch: (body) => api.post('/certs/batches', body),
  addAttendees: (id, attendees) => api.post(`/certs/batches/${id}/attendees`, { attendees }),
  generate: (id) => api.post(`/certs/batches/${id}/generate`, {}),
  send: (id) => api.post(`/certs/batches/${id}/send`, {}),
  previewUrl: (itemId) => `${api.defaults.baseURL}/certs/items/${itemId}/preview`,
};
```
(Adapt `api.defaults.baseURL` access to however the existing client exposes the base URL.)

- [ ] **Step 3: Create the hook**

Create `frontend/src/hooks/useCertificates.js` following `useFlowManagement.js`'s structure: state for `templates`, `batches`, `currentBatch`; loaders (`loadTemplates`, `loadBatches`, `loadBatch`); actions (`saveTemplate`, `createBatch`, `generate`, `send`, `addAttendees`). Use `certsApi`. Return them.

- [ ] **Step 4: Create the page shell + register route/nav**

Create `frontend/src/pages/admin/Certificates.js` with tabs "Templates" and "Batches" (use the same tab component the codebase already uses). Register the route in `frontend/src/App.js` next to the FlowManagement route, and add a nav entry in the admin nav component the same way FlowManagement is added (admin-only).

- [ ] **Step 5: Verify build sanity**

Re-read changed files for balanced JSX and present imports. (Do not run `npm run build`.) If an eslint binary is available: `npx eslint src/hooks/useCertificates.js src/pages/admin/Certificates.js src/lib/api.js`.

- [ ] **Step 6: Commit**
```bash
git add frontend/src/lib/api.js frontend/src/hooks/useCertificates.js frontend/src/pages/admin/Certificates.js frontend/src/App.js
# plus the nav component you edited
git commit -m "feat(certs): frontend API client, hook, page shell, route+nav"
```

---

### Task 9: Template designer (drag-to-position)

**Files:**
- Create: `frontend/src/components/certs/TemplateDesigner.js`
- Modify: `frontend/src/pages/admin/Certificates.js`

- [ ] **Step 1: Build the designer component**

Create `frontend/src/components/certs/TemplateDesigner.js`:
- Upload a PNG (calls `certsApi.uploadBackground`), then render it inside a fixed-width container (e.g. 800px) with the image displayed at a known display width; compute `scale = naturalWidth / displayWidth` so dropped positions map back to image pixels.
- Render one draggable marker per field (`name`, `date`, `theme`, `expert`). On drag end, capture the marker's position relative to the image and store `x = Math.round(displayX * scale)`, `y = Math.round(displayY * scale)`.
- Per-field controls: font size (number), color (color input), align (select left/center/right).
- "Save Template" calls `certsApi.createTemplate` with `{name, background_url, orientation, width_px: naturalWidth, height_px: naturalHeight, fields}`.

Implementation note: a simple approach is absolute-positioned `<div>` markers over a `position:relative` image wrapper, using `onMouseDown`/`onMouseMove`/`onMouseUp` (or a small lib already in the project if present) to update each marker's left/top. Keep numeric x/y inputs visible too, so positioning works even if drag is fiddly.

- [ ] **Step 2: Wire into the page**

In `Certificates.js`, render `TemplateDesigner` under the "Templates" tab, plus a list of existing templates (from the hook) with edit/delete.

- [ ] **Step 3: Verify build sanity**

Re-read for correctness (scale math, event cleanup on mouseup). Optional eslint on the new file.

- [ ] **Step 4: Manual verification (controller)**

The controller will load the running app, upload a PNG, drag the `name` field, save, and confirm the template persists with sensible x/y. (Implementer does not run the app.)

- [ ] **Step 5: Commit**
```bash
git add frontend/src/components/certs/TemplateDesigner.js frontend/src/pages/admin/Certificates.js
git commit -m "feat(certs): drag-to-position template designer"
```

---

### Task 10: Batch creator + detail (generate/preview/send/status)

**Files:**
- Create: `frontend/src/components/certs/BatchCreator.js`, `frontend/src/components/certs/BatchDetail.js`
- Modify: `frontend/src/pages/admin/Certificates.js`

- [ ] **Step 1: Build BatchCreator**

`BatchCreator.js`: select a template; choose source — "Training Session" (dropdown loaded from `GET /api/training/sessions`, then it imports registrations on submit) or "Manual/CSV" (a textarea parsed as `name,phone,email` per line); inputs for `date`, `theme`, `expert`; channel checkboxes (WhatsApp, Email). Submit calls `certsApi.createBatch`.

- [ ] **Step 2: Build BatchDetail**

`BatchDetail.js`: shows batch status + counts; buttons **Generate** (`certsApi.generate`) and **Send** (`certsApi.send`, enabled once status is `ready`); a table of items with name, gen status, WhatsApp status, email status, and a "Preview" link opening `certsApi.previewUrl(itemId)` in a new tab. Poll `getBatch` every few seconds while status is `generating`/`sending` to reflect progress.

- [ ] **Step 3: Wire into the page**

In `Certificates.js` "Batches" tab: list batches; "New Batch" opens `BatchCreator`; clicking a batch opens `BatchDetail`.

- [ ] **Step 4: Verify build sanity**

Re-read for correctness; optional eslint.

- [ ] **Step 5: Manual verification (controller)**

Controller loads the app, creates a manual batch with 1–2 attendees, clicks Generate then Send (backend in `CERT_DRY_RUN`), confirms statuses move to generated/sent and Preview renders a PDF.

- [ ] **Step 6: Commit**
```bash
git add frontend/src/components/certs/BatchCreator.js frontend/src/components/certs/BatchDetail.js frontend/src/pages/admin/Certificates.js
git commit -m "feat(certs): batch creator + detail (generate/preview/send/status)"
```

---

## Final verification
- [ ] Unit: `python -m pytest tests/test_cert_generation.py -v` — all PASS.
- [ ] Integration: `DB_NAME=smartshape_test REACT_APP_BACKEND_URL=http://127.0.0.1:8000 python -m pytest tests/test_cert_pipeline.py -v` — all PASS.
- [ ] Backend startup logs show the cert loop running (and total job count incremented).
- [ ] Confirm `PUBLIC_BASE` is documented as a deploy requirement (so WhatsApp can fetch PDFs by URL), and that `backend/uploads/certificates/` is gitignored.
- [ ] Single-worker constraint noted: `cert_loop` (like the FMS SLA loop) must run in one process to avoid double-processing.

## Self-review notes (author)
- **Spec coverage:** templates+upload (Task 3), batches manual+session (Task 4), generation Pillow→PDF (Tasks 2,5), idempotent WhatsApp+email delivery (Task 6), preview (Task 7), background loop (Tasks 5–7), frontend designer+batch UI (Tasks 8–10), indexes+static mount (Task 1). All spec sections mapped.
- **Type/name consistency:** `render_certificate_pdf(background_path, out_path, fields, item, shared)` defined in Task 2 and called identically in Tasks 5 and 7. `run_cert_pass`/`_deliver_pending_certs` declared in Task 5 (stub) and implemented in Task 6. `cert_items.delivery[channel].status` written in Task 6 matches the model created in Task 4. `_CERT_DIR`/`CERT_DIR` both point at `uploads/certificates`.
- **Dry-run:** delivery honors `CERT_DRY_RUN=1` so integration tests never send real WhatsApp/email.
- **Spec deviation (intentional):** spec said template background reuses `/api/upload` (object storage); plan instead stores PNG + PDFs on local disk under `uploads/certificates/` and serves via a static mount, mirroring the existing `/uploads/whatsapp` pattern — avoids coupling to the monolithic `server.py` object-storage helper and lets Pillow read the PNG directly.
