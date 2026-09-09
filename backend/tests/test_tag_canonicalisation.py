"""D5 — tags live in `tag_ids` on contacts, schools and leads.

Schools currently carry BOTH `tags` (written by the CRM) and `tag_ids`
(written by CSV import), so tags applied one way are invisible to the other.

Run with:  cd backend && python -m pytest tests/test_tag_canonicalisation.py -q
"""

import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest

from migrations.canonicalise_tag_fields import canonicalise_tag_fields


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture()
def db():
    from mongomock_motor import AsyncMongoMockClient
    return AsyncMongoMockClient()["smartshape_test"]


def test_school_with_both_fields_unions_them(db):
    async def go():
        await db.schools.insert_one({
            "school_id": "sch_both", "tags": ["tag_a", "tag_b"],
            "tag_ids": ["tag_b", "tag_c"],
        })
        await canonicalise_tag_fields(db)
        s = await db.schools.find_one({"school_id": "sch_both"})
        assert sorted(s["tag_ids"]) == ["tag_a", "tag_b", "tag_c"]
        assert "tags" not in s
    _run(go())


def test_school_with_only_legacy_tags_is_migrated(db):
    async def go():
        await db.schools.insert_one({"school_id": "sch_old", "tags": ["tag_x"]})
        await canonicalise_tag_fields(db)
        s = await db.schools.find_one({"school_id": "sch_old"})
        assert s["tag_ids"] == ["tag_x"]
        assert "tags" not in s
    _run(go())


def test_lead_tags_renamed_to_tag_ids(db):
    async def go():
        await db.leads.insert_one({"lead_id": "lead_1", "tags": ["tag_hot"]})
        await canonicalise_tag_fields(db)
        l = await db.leads.find_one({"lead_id": "lead_1"})
        assert l["tag_ids"] == ["tag_hot"]
        assert "tags" not in l
    _run(go())


def test_contacts_are_left_alone(db):
    async def go():
        await db.contacts.insert_one({"contact_id": "con_1", "tag_ids": ["tag_q"]})
        await canonicalise_tag_fields(db)
        c = await db.contacts.find_one({"contact_id": "con_1"})
        assert c["tag_ids"] == ["tag_q"]
    _run(go())


def test_school_with_empty_tags_array_no_tag_ids(db):
    async def go():
        await db.schools.insert_one({"school_id": "sch_empty", "tags": []})
        await canonicalise_tag_fields(db)
        s = await db.schools.find_one({"school_id": "sch_empty"})
        assert s["tag_ids"] == []
        assert "tags" not in s
    _run(go())


def test_school_with_empty_tags_array_and_tag_ids(db):
    async def go():
        await db.schools.insert_one({
            "school_id": "sch_empty_with", "tags": [],
            "tag_ids": ["tag_x"],
        })
        await canonicalise_tag_fields(db)
        s = await db.schools.find_one({"school_id": "sch_empty_with"})
        assert s["tag_ids"] == ["tag_x"]
        assert "tags" not in s
    _run(go())


def test_school_with_tags_none(db):
    async def go():
        await db.schools.insert_one({"school_id": "sch_none", "tags": None})
        await canonicalise_tag_fields(db)
        s = await db.schools.find_one({"school_id": "sch_none"})
        # tags: None matches {"$exists": True}, so it is migrated to tag_ids: []
        assert s["tag_ids"] == []
        # tags field is unset
        assert "tags" not in s
    _run(go())


def test_migration_is_idempotent(db):
    async def go():
        await db.schools.insert_one({"school_id": "sch_i", "tags": ["tag_a"]})
        first = await canonicalise_tag_fields(db)
        second = await canonicalise_tag_fields(db)
        assert first["schools_merged"] == 1
        assert second["schools_merged"] == 0
        assert second["already_clean"] is True
        s = await db.schools.find_one({"school_id": "sch_i"})
        assert s["tag_ids"] == ["tag_a"]
    _run(go())


def test_migration_is_idempotent_for_both_fields_case(db):
    async def go():
        await db.schools.insert_one({
            "school_id": "sch_both_i", "tags": ["tag_a", "tag_b"],
            "tag_ids": ["tag_b", "tag_c"],
        })
        first = await canonicalise_tag_fields(db)
        second = await canonicalise_tag_fields(db)
        assert first["schools_merged"] == 1
        assert second["schools_merged"] == 0
        assert second["already_clean"] is True
        s = await db.schools.find_one({"school_id": "sch_both_i"})
        assert sorted(s["tag_ids"]) == ["tag_a", "tag_b", "tag_c"]
        assert "tags" not in s
    _run(go())


def test_school_owner_field_migrated_to_assigned_to(db):
    async def go():
        from migrations.canonicalise_school_owner import canonicalise_school_owner

        # Seed the users directory so resolve_owner can find them
        await db.users.insert_one({"email": "rep@x.com", "name": "Rep User"})
        await db.users.insert_one({"email": "current@x.com", "name": "Current Owner"})
        # One user that won't be found for unresolvable test

        # Case 1: legacy owner is resolved to a known user
        await db.schools.insert_one({"school_id": "sch_o1", "owner": "rep@x.com"})

        # Case 2: assigned_to already set, owner field exists (must not clobber)
        await db.schools.insert_one({
            "school_id": "sch_o2", "owner": "old@x.com",
            "assigned_to": "current@x.com",
        })

        # Case 3: assigned_to exists but assigned_name is blank (should fill name)
        await db.schools.insert_one({
            "school_id": "sch_o3", "owner": "ignore@x.com",
            "assigned_to": "current@x.com",
            "assigned_name": "",  # blank name that should be filled
        })

        # Case 4: unresolvable email (unknown@x.com not in db.users)
        await db.schools.insert_one({"school_id": "sch_o4", "owner": "unknown@x.com"})

        res = await canonicalise_school_owner(db)

        # Case 1: legacy owner migrated + name resolved
        s1 = await db.schools.find_one({"school_id": "sch_o1"})
        assert s1["assigned_to"] == "rep@x.com"
        assert s1["assigned_name"] == "Rep User", "should resolve email to display name"
        assert "owner" not in s1

        # Case 2: assigned_to not clobbered, owner removed
        s2 = await db.schools.find_one({"school_id": "sch_o2"})
        assert s2["assigned_to"] == "current@x.com", "must not clobber a live owner"
        assert s2["assigned_name"] == "Current Owner", "should fill blank name for existing assigned_to"
        assert "owner" not in s2

        # Case 3: blank assigned_name filled in
        s3 = await db.schools.find_one({"school_id": "sch_o3"})
        assert s3["assigned_to"] == "current@x.com"
        assert s3["assigned_name"] == "Current Owner", "should fill blank assigned_name"
        assert "owner" not in s3

        # Case 4: unresolvable email (no user found) — email stays as assigned_to, name is blank
        s4 = await db.schools.find_one({"school_id": "sch_o4"})
        assert s4["assigned_to"] == "unknown@x.com", "should keep unknown email as valid scoping key"
        assert s4.get("assigned_name") == "", "should leave name blank for unresolvable email"
        assert "owner" not in s4

        assert res["schools_migrated"] == 4
        # Second run should be idempotent (no changes)
        assert (await canonicalise_school_owner(db))["schools_migrated"] == 0
    _run(go())


# ---------------------------------------------------------------------------
# Guard: nothing reads or writes the legacy `tags` field on schools/leads.
# ---------------------------------------------------------------------------
#
# A single `re.search(r'["\']tags["\']\s*:', line)` over the whole line is too
# broad: it also matches a perfectly legitimate response-shape key
# (`facets = {"stages": stage_facets, "tags": tag_facets}` in
# _calculate_facets) and an unrelated equality check
# (`if field == "tags":` in the CSV export). Both are plain Python dict/
# control-flow syntax that happen to contain the substring `"tags":` but never
# touch Mongo. Flagging them would make the guard fail for reasons that have
# nothing to do with the bug it exists to catch — exactly the kind of
# de-fanged assertion that is worse than no test.
#
# Instead this guard targets the concrete SHAPES that actually reach Mongo for
# schools/leads, each chosen because it cannot occur in ordinary
# Python-dict/response code:
#
#   1. An update-operator dict keyed by $set/$addToSet/$pull/$unset/$push
#      whose payload names "tags" — e.g. {"$addToSet": {"tags": tag_id}}.
#      ($-prefixed keys are exclusively Mongo operator syntax in this
#      codebase; they never appear in an API response dict.)
#   2. An aggregation field reference to "$tags" — e.g. {"$unwind": "$tags"}
#      or {"_id": "$tags", ...} in a $group stage. Same reasoning: a string
#      starting with "$" is never a legitimate response value.
#   3. A filter clause built with `<list>.append({"tags": ...})` — the
#      pattern crm_routes.py's GET /leads uses to build `clauses` before
#      ANDing them into a Mongo query (`clauses.append({"tag_ids": tag})`).
#   4. A bracket-style field assignment `<dict>["tags"] = ...` — the pattern
#      the PUT /schools/{id} and PUT /leads/{id} handlers use to build the
#      `$set` payload (`allowed["tags"] = ...`).
#   5. A direct Mongo call with an inline "tags" filter/document on the same
#      line, e.g. db.schools.find({"tags": tag_id}, ...).
#   6. A "tags": key line that falls inside an insert_one/insert_many/
#      update_one/update_many(...) call opened earlier in the same function
#      (multi-line document literals, e.g. crm_zoom_routes.py's Zoom-import
#      lead insert). Scoped to the enclosing function by stopping the
#      backward scan at the nearest `@router`/`def`/`async def` line, so it
#      cannot reach into an unrelated handler above.
#
# Scoped to every file Task 3 touched — the two the brief named plus the
# additional sites the broader grep turned up (Zoom import, drip enrol-by-tag,
# the quotation auto-lead + demo-tag update, and the WhatsApp broadcast-by-tag
# query) — plus the dev seed script, so a regression anywhere in that set is
# caught, not just in the two originally-named files.

def test_no_source_file_still_writes_legacy_tags_field():
    """Guard against a reintroduced `tags` read/write on schools or leads."""
    import pathlib
    import re

    root = pathlib.Path(__file__).resolve().parents[1]
    files = (
        "routes/crm_routes.py",
        "routes/admin_routes.py",
        "routes/crm_zoom_routes.py",
        "routes/drip_routes.py",
        "routes/quotation_routes.py",
        "routes/settings_routes.py",
        "seed_leads.py",
    )

    operator_re = re.compile(
        r'\$(?:set|addToSet|pull|unset|push)["\']?\s*:\s*\{[^{}]*["\']tags["\']\s*:')
    agg_field_re = re.compile(r'["\']\$tags["\']')
    append_re = re.compile(r'\.append\(\s*\{\s*["\']tags["\']\s*:')
    bracket_assign_re = re.compile(r'\w+\[["\']tags["\']\]\s*=')
    inline_call_re = re.compile(
        r'db\.\w+\.(?:find|find_one|update_one|update_many|delete_one|delete_many|'
        r'insert_one|insert_many|aggregate)\([^)]*["\']tags["\']\s*:')
    tags_key_re = re.compile(r'["\']tags["\']\s*:')
    write_opener_re = re.compile(
        r'db\.\w+\.(?:insert_one|insert_many|update_one|update_many)\(')
    boundary_re = re.compile(r'^\s*(@router|async def |def )')

    offenders = []
    for name in files:
        path = root / name
        if not path.exists():
            continue
        lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
        for i, line in enumerate(lines):
            lineno = i + 1
            hit = None
            if operator_re.search(line):
                hit = "update-operator dict"
            elif agg_field_re.search(line):
                hit = "aggregation field reference ($tags)"
            elif append_re.search(line):
                hit = 'filter-clause .append({"tags": ...})'
            elif bracket_assign_re.search(line):
                hit = "bracket-style field assignment"
            elif inline_call_re.search(line):
                hit = "inline Mongo call filter/document"
            elif tags_key_re.search(line):
                # Possibly a multi-line insert/update document: look back
                # (within this function only) for an unclosed
                # insert_one/insert_many/update_one/update_many( opener.
                for back in range(i - 1, max(-1, i - 40), -1):
                    prior = lines[back]
                    if boundary_re.match(prior):
                        break
                    if write_opener_re.search(prior):
                        hit = "multi-line document inside an insert/update call"
                        break
            if hit:
                offenders.append(f"{name}:{lineno} [{hit}]: {line.strip()}")

    assert not offenders, "legacy `tags` field still read/written:\n" + "\n".join(offenders)
