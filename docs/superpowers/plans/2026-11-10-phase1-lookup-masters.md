# Phase 1 — Shared Lookup Masters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One editable master for repeating lists — School Category (new school field), Product Category (die `category`), Package Type (new package field).

**Architecture:** New `lookup_values` collection + `backend/routes/lookup_routes.py` with a code registry `LOOKUP_LISTS`. Frontend `useLookup(key)` hook + `LookupListEditor` component, mounted in CRM Masters (crm group) and a new `/product-masters` page (product group). Existing write paths (school, package, die import, audience filters, field registry, client CRM filter) learn the new fields.

**Tech Stack:** FastAPI + Motor (tests: pytest + mongomock_motor, route functions called directly), React 18 CRA + Tailwind (tests: jest via `react-scripts test`).

**Spec:** `docs/superpowers/specs/2026-11-10-nine-point-backlog-design.md` (Phase 1 section)

## Global Constraints
- School Category seed, in order: `Pre School`, `K-12 School`, `Franchise`, `Navodaya`, `Independent`.
- Package Type seed: `Machine + Dies Combo`, `Dies Only`, `Machine Only`, `Accessories`.
- Product Category seed = the 14 existing slugs/labels in `frontend/src/hooks/useInventory.js` `CATEGORIES`/`CAT_LABELS`, same order.
- `school_category` and `package_type` store the **name**; `product_category` stores the **value slug** on `dies.category`.
- Create = any signed-in user; rename/deactivate/delete = master-admin (`get_team(user)=="admin"` or `role=="admin"`) → 403 otherwise.
- Delete of an in-use value → HTTP 409, detail contains the usage count.
- No existing die `category` value is rewritten.
- Python: run with `python` (not `python3`). Backend tests run from `backend/`.

## Review Focus
- Renaming "Franchise" → "Franchisee" must update every school that had "Franchise" (cascade), else filters silently lose rows. → Task 1 test `test_rename_name_list_cascades`.
- A die with a legacy category whose lookup row was deactivated must still show its label, not a raw slug or blank. → Task 5 jest `labelFor keeps inactive labels`.
- Import cell "k-12 school" (wrong case) must land as `K-12 School`, else the filter shows two buckets. → Task 2 test `test_import_canonicalises_school_category`.
- Seeding twice (two concurrent first GETs) must not duplicate rows → unique index + upsert seeding. → Task 1 test `test_seed_idempotent`.
- A sheet with a "Category" column previously mapped to School Type now maps to School Category — intended (spec call). → Task 2 test `test_category_alias_maps_to_school_category`.

---

### Task 1: Lookup backend (registry, CRUD, seed, usage, cascade)

**Files:**
- Create: `backend/routes/lookup_routes.py`
- Modify: `backend/main.py` (import + `app.include_router(lookup_router, prefix="/api")` next to product_type_router)
- Modify: `backend/ensure_indexes.py` (unique `(list_key, value)` on `lookup_values`; `school_category` on `schools`)
- Test: `backend/tests/test_lookup_masters.py`

**Interfaces:**
- Produces:
  - `LOOKUP_LISTS: dict[str, dict]` — each `{label, group: "crm"|"product", collection, field, stores: "name"|"value", seed: list[tuple[value, name]]}`
  - `slugify(name: str) -> str` (lowercase, non-alnum → `_`, trimmed `_`)
  - `async def get_values(list_key: str, include_inactive=True) -> list[dict]` (seeds on empty; used by other modules)
  - `async def canonical_name(list_key: str, raw: str) -> str` — case-insensitive match on name or value → stored form (`name` or `value` per `stores`); unknown → raw stripped
  - Routes: `GET /lookups`, `GET /lookups/{key}`, `POST /lookups/{key}`, `PUT /lookups/{key}/{lookup_id}`, `DELETE /lookups/{key}/{lookup_id}`; unknown key → 404
  - Value doc: `{lookup_id: "lk_<hex8>", list_key, value, name, is_active, sort_order, created_at}`; GET adds `usage: int`

- [ ] **Step 1: Write failing tests** (harness copied from `tests/test_bulk_multi_tag.py`: mongomock db monkeypatched onto `routes.lookup_routes.db`, `get_current_user` patched, `FakeRequest`)
  - `test_get_seeds_school_category` → names == `["Pre School","K-12 School","Franchise","Navodaya","Independent"]`
  - `test_seed_idempotent` → two GETs, count == 5
  - `test_product_category_seed_values` → values include `"3d_flowers"`, name `"3D Flowers"`, 14 rows
  - `test_create_dedupes_case_insensitive` → POST `{"name":"pre school"}` returns existing `lookup_id`
  - `test_create_slug_value` → POST `{"name":"Play Way School"}` → `value == "play_way_school"`
  - `test_rename_name_list_cascades` → school with `school_category:"Franchise"`; PUT name `"Franchisee"` → school now `"Franchisee"`
  - `test_rename_value_list_keeps_records` → die `category:"flowers"`; rename product_category Flowers → "Florals" → die still `"flowers"`
  - `test_delete_in_use_409` → school uses Navodaya → DELETE raises HTTPException 409, `"1"` in detail
  - `test_delete_unused_ok`
  - `test_rename_requires_admin` → REP user → 403
  - `test_unknown_list_404`
  - `test_usage_counts` → GET returns `usage == 2` for a category on 2 non-deleted schools (ignore `is_deleted: True`)
  - `test_canonical_name` → `("school_category","k-12 school") == "K-12 School"`, `("product_category","3D flowers") == "3d_flowers"`, unknown returns stripped raw

- [ ] **Step 2: Run** `cd backend && python -m pytest tests/test_lookup_masters.py -q` → FAIL (module missing)
- [ ] **Step 3: Implement** `lookup_routes.py`. Seeding uses `update_one({list_key, value}, {$setOnInsert: ...}, upsert=True)` per seed row so concurrent first reads never duplicate. Usage = `count_documents({field: stored, is_deleted: {$ne: True}})` on the registry collection. Reuse `_require_master_admin` logic locally (import `get_team` from `rbac`).
- [ ] **Step 4: Run tests** → PASS
- [ ] **Step 5: Commit** `feat(masters): generic lookup_values master with school_category, product_category, package_type`

---

### Task 2: Wire School Category into schools, import, audiences

**Files:**
- Modify: `backend/routes/crm_routes.py` (`create_school` doc ~L5139 add `"school_category"`; update allowed tuple ~L5347; canonicalise via `canonical_name` on both)
- Modify: `backend/field_registry.py` (new seed tuple after `school_type`: `("school_category","School Category","school","text","school_category","School",["school category","category","segment"])`; remove `"category"` from `school_type` aliases)
- Modify: `backend/import_engine.py` (school writes: canonicalise `school_category` before upsert — find where school fields are assembled from `_CORE`)
- Modify: `backend/routes/email_routes.py` (~L454 audience filter `school_categories` → `sch_q["school_category"] = {"$in": ...}`; options endpoint ~L559 returns `school_categories` distinct non-blank)
- Modify: `backend/routes/whatsapp_routes.py` (~L281 same as email)
- Test: `backend/tests/test_school_category.py`

**Interfaces:**
- Consumes: `canonical_name(list_key, raw)` from Task 1.
- Produces: school docs carry `school_category: str` (may be `""`); audience_filter key `school_categories: list[str]`; audience-options response key `school_categories`.

- [ ] **Step 1: Failing tests**
  - `test_create_school_with_category` → POST body `school_category:"k-12 school"` → stored `"K-12 School"`
  - `test_update_school_category`
  - `test_category_alias_maps_to_school_category` → `propose_mapping` on header `"Category"` → `school_category`
  - `test_import_canonicalises_school_category` → import row `Category: "navodaya"` → school `"Navodaya"`
  - `test_email_audience_filters_by_category` → two schools, filter `["Navodaya"]` → only that school's contacts
  - `test_wa_audience_filters_by_category`
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement** as listed in Files.
- [ ] **Step 4: Run** `python -m pytest tests/test_school_category.py tests/test_field_registry.py tests/test_import_mapping.py -q` → PASS (existing registry/mapping tests may assert `"category"`→school_type; update those assertions to the new mapping)
- [ ] **Step 5: Commit** `feat(crm): school_category field — form/update, import alias, email+WA audience filter`

---

### Task 3: Package Type + die category validation on backend

**Files:**
- Modify: `backend/routes/inventory_routes.py` (`POST /packages` ~L437 and PUT allowed keys ~L465 add `package_type` canonicalised; die bulk import ~L335 replace `valid_categories` set with `canonical_name("product_category", raw)` and fall back to `"decorative"` when result isn't an existing value)
- Test: `backend/tests/test_package_type_and_die_category.py`

**Interfaces:**
- Consumes: `canonical_name`, `get_values` from Task 1.
- Produces: package docs carry `package_type: str`.

- [ ] **Step 1: Failing tests**
  - `test_create_package_with_type` → `"dies only"` stored `"Dies Only"`
  - `test_update_package_type`
  - `test_die_import_accepts_new_master_category` → add product_category "Vehicles" via lookup; import row category `"Vehicles"` → die `category == "vehicles"`
  - `test_die_import_unknown_category_falls_back` → `"zzz"` → `"decorative"`
  - `test_die_import_label_match` → `"Animals & Birds"` → `"animals_birds"`
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** → PASS, plus `python -m pytest tests/test_inventory_catalogue.py -q` still green
- [ ] **Step 5: Commit** `feat(inventory): package_type field; die import category from product_category master`

---

### Task 4: Frontend lookup plumbing + editor + pages

**Files:**
- Modify: `frontend/src/lib/api.js` (export `lookups = { lists, getAll(key), create(key,data), update(key,id,data), remove(key,id) }`)
- Create: `frontend/src/hooks/useLookup.js`
- Create: `frontend/src/lib/lookupUtils.js`
- Create: `frontend/src/components/masters/LookupListEditor.js`
- Create: `frontend/src/pages/admin/ProductMasters.js`
- Modify: `frontend/src/pages/admin/CRMMasters.js` (TABS: add `{ id: 'schoolcategory', label: 'School Category', icon: Building2, desc: 'Kind of school — Pre School, K-12, Franchise, Navodaya, Independent. Shown on school forms and CRM filters.' }` after `schooltypes`; render `<LookupListEditor listKey="school_category" canEdit={canEditMasters} />`)
- Modify: `frontend/src/App.js` (lazy route `/product-masters`), `frontend/src/components/ProtectedRoute.js` (`'/product-masters': 'inventory'`), `frontend/src/pages/admin/Inventory.js` (menu item "Product Masters" next to Product Types ~L112), `frontend/src/pages/admin/PackageMaster.js` (header link)
- Test: `frontend/src/lib/__tests__/lookupUtils.test.js`

**Interfaces:**
- Produces:
  - `useLookup(listKey) -> { items, activeItems, labelFor(stored) -> string, reload }`; until loaded, `items` = built-in fallback from `lookupUtils.FALLBACKS[listKey]`
  - `lookupUtils.labelFor(items, stored)` — matches `value` then `name` (any active state); unmatched → title-cased stored with `_`→space
  - `lookupUtils.FALLBACKS` — same seeds as Global Constraints
  - `<LookupListEditor listKey canEdit />` — add input, chips with rename (inline), Active toggle, delete; 409 → `toast.error("Used by N records — deactivate it instead")`; shows usage count per chip
  - `ProductMasters` tabs = lists from `GET /lookups` with `group === 'product'`

- [ ] **Step 1: Failing jest** `lookupUtils.test.js`: `labelFor keeps inactive labels` (inactive `{value:'flowers',name:'Flowers'}` → `'Flowers'`); `labelFor falls back to title case` (`'giant_flowers'` with empty items → `'Giant Flowers'`); `labelFor matches name for name-stored lists`
- [ ] **Step 2: Run** `cd frontend && npx react-scripts test --watchAll=false src/lib/__tests__/lookupUtils.test.js` → FAIL
- [ ] **Step 3: Implement** files above; follow `CRMMasters.js` styling tokens (`card`, `chipCls`, `#e94560` accent).
- [ ] **Step 4: Run** → PASS
- [ ] **Step 5: Commit** `feat(masters): LookupListEditor, School Category tab, Product Masters page`

---

### Task 5: Use the lookups in forms, filters, inventory, packages

**Files:**
- Modify: `frontend/src/components/crm/SchoolFormDialog.js` (Category `<select>` from `useLookup('school_category').activeItems`, `data-testid="school-category-select"`, blank option "—")
- Modify: `frontend/src/components/school/SchoolProfileHeader.js` (show category chip when set)
- Modify: `frontend/src/lib/crmFilter.js` (facet `school_categories` mirroring `school_types` everywhere: options derivation, `hasActiveFilters`, `countActive`, row predicate with lead→school roll-up, `FACET_LABELS.school_categories = 'Category'`, chip builder)
- Modify: `frontend/src/components/crm/FilterRail.js` (Category section next to Type)
- Modify: `frontend/src/components/marketing/AudienceFilterBuilder.js` (Category multi-select using `school_categories` from options)
- Modify: `frontend/src/hooks/useInventory.js`, `frontend/src/components/inventory/DieFormDialog.js`, `frontend/src/pages/admin/Inventory.js` (category options + chip labels from `useLookup('product_category')`; keep `CATEGORIES`/`CAT_LABELS` exports as fallback so other importers don't break)
- Modify: `frontend/src/hooks/usePackageMaster.js` (`DEFAULT_FORM.package_type: ''`, include in load + save payload), `frontend/src/components/packages/PackageFormPanel.js` (Package Type select), package list card badge in `PackageMaster.js`
- Test: `frontend/src/lib/__tests__/crmFilter.test.js` (extend)

**Interfaces:**
- Consumes: `useLookup` (Task 4); backend fields from Tasks 2–3.

- [ ] **Step 1: Failing jest** in `crmFilter.test.js`: `filters schools by school_categories`; `lead rolls up category from its school`; `countActive counts school_categories once`
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement** all Files.
- [ ] **Step 4: Run** full frontend tests touching crm: `npx react-scripts test --watchAll=false src/lib src/components/crm` → PASS
- [ ] **Step 5: Commit** `feat(crm,inventory): school category in form/profile/filters/audience; product category + package type from masters`

---

### Task 6: Build, full test run, deploy, smoke

- [ ] **Step 1:** `cd backend && python -m pytest -q -x --ignore=tests/test_inventory_archive_delete.py` (live-server tests excluded as today) → no new failures vs. origin/main baseline
- [ ] **Step 2:** Frontend build per `reference_frontend_build_eslint` memory (the CI-safe build command used by previous deploys) → bundle builds
- [ ] **Step 3:** Commit bundle `chore(frontend): rebuild bundle for lookup masters`
- [ ] **Step 4:** Merge to `main`, push `origin/main` (auto-deploys ~2 min), wait for `GET /api/health` 200
- [ ] **Step 5:** Smoke on prod: CRM Masters → School Category shows 5 seeds; set category on one school; CRM filter by it returns that school; Product Masters shows 14 categories + 4 package types
