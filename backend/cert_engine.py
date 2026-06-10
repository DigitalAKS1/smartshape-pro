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
    if key in ("date", "theme", "expert"):
        return str((shared or {}).get(key, "") or "")
    return ""


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
    row + batch shared values. Supported: {Name}, {Date}, {Theme}, {Expert},
    {Conducted By}. Unknown tokens are left untouched."""
    if not text:
        return ""
    shared = shared or {}
    expert = str(shared.get("expert", "") or "")
    values = {
        "name": str(item.get("name", "") or ""),
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
    return {
        "{Name}": str(item.get("name", "") or ""),
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
                                    "font": _base14(span.get("font", "")),
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
                try:
                    tw = fitz.get_text_length(j["val"], fontname=j["font"], fontsize=j["size"])
                    x = (j["r"].x0 + j["r"].x1) / 2 - tw / 2 if j["center"] else j["r"].x0
                    page.insert_text((x, j["base"]), j["val"], fontsize=j["size"],
                                     fontname=j["font"], color=j["color"])
                except Exception:
                    page.insert_text((j["r"].x0, j["base"]), j["val"], fontsize=j["size"],
                                     fontname="helv", color=j["color"])
        os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
        doc.save(out_path, garbage=3, deflate=True)
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
        for tok in ("{Name}", "{Date}", "{Theme}", "{Conducted By}", "{Expert}"):
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
        font = _load_font(int(f.get("size", 24)))
        color = f.get("color", "#000000")
        x = int(f.get("x", 0)); y = int(f.get("y", 0))
        ax = _anchor_x(draw, text, font, x, f.get("align", "center"))
        draw.text((ax, y), text, fill=color, font=font)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    img.save(out_path, "PDF", resolution=150.0)
    return out_path
