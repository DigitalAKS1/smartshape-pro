# Work Log — CRM Filter + Data-Integrity Program

**Branch:** `feat/crm-master-filter` (off `origin/main`) · **Worktree:** `F:/ss-crm-filter`
**Result:** 11 commits · 30 files · +3,615 / −129 · **141 tests pass** (59 backend + 82 frontend)
**Deployed:** No — awaiting owner go.

## 1. Diagnosis (read-only audits)
- **Dhruv (DB):** found the core "sync doesn't work" cause — a lead links to its person via two
  different fields (`contact_id` vs `converted_from_contact`) and the UI reads only one; plus missing
  unique indexes, dangling refs on contact delete, phone normalized in only 1 of 5 paths.
- **Arjun (import):** `9.17709E+11` = Excel sci-notation passed through verbatim (already lossy);
  blank IDs = engine had no Contact/Lead ID concept + ignored supplied School ID; `assigned_to` stored
  as a name, breaking ownership.

## 2. Shipped (built · reviewed · committed · tested)

| # | Commit | What | Owner asks |
| --- | --- | --- | --- |
| 1 | `1730f67` | Reassigning a school removes it from the previous owner (5 leak sites → one `_owner_clause`/`_owns`) | O2 |
| 2 | `a6ccf06` | Filter engine: Owner facet, source roll-up, `suggestFacets` | O3, O6 |
| 3 | `8272242` | Read-only blank-schools audit endpoint | O19 (investigate) |
| 4 | `fd0a430` | Zoho-Bigin left filter rail, searchable Owner picker, honest tab counts, global search, tag/city/source on all tabs | O1, O5, O10, O11, O14–O17 |
| 5 | `7a8de4e` | Import safety: text-safe phone, name→email Assign To, ID upsert, import/assigned dates | O7–O9, O12, O13 |
| 6 | `98ec531` | Guarded superadmin bulk-delete (dry-run, snapshot, delete-blank-childless) | O19, O20 |
| 7 | `6a9aec7` | Gmail-style search operators + date facets + sortable columns | O21, O8, O9 (Phase 3) |
| 8 | `afa47d6` | Superadmin Data-Cleanup UI (audit view + preview-first, type-DELETE confirm, delete-selected) | O19, O20 |

Docs: `f9e87b0`, `8a4b061`, `ee2ede7` — spec + consolidated program (O1–O21) + phased roadmap.

## 3. Tests
- Backend (pytest, mongomock, `smartshape_test`): 59 — ownership scoping (7), import safety (19),
  bulk-delete (7), blank-schools audit (3), + pre-existing.
- Frontend (jest): 82 — crmFilter engine, crmMasterFilter (Gmail parser + dates), FilterRail,
  SearchFacetSuggestions, DataCleanupPanel, BulkDeleteSchoolsDialog.

## 4. Not done — owner decisions
- **Deploy:** build bundle (`REACT_APP_BACKEND_URL` inline) + merge to `main`.
- **516 blank schools:** run audit on prod, then use the new UI to clean the junk.
- **Phase 4 (held):** unify link model, unique indexes, delete-cascade cleanup, phone repair —
  needs Atlas backup + staged sign-off. The `9.17709E+11` phones are unrecoverable → re-import.
- **Phase 5 (later):** dynamic master fields → auto in CRM forms/table/filter (O18).

Program detail: `docs/superpowers/specs/2026-07-10-crm-integrity-program.md`.
