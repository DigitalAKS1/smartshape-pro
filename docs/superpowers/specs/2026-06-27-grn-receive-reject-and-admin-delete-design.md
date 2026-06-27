# GRN Receive-with-Reject + Admin Select-and-Delete (Procurement/Inventory)

**Date:** 2026-06-27
**Base branch:** feat/grn-receive-reject (off origin/main `8d3c335`)
**Status:** Design — pending approval

## Problem

Two gaps in the Procurement / Inventory flow:

1. **No partial good/reject within a received line.** Receiving a PO opens a GRN whose
   QC step ([`procurement_routes.py` `submit_qc`](../../../backend/routes/procurement_routes.py))
   assigns **one disposition to the whole line** — `ok` (all stocked), `hold`, or `return`
   (all not stocked). You cannot say "received 2, of which 1 is good and 1 is rejected."
2. **No deletion / reversal of transactional records.** POs, GRNs, stock movements, vendor
   returns, and challans have **no DELETE endpoint** and form an immutable trail with no
   reversal. When data is entered wrongly, an admin has no way to remove it and undo its
   stock effect.

## Goals

- **Part A:** Receiving captures, per line, **Received / Accepted / Rejected** quantities.
  Only Accepted is stocked. Rejected (with a required reason) auto-creates a vendor return.
- **Part B:** An **admin-only "select & delete"** capability on the procurement/inventory
  records the user named (GRN, Stock/Material Movement, PO, Vendor Return, Challan). Each
  delete **reverses its stock effect** and **snapshots to `audit_backups`** (restorable),
  matching the existing owner-delete pattern.

## Non-Goals (YAGNI)

- Not a universal "delete anything anywhere." Delete is implemented only for the five record
  types above, via one reusable pattern that can later be extended screen-by-screen.
- No change to PO creation, vendor masters, or QC templates.
- The legacy per-line `hold` disposition is folded into the quantity model (see Part A);
  no separate "hold" workflow is added.

## Build order

Single spec; implement **Part A first** (smaller, higher value), then **Part B**.

---

## Part A — Receiving with Good / Rejected split

### Data model (GRN line)

Each `goods_receipts.lines[]` entry gains quantity fields (replacing the single
`qc_status` disposition as the source of truth for stocking):

| Field | Meaning |
|---|---|
| `received_qty` | Total physically received this GRN (existing field, reused) |
| `rejected_qty` | Of received, how many are rejected (new; default 0) |
| `accepted_qty` | `received_qty − rejected_qty`, computed server-side (new) |
| `reject_reason` | Required when `rejected_qty > 0` (new; reuses existing remark codes) |

`qc_status` is retained for display/back-compat and derived: `accepted` if
`rejected_qty == 0`, `partial_reject` if `0 < rejected_qty < received_qty`, `rejected` if
`rejected_qty == received_qty`.

### Backend changes (`procurement_routes.py`)

- **`submit_qc`** (`POST /goods-receipts/{grn_id}/qc`): accept per-line
  `received_qty` + `rejected_qty` (+ `reject_reason`). Validate `0 ≤ rejected_qty ≤ received_qty`
  and require a reason when `rejected_qty > 0` (400 otherwise). Compute
  `accepted_qty = received_qty − rejected_qty`. Call `_apply_stock_in(item_ref, accepted_qty, …)`
  with the **accepted** quantity (was: whole line when `ok`).
- **`_advance_po_after_qc`**: accumulate PO line `received_qty` using **`accepted_qty`**
  (was: `received_qty` of `ok` lines). PO becomes `received` only when accepted ≥ ordered on
  every line.
- **Auto vendor return:** after stocking, if `Σ rejected_qty > 0`, create one
  `vendor_returns` doc from the rejected lines (qty = `rejected_qty`, reason = `reject_reason`),
  reusing the `create_return` shape, and set `goods_receipts.return_id`. Refactor `create_return`'s
  body into a shared helper `_build_vendor_return(grn, rejected_lines, user)` so both the auto
  path and the existing manual endpoint use it. Non-blocking: a return-creation failure must not
  undo the stock-in (log + continue), mirroring existing fire-and-forget patterns.

### Frontend changes (`components/procurement/ReceivingQC.js`)

QC dialog table columns per line: **Ordered · Outstanding · Received · Rejected · Accepted(auto)**,
plus a **Reason** select shown/required when Rejected > 0. Remove the all-or-nothing
ok/hold/return dropdown; disposition is now driven by the rejected quantity. Submit posts
`{ lines: [{ po_line_index, received_qty, rejected_qty, reject_reason }] }`.

Worked example (PO with 44 lines; one batch receives A & B, ordered 8 each):
A received 2 → Rejected 1, Reason "damaged" → Accepted 1 stocked, 1 on auto vendor return;
B received 4 → Rejected 0 → Accepted 4 stocked. PO moves to `partially_received`.

---

## Part B — Admin select-and-delete with reversal

### Authorization

Admin-role only: gate each delete on `get_team(user) == "admin"` → else `403`. (Module RBAC
already lets admins pass; this additionally **restricts** delete to admins regardless of module
grants.)

### Audit + reversal helpers (`procurement_routes.py` / shared)

- `_snapshot_to_audit_backups(kind, docs, user)` — store deleted doc(s) under `audit_backups`
  with `{ backup_id, kind, docs, deleted_by, deleted_at, restored: false }` (reuse the existing
  owner-delete backup collection/shape; restore stays once-only).
- `_reverse_movement(mov)` — invert a `stock_movements` row's effect on `stock_qty`:
  inbound types (`purchase_in`, `stock_in`, `returnable_in`, `returned_from_sales`) → decrement;
  outbound types (`stock_out`, `returnable_out`, `allocated_to_sales`) → increment;
  `physical_adjustment` → restore `system_qty`. Operates on `dies` or `purchase_items` per `item_ref`/`die_id`.

### Delete endpoints

| Endpoint | Reversal behavior |
|---|---|
| `DELETE /stock/movements/{movement_id}` (inventory_routes) | `_reverse_movement` the row, snapshot, delete. |
| `DELETE /goods-receipts/{grn_id}` | Reverse every `stock_movements` with `reference_id == grn_id` (decrement stock); subtract this GRN's `accepted_qty` from each PO line `received_qty` and recompute PO status; delete the spawned `vendor_returns` (by `grn_id`); snapshot GRN + movements + return; delete GRN. |
| `DELETE /purchase-orders/{po_id}` | **Cascade:** for each GRN under the PO, run the GRN-delete reversal above; then snapshot + delete the PO. |
| `DELETE /vendor-returns/{return_id}` | Snapshot + delete; clear `goods_receipts.return_id`. (Rejected items were never stocked, so no stock change.) |
| `DELETE /challans/{challan_id}` | Reverse the challan's `returnable_out`/`returnable_in` movements, snapshot, delete. |

All deletes are idempotent-safe (404 if already gone) and wrapped so a reversal failure aborts
the delete (no partial state).

### Frontend changes

Add admin-only **row checkboxes + "Delete selected"** (with a confirm dialog naming the records
and the stock reversal) to:
- [`pages/admin/Procurement.js`](../../../frontend/src/pages/admin/Procurement.js) — POs and, in the GRN/receiving list ([`ReceivingQC.js`](../../../frontend/src/components/procurement/ReceivingQC.js)), GRNs and vendor returns.
- [`pages/admin/StockManagement.js`](../../../frontend/src/pages/admin/StockManagement.js) — Material Movement rows.
- Challan list (wherever challans are shown).

Visibility gated on `user.role === 'admin'`. After delete, refetch the list and show a toast
summarizing what was removed and reversed.

## Error handling

- Part A: 400 on `rejected_qty` out of range or missing reason; stock-in uses accepted only;
  vendor-return failure is logged, never rolls back the receipt.
- Part B: 403 for non-admins; 404 for missing records; reversal errors abort the delete with a
  clear message; every delete writes an `audit_backups` snapshot before removing data.

## Testing

Backend (`backend/tests/`): unit-test `submit_qc` accepted/rejected math + auto-return creation;
test each delete reverses stock correctly (assert `stock_qty` before/after) and writes a backup;
test PO cascade delete removes child GRNs and reverses their stock; test non-admin gets 403.
Manual: run the worked example end-to-end; delete a GRN and confirm stock + PO status roll back;
delete a movement and confirm `stock_qty` restored.

## Rollout

Backend + a frontend bundle rebuild ship together via the now-standard safe path (craco build
off-box → commit `frontend/build` + source → push origin/main → auto-deploy → verify live bundle).
No DB migration; new fields default to 0/empty and existing GRNs read normally.
