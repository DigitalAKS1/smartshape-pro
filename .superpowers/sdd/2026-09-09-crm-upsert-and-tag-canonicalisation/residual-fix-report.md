# Residual review fix report

Branch `feat/crm-grid-upsert`, starting HEAD `d40dadc`. Two commits added, one
per item.

```
d40dadc  (start)
2f44559  fix(import): never reuse a deleted contact's id on create            [item 1]
429c8e4  test(import): pin unknown-school contacts-only behaviour; surfaces a real bug  [item 2]
```

Final HEAD: `429c8e4`.

---

## Item 1 (data integrity) — supplied `contact_id` collides with a deleted contact

**Fixed.**

In `backend/import_engine.py`, `commit_row`'s contact-create branch (around
line 677): a supplied `contact_id` that matches no LIVE contact (every
matcher above correctly excludes `is_deleted`) used to be reused verbatim —
`cid = supplied_cid or f"con_{...}"` — even when that id belonged to a
soft-deleted document. That either 500s with a raw `E11000` (the unique index
on `contacts.contact_id`, `database.py:61`, when it exists in the
environment) or, when the index is missing, leaves two live documents
silently sharing one `contact_id`.

**Chose (a): mint a fresh `con_<hex>` id and create the contact normally** —
not (b) skip the row. Reasoning, from reading how the rest of the file treats
similar situations:

- The file's own comments and existing skip paths (`needs_review` without a
  supplied id, `authorize_contact` returning `False`) reserve "skip" for rows
  that are genuinely ambiguous or genuinely not the importing user's to
  touch. Here the row is neither: it carries real identifying data (name/
  phone) for a real, importable contact — the only problem is that one
  historical id happens to be spoken for by a dead record.
- Skipping would be a *permanent* failure for that row: every future
  re-upload of the same export would supply the same stale id and skip again
  forever, with no way for the owner to fix it short of hand-editing the CSV.
  That contradicts the file's stated bias against silently stranding data
  (see the `needs_review`→`skip_school` downgrade comment at lines 550-558:
  "aborting the whole row would silently strand every contact...").
- Minting a fresh id is self-healing: on this import the row still creates
  a normal live contact (with a new id and a warning noting the collision);
  on the *next* re-import of the same file, the stale id in the CSV matches
  nothing (dead or alive), so the row falls through to the
  name+phone_norm / phone_norm / name fallback matchers and correctly
  updates the contact it created last time. No repeated failure.
- It also can never 500 or produce a Mongo-arbitrary duplicate: the new id
  is freshly minted (`uuid4().hex`), so by construction nothing else holds
  it.

The check itself: after the matchers find no live doc for `supplied_cid`, a
direct `find_one({"contact_id": supplied_cid})` (no `is_deleted` filter — if
this returns anything at all, it must be the deleted one, since any live doc
sharing that id would already have been picked up by the id matcher above)
detects the collision, appends a warning, and mints
`con_{uuid4().hex[:12]}` instead of reusing the supplied id.

Test added in `backend/tests/test_contacts_import_upsert.py`:
`test_supplied_contact_id_colliding_with_deleted_contact_mints_new_id` —
seeds a soft-deleted contact holding `contact_id="con_reused"`, imports a row
for a different person carrying that same `contact_id`, and asserts:
`contact_action == "create"`; the resulting `contact_id` is **not**
`"con_reused"`; a warning naming the collision is present; the deleted
document is left completely untouched (still the only doc holding the old
id, still `is_deleted: True`); and exactly one **live** document holds
whatever id the new contact actually got.

---

## Item 2 (test-only) — unknown-school contacts-only behaviour

**Tests added; one of them surfaced a real, unfixed bug.**

Two tests added to `backend/tests/test_contacts_import_upsert.py`:

1. `test_contacts_only_row_with_unknown_school_name_creates_no_school` —
   **passes.** Pins the intended behaviour: with `allow_school_create=False`,
   a row naming a school that does not exist in the DB resolves
   (`resolve_school` returns `action="create"`, distinct from the
   no-school-identity-at-all `skip_school` case already covered by
   `test_contacts_only_row_creates_no_school`) but mints nothing —
   `db.schools.count_documents({}) == 0` and the contact is created with
   `school_id` left `None`.

2. `test_unknown_school_contact_does_not_merge_into_unrelated_same_name_contact`
   — **written with the correct/safe assertion, and it fails.** Marked
   `@pytest.mark.xfail(strict=True, reason=...)` so it pins the bug as a
   documented, expected failure rather than either silently skipping it or
   weakening the assertion to match the broken behaviour (`strict=True`
   means this test would also fail the suite the day someone "fixes" it
   without actually fixing the root cause, or the day it's genuinely fixed —
   at which point the marker should be removed).

### The bug

Constructed deliberately, per the task: seed a school-less contact named
`"Common Name"` (phone `9111111111`, no `school_id` key on the document at
all — never linked to any school). Import a *different* row, also named
`"Common Name"` (phone `9222222222`), naming an unknown school. Ran it
directly against `commit_row` (isolated repro, `mongomock_motor`) before
writing the test, output:

```
res: {'action': 'create', 'school_id': None, 'contact_id': 'con_existing_common',
      'lead_id': None, 'warnings': [], 'contact_action': 'update'}
contact count: 1
{'contact_id': 'con_existing_common', 'name': 'Common Name',
 'phone': '9222222222', 'designation': 'Existing Person', 'is_deleted': False,
 'phone_norm': '9222222222', 'import_date': '...'}
```

One contact, not two. The pre-existing, unrelated `"Existing Person"`'s own
phone number was silently overwritten with the new row's phone
(`9111111111` → `9222222222`).

**Root cause**: when `allow_school_create=False` and the named school is
unknown, `sid` resolves to `None` (school-resolution still runs and returns
`action="create"`, but the write is suppressed — this part is correct, see
item 2's first test). The contact matchers then query with that `None`:

```python
existing = await db.contacts.find_one({"school_id": sid, "name": contact_name, **_not_deleted})
```

In MongoDB, `{"school_id": None}` matches documents where `school_id` is
explicitly `null` **and** documents where the field is missing entirely —
which is exactly the state of any contact that predates a `school_id`
column, or any contact created by this very code path on a prior import. So
two completely unrelated real people who happen to share a name, and who
both end up "school-less" for unrelated reasons, silently merge into one
contact document, with whichever row is imported second overwriting the
first person's data.

This is a straightforward, plausible **live-data-corruption** path in normal
use (common names — teachers, admin staff — recur across unrelated schools,
and the whole point of `allow_school_create=False` is that contacts-only
imports routinely leave rows school-less). It is **not fixed here** — item 2
was scoped as test-only, and this is a genuine design bug in the fallback
matchers, not a one-line patch: it likely needs the `None`-school case to
either be excluded from the name-only/phone-only fallback matchers entirely
(only ever match by contact_id or phone when there's no school to disambiguate
by) or to use an explicit `{"$in": [None]}` vs `{"$exists": false}` split
depending on what "school-less" is actually supposed to mean for dedup
purposes. That decision needs product input (is a school-less contact
matchable by name alone at all?) and is out of scope for this fix pass.

**Flagging this explicitly per the task instructions: do not treat the
xfail test as resolving the bug. It is open and unfixed.**

---

## Tests

Ran exactly the command specified, foreground, named files only:

```
cd backend && DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 \
  python -m pytest tests/test_contacts_import_route.py tests/test_contacts_import_upsert.py \
  tests/test_import_blank_safety.py tests/test_master_import_e2e.py \
  tests/test_import_resolve.py -q
```

Result: **53 passed, 1 xfailed**, 0 failed, exit code 0. The `xfailed` is
`test_unknown_school_contact_does_not_merge_into_unrelated_same_name_contact`
(expected — see Item 2 above). `test_contacts_import_upsert.py` alone was
also run standalone (20 tests before item 2, 22 after item 1) and passed
cleanly at every step.

No production DB was touched: every invocation used the explicit
`DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017` prefix, and the
new/changed tests all run against `mongomock_motor`, never a real Mongo
connection.

---

## Follow-up 2026-09-10 — Item 2 bug actually fixed

The item 2 bug flagged above ("not fixed here... needs product input") has
now been resolved per an explicit ruling: **when `sid` is `None`, only a
supplied `contact_id` may match an existing contact — matchers 2-5
(name+phone_norm / phone_norm / phone / name, all school-scoped) never run
without a real school id.** A row without a `contact_id` and without a
resolvable school always creates a new contact; it never falls back to
matching by name or phone alone. This picks option (a) from the two floated
above (exclude the `None`-school case from the fallback matchers entirely),
not the `$exists`-split alternative — simpler, and it matches the ruling's
own reasoning: a duplicate contact is visible in the UI and mergeable later,
so it's the acceptable failure mode; a silent merge of two real people is not
recoverable at all.

`backend/import_engine.py`, `commit_row`, contact-matching block (~line
620): matchers 2-5 are now wrapped in `if sid is not None:`, with a comment
explaining the Mongo `{"school_id": None}` null-vs-missing hazard and why
real people sharing a name makes the fallback unsafe without school context.
Matcher 1 (`contact_id`) is unchanged and sits outside the guard, so it still
matches regardless of `sid`.

`backend/tests/test_contacts_import_upsert.py`:
- `test_unknown_school_contact_does_not_merge_into_unrelated_same_name_contact`
  — `xfail(strict=True)` marker removed. It is now a normal test and passes
  on its own merits (no assertions were softened).
- `test_unknown_school_row_with_contact_id_still_updates_by_id` — new. Proves
  the round-trip case that matters most: a contacts-only row that supplies a
  `contact_id` but names an unresolvable school must still match and UPDATE
  the existing contact (not fall through to create), i.e. that disabling the
  name/phone fallbacks did not also disable the id path.

Ran the full named suite specified for this fix (foreground, explicit
`DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017` prefix, no
bare `pytest tests/`):

```
cd backend && DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 \
  python -m pytest tests/test_contacts_import_upsert.py \
  tests/test_contacts_import_route.py tests/test_import_blank_safety.py \
  tests/test_master_import_e2e.py tests/test_import_resolve.py \
  tests/test_tag_canonicalisation.py -q
```

Result: **66 passed**, 0 failed, 0 xfailed, exit code 0 — includes the
blank-safety, tag-canonicalisation, soft-delete, deleted-id-collision, and
both master-import (`allow_school_create=True`) suites, all unaffected by
the change (the guard only ever removes matches, and only on the
`allow_school_create=False` path with an unresolved school; master-import
always resolves or creates a school and so never sees `sid is None` here).

No production DB was touched at any point.

---

## Follow-up 2026-09-10 — `source` column silently dropped by the shared import_engine

**Fixed.** Starting HEAD `78715ad`.

The contacts CSV import was recently repointed from a bespoke handler onto
the shared `import_engine`. The old handler read the CSV's `source` column
directly (`"source": row.get("source", "").strip()`); `import_engine`'s
field registry (`backend/field_registry.py`, `SEED_FIELDS`) had **no
`source` entry**, so `propose_mapping` reported that column `key=None,
confidence=none` and it was silently dropped on every import. New contacts
created via the engine got a hardcoded `"source": "import"` regardless of
what the CSV actually said, and an existing contact's `source` could no
longer be corrected by editing the export.

**Fix**: added one entry to `SEED_FIELDS` in `backend/field_registry.py`,
placed in the Contact group right after `anniversary` and before `notes`:

```python
("source", "Source", "contact", "text", "source", "Contact",
 ["source", "lead source", "contact source"]),
```

Same 7-tuple shape as its neighbours; `entity="contact"`, `maps_to="source"`
(the contact's own native `source` column), `key="source"` (what
`propose_mapping` returns as the mapped key). `is_core` is not part of the
tuple — `_doc()` hardcodes `is_core=True` for every `SEED_FIELDS` entry, so
the new field reconciles its aliases on every `seed_field_definitions()`
call exactly like its siblings; a live deployment picks it up on next
startup with no manual migration.

No other code change was needed. `import_engine.split_values()` already
routes any keyed field with a `maps_to` straight onto the entity's native
column via the module-level `_CORE`/`_FIELD_TYPE` maps built from
`SEED_FIELDS` — adding the registry entry alone makes a mapped `source`
value flow into `commit_row`'s `cvals`/`cdoc`. Two behaviours fell out for
free, verified by test rather than assumed:
- **create**: `commit_row`'s create-branch dict literal sets a hardcoded
  `"source": "import"` *before* `**cdoc`; because `**cdoc` is spread last in
  that same literal, a non-blank `source` cell (now present in `cdoc` via
  `cvals`) overrides the hardcoded default, and a blank cell (stripped by
  `_strip_blanks`) leaves `"import"` as the default for a brand-new contact
  with no source info.
- **update**: `cdoc` is built from `_strip_blanks(parts["contact"])`, so a
  blank `source` cell is simply absent from the `$set` — the branch's
  existing "blank never clears" rule applies to `source` automatically,
  same as it already does for `notes`/`designation`/etc.

**Alias choice — checked for collisions before committing.** The registry
already has a `school_name` entry whose aliases include the short word
`company`, and several other short aliases (`board`, `type`, `strength`,
etc.), so a broad `source` alias risked capturing an unrelated column at the
0.78 fuzzy threshold. Kept it conservative — `["source", "lead source",
"contact source"]` — and verified empirically with a standalone script that
reimplements `normalize_header` + the exact-match/fuzzy-match logic from
`propose_mapping` (no DB needed) against the registry plus the new entry,
run over the real export header row:

```
contact_id  -> CONTROL  (high)
name        -> name  (high)
phone       -> phone  (high)
email       -> email  (high)
company     -> school_name  (high)
school_id   -> CONTROL  (high)
designation -> designation  (high)
source      -> source  (high)
notes       -> notes  (high)
birthday    -> birthday  (high)
assigned_to -> assign_to  (high)
tags        -> tags  (high)
status      -> None  (none)
converted   -> None  (none)
lead_id     -> CONTROL  (high)
created_at  -> None  (none)
```

Exactly the expected table — `source` now maps to `source`, and nothing
else shifted (`status`/`converted`/`created_at` still fuzzy to nothing).
Then re-confirmed against the real code path (not just the standalone
reimplementation) via the test below, run against `mongomock_motor`.

**Tests**, both in `backend/tests/test_contacts_import_upsert.py`:

- Extended `test_export_headers_map_without_surprises` (the test that pins
  this exact header contract) with `assert by_source["source"] == "source"`,
  alongside the pre-existing assertions that `status`/`converted`/
  `created_at` stay `None`.
- Added `test_source_cell_overwrites_existing_source` — a contact seeded
  with `source="lead"`, imported with a row whose `source` cell is
  `"Exhibition"`, ends up `source == "Exhibition"`.
- Added `test_blank_source_cell_leaves_existing_source` — same seeded
  contact, imported with `source=""`, ends up unchanged (`source ==
  "lead"`), matching the branch's blank-never-clears rule (mirrors the
  existing `test_blank_tags_cell_leaves_existing_tags` pattern).

Ran exactly the command specified (foreground, named files only, explicit
`DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017` prefix):

```
cd backend && DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 \
  python -m pytest tests/test_contacts_import_upsert.py \
  tests/test_contacts_import_route.py tests/test_import_mapping.py \
  tests/test_master_import_e2e.py tests/test_field_registry.py -q
```

Result: **58 passed**, 0 failed, exit code 0. Also ran
`tests/test_master_export_roundtrip.py` and `tests/test_import_safety.py`
(both exercise `propose_mapping` against the school-export path) as an
extra check that the new registry entry doesn't shift school-import
behaviour: **28 passed**, 0 failed.

No production DB was touched — every invocation used the explicit
`DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017` prefix; no
bare `pytest tests/` was run.

Files changed: `backend/field_registry.py` (1 line added),
`backend/tests/test_contacts_import_upsert.py` (1 assertion line + 2 new
tests). Staged and committed by explicit filename, no `git add -A`.

---

## Follow-up 2026-09-10 — contacts export merges in the school's tags (marked, round-trip safe)

**Shipped.** Owner-decided requirement: the contacts CSV export has one
`tags` cell, built only from `contact.tag_ids`. Schools carry their own tags
(`school.tag_ids`, applied via the Schools-tab bulk-tag button), and those
never showed up on a contact export — a tagged school with four contacts
produced four rows each showing only that one person's own tags, with no
sign the school itself was tagged. Decision: one `tags` cell showing BOTH,
merged, with the school-derived names marked so a naive re-import can never
write them onto the contact (that would make every person at a school
permanently inherit tags that are only editable from the Schools export —
the exact failure this whole change exists to prevent).

**`backend/import_engine.py`** — added two module-level constants right
before `parse_tag_cell` (single source of truth; `admin_routes.py` imports
`SCHOOL_TAG_SUFFIX` from here rather than hard-coding its own copy):

```python
SCHOOL_TAG_SUFFIX = " (school)"
_SCHOOL_TAG_MARKER_RE = _re.compile(
    r"\s*" + _re.escape(SCHOOL_TAG_SUFFIX.strip()) + r"\s*$", _re.IGNORECASE)
```

`parse_tag_cell` now drops any split entry matching `_SCHOOL_TAG_MARKER_RE`
entirely (not just strips the marker — the whole entry is display context,
never a tag to write). The regex is anchored on the literal `(school)`
parenthetical, so a legitimately named tag like `"Boarding School"` (no
parens) never matches — only the exact trailing marker counts, case-
insensitively and whitespace-tolerant (the cell round-trips through Excel,
which reflows spacing and can re-case text via autocorrect).

**`backend/routes/admin_routes.py`**, `export_contacts` — extended the
existing batch-fetch (which already gathered `all_tag_ids` from every
contact's `tag_ids` in one pass) rather than adding a per-row query:

1. New batch query: `db.schools.find({"school_id": {"$in": all_school_ids}}, ...)`
   over the set of every `school_id` referenced by the contacts being
   exported → `school_tag_map: {school_id: [tag_id, ...]}`. One query total,
   not one per contact.
2. `all_tag_ids` now unions the contacts' own tag ids with every id found in
   `school_tag_map`, so the existing single `db.tags.find({"$in": ...})`
   resolves both sets of names in the same one query as before.
3. Per row: `own_names` (from the contact's own `tag_ids`, in order,
   unmarked) followed by each school tag name NOT already present in
   `own_names` (case-insensitive compare — the contact's own tag wins when
   both hold it), suffixed with `SCHOOL_TAG_SUFFIX`. No school, or a school
   with no `tag_ids`, falls through the school loop with zero iterations —
   byte-identical to the pre-change output.

Total round trips for the whole export: 1 (contacts) + 1 (schools, if any
referenced) + 1 (tags, if any referenced) — still O(1) regardless of row
count, same shape as the existing schools-export streaming test already
pins for `export_schools`.

**`frontend/src/pages/admin/ImportCenter.js`** — added one bullet to the
`data-testid="roundtrip-help"` list (matching the existing voice/markup):
tags marked `(school)` come from the school, are shown for context, and are
edited via the Schools export, not here.

**Tests**, all in `backend/tests/test_contacts_import_upsert.py` (reused the
"monkeypatch `admin.db` + call the route function directly" pattern from
`tests/test_export_streaming.py`, since `export_contacts` reads its `db`
from a module-level `from database import db` import and there is no other
in-repo pattern for exercising it against `mongomock_motor` without a live
server):

- `test_parse_tag_cell_drops_school_marked_entries` — marked entries vanish;
  case-insensitive/whitespace-tolerant variants (`"(School)"`,
  `"Hot Lead(school)"`, extra spaces) all still match; a cell made entirely
  of marked entries returns `[]`.
- `test_parse_tag_cell_preserves_a_tag_legitimately_named_boarding_school` —
  the regression that would bite hardest: `"Boarding School"` alone, and
  mixed with a real marked entry, survives exactly where it should.
- `test_export_merges_contact_and_school_tags_with_school_marker` — the
  worked example from the brief: contact tagged `"GSLC 2026"` at a school
  tagged `"SS Customer"` + `"Demo Done"` → cell is exactly
  `"GSLC 2026|SS Customer (school)|Demo Done (school)"`.
- `test_export_overlapping_tag_appears_once_unmarked` — a tag held by both
  the contact and its school appears once, unmarked.
- `test_export_no_school_or_untagged_school_matches_prior_output` — no
  school, an untagged school, and an untagged contact-at-a-school all
  reproduce exactly today's (pre-change) cell.
- `test_export_does_not_issue_a_per_row_query` — 50 contacts across 50
  distinct schools; wraps `db.schools`/`db.tags` in counting proxies (same
  `CountingCollection`/`CountingDb` shape as
  `test_export_fetches_tags_once_not_once_per_school` in
  `test_export_streaming.py`) and asserts each `.find()` was called exactly
  once — not once per row.
- `test_full_round_trip_export_reimport_leaves_contact_tags_unchanged` — the
  danger case: export the merged cell, feed it back into `ie.commit_row`
  completely unchanged, and assert the contact's `tag_ids` come back
  **exactly** `["tag_gslc_rt"]` (its original own tag, resolved by name back
  to the same tag doc — `resolve_tags` matches on exact name) — no school
  tag leaked on, nothing lost, the school's own `tag_ids` untouched, and no
  stray tag document was minted from a `"... (school)"` string.

One nested-event-loop bug caught and fixed while writing these: the first
draft of the `_export_contacts` test helper called `asyncio.run()` from
inside a test's own already-running `async def go(): ...` coroutine (itself
launched via `asyncio.run`), which raises `RuntimeError: asyncio.run()
cannot be called from a running event loop`. Fixed by making the helper
itself `async` (`await`ed by the caller) instead of managing its own event
loop — matches how `test_export_streaming.py`'s `_export` helper avoids the
same trap by only ever being called from the outermost `_run(...)`.

Ran exactly the command specified (foreground, named files only, explicit
`DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017` prefix):

```
cd backend && DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 \
  python -m pytest tests/test_contacts_import_upsert.py tests/test_contacts_import_route.py \
  tests/test_csv_export.py tests/test_export_streaming.py tests/test_import_mapping.py -q
```

Result: **54 passed**, 3 failed + 6 errored — all 9 failures confined to
`tests/test_csv_export.py`, which drives a real `requests.Session()` against
`BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '')` and fails with
`requests.exceptions.MissingSchema: Invalid URL '/api/export/quotations':
No scheme supplied` because no live server is running in this environment.
Confirmed pre-existing and unrelated to this change: `git stash`'d back to
unmodified HEAD `2b34e17` and re-ran `tests/test_csv_export.py` alone —
identical 3 failed + 6 errored, same `MissingSchema` traceback. `git stash
pop` restored the changes cleanly afterward. The other 4 named files (54
tests, including all 9 new tests above) pass cleanly.

No production DB was touched — every invocation used the explicit
`DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017` prefix; no
bare `pytest tests/` was run; `test_csv_export.py`'s live-server tests never
ran to completion (they fail at the very first `session.post(...)` call, an
`INVALID URL`, before any HTTP request leaves the process).

Files changed: `backend/import_engine.py` (marker constant + regex +
`parse_tag_cell` update), `backend/routes/admin_routes.py` (import +
`export_contacts` merge logic), `frontend/src/pages/admin/ImportCenter.js`
(one help bullet), `backend/tests/test_contacts_import_upsert.py` (7 new
tests + shared export-test scaffolding). Staged and committed by explicit
filename; no `git add -A`.

---

## Notes on repo state

`docs/superpowers/plans/2026-09-09-crm-upsert-and-tag-canonicalisation.md`
still shows as modified in `git status` (pre-existing at session start, per
the prior final-fix-report's own note) — not touched, not staged, not part
of either commit. All staging in this session was by explicit filename
(`git add backend/import_engine.py`, `git add -f
backend/tests/test_contacts_import_upsert.py` — the `tests/` directory is
gitignored on this branch but the file itself was already tracked); no `git
add -A` was run.
