# Owner-only destructive actions (`info@smartshape.in`)

**Date:** 2026-06-15
**Status:** Approved, in implementation

## Goal

Give the single owner account `info@smartshape.in` the ability to perform high-impact
destructive actions that no other admin can do:

1. **Delete an Order** outright — including converted (quote→order) and already-dispatched orders.
2. **Cascade-delete a Contact/School** — remove the contact/school *and every related CRM+ERP
   record* (leads, deals, quotations, orders, tasks, follow-ups, visits, dispatches).

All other existing delete permissions are unchanged. Direct inventory stock editing / "make live"
already works for admin + store and is **out of scope**.

## Hard rules

- Deletion of Orders and Contact/School cascades is restricted to **`info@smartshape.in`** only —
  not the `admin` role generally. Enforced server-side.
- Deletes are **hard deletes** (rows physically removed from live collections), but every deleted
  record is first dumped into the `audit_backups` collection. The backup is stored as many small
  *chunk* docs (≤ 200 docs each, avoiding Mongo's 16 MB doc limit) plus one *manifest* doc written
  last — so the live delete only runs once a complete backup exists.
- A backup is **restorable** via an owner-only endpoint (`POST /api/admin/audit-backups/{id}/restore`),
  once only (guarded by the manifest's `restored` flag, because most collections have no unique id
  index and a second restore would duplicate every record).
- Order deletion **releases reserved/committed stock** (via reservation recompute) but does **not**
  add back already-dispatched quantities — dispatched goods physically left the building.

## Components

### 1. `require_superadmin` guard — `backend/rbac.py`

```python
SUPERADMIN_EMAIL = os.getenv("SUPERADMIN_EMAIL", "info@smartshape.in").lower()

def require_superadmin(user: dict):
    if (user.get("email") or "").lower() != SUPERADMIN_EMAIL:
        raise HTTPException(status_code=403, detail="Only the owner account can perform this action")
```

Env-configurable, defaults to `info@smartshape.in`. Server-side is the real gate; the frontend
only hides the buttons.

### 2. Delete Order — `DELETE /orders/{order_id}` (net-new)

- `require_superadmin`.
- Write the order doc + its `dispatches` into `audit_backups` (one bundle with `deleted_by`,
  `deleted_at`, reason).
- Hard-delete from `orders` and `dispatches`.
- Unlink the source quotation: clear the order's `quotation_id` linkage / order-exists flag so the
  quote is freed but **not** deleted.
- Call the existing reservation recompute so released (undispatched) qty returns to `available`.
  Do not restore `dispatched_qty` to `stock_qty`.
- Works in any order status (pending / confirmed / partially_dispatched / dispatched / delivered).

### 3. Cascade-delete Contact/School — CRM routes

- `DELETE /crm/schools/{school_id}?cascade=true` and the contact equivalent.
- `require_superadmin` — overrides the current "blocked if related data exists" behaviour.
- Gather every related doc across: `contacts`, `leads`, `deals`, `quotations` (+ catalogue
  selections / selection items / edit history), `orders` (+ `dispatches`), `tasks`, `follow_ups`,
  `visit_plans`, and tag back-references.
- Match on all linking keys the data actually uses: `school_id`, `contact_id`, and school **name**
  (the profile aggregates quotes by school_id OR name).
- Dump the entire collected set into `audit_backups` as one timestamped bundle, then hard-delete each.
- Orders inside the cascade follow the same stock rule (release reserved, keep dispatched deducted).
- Provide a **preview**: a count of what will be deleted, shown in the confirm dialog before the
  destructive call.

### 4. Frontend

- `useIsOwner()` helper: `currentUser.email.toLowerCase() === 'info@smartshape.in'`.
- Owner-only **Delete** buttons on:
  - Order detail panel (`OrdersManagement.js` / `DispatchTracking.js`)
  - School / Contact panels (`LeadsCRM.js`)
- Each button opens a **typed-confirmation** dialog ("type DELETE to confirm") that shows the blast
  radius (e.g. "3 leads, 2 orders, 5 quotes will be permanently deleted").
- Non-owners never see the buttons (and the API would 403 anyway).

## Testing

- Non-owner admin → 403 on all owner-only endpoints; owner → success.
- `audit_backups` manifest written **after** chunks and **before** any live delete.
- After order delete: reserved qty freed, dispatched stock untouched, quotation unlinked but present.
- After cascade: all related docs gone, unrelated school/contact spared, backup bundle written.
- Restore re-inserts the footprint; a second restore is refused (no duplicates).
- **Caution:** the repo's `tests/` are HTTP integration tests pointed at the PROD server, and a
  local backend hits the PROD DB. Destructive logic is therefore covered by an **offline** suite
  (`tests/test_owner_cascade_delete.py`) using `mongomock_motor` with the `db` handle patched — it
  never touches prod. Run: `python -m pytest tests/test_owner_cascade_delete.py -q`.

## Out of scope

- Direct inventory stock edit / "make live" (already works for admin + store).
- Quote deletion permissions (unchanged: accounts/admin with existing order-block).
