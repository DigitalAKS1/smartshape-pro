"""
import_engine.py — CSV + Excel parser for the dynamic master-data import feature.

Task 3: parse_table(filename, content) -> (headers, rows)
  - CSV: utf-8-sig / cp1252 / latin-1 encoding fallback
  - Excel (.xlsx/.xlsm): openpyxl read_only + data_only mode
"""
import csv
import io
from difflib import SequenceMatcher

from openpyxl import load_workbook

from field_registry import list_fields, normalize_header


def parse_table(filename: str, content: bytes) -> tuple[list[str], list[dict]]:
    """Parse CSV or Excel bytes into (headers, rows).

    Args:
        filename: Original filename — extension determines format.
        content:  Raw file bytes.

    Returns:
        headers: List of column name strings (stripped).
        rows:    List of dicts mapping header -> cell string (stripped).
                 Blank/all-None rows are skipped for Excel.
    """
    name = (filename or "").lower()

    if name.endswith((".xlsx", ".xlsm")):
        wb = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        try:
            ws = wb.active
            rows_iter = ws.iter_rows(values_only=True)
            headers = [
                str(h).strip() if h is not None else ""
                for h in next(rows_iter, [])
            ]
            rows = []
            for r in rows_iter:
                if r is None or all(c is None for c in r):
                    continue
                rows.append({
                    headers[i]: ("" if v is None else str(v)).strip()
                    for i, v in enumerate(r)
                    if i < len(headers) and headers[i]
                })
            return headers, rows
        finally:
            wb.close()

    # CSV with encoding fallback (mirrors crm_routes.py encoding pattern)
    text = None
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            text = content.decode(enc)
            break
        except UnicodeDecodeError:
            continue

    reader = csv.DictReader(io.StringIO(text or ""))
    headers = [h.strip() for h in (reader.fieldnames or [])]
    rows = [
        {(k or "").strip(): (v or "").strip() for k, v in row.items()}
        for row in reader
    ]
    return headers, rows


# ---------------------------------------------------------------------------
# Task 4: Auto column-mapping via alias lookup + fuzzy fallback
# ---------------------------------------------------------------------------
async def propose_mapping(db, headers: list) -> list:
    """Map raw spreadsheet headers to registered field definitions.

    For each header in *headers* (order preserved) returns a dict::

        {source, field_id, key, confidence}

    Confidence levels:
      "high"   — exact match on a normalized alias or label
      "medium" — best fuzzy SequenceMatcher ratio >= 0.78 across label+aliases
      "none"   — no match found
    """
    fields = await list_fields(db)

    # Build alias index: normalized alias/label -> field dict
    alias_index: dict = {}
    for f in fields:
        for a in f.get("aliases", []):
            alias_index[normalize_header(a)] = f
        # setdefault so an explicit alias wins over the derived label key
        alias_index.setdefault(normalize_header(f["label"]), f)

    out = []
    for h in headers:
        nh = normalize_header(h)

        # --- exact match ---
        f = alias_index.get(nh)
        if f:
            out.append({"source": h, "field_id": f["field_id"], "key": f["key"], "confidence": "high"})
            continue

        # --- fuzzy match ---
        best, score = None, 0.0
        for f2 in fields:
            candidates = [normalize_header(f2["label"])] + [normalize_header(a) for a in f2.get("aliases", [])]
            s = max(SequenceMatcher(None, nh, c).ratio() for c in candidates)
            if s > score:
                best, score = f2, s

        if best and score >= 0.78:
            out.append({"source": h, "field_id": best["field_id"], "key": best["key"], "confidence": "medium"})
        else:
            out.append({"source": h, "field_id": None, "key": None, "confidence": "none"})

    return out
