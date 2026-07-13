# CRM Data-Integrity & Leads-UX Program

**Date:** 2026-07-10 · **Lead:** Vikram (CEO) · **Branch:** `feat/crm-master-filter`
**Status:** requirements + diagnosis captured; awaiting owner sequencing on prod-data items.

This is the living list. The owner adds here; nothing is dropped.

---

## Owner's requirements (verbatim intent)

| # | Ask | Workstream |
| --- | --- | --- |
| O1 | Filter Leads by **assigned user** (Owner / "Assign To") | B — Filter UX |
| O2 | Reassigning a school to another sales member **auto-removes it from the first** | ✅ DONE (`1730f67`) |
| O3 | Search a term (e.g. "Rohini") → **suggest facets** to add one-by-one (City, then Tag, then Owner…) | ✅ engine done (`a6ccf06`); UI pending |
| O4 | **Master filter** (applies to all tabs) + **detail filter** (per tab) | B — Filter UX |
| O5 | Honest counts — selecting City=Rohini with 1 school shows **1**, not 143 | B — Filter UX |
| O6 | Filter by **Tag** and by **Source** | B (engine done) |
| O7 | Import: **Assign To must carry an email id**; imported records must actually get assigned (name→email) | A — Import |
| O8 | Capture **Import Date** on records and expose it **as a filter** | A + B |
| O9 | Capture **Assigned Date**; **sort by** assigned date; **filter by** Assign To + assigned date | A + B |
| O10 | Filter UI must **look aligned / polished / expert**, visually **distinct from the search bar** | B — Filter UX |
| O11 | Be able to **search "Assign To"** inside the filter (owner picker is searchable, not a long chip wall) | B — Filter UX |
| O12 | Import: Contact ID / School ID / Lead ID come in **blank** — must round-trip & upsert by id | A — Import |
| O13 | Phone imported as `9.17709E+11` (Excel sci-notation) — must import **text-safe** | A — Import |
| O14 | Quality bar = **Zoho CRM / Zoho Bigin** — build like an expert CRM company | B — Filter UX |
| O15 | Filter area lives in a **left sidebar / filter rail**, NOT a top bar (Zoho-Bigin style) | B — Filter UX |
| O16 | Filter **search across all data** (global search feeds the filter, not just leads) | B — Filter UX |
| O17 | **Tag** filter is very important and must work in **Contacts and Schools** tabs too, not just Leads | B (master facet — covers it) |
| _…_ | _(owner to add more here)_ | |

---

## Diagnosis — root causes (read-only audit, cited)

### Dhruv (database) — linking & sync

- **D1 (CRITICAL):** two incompatible lead↔contact link models — `lead.contact_id` (create/import) vs
  `lead.converted_from_contact` (convert). `get_leads` reads only `converted_from_contact`
  (`crm_routes.py:2072,2095`); timeline reads only `contact.lead_id` (`:1713`). A New-Lead-form lead
  has a valid link nobody displays → "sync doesn't work."
- **D2 (CRITICAL):** deleting a contact never unsets `lead.contact_id` (`crm_routes.py:1620-1628`) →
  dangling ref, orphaned-looking lead.
- **D3 (HIGH):** no unique index on `leads.lead_id`; `schools.school_id` non-unique
  (`database.py:72`). Only `contacts.contact_id` is unique (`:61`). Restores/re-seeds can duplicate ids.
- **D4 (HIGH):** `import_leads_csv` dedups schools by bare phone (`crm_routes.py:2920`), skips
  `_upsert_lead_contact`, sets `assigned_to=""` → leads land under wrong school, unowned, contact-less.
- **D5 (HIGH):** school soft-delete doesn't cascade to children (`crm_routes.py:1061-1067`).
- **D6 (HIGH):** phone normalized only inside `_upsert_lead_contact` (`_norm_phone`,
  `crm_routes.py:2146`); 4 other match paths use raw equality.
- **D7 (MED):** non-atomic cascades (`_assign_school_cascade` per-doc loop `:923`) — crash = split-brain.
- **D8 (MED):** School-360 joins by `school_name` (`:1219-1225`) — rename-fragile, duplicate-name bleed.
- **D9–D11 (MED):** convert path skips FK-validate + dedup; leads allowed with no school; blank-phone
  contacts never dedup.

### Arjun (backend) — Import Center

- **A-B (Bug B, phone):** CSV parser stores cell text verbatim (`import_engine.py:66`); xlsx path
  emits `.0`/sci-notation for floats (`:46`). No phone normalization anywhere. `9.17709E+11` rows are
  **already lossy — unrecoverable from the CSV**.
- **A-A (Bug A, ids):** no `contact_id`/`lead_id` keys in the engine or `SEED_FIELDS`
  (`field_registry.py:30-59`); supplied `school_id` ignored on create (`import_engine.py:264`); UI
  hardcodes `create_leads:false` (`ImportCenter.js:113`) so no lead/Lead-ID ever created.
- **A-assign:** `assigned_to` stored raw from the cell (`import_engine.py:261,275,330`) — a name, not an
  email → breaks scoping (this is O7).
- **A-others:** >1000 rows silently truncated (`dynamic_import_routes.py:119,123`); per-row errors
  swallowed to a count (`:164-172`); numeric/date fields stored as strings; import-created schools skip
  baseline fields.

---

## Program plan

### Workstream B — Leads Filter UX  (safe, additive, do now)
Answers O1, O3, O4, O5, O6, O8(filter), O9(sort+filter), O10, O11, O14, O15, O16, O17.

**Design bar = Zoho Bigin / Zoho CRM (O14).** Left **filter rail** (collapsible sidebar), NOT a top
bar (O15). Facet groups stacked vertically with counts; Owner group is a **searchable picker** (O11);
Tag/City/Source/Stage/Owner/Type all live in the rail and apply across **every** tab (O17).

- **B1** ✅ Filter engine (Owner facet, source roll-up, `suggestFacets`) — `a6ccf06`, 17 tests.
- **B2** `FilterRail` component (left sidebar, Bigin-style): collapsible; vertical facet groups each
  with live counts; searchable Owner picker (O11); "clear all"; `N of M` honest count header (O5, O10).
  Distinct visual treatment from the top search bar (O10).
- **B3** Wire master filter into `useLeadsCRM` (`masterFilter` + `masterFiltered` memo) so **every tab
  badge and ForecastBar obey it** (O5), across schools/contacts/leads (O17). Detail facets per tab.
- **B4** Top search box → global match across all entities (O16) + live facet suggestions from
  `suggestFacets` that drop into the rail as chips (O3).
- **B5** Add **Import Date** + **Assigned Date** as rail facets and **sortable** columns (O8, O9) —
  depends on the fields existing (A4 below).

### Workstream A — Data integrity  (mixed risk — split by safety)

**A-safe (additive, no prod migration — proceed after owner nod):**
- **A1** Import text-safety: coerce integral numerics `str(int(v))`, ISO dates, treat phone/id columns
  as text; warn on sci-notation CSV values (O13).
- **A2** `normalize_phone()` written once, stored as `phone_norm`, used by every dedup path (D6, O13).
- **A3** Import `assigned_to` **name→email** resolution (reuse the CSV importer's resolver) (O7, D4).
- **A4** New fields **`import_date`** (set at import) and **`assigned_date`** (set whenever
  `assigned_to` changes, incl. cascade/reassign) (O8, O9). Additive; legacy rows blank.
- **A5** Import **id round-trip + upsert** by precedence id → name+city → phone for all 3 entities;
  honor a well-formed supplied id on create (O12, A-A).
- **A6** Import **dry-run + per-row error report**; stop silent >1000-row truncation (A-others).

**A-risky (touches existing prod data — needs owner OK + fresh Atlas backup, staged):**
- **A7** Unify link model to canonical `lead.contact_id ⇄ contact.lead_id`; migrate
  `converted_from_contact`; read one field everywhere (D1). _Migration._
- **A8** Referential cleanup on delete: contact-delete repoints `lead.contact_id`; school soft-delete
  handles children (D2, D5).
- **A9** De-dup existing `school_id`/`lead_id`, then add **unique indexes** (D3). _De-dup first._
- **A10** One-time backfill of `school_id` FKs, then drop name-fallback joins in School-360 (D8).
- **A11** Repair phone data: strip recoverable (`.0`, spaces, `+91`); flag unrecoverable sci-notation
  rows for re-import from source (O13). _Read-only detect first; repair on a snapshot._

---

## Decisions needed from owner

1. **Sequencing:** ship Workstream B (visible filter UX) first, or the A-safe import fixes first?
2. **Prod-data items (A7–A11):** these need a fresh backup and staged rollout. Approve now, or hold
   until B + A-safe are live?
3. **Phone repair (A11):** confirm you understand the `9.17709E+11` rows are partially unrecoverable
   and will need re-import from the original source for the lost digits.
