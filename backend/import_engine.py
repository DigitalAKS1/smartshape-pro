"""
import_engine.py — CSV + Excel parser for the dynamic master-data import feature.

Task 3: parse_table(filename, content) -> (headers, rows)
  - CSV: utf-8-sig / cp1252 / latin-1 encoding fallback
  - Excel (.xlsx/.xlsm): openpyxl read_only + data_only mode
"""
import csv
import io

from openpyxl import load_workbook


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
        wb.close()
        return headers, rows

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
