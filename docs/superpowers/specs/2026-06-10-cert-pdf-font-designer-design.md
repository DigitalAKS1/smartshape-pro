# Certificate PDF Drag-Designer + Per-Field Fonts — Design Spec

**Date:** 2026-06-10
**Status:** Approved (build + ship)
**Scope:** Let admins drag-position each certificate variable on a **PDF** template and choose **font family + size + color per variable** — the drag power the PNG flow already has, plus font-family (new for PNG and PDF).

---

## 1. Today (baseline, shipped)
- `render_certificate_pdf` — PNG overlay: fields `{key,x,y,size,color,align}` via Pillow `_load_font(size)` (system font; **no family choice**).
- `render_certificate_pdf_merge` — PDF **token-merge**: replaces `{Name}` etc. in place, inheriting the token span's font/size/color; **no drag-position, no custom font**.
- `TemplateField` = `key,x,y,size,color,align`. `kind = image|pdf`. No bundled fonts.

## 2. Goal
For a **PDF** template: drag each variable to any position and set its font family/size/color; output overlays the text onto the real PDF (vector, background preserved). Font-family also added to the PNG flow. Token-merge stays as a coexisting fallback.

## 3. Non-goals (v1, YAGNI)
- No arbitrary font upload (curated set only).
- No separate bold/italic toggle (choose a bold/italic family instead).
- Multi-page PDFs: overlay on **page 1** only.

## 4. Curated fonts (bundled in repo → `backend/fonts/`, all free/OFL/Apache, also on Google Fonts for browser preview)
Sans: **Roboto, Open Sans, Montserrat, Lato**; Serif: **Merriweather, Playfair Display**; Script: **Great Vibes, Dancing Script**; plus **Default** (current system font). Each maps family→`.ttf`.

## 5. Architecture

### 5.1 Fonts module (`backend/cert_engine.py`)
- `FONT_DIR = backend/fonts/`; `FONT_REGISTRY = {family: filename}` for the curated set + `"Default"`.
- `font_path(family)` → absolute ttf path (or None for Default).
- `font_families()` → list of family names (for the API/UI).
- Extend `_load_font(size, family="Default")` → Pillow `truetype(font_path(family) or fallback, size)`.

### 5.2 PNG overlay (extend `render_certificate_pdf`)
- Use `_load_font(f["size"], f.get("font","Default"))`. Otherwise unchanged.

### 5.3 PDF overlay (new `render_certificate_pdf_overlay`)
`render_certificate_pdf_overlay(template_pdf_path, out_path, fields, item, shared, design_w, design_h) -> out_path` via PyMuPDF:
- Open PDF, take page 0. `pw, ph = page.rect.width, page.rect.height` (points).
- Scale designer-pixels → PDF points: `sx = pw/design_w`, `sy = ph/design_h`.
- For each field: `val = resolve_field_value(...)`; skip empty. `pt_size = max(4, field.size * sx)`. Position `px = field.x * sx`, baseline `py = field.y * sy + pt_size` (top-left designer coord → PDF baseline).
- Font: `fp = font_path(field.font)`. If fp: `page.insert_text((ax,py), val, fontsize=pt_size, fontfile=fp, fontname="f_"+slug(family), color=rgb)` (PyMuPDF embeds the ttf). Else base-14 `helv`.
- Alignment: compute text width via `fitz.Font(fontfile=fp).text_length(val, pt_size)` (or `get_text_length` for base14); left→ax=px, center→px-w/2, right→px-w. color from `#hex`→(r,g,b) floats.
- Save `doc.save(out_path, garbage=3, deflate=True)`.

### 5.4 PDF page rasterize for the designer (new endpoint)
`POST /certs/templates/pdf-preview` (admin): multipart PDF →
- save the PDF to `uploads/certificates/` (the real template);
- PyMuPDF render page 0 to PNG at **150 dpi** → save as `<uuid>_preview.png`;
- return `{ pdf_url, preview_url, width_px, height_px, tokens_found }` (preview px dims at 150 dpi).
(`upload_background` keeps its current PDF behavior for token-merge-only templates.)

### 5.5 Template model + storage (`cert_routes.py`)
- `TemplateField` gains `font: str = "Default"`.
- `TemplateCreate`: for `kind="pdf"` allow `fields` + `preview_url` + `width_px/height_px` (the raster dims). `background_url` = the real PDF.
- `GET /certs/fonts` → `{families: font_families()}` for the UI dropdown.

### 5.6 Generation routing (`scheduler._generate_pending_certs` + `cert_routes` preview)
For each item, by template `kind`:
- `image` → `render_certificate_pdf` (PNG overlay, now font-aware).
- `pdf` **with non-empty `fields`** → `render_certificate_pdf_overlay(pdf, out, fields, item, shared, width_px, height_px)`.
- `pdf` with **no fields** → `render_certificate_pdf_merge` (existing token-merge).
Everything downstream (claim/counts/delivery/ZIP) unchanged.

### 5.7 Frontend
- `TemplateDesigner.js`: add a **Font** dropdown per field (families from `GET /certs/fonts`); store `font` in the field. Load the curated families in the browser via a Google Fonts `<link>` so the on-canvas preview renders in the chosen face. (Shared by PNG + PDF designers.)
- PDF flow: after uploading a PDF (`pdf-preview`), render the returned `preview_url` as the **TemplateDesigner background** (same drag UI as PNG), capturing `font/size/color/align/x/y` per field; save `kind=pdf`, `background_url=pdf_url`, `preview_url`, `width_px/height_px`, `fields`. Keep a "token-merge (no fields)" path available for PDFs that already have `{tokens}`.
- `lib/api.js`: `certsApi.listFonts`, `certsApi.uploadPdfPreview`.

## 6. Coordinate fidelity
Designer canvas displays the preview PNG at a known display width; it already maps display→image px (existing PNG designer logic). Image px (150-dpi raster) → PDF points via `sx=pw/width_px`. Same `width_px/height_px` stored at design time and used at render time ⇒ overlay lands where dragged; font size scales proportionally.

## 7. Testing
- **Unit (pure):** `font_path`/`font_families` (registry resolves bundled ttf; Default→fallback). `render_certificate_pdf_overlay` on a tiny generated PDF → output is valid PDF (`%PDF`), and (smoke) text length/scale math.
- **Integration (test DB, dry-run):** create a `pdf` template with fields+fonts (use `pdf-preview` on a small PDF) → batch → generate → item `generated`, `pdf_url` set; `GET /certs/fonts` returns families.
- **UI (local browser):** upload PDF → drag a field, pick a script font, set size/color → save → generate → preview shows the value in that font at that position.

## 8. Risks
- **Font embedding size:** PyMuPDF embeds each used ttf (subset) — adds ~tens of KB/PDF; acceptable.
- **Bundled font licensing:** all chosen fonts are OFL/Apache (redistributable) — safe to commit.
- **Repo size:** ~8 ttf files (a few MB) committed; one-time.
- **Prod fonts:** committed → included in the docker build automatically (no server step). Coordinate mapping must use the SAME raster dpi (150) at design and render — store dims on the template to stay exact.
