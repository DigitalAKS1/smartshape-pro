# Honest Stock — Order-Flow Program Design

**Date:** 2026-06-12
**Branch:** `feat/honest-stock`
**Owner decisions captured during brainstorming (2026-06-12).**

## Problem

The order flow currently lies about stock. Specifically:

1. **Reservation bug:** catalogue submit increments `dies.reserved_qty` by `+1` per selected die regardless of how many the customer actually wants. A school wanting 50 of a die reserves 1. Order items are also created with hardcoded `quantity: 1`. (`quotation_routes.py:1569`, `order_routes.py:189`)
2. **No cross-PO availability:** the system never aggregates demand for the same die across multiple open quotations/orders, so two customers can each be "promised" the same last units.
3. **Selection is frozen after submit:** no way to add/remove a die or change a quantity without deleting the whole quotation.
4. **No partial dispatch:** an order ships as one whole batch.
5. **Returnable challan (demo/exhibition/sampling) has backend only:** no UI, no demo/exhibition/sampling reason, and sending dies out does not affect available stock.

## Locked Decisions

- **Quantity source:** sales proposes a per-die quantity (carried via the quotation line allowance), the catalogue shows it, the school can adjust each die's quantity before submitting. The final number drives reservation.
- **Availability formula:** `Available(die) = stock_qty − Committed(die)` where
  `Committed = Σ quantities of all order_items in {on_hold, confirmed} across ALL orders + quantities currently out on returnable challans`.
- **Oversell rule:** *soft at reservation* (allow, show "short by N", raise a purchase/production alert) and *hard at dispatch* (can only ship physical stock; remainder waits — that is what Partial Dispatch is for).
- **Manage Selection edit rights:** staff only (admin/store/accounts), allowed until the order begins dispatching. Shipped lines lock.

## Build Sequence (each its own spec → plan → build)

| Step | Feature | Outcome |
|---|---|---|
| 1 | **Honest Stock (A+C)** | Real-quantity reservation, live availability helper, Holds shows Committed/Available/Short, recompute-reservations admin action. Foundation; fixes the live bug. |
| 2 | **Manage Selection (B)** | Staff add/remove dies & change quantities on a submitted order; reservations auto-adjust. |
| 3 | **Partial Dispatch (D)** | Ship part of an order now, rest stays pending; per-shipment delivery challan. |
| 4 | **Returnable Challan UI (E)** | Screen for Demo/Exhibition/Sampling out + return tracking; out reduces available stock, return restores it. |

---

## Step 1 Detailed Design — Honest Stock (A + C)

### Data model changes
- `catalogue_selection_items` gains `quantity: int` (default 1).
- `order_items.quantity` becomes the real per-die quantity (already respected at dispatch).
- No change to `dies` shape; `reserved_qty` stays as a denormalized cache but the **source of truth** becomes a live computation over `order_items`.

### Backend
1. **Availability helper** (`order_routes.py`, reusable): `compute_committed(die_id)` = sum of `order_items.quantity` where `status in {on_hold, confirmed}`. `available = stock_qty − committed`. (Returnable-challan term added in Step 4.)
2. **Catalogue submit** accepts either the legacy `selected_dies: [die_id,...]` (qty 1 each, backward compatible) or `selections: [{die_id, quantity}]`. Reserves the real quantity per die; raises the shortage alert using the real shortfall.
3. **create_order_for_quotation** copies `quantity` from the selection item instead of hardcoding 1.
4. **/holds** response adds `committed`, `available`, and `short` (max(0, quantity − available_excluding_self)) so the store sees true shortage per line.
5. **Recompute endpoint** `POST /api/stock/recompute-reservations` (admin): recalculates every die's `reserved_qty` from open order_items to heal legacy drift; returns a diff report.

### Frontend
- **CataloguePage**: each selected die shows a quantity stepper (default 1); the type counters ("Standard X/Y") sum quantities, not distinct dies; submit posts `selections: [{die_id, quantity}]`.
- **Holds view (OrdersManagement)**: per-line `Available` and a red `Short by N` badge; confirm still allowed when short, with a warning.

### Safety / rollout
- Backward compatible: old `selected_dies` payloads still work (qty 1).
- The recompute endpoint is the migration tool for existing prod data after deploy.
- No destructive changes to existing collections.

### Out of scope for Step 1
Manage Selection editing, partial dispatch, and returnable-challan UI (Steps 2–4).
