# Nine-point backlog — roadmap + Phase 1 design (2026-11-10)

Owner asked for nine changes (school category, store +/- stock, product masters,
quotation request + catalogue master + "already bought" popup + reorder drip,
main/optional catalogue selection, old-order upload, Zoom auto-meeting from forms,
form→school sync, product offers). Owner said "continue as expert": the calls
below are the builder's, flagged **[call]** where they were not stated by the owner.

## Roadmap (one design + plan + deploy per phase)

| Phase | Owner points | Why this order |
|---|---|---|
| 1 | 1 School Category, 3 Product Category / Package Type masters | Small; later phases filter and segment by these lists |
| 2 | 6 Old-order manual + bulk upload linked to school | Gives phase 3's "already bought" popup and reorder drip real data |
| 3 | 4 Quotation Request form, Catalogue Master, already-bought popup, reorder drip, selection guide | Biggest; depends on 1 + 2 |
| 4 | 5 Main vs Optional catalogue selection + guide | Builds on phase 3's catalogue |
| 5 | 2 Store page inline +/- stock | Independent |
| 6 | 8 Form response → school match + manual sync | Independent; reuses `crm_zoom.match_school` |
| 7 | 7 Zoom: form auto-creates meeting, registrants get join link | Independent; needs owner to fix Zoom Marketplace app scopes |
| 8 | 9 Product-linked offers applied to catalogue/quotation price | Builds on phase 1 masters + phase 3 catalogue |

Phases 2–8 get their own design doc when they start; the one-paragraph intents
from the owner conversation are the starting brief.

---

## Phase 1 — Shared lookup masters

### Intent
Lists that repeat across the app (school category, product category, package
type, and more later) must live in one editable master, not in code. Owner
example for school category: Pre School, K-12 School, Franchise, Navodaya,
Independent.

### Goals
- **School Category** is a new school field, separate from the existing
  `school_type` (which holds boards: CBSE/ICSE/…). It is editable in
  CRM Masters, chosen in the school form, shown on the school profile, filterable
  in the CRM list, usable in email/WhatsApp audience filters, and importable.
- **Product Category** (die `category`) comes from a master instead of the
  hard-coded `CATEGORIES` array (frontend) and `valid_categories` set (backend
  import).
- **Package Type** is a new package field from a master.
- One generic mechanism so the next repeating list is a registry entry, not a
  new collection + CRUD + page.

### Non-goals
- No UI to invent brand-new lists: a list only matters once a form uses it, which
  needs code anyway. **[call]**
- `school_type`, deal types, tags, sources etc. stay on their existing masters;
  no migration of those into the new mechanism in this phase. **[call]**
- No back-filling of school category on existing schools (owner fills via
  import / edit).

### Anti-goals
- Existing die categories (`decorative`, `3d_flowers`, …) must keep working —
  no data rewrite, no broken filters, no blank labels.
- Deleting a master entry must never silently orphan records.

### Design
**Storage:** collection `lookup_values`
`{lookup_id, list_key, value, name, is_active, sort_order, created_at}`.
Unique index on `(list_key, value)`.

**Registry (backend, code):** `LOOKUP_LISTS` in `backend/routes/lookup_routes.py`:

| list_key | group | stored on | stores | seed |
|---|---|---|---|---|
| `school_category` | crm | `schools.school_category` | name | Pre School, K-12 School, Franchise, Navodaya, Independent |
| `product_category` | product | `dies.category` | value (slug) | the 14 existing slugs with their current labels |
| `package_type` | product | `packages.package_type` | name | Machine + Dies Combo, Dies Only, Machine Only, Accessories **[call]** |

`stores=value` keeps legacy slugs for die categories. `stores=name` matches how
`school_type` is stored today (readable in exports/imports/filters).

**API** (`/api/lookups`)
- `GET /lookups` → registry metadata (key, label, group).
- `GET /lookups/{key}` → values sorted by `sort_order, name`; seeds defaults on
  first read (same pattern as `/school-types`).
- `POST /lookups/{key}` `{name}` → any logged-in user; case-insensitive dupe
  returns existing; `value` = slug of name.
- `PUT /lookups/{key}/{id}` `{name?, is_active?, sort_order?}` → master-admin
  only. Renaming a `stores=name` list cascades `update_many` on the records
  field; `stores=value` lists only change the label.
- `DELETE /lookups/{key}/{id}` → master-admin only; returns **409 with in-use
  count** if any record uses it (UI then suggests "Deactivate" instead).
- Each value response includes `usage` count (for the editor).

**Write paths touched**
- School create/update (`crm_routes.py`) accept `school_category`.
- Package create/update (`inventory_routes.py`) accept `package_type`.
- Die bulk import: category validated against `lookup_values` (match on value
  or name, case-insensitive), falls back to `decorative` as today.
- Field registry: new `school_category` import/export field with aliases
  "school category", "category", "segment"; "category" alias removed from
  `school_type` **[call — owner's meaning of "category" is this new field]**.
  Import canonicalises to the master name case-insensitively; unknown values are
  kept as typed **[call]**.
- Email + WhatsApp audience filters accept `school_categories`.
- Index on `schools.school_category`.

**Frontend**
- `useLookup(key)` hook (fallback to built-in defaults until loaded).
- `LookupListEditor` component: add, rename, activate/deactivate, delete
  (409 → toast "used by N records — deactivate instead").
- CRM Masters: new "School Category" tab (editor).
- New page `/product-masters` (module `inventory`) with a tab per `group=product`
  list; linked from the Inventory "more" menu and Package Master header.
- School form: Category dropdown; school profile header shows it.
- CRM filter rail + active-filter chips + `crmFilter.js`: `school_categories`
  facet (same roll-up rule as `school_types`).
- Audience filter builder: Category multi-select.
- Die form + Inventory category chips: from `product_category` lookup (inactive
  values hidden from pickers but still labelled on existing records).
- Package form: Package Type dropdown; package card shows a badge.

### Verification
- Backend pytest for lookup CRUD, seed, dupe, rename cascade, 409-in-use,
  admin gate, import canonicalisation, audience filter.
- Frontend jest for `crmFilter` school_categories facet.
- Build bundle, deploy, smoke: add a category, set it on a school, filter by it.

---

## Phase 2 — Old orders (past purchases) linked to schools

### Intent
Owner: "Old Order upload manually, link with School Data… hm purana order as per school chadha de ek baar
ka kaam ho jayein" — record what each school bought before the app existed (and anything bought outside
it), once, so phase 3 can warn "this school already has these dies" and reorder drip can target past buyers.

### Goals
- Add a past purchase to one school by hand: date, reference (bill/invoice no.), notes, optional amount,
  item lines (die from inventory by code/name, or free text e.g. a machine; qty).
- Bulk upload from Excel/CSV across many schools, with a dry-run preview showing which rows match a
  school / a die before anything is written. Re-uploading the same file never duplicates.
- One **purchase history** per school = past purchases + real (non-cancelled) app orders with their
  items, shown on School Profile → Sales tab, plus a per-item summary (die, total qty, last bought).
- Past purchases count as orders for account status (prospect/customer/dormant) and reorder-due.

### Non-goals / anti-goals
- Past purchases are **not** `db.orders`: no stock movement, no reservation, no production stage, no
  payments ledger, no Tally, no lead stage change. **[call]** — inserting into orders would trigger all of
  those (order_routes.create_order_for_quotation side effects) and corrupt stock.
- No editing of real orders from this screen.

### Design
- Collection `past_purchases`: `{purchase_id "pp_<hex12>", school_id, school_name, purchase_date
  "YYYY-MM-DD", reference, notes, amount (float|0), items: [{die_id|None, die_code, name, item_type:
  "die"|"machine"|"other", qty:int}], source: "manual"|"import", import_batch_id, dedupe_key, created_by,
  created_at, is_deleted}`. Unique index on `dedupe_key` (partial, string).
- `dedupe_key` = sha1 of school_id|date|reference|sorted(code-or-name:qty).
- `services/purchase_history.py`:
  - `async revenue_events(db, school_ids) -> {sid: [{"at": iso, "amount": float, "source"}]}` — orders
    not deleted and not cancelled (checks `order_status` AND legacy `status` **[call — fixes existing bug:
    lifecycle/reorder read `status`, orders store `order_status`]**) + past purchases not deleted
    (`at` = purchase_date T00:00Z).
  - `async school_purchase_history(db, school_id) -> {"entries": [...], "items": [...]}`; entries newest
    first `{kind: "order"|"past", id, number_or_reference, date, amount, status, items}`; items summary
    `{key, die_id, die_code, name, item_type, total_qty, times, last_date}` keyed by die_id else
    code/name lower.
- `account_lifecycle.recompute_school_lifecycle` and `reorder.reorder_candidates` read `revenue_events`.
- Routes (`backend/routes/past_purchase_routes.py`):
  - `GET /schools/{school_id}/purchase-history` — anyone who can access the school.
  - `POST /past-purchases`, `PUT /past-purchases/{id}`, `DELETE /past-purchases/{id}` (soft) — can access
    the school; delete = admin or creator. Each write recomputes that school's lifecycle.
  - `GET /past-purchases/template` — CSV header row: `school_id,school_name,city,purchase_date,die_code,
    item_name,item_type,qty,reference,amount,notes`.
  - `POST /past-purchases/import?dry_run=true|false` (multipart .csv/.xlsx) — admin or `orders` module
    read_write. Rows grouped into one purchase per (school, date, reference). School via
    `import_engine.resolve_school` (create→"not found", needs_review→"ambiguous": both skipped and reported).
    Die via normalised code; unknown code kept as free-text item. Dates accept YYYY-MM-DD, DD-MM-YYYY,
    DD/MM/YYYY, Excel serial. Response `{groups, created, duplicates, skipped:[{row, reason}], preview:[...]}`.
- Frontend: `PurchaseHistorySection` in School Profile Sales tab (summary chips + entries list, "Add old
  order" dialog with die picker from `dies.getAll()` + free-text line); Import Center gets an
  "Old Orders" tab: template download, upload → preview table (matched / skipped with reason) → Import.

### Verification
pytest for service (merge, cancelled excluded both fields, summary), routes (CRUD, access, lifecycle
recompute, dedupe), import (grouping, date formats, unknown school/die, dry-run writes nothing, re-upload
0 created); jest none beyond build; deploy + run seed/index repair per [[connect-db-never-called]].
