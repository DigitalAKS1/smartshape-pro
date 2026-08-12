"""DB operations that keep an order's collected-amount honest.

`recompute_and_sync` is the single entry point used by the live payment route,
by order creation, and by the backfill migration. It:

  1. Journals the at-creation advance (`orders.payment_received` at creation)
     into the payments ledger exactly once, using a deterministic id so a
     re-run can never duplicate it or re-read a value that has since been
     mirrored — this is the money-safety guarantee.
  2. Recomputes the complete collected amount as sum(ledger) and writes it to
     BOTH `total_paid` and `payment_received`, so every existing reader (360,
     receivables, customer portal) is correct without being touched.

Takes `db` as an argument so it is unit-tested with mongomock and shared by the
route and the backfill (they can never drift).
"""
from __future__ import annotations

from services import payment_recon as pr


async def recompute_and_sync(db, order_id: str):
    """Make the ledger the source of truth for one order and sync its caches.

    Returns {"total_paid", "payment_status"} or None if the order is gone.
    Idempotent: safe to call repeatedly (route, redeploy, re-run backfill)."""
    order = await db.orders.find_one({"order_id": order_id}, {"_id": 0})
    if not order:
        return None

    # 1. Journal the creation advance exactly once — the FIRST time this order is
    #    synced. The guard is the persisted `_ledger_synced` flag, NOT the
    #    advance-row's existence: a zero advance never creates a row, so keying on
    #    the row would keep re-reading payment_received (which step 2 has since
    #    overwritten with the running total) and fabricate a phantom advance on
    #    every later payment. The flag is set exactly once, so payment_received is
    #    only ever treated as "the advance" while it still holds the real advance.
    if not order.get("_ledger_synced"):
        advance = float(order.get("payment_received", 0) or 0)
        if advance > 0:
            await db.payments.insert_one(pr.advance_row(
                order_id, advance,
                payment_date=(order.get("created_at") or "")[:10] or None,
                created_at=order.get("created_at"),
                recorded_by=order.get("created_by", "system"),
            ))

    # 2. Recompute from the now-complete ledger and mirror onto both fields.
    rows = await db.payments.find({"order_id": order_id}, {"_id": 0}).to_list(None)
    total = pr.ledger_total(rows)
    status = pr.payment_status(order.get("grand_total", 0), total)
    await db.orders.update_one(
        {"order_id": order_id},
        {"$set": {"total_paid": total, "payment_received": total,
                  "payment_status": status, "_ledger_synced": True}},
    )
    return {"total_paid": total, "payment_status": status}
