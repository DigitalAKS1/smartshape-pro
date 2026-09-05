"""account_lifecycle.py — what a school IS, as distinct from what its deals are doing.

A pipeline stage describes a deal. It cannot describe an account, and the CRM
had been asking it to: `retention` and `resell` were stages in a pipeline whose
terminal state is `won`, which is why a loyal repeat customer scored zero in the
forecast the moment somebody moved them there.

An account's state is a fact about its order history, so it is derived here and
never typed:

    prospect  — has never ordered
    customer  — has ordered, and recently enough to still be active
    dormant   — has ordered, but not for a while. The win-back list.

A school that has ever bought is never a prospect again; the only question is
whether it has gone quiet. How long counts as quiet is a setting, because two
school terms is not the same length everywhere.

Derived rather than stored-by-hand on purpose: a typed status drifts the first
time somebody forgets to update it, and a stale account status is worse than
none, because people act on it.
"""

from datetime import datetime, timezone

# An order that was cancelled never became a relationship.
NON_REVENUE_ORDER_STATUSES = {"cancelled"}

DEFAULT_DORMANT_AFTER_DAYS = 180   # roughly two school terms

PROSPECT = "prospect"
CUSTOMER = "customer"
DORMANT = "dormant"


def _days_between(iso: str, now: datetime) -> int:
    try:
        then = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return 0
    if then.tzinfo is None:
        then = then.replace(tzinfo=timezone.utc)
    return max(0, (now - then).days)


async def recompute_school_lifecycle(db, school_id: str,
                                     dormant_after_days: int = DEFAULT_DORMANT_AFTER_DAYS) -> dict | None:
    """Recompute one school's account status and order history, and store it.

    Returns the computed fields, or None if the school no longer exists.
    Idempotent — safe to call on every order event and to re-run in bulk.
    """
    sid = (school_id or "").strip()
    if not sid:
        return None
    if not await db.schools.find_one({"school_id": sid}, {"_id": 0, "school_id": 1}):
        return None

    orders = []
    async for o in db.orders.find(
        {"school_id": sid, "is_deleted": {"$ne": True}},
        {"_id": 0, "grand_total": 1, "status": 1, "created_at": 1},
    ):
        if (o.get("status") or "") in NON_REVENUE_ORDER_STATUSES:
            continue
        orders.append(o)

    now = datetime.now(timezone.utc)
    dates = sorted(o.get("created_at") for o in orders if o.get("created_at"))
    first_order_at = dates[0] if dates else None
    last_order_at = dates[-1] if dates else None
    days_since = _days_between(last_order_at, now) if last_order_at else None

    if not orders:
        status = PROSPECT
    elif days_since is not None and days_since > dormant_after_days:
        status = DORMANT
    else:
        status = CUSTOMER

    fields = {
        "account_status": status,
        "order_count": len(orders),
        "lifetime_value": round(sum(float(o.get("grand_total", 0) or 0) for o in orders), 2),
        "first_order_at": first_order_at,
        "last_order_at": last_order_at,
        "days_since_last_order": days_since,
    }
    await db.schools.update_one({"school_id": sid}, {"$set": fields})
    return fields


async def backfill_all(db, dormant_after_days: int = DEFAULT_DORMANT_AFTER_DAYS) -> dict:
    """Classify every live school in one pass. Returns counts per status."""
    by_status: dict = {}
    scanned = 0
    async for s in db.schools.find({"is_deleted": {"$ne": True}}, {"_id": 0, "school_id": 1}):
        out = await recompute_school_lifecycle(db, s["school_id"], dormant_after_days)
        if out is None:
            continue
        scanned += 1
        by_status[out["account_status"]] = by_status.get(out["account_status"], 0) + 1
    return {"scanned": scanned, "by_status": by_status}
