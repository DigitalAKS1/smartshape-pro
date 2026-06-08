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
