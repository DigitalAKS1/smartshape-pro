# Certificate PDF Drag-Designer + Per-Field Fonts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Steps use `- [ ]`.

**Goal:** Drag-position each certificate variable on a PDF template and pick font family/size/color per variable (overlay onto the real PDF via PyMuPDF); add font-family to the PNG flow; keep token-merge as a fallback.

**Architecture:** Bundle a curated TTF set in `backend/fonts/`; extend `cert_engine` with a font registry, a font-aware PNG overlay, and a new `render_certificate_pdf_overlay` (PyMuPDF `insert_text` with embedded fonts, designer-px→PDF-pt mapping). Add a PDF→preview-image endpoint so the existing drag `TemplateDesigner` can place fields over a PDF; route generation by `kind` + presence of `fields`.

**Tech Stack:** Python, PyMuPDF (fitz, already a dep), Pillow, FastAPI, React (CRA). Fonts: Roboto, Open Sans, Montserrat, Lato, Merriweather, Playfair Display, Great Vibes, Dancing Script (+ Default).

---

## Reference
Spec: `docs/superpowers/specs/2026-06-10-cert-pdf-font-designer-design.md`. Branch `feat/cert-font-designer` (worktree `.claude/worktrees/certfont`). Controller runs ONE local backend (`DB_NAME=smartshape_test FMS_NOTIFY_DRY_RUN=1 CERT_DRY_RUN=1 uvicorn ... :8000`, no `--reload`) + frontend (`:3000`). `tests/` is gitignored — commit impl only. Trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## File structure
- **Create** `backend/fonts/*.ttf` (curated, committed) + `backend/fonts/README.md` (sources/licenses).
- **Modify** `backend/cert_engine.py` — font registry (`FONT_DIR/FONT_REGISTRY/font_path/font_families`), `_load_font(size, family)`, font-aware `render_certificate_pdf`, new `render_certificate_pdf_overlay`.
- **Modify** `backend/routes/cert_routes.py` — `TemplateField.font`; `TemplateCreate` pdf fields/preview_url/dims; `POST /certs/templates/pdf-preview`; `GET /certs/fonts`; preview-render routing.
- **Modify** `backend/scheduler.py` — import + generation routing for pdf-with-fields.
- **Modify** `frontend/src/lib/api.js` — `listFonts`, `uploadPdfPreview`.
- **Modify** `frontend/src/components/certs/TemplateDesigner.js` — font dropdown per field + Google-Fonts `<link>`.
- **Modify** `frontend/src/components/certs/PdfTemplateUploader.js` + `pages/admin/Certificates.js` — PDF→designer flow.
- **Test** `backend/tests/test_cert_fonts.py` (unit), `backend/tests/test_cert_pdf_overlay.py` (integration).

---

### Task 1: Bundle fonts + font registry

**Files:** Create `backend/fonts/` (ttf files committed); Modify `backend/cert_engine.py`; Test `backend/tests/test_cert_fonts.py`

- [ ] **Step 1: Place the curated TTFs in `backend/fonts/`** (controller fetches working static TTFs; one file per family):
  `Roboto-Regular.ttf, OpenSans-Regular.ttf, Montserrat-Regular.ttf, Lato-Regular.ttf, Merriweather-Regular.ttf, PlayfairDisplay-Regular.ttf, GreatVibes-Regular.ttf, DancingScript-Regular.ttf`. Add `backend/fonts/README.md` noting each is OFL/Apache from Google Fonts. Verify each loads: `python -c "from PIL import ImageFont; ImageFont.truetype('backend/fonts/Roboto-Regular.ttf', 24); print('ok')"` for each.

- [ ] **Step 2: Write failing unit test** — `backend/tests/test_cert_fonts.py`:
```python
import os
from cert_engine import font_path, font_families, _load_font, FONT_REGISTRY

class TestFontRegistry:
    def test_families_includes_curated_and_default(self):
        fams = font_families()
        assert "Default" in fams
        for f in ["Roboto", "Open Sans", "Montserrat", "Lato", "Merriweather",
                  "Playfair Display", "Great Vibes", "Dancing Script"]:
            assert f in fams, f

    def test_font_path_resolves_bundled_ttf(self):
        p = font_path("Great Vibes")
        assert p and p.endswith(".ttf") and os.path.isfile(p)

    def test_default_font_path_is_none(self):
        assert font_path("Default") is None
        assert font_path("Nonexistent") is None

    def test_load_font_with_family(self):
        f = _load_font(40, "Playfair Display")
        assert f is not None  # a FreeTypeFont
```

- [ ] **Step 3: Run → FAIL** `python -m pytest tests/test_cert_fonts.py -v` (no `font_path`).

- [ ] **Step 4: Implement registry in `cert_engine.py`** (after the `_FONT_CANDIDATES`/`_load_font` block, replace `_load_font`):
```python
FONT_DIR = os.path.join(os.path.dirname(__file__), "fonts")
FONT_REGISTRY = {
    "Roboto": "Roboto-Regular.ttf",
    "Open Sans": "OpenSans-Regular.ttf",
    "Montserrat": "Montserrat-Regular.ttf",
    "Lato": "Lato-Regular.ttf",
    "Merriweather": "Merriweather-Regular.ttf",
    "Playfair Display": "PlayfairDisplay-Regular.ttf",
    "Great Vibes": "GreatVibes-Regular.ttf",
    "Dancing Script": "DancingScript-Regular.ttf",
}

def font_families():
    return ["Default"] + list(FONT_REGISTRY.keys())

def font_path(family):
    fn = FONT_REGISTRY.get(family or "")
    if not fn:
        return None
    p = os.path.join(FONT_DIR, fn)
    return p if os.path.isfile(p) else None

def _load_font(size: int, family: str = "Default") -> ImageFont.FreeTypeFont:
    fp = font_path(family)
    if fp:
        try:
            return ImageFont.truetype(fp, size)
        except Exception:
            pass
    for p in _FONT_CANDIDATES:
        if os.path.isfile(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return ImageFont.load_default()
```

- [ ] **Step 5: Run → PASS.** **Step 6: Commit** `git add backend/fonts backend/cert_engine.py && git commit -m "feat(certs): bundled font registry + font-aware _load_font"`.

---

### Task 2: PDF overlay engine + font-aware PNG overlay

**Files:** Modify `backend/cert_engine.py`; Test `backend/tests/test_cert_pdf_overlay.py`

- [ ] **Step 1: Failing unit test** — `backend/tests/test_cert_pdf_overlay.py`:
```python
import os, tempfile, fitz
from cert_engine import render_certificate_pdf_overlay

def _make_pdf(path, w=842, h=595):  # A4 landscape pts
    d = fitz.open(); d.new_page(width=w, height=h); d.save(path); d.close()

class TestPdfOverlay:
    def test_overlay_writes_valid_pdf_with_text(self):
        with tempfile.TemporaryDirectory() as t:
            src = os.path.join(t, "tpl.pdf"); out = os.path.join(t, "out.pdf")
            _make_pdf(src)
            # designer raster was 1754x1240 px (150dpi of A4 landscape)
            fields = [
                {"key": "name", "x": 877, "y": 500, "size": 60, "color": "#1a1a1a",
                 "align": "center", "font": "Great Vibes"},
                {"key": "theme", "x": 200, "y": 800, "size": 30, "color": "#444444",
                 "align": "left", "font": "Default"},
            ]
            render_certificate_pdf_overlay(src, out, fields,
                {"name": "Amit Sharma"}, {"theme": "Sales 101", "date": "2026-06-10", "expert": "R.V."},
                1754, 1240)
            assert os.path.isfile(out)
            with open(out, "rb") as f: assert f.read(4) == b"%PDF"
            txt = "".join(p.get_text() for p in fitz.open(out))
            assert "Amit Sharma" in txt and "Sales 101" in txt
```

- [ ] **Step 2: Run → FAIL** (`render_certificate_pdf_overlay` missing).

- [ ] **Step 3: Implement in `cert_engine.py`** (append after `render_certificate_pdf_merge`):
```python
def _hex_rgb(c):
    c = (c or "#000000").lstrip("#")
    if len(c) == 3: c = "".join(ch*2 for ch in c)
    try:
        return (int(c[0:2],16)/255, int(c[2:4],16)/255, int(c[4:6],16)/255)
    except Exception:
        return (0, 0, 0)

def render_certificate_pdf_overlay(template_pdf_path, out_path, fields,
                                   item, shared, design_w, design_h) -> str:
    """Overlay drag-positioned fields onto a PDF template (page 0) using PyMuPDF.
    design_w/design_h = pixel size of the raster the designer placed fields on."""
    import fitz
    doc = fitz.open(template_pdf_path)
    try:
        page = doc[0]
        pw, ph = page.rect.width, page.rect.height
        sx = pw / float(design_w or pw)
        sy = ph / float(design_h or ph)
        for f in (fields or []):
            val = resolve_field_value(f.get("key", ""), item, shared)
            if not val:
                continue
            pt = max(4.0, float(f.get("size", 24)) * sx)
            fp = font_path(f.get("font", "Default"))
            alias = "f_" + re.sub(r"[^a-z0-9]", "", (f.get("font", "default")).lower())
            try:
                tw = (fitz.Font(fontfile=fp).text_length(val, pt) if fp
                      else fitz.get_text_length(val, fontname="helv", fontsize=pt))
            except Exception:
                tw = 0.0
            px = float(f.get("x", 0)) * sx
            align = f.get("align", "center")
            ax = px - tw / 2 if align == "center" else (px - tw if align == "right" else px)
            baseline = float(f.get("y", 0)) * sy + pt   # top-left designer y -> PDF baseline
            rgb = _hex_rgb(f.get("color"))
            try:
                if fp:
                    page.insert_text((ax, baseline), val, fontsize=pt, fontfile=fp,
                                     fontname=alias, color=rgb)
                else:
                    page.insert_text((ax, baseline), val, fontsize=pt, fontname="helv", color=rgb)
            except Exception:
                page.insert_text((ax, baseline), val, fontsize=pt, fontname="helv", color=rgb)
        os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
        doc.save(out_path, garbage=3, deflate=True)
    finally:
        doc.close()
    return out_path
```

- [ ] **Step 4: Make `render_certificate_pdf` font-aware** — change line `font = _load_font(int(f.get("size", 24)))` to `font = _load_font(int(f.get("size", 24)), f.get("font", "Default"))`.

- [ ] **Step 5: Run → PASS** (`python -m pytest tests/test_cert_pdf_overlay.py tests/test_cert_fonts.py -v`). **Step 6: Commit** (`backend/cert_engine.py`) `feat(certs): PDF overlay engine + font-aware PNG overlay`.

---

### Task 3: Backend — model, pdf-preview, fonts endpoint, generation routing

**Files:** Modify `backend/routes/cert_routes.py`, `backend/scheduler.py`; Test `backend/tests/test_cert_pdf_designer.py`

- [ ] **Step 1: Failing integration test** — `backend/tests/test_cert_pdf_designer.py` (admin fixture as in existing cert tests; backend on :8000):
```python
import os, io, uuid, pytest, requests, fitz
BASE=os.environ.get("REACT_APP_BACKEND_URL","http://127.0.0.1:8000").rstrip("/")
@pytest.fixture(scope="session")
def admin():
    s=requests.Session()
    r=s.post(f"{BASE}/api/auth/login",json={"email":"info@smartshape.in","password":"admin123"},timeout=15)
    assert r.status_code==200,r.text
    for c in r.cookies: s.cookies.set(c.name,c.value,domain=c.domain or "127.0.0.1",path=c.path or "/")
    return s
def _pdf_bytes():
    d=fitz.open(); d.new_page(width=842,height=595); b=d.tobytes(); d.close(); return b
class TestPdfDesigner:
    def test_fonts_endpoint(self, admin):
        r=admin.get(f"{BASE}/api/certs/fonts",timeout=15); assert r.status_code==200
        assert "Great Vibes" in r.json()["families"]
    def test_pdf_preview_then_template_then_generate(self, admin):
        up=admin.post(f"{BASE}/api/certs/templates/pdf-preview",
            files={"file":("t.pdf",_pdf_bytes(),"application/pdf")},timeout=30)
        assert up.status_code==200,up.text; j=up.json()
        assert "/uploads/certificates/" in j["pdf_url"] and "/uploads/certificates/" in j["preview_url"]
        assert j["width_px"]>0 and j["height_px"]>0
        tpl=admin.post(f"{BASE}/api/certs/templates",json={
            "name":f"PDF_{uuid.uuid4().hex[:5]}","kind":"pdf","background_url":j["pdf_url"],
            "preview_url":j["preview_url"],"width_px":j["width_px"],"height_px":j["height_px"],
            "fields":[{"key":"name","x":int(j["width_px"]/2),"y":300,"size":48,"color":"#111","align":"center","font":"Great Vibes"}],
        },timeout=15).json(); tid=tpl["template_id"]
        b=admin.post(f"{BASE}/api/certs/batches",json={"title":"PDFGEN","template_id":tid,"source":"manual",
            "shared_values":{"date":"2026-06-10","theme":"T","expert":"E"},"channels":["email"],
            "attendees":[{"name":"Amit Sharma","email":"a@x.com"}]},timeout=20).json()["batch_id"]
        admin.post(f"{BASE}/api/certs/batches/{b}/generate",timeout=20)
        admin.post(f"{BASE}/api/certs/_run-loop",timeout=120)
        it=admin.get(f"{BASE}/api/certs/batches/{b}",timeout=15).json()["items"][0]
        assert it["gen_status"]=="generated",it
```

- [ ] **Step 2: Run → FAIL** (404 on `/certs/fonts` & `/certs/templates/pdf-preview`).

- [ ] **Step 3: `cert_routes.py` — add `font` to `TemplateField`, pdf fields/preview to `TemplateCreate`:**
```python
class TemplateField(BaseModel):
    key: str
    x: int
    y: int
    size: int = 24
    color: str = "#000000"
    align: str = "center"
    font: str = "Default"
```
In `TemplateCreate` add `preview_url: Optional[str] = ""` (keep existing `kind/width_px/height_px/fields`). Extend the create whitelist to include `"preview_url"`.

- [ ] **Step 4: Add `GET /certs/fonts` + `POST /certs/templates/pdf-preview`** (near `upload_background`):
```python
@router.get("/fonts")
async def list_fonts(request: Request):
    await get_current_user(request)
    from cert_engine import font_families
    return {"families": font_families()}

@router.post("/templates/pdf-preview")
async def pdf_preview(request: Request, file: UploadFile = File(...)):
    await get_current_user(request)
    import fitz
    data = await file.read()
    pdf_name = f"tpl_{uuid.uuid4().hex[:12]}.pdf"
    pdf_path = os.path.join(CERT_DIR, pdf_name)
    with open(pdf_path, "wb") as fh: fh.write(data)
    doc = fitz.open(pdf_path)
    try:
        page = doc[0]
        pix = page.get_pixmap(dpi=150)
        prev_name = pdf_name[:-4] + "_preview.png"
        pix.save(os.path.join(CERT_DIR, prev_name))
        w, h = pix.width, pix.height
    finally:
        doc.close()
    from cert_engine import pdf_tokens_found
    try: tokens = pdf_tokens_found(pdf_path)
    except Exception: tokens = []
    return {"pdf_url": f"/uploads/certificates/{pdf_name}",
            "preview_url": f"/uploads/certificates/{prev_name}",
            "width_px": w, "height_px": h, "tokens_found": tokens}
```

- [ ] **Step 5: Generation routing — `cert_routes.py` preview branch** (where it currently does `if tpl.get("kind")=="pdf": render_certificate_pdf_merge else render_certificate_pdf`): change to:
```python
    from cert_engine import (render_certificate_pdf, render_certificate_pdf_merge,
                             render_certificate_pdf_overlay)
    if tpl.get("kind") == "pdf":
        if tpl.get("fields"):
            render_certificate_pdf_overlay(bg_path, out_path, tpl.get("fields", []),
                {"name": it["name"]}, batch.get("shared_values", {}),
                tpl.get("width_px") or 0, tpl.get("height_px") or 0)
        else:
            render_certificate_pdf_merge(bg_path, out_path, {"name": it["name"]}, batch.get("shared_values", {}))
    else:
        render_certificate_pdf(bg_path, out_path, tpl.get("fields", []), {"name": it["name"]}, batch.get("shared_values", {}))
```
(Match the exact var names used in the current preview handler — read it first.)

- [ ] **Step 6: Generation routing — `scheduler._generate_pending_certs`** (line ~854): add `render_certificate_pdf_overlay` to the import at ~814 and apply the same `kind=="pdf" and fields → overlay` branch as Step 5, using the batch's `shared` and `clean_name(it["name"])` exactly as the surrounding code does (read lines 845-862 first).

- [ ] **Step 7: Run → PASS.** **Step 8: Commit** (`cert_routes.py`, `scheduler.py`) `feat(certs): pdf-preview + fonts endpoints + overlay generation routing`.

---

### Task 4: Frontend — font dropdown in TemplateDesigner

**Files:** Modify `frontend/src/lib/api.js`, `frontend/src/components/certs/TemplateDesigner.js`

- [ ] **Step 1:** `api.js` add `listFonts: () => API.get('/certs/fonts')` and `uploadPdfPreview: (fd) => API.post('/certs/templates/pdf-preview', fd, {headers:{'Content-Type':'multipart/form-data'}})` to `certsApi`.
- [ ] **Step 2:** In `TemplateDesigner.js`: on mount, `certsApi.listFonts()` → store families (fallback to the static list if it fails). Add a **Font** `<select>` per field (value `field.font || 'Default'`) that updates the field immutably. Default new fields to `font:'Default'`.
- [ ] **Step 3:** Add a Google Fonts `<link>` (once) for the curated families so the on-canvas text preview renders in the chosen face; apply `style={{fontFamily: field.font==='Default'?'inherit':field.font, fontSize, color}}` to each draggable field label. Save payload already includes `fields` → now carries `font`.
- [ ] **Step 4:** Re-read for JSX balance + immutable nested updates. **Commit** the two files: `feat(certs): per-field font picker in template designer`.

---

### Task 5: Frontend — PDF → drag-designer flow

**Files:** Modify `frontend/src/components/certs/PdfTemplateUploader.js`, `frontend/src/pages/admin/Certificates.js`

- [ ] **Step 1:** Read both files to learn the current PDF (token-merge) upload + how PNG templates open the `TemplateDesigner` and save.
- [ ] **Step 2:** Add a PDF mode that, after `uploadPdfPreview(file)`, opens `TemplateDesigner` using the returned `preview_url` as the background image and `width_px/height_px` as the natural dims; on save, POST template with `kind:'pdf'`, `background_url: pdf_url`, `preview_url`, `width_px/height_px`, and the placed `fields`. Keep the existing "token-merge (no drag fields)" path selectable for PDFs that already contain `{tokens}` (save with empty `fields`).
- [ ] **Step 3:** Ensure the template list/cards + `BatchDetail` preview work for `kind:pdf` with fields (preview endpoint already routes via Task 3 Step 5).
- [ ] **Step 4:** Re-read for correctness. **Commit**: `feat(certs): PDF drag-designer flow (preview + place fields + save)`.

---

## Final verification (controller)
- [ ] Unit: `python -m pytest tests/test_cert_fonts.py tests/test_cert_pdf_overlay.py -v` — PASS.
- [ ] Integration: `DB_NAME=smartshape_test REACT_APP_BACKEND_URL=http://127.0.0.1:8000 python -m pytest tests/test_cert_pdf_designer.py -v` — PASS.
- [ ] Cert regression: existing `tests/test_cert_pipeline.py` still PASS (routing change didn't break PNG/token-merge).
- [ ] Local browser: upload a PDF → drag `{Name}` with **Great Vibes**, set size/color → save → batch → generate → preview shows the name in that script font at that spot; background preserved.
- [ ] Deploy: merge `feat/cert-font-designer` → main, push (autodeploy). Fonts committed → included in docker build; no server step needed.

## Self-review
- **Spec coverage:** fonts bundle+registry (T1), PDF overlay + PNG font (T2), model+endpoints+routing (T3), font picker UI (T4), PDF designer UI (T5). All mapped.
- **Type consistency:** `render_certificate_pdf_overlay(template_pdf_path,out_path,fields,item,shared,design_w,design_h)` used identically in T2/T3/T5 paths; `font_path/font_families/_load_font(size,family)` consistent T1↔T2↔T3; `TemplateField.font` (T3) consumed by overlay/PNG (T2) and produced by UI (T4/T5).
- **No placeholders;** real code in every code step. Font fetch (T1 S1) is the one controller-supplied artifact (binary ttf) — handled at build with load-verification.
