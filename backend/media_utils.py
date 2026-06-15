"""Pure, DB-free helpers for die/product media (photos, video, customer gating).

Kept separate from route modules so the security-critical gating logic is unit
tested without a database or running server.
"""
import re
from typing import Any, Dict, List, Optional

MAX_DIE_IMAGES = 5

_YT_PATTERNS = [
    re.compile(r"(?:youtube\.com/watch\?(?:.*&)?v=)([A-Za-z0-9_-]{11})"),
    re.compile(r"(?:youtu\.be/)([A-Za-z0-9_-]{11})"),
    re.compile(r"(?:youtube\.com/shorts/)([A-Za-z0-9_-]{11})"),
    re.compile(r"(?:youtube\.com/embed/)([A-Za-z0-9_-]{11})"),
]


def youtube_id(url: Optional[str]) -> Optional[str]:
    """Extract the 11-char YouTube id from common URL forms, else None."""
    if not url or not isinstance(url, str):
        return None
    for pat in _YT_PATTERNS:
        match = pat.search(url)
        if match:
            return match.group(1)
    return None


def normalize_images(die: Dict[str, Any]) -> List[str]:
    """Return the die's gallery as a list, capped at MAX_DIE_IMAGES.

    Falls back to a single-element list from the legacy `image_url` when an
    `images` array is absent, so old dies render without a data migration.
    """
    images = die.get("images")
    if isinstance(images, list) and images:
        clean = [u for u in images if u]
    else:
        single = die.get("image_url")
        clean = [single] if single else []
    return clean[:MAX_DIE_IMAGES]


def gate_die_for_customer(die: Dict[str, Any]) -> Dict[str, Any]:
    """Project a die for a customer-facing payload.

    Always includes normalized `images`. Includes `video_url` only when
    `show_video` is true and `description` only when `show_description` is true.
    Never leaks the `show_*` flags. Enforced server-side so unpublished media
    never reaches the client.
    """
    out = {k: v for k, v in die.items()
           if k not in ("show_video", "show_description", "video_url", "description", "images", "_id")}
    out["images"] = normalize_images(die)
    out["image_url"] = out.get("image_url") or (out["images"][0] if out["images"] else None)
    if die.get("show_video") and die.get("video_url"):
        out["video_url"] = die["video_url"]
    if die.get("show_description") and die.get("description"):
        out["description"] = die["description"]
    return out
