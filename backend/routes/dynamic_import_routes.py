"""dynamic_import_routes.py — HTTP API for field definitions and master-data import.

Exposes:
  GET  /fields                        – list active field definitions (admin only)
  POST /fields                        – create custom field (admin only)
  PUT  /fields/{field_id}             – update field (admin only)
  DELETE /fields/{field_id}           – soft-delete custom field (admin only)
  POST /master-import/preview         – parse + propose mapping + resolve preview
  POST /master-import/execute         – commit rows + learn aliases + write import_log
  GET  /master-import/template        – downloadable template headers (+ existing ids)

Paths use /master-import/ prefix (not /import/) to avoid shadowing the legacy
generic importer registered earlier in main.py under admin_router.
"""

from datetime import datetime, timezone
from io import BytesIO

from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from fastapi.responses import Response
from openpyxl import Workbook

from auth_utils import get_current_user
from rbac import require_admin, require_module
import field_registry as fr
import import_engine as ie
from database import db

router = APIRouter(tags=["dynamic-import"])

# Upper bound on rows carried through preview→execute. Large enough that real
# imports are never silently truncated (the old [:1000] slice dropped rows with
# no warning); capped only to bound a single request's memory.
MAX_IMPORT_ROWS = 50000


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

@router.post("/master-import/preview")
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

    # Reassign-on-import: which EXISTING schools would change owner. Bounded scan
    # (owner reassignment is typically a small, targeted import); the UI renders
    # these as a confirm-before-commit review panel.
    reassignments = []
    for kr in keyed[:2000]:
        try:
            plan = await _reassign_plan_for_row(kr)
            if plan and plan["status"] in ("reassign", "owner_unmatched"):
                reassignments.append(plan)
        except Exception:
            pass

    truncated = len(keyed) > MAX_IMPORT_ROWS
    return {
        "headers": headers,
        "mapping": mapping,
        "rows_preview": preview,
        "rows_keyed": keyed[:MAX_IMPORT_ROWS],
        # rows_raw is keyed by SOURCE header so the UI can re-key any column
        # through the user's edited mapping (incl. columns that auto-mapped to
        # nothing but the user later assigns a field).
        "rows_raw": rows[:MAX_IMPORT_ROWS],
        "counts": counts,
        "reassignments": reassignments,
        "total": len(keyed),
        "truncated": truncated,   # true only past MAX_IMPORT_ROWS (never silent)
    }


# ---------------------------------------------------------------------------
# Import execute
# ---------------------------------------------------------------------------

@router.post("/master-import/execute")
async def import_execute(payload: dict, user: dict = Depends(get_current_user)):
    """Commit pre-mapped rows, learn confirmed aliases, and write an import_log.

    Body: {rows_keyed: [...], mapping: [...], create_leads: bool}
    Returns: {by, counts, at} plus import log id.
    """
    require_module(user, "settings", "read_write")
    rows = payload.get("rows_keyed") or []
    create_leads = bool(payload.get("create_leads"))
    # School ids the admin confirmed for cascade-reassignment in the review step.
    confirm_ids = set(payload.get("confirm_reassign_school_ids") or [])

    # Defense-in-depth: only allow keys that are real registered field keys
    # (plus the id control keys). Drops anything a client injects that is not a
    # known field, so it can never reach commit_row / custom_fields.
    allowed_keys = {f["key"] for f in await fr.list_fields(db)}
    allowed_keys |= set(fr.CONTROL_KEYS)   # school_id / contact_id / lead_id
    rows = [{k: v for k, v in (kr or {}).items() if k in allowed_keys} for kr in rows]

    # Learn confirmed aliases: add normalized source header to each mapped field's aliases
    for m in payload.get("mapping", []):
        if m.get("field_id") and m.get("source"):
            await db.field_definitions.update_one(
                {"field_id": m["field_id"]},
                {"$addToSet": {"aliases": fr.normalize_header(m["source"])}},
            )

    counts = {"create": 0, "update": 0, "needs_review": 0, "error": 0}
    errors: list = []      # {row, entity, error} — no longer swallowed to a count
    warnings: list = []    # {row, entity, field, message} — e.g. lossy phones
    reassigned = 0
    for idx, kr in enumerate(rows):
        try:
            result = await ie.commit_row(db, kr, user, create_leads)
            counts[result["action"]] += 1
            for w in (result.get("warnings") or []):
                warnings.append({"row": idx, **w})
            # Cascade-reassign an EXISTING school's owner when the admin confirmed
            # this school in the review step (the review only lists schools whose
            # owner genuinely changes). commit_row already sets the school's own
            # assigned_to, but NOT all its contacts/leads — the cascade completes
            # that (and _assign_school_cascade skips leads already on this owner,
            # so it never writes spurious reassignment history).
            if result["action"] == "update" and result.get("school_id") in confirm_ids:
                from routes.crm_routes import resolve_owner, _assign_school_cascade
                raw_owner = (ie.split_values(kr).get("lead") or {}).get("assigned_to", "")
                if raw_owner:
                    owner_email, owner_name = await resolve_owner(db, raw_owner)
                    if owner_email:
                        await _assign_school_cascade(
                            result["school_id"], owner_email, owner_name, user)
                        reassigned += 1
        except Exception as exc:
            counts["error"] += 1
            errors.append({"row": idx, "entity": "row", "error": str(exc)})

    log = {
        "by": user.get("email"),
        "counts": counts,
        "errors": errors,
        "warnings": warnings,
        "reassigned": reassigned,
        "total": len(rows),
        "create_leads": create_leads,
        "at": datetime.now(timezone.utc).isoformat(),
    }
    insert_result = await db.import_logs.insert_one(dict(log))
    log["log_id"] = str(insert_result.inserted_id)
    return log


# ---------------------------------------------------------------------------
# Import template
# ---------------------------------------------------------------------------

@router.get("/master-import/template")
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
    # id control columns first so a re-upload round-trips and upserts by id
    id_cols = ["School ID", "Contact ID", "Lead ID"] if with_ids else []
    headers = id_cols + [f["label"] for f in fields]
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


# ---------------------------------------------------------------------------
# Master-data export (round-trips back through preview/execute)
# ---------------------------------------------------------------------------

def _cell(value) -> str:
    """Coerce a field value to a plain string for export cells."""
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return str(value)


async def _build_export(db) -> dict:
    """Build {headers, rows} for ALL schools, in the same column shape the
    importer accepts, so the exported file can be re-imported cleanly.

    The owner ("Assign To") cell is exported as the human NAME, not the email,
    so an admin can hand-edit it; the importer resolves the name back to an email.
    """
    fields = await fr.list_fields(db)
    headers = ["School ID"] + [f["label"] for f in fields]

    primary_contact_by_school: dict = {}
    async for c in db.contacts.find({"is_deleted": {"$ne": True}}):
        sid = c.get("school_id")
        if sid and sid not in primary_contact_by_school:
            primary_contact_by_school[sid] = c

    rows = []
    async for school in db.schools.find({"is_deleted": {"$ne": True}}):
        ms = fr.merge_fields(school)
        contact = primary_contact_by_school.get(school.get("school_id"), {})
        mc = fr.merge_fields(contact)

        row = {"School ID": school.get("school_id", "")}
        for f in fields:
            if f.get("maps_to") == "assigned_to":
                value = school.get("assigned_name") or school.get("assigned_to", "")
            else:
                src = mc if f.get("entity") == "contact" else ms
                value = src.get(f.get("maps_to") or f["key"], "")
            row[f["label"]] = _cell(value)
        rows.append(row)

    return {"headers": headers, "rows": rows}


@router.get("/master-import/export")
async def master_export(user: dict = Depends(get_current_user)):
    """ALL school master-data as JSON {headers, rows} (re-importable shape)."""
    require_module(user, "settings", "read_write")
    return await _build_export(db)


@router.get("/master-import/export.xlsx")
async def master_export_xlsx(user: dict = Depends(get_current_user)):
    """ALL school master-data as a downloadable .xlsx workbook."""
    require_module(user, "settings", "read_write")
    data = await _build_export(db)
    headers = data["headers"]
    wb = Workbook()
    ws = wb.active
    ws.append(headers)
    for row in data["rows"]:
        ws.append([row.get(h, "") for h in headers])
    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    return Response(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=school-master-export.xlsx"},
    )


# ---------------------------------------------------------------------------
# Reassign-on-import: owner-change planning (Feature A)
# ---------------------------------------------------------------------------

async def _reassign_plan_for_row(kr: dict):
    """Decide whether a keyed import row changes an EXISTING school's owner.

    Returns None for create rows and rows with no owner cell. Otherwise a dict
    whose ``status`` is one of "reassign" / "owner_unmatched" / "unchanged".
    Only "reassign" and "owner_unmatched" are surfaced to the review UI; the
    cascade itself runs in execute, gated on the admin's confirmed set.
    """
    from routes.crm_routes import resolve_owner  # lazy: avoid load-order cycle
    parts = ie.split_values(kr)
    raw_owner = (parts.get("lead") or {}).get("assigned_to", "")
    school_name = (parts.get("school") or {}).get("school_name", "")
    if not raw_owner:
        return None
    res = await ie.resolve_school(db, kr)
    owner_email, owner_name = await resolve_owner(db, raw_owner)
    if res["action"] != "update":
        if not owner_email:
            return {"status": "owner_unmatched", "school_id": None,
                    "school_name": school_name, "raw_owner": raw_owner}
        return None
    sid = res["school_id"]
    school = await db.schools.find_one(
        {"school_id": sid}, {"_id": 0, "school_name": 1, "assigned_to": 1, "assigned_name": 1})
    school = school or {}
    if not owner_email:
        return {"status": "owner_unmatched", "school_id": sid,
                "school_name": school.get("school_name", "") or school_name, "raw_owner": raw_owner}
    if owner_email == school.get("assigned_to", ""):
        return {"status": "unchanged"}
    contacts = await db.contacts.count_documents({"school_id": sid, "is_deleted": {"$ne": True}})
    leads = await db.leads.count_documents({"school_id": sid, "is_deleted": {"$ne": True}})
    return {
        "status": "reassign", "school_id": sid,
        "school_name": school.get("school_name", "") or school_name,
        "from_name": school.get("assigned_name", "") or school.get("assigned_to", "") or "Unassigned",
        "to_email": owner_email, "to_name": owner_name,
        "counts": {"contacts": contacts, "leads": leads},
    }
