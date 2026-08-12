"""Backfill: make the payments ledger the single source of truth for every order.

For each order it (a) journals the at-creation advance into db.payments exactly
once, and (b) sets total_paid AND payment_received to the complete ledger sum —
so the 360, receivables and customer portal all show correct balances.

SAFE BY DEFAULT: runs as a READ-ONLY reconciliation report. Nothing is written
until you pass --commit. Idempotent — re-running never double-counts.

    # 1. Review first (writes nothing):
    python -m migrations.backfill_payment_ledger

    # 2. After the report is reviewed with accounts, apply:
    python -m migrations.backfill_payment_ledger --commit

Reads MONGO_URL / DB_NAME from the environment (same as the app), so run it
against whichever database those point at.
"""
import argparse
import asyncio

from database import db, db_init_error
from services import payment_recon as pr
from services.payment_ledger import recompute_and_sync


def _fmt(n):
    return f"{n:,.2f}"


async def run(commit: bool):
    if db is None:
        raise SystemExit(f"DATABASE NOT INITIALISED — {db_init_error}. "
                         "Set MONGO_URL / DB_NAME and retry.")

    orders = await db.orders.find(
        {}, {"_id": 0, "order_id": 1, "order_number": 1, "grand_total": 1,
             "payment_received": 1}).to_list(None)

    rows, changed, dup_flags, total_delta = [], 0, 0, 0.0
    for o in orders:
        pays = await db.payments.find({"order_id": o["order_id"]}, {"_id": 0}).to_list(None)
        r = pr.reconcile_row(o, pays)
        rows.append(r)
        if r["delta"] != 0 or not r["already_journaled"]:
            changed += 1
            total_delta += r["delta"]
        if r["dup_flag"]:
            dup_flags += 1

    mode = "COMMIT (writing changes)" if commit else "DRY RUN (read-only, nothing written)"
    print(f"\n=== Payment-ledger backfill · {mode} ===")
    print(f"Orders scanned: {len(orders)} | will change: {changed} | "
          f"total balance correction: {_fmt(total_delta)} | double-entry flags: {dup_flags}\n")

    print(f"{'ORDER':<16}{'ADVANCE':>14}{'LEDGER':>14}{'SHOWN NOW':>14}{'WILL SHOW':>14}{'DELTA':>14}  FLAG")
    print("-" * 104)
    for r in rows:
        if r["delta"] == 0 and r["already_journaled"]:
            continue  # already correct — omit from the change list
        flag = "DUP?" if r["dup_flag"] else ""
        print(f"{str(r['order_number'])[:15]:<16}{_fmt(r['advance']):>14}"
              f"{_fmt(r['ledger_excl_advance']):>14}{_fmt(r['shown_now']):>14}"
              f"{_fmt(r['will_show']):>14}{_fmt(r['delta']):>14}  {flag}")

    if dup_flags:
        print(f"\n⚠  {dup_flags} order(s) have a payment equal to the advance — a possible "
              "double-entry.\n   Review these with accounts BEFORE committing.")

    if not commit:
        print("\nDRY RUN complete. No changes written. Re-run with --commit to apply.")
        return

    applied = 0
    for r in rows:
        if r["delta"] == 0 and r["already_journaled"]:
            continue
        await recompute_and_sync(db, r["order_id"])
        applied += 1
    print(f"\nCOMMITTED: {applied} order(s) reconciled.")


def main():
    ap = argparse.ArgumentParser(description="Backfill payment ledger (dry-run by default).")
    ap.add_argument("--commit", action="store_true",
                    help="Actually write changes. Omit for a read-only report.")
    args = ap.parse_args()
    asyncio.run(run(args.commit))


if __name__ == "__main__":
    main()
