"""Pure, DB-free helpers for the product-type master (code prefixes / codes)."""
import re
from typing import List, Optional


def slugify_prefix(raw: Optional[str]) -> str:
    """Normalize a code prefix: uppercase, keep A-Z/0-9/-, drop everything else."""
    if not raw:
        return ""
    return re.sub(r"[^A-Z0-9-]", "", raw.strip().upper())


def next_code(prefix: str, existing_codes: List[str]) -> str:
    """Suggest the next sequential code for a prefix, zero-padded to 3 digits.

    Scans `existing_codes` for `<prefix>-<number>` (case-insensitive), takes the
    highest number, and returns the next one. Falls back to `<prefix>-001`.
    """
    pref = slugify_prefix(prefix)
    pat = re.compile(rf"^{re.escape(pref)}-0*(\d+)$", re.IGNORECASE)
    highest = 0
    for code in existing_codes or []:
        m = pat.match(str(code or "").strip())
        if m:
            highest = max(highest, int(m.group(1)))
    return f"{pref}-{highest + 1:03d}"
