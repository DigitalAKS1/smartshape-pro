# Order, Stock & Reminder Upgrades — Design Spec

**Date:** 2026-06-15
**Branch:** feat/honest-stock
**Status:** Approved, ready for implementation

## Background

Audit of the existing codebase showed most of the requested order/inventory
behaviour already exists:

- Quotation → Sales Order creation (auto on catalogue submit + manual) — works.
- Product held against school via `reserved_qty` reservation — works.
- Dispatch auto-decrements physical stock + reservation — works.
- Sorting inventory by physical quantity (High→Low / Low→High) — works.

This spec covers the **7 real gaps**, ordered safest-first across three phases.
The user can stop after any phase. Today is launch day, so Phase A and B are
additive/low-risk; Phase C touches the order lifecycle and is done last.

## Decisions (from brainstorming)

- One plan, safest-first ordering.
- Cancel order: **Both** — soft "Cancelled" status for staff AND keep existing
  superadmin hard-delete.
- Task popup: **every 1 hour**, gentle/dismissible, for **everyone logged in**.
- Daily orders report: **in-app notification bell + WhatsApp**.
- "What changed" list: visible to **staff + school portal**.
- Returnable challan reminder: **admin, accounts, store**.
- Accounts rights on challans: **view + record returns** (not create).

---

## Phase A — Reminders & Daily Report (additive, no stock/money math)

### A1. Daily evening "Orders Received" report
- New scheduled job runs each evening (default 19:00 IST) computing orders
  created "today" (count, total value, list of school + amount).
- Output: (1) an in-app notification (existing `db.notifications` bell), and
  (2) a WhatsApp summary via the existing WhatsApp scheduled queue.
- **Off by default** behind an App Settings toggle + configurable time +
  recipient phone(s). Reuses patterns from existing daily digest / low-stock
  digest jobs in `scheduler.py`.
- Recipients: admin/owner (configurable).

### A2. Hourly task popup (everyone)
- Frontend-only. A dismissible popup appears once per hour per session showing
  the current user's pending/overdue tasks.
- Reuses the data the existing `NotificationBell` / tasks endpoints already
  load — no new heavy backend.
- If the user has zero pending/overdue tasks, no popup shows.
- Includes "Snooze / Don't show again today" so it is not disruptive.
- Hour cadence tracked client-side (e.g. localStorage timestamp) so it survives
  navigation but resets sensibly.

### A3. Returnable challan reminder + accounts access
- **RBAC:** open the Returnable Challans page/endpoints to the `accounts` role
  with **view + record-return** rights. Create stays admin/store.
  - Backend: relax `require_teams(user, "admin", "store")` guards in
    `procurement_routes.py` to include `accounts` for list/view and the
    `record-return` endpoint only.
  - Frontend `ReturnableChallans.js`: allow accounts to load the page; gate the
    "create" button to admin/store, allow "record return" for accounts.
- **Reminder:** a scheduled check finds challans whose `expected_return_date` is
  today or earlier and status still outstanding, and creates an in-app
  notification (type e.g. `returnable_challan_due`) targeted at admin, accounts,
  and store. It surfaces in the bell and in the A2 hourly popup. Optional
  WhatsApp nudge reusing A1's pipe.
- Dedup so the same challan does not spam every run.

---

## Phase B — Physical stock made easy

### B1. Single-product physical-count edit (with sync)
- Inventory UI: a per-product "Set physical qty" action. User enters the real
  counted quantity; backend sets `stock_qty` and **immediately recomputes
  reservations** so `available = stock_qty - reserved_qty` stays correct.
- **Fix the known `physical_adjustment` no-op bug** so a physical adjustment
  actually writes the counted value.
- Every change writes a stock movement / audit entry (who, when, old→new, note).
- Permission: admin/store (and superadmin).

### B2. Always-latest stock + sorting
- Sorting by physical qty already exists — ensure it is clearly labelled/visible
  in the inventory sort dropdown.
- Keep the 60s auto-refresh; refresh immediately after any stock edit; ensure a
  visible manual "Refresh" affordance so the displayed number is current.

---

## Phase C — Order lifecycle (most care, last)

### C1. Soft "Cancel / Not finalising" status (+ keep hard-delete)
- New `order_status = "cancelled"` set via a Cancel action.
  - Releases held (undispatched) stock back via `recompute_reservations()`.
  - Order stays visible (greyed/badged CANCELLED), not deleted.
  - Re-openable to a prior active status; re-opening re-reserves stock.
  - Frees the linked quotation/lead appropriately (mirror delete's behaviour
    but reversibly).
- Permission: admin + accounts.
- Existing superadmin hard-delete (`DELETE /orders/{id}`) stays unchanged.

### C2. Readable "what changed" list
- When order items change (staff edit or `reconcile_order_to_selection`), record
  a structured, human-readable diff per change event: added / removed / qty
  changed (old→new) with die code + name.
- Store on the order timeline (and/or a dedicated change-log array).
- Surface on the order detail for staff, and in the **school portal** as
  "what we changed vs what you asked."

### C3. Show returned/released stock as "+ back to stock"
- Whenever stock is freed (order cancelled, qty reduced, returnable item
  returned), record a visible "+N back to stock" entry in the product's stock
  movement history, mirroring the dispatch "-N" entries, so increases are as
  visible as decreases.

---

## Out of scope / already done
- Dispatch auto-minus stock — already implemented.
- Product held against school (reservation) — already implemented.
- Sorting by qty — already implemented (B2 only verifies/labels it).

## Risks & launch-day safety
- Phases A and B are additive; safe to ship on launch day.
- Phase C touches order/reservation lifecycle — gets the most testing and ships
  last. Re-open path must re-reserve stock correctly and not double-release.
- WhatsApp-dependent items (A1/A3 nudge) require the live WhatsApp connection.
- After any stock/reservation change, run `/api/stock/recompute-reservations`.

## Testing approach
- Each phase verified independently before moving on.
- Reservation invariants checked: `available = stock_qty - reserved_qty` after
  cancel/re-open/edit/dispatch/return.
- RBAC: confirm accounts can view + record returns but not create challans.
