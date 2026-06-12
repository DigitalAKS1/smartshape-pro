"""Invoice ingestion + 360° linkage.

Bulk-import invoices from JSON or XML, auto-map each to a School (by name/GSTIN)
and its Sales Order (by order/PO/quotation number), and flag the unmatched for a
one-click manual map. Alias-tolerant so real-world exports map without rework.
"""
from fastapi import APIRouter, HTTPException, Request, UploadFile, File, Response
from typing import Optional
from datetime import datetime, timezone
import uuid
import json
import re
import xml.etree.ElementTree as ET

from database import db
from auth_utils import get_current_user
from rbac import get_team

router = APIRouter(prefix="/invoices", tags=["invoices"])


def _require_admin_accounts(user):
    if get_team(user) not in ("admin", "accounts"):
        raise HTTPException(status_code=403, detail="Admin or accounts only")


# ── Alias-tolerant field access ───────────────────────────────────────────────
def _g(d: dict, *keys, default=""):
    if not isinstance(d, dict):
        return default
    low = {str(k).lower(): v for k, v in d.items()}
    for k in keys:
        v = low.get(k.lower())
        if v not in (None, ""):
            return v
    return default


def _num(v):
    if v in (None, ""):
        return 0.0
    try:
        return float(re.sub(r"[^0-9.\-]", "", str(v)) or 0)
    except Exception:
        return 0.0


def _norm_invoice(raw: dict) -> dict:
    return {
        "invoice_number": str(_g(raw, "invoice_number", "invoice_no", "invoiceno", "number", "inv_no", "bill_no")).strip(),
        "invoice_date": str(_g(raw, "invoice_date", "date", "inv_date", "bill_date")).strip(),
        "school_name": str(_g(raw, "school_name", "school", "buyer", "buyer_name", "customer", "customer_name", "party", "party_name")).strip(),
        "gstin": str(_g(raw, "gstin", "gst", "buyer_gstin", "customer_gst", "gst_number")).strip(),
        "order_number": str(_g(raw, "order_number", "so_number", "so_no", "sales_order")).strip(),
        "po_number": str(_g(raw, "po_number", "po_no", "po", "purchase_order")).strip(),
        "quotation_number": str(_g(raw, "quotation_number", "quote_number", "quote_no")).strip(),
        "subtotal": _num(_g(raw, "subtotal", "sub_total", "taxable_value", "amount")),
        "tax_amount": _num(_g(raw, "tax_amount", "tax", "gst_amount", "total_tax")),
        "total_amount": _num(_g(raw, "total_amount", "total", "grand_total", "invoice_value", "invoice_total", "net_amount")),
        "currency": (str(_g(raw, "currency", default="INR")).strip() or "INR"),
        "items": raw.get("items") or raw.get("line_items") or [],
        "raw": raw,
    }


# ── Parsers ───────────────────────────────────────────────────────────────────
def _parse_json(text: str) -> list:
    data = json.loads(text)
    if isinstance(data, dict):
        data = data.get("invoices") or data.get("Invoices") or data.get("data") or [data]
    if not isinstance(data, list):
        raise ValueError("JSON must be an array of invoices or {\"invoices\": [...]}")
    return [d for d in data if isinstance(d, dict)]


def _xml_to_dict(el) -> dict:
    d = {}
    for child in el:
        tag = child.tag.split("}")[-1]
        if len(list(child)):
            if tag.lower() in ("items", "line_items", "lineitems"):
                d[tag] = [_xml_to_dict(c) for c in child]
            else:
                d[tag] = _xml_to_dict(child)
        else:
            d[tag] = (child.text or "").strip()
    for k, v in el.attrib.items():
        d.setdefault(k, v)
    return d


def _parse_xml(text: str) -> list:
    root = ET.fromstring(text)
    invoices = [_xml_to_dict(el) for el in root.iter()
                if el.tag.split("}")[-1].lower() in ("invoice", "voucher", "bill")]
    return invoices or [_xml_to_dict(root)]


# ── Auto-mapping ───────────────────────────────────────────────────────────────
async def _match_school(n: dict):
    if n["school_name"]:
        sch = await db.schools.find_one(
            {"school_name": {"$regex": f"^{re.escape(n['school_name'])}$", "$options": "i"}, "is_deleted": {"$ne": True}},
            {"_id": 0, "school_id": 1, "school_name": 1})
        if sch:
            return sch["school_id"], sch["school_name"]
    if n["gstin"]:
        q = await db.quotations.find_one(
            {"customer_gst": {"$regex": f"^{re.escape(n['gstin'])}$", "$options": "i"}, "school_id": {"$nin": [None, ""]}},
            {"_id": 0, "school_id": 1, "school_name": 1})
        if q:
            return q.get("school_id", ""), q.get("school_name", "")
    return "", ""


async def _match_order(n: dict):
    ref = n["order_number"] or n["po_number"]
    if ref:
        o = await db.orders.find_one({"order_number": {"$regex": f"^{re.escape(ref)}$", "$options": "i"}},
                                     {"_id": 0, "order_id": 1, "quotation_id": 1})
        if o:
            return o["order_id"], o.get("quotation_id", "")
    if n["quotation_number"]:
        q = await db.quotations.find_one({"$or": [{"quotation_number": n["quotation_number"]}, {"quote_number": n["quotation_number"]}]},
                                         {"_id": 0, "quotation_id": 1})
        if q:
            o = await db.orders.find_one({"quotation_id": q["quotation_id"]}, {"_id": 0, "order_id": 1})
            return (o["order_id"] if o else ""), q["quotation_id"]
    return "", ""


# ── Bulk import ────────────────────────────────────────────────────────────────
@router.post("/bulk-import")
async def bulk_import_invoices(request: Request, file: UploadFile = File(...)):
    user = await get_current_user(request)
    _require_admin_accounts(user)
    text = (await file.read()).decode("utf-8", errors="replace")
    is_xml = (file.filename or "").lower().endswith(".xml") or text.lstrip().startswith("<")
    fmt = "xml" if is_xml else "json"
    try:
        raws = _parse_xml(text) if is_xml else _parse_json(text)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not parse {fmt.upper()}: {e}")

    now = datetime.now(timezone.utc).isoformat()
    s = {"total": 0, "created": 0, "matched_so": 0, "school_only": 0, "unmatched": 0, "skipped_dupe": 0, "errors": []}
    created = []
    for raw in raws:
        s["total"] += 1
        try:
            n = _norm_invoice(raw)
            if not n["invoice_number"]:
                s["errors"].append("row missing invoice_number")
                continue
            if await db.invoices.find_one({"invoice_number": n["invoice_number"]}, {"_id": 0, "invoice_id": 1}):
                s["skipped_dupe"] += 1
                continue
            school_id, school_name = await _match_school(n)
            order_id, quotation_id = await _match_order(n) if school_id else ("", "")
            if school_id and order_id:
                status = "matched"; s["matched_so"] += 1
            elif school_id:
                status = "school_only"; s["school_only"] += 1
            else:
                status = "unmatched"; s["unmatched"] += 1
            inv_id = f"inv_{uuid.uuid4().hex[:12]}"
            await db.invoices.insert_one({
                "invoice_id": inv_id, "invoice_number": n["invoice_number"], "invoice_date": n["invoice_date"],
                "school_id": school_id, "school_name": school_name or n["school_name"], "gstin": n["gstin"],
                "order_id": order_id, "order_number": n["order_number"], "po_number": n["po_number"],
                "quotation_id": quotation_id, "quotation_number": n["quotation_number"],
                "subtotal": n["subtotal"], "tax_amount": n["tax_amount"], "total_amount": n["total_amount"],
                "currency": n["currency"], "items": n["items"], "match_status": status,
                "source": f"bulk_{fmt}", "raw": n["raw"], "created_by": user["email"], "created_at": now,
            })
            created.append(inv_id); s["created"] += 1
        except Exception as e:
            s["errors"].append(str(e)[:120])
    s["errors"] = s["errors"][:25]
    return {"summary": s, "invoice_ids": created}


@router.get("")
async def list_invoices(request: Request, school_id: Optional[str] = None, match_status: Optional[str] = None):
    user = await get_current_user(request)
    _require_admin_accounts(user)
    q = {}
    if school_id:
        q["school_id"] = school_id
    if match_status:
        q["match_status"] = match_status
    return await db.invoices.find(q, {"_id": 0, "raw": 0}).sort("created_at", -1).to_list(3000)


@router.get("/receivables")
async def receivables(request: Request):
    """Per-school outstanding (invoiced − order payments) with aging, sorted by outstanding desc."""
    from datetime import date as _date
    user = await get_current_user(request)
    _require_admin_accounts(user)
    by_school = {}
    async for inv in db.invoices.find(
        {"school_id": {"$nin": [None, ""]}},
        {"_id": 0, "school_id": 1, "school_name": 1, "total_amount": 1, "invoice_date": 1},
    ):
        sid = inv["school_id"]
        e = by_school.setdefault(sid, {"school_id": sid, "school_name": inv.get("school_name", ""),
                                       "invoiced": 0.0, "paid": 0.0, "invoices": 0, "oldest_date": None})
        e["invoiced"] += float(inv.get("total_amount", 0) or 0)
        e["invoices"] += 1
        d = (inv.get("invoice_date") or "")[:10]
        if d and (e["oldest_date"] is None or d < e["oldest_date"]):
            e["oldest_date"] = d
    if not by_school:
        return {"rows": [], "totals": {"invoiced": 0, "paid": 0, "outstanding": 0}}
    async for o in db.orders.find({"school_id": {"$in": list(by_school)}}, {"_id": 0, "school_id": 1, "payment_received": 1}):
        if o["school_id"] in by_school:
            by_school[o["school_id"]]["paid"] += float(o.get("payment_received", 0) or 0)
    today = _date.today()
    rows, tot = [], {"invoiced": 0.0, "paid": 0.0, "outstanding": 0.0}
    for e in by_school.values():
        tot["invoiced"] += e["invoiced"]
        tot["paid"] += e["paid"]
        outstanding = round(e["invoiced"] - e["paid"], 2)
        if outstanding <= 0:
            continue
        tot["outstanding"] += outstanding
        days, bucket = None, "—"
        if e["oldest_date"]:
            try:
                days = (today - _date.fromisoformat(e["oldest_date"])).days
                bucket = "0-30" if days <= 30 else "31-60" if days <= 60 else "61-90" if days <= 90 else "90+"
            except Exception:
                pass
        rows.append({"school_id": e["school_id"], "school_name": e["school_name"],
                     "invoiced": round(e["invoiced"], 2), "paid": round(e["paid"], 2),
                     "outstanding": outstanding, "invoices": e["invoices"],
                     "oldest_date": e["oldest_date"], "aging_days": days, "aging_bucket": bucket})
    rows.sort(key=lambda r: r["outstanding"], reverse=True)
    return {"rows": rows, "totals": {k: round(v, 2) for k, v in tot.items()}}


@router.post("/{invoice_id}/map")
async def map_invoice(invoice_id: str, request: Request):
    """Manually map an unmatched invoice to a school (and optionally an order)."""
    user = await get_current_user(request)
    _require_admin_accounts(user)
    body = await request.json()
    upd = {}
    if body.get("school_id"):
        sch = await db.schools.find_one({"school_id": body["school_id"]}, {"_id": 0, "school_name": 1})
        upd["school_id"] = body["school_id"]
        upd["school_name"] = sch.get("school_name", "") if sch else ""
    if "order_id" in body:
        upd["order_id"] = body.get("order_id", "")
    if not upd:
        raise HTTPException(status_code=400, detail="Nothing to map")
    if upd.get("school_id"):
        upd["match_status"] = "matched" if upd.get("order_id") else "school_only"
    await db.invoices.update_one({"invoice_id": invoice_id}, {"$set": upd})
    return await db.invoices.find_one({"invoice_id": invoice_id}, {"_id": 0, "raw": 0})


@router.delete("/{invoice_id}")
async def delete_invoice(invoice_id: str, request: Request):
    user = await get_current_user(request)
    _require_admin_accounts(user)
    await db.invoices.delete_one({"invoice_id": invoice_id})
    return {"message": "Invoice deleted"}


@router.get("/import-template")
async def import_template(request: Request, format: str = "json"):
    await get_current_user(request)
    sample = [{
        "invoice_number": "INV-2026-001", "invoice_date": "2026-06-10",
        "school_name": "ABC Academy", "gstin": "27ABCDE1234F1Z5",
        "order_number": "ORD-2026-0001", "po_number": "PO-789", "quotation_number": "Q-2026-005",
        "subtotal": 100000, "tax_amount": 18000, "total_amount": 118000, "currency": "INR",
        "items": [{"description": "SMARTS-SHAPES Machine", "hsn": "8441", "qty": 1, "rate": 100000, "amount": 100000}],
    }]
    if format == "xml":
        rows = "".join(
            f"<Invoice><invoice_number>{s['invoice_number']}</invoice_number>"
            f"<invoice_date>{s['invoice_date']}</invoice_date><school_name>{s['school_name']}</school_name>"
            f"<gstin>{s['gstin']}</gstin><order_number>{s['order_number']}</order_number>"
            f"<po_number>{s['po_number']}</po_number><subtotal>{s['subtotal']}</subtotal>"
            f"<tax_amount>{s['tax_amount']}</tax_amount><total_amount>{s['total_amount']}</total_amount></Invoice>"
            for s in sample)
        return Response(f"<?xml version='1.0' encoding='UTF-8'?>\n<Invoices>{rows}</Invoices>",
                        media_type="application/xml",
                        headers={"Content-Disposition": 'attachment; filename="invoice_template.xml"'})
    return Response(json.dumps({"invoices": sample}, indent=2),
                    media_type="application/json",
                    headers={"Content-Disposition": 'attachment; filename="invoice_template.json"'})
