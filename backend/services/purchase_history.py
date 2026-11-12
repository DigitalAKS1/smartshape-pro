"""purchase_history.py — everything a school has bought, from any source.

Two sources:
  - real app orders (`db.orders` + `db.order_items`), and
  - past purchases (`db.past_purchases`): orders from before the app, or bought
    outside it, entered by hand or uploaded once. They never touch stock,
    production or payments — they are history, not work.

`revenue_events` is the one place that decides "did this school buy, and when",
so account status (prospect/customer/dormant) and reorder-due agree with the
purchase history a rep sees on the school profile.
"""

# A cancelled order never became a relationship. Orders store `order_status`;
# a few legacy/test rows use `status` — honour both.
NON_REVENUE_ORDER_STATUSES = {"cancelled"}
# order_items lines that were never really part of the order (same set order_routes skips).
DEAD_ITEM_STATUSES = ("removed", "cancelled", "released")


def is_cancelled(order: dict) -> bool:
    return ((order.get("order_status") or "") in NON_REVENUE_ORDER_STATUSES
            or (order.get("status") or "") in NON_REVENUE_ORDER_STATUSES)


def _past_at(date_str: str) -> str:
    return f"{date_str}T00:00:00+00:00" if date_str else ""


async def revenue_events(db, school_ids: list) -> dict:
    """{school_id: [{"at": iso, "amount": float, "source": "order"|"past"}]} (unsorted)."""
    ids = [s for s in (school_ids or []) if s]
    out: dict = {}
    if not ids:
        return out
    async for o in db.orders.find(
            {"school_id": {"$in": ids}, "is_deleted": {"$ne": True}},
            {"_id": 0, "school_id": 1, "grand_total": 1, "status": 1, "order_status": 1, "created_at": 1}):
        if is_cancelled(o):
            continue
        # An order with no created_at still counts as a purchase; it just has no date
        # (`at` = "") so it can't set first/last date or reorder cadence.
        out.setdefault(o["school_id"], []).append(
            {"at": o.get("created_at") or "", "amount": float(o.get("grand_total") or 0), "source": "order"})
    async for p in db.past_purchases.find(
            {"school_id": {"$in": ids}, "is_deleted": {"$ne": True}},
            {"_id": 0, "school_id": 1, "purchase_date": 1, "amount": 1}):
        if not p.get("purchase_date"):
            continue
        out.setdefault(p["school_id"], []).append(
            {"at": _past_at(p["purchase_date"]), "amount": float(p.get("amount") or 0), "source": "past"})
    return out


def _item_key(it: dict) -> str:
    if it.get("die_id"):
        return f"id:{it['die_id']}"
    code = (it.get("die_code") or "").strip().lower()
    return f"code:{code}" if code else f"name:{(it.get('name') or '').strip().lower()}"


async def school_purchase_history(db, school_id: str) -> dict:
    """Entries (newest first) and a per-item summary for one school."""
    entries = []
    orders = [o async for o in db.orders.find(
        {"school_id": school_id, "is_deleted": {"$ne": True}},
        {"_id": 0, "order_id": 1, "order_number": 1, "grand_total": 1, "order_status": 1,
         "status": 1, "created_at": 1, "package_name": 1})]
    live = [o for o in orders if not is_cancelled(o)]
    items_by_order: dict = {}
    if live:
        # Lines edited out of an order, cancelled or released were never owned.
        async for it in db.order_items.find(
                {"order_id": {"$in": [o["order_id"] for o in live]},
                 "status": {"$nin": list(DEAD_ITEM_STATUSES)}}, {"_id": 0}):
            items_by_order.setdefault(it["order_id"], []).append({
                "die_id": it.get("die_id"), "die_code": it.get("die_code") or "",
                "name": it.get("die_name") or it.get("die_code") or "",
                "item_type": "machine" if it.get("die_type") == "machine" else "die",
                "qty": int(it.get("quantity") or 0),
            })
    for o in live:
        entries.append({
            "kind": "order", "id": o["order_id"], "number": o.get("order_number") or "",
            "date": (o.get("created_at") or "")[:10], "amount": float(o.get("grand_total") or 0),
            "status": o.get("order_status") or o.get("status") or "", "notes": o.get("package_name") or "",
            "items": items_by_order.get(o["order_id"], []),
        })
    async for p in db.past_purchases.find({"school_id": school_id, "is_deleted": {"$ne": True}}, {"_id": 0}):
        entries.append({
            "kind": "past", "id": p["purchase_id"], "number": p.get("reference") or "",
            "date": p.get("purchase_date") or "", "amount": float(p.get("amount") or 0),
            "status": "", "notes": p.get("notes") or "", "source": p.get("source") or "manual",
            "created_by": p.get("created_by") or "", "items": p.get("items") or [],
            "stock_adjusted": bool(p.get("stock_adjusted")),
        })
    entries.sort(key=lambda e: e["date"], reverse=True)

    summary: dict = {}
    for e in entries:
        for it in e["items"]:
            k = _item_key(it)
            row = summary.setdefault(k, {
                "key": k, "die_id": it.get("die_id"), "die_code": it.get("die_code") or "",
                "name": it.get("name") or it.get("die_code") or "", "item_type": it.get("item_type") or "die",
                "total_qty": 0, "times": 0, "last_date": "",
            })
            row["total_qty"] += int(it.get("qty") or 0)
            row["times"] += 1
            if e["date"] > row["last_date"]:
                row["last_date"] = e["date"]
    items = sorted(summary.values(), key=lambda r: (r["last_date"], r["total_qty"]), reverse=True)
    return {"entries": entries, "items": items}


async def owned_by_die(db, school_id: str) -> dict:
    """{die_id: {"qty", "last_date", "times"}} for inventory dies this school already
    bought — what the catalogue pages badge as "Already ordered". Free-text items
    (no die_id) can't be matched to a catalogue card, so they are left out."""
    if not school_id:
        return {}
    hist = await school_purchase_history(db, school_id)
    return {i["die_id"]: {"qty": i["total_qty"], "last_date": i["last_date"], "times": i["times"]}
            for i in hist["items"] if i.get("die_id")}
