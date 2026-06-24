# Product Master & "Add Product" — Design

**Date:** 2026-06-24
**Branch:** feat/module-rbac
**Status:** Approved (auto startup seeder)

## Goal

Turn the inventory's die-centric flow into a unified, type-aware **Products**
database backed by a **Product Type Master** (Die, Stamp, Machine, Other).
Rename all user-facing "Die" wording to "Product". Keep internal code and the
`dies` MongoDB collection unchanged.

## Context — what already exists (no work needed)

- **Product Type Master:** `product_types` collection + admin page
  `frontend/src/pages/admin/ProductTypes.js` (`/product-types`) with full
  add/edit/delete, `code_prefix`, `visible_to_schools`, `uses_quota`,
  `sort_order`. Reachable from the inventory ⋮ menu → "Manage product types".
- Every product (`dies` collection) already stores `product_type_id` plus a
  denormalized `product_type` name.
- Add/Edit Product dialogs already render a **Product Type** dropdown
  (`DieFormDialog.js:57-65`, `204-213`).
- The inventory grid already renders per-type filter tabs
  (`Inventory.js:254-269`) driven by `useInventory` `productTypes` /
  `productTypeFilter`.

The "unified type-aware Products database" is therefore already built. The work
is seeding the right types, wiring the optional "default Die" behavior, and
finishing the relabel.

## Scope

### 1. Seed the type master — Die, Stamp, Machine, Other

Add an idempotent backend seeder that runs at startup (alongside the existing
index helpers in `connect_db`). It ensures these four types exist:

| Name    | code_prefix | visible_to_schools | product_type_id        |
|---------|-------------|--------------------|------------------------|
| Die     | `D`         | yes                | `ptype_dies` (default) |
| Stamp   | `S`         | yes                | generated              |
| Machine | `M`         | no                 | generated              |
| Other   | `O`         | yes                | generated              |

Idempotency rules (safe on every deploy; never resurrects a deleted type):

- **Rename existing default:** if a type named "Dies" exists, rename it to
  "Die" and propagate the new name to tagged products
  (`db.dies.update_many({product_type_id}, {product_type: "Die"})`). Pin/ensure
  the Die type uses id `ptype_dies` so the blank-default keeps working.
- **Seed Stamp / Machine / Other once only,** guarded by a one-time flag
  (e.g. an `app_meta` doc `product_types_seeded: true`). After the first run,
  deleting "Machine" on the admin page will NOT bring it back on restart.

### 2. "Optional, default Die" behavior

- Product type stays **optional** in the Add Product form.
- Backend `_resolve_product_type(None)` (`inventory_routes.py:73-81`) already
  defaults a blank id to `ptype_dies`; change its hardcoded fallback name from
  `"Dies"` → `"Die"` to match the renamed master.
- One-time migration: set `product_type = "Die"` on products currently tagged
  `product_type == "Dies"`.
- Create dialog: set `BLANK_DIE.product_type_id = 'ptype_dies'` so the dropdown
  visibly shows "Die" selected instead of silently defaulting.

### 3. Relabel visible "Die" → "Product" (UI text only)

Touch-points:

- `Inventory.js:138` `"Add Die"` → `"Add Product"`
- `Inventory.js:293,296` `"No dies found"` / `"Add your first die…"` → Product
- `useInventory.js:152,157,187` toasts `"Die created/updated"`,
  `"Failed to create die"` → Product
- `ImportDeleteDialogs.js:15` `"Import Dies from CSV"` → `"Import Products from
  CSV"` (+ any "die" wording in the delete-confirm dialog)
- `DieCard.js:83` badge guard `die.product_type !== 'Dies'` → hide the badge for
  the **default Die** type only (so Stamp/Machine/Other still show their badge)

Internal identifiers (`newDie`, `die_id`, `dies` collection, file names like
`DieFormDialog.js`) stay as-is.

### 4. Out of scope

- No DB/collection rename (`dies` stays `dies`); no backend field renames.
- No changes to catalogue/quotation logic beyond the type name showing as "Die".

## Testing

- **Backend:** restart twice → seeder is idempotent (no dupes), "Dies"→"Die"
  rename applied, a deleted type is not resurrected.
- **UI:** Add Product with each type; blank type saves as Die; type filter tabs
  show all four; badges correct; no leftover "Die" wording on inventory screens.
