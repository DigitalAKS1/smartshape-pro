# Order, Stock & Reminder Upgrades — Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close the 7 gaps in the order/stock/reminder flow (daily orders report, hourly task popup, returnable-challan reminder + accounts access, physical-qty quick edit, soft cancel order, readable "what changed", visible stock returns) — safest-first, in 3 phases.

**Architecture:** Backend is FastAPI + MongoDB (motor) in `backend/`; scheduled jobs are async loops in `backend/scheduler.py` started from `start_schedulers()` (line ~1197). In-app notifications are upserted into `db.notifications` (dedup by a stable key) and polled by the `NotificationBell` React component every 30s. Frontend is React (CRA) in `frontend/src/`. We follow existing patterns exactly (digest loop, notification upsert, `require_teams` RBAC, stock movement + `recompute_reservations`).

**Tech Stack:** FastAPI, motor/MongoDB, asyncio loops, React, react-scripts. WhatsApp via `db.whatsapp_scheduled` queue.

**Testing constraint:** Automated integration tests hit the PRODUCTION database in this project. Therefore: write pure-logic unit tests only (no DB, no network) and verify DB/integration behaviour manually. Frontend verified by build + manual click-through.

---

## Phase A — Reminders & Daily Report

### Task A1: Daily evening "Orders Received" report

**Files:**
- Modify: `backend/scheduler.py` (add `build_and_enqueue_daily_orders_report()` + `daily_orders_report_loop()`, register in `start_schedulers()` ~line 1205)
- Modify: `backend/routes/admin_routes.py` (settings GET/PUT for `daily_orders_report`, follow `daily-digest-settings` at ~line 1790-1803)
- Test: `backend/tests/test_daily_orders_report.py` (pure-logic formatter only)

- [ ] **Step 1 — Pure formatter unit test.** Create `_format_orders_report(orders, today)` taking a list of `{school_name, grand_total, order_number}` + date string, returning the WhatsApp text. Test: empty list → returns `None` (skip); 2 orders → text contains "Orders today: 2", total value, both school names.
- [ ] **Step 2 — Run test, expect FAIL** (`python -m pytest backend/tests/test_daily_orders_report.py -v`).
- [ ] **Step 3 — Implement `_format_orders_report`** in scheduler.py (pure function, no DB).
- [ ] **Step 4 — Run test, expect PASS.**
- [ ] **Step 5 — Implement `build_and_enqueue_daily_orders_report()`**: query `db.orders.find({"created_at": {"$gte": <today 00:00 IST in same string format as stored>}})`; compute count + sum(grand_total); call `_format_orders_report`; if text: (a) upsert an in-app notification into `db.notifications` keyed `daily_orders_report:<today>` targeted at admin recipients (mirror upsert pattern at admin_routes.py:1022), (b) enqueue a `db.whatsapp_scheduled` row to the configured phone(s) (mirror digest at scheduler.py:636). Guard behind `cfg.enabled`.
- [ ] **Step 6 — Implement `daily_orders_report_loop()`** mirroring `daily_digest_loop()` (scheduler.py:648): read `db.settings {type:"daily_orders_report"}`, fire once when `now_ist HH:MM == send_time` (default `19:00`), `last_fired` guard, `await asyncio.sleep(45)`.
- [ ] **Step 7 — Register** `asyncio.create_task(daily_orders_report_loop())` in `start_schedulers()` after line 1205.
- [ ] **Step 8 — Settings endpoints** in admin_routes.py: `GET /admin/daily-orders-report-settings` and `PUT` (enabled, send_time, recipient phones) mirroring daily-digest settings. Default disabled.
- [ ] **Step 9 — Manual verify:** temporarily set send_time to current minute on a scratch settings doc (or call the build function directly via a one-off script), confirm a notification row appears and a whatsapp_scheduled row is queued. Revert.
- [ ] **Step 10 — Commit** `feat(reports): daily evening Orders Received report (in-app + WhatsApp, off by default)`.

### Task A2: Hourly task popup (frontend, everyone)

**Files:**
- Create: `frontend/src/components/notifications/TaskReminderPopup.js`
- Modify: `frontend/src/App.js` (mount `<TaskReminderPopup/>` inside the authed layout)
- Reuse: existing notifications/tasks fetch (NotificationBell uses `GET /notifications`; tasks via existing endpoint)
- Test: `frontend/src/components/notifications/__tests__/taskPopupSchedule.test.js` (pure timing logic)

- [ ] **Step 1 — Pure schedule unit test.** Extract `shouldShowPopup(lastShownTs, nowTs, snoozedForDay)` → boolean: true when >= 1h since last shown and not snoozed today. Test the boundaries (59min→false, 61min→false-if-snoozed, 61min→true).
- [ ] **Step 2 — Run test, expect FAIL.**
- [ ] **Step 3 — Implement `shouldShowPopup`** in a small `taskPopupSchedule.js` helper.
- [ ] **Step 4 — Run test, expect PASS.**
- [ ] **Step 5 — Build `TaskReminderPopup`**: on mount + every 5 min tick, read user's pending/overdue tasks (reuse the same source NotificationBell uses); use `shouldShowPopup` with a `localStorage` timestamp + a `snoozeUntilDate` key; if it should show and task count > 0, render a dismissible bottom-right card listing up to 5 tasks with "Snooze today" and "View all" (links to `/today`). On dismiss, set lastShown=now.
- [ ] **Step 6 — Mount** in App.js authed area; do not render on login/portal-only routes.
- [ ] **Step 7 — Verify build** `cd frontend && set DISABLE_ESLINT_PLUGIN=true && npm run build` (eslint quirk per project notes). Manual: log in, force `lastShown` old, confirm popup, dismiss, snooze.
- [ ] **Step 8 — Commit** `feat(tasks): hourly dismissible task reminder popup for all users`.

### Task A3: Returnable challan reminder + accounts access

**Files:**
- Modify: `backend/routes/procurement_routes.py` (RBAC on `list_challans`, `get_challan`, `record_challan_return`; keep create admin/store)
- Modify: `backend/scheduler.py` (add `challan_due_loop()` or fold into low_stock/daily loop; create notifications)
- Modify: `frontend/src/pages/admin/ReturnableChallans.js` (allow accounts to load page; gate create vs record-return by role)
- Modify: `backend/rbac.py` if a helper is needed
- Test: `backend/tests/test_challan_due.py` (pure due-date filter logic)

- [ ] **Step 1 — Pure filter unit test.** `_challans_due(challans, today)` returns open/partially_returned challans with `expected_return_date <= today`. Test: closed excluded, no-date excluded, future date excluded, today/past included.
- [ ] **Step 2 — Run test, expect FAIL.**
- [ ] **Step 3 — Implement `_challans_due`** (pure).
- [ ] **Step 4 — Run test, expect PASS.**
- [ ] **Step 5 — RBAC:** in `list_challans`/`get_challan` require_teams(admin, store, accounts) [list/view]; in `record_challan_return` require_teams(admin, store, accounts); leave `create_challan` and `challan_from_vendor_return` as admin/store. (Currently `list_challans`/`get_challan` only call `get_current_user` — confirm they don't already block accounts; if they don't block, the fix is purely additive on record-return.)
- [ ] **Step 6 — Reminder job:** `challan_due_loop()` runs daily (e.g. 08:30 IST); calls `_challans_due`; for each, upsert a `db.notifications` row keyed `returnable_challan_due:<challan_id>:<today>` with role targeting admin/accounts/store; surfaces in bell + A2 popup. Optional: enqueue WhatsApp if a recipients setting is on.
- [ ] **Step 7 — Register** loop in `start_schedulers()`.
- [ ] **Step 8 — Frontend:** in ReturnableChallans.js change `canWrite` to split: `canCreate = ['admin','store']`, `canRecordReturn = ['admin','store','accounts']`; ensure the page route allows accounts. Show due/overdue badge using `expected_return_date`.
- [ ] **Step 9 — Verify:** build frontend; manually confirm accounts login can open the page + record a return but not see Create; confirm a due challan produces a notification.
- [ ] **Step 10 — Commit** `feat(challan): returnable due reminders + accounts view/record-return access`.

---

## Phase B — Physical stock made easy

### Task B1: Single-product physical-count quick edit (with reservation sync)

**Files:**
- Modify: `frontend/src/pages/admin/Inventory.js` (+ maybe `DieCard.js`/table row) — add "Set physical qty" inline action
- Modify: `frontend/src/hooks/useInventory.js` (action that POSTs `physical_adjustment` then calls recompute-reservations + refetch)
- Backend: reuse `POST /stock/movement` (physical_adjustment already sets stock_qty — inventory_routes.py:493) and `POST /stock/recompute-reservations` (order_routes.py:1060)
- Test: `frontend/src/hooks/__tests__/physicalQty.test.js` (pure variance calc helper)

- [ ] **Step 1 — Pure helper test.** `varianceInfo(systemQty, countedQty)` → `{variance, direction}`. Test +, -, 0.
- [ ] **Step 2 — Run test, expect FAIL.**
- [ ] **Step 3 — Implement `varianceInfo`.**
- [ ] **Step 4 — Run test, expect PASS.**
- [ ] **Step 5 — Hook action** `setPhysicalQty(dieId, countedQty)` in useInventory.js: POST `/stock/movement` `{die_id, movement_type:'physical_adjustment', counted_qty}`; then POST `/stock/recompute-reservations`; then `fetchDies()`.
- [ ] **Step 6 — UI:** small pencil/"Set qty" on each product showing current `stock_qty`; opens a tiny inline input; on save calls `setPhysicalQty`; shows variance toast. Permission admin/store.
- [ ] **Step 7 — Verify:** build; manually set a die's physical qty, confirm stock_qty updates, available recomputes, movement history shows variance.
- [ ] **Step 8 — Commit** `feat(inventory): quick set-physical-qty with reservation resync`.

### Task B2: Latest stock + clear sorting

**Files:**
- Modify: `frontend/src/pages/admin/Inventory.js` (ensure sort dropdown labels for stock asc/desc are visible; ensure manual Refresh present)

- [ ] **Step 1 — Verify** `SORT_OPTIONS` includes stock_asc/stock_desc (useInventory.js:21) and they render in the dropdown; add a visible "Refresh" button if missing.
- [ ] **Step 2 — Verify** refetch after `setPhysicalQty` (from B1) and the 60s auto-refresh both work.
- [ ] **Step 3 — Commit** `chore(inventory): surface stock sorting + manual refresh`.

---

## Phase C — Order lifecycle (most care)

### Task C1: Soft "Cancel / Not finalising" order status

**Files:**
- Modify: `backend/routes/order_routes.py` (add `POST /orders/{order_id}/cancel` and `POST /orders/{order_id}/reopen`; keep DELETE as-is at line 133)
- Modify: `frontend/src/pages/admin/Orders.js` (Cancel button for admin/accounts; CANCELLED badge; Re-open)
- Test: `backend/tests/test_order_cancel.py` (pure status-transition guard)

- [ ] **Step 1 — Pure guard test.** `can_cancel(order_status)` → True for active statuses (pending/confirmed/partially_dispatched), False for cancelled/dispatched-complete. `can_reopen(status)` True only for cancelled.
- [ ] **Step 2 — Run test, expect FAIL.**
- [ ] **Step 3 — Implement guards** (pure).
- [ ] **Step 4 — Run test, expect PASS.**
- [ ] **Step 5 — `POST /orders/{id}/cancel`** require_teams(admin, accounts): set `order_status="cancelled"`, push timeline entry, then `await recompute_reservations()` so undispatched holds are released; free quotation/lead (mirror DELETE's quotation→"sent", lead unlock at order_routes.py:168-175) but reversibly. Reject if `can_cancel` false.
- [ ] **Step 6 — `POST /orders/{id}/reopen`** require_teams(admin, accounts): set status back to "pending" (or prior), re-mark quotation confirmed/lead won, then `recompute_reservations()` to re-reserve. Reject if not cancelled.
- [ ] **Step 7 — Frontend:** Cancel button (confirm dialog) + Re-open for cancelled; CANCELLED badge/grey row; hide dispatch actions when cancelled.
- [ ] **Step 8 — Verify:** build; on a scratch order, cancel → reserved released + available rises; reopen → reserved restored. Confirm DELETE still works for superadmin.
- [ ] **Step 9 — Commit** `feat(orders): soft cancel/reopen with reservation release (keeps superadmin delete)`.

### Task C2: Readable "what changed" list (staff + school portal)

**Files:**
- Modify: `backend/routes/order_routes.py` (`reconcile_order_to_selection` ~573 + staff edit endpoints 484-570: build structured human-readable diff entries into order timeline / a `change_log`)
- Modify: order detail frontend (staff) + school portal order view to render the change list
- Test: `backend/tests/test_order_diff.py` (pure diff builder)

- [ ] **Step 1 — Pure diff test.** `build_change_lines(before_items, after_items)` → list of strings: "Added 50 × <code> <name>", "Removed <code>", "Changed <code> 100→120". Test add/remove/qty-change combos.
- [ ] **Step 2 — Run test, expect FAIL.**
- [ ] **Step 3 — Implement `build_change_lines`** (pure).
- [ ] **Step 4 — Run test, expect PASS.**
- [ ] **Step 5 — Wire** into reconcile + staff edits: compute before/after, store `change_log` entries `{at, by, lines:[...]}` on the order (replace the aggregate "+a/-r/~adj" note at order_routes.py:633 with the readable lines, keep counts too).
- [ ] **Step 6 — Staff UI:** show change log on order detail.
- [ ] **Step 7 — School portal:** surface the same change lines as "What we changed vs your request".
- [ ] **Step 8 — Verify:** build; make a change, confirm readable lines appear for staff + portal.
- [ ] **Step 9 — Commit** `feat(orders): human-readable change log shown to staff + school`.

### Task C3: Show returned/released stock as "+ back to stock"

**Files:**
- Modify: `backend/routes/order_routes.py` (on cancel/qty-reduce) and `backend/routes/procurement_routes.py` (on challan return at 1429-1430) to write a `stock_movements` entry of type `returned`/`released` with positive qty
- Modify: stock movement history UI to display "+N back to stock"
- Test: `backend/tests/test_stock_movement_label.py` (pure label formatter)

- [ ] **Step 1 — Pure formatter test.** `movement_label(mtype, qty)` → "+N back to stock" for returned/released; "-N dispatched" for dispatch. Test both signs.
- [ ] **Step 2 — Run test, expect FAIL.**
- [ ] **Step 3 — Implement `movement_label`.**
- [ ] **Step 4 — Run test, expect PASS.**
- [ ] **Step 5 — Emit movement rows** on challan return (procurement_routes.py:1430) and order qty-reduce/cancel paths, type `returned`, positive qty.
- [ ] **Step 6 — UI:** render `movement_label` in stock history so increases are visible like decreases.
- [ ] **Step 7 — Verify:** build; record a challan return, confirm a "+N back to stock" row appears.
- [ ] **Step 8 — Commit** `feat(inventory): show stock returns as "+ back to stock" movements`.

---

## Self-review notes
- **Spec coverage:** A1=daily report ✓; A2=hourly popup ✓; A3=challan reminder+accounts ✓; B1=physical qty edit+sync ✓; B2=latest stock+sorting ✓; C1=soft cancel+keep delete ✓; C2=readable change log staff+portal ✓; C3=visible returns ✓.
- **Reservation invariant** (`available = stock_qty - reserved_qty`) re-checked after every cancel/reopen/edit/physical-adjust via `recompute_reservations`.
- **Launch safety:** all new jobs and the popup default OFF / opt-in where they could surprise users; Phase C ships last.
- **No prod-hitting auto tests** — pure-logic unit tests + manual DB verification only.
