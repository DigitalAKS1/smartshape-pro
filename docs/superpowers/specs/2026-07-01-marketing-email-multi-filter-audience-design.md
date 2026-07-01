# Multi-Filter Email Campaign Audience Builder — Design

**Date:** 2026-07-01
**Area:** Marketing Hub → Email Campaigns (`/marketing`)
**Status:** Approved (brainstorming) — ready for implementation plan

## Problem

Email campaign recipient selection currently supports **one audience mode at a time**
(radio choice): *All*, *By Designation*, *By Tags*, *By Lead Stage*, *By School
Attributes*, *Hand-pick*, or *Non-purchasers*. The backend resolver
[`_resolve_audience()`](../../../backend/routes/email_routes.py) **early-exits on the
first populated filter**, so filters cannot be combined.

The owner needs to target the intersection of several attributes at once — e.g.
**Source = X AND Stage = Demo AND Designation = Art Teacher AND School Strength ≥ 600** —
and wants the builder designed as a reusable component so the same multi-filter pattern
can later be dropped onto other lists.

## Goals

- Combine multiple filters on one email campaign audience: **AND across facets, OR within
  a facet** (multiple values in one facet match any).
- Facets, all optional and AND-combined: **Source, Stage, Designation/Role, School
  Strength, School Type, City, Tags.**
- Live **recipient count preview** while building the filter.
- Ship as a reusable `<AudienceFilterBuilder>` component (rollout to other screens is a
  fast-follow, not this project).
- Preserve today's behavior for existing campaigns and for the two special modes
  (**Hand-pick**, **Non-purchasers**), which stay standalone.

## Non-goals (v1 — fast-follow)

- Saved/named reusable segments (save a filter combo and reuse it).
- Rolling the component onto CRM Leads / Contacts / other lists.
- Board filter, max-strength range (can add if trivial during build; not required).

## Decisions (locked in brainstorming)

| Decision | Choice |
|---|---|
| Combination logic | **AND across facets, OR within a facet** |
| Stage → recipient mapping | **School-level**: include any matching contact whose **school** has a lead in the selected stage(s) |
| Facet set | All existing filters **+ Source**, made combinable; Hand-pick & Non-purchasers stay separate modes |
| Saved segments | **Deferred** to fast-follow |
| Recipient identity | `contacts` (must have a valid `email`) |

## Data model (existing — no migration)

- **contacts** — recipient. Fields: `contact_id`, `email`, `designation`,
  `contact_role_id`, `source` (free text), `tag_ids[]`, `school_id`, `is_deleted`.
- **leads** — `stage`, `school_id`, `converted_from_contact`, `is_deleted`. Stages:
  `new, contacted, demo, negotiation, quoted, follow_up, won, lost` (+ `retention, resell`).
- **schools** — `school_id`, `school_type`, `school_strength` (int), `city`.
- **contact_roles** — `role_id`, `name` (e.g. "Art Teacher"), `is_active`.
- **tags** — `tag_id`, `name`, `color`. **sources** — `source_id`, `name` (master list;
  `contacts.source` is free text and not FK-enforced).

Joins: `contacts.school_id → schools.school_id`; stage reached via
`leads.school_id → schools`/`contacts.school_id`.

## Backend contract

`audience_filter` object (all keys optional; a missing/empty key = facet ignored):

```json
{
  "match": "all",
  "sources":      ["LinkedIn", "Referral"],
  "lead_stages":  ["demo", "negotiation"],
  "roles":        ["Art Teacher"],
  "min_strength": 600,
  "max_strength": null,
  "school_types": ["CBSE"],
  "cities":       ["Delhi"],
  "tags":         ["tag_id_1"]
}
```

Backward compatibility: existing stored filters contain a single key
(e.g. `{"lead_stages": [...]}`) — under the new AND-combine resolver, a single populated
facet resolves exactly as before. The special modes keep their existing shapes
(`{"contact_ids": [...]}`, `{"not_purchased": true}`) and are handled first, unchanged.

## Resolver algorithm (`_resolve_audience` rewrite)

Approach: **per-facet resolution intersected in Python** (chosen over a `$lookup`
aggregation or a denormalized view for clarity/testability at this data size).

1. **Special modes first (unchanged):** if `contact_ids` present → return those contacts;
   if `not_purchased` → existing funnel logic. These do not combine with the builder.
2. **Base:** `base = {is_deleted: {$ne: true}}` over `contacts`.
3. **School-level facets → one `school_id` set (AND):**
   - `school_q` from `school_types` / `min_strength` / `max_strength` / `cities`; query
     `schools` → `S_attrs` (set of school_ids). Skip if none of these facets set.
   - `lead_stages`: query `leads` with `{stage: {$in: stages}}` → their `school_id`s →
     `S_stage`. Skip if not set.
   - `school_ids = intersection(present school-level sets)`. If any present school-level
     set is empty → **return []** (AND can't be satisfied).
   - If any school-level facet present, add `school_id: {$in: school_ids}` to `base`.
4. **Contact-level facets (AND, applied to the `contacts` query):**
   - `sources`: `source: {$in: sources}` (case-insensitive; see note).
   - `tags`: `tag_ids: {$in: tags}`.
   - `roles`: match `contact_role_id ∈ role_ids` **OR** `designation` (lower) ∈ role
     names (lower) — resolved from `contact_roles`. Because this is an OR over two fields,
     apply it as a post-filter in Python (as today) rather than a single Mongo clause.
5. Run the `contacts` query, apply the role post-filter, **dedup by `contact_id`**, drop
   contacts without a valid email at send time (launch already validates email).
6. **No facets and no special mode → all contacts** (current default).

Notes:
- **Source** is matched with `$in` against **distinct existing `contacts.source` values**
  supplied by the options endpoint, so the picklist values match stored values exactly
  (no case normalization needed). "OR within" = `$in`.
- OR-within is native for `$in` facets; AND-across is the intersection of the resulting
  contact sets / the compounded `contacts` query.
- `match` is always `"all"` in v1 (AND-across). The key is reserved so a future
  per-facet AND/OR toggle can extend the contract without breaking it.

## Preview endpoint

`POST /email/audience/preview` — body `{ audience_filter }` → `{ count, sample_names[] }`
(first ~5 names). Admin-gated like other email endpoints. Runs the same
`_resolve_audience` used at launch, so the preview equals the send. Failures are
non-fatal in the UI (show "count unavailable"); launch still re-resolves authoritatively.

Also add `GET /email/audience/options` → distinct `sources`, active `roles`, `school_types`,
`cities`, `tags`, and the stage list — so the builder's picklists are data-driven.

## Frontend

Reusable **`<AudienceFilterBuilder value onChange>`** emitting an `audience_filter` object,
used inside `EmailHubTab.js`'s campaign form.

- **Mode switch** at top: **Filter builder** (default) · **Hand-pick** · **Non-purchasers**
  (mutually exclusive; the latter two render today's controls unchanged).
- **Filter builder**: a vertical stack of optional facet rows —
  - Source (multi-select chips, from options endpoint)
  - Stage (multi-select chips: 8 stages)
  - Designation / Role (multi-select chips, from roles)
  - School Strength (numeric "min" input; optional "max")
  - School Type (multi-select chips)
  - City (multi-select chips)
  - Tags (multi-select chips, colored)
  - **Live recipient-count chip** ("~124 recipients", debounced preview call) + **Clear all**.
- Reuses existing chip/token styling from `ContactsTab`/`QuotationFilters`.

## Error handling

- Preview debounce ~400ms; ignore stale responses; on error show "count unavailable" but
  keep the form usable.
- Launch path unchanged: re-resolves audience server-side; if 0 recipients, block launch
  with a clear message.
- Empty builder (no facets) behaves as "All contacts" with a visible warning count.

## Testing (Vivek — `DB_NAME=*_test`, never live DB)

Backend unit tests for `_resolve_audience`:
- The owner's example: `sources + lead_stages=[demo] + roles=[Art Teacher] + min_strength=600`
  returns exactly the intersection.
- OR-within: two sources / two stages match either.
- AND-across: adding a facet only ever narrows the set.
- School-level stage join: a non-lead contact at a demo-stage school is included; a
  contact at a non-matching school is excluded.
- Empty facets → all contacts; one empty school-level set → [].
- Missing email excluded at launch.
- Backward-compat: a legacy single-key filter resolves as before.

Frontend: builder emits correct `audience_filter`; preview count renders; mode switch
isolates special modes.

## Acceptance criteria

1. In `/marketing` → Email → New Campaign, I can set Source + Stage + Designation +
   School Strength (and Type/City/Tags) **together**, and the audience is the AND-combined,
   OR-within intersection.
2. A live recipient count updates as I change filters and equals the number actually sent.
3. Existing campaigns and the Hand-pick / Non-purchasers modes are unaffected.
4. The builder is a standalone reusable component.
5. Resolver unit tests (incl. the owner's example) pass against a test DB.
