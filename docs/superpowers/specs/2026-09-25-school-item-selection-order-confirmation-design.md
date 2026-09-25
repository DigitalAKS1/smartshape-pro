# School/Teacher item selection → Order confirmation workflow — Design

**Date:** 2026-09-25
**Status:** Approved by owner ("continue as expert") through the in-chat design; written up for spec review before planning.
**Author:** Aman Shrivastava (owner) + Claude
**Depends on:** current catalogue submission flow (`quotation_routes.py`, `order_routes.py`), School Portal reorder (`school_routes.py`, `SchoolDashboard.js`), RBAC (`rbac.py`), CRM call/follow-up pattern (`crm_contact_calls.py`, `crm_routes.py`). File:line references below were taken against the code as explored on 2026-09-25 and should be re-verified before implementation.

## Problem

Owner's ask: after a school/teacher selects items, that selection should show up in Orders, the team should be able to log a call about it, and Sales or Store should be able to approve it as-is or change the selected items before it's final. Two things confirmed against the code:

1. **The catalogue link flow (the only real item-picker today) has no review step.** Sales sends a token link; the school/teacher picks dies/products + quantities (`GET /catalogue/{token}`, `POST /catalogue/{token}/submit`, `quotation_routes.py:1582-1701+`). Submission immediately reserves stock (`dies.reserved_qty` increment, `quotation_routes.py:1666`) and auto-creates an already-**confirmed** order via `create_order_for_quotation(..., source="catalogue_submit")` (`order_routes.py:346-453`). A wrong click, a duplicate submission, or a selection the school wants to change all become live orders with reserved stock before anyone on staff sees them.
2. **The School Portal's own "Reorder" button is not an item-picker at all.** It is a free-text textarea (`SchoolDashboard.js:44,110-114,437-441`) that calls `schoolAuth.reorder({ message })`. The backend (`POST /school/reorder`, `school_routes.py:171-184`) writes a `school_requests` doc (`type: "reorder"`, `status: "open"`) with an `items` array field that is defined but never populated. It surfaces in Portal Inbox (`GET /admin/portal-inbox`, `school_routes.py:815-864`; `PortalInbox.js`) and dead-ends there — admin can only mark it `handled`, with **no path to becoming an actual order**.

Neither flow has a way to log a call about the selection, and there is no approve/change gate before stock and a real order are committed.

## Decisions

- **D1 — New order status `awaiting_confirmation`, inserted before `pending`.** Both entry points (catalogue link, School Portal reorder) create an order in this status. It behaves like a real order (visible in Orders, has `order_items`) except no `dies.reserved_qty` is incremented yet. Existing statuses (`pending, confirmed, partially_dispatched, dispatched, delivered, cancelled`, `order_routes.py:493`) are unchanged.
- **D2 — Reservation moves from submit-time to confirm-time.** The `dies.reserved_qty` increment that today runs inside `POST /catalogue/{token}/submit` (`quotation_routes.py:1666`) is removed from submission and moved into a new `POST /orders/{id}/confirm` endpoint. `_maybe_alert_shortage()` (`order_routes.py:608`) runs at confirm time instead of submit time — this is when a real shortage first becomes visible, since two schools can submit overlapping picks against the same limited-stock item while both sit in `awaiting_confirmation` with no lock between them. **Confirm does not block on a shortage** — it behaves exactly like editing quantities on an existing order does today: the reservation is applied, availability can go negative, and that raises a `purchase_alerts` doc for procurement to see, same as the existing add/edit-items path. Whoever confirms first gets the stock recorded first; the second confirm still succeeds but the alert (and the order's own item view) makes the shortfall visible immediately, so staff can edit quantities or call the school afterward rather than the shortage staying silent until dispatch.
- **D3 — Call logging is optional, and generalized from the CRM contact pattern.** `call_notes` (today keyed on `contact_id`/`lead_id`, built by `build_call_note()` in `crm_contact_calls.py`, written via `POST /contacts/{id}/calls` in `crm_routes.py:8213-8284`) gains an optional `order_id` field. `timeline_query()` (`crm_contact_calls.py:21`), which already ORs across `contact_id`/`lead_id`, extends to OR in `order_id`. A parallel `POST /orders/{id}/calls` endpoint reuses `build_call_note()` unchanged. Logging a call is never required to Confirm, Edit, or Reject — it is a note-taking convenience, matching the owner's choice.
- **D4 — Three actions on an `awaiting_confirmation` order: Confirm, Edit Items, Reject.** Confirm and Edit Items reuse the existing "manage selection" mechanism (`order_routes.py:585-712`: add/remove items, change qty, delta-adjust `reserved_qty`, `_maybe_alert_shortage()`) — extended to also accept `awaiting_confirmation` as an editable status (today `EDITABLE_ORDER_STATUSES`, `order_routes.py:589`, only covers `pending`/`confirmed`). Reject is new, modeled on the GRN accept/reject shape (`procurement_routes.py`: mandatory reason, `status` transition, `_timeline_entry`/`log_stage` audit trail) — it requires a reason and transitions the order to the existing `cancelled` status. Every action (submitted / call logged / items changed / confirmed / rejected) writes to the existing `order_timeline` collection.
- **D5 — RBAC: a scoped `orders` grant for `sales_person`.** Today `sales_person` has no `orders` module grant at all (`ROLE_DEFAULT_PERMISSIONS`, `rbac.py:186-208`); order-related access is gated through `quotations` ownership instead (`order_routes.py:463`, "store cannot create orders"). This adds `orders: read_write, scope=own` for `sales_person` — own meaning schools assigned to that rep, the same ownership rule their quotations/leads grants already use. `store`/`accounts` keep their existing all-scope `orders: read_write` unchanged. Confirm/Edit/Reject/Log-call all gate on this same scoped check (extending `_assert_can_edit_selection`, `order_routes.py:594`).
- **D6 — The School Portal's free-text Reorder is replaced, not duplicated.** The item-picker UI/logic already built for the catalogue-token page is extracted into a shared component and mounted inside the authenticated School Portal instead of the textarea. Both entry points submit to the same new endpoint shape; the only difference is how the requester is identified (public token vs. logged-in school session). Keeping both a free-text box and a real picker would give staff two inconsistent "reorder" inboxes to check.
- **D7 — Portal-side status visibility is minimal for v1.** The school sees a simple status line ("Submitted — awaiting confirmation" / "Confirmed" / "Changes made — see items" / "Not proceeding: <reason>") wherever their reorder request already surfaces in the portal today. A richer portal order-tracking view is out of scope here — flag as a follow-on if the owner wants it after this ships.

## Sub-project A — Backend: deferred-confirmation order lifecycle

- `order_routes.py`: add `awaiting_confirmation` to the status set; add it to `EDITABLE_ORDER_STATUSES` (`:589`) alongside `pending`/`confirmed`.
- `quotation_routes.py` catalogue submit (`:1582-1701+`): create the order via `create_order_for_quotation(..., order_status="awaiting_confirmation")`; remove the `dies.reserved_qty` increment (`:1666`) and the submit-time `_maybe_alert_shortage()` call from this path.
- New `POST /orders/{id}/confirm`: guarded by the D5 scope check; transitions `awaiting_confirmation` → `pending`; runs the reservation increment (the logic moved out of catalogue-submit) across the order's current `order_items`; runs `_maybe_alert_shortage()`; writes an `order_timeline` entry.
- New `POST /orders/{id}/reject`: guarded by the same scope check; requires a `reason` string; transitions to `cancelled`; writes `order_timeline`. No stock to release since none was reserved.
- Extend `POST/PUT` on `order_items` (`:585-712`) to also accept `awaiting_confirmation` orders (today gated to `pending`/`confirmed` via `EDITABLE_ORDER_STATUSES`) — editing here does **not** touch `reserved_qty` while still `awaiting_confirmation` (nothing is reserved yet); it only does so once the order is `pending`/`confirmed`, exactly as it does today.
- New `POST /orders/{id}/calls`: thin wrapper reusing `build_call_note()` (`crm_contact_calls.py`) with `order_id` set instead of `contact_id`.
- `call_notes` schema + `timeline_query()` (`crm_contact_calls.py:21`): add optional `order_id`, OR it into the existing query.

## Sub-project B — Internal UI: "Orders awaiting confirmation"

- A new tab/filter on the existing Orders list (or a panel beside Portal Inbox — final placement decided in planning) showing orders in `awaiting_confirmation`, scoped by the viewer's RBAC (sales_person sees own-school orders; store/accounts see all).
- Per-order actions: **Log a Call** (opens a small note form, posts to the new `/calls` endpoint), **Confirm**, **Edit Items** (reuses the existing order-items editor, then Confirm), **Reject** (reason required).
- Order detail shows the `order_timeline` so staff can see what happened before they act (submitted when/by whom, any calls logged, any prior edits).

## Sub-project C — RBAC

- `rbac.py` `ROLE_DEFAULT_PERMISSIONS`: add `orders: {access: "read_write", scope: "own"}` for `sales_person`.
- Confirm the "own" scope resolves the same way it does for `sales_person`'s existing `quotations`/`leads` grants (assigned-to-rep on the school/lead) — reuse that resolution, don't invent a second ownership rule.

## Sub-project D — School Portal: real item-picker

- Extract the catalogue-token page's item-selection UI (die/product search, qty entry, running total) into a shared component.
- Mount it inside `SchoolDashboard.js` in place of the free-text Reorder textarea; submit through the authenticated school-session equivalent of the catalogue-submit endpoint (same order-creation path as Sub-project A, `awaiting_confirmation` status, no reservation yet).
- Retire the free-text `POST /school/reorder` path once the picker ships (or keep it only as a fallback "something else, not in the catalogue" text field alongside the picker — decide in planning; default is full replacement per D6).
- School-facing status line per D7.

## Testing

- **Backend:** RBAC scope tests (`sales_person` can act only on own-school `awaiting_confirmation` orders; `store`/`accounts` on any); reservation-deferral test (submit creates no `reserved_qty` change; confirm does, with the correct delta); shortage-at-confirm test (two submissions against the same constrained die; both confirms succeed, but the second one raises a `purchase_alerts` doc instead of the shortfall staying silent); reject test (reason required, order lands in `cancelled`, no reservation to release); call-log test (`order_id`-keyed call appears in the order's timeline query).
- **Frontend:** shared item-picker component renders and submits identically from the catalogue-token page and the School Portal; "Orders awaiting confirmation" panel actions (call/confirm/edit/reject) each hit the right endpoint and respect the viewer's scope (a sales rep should not see another rep's own-school orders in this panel).

## Open questions for planning

- Exact placement of the "Orders awaiting confirmation" UI (own tab on Orders vs. a Portal-Inbox-style separate screen) — a planning-time UI decision, not a behavior question.
- Whether the free-text Reorder box is fully retired or kept as a secondary "something else" field alongside the picker (D6 default: fully retired).
