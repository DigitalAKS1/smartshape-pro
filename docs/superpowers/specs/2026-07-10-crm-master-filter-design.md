# CRM Master Filter + Ownership Scoping — Design

**Date:** 2026-07-10
**Branch:** `feat/crm-master-filter` (cut from `origin/main` @ 5d99831)
**Worktree:** `F:/ss-crm-filter`

## Problem

Three defects on `/leads` (`pages/admin/LeadsCRM.js`), reported together:

1. **Counts lie.** The tab badge renders `Leads (${crm.filteredLeads.length})` (`LeadsCRM.js:295`).
   `filteredLeads` (`useLeadsCRM.js:694`) applies only search + type + tag. The `MultiFilterBar`
   filter is applied later, inside the list view (`LeadsCRM.js:348`). Selecting `City = Rohini`
   with one school there leaves the badge reading `143`.

2. **Reassignment does not remove the previous owner.** `_assign_school_cascade`
   (`crm_routes.py:869`) correctly overwrites `assigned_to` on the school, its contacts and its
   leads. But sales scoping is `assigned_to == me OR created_by == me`, so whoever *created* a
   record keeps read **and mutate** access forever, regardless of who it is assigned to.

3. **No owner facet, and search does not narrow.** `deriveFilterOptions` (`crmFilter.js:12`)
   derives sources, roles, school_types, cities, tags and stages — no owners. `searchTerm` matches
   only `company_name`, `contact_name`, `contact_phone`, `school_city`, and only against leads,
   so typing `Rohini` narrows neither the Schools nor the Contacts tab.

## Decisions

| Decision | Choice | Rejected |
| --- | --- | --- |
| Filter logic | AND across facets, OR within a facet (implicit) | Nested boolean group builder; per-facet `is not` |
| Ownership rule | `assigned_to == me` OR (`assigned_to` blank AND `created_by == me`) | `assigned_to` only (orphans blank rows); `excluded_owners` lockout field (8 writers, drifts) |
| Filter scope | Master bar above tabs + optional per-tab detail bar | Per-tab only; master only |
| Branch | New branch off `origin/main` | Building on `feat/module-rbac` (140 behind main, missing files) |

### Why not `excluded_owners`

It agrees with the fallback rule on every scenario the user described, and diverges on exactly one
— a record created by A but assigned to B from day one, where it leaks to A. It also requires a
denormalized permission field maintained by eight ownership-write paths (`assign_school`,
`bulk_assign_schools`, `_assign_school_cascade`, `_claim_unassigned_cascade`, `reassign_lead`,
`bulk_assign_leads`, `auto_assign_leads`, CSV owner-sync). Any writer that forgets it silently
restores read+mutate access to a former owner.

## Part A — Filter architecture (frontend)

### Two tiers, one state

`masterFilter` lives in `useLeadsCRM` and applies to schools, contacts and leads alike.
Each tab may layer a `detailFilter` on top.

- **Master facets:** Owner, City, School Type, Source, Stage, Tag
- **Detail facets:** Lead type + School strength (Leads/Pipeline), Designation (Contacts),
  School strength (Schools)

### Cross-entity resolution rule

A school row has no `source`; a lead row has no `city`. One rule covers every master facet:

> Match the row's own field if it has one; otherwise roll up through its school.

- `City` on a lead → `schoolsById[lead.school_id].city`
- `Source` on a school → matches if **any** lead or contact under that school has that source
- `Stage` on a school → already implemented this way via `leadsBySchoolId`

`buildCrmContext` gains `contactsBySchoolId` and the rule is generalized across facets.

`Owner` resolves against `row.assigned_to` on all three entity types. A sentinel option
`__unassigned__` matches rows whose `assigned_to` is blank, absent, or `null`.

### Honest counts

`useLeadsCRM` computes `masterFiltered = { schools, contacts, leads }` once in a `useMemo`.
Tab badges and `ForecastBar` read from it. Detail filters apply inside the tab, and the filter
bar reads `12 of 143` instead of the current bare `12 shown`.

Consequence: `City = Rohini` with one school there makes the badge read `Schools (1)`.

### Search as a master facet, with suggestions

1. `searchTerm` filters all three entity types, not just leads.
2. New pure function `suggestFacets(term, options, rows)` scans derived facet options for name
   matches and returns them ranked, each with a live count computed against the currently
   master-filtered set.

```
Search: [ Rohini                    ]
  Add filter:  [ City: Rohini · 1 ]  [ Tag: Rohini Zone · 4 ]
```

Clicking a suggestion adds it as a chip to the master bar and clears the search box. Ignoring it
leaves `Rohini` working as free-text search. Chips stack one at a time, AND-ed together.

### Files

| File | Change |
| --- | --- |
| `frontend/src/lib/crmFilter.js` | `owners` facet, `__unassigned__` sentinel, roll-up resolution, `suggestFacets`, `contactsBySchoolId` in `buildCrmContext` |
| `frontend/src/components/crm/MasterFilterBar.js` | **new** — chips + suggestions + `N of M` count |
| `frontend/src/components/crm/MultiFilterBar.js` | becomes the per-tab detail bar |
| `frontend/src/hooks/useLeadsCRM.js` | `masterFilter` state, `masterFiltered` memo, search across all three types |
| `frontend/src/pages/admin/LeadsCRM.js` | badges + `ForecastBar` read `masterFiltered`; mount `MasterFilterBar` |

Owner options come from `spList` (salespersons; each has `email` + `name`), already fetched by the
hook. No new API.

## Part B — Ownership scoping (backend)

### The five leak sites

| # | Location | Guards |
| --- | --- | --- |
| 1 | `crm_routes.py:761` `_owned_school_ids` | lead scoping + `_user_can_mutate_lead` |
| 2 | `crm_routes.py:821` `_user_can_access_school` | school profile reads |
| 3 | `crm_routes.py:861` `_user_can_mutate_contact` | the 5 contact call/follow-up endpoints |
| 4 | `crm_routes.py:1130` `GET /schools` | Schools list |
| 5 | `crm_routes.py:1597` `GET /contacts` | Contacts list |

`GET /leads` (`crm_routes.py:2229`) has no `created_by` clause of its own, but calls
`_owned_school_ids`, so it inherits the leak from site 1. That is why a reassigned school's leads
stay visible to the old owner.

### One predicate, expressed twice

```python
def _owner_clause(email: str) -> dict:
    """Sales ownership: assigned to me, or created by me while still unassigned."""
    return {"$or": [
        {"assigned_to": email},
        {"$and": [
            {"created_by": email},
            {"$or": [{"assigned_to": {"$in": ["", None]}},
                     {"assigned_to": {"$exists": False}}]},
        ]},
    ]}


def _owns(doc: dict, email: str) -> bool:
    """In-memory mirror of _owner_clause, for the guard functions."""
    if doc.get("assigned_to") == email:
        return True
    return doc.get("created_by") == email and not (doc.get("assigned_to") or "")
```

Sites 1, 4, 5 use `_owner_clause`. Sites 2, 3 use `_owns`. Sites 4 and 5 currently build their own
`$or` containing an extra school-link clause; those flatten to
`{"$or": [*_owner_clause(email)["$or"], link_clause]}` so ownership keeps exactly one definition.

### Not changing

`_assign_school_cascade` is already correct. No new field, no migration, no backfill:
`create_school` (`crm_routes.py:948`) and `create_contact` (`crm_routes.py:1144`) already stamp
`assigned_to = user["email"]` for sales users, so self-created records are self-assigned and keep
working. An admin-created school is left unassigned and stays admin-only until assigned, which is
the behaviour today.

## Behaviour after the change

| Scenario | Result |
| --- | --- |
| Amit creates a school, auto-assigned to Amit | Amit sees it |
| Amit creates a school, never assigned to anyone | Amit sees it |
| Amit creates a school, admin reassigns it to Parul | Parul sees it; **Amit does not** |
| Admin reassigns the school | Amit loses its contacts and leads too, via the cascade |
| Admin / accounts / store | unchanged (all / none / none) |

## Testing

**Backend** (`pytest`, `backend/tests` — committed on `main`):

- creator loses read access after reassign (`GET /schools`, `GET /contacts`, `GET /leads`)
- creator loses **mutate** access after reassign (`_user_can_mutate_lead`, `_user_can_mutate_contact`)
- creator keeps access while `assigned_to` is blank / absent / `null`
- assignee gains read + mutate
- admin sees all; accounts and store see none
- `_owns` agrees with `_owner_clause` on the same fixture set

**Frontend** (`jest`, extends `frontend/src/lib/__tests__/crmFilter.test.js`):

- `owners` facet matches on `assigned_to`; `__unassigned__` matches blank/absent/null
- roll-up: `City` on a lead resolves via its school; `Source` on a school via its children
- AND across facets, OR within a facet (regression — existing 8 tests must still pass)
- `suggestFacets` ranking, live counts, and no suggestion for an already-applied facet
- `masterFiltered` drives tab badges (component test on `LeadsCRM`)

## Out of scope

- Nested boolean groups / `is not` negation
- Saved filter views, URL-persisted filters
- Server-side filtering or pagination (all filtering stays client-side, as today)
- Backfilling `assigned_to` on legacy blank rows — the fallback rule makes it unnecessary

## Deployment note

`frontend/.env.production` is gitignored and absent from this worktree. Any production build made
here **must** pass `REACT_APP_BACKEND_URL=https://app.smartshape.in` inline, or the bundle bakes in
`undefined` and the app fetches `index.html` instead of the API. Do not run `git add -A` in this
worktree.
