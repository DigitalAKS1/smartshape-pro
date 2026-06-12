from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse, Response
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone
import uuid
import io
import json

from database import db
from auth_utils import get_current_user
from rbac import get_team, require_teams
from tally_export import gather_so, build_json, build_voucher_xml, build_envelope

router = APIRouter()

VALID_PRODUCTION_STAGES = ["order_created", "in_production", "ready_to_dispatch", "dispatched"]


async def log_activity(user_email: str, action: str, entity_type: str, entity_id: str, details: str = ""):
    await db.activity_logs.insert_one({
        "log_id": f"act_{uuid.uuid4().hex[:8]}",
        "user_email": user_email,
        "action": action,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "details": details,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })


async def _assert_dispatchable(order, items):
    """Guard shared by all dispatch paths: block out-of-stock items and
    enforce the payment threshold before an order can leave the building."""
    for it in items:
        if it.get("status") == "out_of_stock":
            raise HTTPException(status_code=400, detail=f"Cannot dispatch — item out of stock: {it.get('die_name','')}")
    threshold = float(order.get("payment_threshold_pct", 50))
    grand = float(order.get("grand_total", 0) or 0)
    received = float(order.get("total_paid", order.get("payment_received", 0)) or 0)
    if grand > 0 and (received / grand * 100) < threshold:
        raise HTTPException(status_code=400, detail=f"Cannot dispatch — payment below threshold ({threshold}% required)")


# ==================== STOCK AVAILABILITY ====================
# Single source of truth for "how much of a die is promised but not yet shipped".
# Committed = sum of open order-item quantities (on_hold + confirmed) across ALL
# orders + quantities currently out on a returnable challan (demo/exhibition/sampling).
# Available = stock_qty - Committed. dies.reserved_qty is a denormalized cache of
# Committed; recompute_reservations() heals any drift between the two.

# Order-item statuses that still hold stock (reserved but not yet dispatched).
COMMITTING_ITEM_STATUSES = ["on_hold", "confirmed"]


async def compute_committed(die_id: str, *, exclude_order_item_id: Optional[str] = None) -> int:
    """Live committed quantity for a die from open order items + returnable-out challans.

    exclude_order_item_id lets a caller ask "committed by everyone except this line",
    which is what the Holds view needs to show a true per-line shortage.
    """
    match = {"die_id": die_id, "status": {"$in": COMMITTING_ITEM_STATUSES}}
    if exclude_order_item_id:
        match["order_item_id"] = {"$ne": exclude_order_item_id}
    items = await db.order_items.find(match, {"_id": 0, "quantity": 1}).to_list(100000)
    committed = sum(int(it.get("quantity", 1) or 1) for it in items)
    # Items physically out on a returnable challan (open / partially returned) also
    # reduce availability. Added with Step 4 (Returnable Challan); harmless before.
    committed += await _returnable_out_qty(die_id)
    return committed


async def _returnable_out_qty(die_id: str) -> int:
    """Net quantity of a die currently out on open returnable challans (qty - returned)."""
    try:
        challans = await db.challans.find(
            {"type": "returnable_out", "status": {"$in": ["open", "partially_returned"]}},
            {"_id": 0, "lines": 1},
        ).to_list(100000)
    except Exception:
        return 0
    out = 0
    for ch in challans:
        for ln in ch.get("lines", []):
            if ln.get("item_ref") == die_id or ln.get("die_id") == die_id:
                out += int(ln.get("qty", 0) or 0) - int(ln.get("returned_qty", 0) or 0)
    return max(0, out)


async def compute_availability(die: dict, *, exclude_order_item_id: Optional[str] = None) -> dict:
    """Return {stock_qty, committed, available} for a die document."""
    stock = int(die.get("stock_qty", 0) or 0)
    committed = await compute_committed(die["die_id"], exclude_order_item_id=exclude_order_item_id)
    return {"stock_qty": stock, "committed": committed, "available": stock - committed}


async def recompute_reservations() -> dict:
    """Recalculate every die's reserved_qty cache from live committed demand.

    Migration/heal tool for legacy drift (e.g. the old +1-per-die bug). Returns a
    report of every die whose cached reserved_qty disagreed with reality.
    """
    dies = await db.dies.find({}, {"_id": 0, "die_id": 1, "code": 1, "reserved_qty": 1}).to_list(100000)
    fixed = []
    for d in dies:
        committed = await compute_committed(d["die_id"])
        old = int(d.get("reserved_qty", 0) or 0)
        if committed != old:
            await db.dies.update_one({"die_id": d["die_id"]}, {"$set": {"reserved_qty": committed}})
            fixed.append({"die_id": d["die_id"], "code": d.get("code", ""), "old": old, "new": committed})
    return {"dies_scanned": len(dies), "dies_fixed": len(fixed), "changes": fixed}


# ==================== ORDERS ====================

@router.get("/orders")
async def get_orders(request: Request):
    user = await get_current_user(request)
    team = get_team(user)
    if team == "sales":
        # Sales see only orders they created (from their quotations)
        query = {"created_by": user["email"]}
    else:
        # admin, accounts, store — see all orders
        query = {}
    orders = await db.orders.find(query, {"_id": 0}).sort("created_at", -1).to_list(10000)
    return orders


@router.get("/orders/{order_id}")
async def get_order(order_id: str, request: Request):
    await get_current_user(request)
    order = await db.orders.find_one({"order_id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    items = await db.order_items.find(
        {"order_id": order_id, "status": {"$ne": "removed"}}, {"_id": 0}).to_list(1000)
    order["items"] = items
    timeline = await db.order_timeline.find({"order_id": order_id}, {"_id": 0}).sort("timestamp", 1).to_list(100)
    order["timeline"] = timeline
    return order


# ==================== TALLY EXPORT (Sales Order → XML / JSON) ====================

class BulkExportInput(BaseModel):
    order_ids: List[str]
    format: str = "xml"  # "xml" (Tally voucher) | "json"


@router.get("/orders/{order_id}/export")
async def export_order(order_id: str, request: Request, format: str = "xml"):
    """Download a single Sales Order as a Tally-importable XML voucher or JSON."""
    user = await get_current_user(request)
    require_teams(user, "admin", "accounts")
    data = await gather_so(order_id)
    if not data:
        raise HTTPException(status_code=404, detail="Order not found")
    num = data["order"].get("order_number", order_id)
    if format == "json":
        content = json.dumps(build_json(data), indent=2, ensure_ascii=False, default=str)
        return Response(content, media_type="application/json",
                        headers={"Content-Disposition": f'attachment; filename="SO_{num}.json"'})
    xml = build_envelope([build_voucher_xml(data)],
                         data["company"].get("company_name", "SmartShape"))
    return Response(xml, media_type="application/xml",
                    headers={"Content-Disposition": f'attachment; filename="SO_{num}.xml"'})


@router.post("/orders/export")
async def export_orders_bulk(payload: BulkExportInput, request: Request):
    """Download many Sales Orders at once — one combined Tally XML (multiple
    vouchers, import in one go) or a JSON array."""
    user = await get_current_user(request)
    require_teams(user, "admin", "accounts")
    ids = [i for i in (payload.order_ids or []) if i]
    if not ids:
        raise HTTPException(status_code=400, detail="No orders selected")
    datas = [d for d in [await gather_so(i) for i in ids] if d]
    if not datas:
        raise HTTPException(status_code=404, detail="No matching orders")
    company_name = datas[0]["company"].get("company_name", "SmartShape")
    if payload.format == "json":
        content = json.dumps([build_json(d) for d in datas], indent=2, ensure_ascii=False, default=str)
        return Response(content, media_type="application/json",
                        headers={"Content-Disposition": 'attachment; filename="sales_orders.json"'})
    xml = build_envelope([build_voucher_xml(d) for d in datas], company_name)
    return Response(xml, media_type="application/xml",
                    headers={"Content-Disposition": 'attachment; filename="sales_orders_tally.xml"'})


async def create_order_for_quotation(quotation_id: str, *, created_by: str,
                                     lead_id: Optional[str] = None,
                                     payment_threshold_pct: float = 50.0,
                                     payment_received: float = 0.0,
                                     notes: str = "", source: str = "manual"):
    """Create a Sales Order from a quotation + its catalogue selection.

    Idempotent: returns (order, created=False) if an order already exists for the
    quotation. `source` is recorded for audit ('manual' | 'catalogue_submit').
    Shared by the manual admin route and the auto-generation on catalogue submit.
    """
    quot = await db.quotations.find_one({"quotation_id": quotation_id}, {"_id": 0})
    if not quot:
        raise HTTPException(status_code=404, detail="Quotation not found")
    existing = await db.orders.find_one({"quotation_id": quotation_id}, {"_id": 0})
    if existing:
        return existing, False

    order_id = f"ord_{uuid.uuid4().hex[:12]}"
    order_num_count = await db.orders.count_documents({})
    order_number = f"ORD-{datetime.now(timezone.utc).year}-{order_num_count + 1:04d}"

    selection = await db.catalogue_selections.find_one({"quotation_id": quotation_id}, {"_id": 0})
    sel_items = []
    if selection:
        sel_items = await db.catalogue_selection_items.find(
            {"catalogue_selection_id": selection["selection_id"]}, {"_id": 0}
        ).to_list(1000)

    eff_lead_id = lead_id or quot.get("lead_id") or ""
    note_text = notes or ("Auto-created from catalogue submission" if source == "catalogue_submit"
                          else "Order created from quotation")
    now_iso = datetime.now(timezone.utc).isoformat()
    order_doc = {
        "order_id": order_id,
        "order_number": order_number,
        "quotation_id": quotation_id,
        "quote_number": quot.get("quote_number", ""),
        "school_id": quot.get("school_id", ""),
        "school_name": quot.get("school_name", ""),
        "lead_id": eff_lead_id,
        "package_name": quot.get("package_name", ""),
        "total_items": len(sel_items),
        "grand_total": quot.get("grand_total", 0),
        "order_status": "pending",
        "production_stage": "order_created",
        "payment_threshold_pct": float(payment_threshold_pct),
        "payment_received": float(payment_received),
        "dispatch_date": None,
        "notes": notes,
        "source": source,
        "auto_created_on_submit": source == "catalogue_submit",
        "created_by": created_by,
        "created_at": now_iso,
        "updated_at": now_iso,
    }
    await db.orders.insert_one(order_doc)

    for item in sel_items:
        await db.order_items.insert_one({
            "order_item_id": f"oi_{uuid.uuid4().hex[:8]}",
            "order_id": order_id,
            "die_id": item.get("die_id"),
            "die_name": item.get("die_name"),
            "die_code": item.get("die_code"),
            "die_type": item.get("die_type"),
            "die_image_url": item.get("die_image_url"),
            "quantity": int(item.get("quantity", 1) or 1),
            "status": "on_hold",
        })

    await db.order_timeline.insert_one({
        "timeline_id": f"tl_{uuid.uuid4().hex[:8]}",
        "order_id": order_id,
        "status": "pending",
        "note": note_text,
        "updated_by": created_by,
        "timestamp": now_iso,
    })

    await db.quotations.update_one({"quotation_id": quotation_id}, {"$set": {"quotation_status": "confirmed"}})

    if eff_lead_id:
        await db.leads.update_one({"lead_id": eff_lead_id}, {"$set": {
            "is_locked": True,
            "order_id": order_id,
            "stage": "won",
            "last_activity_date": now_iso,
            "updated_at": now_iso,
        }})
        await log_activity(created_by, "convert_to_order", "lead", eff_lead_id, f"Order {order_number} created")

    await log_activity(created_by, "create", "order", order_id,
                       f"Order {order_number} created from {quot.get('quote_number', '')} ({source})")
    return order_doc, True


@router.post("/orders")
async def create_order_from_quotation(request: Request):
    user = await get_current_user(request)
    team = get_team(user)
    if team == "store":
        raise HTTPException(status_code=403, detail="Store team cannot create orders")
    body = await request.json()
    quotation_id = body.get("quotation_id")
    if not quotation_id:
        raise HTTPException(status_code=400, detail="quotation_id required")

    lead_id = body.get("lead_id")
    if lead_id:
        lead = await db.leads.find_one({"lead_id": lead_id}, {"_id": 0})
        if not lead:
            raise HTTPException(status_code=404, detail="Lead not found")
        if lead.get("stage") not in ("negotiation", "won"):
            raise HTTPException(status_code=400, detail="Lead must be in Negotiation or Won stage to convert")

    order, created = await create_order_for_quotation(
        quotation_id, created_by=user["email"], lead_id=lead_id,
        payment_threshold_pct=float(body.get("payment_threshold_pct", 50)),
        payment_received=float(body.get("payment_received", 0)),
        notes=body.get("notes", ""), source="manual",
    )
    if not created:
        raise HTTPException(status_code=400, detail="Order already exists for this quotation")
    return order


@router.put("/orders/{order_id}/status")
async def update_order_status(order_id: str, request: Request):
    user = await get_current_user(request)
    body = await request.json()
    new_status = body.get("status")
    if new_status not in ("pending", "confirmed", "dispatched", "delivered", "cancelled"):
        raise HTTPException(status_code=400, detail="Invalid status")

    order = await db.orders.find_one({"order_id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    update_data = {"order_status": new_status, "updated_at": datetime.now(timezone.utc).isoformat()}
    if new_status == "dispatched":
        update_data["dispatch_date"] = body.get("dispatch_date", datetime.now(timezone.utc).strftime("%Y-%m-%d"))
        items = await db.order_items.find({"order_id": order_id}, {"_id": 0}).to_list(1000)
        await _assert_dispatchable(order, items)
        for item in items:
            if item.get("status") == "on_hold":
                await db.dies.update_one({"die_id": item["die_id"]}, {
                    "$inc": {"stock_qty": -item.get("quantity", 1), "reserved_qty": -item.get("quantity", 1)}
                })
                await db.order_items.update_one({"order_item_id": item["order_item_id"]}, {"$set": {"status": "dispatched"}})
    elif new_status == "delivered":
        await db.order_items.update_many(
            {"order_id": order_id, "status": {"$nin": ["removed", "cancelled", "released"]}},
            {"$set": {"status": "delivered"}})
    elif new_status == "cancelled":
        items = await db.order_items.find({"order_id": order_id}, {"_id": 0}).to_list(1000)
        for item in items:
            if item.get("status") == "on_hold":
                await db.dies.update_one({"die_id": item["die_id"]}, {"$inc": {"reserved_qty": -item.get("quantity", 1)}})
                await db.order_items.update_one({"order_item_id": item["order_item_id"]}, {"$set": {"status": "cancelled"}})

    await db.orders.update_one({"order_id": order_id}, {"$set": update_data})

    await db.order_timeline.insert_one({
        "timeline_id": f"tl_{uuid.uuid4().hex[:8]}",
        "order_id": order_id,
        "status": new_status,
        "note": body.get("note", f"Status changed to {new_status}"),
        "updated_by": user["email"],
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })

    return await db.orders.find_one({"order_id": order_id}, {"_id": 0})


@router.put("/orders/{order_id}/production-stage")
async def update_order_production_stage(order_id: str, request: Request):
    user = await get_current_user(request)
    body = await request.json()
    new_stage = body.get("production_stage")
    if new_stage not in VALID_PRODUCTION_STAGES:
        raise HTTPException(status_code=400, detail="Invalid production_stage")
    order = await db.orders.find_one({"order_id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if new_stage == "dispatched":
        items = await db.order_items.find({"order_id": order_id}, {"_id": 0}).to_list(1000)
        await _assert_dispatchable(order, items)
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.orders.update_one({"order_id": order_id}, {"$set": {
        "production_stage": new_stage,
        "updated_at": now_iso,
    }})
    await db.order_timeline.insert_one({
        "timeline_id": f"tl_{uuid.uuid4().hex[:8]}",
        "order_id": order_id,
        "status": new_stage,
        "note": body.get("note", f"Moved to {new_stage}"),
        "updated_by": user["email"],
        "timestamp": now_iso,
    })
    await log_activity(user["email"], "update_production_stage", "order", order_id, f"-> {new_stage}")
    return await db.orders.find_one({"order_id": order_id}, {"_id": 0})


# ==================== MANAGE SELECTION (order line items) ====================
# Staff (admin/store/accounts) may add/remove dies and change quantities on a
# submitted order until it begins dispatching. Reservations adjust automatically.

EDITABLE_ORDER_STATUSES = ("pending", "confirmed")
EDITABLE_ITEM_STATUSES = ("on_hold", "confirmed")


def _assert_can_edit_selection(user, order):
    if get_team(user) == "sales":
        raise HTTPException(status_code=403, detail="Sales cannot edit order selections")
    if order.get("order_status") not in EDITABLE_ORDER_STATUSES:
        raise HTTPException(status_code=400,
            detail=f"Selection is locked once the order is {order.get('order_status')}")


async def _refresh_total_items(order_id: str):
    """Keep order.total_items in sync with its live (non-removed) lines."""
    count = await db.order_items.count_documents(
        {"order_id": order_id, "status": {"$in": list(EDITABLE_ITEM_STATUSES)}})
    await db.orders.update_one({"order_id": order_id},
        {"$set": {"total_items": count, "updated_at": datetime.now(timezone.utc).isoformat()}})


async def _maybe_alert_shortage(die: dict, selection_ref: str):
    """Raise a purchase alert if a die's live availability went negative."""
    avail = await compute_availability(die)
    if avail["available"] < 0:
        short = abs(avail["available"])
        await db.purchase_alerts.insert_one({
            "alert_id": f"alert_{uuid.uuid4().hex[:12]}",
            "die_id": die["die_id"], "die_code": die.get("code", ""),
            "die_name": die.get("name", ""), "die_type": die.get("type", ""),
            "triggered_by_selection_edit": selection_ref,
            "current_stock": avail["stock_qty"], "required_qty": avail["committed"],
            "shortage_qty": short, "priority": "urgent" if short > 10 else "high",
            "status": "pending", "created_at": datetime.now(timezone.utc).isoformat(),
        })


@router.post("/orders/{order_id}/items")
async def add_order_item(order_id: str, request: Request):
    """Add a new die line to a submitted order (staff only, before dispatch)."""
    user = await get_current_user(request)
    order = await db.orders.find_one({"order_id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    _assert_can_edit_selection(user, order)

    body = await request.json()
    die_id = body.get("die_id")
    qty = max(1, int(body.get("quantity", 1) or 1))
    if not die_id:
        raise HTTPException(status_code=400, detail="die_id required")
    die = await db.dies.find_one({"die_id": die_id}, {"_id": 0})
    if not die:
        raise HTTPException(status_code=404, detail="Die not found")

    existing = await db.order_items.find_one(
        {"order_id": order_id, "die_id": die_id, "status": {"$in": list(EDITABLE_ITEM_STATUSES)}})
    if existing:
        raise HTTPException(status_code=409,
            detail="Die already on this order — change its quantity instead")

    order_item_id = f"oi_{uuid.uuid4().hex[:8]}"
    await db.order_items.insert_one({
        "order_item_id": order_item_id, "order_id": order_id,
        "die_id": die_id, "die_name": die["name"], "die_code": die["code"],
        "die_type": die["type"], "die_image_url": die.get("image_url"),
        "quantity": qty, "status": "on_hold",
    })
    await db.dies.update_one({"die_id": die_id}, {"$inc": {"reserved_qty": qty}})
    await _maybe_alert_shortage({**die, "die_id": die_id}, order_item_id)
    await _refresh_total_items(order_id)
    await log_activity(user["email"], "add_item", "order", order_id, f"+{qty} x {die['code']}")
    return {"message": "Item added", "order_item_id": order_item_id}


@router.put("/orders/{order_id}/items/{order_item_id}")
async def update_order_item_qty(order_id: str, order_item_id: str, request: Request):
    """Change a line's quantity; reservation adjusts by the delta (staff, pre-dispatch)."""
    user = await get_current_user(request)
    order = await db.orders.find_one({"order_id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    _assert_can_edit_selection(user, order)

    item = await db.order_items.find_one({"order_item_id": order_item_id, "order_id": order_id})
    if not item:
        raise HTTPException(status_code=404, detail="Order item not found")
    if item.get("status") not in EDITABLE_ITEM_STATUSES:
        raise HTTPException(status_code=400, detail=f"Cannot edit a {item.get('status')} item")

    new_qty = max(1, int((await request.json()).get("quantity", 1) or 1))
    delta = new_qty - int(item.get("quantity", 1) or 1)
    if delta != 0:
        await db.order_items.update_one({"order_item_id": order_item_id}, {"$set": {"quantity": new_qty}})
        await db.dies.update_one({"die_id": item["die_id"]}, {"$inc": {"reserved_qty": delta}})
        die = await db.dies.find_one({"die_id": item["die_id"]}, {"_id": 0})
        if die:
            await _maybe_alert_shortage(die, order_item_id)
        await log_activity(user["email"], "update_item_qty", "order", order_id,
                           f"{item.get('die_code','')} -> {new_qty}")
    return {"message": "Quantity updated", "quantity": new_qty}


@router.delete("/orders/{order_id}/items/{order_item_id}")
async def remove_order_item(order_id: str, order_item_id: str, request: Request):
    """Remove a die line and release its reservation (staff, pre-dispatch)."""
    user = await get_current_user(request)
    order = await db.orders.find_one({"order_id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    _assert_can_edit_selection(user, order)

    item = await db.order_items.find_one({"order_item_id": order_item_id, "order_id": order_id})
    if not item:
        raise HTTPException(status_code=404, detail="Order item not found")
    if item.get("status") not in EDITABLE_ITEM_STATUSES:
        raise HTTPException(status_code=400, detail=f"Cannot remove a {item.get('status')} item")

    await db.dies.update_one({"die_id": item["die_id"]},
                             {"$inc": {"reserved_qty": -int(item.get("quantity", 1) or 1)}})
    await db.order_items.update_one({"order_item_id": order_item_id}, {"$set": {"status": "removed"}})
    await _refresh_total_items(order_id)
    await log_activity(user["email"], "remove_item", "order", order_id, f"-{item.get('die_code','')}")
    return {"message": "Item removed"}


# ==================== PAYMENTS ====================

@router.post("/orders/{order_id}/payment")
async def record_payment(order_id: str, request: Request):
    user = await get_current_user(request)
    order = await db.orders.find_one({"order_id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    body = await request.json()
    amount = float(body.get("amount", 0))
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than zero")
    payment_id = f"pay_{uuid.uuid4().hex[:12]}"
    payment_doc = {
        "payment_id": payment_id,
        "order_id": order_id,
        "amount": amount,
        "method": body.get("method", "cash"),
        "reference": body.get("reference", ""),
        "notes": body.get("notes", ""),
        "recorded_by": user["email"],
        "payment_date": body.get("payment_date", datetime.now(timezone.utc).strftime("%Y-%m-%d")),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.payments.insert_one(payment_doc)
    all_payments = await db.payments.find({"order_id": order_id}, {"_id": 0}).to_list(None)
    total_paid = sum(p["amount"] for p in all_payments)
    grand_total = float(order.get("grand_total", 0) or 0)
    payment_status = "paid" if grand_total > 0 and total_paid >= grand_total else "partial" if total_paid > 0 else "unpaid"
    await db.orders.update_one({"order_id": order_id}, {
        "$set": {"total_paid": total_paid, "payment_status": payment_status}
    })
    return {**payment_doc, "total_paid": total_paid, "payment_status": payment_status}


@router.get("/orders/{order_id}/payments")
async def get_order_payments(order_id: str, request: Request):
    await get_current_user(request)
    payments = await db.payments.find({"order_id": order_id}, {"_id": 0}).sort("created_at", -1).to_list(None)
    total_paid = sum(p["amount"] for p in payments)
    return {"payments": payments, "total_paid": total_paid}


# ==================== DISPATCHES ====================

@router.post("/dispatches")
async def create_dispatch(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    order_id = body.get("order_id")
    if not order_id:
        raise HTTPException(status_code=400, detail="order_id required")
    order = await db.orders.find_one({"order_id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order["order_status"] not in ("confirmed", "pending"):
        raise HTTPException(status_code=400, detail=f"Cannot dispatch order in '{order['order_status']}' status")

    items = await db.order_items.find({"order_id": order_id}, {"_id": 0}).to_list(1000)
    await _assert_dispatchable(order, items)

    dispatch_id = f"dsp_{uuid.uuid4().hex[:12]}"
    dispatch_count = await db.dispatches.count_documents({})
    dispatch_number = f"DSP-{datetime.now(timezone.utc).year}-{dispatch_count + 1:04d}"
    dispatch_doc = {
        "dispatch_id": dispatch_id,
        "dispatch_number": dispatch_number,
        "order_id": order_id,
        "order_number": order.get("order_number", ""),
        "school_name": order.get("school_name", ""),
        "school_id": order.get("school_id", ""),
        "dispatch_date": body.get("dispatch_date", datetime.now(timezone.utc).strftime("%Y-%m-%d")),
        "courier_name": body.get("courier_name", ""),
        "tracking_number": body.get("tracking_number", ""),
        "notes": body.get("notes", ""),
        "status": "dispatched",
        "created_by": user["email"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.dispatches.insert_one(dispatch_doc)

    for item in items:
        if item.get("status") in ("on_hold", "confirmed"):
            await db.dies.update_one({"die_id": item["die_id"]}, {
                "$inc": {"stock_qty": -item.get("quantity", 1), "reserved_qty": -item.get("quantity", 1)}
            })
            await db.order_items.update_one({"order_item_id": item["order_item_id"]}, {"$set": {"status": "dispatched"}})
    await db.orders.update_one({"order_id": order_id}, {"$set": {
        "order_status": "dispatched",
        "dispatch_date": dispatch_doc["dispatch_date"],
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }})
    await db.order_timeline.insert_one({
        "timeline_id": f"tl_{uuid.uuid4().hex[:8]}",
        "order_id": order_id,
        "status": "dispatched",
        "note": f"Dispatch {dispatch_number} created. {body.get('courier_name', '')} {body.get('tracking_number', '')}".strip(),
        "updated_by": user["email"],
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })

    await db.school_notifications.insert_one({
        "notification_id": f"notif_{uuid.uuid4().hex[:8]}",
        "school_id": order.get("school_id", ""),
        "type": "dispatch",
        "title": "Order Dispatched",
        "message": f"Your order {order.get('order_number', '')} has been dispatched via {body.get('courier_name', 'courier')}.",
        "order_id": order_id,
        "read": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

    return await db.dispatches.find_one({"dispatch_id": dispatch_id}, {"_id": 0})


@router.get("/dispatches")
async def get_dispatches(request: Request):
    user = await get_current_user(request)
    team = get_team(user)
    if team == "sales":
        # Sales see dispatches for their own orders only
        own_orders = await db.orders.find({"created_by": user["email"]}, {"_id": 0, "order_id": 1}).to_list(10000)
        order_ids = [o["order_id"] for o in own_orders]
        query = {"order_id": {"$in": order_ids}} if order_ids else {"order_id": "__none__"}
    else:
        query = {}
    dispatches = await db.dispatches.find(query, {"_id": 0}).sort("created_at", -1).to_list(5000)
    return dispatches


@router.put("/dispatches/{dispatch_id}/delivered")
async def mark_dispatch_delivered(dispatch_id: str, request: Request):
    user = await get_current_user(request)
    dispatch = await db.dispatches.find_one({"dispatch_id": dispatch_id}, {"_id": 0})
    if not dispatch:
        raise HTTPException(status_code=404, detail="Dispatch not found")
    await db.dispatches.update_one({"dispatch_id": dispatch_id}, {
        "$set": {"status": "delivered", "delivered_at": datetime.now(timezone.utc).isoformat()}
    })
    order_id = dispatch["order_id"]
    await db.orders.update_one({"order_id": order_id}, {
        "$set": {"order_status": "delivered", "updated_at": datetime.now(timezone.utc).isoformat()}
    })
    await db.order_items.update_many({"order_id": order_id}, {"$set": {"status": "delivered"}})
    await db.order_timeline.insert_one({
        "timeline_id": f"tl_{uuid.uuid4().hex[:8]}",
        "order_id": order_id,
        "status": "delivered",
        "note": f"Delivery confirmed for dispatch {dispatch['dispatch_number']}",
        "updated_by": user["email"],
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    await db.school_notifications.insert_one({
        "notification_id": f"notif_{uuid.uuid4().hex[:8]}",
        "school_id": dispatch.get("school_id", ""),
        "type": "delivered",
        "title": "Order Delivered",
        "message": f"Your order {dispatch.get('order_number', '')} has been delivered.",
        "order_id": order_id,
        "read": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"message": "Marked as delivered"}


@router.put("/dispatches/{dispatch_id}/tracking")
async def update_dispatch_tracking(dispatch_id: str, request: Request):
    user = await get_current_user(request)
    body = await request.json()
    allowed = {k: body[k] for k in ("tracking_number", "courier_name", "courier_url", "status") if k in body}
    allowed["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.dispatches.update_one({"dispatch_id": dispatch_id}, {"$set": allowed})
    disp = await db.dispatches.find_one({"dispatch_id": dispatch_id}, {"_id": 0})
    await log_activity(user["email"], "update_tracking", "dispatch", dispatch_id,
                       details=f"{allowed.get('courier_name','')} {allowed.get('tracking_number','')}")
    return disp


@router.get("/dispatches/{dispatch_id}/pdf")
async def dispatch_slip_pdf(dispatch_id: str, request: Request):
    await get_current_user(request)
    dispatch = await db.dispatches.find_one({"dispatch_id": dispatch_id}, {"_id": 0})
    if not dispatch:
        raise HTTPException(status_code=404, detail="Dispatch not found")
    order = await db.orders.find_one({"order_id": dispatch["order_id"]}, {"_id": 0})
    items = await db.order_items.find({"order_id": dispatch["order_id"]}, {"_id": 0}).to_list(1000)
    company = await db.settings.find_one({"type": "company"}, {"_id": 0}) or {}

    from reportlab.lib.pagesizes import A4
    from reportlab.lib import colors
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Spacer, Paragraph
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=20*mm, rightMargin=20*mm, topMargin=15*mm, bottomMargin=15*mm)
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle("Title2", parent=styles["Title"], fontSize=16, spaceAfter=6)
    h2 = ParagraphStyle("H2", parent=styles["Heading2"], fontSize=12, spaceAfter=4)
    normal = styles["Normal"]

    elements = []
    elements.append(Paragraph(company.get("company_name", "SmartShape Pro"), title_style))
    elements.append(Paragraph(f"DISPATCH SLIP — {dispatch['dispatch_number']}", h2))
    elements.append(Spacer(1, 4*mm))

    info_data = [
        ["Order:", dispatch.get("order_number", ""), "Date:", dispatch.get("dispatch_date", "")],
        ["School:", dispatch.get("school_name", ""), "Courier:", dispatch.get("courier_name", "")],
        ["Tracking #:", dispatch.get("tracking_number", ""), "Status:", dispatch.get("status", "").upper()],
    ]
    info_table = Table(info_data, colWidths=[70, 180, 70, 180])
    info_table.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("FONTNAME", (2, 0), (2, -1), "Helvetica-Bold"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    elements.append(info_table)
    elements.append(Spacer(1, 6*mm))

    item_data = [["#", "Die Code", "Die Name", "Type", "Qty", "Status"]]
    for i, item in enumerate(items, 1):
        item_data.append([
            str(i), item.get("die_code", ""), item.get("die_name", ""),
            item.get("die_type", ""), str(item.get("quantity", 1)), item.get("status", ""),
        ])
    item_table = Table(item_data, colWidths=[25, 80, 150, 70, 40, 80])
    item_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.Color(0.1, 0.1, 0.18)),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.Color(0.8, 0.8, 0.8)),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.Color(0.96, 0.96, 0.98)]),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
    ]))
    elements.append(Paragraph("Items", h2))
    elements.append(item_table)
    elements.append(Spacer(1, 8*mm))
    if dispatch.get("notes"):
        elements.append(Paragraph(f"<b>Notes:</b> {dispatch['notes']}", normal))
    elements.append(Spacer(1, 15*mm))
    elements.append(Paragraph("_________________________", normal))
    elements.append(Paragraph("Authorized Signature", normal))

    doc.build(elements)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/pdf",
                             headers={"Content-Disposition": f"attachment; filename=dispatch_{dispatch['dispatch_number']}.pdf"})


# ==================== HOLDS ====================

@router.get("/holds")
async def get_holds(request: Request):
    user = await get_current_user(request)
    team = get_team(user)
    holds = []
    if team == "sales":
        own_orders = await db.orders.find({"created_by": user["email"]}, {"_id": 0, "order_id": 1}).to_list(10000)
        order_ids = [o["order_id"] for o in own_orders]
        item_query = {"status": "on_hold", "order_id": {"$in": order_ids}} if order_ids else {"status": "on_hold", "order_id": "__none__"}
    else:
        item_query = {"status": "on_hold"}
    items = await db.order_items.find(item_query, {"_id": 0}).to_list(10000)
    for item in items:
        order = await db.orders.find_one({"order_id": item["order_id"]}, {"_id": 0})
        die = await db.dies.find_one({"die_id": item["die_id"]}, {"_id": 0})
        qty = int(item.get("quantity", 1) or 1)
        if die:
            # Availability for everyone EXCEPT this line, so "short" reflects what
            # this line can actually be covered by once others are accounted for.
            avail = await compute_availability(die, exclude_order_item_id=item["order_item_id"])
            available_for_line = avail["available"]
            committed = avail["committed"]
            stock_qty = avail["stock_qty"]
        else:
            available_for_line = committed = stock_qty = 0
        holds.append({
            "order_item_id": item["order_item_id"],
            "order_id": item["order_id"],
            "order_number": order.get("order_number", "") if order else "",
            "school_name": order.get("school_name", "") if order else "",
            "die_id": item["die_id"],
            "die_name": item.get("die_name", ""),
            "die_code": item.get("die_code", ""),
            "quantity": qty,
            "hold_date": order.get("created_at", "") if order else "",
            "stock_qty": stock_qty,
            "reserved_qty": die.get("reserved_qty", 0) if die else 0,
            "committed": committed,
            # available shown to the user already accounts for this line's own demand
            "available": available_for_line - qty,
            "short": max(0, qty - available_for_line),
            "status": item.get("status", "on_hold"),
        })
    return holds


@router.post("/holds/bulk-release")
async def bulk_release_holds(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    item_ids = body.get("item_ids", [])
    if not item_ids:
        raise HTTPException(status_code=400, detail="No item IDs provided")
    released = []
    skipped = []
    for order_item_id in item_ids:
        item = await db.order_items.find_one({"order_item_id": order_item_id})
        if not item or item.get("status") != "on_hold":
            skipped.append(order_item_id)
            continue
        await db.dies.update_one({"die_id": item["die_id"]}, {"$inc": {"reserved_qty": -item.get("quantity", 1)}})
        await db.order_items.update_one({"order_item_id": order_item_id}, {"$set": {"status": "released"}})
        released.append(order_item_id)
    return {"released": len(released), "skipped": len(skipped), "released_ids": released}


@router.post("/holds/{order_item_id}/release")
async def release_hold(order_item_id: str, request: Request):
    user = await get_current_user(request)
    item = await db.order_items.find_one({"order_item_id": order_item_id})
    if not item:
        raise HTTPException(status_code=404, detail="Hold item not found")
    if item.get("status") != "on_hold":
        raise HTTPException(status_code=400, detail="Item is not on hold")
    await db.dies.update_one({"die_id": item["die_id"]}, {"$inc": {"reserved_qty": -item.get("quantity", 1)}})
    await db.order_items.update_one({"order_item_id": order_item_id}, {"$set": {"status": "released"}})
    return {"message": "Hold released"}


@router.post("/holds/{order_item_id}/confirm")
async def confirm_hold(order_item_id: str, request: Request):
    user = await get_current_user(request)
    item = await db.order_items.find_one({"order_item_id": order_item_id})
    if not item:
        raise HTTPException(status_code=404, detail="Hold item not found")
    await db.order_items.update_one({"order_item_id": order_item_id}, {"$set": {"status": "confirmed"}})
    return {"message": "Hold confirmed"}


# ==================== STOCK RECONCILIATION ====================

@router.post("/stock/recompute-reservations")
async def recompute_reservations_endpoint(request: Request):
    """Admin/accounts: heal dies.reserved_qty drift by recomputing from live demand.

    Run once after deploying real-quantity reservation to correct legacy data left
    by the old +1-per-die behaviour.
    """
    user = await get_current_user(request)
    if get_team(user) not in ("admin", "accounts"):
        raise HTTPException(status_code=403, detail="Only admin/accounts can recompute reservations")
    report = await recompute_reservations()
    await log_activity(user["email"], "recompute", "stock", "reservations",
                       f"Recomputed reservations: {report['dies_fixed']}/{report['dies_scanned']} dies corrected")
    return report
