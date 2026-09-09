# CRM Data Grid & ID-Based Upsert — Design

**Date:** 2026-09-09
**Status:** Approved for planning
**Author:** Aman Shrivastava (owner) + Claude

## Problem

The owner exports CRM contacts to CSV, edits them in Excel, and re-uploads
expecting existing records to be updated. Nothing updates. Separately, tags
applied through CSV import are invisible to CRM filters, and the CRM table is
slow and cannot filter or sort like a spreadsheet.

Four independent defects produce this experience.

### Defect 1 — Export and import are incompatible code paths

The Contacts page exports through `GET /export/contacts`
(`backend/routes/admin_routes.py:1557`), which writes `contact_id` as column 1.
It re-uploads through `POST /contacts/import`
(`backend/routes/crm_routes.py:4859`), which never reads `contact_id` and always
mints a fresh `con_<uuid>` (line 4893). On a name+phone match it does
`duplicates += 1; continue` (lines 4889-4892) — insert-only, no update path.

The frontend wires these two together on the same screen:
`frontend/src/hooks/useLeadsCRM.js:552` (export) and `:530` (import).

### Defect 2 — Tags are stored under different field names per writer

| Writer | Collection | Field written | Location |
|---|---|---|---|
| Admin CSV import | `db.schools` | `tag_ids` | `admin_routes.py:1324` |
| CRM "Add tag" bulk | `db.schools` | `tags` | `crm_routes.py:3887` |
| `PUT /schools/{id}` | `db.schools` | `tags` | `crm_routes.py:3944` |
| CRM contact tagging | `db.contacts` | `tag_ids` | `crm_routes.py:4654` |
| Admin CSV import | `db.contacts` | `tag_ids` | `admin_routes.py:1361` |
| CRM lead tagging | `db.leads` | `tags` | `crm_routes.py:6166` |

Schools carry both fields depending on provenance. CRM reads and filters use
`tags`, so tags applied by import are invisible in the UI, and vice versa. Only
`contacts.tag_ids` is indexed (`ensure_indexes.py:65-66`).

A parallel split exists on school ownership: import writes `owner`
(`admin_routes.py:1326`) while the CRM reads `assigned_to` (`crm_routes.py:3831`).

### Defect 3 — Tag round-trip corrupts data

`GET /export/contacts` writes tags pipe-joined, `A|B|C`
(`admin_routes.py:1570`). The admin importer splits tag cells on commas only
(`_parse_tag_names`, `admin_routes.py:1160`). A pipe-joined export re-imported
through that path creates one tag literally named `"A|B|C"`.

`POST /contacts/import` ignores the CSV `tags` column entirely and applies the
dialog's chip selection to every row (`crm_routes.py:4862, 4868, 4945`),
overwriting per-contact tags.

### Defect 5 — The import engine overwrites live fields with blanks

Found while planning, after this spec's decisions were taken. It is a live
data-loss bug in the Admin → Import Center today, not a risk introduced by this
work.

`split_values` iterates every key present in the row and does not drop empty
ones (`import_engine.py:385`). `commit_row` then `$set`s that dict wholesale on
the update branch (`import_engine.py:552`), so a blank `Mail ID` column writes
`email: ""` over the stored address. Schools are worse: line 511 reads
`if sch_phone_raw or "phone" in upd`, so the mere presence of a phone column —
blank or not — clears the stored number.

This directly violates D1. Because the owner's export carries blank phone and
email on the majority of its ~1,500 rows, wiring the Contacts import to the
engine without fixing this first would destroy data on the first re-upload.
Blank-safety is therefore the first task of sub-project A, ahead of the tag
canonicalisation, and it makes the existing Import Center safe independently of
anything else built here.

### Defect 4 — The table cannot work like a spreadsheet, and is slow

Four separate hand-rolled `<table>` blocks with no shared component:
leads list (`LeadsCRM.js:545-585`), pipeline table (`:758-800`), schools
(`:958-1020`), contacts (`ContactsTab.js:252-261`), plus duplicate mobile card
lists. Two competing filter UIs with independent state: the filter rail
(`lib/crmFilter.js`) and `MultiFilterBar.js`.

No pagination and no virtualization: `hooks/useCrmData.js:49-59` loads every
lead, school and contact in one shot and the tables render every filtered row.
Sorting exists (`useLeadsCRM.js:617-628`) but string-coerces all values, so
dates and numbers sort lexically. One `sortConfig` is shared across all tabs.
Selection is a raw `Set` that is never cleared on filter change, so hidden rows
stay selected. Contacts have no selection and no bulk actions at all.

## Goals

1. A CSV exported from the CRM, edited, and re-uploaded updates the existing
   records it names — matched by `contact_id`, `school_id` and `lead_id`.
2. Tags are stored under one field name per collection and are visible
   regardless of which code path wrote them.
3. Selecting many rows and applying tags, group, designation, city or owner in
   one action, for contacts as well as schools and leads.
4. The CRM table filters, sorts and scrolls like a spreadsheet, and stays
   responsive at current data volumes and roughly 10x beyond.

## Non-goals

- Server-side pagination. Current volumes are ~1,335 schools, ~1,498 contacts,
  ~446 leads. Client-side filtering is faster and simpler at this scale. The
  server-paginated hooks from commit `b99a6bc` remain dead code; this design
  does not wire or delete them.
- Inline cell editing. The bulk-edit panel covers the real need at a fraction
  of the cost and risk.
- A fourth CSV importer. This design reduces three importers to two.
- Changing what `GET /export/contacts` emits, beyond the tag delimiter fix.

## Decisions taken during design

**D1 — Blank cells on re-upload never clear a field.** An empty cell means
"leave this field alone". Only cells with a value are written. A careless
re-upload can never erase data. Clearing a field is done in the UI, not by CSV.
Rationale: the owner's current export has blank phone and email on the majority
of rows; blank-clears semantics would wipe hundreds of records in one action.

**D2 — Bulk edit is tick-to-include.** Group, Designation, City, Tags and Owner
are independent checkboxes. Only ticked fields are written; unticked fields are
untouched. This mirrors D1's semantics so the two features behave consistently.

**D3 — "Group" and "Designation" are two distinct fields.** No field named
`group` exists on any collection. Group means the school chain
(`schools.group_id`, a foreign key into `db.groups` with `group_name` and
`chairman_name`, `crm_routes.py:569-604`). Designation means the person's role
(`contacts.designation`, labelled "Group/Designation" in the field registry,
`field_registry.py:55`). Both are exposed separately.

**D4 — City writes through to the school.** `city` and `state` exist only on
`db.schools`. Contacts and leads have no city field; a lead's `school_city` is
derived at read time (`crm_routes.py:5147`). Bulk-editing city on a contact
selection resolves those contacts to their parent schools and patches the
schools, showing the fan-out count before confirming.

**D5 — Canonical tag field is `tag_ids` on all three collections.** It is
semantically accurate (the array holds tag IDs), `db.contacts` already carries
the index, and contacts is the largest collection. Schools and leads migrate
from `tags` to `tag_ids`.

**D6 — Migrate and cut over in one deploy; no compatibility shim.** ~3,300
documents migrate in milliseconds and every reader is in this repo. A dual-read
fallback would be carried indefinitely for no benefit.

**D7 — Grid is built on TanStack Table.** Headless, so Tailwind and the
CSS-variable theming are untouched. Column filtering, multi-column sort and
virtualization are its core competence. Existing `crmFilter.js` predicates plug
in as custom filter functions rather than being discarded.

## Architecture

Four sub-projects, sequenced. Each ships independently and is useful alone.

```
A0  tag canonicalisation  ──┐
                            ├──> C  bulk patch  ──> B  data grid
A   ID-based upsert      ───┘
```

A0 must land before A and C, because both write tags. A and C are independent
of each other. B consumes C's endpoint for its bulk-edit panel.

---

## Sub-project A0 — Tag field canonicalisation

**Goal:** one tag field name per collection, all readers and writers agreed.

### Migration

A one-shot idempotent migration script,
`backend/migrations/canonicalise_tag_fields.py`, following the existing
migration convention in `backend/migrations/backfill_module_permissions.py`.

For `db.leads`: documents with `tags` and no `tag_ids` get `$rename: {tags: "tag_ids"}`.

For `db.schools`: a plain `$rename` fails where both fields exist, so union the
two arrays first, then unset the old field:

```python
await db.schools.update_many(
    {"$or": [{"tags": {"$exists": True}}, {"tag_ids": {"$exists": True}}]},
    [
        {"$set": {"tag_ids": {"$setUnion": [
            {"$ifNull": ["$tag_ids", []]},
            {"$ifNull": ["$tags", []]},
        ]}}},
        {"$unset": "tags"},
    ],
)
```

The script reports `{leads_renamed, schools_merged, schools_unset}` and is safe
to re-run: after the first pass no document matches the filter.

### Code changes

Every read and write of `schools.tags` and `leads.tags` becomes `tag_ids`.
Known sites: `crm_routes.py:3887` (bulk-tag schools), `:3944` (PUT school),
`:5155`, `:5180` (facets `$unwind`), `:5315`, `:6166` (bulk-tag leads).
The implementation task greps for remaining occurrences rather than trusting
this list.

Add indexes in `backend/ensure_indexes.py` alongside the existing
`contacts.tag_ids` index: `schools.tag_ids` and `leads.tag_ids`.

### School owner field

Same defect class, fixed in the same pass: `admin_routes.py:1326` writes
`owner` on school insert. Change it to write `assigned_to` and `assigned_name`,
matching `crm_routes.py:3831`. Migration renames any existing `schools.owner`
to `assigned_to` where `assigned_to` is absent.

### Testing

- Migration unit test: seed a school with only `tags`, one with only
  `tag_ids`, one with both (overlapping and disjoint), one with neither; assert
  the union is correct and `tags` is gone.
- Idempotency test: run the migration twice, assert the second run reports zero
  changes and the data is unchanged.
- Regression test: apply a tag through `POST /schools/bulk-tag`, then assert it
  appears in the CRM school list response and in the facet counts — the exact
  round-trip that is broken today.

---

## Sub-project A — ID-based upsert round-trip

**Goal:** re-uploading an edited export updates the records it names.

### Reuse, do not rebuild

`backend/import_engine.py` (600 lines) already implements exactly this and is
live behind Admin → Import Center via `backend/routes/dynamic_import_routes.py`.

| Capability | Location |
|---|---|
| `commit_row(db, row_keyed, user, create_leads)` | `import_engine.py:433` |
| School resolution: `school_id` → name+city → phone | `import_engine.py:246-304` |
| Contact upsert: `contact_id` → name+phone → phone → name | `import_engine.py:522-566` |
| Lead upsert: `lead_id` → `school_id` | `import_engine.py:568-597` |
| Honours supplied IDs on create | `import_engine.py:311` (`valid_supplied_id`) |
| Audit snapshot before school `$set` | `import_engine.py:502-509` |
| Control keys `school_id`/`contact_id`/`lead_id` | `field_registry.py:32-46` |

A working consumer already exists as the wiring template: `POST /mail-runs/import`
(`crm_routes.py:862-901`) calls `parse_table` → `propose_mapping` → `commit_row`.

### Changes required

**A.1 — Contacts-only guard.** `commit_row` is school-anchored: it resolves or
creates a school before touching the contact. A contacts CSV row with neither
`school_id` nor a company name would mint a junk school. Add a
`allow_school_create: bool = True` parameter; when a row supplies no school
identity at all, skip school resolution and upsert the contact with
`school_id = None` rather than creating one.

The owner's current export carries `school_id` on essentially every row, so
this guard is a safety net rather than the common path.

**A.2 — Tags in the engine.** The field registry has no tags concept, so
importing through the engine leaves `tag_ids` untouched. Add a `tags` field to
`field_registry.SEED_FIELDS` mapping to the contact's `tag_ids`, resolved via
the existing `_resolve_tags(names_or_ids, email)` helper
(`crm_routes.py:3358`), which accepts names or IDs and creates missing tags.

Tag cell parsing accepts both `|` and `,` as separators, fixing Defect 3 in
both directions. Whitespace around separators is stripped; empty segments are
dropped.

Per D1, a blank tags cell leaves existing tags untouched. A non-blank cell
replaces the record's tag set with exactly what the cell names.

Precedence when both a CSV cell and the dialog's chip selection are present is
resolved in one place, so the two cannot contradict each other:

| CSV `tags` cell | Dialog chips | Resulting `tag_ids` |
|---|---|---|
| blank | none | unchanged |
| blank | `X, Y` | existing ∪ `{X, Y}` |
| `A\|B` | none | exactly `{A, B}` |
| `A\|B` | `X` | `{A, B, X}` |

The cell is authoritative for the record it names; the chips are an additive
overlay applied to every row in the file. Chips never remove a tag.

**A.3 — Repoint the Contacts import.** Replace the body of
`POST /contacts/import` (`crm_routes.py:4859`) with the engine call, preserving
its current request shape (`file`, `tag_ids`, `global_notes`) so the frontend
dialog needs no change beyond result rendering. The dialog's chip selection is
applied *in addition to* any per-row CSV tags, not instead of them.

Validation relaxes from "name and phone both required" to "a row is importable
if it supplies `contact_id`, or a name". This matters because most rows in the
owner's export have a blank phone and are rejected outright today.

**A.4 — Response shape.** Return
`{created, updated, skipped, errors[]}` where `updated` counts ID-matched
records that were patched. The dialog surfaces all four counts; today it
reports `duplicates` for records it silently refused to update, which is the
source of the "it says it worked but nothing changed" experience.

**A.5 — Retire the dead path.** `POST /import/preview` and `/import/execute`
(`admin_routes.py:1111`, `:1224`) are insert-only and their frontend caller
(`importSystem.preview/execute`, `api.js:915-922`) is already orphaned —
`ImportCenter.js` calls only `.logs()`. Delete both endpoints and the orphaned
client methods. `_normalize_csv_headers` and `_parse_tag_names` go with them;
the engine's `field_registry.normalize_header` plus its alias table supersede
them.

This reduces three CSV importers to two: the engine (all CRM entity imports)
and `POST /dies/import` (inventory, unrelated domain).

### Data flow

```
Excel file
   -> parse_table(filename, content)            import_engine.py
   -> propose_mapping(db, headers)              header -> field key, fuzzy 0.78
   -> split_values(row_keyed)                   school / contact / lead / custom
   -> commit_row(db, ..., allow_school_create)
        resolve_school   : school_id -> name+city -> phone   (or skip)
        upsert contact   : contact_id -> name+phone -> phone -> name
        upsert lead      : lead_id -> school_id
        apply tags       : _resolve_tags(), replace-if-present
   -> {created, updated, skipped, errors}
```

### Error handling

Per-row failures are collected, never fatal: a malformed row is counted in
`errors` with its row number and the import continues. The response caps
`errors` at the first 50 entries with a total count, so a broken 1,500-row file
returns a usable diagnosis rather than a wall of text.

Rows are committed individually, as they are today. A partial import leaves the
successfully committed rows in place; re-uploading the same file is safe because
matching is ID-based and idempotent.

### Testing

- Round-trip test, the headline case: export contacts to CSV, change one
  designation and one tag cell, re-upload, assert the record is **updated** not
  duplicated, the `contact_id` is unchanged, and the untouched blank columns
  (phone, email) retain their original values (D1).
- Blank-cell test: upload a row whose phone and email cells are empty against a
  record that has both; assert both are preserved.
- Tag separator test: `A|B|C` and `A, B, C` both resolve to three tags.
- Contacts-only guard test: a row with no `school_id` and no company creates the
  contact with `school_id = None` and creates zero schools.
- ID-preservation test: a row with a `contact_id` that does not exist in the
  database creates a record using that supplied ID.
- No-phone test: a row with a name and no phone imports successfully.

---

## Sub-project C — Generic bulk patch

**Goal:** one endpoint and one panel for bulk edits, correctly permissioned.

### Endpoint

`POST /crm/bulk-patch`

```json
{
  "entity": "contact" | "school" | "lead",
  "ids": ["con_...", "..."],
  "set": { "designation": "Art Teacher" },
  "school_set": { "city": "Hyderabad", "group_id": "grp_..." },
  "tags": { "add": ["tag_..."], "remove": ["tag_..."] },
  "dry_run": false
}
```

`set` patches the named entity. `school_set` patches the parent schools of the
selected entities, implementing D4 — it is how city and group reach a contact
selection. When `entity` is `school`, `school_set` is rejected as redundant;
callers use `set`.

`dry_run: true` returns the same counts without writing, so the UI can show
"40 contacts → 12 schools will be updated" before the user commits. This mirrors
the safety pattern already used by `crm_maintenance_routes.py:253-282`.

### Field whitelists

Mirroring the per-entity whitelists already in place at `crm_routes.py:3936-3941`
(schools) and `:4495` (contacts):

| Entity | `set` accepts |
|---|---|
| contact | `designation`, `source`, `status`, `assigned_to` |
| school | `city`, `state`, `school_type`, `board`, `group_id`, `assigned_to` |
| lead | `stage`, `priority`, `lead_type`, `deal_type`, `source`, `assigned_to` |

`school_set` accepts the school list above and is valid only when `entity` is
`contact` or `lead`. Any key outside the whitelist is a 400, not a silent drop.

`assigned_to` is resolved through the existing `_apply_owner` helper
(`crm_routes.py:3492`) so a bulk owner change can never store a bare name in an
email field — the defect that required the `backfill-owners` repair.

### Permissions

Existing bulk endpoints are the wrong model to copy and are fixed as part of
this work:

| Endpoint | Current guard | Problem |
|---|---|---|
| `/leads/bulk-tag` (`crm_routes.py:6154`) | `get_current_user` only | any logged-in user can tag any lead |
| `/leads/bulk-stage` (`:6174`) | `get_current_user` only | any logged-in user can move any lead's stage |
| `/schools/bulk-tag` (`:3866`) | `require_module` only | no ownership scoping |
| `/schools/bulk-assign` (`:4084`) | `require_module` only | docstring claims admin-only; code does not enforce it |

The correct pattern, taken from the list-scoping shape at `crm_routes.py:3673-3687`:
gate with `require_module(user, "leads", "read_write")`, then if
`sees_all(user, "leads")` is false, merge `_owner_clause(user["email"])`
into the update query so unowned IDs are silently skipped rather than 403-ing
the whole batch. The response reports `requested` and `updated` counts so a rep
can see that some of their selection was out of scope.

`/leads/bulk-tag`, `/leads/bulk-stage`, `/schools/bulk-tag` and
`/schools/bulk-assign` are reimplemented as thin wrappers over `bulk-patch`,
inheriting its scoping. This removes the four divergent implementations.

### Limits, audit, cache

`ids` is capped at 2,000 per request and deduplicated; over the cap returns 400.
No existing CRM bulk endpoint caps its ID list.

Audit follows the established per-batch convention (`log_activity`,
`crm_routes.py:164`): one entry per call, with the affected count and the first
20 IDs in `details`. `bulk_tag_schools` and `wa-consent` currently log nothing;
routing them through `bulk-patch` fixes that.

Cache invalidation, which several existing write paths omit entirely
(`bulk_tag_schools:3888`, `wa-consent:3916`, `PUT /schools/{id}:3955` — all of
which can serve a stale `city` for up to the schools cache TTL):

| Entity patched | Invalidate |
|---|---|
| school | `schools:batch:*`, `crm:facets:*` |
| lead | `crm:facets:*`, `_bust_lead_details(*ids)` (`crm_routes.py:5199`) |
| contact | `crm:facets:*` |
| any, when tags change | `tags:*` |

### Testing

- Scoping test: a sales rep with `own` scope patches 10 IDs of which 4 are
  theirs; assert `updated == 4`, the other 6 are untouched, and the response
  reports `requested: 10`.
- Admin scope test: same call as admin updates all 10.
- Whitelist test: a key outside the whitelist returns 400 and writes nothing.
- Fan-out test: `school_set` on 40 contacts spanning 12 schools patches exactly
  12 schools; `dry_run` returns the same counts and writes nothing.
- Cap test: 2,001 IDs returns 400.
- Cache test: patch a school's city, then assert the cached `schools:batch:*`
  entry was invalidated and the next read returns the new city.
- Tag add/remove test: add two tags and remove one in a single call.

---

## Sub-project B — Shared Excel-like data grid

**Goal:** one grid component, used by every CRM table, that filters, sorts and
scrolls like a spreadsheet.

### Component

`frontend/src/components/crm/DataGrid.js`, built on `@tanstack/react-table`
(headless core) with `@tanstack/react-virtual` for row virtualization. Both are
new dependencies; neither ships styling, so the existing Tailwind and
CSS-variable theming (`bg-[var(--bg-card)]`, accent `#e94560`) is unchanged.

The grid takes a column definition array and a row array. Four column
definition modules — leads, schools, contacts, pipeline — replace the four
hand-rolled tables at `LeadsCRM.js:545-585`, `:758-800`, `:958-1020` and
`ContactsTab.js:252-261`, plus their duplicate mobile card lists.

### Capabilities

**Filter row.** A row beneath the headers, one control per column, typed by
column: text columns get contains-match, enum columns (stage, type, source,
owner, city) get a multi-select populated from the data via the existing
`deriveFilterOptions`, numeric and date columns get a range pair. Filters
combine AND across columns. Within a multi-select, OR — matching the semantics
already implemented in `crmFilter.js:102-221`.

**Sort.** Click a header to sort, shift-click to add a secondary sort. Sorting
is type-aware: numbers compare numerically, ISO dates compare as dates, text
compares with `localeCompare`. This replaces `sortData`
(`useLeadsCRM.js:621-628`), which coerces everything to string and therefore
sorts dates and numbers incorrectly today. Each tab owns its own sort state
rather than sharing one `sortConfig` across all three.

**Selection.** Checkbox column, shift-click for range selection, and a header
checkbox that selects all *currently filtered* rows. Selection state is keyed by
row ID. When a filter change hides selected rows, the grid shows
"40 selected (12 hidden by filter)" with a one-click clear — fixing the current
behaviour where hidden selections silently act.

**Column control.** Show/hide, reorder by drag (`@dnd-kit` is already a
dependency, used by the Kanban board), and resize. Persisted to `localStorage`
per tab, so each user's layout survives a reload. Reads are wrapped in
try/catch and fall back to the default layout.

**Virtualization.** Only visible rows render. This is what fixes the slowness:
today all ~1,335 school rows and ~1,498 contact rows mount at once and re-render
on every filter keystroke.

**Bulk-edit panel.** Appears when rows are selected. Tick-to-include controls
per D2 — Tags (multi-select, add and remove), Group (school chain dropdown from
`db.groups`), Designation, City, Owner. Shows the fan-out count from a
`dry_run: true` call before committing, then posts to `POST /crm/bulk-patch`.
Available on all three tabs; contacts currently have no bulk actions at all.

### Filter UI consolidation

The codebase has two independent filter UIs with separate state: the left filter
rail and `MultiFilterBar.js` (used on the leads list and contacts tabs). A lead
can currently be filtered twice by two different mechanisms. Adding a third
would compound the problem.

`MultiFilterBar` is retired. Its per-column facets are exactly what the grid's
filter row provides. The left filter rail is kept — it operates across all tabs
at once and provides the saved-facet overview the grid row cannot.

`lib/crmFilter.js` predicates are retained and registered as TanStack custom
filter functions, preserving the cross-entity roll-up behaviour where school and
contact rows match on their child leads' facets (`crmFilter.js:154-195`).

### Testing

- Filter test: two column filters active simultaneously narrow correctly (AND);
  two values in one multi-select widen correctly (OR).
- Sort correctness test: a date column sorts chronologically and a numeric
  column sorts numerically — both fail with the current implementation.
- Selection-across-filter test: select 40 rows, apply a filter hiding 12, assert
  the count badge reports 12 hidden and that a bulk action confirms the full
  selection explicitly.
- Virtualization test: render 5,000 synthetic rows and assert the DOM node count
  stays bounded.
- Column persistence test: hide a column, reload, assert it stays hidden; then
  simulate a `localStorage` throw and assert the default layout renders.
- Parity test per tab: the grid shows the same rows for a given filter state as
  the table it replaces.

## Rollout and rollback

Each sub-project is a separate deployable increment on `origin/main`, which
auto-deploys (VPS timer, ~1-2 min).

**A0** runs the migration before the code deploy. Rollback: the reverse
migration renames `tag_ids` back to `tags` on schools and leads. Because A0
unions rather than overwrites, no tag data is destroyed in either direction.
Take an Atlas snapshot before running it.

**A** is additive except for deleting the orphaned `/import/*` endpoints.
Rollback is a revert; no data migration is involved, and any records already
updated by an ID-matched import stay updated — which is the desired outcome.

**C** adds a new endpoint and rewrites four existing ones as wrappers. Rollback
is a revert. The wrappers preserve the existing request and response shapes, so
the frontend is unaffected by a revert in either direction.

**B** is frontend-only. Rollback is a revert plus a bundle rebuild. Per the
deploy notes, the bundle is committed, so a revert must include a rebuilt
bundle — build with `DISABLE_ESLINT_PLUGIN=true` and
`REACT_APP_BACKEND_URL=https://app.smartshape.in` set inline.

## Risks

**The tag migration touches live production data.** Mitigated by the union
approach (non-destructive), idempotency, an Atlas snapshot beforehand, and a
regression test that exercises the exact broken round-trip.

**Retiring `MultiFilterBar` changes a workflow people use.** Mitigated by the
grid's filter row covering every facet it exposed, and by the per-tab parity
test.

**`commit_row` is school-anchored and now takes a new parameter.** Its existing
caller `/mail-runs/import` must keep working; the parameter defaults to the
current behaviour (`allow_school_create=True`) so that path is unchanged, and
its tests run in the same suite.

**Two new frontend dependencies.** Both are headless and widely used. The
alternative — hand-rolling multi-column sort, a typed filter row and
virtualization — is more code to own permanently and more places to get subtly
wrong.

## Estimate

| Sub-project | Estimate |
|---|---|
| A0 tag canonicalisation | 0.5 day |
| A ID-based upsert | 1 day |
| C bulk patch | 1 day |
| B data grid | 2-3 days |
| **Total** | **4.5-5.5 days** |
