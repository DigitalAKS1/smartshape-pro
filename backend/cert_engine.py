"""Pure certificate rendering — Pillow overlay on a PNG background, saved as PDF.
No DB/server imports so it is unit-testable in isolation."""
import os, re, io
from typing import List, Dict, Any, Optional
from PIL import Image, ImageDraw, ImageFont

# Bundled fallback font; DejaVu ships with Pillow's test data on some systems,
# otherwise Pillow's load_default is used (fixed size). Prefer a real TTF for sizing.
_FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "C:\\Windows\\Fonts\\arial.ttf",
    "C:\\Windows\\Fonts\\Arial.ttf",
]

# ── Curated bundled fonts (per-field font choice) ─────────────────────────────
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
    """Family names for the designer dropdown ('Default' = system fallback)."""
    return ["Default"] + list(FONT_REGISTRY.keys())

def font_path(family):
    """Absolute path to a curated TTF, or None for Default/unknown."""
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
    # last resort — fixed-size default (size arg ignored)
    return ImageFont.load_default()


def safe_bg_path(cert_dir: str, bg_url: str) -> str:
    """Map a stored background_url to a local path UNDER cert_dir, rejecting traversal."""
    bg_file = bg_url.split("/uploads/certificates/")[-1] if "/uploads/certificates/" in bg_url else bg_url
    path = os.path.join(cert_dir, bg_file)
    if not os.path.realpath(path).startswith(os.path.realpath(cert_dir) + os.sep):
        raise ValueError("background path escapes certificate directory")
    return path


def resolve_field_value(key: str, item: Dict[str, Any], shared: Dict[str, Any]) -> str:
    if key == "name":
        return str(item.get("name", "") or "")
    if key == "school":
        # per-attendee value stored on the item (not a batch-shared value)
        return str(item.get("school", "") or "")
    if key in ("date", "theme", "expert"):
        return str((shared or {}).get(key, "") or "")
    return ""


_WS_RE = re.compile(r"[ \t]+")

def clean_name(raw: str) -> str:
    """Trim, collapse inner whitespace, and Proper-Case a person's name.
    Handles ALLCAPS, hyphens, and apostrophes (anne-marie -> Anne-Marie, O'BRIEN -> O'Brien)."""
    s = _WS_RE.sub(" ", (raw or "").strip())
    if not s:
        return ""
    def cap_word(w: str) -> str:
        return re.sub(r"[A-Za-z]+", lambda m: m.group(0).capitalize(), w)
    return " ".join(cap_word(w) for w in s.split(" "))


def sanitize_filename(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]", "_", (name or "").strip())
    cleaned = re.sub(r"_{3,}", "__", cleaned).strip("_")
    return cleaned or "certificate"


# ── Mail-merge message defaults + renderer ────────────────────────────────────
DEFAULT_EMAIL_SUBJECT = "Your Certificate — {Theme}"
DEFAULT_EMAIL_BODY = (
    "Dear {Name},\n\n"
    "Thank you for attending {Theme} on {Date}, conducted by {Conducted By}. "
    "Please find your certificate attached.\n\n"
    "Warm regards,\nSmartShape"
)
DEFAULT_WA_CAPTION = "Dear {Name}, please find your certificate for {Theme} attached."


def render_placeholders(text: str, item: Dict[str, Any], shared: Dict[str, Any]) -> str:
    """Replace mail-merge tokens (case-insensitive) with values from the attendee
    row + batch shared values. Supported: {Name}, {School}, {School Name}, {Date},
    {Theme}, {Expert}, {Conducted By}. Unknown tokens are left untouched."""
    if not text:
        return ""
    shared = shared or {}
    expert = str(shared.get("expert", "") or "")
    school = str(item.get("school", "") or "")
    values = {
        "name": str(item.get("name", "") or ""),
        "school": school,
        "school name": school,
        "date": str(shared.get("date", "") or ""),
        "theme": str(shared.get("theme", "") or ""),
        "expert": expert,
        "conducted by": expert,
    }

    def _sub(m):
        key = re.sub(r"\s+", " ", m.group(1).strip().lower())
        return values.get(key, m.group(0))

    return re.sub(r"\{([^{}]+)\}", _sub, text)


def _anchor_x(draw: ImageDraw.ImageDraw, text: str, font, x: int, align: str) -> int:
    if align == "left":
        return x
    bbox = draw.textbbox((0, 0), text, font=font)
    w = bbox[2] - bbox[0]
    if align == "right":
        return x - w
    return x - w // 2  # center


# ── PDF template token-merge (PyMuPDF) ────────────────────────────────────────
# For templates that ARE a PDF with {Name}/{Date}/{Theme}/{Conducted By} printed
# as text: find each token, delete it, and re-insert the real value in place —
# keeping the original vector layout, fonts, and background untouched.

def _merge_values(item: Dict[str, Any], shared: Dict[str, Any]) -> Dict[str, str]:
    shared = shared or {}
    expert = str(shared.get("expert", "") or "")
    school = str(item.get("school", "") or "")
    return {
        "{Name}": str(item.get("name", "") or ""),
        "{School}": school,
        "{School Name}": school,
        "{Date}": str(shared.get("date", "") or ""),
        "{Theme}": str(shared.get("theme", "") or ""),
        "{Expert}": expert,
        "{Conducted By}": expert,
    }


def _base14(font_name: str) -> str:
    """Map an arbitrary template font name to a PyMuPDF base-14 font."""
    fl = (font_name or "").lower()
    bold = any(k in fl for k in ("bold", "black", "semibold", "heavy"))
    italic = "italic" in fl or "oblique" in fl
    serif = any(k in fl for k in ("times", "serif", "georgia", "garamond", "roman", "minion"))
    if serif:
        return "tibi" if bold and italic else "tibo" if bold else "tiit" if italic else "tiro"
    return "hebi" if bold and italic else "hebo" if bold else "heit" if italic else "helv"


# Match an embedded template font name (e.g. "BAAAAA+GreatVibes-Regular") to a
# bundled FULL TTF so merged values render in the SAME typeface as the template.
# The PDF's own embedded font is subsetted (only the placeholder's glyphs), so it
# cannot be reused to draw new text — but backend/fonts/ ships the full family.
_SUBSET_RE = re.compile(r"^[A-Z]{6}\+")   # strip "AAAAAA+" subset prefixes

def _norm_font(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())

def _build_bundled_font_index() -> Dict[str, str]:
    """normalized font key -> bundled TTF path (stem, family display name, and
    family-without-style all map to the same file)."""
    idx: Dict[str, str] = {}
    for family, fn in FONT_REGISTRY.items():
        p = os.path.join(FONT_DIR, fn)
        if not os.path.isfile(p):
            continue
        stem = os.path.splitext(fn)[0]            # "OpenSans-Regular"
        idx.setdefault(_norm_font(stem), p)       # opensansregular
        idx.setdefault(_norm_font(family), p)     # opensans (from display name)
        idx.setdefault(_norm_font(stem.split("-")[0]), p)  # opensans (family from stem)
    return idx

_BUNDLED_FONT_INDEX = _build_bundled_font_index()

def bundled_font_for(font_name: str) -> Optional[str]:
    """Best bundled TTF whose family matches an embedded/template font name, else
    None. Tries an exact stem match first, then a family-only match so e.g.
    'OpenSans-Bold' still resolves to the Open Sans typeface rather than Helvetica."""
    raw = _SUBSET_RE.sub("", font_name or "")
    if not raw:
        return None
    key = _norm_font(raw)
    if key in _BUNDLED_FONT_INDEX:
        return _BUNDLED_FONT_INDEX[key]
    family = _norm_font(re.split(r"[-,+ ]", raw)[0])   # drop style suffix
    return _BUNDLED_FONT_INDEX.get(family)


# ── PDF size compression (recompress oversized lossless template images) ──────
# Certificate templates are often exported with 5–10 MB of lossless PNG artwork.
# Recompress each raster to JPEG at a sane on-page DPI, preserving transparency:
#  - fully-opaque images  -> straight JPEG
#  - soft-masked images   -> JPEG colour + JPEG grey mask, /SMask link re-established
#  - inline-alpha images  -> left untouched (re-embedding alpha safely is fragile)
# Always best-effort: any failure leaves that image (or the whole doc) as-is.

def _img_has_inline_alpha(im: "Image.Image") -> bool:
    return im.mode in ("RGBA", "LA", "PA") or (im.mode == "P" and "transparency" in im.info)

def compress_pdf_images(doc, quality: int = 75, max_dpi: int = 150) -> None:
    """In-place: recompress raster images of an open PyMuPDF doc to shrink filesize."""
    import fitz  # noqa: F401  (doc is already a fitz.Document)
    for page in doc:
        for x in page.get_images(full=True):
            xref, smask = x[0], x[1]
            try:
                info = doc.extract_image(xref)
                im = Image.open(io.BytesIO(info["image"]))
            except Exception:
                continue
            if _img_has_inline_alpha(im):
                continue
            try:
                rects = page.get_image_rects(xref)
                disp_w = max((r.width for r in rects), default=0)
                tgt = int(disp_w / 72.0 * max_dpi) if disp_w > 0 else 0
                if tgt and im.width > tgt:
                    im = im.resize((tgt, max(1, int(im.height * tgt / im.width))), Image.LANCZOS)
                buf = io.BytesIO()
                im.convert("RGB").save(buf, format="JPEG", quality=quality, optimize=True)
                page.replace_image(xref, stream=buf.getvalue())
                if smask:
                    try:
                        mim = Image.open(io.BytesIO(doc.extract_image(smask)["image"])).convert("L")
                        if tgt and mim.width > tgt:
                            mim = mim.resize((tgt, max(1, int(mim.height * tgt / mim.width))), Image.LANCZOS)
                        mb = io.BytesIO()
                        mim.save(mb, format="JPEG", quality=85, optimize=True)
                        page.replace_image(smask, stream=mb.getvalue())
                    except Exception:
                        pass
                    # replace_image drops the colour image's /SMask — re-link the mask
                    doc.xref_set_key(xref, "SMask", f"{smask} 0 R")
            except Exception:
                continue

def _save_pdf_compressed(doc, out_path: str, quality: int = 75) -> None:
    """Recompress images (best-effort) then save with full garbage-collection/deflate."""
    try:
        compress_pdf_images(doc, quality=quality)
    except Exception:
        pass
    try:
        doc.subset_fonts()
    except Exception:
        pass
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    try:
        doc.save(out_path, garbage=4, deflate=True, deflate_images=True, deflate_fonts=True)
    except TypeError:
        doc.save(out_path, garbage=4, deflate=True)


def compress_pdf_file(path: str, quality: int = 80, max_dpi: int = 150) -> int:
    """Recompress an EXISTING PDF file in place (best-effort). Used both to shrink
    the image-background render path and as a safety net at download time for files
    generated before compression existed. Returns the final size in bytes."""
    import fitz
    if not path or not os.path.isfile(path):
        return 0
    orig = os.path.getsize(path)
    tmp = path + ".ctmp"
    try:
        doc = fitz.open(path)
    except Exception:
        return orig
    try:
        _save_pdf_compressed(doc, tmp, quality=quality)
    finally:
        try:
            doc.close()
        except Exception:
            pass
    # only adopt the recompressed copy if it actually got smaller and is valid
    try:
        if os.path.isfile(tmp) and 0 < os.path.getsize(tmp) < orig:
            os.replace(tmp, path)
        elif os.path.isfile(tmp):
            os.remove(tmp)
    except OSError:
        pass
    return os.path.getsize(path) if os.path.isfile(path) else orig


def render_certificate_pdf_merge(template_pdf_path: str, out_path: str,
                                 item: Dict[str, Any], shared: Dict[str, Any]) -> str:
    """Replace {tokens} printed in a PDF template with per-attendee values.
    Standalone tokens (alone on their line, e.g. {Name}) are centred on the token;
    inline tokens (after a label) are left-anchored. Returns out_path."""
    import fitz  # PyMuPDF
    values = _merge_values(item, shared)
    doc = fitz.open(template_pdf_path)
    try:
        for page in doc:
            info = page.get_text("dict")
            jobs: List[Dict[str, Any]] = []
            for blk in info.get("blocks", []):
                for line in blk.get("lines", []):
                    spans = line.get("spans", [])
                    line_text = "".join(s.get("text", "") for s in spans)
                    residual = line_text
                    for tok in values:
                        residual = residual.replace(tok, "")
                    standalone = residual.strip() == ""
                    for span in spans:
                        stext = span.get("text", "")
                        for tok, val in values.items():
                            if tok not in stext:
                                continue
                            clip = fitz.Rect(span["bbox"])
                            for r in page.search_for(tok, clip=clip):
                                col = int(span.get("color", 0) or 0)
                                rgb = ((col >> 16 & 255) / 255, (col >> 8 & 255) / 255, (col & 255) / 255)
                                jobs.append({
                                    "r": r, "val": val,
                                    "size": float(span.get("size", 0) or r.height * 0.8),
                                    "base": float(span.get("origin", (r.x0, r.y1))[1]),
                                    # keep the RAW template font name; resolve to a bundled
                                    # TTF (exact typeface) at insert time, base-14 only if none.
                                    "fontraw": span.get("font", ""),
                                    # Centre ONLY a standalone {Name}; every other field is
                                    # left-anchored at the token's x so a long value flows right
                                    # into its blank and never overlaps the label to its left.
                                    "color": rgb, "center": (tok == "{Name}" and standalone),
                                })
                                page.add_redact_annot(r, fill=False, cross_out=False)
            try:
                page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE,
                                      graphics=fitz.PDF_REDACT_LINE_ART_NONE)
            except TypeError:
                page.apply_redactions()
            for j in jobs:
                if not j["val"]:
                    continue
                fp = bundled_font_for(j["fontraw"])
                try:
                    if fp:
                        alias = "f_" + _norm_font(os.path.basename(fp))
                        tw = fitz.Font(fontfile=fp).text_length(j["val"], j["size"])
                        x = (j["r"].x0 + j["r"].x1) / 2 - tw / 2 if j["center"] else j["r"].x0
                        page.insert_text((x, j["base"]), j["val"], fontsize=j["size"],
                                         fontfile=fp, fontname=alias, color=j["color"])
                    else:
                        base14 = _base14(j["fontraw"])
                        tw = fitz.get_text_length(j["val"], fontname=base14, fontsize=j["size"])
                        x = (j["r"].x0 + j["r"].x1) / 2 - tw / 2 if j["center"] else j["r"].x0
                        page.insert_text((x, j["base"]), j["val"], fontsize=j["size"],
                                         fontname=base14, color=j["color"])
                except Exception:
                    page.insert_text((j["r"].x0, j["base"]), j["val"], fontsize=j["size"],
                                     fontname="helv", color=j["color"])
        _save_pdf_compressed(doc, out_path)
    finally:
        doc.close()
    return out_path


def pdf_tokens_found(template_pdf_path: str) -> List[str]:
    """Return which known tokens are actually present in the PDF (for validation/UI)."""
    import fitz
    doc = fitz.open(template_pdf_path)
    try:
        present = []
        all_text = "".join(page.get_text() for page in doc)
        for tok in ("{Name}", "{School}", "{School Name}", "{Date}", "{Theme}", "{Conducted By}", "{Expert}"):
            if tok in all_text:
                present.append(tok)
        return present
    finally:
        doc.close()


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
        font = _load_font(int(f.get("size", 24)), f.get("font", "Default"))
        color = f.get("color", "#000000")
        x = int(f.get("x", 0)); y = int(f.get("y", 0))
        ax = _anchor_x(draw, text, font, x, f.get("align", "center"))
        draw.text((ax, y), text, fill=color, font=font)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    img.save(out_path, "PDF", resolution=150.0)
    # Pillow writes the page as a lossless (Flate) raster -> recompress to JPEG.
    # quality 88 keeps overlaid text crisp while cutting size several-fold.
    try:
        compress_pdf_file(out_path, quality=88)
    except Exception:
        pass
    return out_path


# ── PDF drag-overlay (PyMuPDF) — place fields at chosen x/y with chosen font ───
def _hex_rgb(c):
    c = (c or "#000000").lstrip("#")
    if len(c) == 3:
        c = "".join(ch * 2 for ch in c)
    try:
        return (int(c[0:2], 16) / 255, int(c[2:4], 16) / 255, int(c[4:6], 16) / 255)
    except Exception:
        return (0, 0, 0)


def render_certificate_pdf_overlay(template_pdf_path: str, out_path: str,
                                   fields: List[Dict[str, Any]],
                                   item: Dict[str, Any], shared: Dict[str, Any],
                                   design_w: int, design_h: int) -> str:
    """Overlay drag-positioned fields onto a PDF template (page 0) with chosen
    font/size/color. design_w/design_h = pixel size of the raster preview the
    fields were placed on; positions+sizes scale to PDF points. Returns out_path."""
    import fitz  # PyMuPDF
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
            alias = "f_" + re.sub(r"[^a-z0-9]", "", str(f.get("font", "default")).lower())
            try:
                tw = (fitz.Font(fontfile=fp).text_length(val, pt) if fp
                      else fitz.get_text_length(val, fontname="helv", fontsize=pt))
            except Exception:
                tw = 0.0
            px = float(f.get("x", 0)) * sx
            align = f.get("align", "center")
            ax = px - tw / 2 if align == "center" else (px - tw if align == "right" else px)
            baseline = float(f.get("y", 0)) * sy + pt  # top-left designer y -> PDF baseline
            rgb = _hex_rgb(f.get("color"))
            try:
                if fp:
                    page.insert_text((ax, baseline), val, fontsize=pt, fontfile=fp,
                                     fontname=alias, color=rgb)
                else:
                    page.insert_text((ax, baseline), val, fontsize=pt, fontname="helv", color=rgb)
            except Exception:
                page.insert_text((ax, baseline), val, fontsize=pt, fontname="helv", color=rgb)
        _save_pdf_compressed(doc, out_path)
    finally:
        doc.close()
    return out_path
