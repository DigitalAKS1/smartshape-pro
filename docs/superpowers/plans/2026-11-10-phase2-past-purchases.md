# Phase 2 — Past Purchases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Checkbox steps.

**Goal:** Record old orders per school (manual + Excel), merge them with real orders into one purchase history, and count them for account status / reorder-due.
**Architecture:** New `past_purchases` collection, `services/purchase_history.py` (merge + revenue events), `routes/past_purchase_routes.py` (history, CRUD, template, import). Lifecycle + reorder read `revenue_events`. Frontend: `PurchaseHistorySection` on School Profile Sales tab; "Old Orders" tab in Import Center.
**Tech Stack:** FastAPI/Motor + pytest/mongomock_motor; React CRA.
**Spec:** `docs/superpowers/specs/2026-11-10-nine-point-backlog-design.md` — Phase 2.

## Global Constraints
- Never write to `db.orders`, `db.order_items`, `db.dies`, payments, leads from this feature.
- Cancelled = `order_status == "cancelled"` OR legacy `status == "cancelled"`.
- `purchase_date` stored `YYYY-MM-DD`; revenue event `at` = `<date>T00:00:00+00:00`.
- Template header exactly: `school_id,school_name,city,purchase_date,die_code,item_name,item_type,qty,reference,amount,notes`.

## Review Focus
- Same file uploaded twice → second run `created == 0`, `duplicates == groups`. → Task 3 `test_reupload_creates_nothing`.
- A row with a die code not in inventory must not be dropped — kept as free-text item. → Task 3 `test_unknown_die_code_kept_as_text`.
- Dry run writes nothing. → Task 3 `test_dry_run_writes_nothing`.
- Old purchase makes a prospect school a customer/dormant on save. → Task 2 `test_create_recomputes_lifecycle`.
- A cancelled real order (order_status) no longer counts. → Task 1 `test_cancelled_by_order_status_excluded`.

### Task 1: purchase_history service + lifecycle/reorder use it
Files: create `backend/services/purchase_history.py`; modify `backend/services/account_lifecycle.py`, `backend/services/reorder.py`; test `backend/tests/test_purchase_history.py`.
Produces: `revenue_events(db, school_ids: list[str]) -> dict[str, list[dict]]`, `school_purchase_history(db, school_id) -> {"entries", "items"}`, `is_cancelled(order: dict) -> bool`.
- [ ] Tests: `test_cancelled_by_order_status_excluded`, `test_legacy_status_cancelled_excluded`, `test_past_purchase_is_revenue_event`, `test_history_merges_orders_and_past_newest_first`, `test_item_summary_totals_by_die`, `test_lifecycle_counts_past_purchase` (school with only a 400-day-old past purchase → dormant), `test_reorder_includes_past_purchase_only_school`.
- [ ] RED → implement → GREEN; existing `test_account_lifecycle.py` + `test_reorder_motion.py` stay green. Commit.

### Task 2: routes — history + manual CRUD
Files: create `backend/routes/past_purchase_routes.py`; modify `backend/main.py`, `backend/database.py` (index on `past_purchases.school_id` + partial unique `dedupe_key` inside `ensure_wa_indexes` neighbour block); test `backend/tests/test_past_purchase_routes.py`.
Consumes Task 1. Uses `crm_routes._user_can_access_school(user, school)`.
- [ ] Tests: `test_create_and_history`, `test_create_requires_school_access` (403), `test_create_validates` (no items → 400; bad date → 400; qty<1 → 400), `test_create_recomputes_lifecycle`, `test_update_items`, `test_delete_soft_and_admin_or_creator`, `test_manual_duplicate_returns_409`.
- [ ] RED → implement → GREEN. Commit.

### Task 3: template + import (dry run / commit)
Files: modify `past_purchase_routes.py`; test `backend/tests/test_past_purchase_import.py`.
Produces `parse_date(raw) -> str|None` (YYYY-MM-DD; accepts `2024-03-05`, `05-03-2024`, `05/03/2024`, Excel serial `45356`).
- [ ] Tests: `test_parse_date_formats`, `test_groups_rows_per_school_date_reference`, `test_unknown_school_skipped_with_reason`, `test_unknown_die_code_kept_as_text`, `test_dry_run_writes_nothing`, `test_reupload_creates_nothing`, `test_template_header`, `test_import_requires_admin_or_orders`.
- [ ] RED → implement (csv via `csv.DictReader`, xlsx via openpyxl already used by import routes — reuse their reader) → GREEN. Commit.

### Task 4: frontend
Files: `frontend/src/lib/api.js` (`pastPurchases = { history, create, update, remove, template, importFile(file, dryRun) }`), create `frontend/src/components/school/PurchaseHistorySection.js`, create `frontend/src/components/school/PastPurchaseDialog.js`, create `frontend/src/components/import/OldOrdersImport.js`, modify `SchoolProfile.js` (render section in Sales tab), `ImportCenter.js` (tab `oldorders` → "Old Orders").
- [ ] Build compiles (`CI=false DISABLE_ESLINT_PLUGIN=true npx react-scripts build`). Commit.

### Task 5: review, bundle, deploy, prod repair
- [ ] Fresh reviewer on branch; fix Critical/Important with RED→GREEN.
- [ ] `bash scripts/build-frontend.sh`, verify no localhost; commit bundle; push `HEAD:main`; wait for bundle live; login 422; new endpoint 401.
- [ ] Prod: create `past_purchases` indexes in container (connect_db never runs); recompute lifecycle not needed (no data yet).
