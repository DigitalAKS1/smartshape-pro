"""dynamic_import_routes.py — HTTP API for field definitions and master-data import.

Exposes:
  GET  /fields                   – list active field definitions (admin only)
  POST /fields                   – create custom field (admin only)
  PUT  /fields/{field_id}        – update field (admin only)
  DELETE /fields/{field_id}      – soft-delete custom field (admin only)
  POST /import/preview           – parse + propose mapping + resolve preview
  POST /import/execute           – commit rows + learn aliases + write import_log
  GET  /import/template          – downloadable template headers (+ existing ids)
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, UploadFile, File, HTTPException

from auth_utils import get_current_user
from rbac import require_admin, require_module
import field_registry as fr
import import_engine as ie
from database import db

router = APIRouter(tags=["dynamic-import"])


# ---------------------------------------------------------------------------
# Field definition CRUD
# ---------------------------------------------------------------------------

@router.get("/fields")
async def get_fields(entity: str = None, user: dict = Depends(get_current_user)):
    require_admin(user)
    return await fr.list_fields(db, entity)


@router.post("/fields")
async def post_field(payload: dict, user: dict = Depends(get_current_user)):
    require_admin(user)
    try:
        return await fr.create_field(db, payload, user)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.put("/fields/{field_id}")
async def put_field(field_id: str, patch: dict, user: dict = Depends(get_current_user)):
    require_admin(user)
    try:
        return await fr.update_field(db, field_id, patch)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.delete("/fields/{field_id}")
async def del_field(field_id: str, user: dict = Depends(get_current_user)):
    require_admin(user)
    try:
        await fr.soft_delete_field(db, field_id)
        return {"ok": True}
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


# ---------------------------------------------------------------------------
# Import helpers
# ---------------------------------------------------------------------------

def _key_rows(headers: list, rows: list, mapping: list) -> list:
    """Re-key raw rows from header->value to field_key->value using the mapping."""
    h2k = {m["source"]: m["key"] for m in mapping if m.get("key")}
    out = []
    for row in rows:
        out.append({h2k[h]: v for h, v in row.items() if h in h2k})
    return out


# ---------------------------------------------------------------------------
# Import preview
# ---------------------------------------------------------------------------

@router.post("/import/preview")
async def import_preview(
    file: UploadFile = File(...),
    entity_type: str = "school",
    user: dict = Depends(get_current_user),
):
    """Parse an uploaded CSV/Excel, propose column mapping, and resolve each row.

    Capped at 200 rows for preview speed. Returns:
      {headers, mapping, rows_preview, rows_keyed, counts:{create,update,needs_review,error}, total}

    Note: entity_type is accepted as a query param or form field (both work).
    rows_keyed is included (capped at 1000) so the UI can pass it directly to execute.
    """
    require_module(user, "settings", "read_write")
    content = await file.read()
    headers, rows = ie.parse_table(file.filename, content)
    mapping = await ie.propose_mapping(db, headers)
    keyed = _key_rows(headers, rows, mapping)

    counts = {"create": 0, "update": 0, "needs_review": 0, "error": 0}
    preview = []
    for kr in keyed[:200]:
        try:
            res = await ie.resolve_school(db, kr)
            counts[res["action"]] += 1
            preview.append({"action": res["action"], "school_id": res["school_id"]})
        except Exception as exc:
            counts["error"] += 1
            preview.append({"action": "error", "error": str(exc)})

    return {
        "headers": headers,
        "mapping": mapping,
        "rows_preview": preview,
        "rows_keyed": keyed[:1000],
        # rows_raw is keyed by SOURCE header so the UI can re-key any column
        # through the user's edited mapping (incl. columns that auto-mapped to
        # nothing but the user later assigns a field).
        "rows_raw": rows[:1000],
        "counts": counts,
        "total": len(keyed),
    }


# ---------------------------------------------------------------------------
# Import execute
# ---------------------------------------------------------------------------

@router.post("/import/execute")
async def import_execute(payload: dict, user: dict = Depends(get_current_user)):
    """Commit pre-mapped rows, learn confirmed aliases, and write an import_log.

    Body: {rows_keyed: [...], mapping: [...], create_leads: bool}
    Returns: {by, counts, at} plus import log id.
    """
    require_module(user, "settings", "read_write")
    rows = payload.get("rows_keyed") or []
    create_leads = bool(payload.get("create_leads"))

    # Defense-in-depth: only allow keys that are real registered field keys
    # (plus the "school_id" control key). Drops anything a client injects that
    # is not a known field, so it can never reach commit_row / custom_fields.
    allowed_keys = {f["key"] for f in await fr.list_fields(db)}
    allowed_keys.add("school_id")
    rows = [{k: v for k, v in (kr or {}).items() if k in allowed_keys} for kr in rows]

    # Learn confirmed aliases: add normalized source header to each mapped field's aliases
    for m in payload.get("mapping", []):
        if m.get("field_id") and m.get("source"):
            await db.field_definitions.update_one(
                {"field_id": m["field_id"]},
                {"$addToSet": {"aliases": fr.normalize_header(m["source"])}},
            )

    counts = {"create": 0, "update": 0, "needs_review": 0, "error": 0}
    for kr in rows:
        try:
            result = await ie.commit_row(db, kr, user, create_leads)
            counts[result["action"]] += 1
        except Exception:
            counts["error"] += 1

    log = {
        "by": user.get("email"),
        "counts": counts,
        "at": datetime.now(timezone.utc).isoformat(),
    }
    insert_result = await db.import_logs.insert_one(dict(log))
    log["log_id"] = str(insert_result.inserted_id)
    return log


# ---------------------------------------------------------------------------
# Import template
# ---------------------------------------------------------------------------

@router.get("/import/template")
async def import_template(
    with_ids: bool = False,
    user: dict = Depends(get_current_user),
):
    """Return template headers (and optionally existing school rows with IDs).

    Query param: with_ids=true → prepend School ID column and populate rows
    from the existing schools collection.
    """
    require_module(user, "settings", "read_write")
    fields = await fr.list_fields(db)
    headers = (["School ID"] if with_ids else []) + [f["label"] for f in fields]
    rows = []
    if with_ids:
        async for s in db.schools.find(
            {"is_deleted": {"$ne": True}},
            {"_id": 0, "school_id": 1, "school_name": 1},
        ):
            rows.append({
                "School ID": s.get("school_id", ""),
                "School/Institute Name": s.get("school_name", ""),
            })
    return {"headers": headers, "rows": rows}
