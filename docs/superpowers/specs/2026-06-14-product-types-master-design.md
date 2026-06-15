# Product Inventory + Product Type Master

**Date:** 2026-06-14
**Status:** Approved (Approach A) — implement in phases
**Builds on:** the media-gallery work (multi-photo/video/description) already in progress.

## Goal

Turn the dies-only inventory into a general **product inventory** driven by an admin-managed
**Product Type master** (Dies, Machine, Stamps, …). Each type carries a code prefix and a
"visible to schools" flag. Schools browse the catalogue by product-type tabs (only the types an
admin published). Existing die data and all order/quotation/import/FMS flows keep working.

## Decisions (locked)

- **Type master entry:** `name` + `code_prefix` + flags (`visible_to_schools`, `uses_quota`).
- **School view:** catalogue filter-tabs by product type; per-type `visible_to_schools` toggle.
- **Quota:** Dies keep the package Standard/Large quota; non-die types (`uses_quota:false`) are
  browse-and-order with no cap.
- **Migration:** UI relabels to "Products"; existing dies are backfilled to `product_type="Dies"`;
  backend collection/routes stay `dies` (zero blast radius for orders/quotes/imports/FMS).

## Key codebase facts (verified)

- **`backend/main.py` is the live entrypoint** — includes all routers (`inventory_router` at L90)
  and owns startup/seed (L195). **`backend/server.py` is dead legacy code** (duplicate `/dies`
  routes, never imported) — do not edit it.
- `type` field on a die = **size class** (`standard`/`large`/`machine`) that drives the catalogue
  Standard/Large quota (`CataloguePage.js` L92-93). This is distinct from the new `product_type`.
- Die media + endpoints already added in `inventory_routes.py` (multi-photo, video, gate).

## Architecture (Approach A)

Add a `product_types` master collection + CRUD; stamp each die with `product_type_id` +
denormalized `product_type` name. Relabel the UI. `uses_quota` is the abstraction that decouples
quota logic from the literal name "Dies".

### Data model

**New collection `product_types`:**
```
{ product_type_id, name, code_prefix, visible_to_schools: bool,
  uses_quota: bool, sort_order: int, is_active: bool }
```
Seeded "Dies": `code_prefix:"SSSD"`, `uses_quota:true`, `visible_to_schools:true`, `sort_order:0`.

**Die doc additions:** `product_type_id` (ref), `product_type` (denormalized name for
display/filter/catalogue). Existing `type`, `category`, `code`, `name`, media fields unchanged.

### Backend (new file `backend/routes/product_type_routes.py`, registered in main.py)

- `GET  /api/product-types` — any authed user (needed by inventory filter + create form); supports
  `?active=true`. `GET /api/product-types?for_schools=true` returns only `visible_to_schools`.
- `POST /api/product-types` — admin only. Validates unique name + non-empty `code_prefix`.
- `PUT  /api/product-types/{id}` — admin only. On rename, propagate `product_type` name to tagged
  dies (`db.dies.update_many({product_type_id}, {$set:{product_type:new_name}})`).
- `DELETE /api/product-types/{id}` — admin only; **blocked if any die references it** (409 with a
  count) to avoid orphaning products. (Archive via `is_active:false` is the soft path.)
- `GET /api/product-types/{id}/next-code` — admin/store; returns the next suggested code
  (`<prefix>-<zero-padded next int>`) by scanning existing die codes with that prefix. Optional
  convenience used by the create form.

**Pure helper** `backend/product_type_utils.py`: `next_code(prefix, existing_codes)` and
`slugify_prefix(raw)` — DB-free, unit-tested.

**`inventory_routes.py` changes:** `DieCreate` accepts `product_type_id`; create/update resolve the
type, store `product_type_id` + denormalized `product_type`; `get_dies` already returns the field.

**`quotation_routes.py` (`get_catalogue`) changes:** fetch the set of `visible_to_schools` type ids;
return only dies whose `product_type_id` is in that set (legacy dies with no `product_type_id` are
treated as "Dies" → visible). `gate_die_for_customer` already includes `product_type`.

### Startup backfill (main.py, idempotent)

1. Upsert the **Dies** product type (by a stable `product_type_id:"ptype_dies"`).
2. `db.dies.update_many({product_type_id: {$exists: false}}, {$set:{product_type_id:"ptype_dies", product_type:"Dies"}})`.

Runs every boot but is a no-op once applied (matched set becomes empty).

### Frontend

- **`lib/api.js`:** `productTypes.{getAll, getForSchools, create, update, remove, nextCode}`;
  `dies.create/update` carry `product_type_id`.
- **Product Types master UI** — a small admin manager (page `pages/admin/ProductTypes.js`, linked
  from Inventory's "⋯" menu and reachable at `/product-types`): list + add/edit (name, code prefix,
  visible-to-schools, uses-quota) + archive. Admin only.
- **Inventory → "Products":** page title/labels; a **Product Type filter** (tabs/pills) above the
  category row, sourced from the master; create/edit dialog gets a **Product Type selector** that
  prefills the code prefix (and can fetch a suggested next code). `useInventory` gains
  `productTypeFilter` + `productTypes` list.
- **CataloguePage:** product-type **tabs** built from the (already school-gated) `product_type`
  values in the payload; selecting a tab filters dies; Standard/Large quota counters unchanged
  (they only count `uses_quota` dies via their size-class `type`).
- **Media wiring folds in here** (the paused gallery Tasks 8–11): `DieCard`, edit dialog,
  `CataloguePage`, `PortalOrderCard` are wired with `MediaGallery`/`Lightbox`/`VideoModal` under the
  "product" framing — wired once, not dies-then-products.

### Error handling

- Unique type name; non-empty prefix (slugified, uppercased).
- Delete type referenced by products → 409 with count; offer archive instead.
- Create/update die with unknown/inactive `product_type_id` → 400.
- Legacy dies without `product_type_id` always behave as "Dies" (visible, quota-bearing).

### Testing

- `product_type_utils` unit tests (next_code sequencing incl. gaps, prefix slug). DB-free.
- `media_utils` gate already tested; extend with a `product_type` passthrough assertion.
- Manual: master CRUD, rename propagation, delete-guard; inventory filter; catalogue tabs +
  per-type visibility; dies quota intact, machine/stamps uncapped.

## Phased delivery

1. **Backend foundation** — master CRUD + `product_type_utils` + die field wiring + startup
   backfill + catalogue gating. (Additive, safe.)
2. **Admin UI** — Product Types manager + Inventory relabel/filter + create/edit selector.
3. **School catalogue** — type tabs + visibility.
4. **Media wiring** — finish gallery Tasks 8–11 under the product framing.

Each phase is independently shippable; Phase 1 changes nothing visible until UI lands.

## Out of scope (YAGNI)

- Renaming the `dies` collection / `die_id` everywhere (Approach B) — too risky.
- Per-type custom quota configuration — only Dies use the package quota; others are uncapped.
- Per-type custom attribute schemas — all products share the die fields for now.
