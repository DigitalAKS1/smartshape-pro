"""CRM maintenance / data-hygiene endpoints.

Kept in its own module (not crm_routes.py) so data-cleanup tooling can evolve
without touching the hot CRM router. Read-only audit here is safe for anyone
admin; destructive cleanup (added later) is owner-only + snapshotted.

The immediate driver: a bad import created ~500 blank school rows (empty
school_name/city/contact). Before deleting anything we must SEE what's there —
especially how many blank schools still carry leads/contacts/quotes/orders,
because those must NOT be blindly removed.
"""
import re as _re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request

from database import db
from auth_utils import get_current_user
from rbac import require_admin, require_superadmin
import services.school_merge as school_merge

router = APIRouter(prefix="/crm/maintenance", tags=["crm-maintenance"])

# Collections whose presence makes a blank school "referenced" (unsafe to blind-delete).
_CHILD_COLLECTIONS = ("leads", "contacts", "quotations", "orders")


def _is_blank(school: dict) -> bool:
    """A school is 'blank' when it has no usable name — the junk-import signature."""
    return not (school.get("school_name") or "").strip()


async def _log_activity(user_email: str, action: str, entity_id: str, details: str = ""):
    """Local activity log (self-contained — no crm_routes import cycle)."""
    await db.activity_logs.insert_one({
        "log_id": f"act_{uuid.uuid4().hex[:8]}",
        "user_email": user_email,
        "action": action,
        "entity_type": "school",
        "entity_id": entity_id,
        "details": details,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })


@router.get("/blank-schools-audit")
async def blank_schools_audit(request: Request):
    """READ-ONLY. Report how many schools are blank (no name), how many of those
    are childless (safe to delete) vs still referenced, and where they came from.
    No writes. Admin only."""
    user = await get_current_user(request)
    require_admin(user)

    schools = await db.schools.find(
        {"is_deleted": {"$ne": True}},
        {"_id": 0, "school_id": 1, "school_name": 1, "city": 1,
         "created_by": 1, "created_at": 1, "assigned_name": 1, "assigned_to": 1},
    ).to_list(100000)

    blanks = [s for s in schools if _is_blank(s)]
    blank_ids = [s["school_id"] for s in blanks]

    # Count children per blank school across every collection that references it.
    async def _ref_counts(coll: str) -> dict:
        if not blank_ids:
            return {}
        rows = await db[coll].find(
            {"school_id": {"$in": blank_ids}, "is_deleted": {"$ne": True}},
            {"_id": 0, "school_id": 1},
        ).to_list(1000000)
        out = {}
        for r in rows:
            sid = r.get("school_id")
            out[sid] = out.get(sid, 0) + 1
        return out

    leads_by = await _ref_counts("leads")
    contacts_by = await _ref_counts("contacts")
    quotes_by = await _ref_counts("quotations")
    orders_by = await _ref_counts("orders")

    def _has_children(sid: str) -> bool:
        return bool(leads_by.get(sid) or contacts_by.get(sid)
                    or quotes_by.get(sid) or orders_by.get(sid))

    childless = [s for s in blanks if not _has_children(s["school_id"])]
    with_children = [s for s in blanks if _has_children(s["school_id"])]

    # Provenance: who created the blanks, and the created_at span.
    by_creator = {}
    created_ats = []
    for s in blanks:
        who = (s.get("created_by") or "unknown").strip() or "unknown"
        by_creator[who] = by_creator.get(who, 0) + 1
        if s.get("created_at"):
            created_ats.append(s["created_at"])

    return {
        "total_schools": len(schools),
        "blank_schools": len(blanks),
        "blank_childless": len(childless),          # safe to delete
        "blank_with_children": len(with_children),   # must NOT blind-delete
        "children_breakdown": {
            "leads": sum(leads_by.values()),
            "contacts": sum(contacts_by.values()),
            "quotations": sum(quotes_by.values()),
            "orders": sum(orders_by.values()),
        },
        "by_creator": by_creator,
        "created_at_earliest": min(created_ats) if created_ats else None,
        "created_at_latest": max(created_ats) if created_ats else None,
        # A small sample so the owner can eyeball what "blank" means here.
        "sample_childless_ids": [s["school_id"] for s in childless[:20]],
        "sample_with_children_ids": [s["school_id"] for s in with_children[:20]],
    }


# ---------------------------------------------------------------------------
# GUARDED bulk delete (O20 + O19 execute step) — SUPERADMIN ONLY, reversible.
# ---------------------------------------------------------------------------

async def _blank_childless_ids() -> list:
    """School ids for blank (empty-name) schools that carry ZERO leads/contacts/
    quotations/orders — the safe cleanup set for the ~516 junk-import rows."""
    schools = await db.schools.find(
        {"is_deleted": {"$ne": True}},
        {"_id": 0, "school_id": 1, "school_name": 1},
    ).to_list(100000)
    blank_ids = [s["school_id"] for s in schools if _is_blank(s)]
    if not blank_ids:
        return []
    referenced: set = set()
    for coll in _CHILD_COLLECTIONS:
        rows = await db[coll].find(
            {"school_id": {"$in": blank_ids}, "is_deleted": {"$ne": True}},
            {"_id": 0, "school_id": 1},
        ).to_list(1000000)
        referenced |= {r["school_id"] for r in rows if r.get("school_id")}
    return [sid for sid in blank_ids if sid not in referenced]


def _dedupe(ids) -> list:
    """Order-preserving dedupe + drop blanks. Duplicate ids would otherwise
    inflate confirm_count and multiply the dry-run blast radius for ONE school."""
    seen = set()
    return [x for x in (ids or []) if x and not (x in seen or seen.add(x))]


async def _has_children(sid: str) -> bool:
    """Live (non-deleted) children under a school, right now."""
    for coll in _CHILD_COLLECTIONS:
        if await db[coll].count_documents(
                {"school_id": sid, "is_deleted": {"$ne": True}}):
            return True
    return False


async def _bulk_delete_schools(ids: list, *, dry_run: bool, reason: str, actor: dict,
                               require_childless: bool = False) -> dict:
    """Shared engine for both bulk-delete endpoints.

    dry_run=True  → per-school blast radius + grand totals, writes NOTHING.
    dry_run=False → snapshot_and_delete each school's full cascade (restorable),
                    recompute stock reservations once if any orders were touched.

    require_childless=True (the delete-blank-childless path) RE-CHECKS, immediately
    before each delete, that the school still has zero children — closing the
    TOCTOU gap where a lead/contact gets attached between "compute the childless
    set" and "execute the delete". Any school that gained children in that window
    is SKIPPED (never deleted) and reported in `skipped`.

    Imports the cascade/backup helpers lazily so this module never forms an
    import cycle with crm_routes / order_routes.
    """
    from cascade_delete import build_school_plan          # lazy — avoid cycle
    from audit_backup import snapshot_and_delete, preview_counts

    ids = _dedupe(ids)

    per_school: list = []
    totals = {"schools": 0, "leads": 0, "contacts": 0, "quotations": 0, "orders": 0, "docs": 0}
    planned: list = []  # (school, plan, label, touches_orders)

    for sid in ids:
        school = await db.schools.find_one({"school_id": sid}, {"_id": 0})
        if not school:
            continue
        plan, label, touches_orders = await build_school_plan(school)
        counts = await preview_counts(plan)
        plan_total = sum(counts.values())
        children = {
            "leads": counts.get("leads", 0),
            "contacts": counts.get("contacts", 0),
            "quotations": counts.get("quotations", 0),
            "orders": counts.get("orders", 0),
        }
        per_school.append({
            "school_id": sid,
            "label": label,
            "blank": _is_blank(school),
            "children": children,
            "plan_total": plan_total,
        })
        totals["schools"] += 1
        for k in ("leads", "contacts", "quotations", "orders"):
            totals[k] += children[k]
        totals["docs"] += plan_total
        planned.append((school, plan, label, touches_orders))

    if dry_run:
        return {"dry_run": True, "schools": per_school, "totals": totals}

    backups: list = []
    skipped: list = []
    deleted = 0
    total_docs = 0
    any_orders = False
    for school, plan, label, touches_orders in planned:
        sid = school["school_id"]
        # TOCTOU guard: re-verify childlessness at EXECUTE time, not plan time.
        if require_childless and await _has_children(sid):
            skipped.append({"school_id": sid, "label": label,
                            "reason": "gained children after selection"})
            await _log_activity(
                actor.get("email", ""), "bulk_cascade_delete_skipped", sid,
                f"SKIPPED '{label}' — no longer childless at execute time")
            continue
        result = await snapshot_and_delete(
            plan, root_type="school", root_id=sid, root_label=label,
            deleted_by=actor.get("email", ""), reason=reason)
        backups.append(result["backup_id"])
        deleted += 1
        total_docs += result["total"]
        any_orders = any_orders or touches_orders
        await _log_activity(
            actor.get("email", ""), "bulk_cascade_delete", sid,
            f"Deleted school '{label}' + {result['total']} related docs "
            f"(backup {result['backup_id']}; reason: {reason or 'n/a'})")

    recomputed = False
    if any_orders:
        from routes.order_routes import recompute_reservations   # lazy — avoid cycle
        await recompute_reservations()
        recomputed = True

    return {"dry_run": False, "deleted": deleted, "backups": backups,
            "skipped": skipped, "total_docs": total_docs, "recomputed": recomputed}


@router.post("/schools/bulk-delete")
async def bulk_delete_schools(request: Request):
    """SUPERADMIN ONLY. Guarded, reversible bulk cascade-delete of schools.

    Body: {school_ids:[..], dry_run:true, confirm_count:<int>, reason:""}
    - dry_run defaults TRUE — a preview that writes nothing.
    - school_ids are DEDUPED first, so confirm_count is compared against the count
      of DISTINCT schools (a repeated id can't inflate the guard, and the dry-run
      blast radius reports one school once instead of N times).
    - to actually delete: dry_run=false AND confirm_count == distinct id count,
      else 400 (a stale UI can never over-delete).
    Every delete is snapshotted into audit_backups first, so it is restorable."""
    user = await get_current_user(request)
    require_superadmin(user)
    body = await request.json()
    school_ids = body.get("school_ids") or []
    if not isinstance(school_ids, list):
        raise HTTPException(status_code=400, detail="school_ids must be a list")
    school_ids = _dedupe(school_ids)
    dry_run = body.get("dry_run", True)
    reason = body.get("reason", "") or ""

    if not dry_run:
        if body.get("confirm_count") != len(school_ids):
            raise HTTPException(
                status_code=400,
                detail=f"confirm_count mismatch (expected {len(school_ids)} distinct schools)")

    return await _bulk_delete_schools(
        school_ids, dry_run=bool(dry_run), reason=reason, actor=user)


@router.post("/schools/delete-blank-childless")
async def delete_blank_childless_schools(request: Request):
    """SUPERADMIN ONLY. Convenience cleanup for the junk-import blanks: the server
    selects blank (empty-name) schools with ZERO children and routes them through
    the same guarded bulk-delete engine.

    Body: {dry_run:true, confirm_count:<int>, reason:""}
    - dry_run defaults TRUE.
    - to delete: dry_run=false AND confirm_count == the current childless count,
      else 400 (guards against the set having changed since the caller looked).
    - childlessness is RE-CHECKED per school immediately before its delete, so a
      school that gained a lead/contact in the meantime is skipped, never deleted
      (returned in `skipped`)."""
    user = await get_current_user(request)
    require_superadmin(user)
    body = await request.json()
    dry_run = body.get("dry_run", True)
    reason = body.get("reason", "") or ""

    ids = await _blank_childless_ids()
    if not dry_run:
        if body.get("confirm_count") != len(ids):
            raise HTTPException(status_code=400, detail="confirm_count mismatch")

    return await _bulk_delete_schools(
        ids, dry_run=bool(dry_run), reason=reason, actor=user,
        require_childless=True)


# ===========================================================================
# PHASE 4 — CRM LINK / PHONE INTEGRITY (detect + guarded, dry-run migrations)
# ---------------------------------------------------------------------------
# Fixes for the defects surfaced in the earlier CRM integrity audit:
#   D1  lead<->contact link split across lead.contact_id (create/import) vs
#       lead.converted_from_contact (convert flow) — canonicalise to
#       lead.contact_id <-> contact.lead_id.
#   D2  delete_contact left leads dangling (contact_id -> missing/soft-deleted).
#   D6  phones normalized in only one path (some raw / float / sci-notation).
# Every write endpoint is SUPERADMIN-gated, defaults dry_run=True, and snapshots
# every affected doc to audit_backups (pre-image) BEFORE mutating. All are
# idempotent / re-runnable.
# ===========================================================================

from import_engine import normalize_phone, phone_is_lossy, clean_text  # reuse the one true helpers

_CAP = 1000000

# Collections that carry a school_id FIELD on their documents (so a merge must
# reassign that field survivor<-duplicate). Derived from cascade_delete.build_school_plan
# — every entry there filtered by a bare {"school_id": sid}. Children linked only via
# lead_id/quotation_id/order_id (tasks, followups, call_notes, catalogue_selections,
# order_items, payments, ...) follow their parent automatically and need no rewrite.
# NOTE: field_visits belongs here too — sales reps write it on every GPS check-in
# (field_routes) and it carries school_id. It was missing from BOTH this tuple and
# cascade_delete.build_school_plan, so a merge left every field visit of the
# duplicate pointing at a school_id that the merge then deleted (a dangling FK even
# for perfectly clean rows). Added to both.
_SCHOOL_ID_COLLECTIONS = (
    "leads", "contacts", "quotations", "orders", "dispatches", "invoices",
    "visit_plans", "field_visits", "school_notifications", "school_requests",
    "teachers", "fms_flows",
)

# LEGACY SHAPE: several collections link to a school by NAME TEXT only, with NO
# school_id — quotation_routes stamps school_id only when the name lookup resolved at
# save time, reps self-create field_visits with just a name, and import_engine stamps
# `company` on every imported contact. Prod READS all of them with a
# school_id-OR-name fallback (crm_routes School-360, field_routes), and admin_routes
# even ships a dedicated backfill for "contact has company but no school_id" —
# proof it is a real production state. A merge matching strictly on school_id would
# leave such a row ORPHANED once the duplicate school row is deleted (its name then
# resolves to no school at all).
#
# The name is NOT always in `school_name`: contacts carry it in `company`. The field
# is per-collection (_NAME_FIELD) — that same field is also what gets REWRITTEN to
# the survivor's name on reassignment, so outbound email personalization and
# School-360 stop quoting the dead duplicate's spelling.
_NAME_FALLBACK_COLLECTIONS = ("quotations", "invoices", "field_visits", "contacts")

_NAME_FIELD = {
    "quotations": "school_name",
    "invoices": "school_name",
    "field_visits": "school_name",
    "contacts": "company",       # import_engine:533; read by email personalization
}

# Domain primary key per name-fallback collection (never _id — house rule).
_DOC_ID_FIELD = {
    "quotations": "quotation_id",
    "invoices": "invoice_id",
    "field_visits": "visit_id",
    "contacts": "contact_id",
}

# Docs whose school_id is blank/absent — the only rows the name fallback may claim.
_NO_SCHOOL_ID = {"$or": [{"school_id": {"$in": ["", None]}},
                         {"school_id": {"$exists": False}}]}


async def _name_fallback_ids(coll: str, merge_name: str, cache: dict = None) -> list:
    """Doc ids of legacy rows in `coll` that carry the school's NAME TEXT (in that
    collection's _NAME_FIELD) but NO school_id, whose NORMALIZED name equals the merge
    school's normalized name.

    Matching must use _norm_school_name — the SAME key the merge-candidate report
    groups by — not raw string equality: the dirty data this importer produces differs
    by case / double spaces / mojibake ("ST XAVIERS  HIGH SCHOOL" vs "St Xaviers High
    School"), and an exact-match fallback silently misses exactly those rows. Mongo
    can't normalize server-side, so we post-filter in Python.

    Rows that already have a populated (different) school_id are NEVER candidates, so
    the no-over-capture property holds. A blank merge_name disables the fallback.

    `cache` keys on (coll, normalized_name): a 3-way merge otherwise re-scans each
    collection once per merge_id per call-site.
    """
    target = _norm_school_name(merge_name)
    if not target:
        return []   # blank merge name disables the fallback entirely
    key = (coll, target)
    if cache is not None and key in cache:
        return cache[key]

    idf = _DOC_ID_FIELD[coll]
    namef = _NAME_FIELD[coll]
    rows = await db[coll].find(
        _NO_SCHOOL_ID, {"_id": 0, idf: 1, namef: 1}).to_list(_CAP)
    ids = [r[idf] for r in rows
           if r.get(idf) and _norm_school_name(r.get(namef)) == target]
    if cache is not None:
        cache[key] = ids
    return ids


async def _merge_match_query(coll: str, merge_id: str, merge_name: str,
                             cache: dict = None) -> dict:
    """The query for docs belonging to `merge_id` — school_id matches, plus (for the
    name-fallback collections) the legacy name-only rows resolved by NORMALIZED name.

    Resolve this ONCE per (merge_id, coll) and reuse it for the dry-run counts, the
    child pre-image snapshot AND the reassignment — the three must never drift (the
    reassignment itself changes school_id, so re-resolving afterwards would return a
    different set)."""
    base = {"school_id": merge_id}
    if coll not in _NAME_FALLBACK_COLLECTIONS or not merge_name:
        return base
    ids = await _name_fallback_ids(coll, merge_name, cache)
    if not ids:
        return base
    return {"$or": [base, {_DOC_ID_FIELD[coll]: {"$in": ids}}]}


async def _ambiguous_name_rivals(merge_ids: list, survivor_id: str,
                                 merge_name: str) -> list:
    """Live schools OUTSIDE this merge that share the duplicate's normalized name.

    When a chain name repeats ("DAV Public School", "Kendriya Vidyalaya"), a
    blank-school_id legacy row matching that name could belong to any of them. The
    ground truth is unknowable from the data, so we still move it with the merge —
    but the operator must SEE the guess instead of it happening silently."""
    target = _norm_school_name(merge_name)
    if not target:
        return []
    others = await db.schools.find(
        {"is_deleted": {"$ne": True}}, {"_id": 0, "school_id": 1, "school_name": 1},
    ).to_list(_CAP)
    excluded = set(merge_ids) | {survivor_id}
    return [o["school_id"] for o in others
            if o.get("school_id") not in excluded
            and _norm_school_name(o.get("school_name")) == target]


def _blankish(v) -> bool:
    """True when a link field is absent/None/empty-string."""
    return not (v or "").strip() if isinstance(v, str) else v is None


# A cell holding MORE THAN ONE value ("9876543210 / 9123456789") or an embedded
# extension ("0120-4213000 ext 105"). normalize_phone() strips every non-digit and
# CONCATENATES the runs, which silently fabricates a wrong number — so these must
# never be auto-repaired. Detect them BEFORE normalizing.
_MULTI_SEP_RE = _re.compile(r"[/,;|]")
_EXT_RE = _re.compile(r"(?i)(?:ext\.?|extn\.?|x)\s*\d")
_E164_MAX_DIGITS = 15   # ITU E.164 hard cap — anything longer is not one number
_DIGITS_RE = _re.compile(r"\d")
_COMPLETE_NUMBER_DIGITS = 10   # a 10-digit run is already a whole Indian mobile
_MIN_EXTENSION_DIGITS = 3      # extensions/second numbers are >=3 digits; 1-2 is a stray


def _has_trailing_extra_group(s: str) -> bool:
    """True when a COMPLETE number is followed by a TRAILING RUN that is itself a
    plausible extension or second number — i.e. typed with no separator char and no
    'ext' keyword ("9876543210 105", "9876543210 9123456789").

    Two conditions must BOTH hold:
      1. some PROPER PREFIX of the whitespace-separated digit groups already forms a
         complete number (>= _COMPLETE_NUMBER_DIGITS), i.e. the number was finished
         and something still follows; and
      2. the digits REMAINING after that point, summed alone, are >= _MIN_EXTENSION_DIGITS
         — a real extension/second number, not a stray 1-2 digit fragment.

    Condition 2 is what stops the false-positive on an oddly-grouped SINGLE number
    (a copy-paste-from-PDF artifact). Worked examples:

        "9876543210 105"    -> prefix 10, tail 3  -> BOTH  -> needs_review
        "98765 43210 105"   -> prefix 10, tail 3  -> BOTH  -> needs_review
        "09876543210 105"   -> prefix 11, tail 3  -> BOTH  -> needs_review
        "+91 98 765 432 10" -> prefix 10, tail 2  -> tail too short -> recoverable
                               (this IS one valid mobile: +919876543210)
        "+91 98765 43210"   -> no proper prefix reaches 10        -> recoverable
        "0120 421 3000"     -> no proper prefix reaches 10        -> recoverable
        "987654321 0"       -> prefix 9 (<10)                     -> recoverable

    Note the derived call on "9876543210 0": tail is 1 digit, so it is NOT treated as
    an extension and stays 'recoverable'. A 1-2 digit tail is far likelier a stray
    keystroke than an extension, and the E.164 cap still guards absurd lengths.
    """
    groups = [t for t in s.split() if _DIGITS_RE.search(t)]
    if len(groups) < 2:
        return False
    counts = [len(_re.sub(r"\D", "", g)) for g in groups]
    total = sum(counts)
    seen = 0
    for i, n in enumerate(counts):
        seen += n
        if seen >= _COMPLETE_NUMBER_DIGITS and i < len(counts) - 1:
            # The number is already complete here — is what follows a real extension?
            return (total - seen) >= _MIN_EXTENSION_DIGITS
    return False


def _phone_category(raw) -> str:
    """Classify a raw phone value for the repair pass.

    - 'empty'        : no usable phone.
    - 'lossy'        : scientific-notation (e.g. "9.17709E+11") — digits already
                       gone, UNRECOVERABLE; flag, never normalize.
    - 'needs_review' : normalizing would FABRICATE a number — a multi-value cell
                       ("a / b"), an embedded extension ("... ext 105"), a BARE
                       extension / second number after a plain space
                       ("9876543210 105"), or a digit run longer than E.164 allows.
                       Human must split/verify it, so we flag it and leave `phone`
                       untouched (same policy as lossy).
    - 'clean'        : already equals its normalized form.
    - 'recoverable'  : a SINGLE number that normalizing merely tidies (trailing
                       '.0', spaces, dashes, parens, +91, or a numeric/float value).
    """
    if raw is None:
        return "empty"
    if isinstance(raw, str) and not raw.strip():
        return "empty"
    if phone_is_lossy(raw):
        return "lossy"

    if isinstance(raw, str):
        s = raw.strip()
        if (_MULTI_SEP_RE.search(s) or _EXT_RE.search(s)
                or _has_trailing_extra_group(s)):
            return "needs_review"

    norm = normalize_phone(raw)
    if not norm:
        return "empty"
    if len(norm.lstrip("+")) > _E164_MAX_DIGITS:
        # Belt-and-braces: any run past the E.164 cap cannot be one dialable number.
        return "needs_review"
    if isinstance(raw, str) and raw.strip() == norm:
        return "clean"
    return "recoverable"


def _dup_values(rows: list, key: str) -> list:
    """Return [{value, count}] for id values that appear more than once."""
    counts = {}
    for r in rows:
        v = r.get(key)
        if v is None:
            continue
        counts[v] = counts.get(v, 0) + 1
    return sorted(
        ({"value": v, "count": n} for v, n in counts.items() if n > 1),
        key=lambda d: (-d["count"], str(d["value"])),
    )


async def _integrity_report() -> dict:
    """Pure read-only integrity scan (no writes). Factored out so tests can call
    it directly and the endpoint stays a thin auth wrapper."""
    leads = await db.leads.find({}, {"_id": 0}).to_list(_CAP)
    contacts = await db.contacts.find({}, {"_id": 0}).to_list(_CAP)
    schools = await db.schools.find({}, {"_id": 0}).to_list(_CAP)

    # Contact lookup incl. soft-delete state (dangling detection needs deleted rows).
    contact_by_id = {c.get("contact_id"): c for c in contacts if c.get("contact_id")}

    # --- D1: link-model split & bidirectional gaps -------------------------
    cfc_no_contact_id = 0        # converted_from_contact set but contact_id blank
    dangling_contact_id = 0      # contact_id -> missing OR soft-deleted contact (D2)
    lead_contact_id_no_backref = 0   # valid contact_id but contact.lead_id != this lead
    for l in leads:
        cid = l.get("contact_id")
        cfc = l.get("converted_from_contact")
        if not _blankish(cfc) and _blankish(cid):
            cfc_no_contact_id += 1
        if not _blankish(cid):
            c = contact_by_id.get(cid)
            if c is None or c.get("is_deleted"):
                dangling_contact_id += 1
            elif c.get("lead_id") != l.get("lead_id"):
                lead_contact_id_no_backref += 1

    # contacts converted-to-lead but no live lead points back
    lead_ptr = set()   # contact_ids that a live lead points at (either link style)
    for l in leads:
        if l.get("is_deleted"):
            continue
        for k in ("contact_id", "converted_from_contact"):
            v = l.get(k)
            if not _blankish(v):
                lead_ptr.add(v)
    contacts_converted_no_lead = sum(
        1 for c in contacts
        if c.get("converted_to_lead") and not c.get("is_deleted")
        and c.get("contact_id") not in lead_ptr
    )

    # --- D3: duplicate ids -------------------------------------------------
    dup_school_id = _dup_values(schools, "school_id")
    dup_lead_id = _dup_values(leads, "lead_id")

    # --- D5: soft-deleted schools that still have non-deleted children -----
    deleted_school_ids = [s.get("school_id") for s in schools
                          if s.get("is_deleted") and s.get("school_id")]
    schools_deleted_with_children = 0
    if deleted_school_ids:
        dset = set(deleted_school_ids)
        with_kids = set()
        for coll in _CHILD_COLLECTIONS:
            rows = await db[coll].find(
                {"school_id": {"$in": deleted_school_ids}, "is_deleted": {"$ne": True}},
                {"_id": 0, "school_id": 1},
            ).to_list(_CAP)
            with_kids |= {r["school_id"] for r in rows if r.get("school_id") in dset}
        schools_deleted_with_children = len(with_kids)

    # --- D6: phone hygiene, per collection ---------------------------------
    def _phone_stats(rows: list) -> dict:
        stat = {"total": 0, "lossy": 0, "needs_review": 0,
                "recoverable": 0, "clean": 0, "empty": 0}
        for r in rows:
            stat["total"] += 1
            stat[_phone_category(r.get("phone"))] += 1
        return stat

    phones = {
        "schools": _phone_stats(schools),
        "contacts": _phone_stats(contacts),
        "leads": _phone_stats(leads),
    }

    return {
        "links": {
            "converted_from_no_contact_id": cfc_no_contact_id,
            "dangling_contact_id": dangling_contact_id,
            "lead_contact_id_no_backref": lead_contact_id_no_backref,
            "contacts_converted_no_lead": contacts_converted_no_lead,
        },
        "duplicates": {
            "school_id": dup_school_id,
            "lead_id": dup_lead_id,
        },
        "schools_soft_deleted_with_children": schools_deleted_with_children,
        "phones": phones,
        "counts": {"leads": len(leads), "contacts": len(contacts),
                   "schools": len(schools)},
    }


@router.get("/integrity-detect")
async def integrity_detect(request: Request):
    """SUPERADMIN, READ-ONLY. Full CRM link/id/phone integrity report. No writes."""
    user = await get_current_user(request)
    require_superadmin(user)
    return await _integrity_report()


# ---------------------------------------------------------------------------
# 2. unify-links — canonical lead.contact_id <-> contact.lead_id
# ---------------------------------------------------------------------------

async def _plan_unify_links():
    """Return (leads_to_set_contact_id, contacts_to_backref) as lists of tuples.

    leads_to_set_contact_id : [(lead_id, contact_id)]  — copy converted_from_contact
                              into a blank contact_id.
    contacts_to_backref     : [(contact_id, lead_id)]  — set contact.lead_id +
                              converted_to_lead=True for every live, existing contact
                              a lead validly points at but which lacks the back-pointer.
    """
    leads = await db.leads.find({}, {"_id": 0}).to_list(_CAP)
    contacts = await db.contacts.find({}, {"_id": 0}).to_list(_CAP)
    contact_by_id = {c.get("contact_id"): c for c in contacts if c.get("contact_id")}

    leads_to_set = []
    for l in leads:
        cid, cfc = l.get("contact_id"), l.get("converted_from_contact")
        if not _blankish(cfc) and _blankish(cid):
            leads_to_set.append((l.get("lead_id"), cfc))

    # Effective contact_id after phase A (so phase B sees the unified link).
    contacts_to_backref = []
    seen_pairs = set()
    for l in leads:
        eff_cid = l.get("contact_id")
        if _blankish(eff_cid):
            eff_cid = l.get("converted_from_contact")
        if _blankish(eff_cid):
            continue
        c = contact_by_id.get(eff_cid)
        if c is None or c.get("is_deleted"):
            continue   # dangling — handled by the dangling repair, not here
        lid = l.get("lead_id")
        if c.get("lead_id") != lid or not c.get("converted_to_lead"):
            pair = (eff_cid, lid)
            if pair not in seen_pairs:
                seen_pairs.add(pair)
                contacts_to_backref.append(pair)
    return leads_to_set, contacts_to_backref


@router.post("/migrate/unify-links")
async def migrate_unify_links(request: Request):
    """SUPERADMIN. Canonicalise the lead<->contact link. dry_run defaults TRUE.

    Body: {dry_run:true, reason:""}. Idempotent. On a real run, snapshots every
    affected lead+contact (pre-image) to audit_backups BEFORE writing."""
    user = await get_current_user(request)
    require_superadmin(user)
    body = await request.json()
    dry_run = body.get("dry_run", True)
    reason = body.get("reason", "") or ""

    leads_to_set, contacts_to_backref = await _plan_unify_links()

    result = {
        "dry_run": bool(dry_run),
        "leads_would_set_contact_id": len(leads_to_set),
        "contacts_would_backref": len(contacts_to_backref),
        "sample_leads": [{"lead_id": lid, "contact_id": cid}
                         for lid, cid in leads_to_set[:20]],
        "sample_contacts": [{"contact_id": cid, "lead_id": lid}
                            for cid, lid in contacts_to_backref[:20]],
    }
    if dry_run:
        return result

    lead_ids = {lid for lid, _ in leads_to_set}
    contact_ids = {cid for cid, _ in contacts_to_backref}
    if lead_ids or contact_ids:
        from audit_backup import snapshot_only
        plan = []
        if lead_ids:
            plan.append(("leads", {"lead_id": {"$in": list(lead_ids)}}))
        if contact_ids:
            plan.append(("contacts", {"contact_id": {"$in": list(contact_ids)}}))
        backup = await snapshot_only(
            plan, root_type="migration", root_id="unify-links",
            root_label="unify lead<->contact links",
            backed_up_by=user.get("email", ""), reason=reason)
        result["backup_id"] = backup["backup_id"]

    now_iso = datetime.now(timezone.utc).isoformat()
    for lid, cid in leads_to_set:
        await db.leads.update_one({"lead_id": lid}, {"$set": {"contact_id": cid}})
    for cid, lid in contacts_to_backref:
        await db.contacts.update_one(
            {"contact_id": cid},
            {"$set": {"lead_id": lid, "converted_to_lead": True,
                      "last_activity_date": now_iso}})

    result["leads_updated"] = len(leads_to_set)
    result["contacts_updated"] = len(contacts_to_backref)
    await _log_activity(user.get("email", ""), "migrate_unify_links", "unify-links",
                        f"set {len(leads_to_set)} lead.contact_id, "
                        f"{len(contacts_to_backref)} contact back-refs "
                        f"(reason: {reason or 'n/a'})")
    return result


# ---------------------------------------------------------------------------
# 3. dangling-contact-links — unset contact_id -> missing/deleted contact (D2)
# ---------------------------------------------------------------------------

async def _plan_dangling():
    """Return [lead, ...] for leads whose contact_id points at a missing or
    soft-deleted contact."""
    leads = await db.leads.find({}, {"_id": 0}).to_list(_CAP)
    contacts = await db.contacts.find({}, {"_id": 0, "contact_id": 1, "is_deleted": 1}).to_list(_CAP)
    contact_by_id = {c.get("contact_id"): c for c in contacts if c.get("contact_id")}
    out = []
    for l in leads:
        cid = l.get("contact_id")
        if _blankish(cid):
            continue
        c = contact_by_id.get(cid)
        if c is None or c.get("is_deleted"):
            out.append(l)
    return out


@router.post("/repair/dangling-contact-links")
async def repair_dangling_contact_links(request: Request):
    """SUPERADMIN. Unset contact_id (and converted_from_contact when it matches)
    on leads pointing at a missing/soft-deleted contact. dry_run defaults TRUE;
    a real run snapshots the affected leads first. Idempotent."""
    user = await get_current_user(request)
    require_superadmin(user)
    body = await request.json()
    dry_run = body.get("dry_run", True)
    reason = body.get("reason", "") or ""

    dangling = await _plan_dangling()
    result = {
        "dry_run": bool(dry_run),
        "leads_would_unset": len(dangling),
        "sample": [{"lead_id": l.get("lead_id"), "contact_id": l.get("contact_id")}
                   for l in dangling[:20]],
    }
    if dry_run or not dangling:
        return result

    from audit_backup import snapshot_only
    lead_ids = [l.get("lead_id") for l in dangling]
    backup = await snapshot_only(
        [("leads", {"lead_id": {"$in": lead_ids}})],
        root_type="migration", root_id="dangling-contact-links",
        root_label="unset dangling lead.contact_id",
        backed_up_by=user.get("email", ""), reason=reason)
    result["backup_id"] = backup["backup_id"]

    for l in dangling:
        cid = l.get("contact_id")
        unset = {"contact_id": ""}
        if l.get("converted_from_contact") == cid:
            unset["converted_from_contact"] = ""
        await db.leads.update_one({"lead_id": l.get("lead_id")}, {"$unset": unset})

    result["leads_unset"] = len(dangling)
    await _log_activity(user.get("email", ""), "repair_dangling_links",
                        "dangling-contact-links",
                        f"unset {len(dangling)} dangling lead.contact_id "
                        f"(reason: {reason or 'n/a'})")
    return result


# ---------------------------------------------------------------------------
# 4. phones — normalize recoverable, flag lossy (D6)
# ---------------------------------------------------------------------------

_PHONE_COLLECTIONS = ("schools", "contacts", "leads")


_PHONE_ID_FIELD = {"schools": "school_id", "contacts": "contact_id", "leads": "lead_id"}


async def _plan_phones():
    """Return {coll: {"recoverable": [(id_field, id_val, norm)],
                      "lossy": [(id_field, id_val)],
                      "needs_review": [(id_field, id_val)]}} for the phone repair.

    Only 'recoverable' rows are ever rewritten. 'lossy' and 'needs_review' are
    FLAGGED ONLY — their `phone` is never overwritten, because normalizing them
    would fabricate a wrong number (see _phone_category)."""
    plan = {}
    for coll in _PHONE_COLLECTIONS:
        idf = _PHONE_ID_FIELD[coll]
        rows = await db[coll].find({}, {"_id": 0, idf: 1, "phone": 1}).to_list(_CAP)
        rec, lossy, review = [], [], []
        for r in rows:
            cat = _phone_category(r.get("phone"))
            if cat == "recoverable":
                rec.append((idf, r.get(idf), normalize_phone(r.get("phone"))))
            elif cat == "lossy":
                lossy.append((idf, r.get(idf)))
            elif cat == "needs_review":
                review.append((idf, r.get(idf)))
        plan[coll] = {"recoverable": rec, "lossy": lossy, "needs_review": review}
    return plan


@router.post("/repair/phones")
async def repair_phones(request: Request):
    """SUPERADMIN. For schools/contacts/leads:

      - recoverable  → rewrite phone + phone_norm to the normalized single number.
      - lossy        → flag phone_needs_reimport=True; `phone` NEVER overwritten.
      - needs_review → flag phone_needs_review=True; `phone` NEVER overwritten
                       (multi-value cell / embedded extension / over-long digit run —
                       normalizing would fabricate a wrong number).

    dry_run defaults TRUE and reports all three buckets so the owner can see what
    is being SKIPPED, not just what changes. A real run snapshots every touched doc
    first. Idempotent."""
    user = await get_current_user(request)
    require_superadmin(user)
    body = await request.json()
    dry_run = body.get("dry_run", True)
    reason = body.get("reason", "") or ""

    plan = await _plan_phones()
    per_coll = {c: {"recoverable": len(v["recoverable"]),
                    "lossy": len(v["lossy"]),
                    "needs_review": len(v["needs_review"])}
                for c, v in plan.items()}
    result = {
        "dry_run": bool(dry_run),
        "per_collection": per_coll,
        "totals": {
            "recoverable": sum(v["recoverable"] for v in per_coll.values()),
            "lossy": sum(v["lossy"] for v in per_coll.values()),
            "needs_review": sum(v["needs_review"] for v in per_coll.values()),
        },
        # Sample the values we refuse to touch, so the owner can eyeball them.
        "skipped_samples": {
            c: [t[1] for t in (v["lossy"] + v["needs_review"])][:10]
            for c, v in plan.items() if (v["lossy"] or v["needs_review"])
        },
    }
    if dry_run:
        return result

    # Snapshot every doc we'll touch (pre-image), per collection.
    from audit_backup import snapshot_only
    snap_plan = []
    for coll, v in plan.items():
        idf = _PHONE_ID_FIELD[coll]
        touched_ids = ([t[1] for t in v["recoverable"]]
                       + [t[1] for t in v["lossy"]]
                       + [t[1] for t in v["needs_review"]])
        if touched_ids:
            snap_plan.append((coll, {idf: {"$in": touched_ids}}))
    if snap_plan:
        backup = await snapshot_only(
            snap_plan, root_type="migration", root_id="repair-phones",
            root_label="normalize/flag phones",
            backed_up_by=user.get("email", ""), reason=reason)
        result["backup_id"] = backup["backup_id"]

    for coll, v in plan.items():
        for idf, idv, norm in v["recoverable"]:
            await db[coll].update_one(
                {idf: idv}, {"$set": {"phone": norm, "phone_norm": norm}})
        # Flag-only paths: `phone` is deliberately NOT in the $set.
        for idf, idv in v["lossy"]:
            await db[coll].update_one(
                {idf: idv},
                {"$set": {"phone_needs_reimport": True, "phone_norm": ""}})
        for idf, idv in v["needs_review"]:
            await db[coll].update_one(
                {idf: idv},
                {"$set": {"phone_needs_review": True, "phone_norm": ""}})

    result["applied"] = per_coll
    await _log_activity(user.get("email", ""), "repair_phones", "repair-phones",
                        f"normalized {result['totals']['recoverable']}, "
                        f"flagged {result['totals']['lossy']} lossy + "
                        f"{result['totals']['needs_review']} needs-review "
                        f"(reason: {reason or 'n/a'})")
    return result


# ===========================================================================
# PHASE 4b — SCHOOL DEDUP / MERGE (name-collision merge the ID-upsert can't do)
# ---------------------------------------------------------------------------
# Two schools with the SAME (normalized) name but DIFFERENT school_ids can't be
# merged by the ID-based import upsert. Merge = FK-reassign every child from the
# duplicate(s) onto a survivor school_id, then snapshot-and-delete the emptied
# duplicate school doc (restorable). Superadmin-gated, dry_run defaults TRUE,
# every write snapshotted first.
# ===========================================================================


def _norm_school_name(name) -> str:
    """Canonical key for name-collision grouping: mojibake-repaired, lowercased,
    trimmed, internal whitespace collapsed. 'ST. XAVIERâ€™S  High School ' and
    'St. Xavier's High School' collapse to the same key."""
    cleaned = clean_text(name) if isinstance(name, str) else ""
    cleaned = (cleaned or "").strip().lower()
    return " ".join(cleaned.split())


async def _school_child_counts(sid: str) -> dict:
    """Non-deleted child counts for one school across the headline collections."""
    out = {}
    for coll in _CHILD_COLLECTIONS:
        out[coll] = await db[coll].count_documents(
            {"school_id": sid, "is_deleted": {"$ne": True}})
    return out


@router.get("/duplicate-schools")
async def duplicate_schools(request: Request):
    """SUPERADMIN, READ-ONLY. Group non-deleted schools by NORMALIZED name and
    return every group with >1 distinct school_id — the merge-candidate report.
    Groups sorted by total children desc. No writes."""
    user = await get_current_user(request)
    require_superadmin(user)

    schools = await db.schools.find(
        {"is_deleted": {"$ne": True}},
        {"_id": 0, "school_id": 1, "school_name": 1, "city": 1, "created_at": 1},
    ).to_list(_CAP)

    groups = {}
    for s in schools:
        key = _norm_school_name(s.get("school_name"))
        if not key:
            continue   # blank-name rows are the delete-blank-childless job, not merge
        groups.setdefault(key, []).append(s)

    out = []
    for key, members in groups.items():
        distinct_ids = {m["school_id"] for m in members}
        if len(distinct_ids) < 2:
            continue
        detailed = []
        group_total = 0
        for m in members:
            children = await _school_child_counts(m["school_id"])
            group_total += sum(children.values())
            detailed.append({
                "school_id": m["school_id"],
                "school_name": m.get("school_name", ""),
                "city": m.get("city", ""),
                "created_at": m.get("created_at", ""),
                "children": children,
            })
        detailed.sort(key=lambda d: sum(d["children"].values()), reverse=True)
        out.append({
            "normalized_name": key,
            "total_children": group_total,
            "schools": detailed,
        })

    out.sort(key=lambda g: g["total_children"], reverse=True)
    return {"groups": out, "group_count": len(out)}


# --- Fuzzy near-duplicate detection (name + city + address) ------------------
# Complements /duplicate-schools (exact normalized-name): surfaces likely dups
# that DON'T share an identical name — "St Xaviers School" vs "St. Xavier's High
# School". Read-only; the operator reviews each pair and merges via the existing
# guarded /schools/merge (now with a field-by-field picker). SUPERADMIN.

_FUZZY_FIELDS = {"_id": 0, "school_id": 1, "school_name": 1, "city": 1, "state": 1,
                 "address": 1, "phone": 1, "email": 1, "board": 1, "school_type": 1,
                 "pincode": 1, "assigned_to": 1, "assigned_name": 1}


@router.get("/duplicate-schools/fuzzy")
async def duplicate_schools_fuzzy(request: Request):
    """SUPERADMIN, READ-ONLY. Fuzzy-scored likely-duplicate school PAIRS on
    name+city+address, highest score first, excluding pairs whose normalized
    names are identical (those are the exact-name report) and pairs the operator
    dismissed. No writes."""
    user = await get_current_user(request)
    require_superadmin(user)
    schools = await db.schools.find({"is_deleted": {"$ne": True}}, _FUZZY_FIELDS).to_list(_CAP)

    dismissed = set()
    async for d in db.merge_dismissals.find({}, {"_id": 0, "pair": 1}):
        p = d.get("pair") or []
        if len(p) == 2:
            dismissed.add(frozenset(p))

    pairs = school_merge.find_candidates(schools)
    out = []
    for score, a, b in pairs:
        # skip exact-name pairs — already covered by /duplicate-schools
        if _norm_school_name(a.get("school_name")) == _norm_school_name(b.get("school_name")):
            continue
        if frozenset((a["school_id"], b["school_id"])) in dismissed:
            continue
        out.append({
            "score": score, "a": a, "b": b,
            "a_children": await _school_child_counts(a["school_id"]),
            "b_children": await _school_child_counts(b["school_id"]),
        })
        if len(out) >= 100:
            break
    return {"candidates": out, "candidate_count": len(out)}


@router.post("/duplicate-schools/dismiss")
async def dismiss_duplicate_pair(request: Request):
    """SUPERADMIN. Remember a 'not a duplicate' decision so the fuzzy report never
    re-suggests the pair."""
    user = await get_current_user(request)
    require_superadmin(user)
    body = await request.json()
    a = (body.get("a_id") or "").strip()
    b = (body.get("b_id") or "").strip()
    if not a or not b:
        raise HTTPException(status_code=400, detail="a_id and b_id required")
    pair = sorted([a, b])
    await db.merge_dismissals.update_one(
        {"pair": pair},
        {"$set": {"pair": pair, "by": user.get("email", ""),
                  "at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return {"dismissed": pair}


async def _resolve_merge_queries(merge_ids: list, merge_names: dict):
    """Resolve, ONCE and up-front, everything the merge needs to know about which
    rows move. Returns (queries, fallback_ids):

      queries[(merge_id, coll)]      -> the mongo query (school_id + name fallback)
      fallback_ids[(merge_id, coll)] -> the name-matched doc ids for that pair

    Single source of truth for the dry-run counts, the ambiguity report, the child
    pre-image snapshot and the reassignment, so those can never disagree about which
    rows move. One shared cache means each (collection, normalized-name) is scanned
    at most once no matter how many merge_ids or call sites."""
    cache: dict = {}
    queries, fallback_ids = {}, {}
    for mid in merge_ids:
        mname = merge_names.get(mid, "")
        for coll in _SCHOOL_ID_COLLECTIONS:
            queries[(mid, coll)] = await _merge_match_query(coll, mid, mname, cache)
            fallback_ids[(mid, coll)] = (
                await _name_fallback_ids(coll, mname, cache)
                if coll in _NAME_FALLBACK_COLLECTIONS else [])
    return queries, fallback_ids


async def _distinct_moved_totals(merge_ids: list, fallback_ids: dict) -> dict:
    """Aggregate 'rows that will actually move', DEDUPED across merge_ids.

    Per-merge_id counts must NOT simply be summed: when two duplicates in the same
    call normalize to the same name, ONE blank-school_id row is legitimately claimed
    by BOTH, and summing reports 2 rows for a DB holding 1. school_id-matched rows
    are disjoint by construction (different school_id), so only the name-fallback ids
    need set-deduping."""
    totals = {}
    for coll in _SCHOOL_ID_COLLECTIONS:
        n = await db[coll].count_documents({"school_id": {"$in": merge_ids}})
        distinct_fallback = set()
        for mid in merge_ids:
            distinct_fallback |= set(fallback_ids.get((mid, coll)) or [])
        n += len(distinct_fallback)   # fallback rows have NO school_id -> disjoint
        if n:
            totals[coll] = n
    return totals


async def _move_children_counts(merge_id: str, queries: dict) -> dict:
    """Per-collection count of the docs a merge would move — school_id matches PLUS
    the legacy school_name-only rows, so the dry-run preview is honest (an owner must
    never see "0 quotations" and then silently orphan one)."""
    counts = {}
    for coll in _SCHOOL_ID_COLLECTIONS:
        n = await db[coll].count_documents(queries[(merge_id, coll)])
        if n:
            counts[coll] = n
    return counts


@router.post("/schools/merge")
async def merge_schools(request: Request):
    """SUPERADMIN. Merge duplicate schools into one survivor.

    Body: {survivor_id, merge_ids:[...], dry_run:true, confirm:false, reason}
      - dry_run defaults TRUE → per-merge child move counts + survivor totals; no writes.
      - real run needs dry_run=false AND confirm==true.
      - survivor AND every merge_id must exist and be NOT soft-deleted (400 otherwise),
        so live children can never be reassigned onto a school the UI filters out.

    Reassigns every child to the survivor across all school_id-bearing collections —
    matching on school_id, plus the legacy school_name-only quotations/invoices (those
    also get school_name rewritten to the survivor's, so they stay properly linked).
    Fills only-blank survivor fields from the first merge doc that has a value, then
    snapshot_and_delete's the emptied duplicate school rows.

    REVERSIBILITY (read carefully): three backups are written BEFORE any change —
    the duplicate school docs (preimage_backup_id), every child doc about to be
    re-pointed (child_preimage_backup_id, so each child's ORIGINAL school_id is
    preserved), and the removal bundle (removed_backup_id). restore_bundle() will
    re-insert the deleted school shells, but it does NOT automatically revert the
    child FK rewrite — un-merging means replaying the child pre-image to restore each
    child's original school_id. The data to do so is captured; the undo is manual.

    Idempotent-ish: re-running with already-merged ids moves 0 children."""
    user = await get_current_user(request)
    require_superadmin(user)
    body = await request.json()

    survivor_id = (body.get("survivor_id") or "").strip()
    merge_ids = body.get("merge_ids") or []
    dry_run = body.get("dry_run", True)
    confirm = bool(body.get("confirm", False))
    reason = body.get("reason", "") or ""
    # Optional field-by-field picker (Google-Contacts style): {field: source} where
    # source is "survivor" (keep) or a merge_id (take that school's value). Absent →
    # the classic fill-only-blank behavior is unchanged.
    field_choices = body.get("field_choices") or {}

    if not survivor_id:
        raise HTTPException(status_code=400, detail="survivor_id is required")
    if not isinstance(merge_ids, list) or not merge_ids:
        raise HTTPException(status_code=400, detail="merge_ids must be a non-empty list")
    merge_ids = _dedupe(merge_ids)   # order-preserving (field fill is "first wins")
    if not merge_ids:
        raise HTTPException(status_code=400, detail="merge_ids must be a non-empty list")
    if survivor_id in merge_ids:
        raise HTTPException(status_code=400, detail="survivor_id cannot be in merge_ids")

    # Soft-deleted schools are NOT valid merge participants: a deleted survivor
    # would swallow live children into a school every list view hides.
    survivor = await db.schools.find_one({"school_id": survivor_id}, {"_id": 0})
    if not survivor:
        raise HTTPException(status_code=400, detail=f"survivor school {survivor_id} not found")
    if survivor.get("is_deleted"):
        raise HTTPException(
            status_code=400,
            detail=f"survivor school {survivor_id} is deleted — restore it before merging")
    merge_docs = []
    for mid in merge_ids:
        doc = await db.schools.find_one({"school_id": mid}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=400, detail=f"merge school {mid} not found")
        if doc.get("is_deleted"):
            raise HTTPException(
                status_code=400, detail=f"merge school {mid} is deleted — nothing to merge")
        merge_docs.append(doc)

    merge_by_id = {d["school_id"]: d for d in merge_docs}
    merge_names = {d["school_id"]: (d.get("school_name") or "").strip() for d in merge_docs}

    # Resolve WHICH rows move exactly once — reused verbatim for the counts below,
    # the ambiguity report, the child pre-image snapshot and the reassignment, so
    # they cannot drift.
    queries, fallback_ids = await _resolve_merge_queries(merge_ids, merge_names)

    # Per-merge_id claims (these MAY overlap: when two duplicates normalize to the
    # same name, one blank-school_id row is legitimately claimed by both) ...
    per_merge = {}
    for mid in merge_ids:
        per_merge[mid] = await _move_children_counts(mid, queries)
    # ... so the AGGREGATE is computed by set-deduping doc ids, never by summing the
    # per-merge counts (finding E: that reported 2 quotations for a DB holding 1).
    moved_total = await _distinct_moved_totals(merge_ids, fallback_ids)

    # AMBIGUITY (finding D): a name-fallback row claimed for a duplicate whose
    # normalized name is ALSO borne by a live school outside this merge could just
    # as well belong to that school. We still move it (the truth isn't in the data),
    # but the operator must see the guess rather than have it made silently.
    # Deduped by (collection, doc_id) — the same row claimed by two merge_ids is ONE
    # ambiguous row, not two (finding E again).
    ambiguous_seen = set()
    ambiguous_samples = []
    rivals_by_merge = {}
    for mid in merge_ids:
        rivals = await _ambiguous_name_rivals(merge_ids, survivor_id, merge_names.get(mid, ""))
        if not rivals:
            continue
        rivals_by_merge[mid] = rivals
        for coll in _NAME_FALLBACK_COLLECTIONS:
            for doc_id in fallback_ids.get((mid, coll)) or []:
                key = (coll, doc_id)
                if key in ambiguous_seen:
                    continue
                ambiguous_seen.add(key)
                if len(ambiguous_samples) < 20:
                    ambiguous_samples.append({
                        "collection": coll,
                        "doc_id": doc_id,
                        "school_name": merge_names.get(mid, ""),
                        "claimed_for": mid,
                        "also_matches_schools": rivals,
                    })
    ambiguity = {
        "count": len(ambiguous_seen),
        "samples": ambiguous_samples,
        "rival_schools": rivals_by_merge,
        "note": ("These rows have NO school_id and their name also matches a live "
                 "school outside this merge — they will be attributed to the survivor. "
                 "Verify before confirming."),
    } if ambiguous_seen else {"count": 0, "samples": [], "rival_schools": {}}

    # Survivor's resulting headline totals (current + everything moving in), using the
    # DEDUPED aggregate so a shared row isn't counted twice.
    survivor_now = await _school_child_counts(survivor_id)
    survivor_after = dict(survivor_now)
    for coll in _CHILD_COLLECTIONS:
        survivor_after[coll] = survivor_after.get(coll, 0) + moved_total.get(coll, 0)

    result = {
        "dry_run": bool(dry_run),
        "survivor_id": survivor_id,
        "merge_ids": merge_ids,
        "per_merge_moves": per_merge,
        "moved": moved_total,
        "survivor_children_before": survivor_now,
        "survivor_children_after": survivor_after,
        "ambiguous_name_fallback_rows": ambiguity,
    }
    if dry_run:
        return result
    if not confirm:
        raise HTTPException(status_code=400, detail="confirm must be true for a real merge")

    from audit_backup import snapshot_only, snapshot_and_delete

    # 1. Pre-image snapshot of the duplicate school docs BEFORE any change.
    pre = await snapshot_only(
        [("schools", {"school_id": {"$in": merge_ids}})],
        root_type="school_merge", root_id=survivor_id,
        root_label=f"merge {len(merge_ids)} dup schools into {survivor_id}",
        backed_up_by=user.get("email", ""), reason=reason)
    result["preimage_backup_id"] = pre["backup_id"]

    # 2. Pre-image snapshot of every CHILD doc about to be re-pointed, captured with
    #    its ORIGINAL school_id/school_name. Without this an incorrect merge is
    #    irreversible: the school shell restores, but nothing records where each
    #    child came from. Uses the SAME queries as the reassignment below.
    child_plan = [(coll, queries[(mid, coll)])
                  for mid in merge_ids for coll in _SCHOOL_ID_COLLECTIONS]
    child_pre = await snapshot_only(
        child_plan, root_type="school_merge_children", root_id=survivor_id,
        root_label=f"pre-merge school_id of children moving into {survivor_id}",
        backed_up_by=user.get("email", ""), reason=reason)
    result["child_preimage_backup_id"] = child_pre["backup_id"]
    result["child_preimage_counts"] = child_pre["counts"]

    # 3. Reassign every child to the survivor, using the SAME pre-resolved queries.
    #    For the name-fallback collections also rewrite school_name to the survivor's,
    #    so a legacy name-linked row ends up correctly linked instead of pointing at a
    #    name that no longer resolves to any school.
    #    The name text is rewritten for EVERY row the query matches — including rows
    #    matched by the plain school_id branch — because a reassigned contact that
    #    keeps the dead duplicate's `company` string would feed the OLD school name
    #    into outbound email/WhatsApp personalization and School-360 (finding G-ii).
    survivor_name = (survivor.get("school_name") or "").strip()
    applied_moves = {}
    for mid in merge_ids:
        for coll in _SCHOOL_ID_COLLECTIONS:
            set_doc = {"school_id": survivor_id}
            if coll in _NAME_FALLBACK_COLLECTIONS and survivor_name:
                set_doc[_NAME_FIELD[coll]] = survivor_name   # contacts -> `company`
            r = await db[coll].update_many(queries[(mid, coll)], {"$set": set_doc})
            n = getattr(r, "modified_count", 0) or 0
            if n:
                applied_moves[coll] = applied_moves.get(coll, 0) + n
    result["moved"] = applied_moves

    # 4. Fill ONLY-blank survivor fields from the first merge doc that has a value.
    fillable = ("school_name", "city", "state", "pincode", "phone", "email",
                "school_type", "school_strength", "assigned_to", "assigned_name")
    fill = {}
    for f in fillable:
        cur = survivor.get(f)
        if cur in (None, "", 0):
            for doc in merge_docs:
                v = doc.get(f)
                if v not in (None, "", 0):
                    fill[f] = v
                    break

    # 4b. Explicit field-by-field choices OVERRIDE the blank-fill: for each field the
    #     operator picked from a specific duplicate, overwrite the survivor with that
    #     value (a blank choice is ignored so a picker can never wipe survivor data).
    #     assigned_to/assigned_name are kept consistent as a pair.
    _CHOOSABLE = set(fillable) | {"address", "board", "gstin", "website",
                                  "primary_contact_name", "designation"}
    owner_src = field_choices.get("assigned_to") or field_choices.get("assigned_name")
    if owner_src in merge_by_id:
        od = merge_by_id[owner_src]
        if od.get("assigned_to") not in (None, ""):
            fill["assigned_to"] = od.get("assigned_to", "")
            fill["assigned_name"] = od.get("assigned_name", "")
    for f, src in field_choices.items():
        if f in ("assigned_to", "assigned_name") or f not in _CHOOSABLE:
            continue
        src_doc = merge_by_id.get(src)   # None when src is "survivor"/unknown → keep survivor
        if src_doc is None:
            continue
        v = src_doc.get(f)
        if v not in (None, ""):
            fill[f] = v

    if fill:
        await db.schools.update_one({"school_id": survivor_id}, {"$set": fill})
        result["survivor_filled"] = fill

    # 5. Snapshot-and-delete the now-empty duplicate school docs.
    del_res = await snapshot_and_delete(
        [("schools", {"school_id": {"$in": merge_ids}})],
        root_type="school_merge_removed", root_id=survivor_id,
        root_label=f"removed {len(merge_ids)} merged dup schools",
        deleted_by=user.get("email", ""), reason=reason)
    result["removed_backup_id"] = del_res["backup_id"]
    result["backups"] = [pre["backup_id"], child_pre["backup_id"], del_res["backup_id"]]
    result["merged"] = merge_ids
    result["undo_note"] = (
        "restore_bundle(removed_backup_id) re-creates the duplicate school rows. "
        "The child FK rewrite is NOT auto-reverted: replay child_preimage_backup_id "
        "to restore each child's original school_id/school_name.")

    for mid in merge_ids:
        await _log_activity(
            user.get("email", ""), "school_merge", mid,
            f"merged school {mid} into {survivor_id} "
            f"(backups {pre['backup_id']}/{child_pre['backup_id']}/{del_res['backup_id']}; "
            f"reason: {reason or 'n/a'})")
    return result
