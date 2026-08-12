"""Single source of truth for 'how much has been collected against an order'.

Background — the bug this fixes:
  Money used to live in TWO disconnected places. `orders.payment_received` held
  the advance captured at order-creation but was NEVER written to the payments
  ledger; `orders.total_paid` was the ledger sum and therefore EXCLUDED that
  advance. So neither field was complete, and the 360 / receivables / customer
  portal (which read `payment_received`) showed wrong balances the moment any
  payment was recorded after creation.

The fix — one ledger:
  db.payments is the single source of truth. The creation advance is journaled
  into it as the first ledger row (deterministic id => idempotent), so
  `sum(ledger)` is always the complete collected amount. `total_paid` and
  `payment_received` become synced caches of that sum, so every existing reader
  is correct without being touched.

These functions are PURE (no DB, no clock) so they are unit-tested in isolation
and shared verbatim by the live route and the backfill — the two can never
compute paid-amount differently again.
"""
from __future__ import annotations

# Ledger `method` used for the row that represents the at-creation advance.
CREATION_ADVANCE_METHOD = "order_advance"


def advance_payment_id(order_id: str) -> str:
    """Deterministic payment_id for an order's creation-advance ledger row.

    Being deterministic is what makes journaling idempotent: inserting with this
    id (or upserting on it) means a second backfill run can never duplicate the
    advance."""
    return f"padv_{order_id}"


def ledger_total(rows) -> float:
    """Total collected across payment-ledger rows. Non-numeric/missing amounts
    are skipped rather than crashing a reconciliation over dirty legacy data."""
    total = 0.0
    for r in rows or []:
        try:
            total += float(r.get("amount", 0) or 0)
        except (TypeError, ValueError):
            continue
    return round(total, 2)


def payment_status(grand_total, paid) -> str:
    """'paid' | 'partial' | 'unpaid'. Preserves the original rule exactly,
    including that a zero grand_total is never 'paid'."""
    g = float(grand_total or 0)
    p = float(paid or 0)
    if g > 0 and p >= g:
        return "paid"
    return "partial" if p > 0 else "unpaid"


def reconcile_row(order, payment_rows):
    """Read-only reconciliation line for one order — what the backfill WOULD do,
    with no writes. Pure so the dry-run report is trustworthy and re-runnable.

    Idempotent: once the advance is journaled and payment_received mirrored, the
    reported delta is 0. Flags a non-advance payment equal to the advance as a
    possible double-entry for a human to check."""
    order_id = order.get("order_id")
    adv_id = advance_payment_id(order_id)
    rows = payment_rows or []
    adv_row = next((r for r in rows if r.get("payment_id") == adv_id), None)
    # Already source-of-truth if the order was synced (flag) OR its advance is
    # already journaled (row present) — either way payment_received already
    # mirrors the full ledger, so re-deriving an advance would double it.
    already = bool(order.get("_ledger_synced")) or (adv_row is not None)
    non_advance = [r for r in rows if r.get("payment_id") != adv_id]
    ledger_excl = ledger_total(non_advance)
    if already:
        advance = float(adv_row.get("amount", 0) or 0) if adv_row else 0.0
        will_show = ledger_total(rows)  # full ledger IS the complete total
    else:
        advance = float(order.get("payment_received", 0) or 0)  # not yet in ledger
        will_show = round(advance + ledger_excl, 2)
    shown_now = float(order.get("payment_received", 0) or 0)
    dup_flag = advance > 0 and any(
        abs(float(r.get("amount", 0) or 0) - advance) < 0.005 for r in non_advance)
    return {
        "order_id": order_id,
        "order_number": order.get("order_number", order_id),
        "grand_total": float(order.get("grand_total", 0) or 0),
        "advance": round(advance, 2),
        "ledger_excl_advance": ledger_excl,
        "shown_now": round(shown_now, 2),
        "will_show": will_show,
        "delta": round(will_show - shown_now, 2),
        "already_journaled": already,
        "dup_flag": dup_flag,
    }


def advance_row(order_id, amount, *, payment_date=None, created_at=None,
                recorded_by="system"):
    """Build the ledger row that represents the advance taken at order creation.

    Carries the deterministic id + an `is_creation_advance` marker so it is
    recognisable (and idempotent) later. Timestamps are passed in, never read
    from the clock here, to keep the function pure/testable."""
    return {
        "payment_id": advance_payment_id(order_id),
        "order_id": order_id,
        "amount": round(float(amount), 2),
        "method": CREATION_ADVANCE_METHOD,
        "reference": "",
        "notes": "Advance captured at order creation",
        "recorded_by": recorded_by,
        "payment_date": payment_date,
        "created_at": created_at,
        "is_creation_advance": True,
    }
