"""
import_engine.py — CSV + Excel parser for the dynamic master-data import feature.

Task 3: parse_table(filename, content) -> (headers, rows)
  - CSV: utf-8-sig / cp1252 / latin-1 encoding fallback
  - Excel (.xlsx/.xlsm): openpyxl read_only + data_only mode
"""
import csv
import io
import re as _re
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


# ---------------------------------------------------------------------------
# Task 5: Row resolver — school identity match
# ---------------------------------------------------------------------------
async def resolve_school(db, values: dict) -> dict:
    """Match a mapped row dict to an existing school record.

    Match precedence:
      1. values["school_id"] present and non-deleted school exists → update
      2. school_name (case-insensitive exact), optionally narrowed by city
         1 match → update, ≥2 → needs_review
      3. school_phone / phone exact match
         1 match → update, ≥2 → needs_review
      4. no match → create

    Returns:
        {"action": "create"|"update"|"needs_review", "school_id": str|None, "candidates": int}
    """
    sid = (values.get("school_id") or "").strip()
    if sid:
        hit = await db.schools.find_one(
            {"school_id": sid, "is_deleted": {"$ne": True}},
            {"_id": 0, "school_id": 1},
        )
        if hit:
            return {"action": "update", "school_id": sid, "candidates": 1}

    name = (values.get("school_name") or "").strip()
    city = (values.get("city") or "").strip()
    if name:
        q: dict = {
            "school_name": {"$regex": f"^{_re.escape(name)}$", "$options": "i"},
            "is_deleted": {"$ne": True},
            "school_id": {"$exists": True, "$ne": None},
        }
        if city:
            q["city"] = {"$regex": f"^{_re.escape(city)}$", "$options": "i"}
        cands = [d async for d in db.schools.find(q, {"_id": 0, "school_id": 1})]
        if len(cands) == 1:
            return {"action": "update", "school_id": cands[0].get("school_id"), "candidates": 1}
        if len(cands) >= 2:
            return {"action": "needs_review", "school_id": None, "candidates": len(cands)}

    phone = (values.get("school_phone") or values.get("phone") or "").strip()
    if phone:
        cands = [d async for d in db.schools.find(
            {"phone": phone, "is_deleted": {"$ne": True}, "school_id": {"$exists": True, "$ne": None}},
            {"_id": 0, "school_id": 1},
        )]
        if len(cands) == 1:
            return {"action": "update", "school_id": cands[0].get("school_id"), "candidates": 1}
        if len(cands) >= 2:
            return {"action": "needs_review", "school_id": None, "candidates": len(cands)}

    return {"action": "create", "school_id": None, "candidates": 0}


# ---------------------------------------------------------------------------
# Task 6: split_values + commit_row — upsert School+Contact+Lead with audit
# ---------------------------------------------------------------------------
import uuid as _uuid

from field_registry import SEED_FIELDS


def _now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


# Module-level map: key -> (entity, maps_to|None)
# Built from SEED_FIELDS tuple: (key, label, entity, type, maps_to, group, aliases)
_CORE = {key: (entity, maps_to) for (key, _l, entity, _t, maps_to, _g, _a) in SEED_FIELDS}


def split_values(row_keyed: dict) -> dict:
    """Split a mapped row dict into native and custom-field buckets per entity.

    Returns:
        {
          "school": {native_col: val, ...},
          "contact": {native_col: val, ...},
          "lead": {native_col: val, ...},
          "custom": {"school": {key: val}, "contact": {key: val}, "lead": {key: val}},
        }

    The control key "school_id" is skipped (it is used only for resolve_school).
    Keys whose maps_to is set write to native columns under their entity.
    Keys with no maps_to (or unknown keys) write to custom[entity][key].
    """
    out: dict = {
        "school": {},
        "contact": {},
        "lead": {},
        "custom": {"school": {}, "contact": {}, "lead": {}},
    }
    for key, val in row_keyed.items():
        if key == "school_id":          # control key — not stored as a field
            continue
        meta = _CORE.get(key)
        if meta and meta[1]:            # known key with a native column mapping
            entity, native = meta
            out[entity][native] = val
        else:                           # custom field — goes into custom_fields
            entity = meta[0] if meta else "school"
            out["custom"][entity][key] = val
    return out


async def commit_row(db, row_keyed: dict, user: dict, create_leads: bool) -> dict:
    """Upsert one import row into schools / contacts / leads with a pre-update audit snapshot.

    Safety rules:
    - If resolve_school returns needs_review → return immediately, write NOTHING.
    - create: mint sch_<12hex>, insert school doc.
    - update: snapshot the prior school doc into audit_backup (kind=school_pre_import)
              BEFORE any $set, then $set native + custom_fields.<key> dotted paths.
    - contact: dedup by {school_id, phone} matching crm_routes.py dedup logic.
    - lead: only if create_leads AND assigned_to present; upsert one lead per school.

    Returns:
        {"action": str, "school_id": str|None, "contact_id": str|None, "lead_id": str|None}
    """
    res = await resolve_school(db, row_keyed)
    if res["action"] == "needs_review":
        return {"action": "needs_review", "school_id": None, "contact_id": None, "lead_id": None}

    parts = split_values(row_keyed)
    sid = res["school_id"]
    user_email = user.get("email", "import")

    if res["action"] == "create":
        sid = f"sch_{_uuid.uuid4().hex[:12]}"
        doc = {
            "school_id": sid,
            "is_deleted": False,
            "created_by": user_email,
            "created_at": _now(),
            "custom_fields": parts["custom"]["school"],
            **parts["school"],
        }
        await db.schools.insert_one(doc)
    else:
        # Snapshot existing doc before overwriting (safety-critical — never skip)
        old = await db.schools.find_one({"school_id": sid})
        await db.audit_backup.insert_one({
            "kind": "school_pre_import",
            "school_id": sid,
            "snapshot": {k: v for k, v in (old or {}).items() if k != "_id"},
            "at": _now(),
            "by": user_email,
        })
        upd: dict = dict(parts["school"])
        for k, v in parts["custom"]["school"].items():
            upd[f"custom_fields.{k}"] = v
        upd["last_activity_date"] = _now()
        await db.schools.update_one({"school_id": sid}, {"$set": upd})

    # ---- contact: dedup by {school_id, phone} (mirrors crm_routes.py:2015) ----
    cid = None
    phone = parts["contact"].get("phone", "")
    if parts["contact"].get("name") or phone:
        existing_contact = (
            await db.contacts.find_one({"school_id": sid, "phone": phone})
            if phone else None
        )
        cdoc = {
            "school_id": sid,
            **parts["contact"],
            "custom_fields": parts["custom"]["contact"],
        }
        if existing_contact:
            cid = existing_contact["contact_id"]
            await db.contacts.update_one({"contact_id": cid}, {"$set": cdoc})
        else:
            cid = f"con_{_uuid.uuid4().hex[:12]}"
            await db.contacts.insert_one({
                "contact_id": cid,
                "created_at": _now(),
                "is_deleted": False,
                **cdoc,
            })

    # ---- lead: only if create_leads AND an assigned_to is present ----
    lid = None
    owner = parts["lead"].get("assigned_to", "")
    if create_leads and owner:
        existing_lead = await db.leads.find_one(
            {"school_id": sid, "is_deleted": {"$ne": True}}
        )
        if existing_lead:
            lid = existing_lead["lead_id"]
            await db.leads.update_one({"lead_id": lid}, {"$set": {"assigned_to": owner}})
        else:
            lid = f"lead_{_uuid.uuid4().hex[:12]}"
            await db.leads.insert_one({
                "lead_id": lid,
                "school_id": sid,
                "assigned_to": owner,
                "company_name": parts["school"].get("school_name", ""),
                "stage": "new",
                "created_at": _now(),
                "is_deleted": False,
            })

    return {"action": res["action"], "school_id": sid, "contact_id": cid, "lead_id": lid}
