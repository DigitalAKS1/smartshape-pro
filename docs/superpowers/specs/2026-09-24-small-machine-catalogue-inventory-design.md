# Small Machine Category — Auto-Catalogue + Stock Grouping

**Date:** 2026-09-24
**Status:** Approved for implementation (owner: "continue as expert")

## Problem

The owner has launched a new "small machine" line (a smaller machine model
sold with its own set of compatible small dies/accessories). Today, when a
salesperson builds a Quotation, the customer-facing Catalogue
(`/catalogue/{token}`) always shows **every active die**, regardless of
which machine/package the quotation is for. There is no way to say "this
quotation is for the small machine, so only show small-machine-compatible
dies." There is also no inventory view that groups stock by machine
category, so the owner can't see small-machine stock levels or reorder
needs separately from the rest of the catalogue.

## Existing scaffolding (confirmed by code read, 2026-09-24)

- `db.dies` docs (`backend/routes/inventory_routes.py:34-45` `DieCreate`,
  doc assembly `104-136` create / `139-168` update): `code`, `name`,
  `type` (die **size**: standard/large — used for package quota math,
  unrelated to machine model), `category` (fixed design-motif set:
  decorative/flowers/leaf/…, `inventory_routes.py:333`), `product_type_id`
  → denormalized `product_type` (Die/Stamp/Machine/Other, resolved via
  `_resolve_product_type`, `inventory_routes.py:74-82`), `stock_qty`,
  `reserved_qty`, `min_level`, `is_active`.
- `db.packages` docs (`inventory_routes.py:413-459`): `display_name`,
  `base_price`, `machine_qty`, `std_die_qty`, `large_die_qty`, `items[]`.
  A Quotation optionally stores one `package_id`
  (`backend/routes/quotation_routes.py:487-490, 524-528`).
- Catalogue is generated fresh per quotation, not manually curated:
  `GET /catalogue/{token}` (`quotation_routes.py:1582-1616`) loads the
  quotation's linked package, then all active dies filtered to
  product-types with `visible_to_schools: True` (Machine type is seeded
  with `visible_to_schools: False`, so machine units never appear in the
  catalogue today — unaffected by this feature).
- No field anywhere ties a die to a machine model/category. Grepped for
  `machine_type`, `machine_category`, `machine_size`, `compatible_machines`
  — zero hits in backend or frontend.

Because package selection already exists on the Quotation and the
catalogue is already auto-built per quotation, this feature is an
**additive filter on existing data**, not a new subsystem.

## Design

### 1. New field: `machine_category`

Add an optional string field `machine_category` to `db.dies` and
`db.packages`. Value is either `"small_machine"` or absent/`null`
(absent = "general", i.e. today's behavior — every existing die and
package is unaffected). The field is a plain string, not an enum table,
so adding a second category later (e.g. `"large_machine"`) needs no
migration — just start using a new string value.

This is deliberately **not** merged into the existing `category` field
(design-motif taxonomy: decorative/flowers/leaf/…) or the `type` field
(die size: standard/large) — those mean something else already and
overloading them would conflate unrelated concepts.

Backend changes:
- `DieCreate` model (`inventory_routes.py:34-45`): add
  `machine_category: Optional[str] = None`.
- `update_die` (`inventory_routes.py:139-168`): no change needed — it
  already passes through arbitrary fields from the request body.
- `create_package` (`inventory_routes.py:419-438`): add
  `"machine_category": body.get("machine_category")` to `pkg_doc`.
- `update_package` (`inventory_routes.py:441-451`): add
  `"machine_category"` to the `allowed` whitelist tuple.

Frontend changes (Product Master / Package Master forms):
- Add a "Machine Category" select (options: `— General —`,
  `Small Machine`) to the Die create/edit form and the Package
  create/edit form. Saves as `machine_category` on submit.

### 2. Catalogue filtering by machine category

In `get_catalogue()` (`quotation_routes.py:1582-1616`), after loading
`package` (line 1600): if `package.get("machine_category")` is set,
add it to the Mongo filter used to fetch dies (currently
`db.dies.find({"is_active": True})`, line 1601):

```
die_filter = {"is_active": True}
pkg_machine_category = (package or {}).get("machine_category")
if pkg_machine_category:
    die_filter["machine_category"] = pkg_machine_category
    die_filter["$expr"] = {"$gt": [
        {"$subtract": ["$stock_qty", {"$ifNull": ["$reserved_qty", 0]}]}, 0]}
dies = await db.dies.find(die_filter, {"_id": 0}).to_list(1000)
```

The stock guard (`$expr` clause) only activates for machine-category
packages — quotations without a machine-category package see exactly
today's full, unfiltered catalogue. This directly satisfies "don't quote
out-of-stock small-machine dies": a small-machine die with zero available
stock (`stock_qty - reserved_qty <= 0`) is simply omitted from that
customer's catalogue link, the same way it would be if it didn't exist.

Everything downstream (`visible_type_ids` filter, `gate_die_for_customer`,
catalogue selection/submit, auto-created orders) is untouched — it already
operates on whatever `dies` list comes out of this query.

### 3. Getting a "Small Machine" quotation

No new quotation UI is needed. The salesperson already picks a
`package_id` when creating a quotation (existing package selector). The
one-time setup is:
1. Create (or edit) the "Small Machine" package in Package Master, set
   its `machine_category` to `small_machine`.
2. Tag each small-machine-compatible die (and any related accessory die)
   in Product Master with `machine_category = small_machine`.

From then on, any quotation built against that package automatically
gets a catalogue restricted to small-machine items — "auto create
category" in the owner's ask is realized as this filter, not a new
taxonomy/CRUD entity (kept intentionally light per YAGNI, since today it's
one category vs. everything else).

### 4. Inventory: stock grouped by machine category

Add a new endpoint `GET /stock/by-machine-category` (new function in
`inventory_routes.py`, near the existing `/sales-person-stock` report at
line 627) that aggregates `db.dies` by `machine_category` (missing/null
bucketed as `"general"`):

```
{
  "small_machine": {"die_count": N, "stock_qty": sum, "reserved_qty": sum,
                     "low_stock": [ {die_id, code, name, stock_qty,
                                     reserved_qty, min_level}, ... ]},
  "general": { ... same shape ... }
}
```

`low_stock` reuses the existing `min_level` field already on every die:
a die qualifies when `stock_qty - reserved_qty <= min_level`. No new
stock model, no new alert/notification channel — this is a report view.
Wiring it into the existing WhatsApp/email digest scheduler is explicitly
out of scope (owner confirmed: just Small Machine vs. everything else, no
other categories needed right now); can be a follow-up if wanted later.

Frontend: a small "Small Machine" tile/section on the existing stock
report page, reading this endpoint, listing low-stock items so the owner
can see reorder needs for the small-machine line separately from the
rest of the catalogue.

### Testing

- Backend: catalogue endpoint returns the full die list when
  `package.machine_category` is unset (regression, matches today);
  returns only `machine_category`-matching, in-stock dies when set.
- Backend: die/package create+update round-trip `machine_category`.
- Backend: `/stock/by-machine-category` groups correctly and flags
  low-stock items using `min_level`.
- Frontend: Die/Package forms render and save the new select.
- No changes to `catalogue_selections`/order auto-creation logic — covered
  by existing tests since the dies list is the only thing that changes.

## Out of scope (explicitly, per owner's answers)

- A dedicated `machine_categories` collection / many-to-many linking
  (Approach B) — not needed while there's only one category besides
  "general."
- Inferring machine fit from the existing `type` (die size) field —
  rejected; conflates two different concepts.
- New alerting/notification channel for low stock — reuse existing report
  surfaces only.
- Showing the physical Machine product itself inside the catalogue —
  unaffected/unchanged; Machine-typed products stay excluded via the
  existing `visible_to_schools: False` setting on the Machine product
  type.
