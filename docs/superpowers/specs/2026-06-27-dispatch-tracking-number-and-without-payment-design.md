# Dispatch Tracking — Inline Tracking-Number Edit + "Dispatch Without Payment"

**Date:** 2026-06-27
**Branch:** feat/module-rbac
**Status:** Design — pending implementation

## Problem

On the CRM **Dispatch Tracking** page, two gaps:

1. **Tracking numbers can't be edited after dispatch.** The page
   ([`frontend/src/pages/admin/DispatchTracking.js`](../../../frontend/src/pages/admin/DispatchTracking.js))
   is read-only. A `tracking_number` can only be typed once, at creation time, from the
   lead detail panel ([`LeadDetailPanel.js`](../../../frontend/src/components/crm/LeadDetailPanel.js)).
   In practice the courier/tracking number is often known *after* the item is logged, so
   there is currently no way to fill it in.
2. **No way to record dispatching an item without payment.** Sometimes an item (e.g. a die or
   sample) is dispatched before payment is received. There is no field to flag this, and no
   place to record *why* it was allowed.

The backend `PUT /physical-dispatches/{id}`
([`crm_routes.py:3108`](../../../backend/routes/crm_routes.py)) already updates
`courier_name` and `tracking_number`; the UI simply never used it.

## Goals

- Let users set/update **courier** + **tracking number** directly on the Dispatch Tracking page.
- Let users mark a dispatch as **dispatched without payment**, with a **required reason**.
- Surface the unpaid state (badge + reason) and allow filtering by it.

## Non-Goals (YAGNI)

- No real payment / invoice / accounting integration. This is a flag + free-text reason only.
- No new backend validation endpoint. Reason enforcement stays in the frontend, matching the
  app's existing pattern (the backend stores whatever it is given).
- No change to the existing auto-WhatsApp / auto-delegation-task behaviour on create.

## Data Model

Two new fields on the `physical_dispatches` MongoDB document:

| Field | Type | Default | Meaning |
|---|---|---|---|
| `dispatched_without_payment` | bool | `false` | Item was dispatched before payment was received |
| `payment_pending_reason` | string | `""` | Why it was dispatched without payment (required in UI when the flag is true) |

Existing records without these fields read as falsy/empty — no migration needed.

## Changes by File

### 1. Backend — [`backend/routes/crm_routes.py`](../../../backend/routes/crm_routes.py)

- **POST `/physical-dispatches`** (`create_physical_dispatch`, ~L3003-3015): add to the `doc`:
  ```python
  "dispatched_without_payment": bool(body.get("dispatched_without_payment", False)),
  "payment_pending_reason": body.get("payment_pending_reason", ""),
  ```
- **PUT `/physical-dispatches/{id}`** (`update_physical_dispatch`, L3112): add both keys to the
  `allowed` tuple so they can be edited:
  ```python
  allowed = {k: body[k] for k in (
      "courier_name", "tracking_number", "sent_date", "received_confirmed",
      "description", "material_type",
      "dispatched_without_payment", "payment_pending_reason",
  ) if k in body}
  ```

No change to auto-task or auto-WhatsApp blocks.

### 2. Create-form state — [`frontend/src/hooks/useLeadsCRM.js`](../../../frontend/src/hooks/useLeadsCRM.js)

- Extend `pdForm` initial state and both resets (L74, L195, L307) with:
  `dispatched_without_payment: false, payment_pending_reason: ''`.
- In `addPhysicalDispatch` (L297): if `pdForm.dispatched_without_payment` is true and
  `payment_pending_reason` is blank, `toast.error('Please add a reason for dispatching without payment')`
  and return early (do not POST). The body already spreads `...pdForm`, so the new fields are sent.

### 3. Create form UI — [`frontend/src/components/crm/LeadDetailPanel.js`](../../../frontend/src/components/crm/LeadDetailPanel.js)

In the Physical Dispatches form block (~L298-311):
- Add a **"Dispatch without payment"** checkbox bound to `pdForm.dispatched_without_payment`.
- When checked, render a **required** reason `Input` bound to `pdForm.payment_pending_reason`
  (placeholder e.g. `"Reason (required) — why dispatch without payment?"`).
- In the dispatch list rows (~L315-327), when `d.dispatched_without_payment` is true, show a
  small amber **"Unpaid"** tag; show `d.payment_pending_reason` as muted text when present.

### 4. Dispatch Tracking page — [`frontend/src/pages/admin/DispatchTracking.js`](../../../frontend/src/pages/admin/DispatchTracking.js)

- **Inline edit per row:** add an **Edit** (pencil) action in the Actions cell. Editing a row
  reveals editable **Courier** (select using existing `COURIERS`) + **Tracking #** (`Input`)
  in place of their display cells, plus **Save** / **Cancel**. Save calls
  `dispatchApi.update(d.dispatch_id, { courier_name, tracking_number, dispatched_without_payment, payment_pending_reason })`
  and updates local state; the tracking URL + WhatsApp message regenerate automatically from
  the new values. Use simple per-row edit state (`editingId` + a small `editForm`).
- **Unpaid in the editor:** include the "Dispatch without payment" checkbox + reason in the
  inline editor too, with the same "reason required when checked" guard before Save.
- **Unpaid badge:** in the Status cell (or beside Tracking #), show an amber **"Unpaid"** badge
  when `d.dispatched_without_payment`; show the reason via `title`/tooltip or muted subtext.
- **Unpaid filter:** add a third filter `select` — **All Payments / Paid / Unpaid** — next to the
  existing courier & status filters, applied in the `filtered` computation.

## Validation / Error Handling

- Reason-required check is enforced in both entry points (create form + inline editor) before
  any network call; on failure show a `toast.error` and abort.
- Inline-edit Save failures show `toast.error('Failed to update')` (matches existing
  `markReceived` pattern) and leave the row in edit mode.

## Testing

Manual verification (no automated test harness for these CRM pages):
1. Create a dispatch from a lead with "without payment" checked but no reason → blocked with toast.
2. Create with reason → record saved with `dispatched_without_payment: true` + reason.
3. On Dispatch Tracking page, edit a row: set courier=Delhivery + tracking number → Save →
   tracking link + WhatsApp message reflect new values after save.
4. Toggle "Unpaid" filter → only flagged rows show.
5. Existing dispatches (without the new fields) render normally as "Paid"/no badge.

## Rollout

- Frontend-only build + the small backend edit ship together. No DB migration.
- Note (per project memory): the committed `frontend/build/` bundle is currently rolled back to a
  last-good state and a rebuild is gated on the RBAC lockout fix — so this feature lands in source
  on `feat/module-rbac` and is **not** deployed until the bundle situation is resolved separately.
