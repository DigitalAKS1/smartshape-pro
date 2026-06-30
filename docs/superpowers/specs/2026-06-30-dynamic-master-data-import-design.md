# Dynamic Master Data — Import, Field Registry & Upsert (Design Spec)

**Date:** 2026-06-30
**Branch:** `feat/module-rbac` (current)
**Author:** Vikram (CEO) + team — Dhruv (DB), Arjun (backend), Rohan (frontend), Meera (UX), Vivek (QA)
**Status:** Approved for planning

---

## 1. Goal

Let the owner upload school data as **CSV or Excel**, have the system **auto-map columns** to our fields,
**add new fields without a developer** (Google/Zoho-form style), and **upsert by a unique School ID** so
re-uploads update existing records instead of creating duplicates. One uploaded row fans out into a
**School + Contact + (optional) Lead**.

### Non-goals (Phase 1)
- Public shareable fillable form (deferred to **Phase 2** — same engine).
- AI/LLM-based mapping (we use deterministic alias + fuzzy matching; learned aliases give the "smart" feel).
- Bulk auto-merge of duplicate schools (explicitly forbidden — ambiguous rows are flagged for review).

---

## 2. Current state (ground truth, with citations)

- **School PK exists:** `school_id = "sch_" + uuid4().hex[:12]`, immutable — `backend/server.py:1467`.
  Indexed at `backend/database.py:53`.
- **Existing CSV importer is fragile:** `POST /contacts/import` is CSV-only, hardcoded columns, and matches
  schools by **name regex** (creates duplicates) — `backend/routes/crm_routes.py:1985-2072`.
- **An Import Center already exists** (two-step preview→execute): frontend `frontend/src/pages/admin/ImportCenter.js`,
  API `importSystem.preview/execute/logs` — `frontend/src/lib/api.js:773-781`. We **extend** this, not replace it.
- **`pandas==3.0.2` installed but unused** for import — `backend/requirements.txt:44`. No `openpyxl`/xlsx yet.
- **No dynamic-field system** anywhere; schools are a rigid ~22-field schema — `backend/server.py:1468-1492`.
- **RBAC hooks to reuse:** `require_admin(user)` (`backend/rbac.py:33-35`),
  `require_module(user, "settings", "read_write")` (`backend/rbac.py:73-96`),
  `get_current_user` (`backend/auth_utils.py:60-87`).
- **Audit-snapshot pattern exists** (`audit_backup`) — reuse before any overwrite (standing rule: no destructive
  overwrite without a snapshot).
- **Frontend reuse:** `MasterEntityTable.js`, `components/ui/dialog.jsx`, settings tab pattern
  (`hooks/useAppSettings.js`, `pages/admin/AppSettings.js`), data-sync (`lib/dataSync.js` `useDataSync`).

---

## 3. The 28-column master form (seed catalog)

Person/Contact: `Title, Name, Phone Number, Mail ID, Group/Designation, birthday (principal/director),
anniversary (principal/director)`.
School: `School/Institute Name, School Full Address, City, State, Pin Code, Affiliated Board, STD (classes),
School's Phone, School's Mail, Annual Fees, Campus Area, Teacher's strength, No. of Classrooms,
Student's strength, Website, Instagram, LinkedIn, Principal/Director LinkedIn, Former Principal,
Current Principal`.
Lead: `Assign To (owner)`.

These seed the Field Registry: each maps to an existing core column where one exists, otherwise becomes a
custom field. Core fields are flagged `is_core` (relabel-only, no delete).

---

## 4. Architecture

Decision: **Field Registry + `custom_fields` map** (rejected: EAV, schemaless dump — see §8).

### 4.1 Field Registry (new collection `field_definitions`)
```
{
  field_id:   "fld_<12hex>",          # immutable PK
  key:        "annual_fees",          # snake_case, immutable; storage key
  label:      "Annual Fees",          # editable display label
  entity:     "school"|"contact"|"lead",
  type:       "text"|"number"|"date"|"email"|"phone"|"url"|"select"|"multiselect"|"boolean",
  options:    ["CBSE","ICSE",...],    # for select/multiselect
  required:   false,
  is_unique:  false,                  # informational (matching is engine-driven, not per-field)
  is_core:    true,                   # core fields: relabel only, cannot delete/retype
  maps_to:    "school.annual_budget_range" | null,  # core field -> native column; null = custom_fields.<key>
  aliases:    ["annual fees","fees","annual budget"], # header strings -> powers auto-mapping (learned over time)
  group:      "School",               # UI grouping
  order:      40,
  is_active:  true,
  created_by, created_at
}
```
Seeded idempotently at startup (guarded by an `app_meta` flag, same pattern as `seed_product_types`
in `backend/database.py:220`).

### 4.2 Value storage
- **Core fields** write to their native columns on `schools` / `contacts` / `leads` (no schema change).
- **Custom fields** write to a `custom_fields: { <key>: value }` object on the entity document.
- A read helper `merge_fields(entity_doc, entity_type)` returns native + custom flattened for display/export.
- Indexes added only when a custom field is marked filterable (deferred; not Phase 1).

### 4.3 Import engine (new module `backend/import_engine.py`)
Pipeline: **parse → map → resolve → preview → commit**.
- **parse:** CSV (existing `csv.DictReader` with the UTF-8-SIG/CP1252/Latin-1 fallback ladder already in
  `crm_routes.py:1998-2003`) **+ Excel** via `openpyxl` (add to requirements). Returns headers + rows.
- **map:** for each header, propose a field by — (1) exact alias match (case/space/punct-insensitive),
  (2) normalized token similarity (fuzzy), (3) unmapped. Returns `{source_header, field_id|null, confidence:
  "high"|"medium"|"none"}`. On **commit**, any confirmed mapping appends the source header to that field's
  `aliases[]` → next upload auto-maps (the "remembers" behavior).
- **resolve (per row):** find School by `school_id` column (exact) → else normalized `school_name`+`city`
  → else `phone` tiebreaker. `0 matches` = create (mint `school_id`); `1 match` = update; `>=2 matches` =
  `needs_review` (never auto-merge). Then Contact (dedup by phone within school, per
  `crm_routes.py:2015`), then optional Lead from "Assign To".
- **commit:** snapshot each to-be-updated school/contact into `audit_backup` first, then upsert. Writes an
  `import_logs` row (reuse existing logs) with counts + a downloadable error/needs-review report.

### 4.4 API (extend `/import/*`, add `/fields/*`)
- `GET    /fields?entity=school|contact|lead` — list (admin).
- `POST   /fields` — create custom field; `PUT /fields/{id}` — edit label/options/order; core: label/options only.
- `DELETE /fields/{id}` — soft-delete custom only (`is_active=false`); 409 on core.
- `POST   /import/preview` — multipart file + entity_type → `{ headers, mapping[], rows_preview[], counts:
  {create, update, needs_review, error} }` (extends existing preview).
- `POST   /import/execute` — `{ mapping[], options:{create_leads:bool} }` → commits; returns counts + report id.
- `GET    /import/template?with_ids=true` — download CSV/XLSX template; `with_ids=true` pre-fills existing
  `school_id`s for clean round-trip re-upload.
All gated by `require_module(user, "settings", "read_write")` (or `require_admin`).

### 4.5 Frontend
- **`frontend/src/pages/admin/MasterFields.js`** (new) — Settings tab; grouped list (School/Contact/Lead) via
  `MasterEntityTable`, +Add/Edit field dialog. Refresh via `useDataSync('settings', ...)`.
- **`ImportCenter.js`** (extend) — add a **Mapping step** between upload and preview: table of source columns →
  field dropdown + confidence dot + inline "＋ Create field". Excel accepted (`accept=".csv,.xlsx"`).
- **`frontend/src/components/forms/DynamicEntityForm.js`** (new) — renders an Add/Edit School form from the
  registry (typed inputs, validation, grouping). Reused for manual entry.

---

## 5. Data flow (one uploaded row)

```
Excel/CSV row
  -> parse (headers + values)
  -> map (header -> field_id via alias/fuzzy; admin confirms)
  -> resolve school (school_id | name+city | phone)
       0 match -> create school (new school_id)
       1 match -> snapshot + update
       >=2     -> needs_review (skip write)
  -> resolve contact (dedup by phone within school) -> upsert
  -> if "Assign To" + create_leads -> upsert lead (owner = Assign To)
  -> write import_logs row
```

---

## 6. Error handling & safety
- **No destructive overwrite:** snapshot to `audit_backup` before any update; ambiguous rows never written.
- **Per-row isolation:** one bad row → recorded in report, does not abort the batch.
- **Idempotent re-upload:** same sheet twice = updates, no new rows (ID round-trip guarantees exactness).
- **Validation:** type-check each mapped value against the field type; coercion failures become row errors.
- **RBAC:** all endpoints admin/settings-gated; field deletes restricted; core fields protected.

## 7. Testing (Vivek)
- **Hard rule:** tests run against `DB_NAME=*_test` / `mtt_ci` only — never the live DB.
- Unit: alias/fuzzy mapper; resolver (0/1/≥2 match paths); value coercion per type.
- Integration: preview→execute on a sample of the real 28-column sheet; re-upload idempotency; xlsx + csv parity;
  audit snapshot written before update.
- Edge: duplicate-name different city; blank school_id; bad phone; unknown header → create field → re-map.

## 8. Alternatives considered
- **EAV (`field_values` table):** max flexibility, but join-heavy and slow; rejected as over-engineering.
- **Schemaless dump:** simplest, but no types/validation/mapping intelligence; rejected.
- **LLM column mapping:** nice UX but non-deterministic + cost; learned aliases achieve ~same result deterministically.

## 9. Phasing
- **Phase 1 (this spec):** Field Registry + builder, Excel/CSV smart-mapping import, ID upsert engine,
  dynamic data-entry form, ID round-trip template.
- **Phase 2 (future):** public shareable fillable form on the same registry + de-dupe engine.

## 10. Acceptance criteria
1. Upload the real 28-column **.xlsx**; columns auto-map (≥ most high/medium confidence); admin can correct.
2. Add a brand-new field in Master Fields; it immediately appears in the import mapping dropdown **and** the
   data-entry form.
3. First import creates schools with `school_id`s; **download "sheet + IDs"**; re-upload updates 0 duplicates.
4. A row matching two schools is reported as **needs_review**, not merged.
5. Each updated school has an `audit_backup` snapshot from before the write.
6. All tests pass on a `*_test` DB; live DB untouched.
