"""tag_scope.py — which contacts, schools and leads a tag reaches.

Tags live on people and deals, not on schools: in production not one school
carries a tag directly. So "filter by GSLC 2026" matched zero schools, and every
server-side send that asked a single collection for `tag_ids` disagreed with
anything a screen could show. This module is the one rule, and every server-side
tag audience asks it (spec 2026-09-11, decisions D1-D4):

    D1  a CONTACT matches only if it carries the tag itself. It never rolls up
        through its school — GSLC 2026 is on 98 people, and their 16 colleagues
        who were not at the event must not be messaged as if they were.
    D2  a SCHOOL matches if it carries the tag itself, or any of its contacts
        does, or any of its leads does.
    D3  a LEAD matches if it carries the tag itself, or it is a deal at a school
        that matches under D2 — a deal is an account-level object.

Soft-deleted records (`is_deleted: True`) never match and never contribute: a
deleted contact or lead does not surface its school, a deleted school is never
in scope and does not pass its match on to its leads. A school id that points at
no school document at all is treated the same as a deleted school.

The frontend filter (`frontend/src/lib/crmFilter.js`) implements the same rule
over the arrays it has loaded. `tests/test_tag_scope.py` and
`src/lib/__tests__/tagRollupAgreement.test.js` run one fixture
(`tests/fixtures/tag_rollup_fixture.json`) through both and must agree, so the
screen and the send cannot drift apart again.

Cost: four batched, projected queries and set arithmetic — never a per-row
lookup — whatever the size of the tag.
"""

_LIVE = {"is_deleted": {"$ne": True}}


def normalise_tag_ids(tag_ids) -> list:
    """One id or many -> a de-duplicated list of non-blank ids, order kept."""
    if tag_ids is None:
        return []
    if isinstance(tag_ids, str):
        tag_ids = [tag_ids]
    out = []
    for t in tag_ids:
        if isinstance(t, str):
            t = t.strip()
            if t and t not in out:
                out.append(t)
    return out


def empty_scope() -> dict:
    return {"contact_ids": set(), "school_ids": set(), "lead_ids": set()}


async def resolve_tag_scope(db, tag_ids) -> dict:
    """Return ``{"contact_ids", "school_ids", "lead_ids"}`` (each a ``set``) for a
    tag under D1-D3.

    ``tag_ids`` is one tag id, or a list of them with ANY-of semantics — a record
    is in scope if it would be in scope for at least one of the tags. Blank or
    missing input returns empty sets rather than matching everything.

    The result is the whole CRM, unscoped. A caller acting for a user MUST
    intersect it with that user's own visibility — this function can narrow an
    audience, never widen it.
    """
    ids = normalise_tag_ids(tag_ids)
    scope = empty_scope()
    if not ids:
        return scope
    tagged = {"tag_ids": {"$in": ids}, **_LIVE}

    # D1 — the tagged people themselves; their schools feed D2.
    surfaced_school_ids = set()
    async for c in db.contacts.find(tagged, {"_id": 0, "contact_id": 1, "school_id": 1}):
        if c.get("contact_id"):
            scope["contact_ids"].add(c["contact_id"])
        if c.get("school_id"):
            surfaced_school_ids.add(c["school_id"])

    # D3 (direct half) — the tagged deals; their schools feed D2 too.
    async for lead in db.leads.find(tagged, {"_id": 0, "lead_id": 1, "school_id": 1}):
        if lead.get("lead_id"):
            scope["lead_ids"].add(lead["lead_id"])
        if lead.get("school_id"):
            surfaced_school_ids.add(lead["school_id"])

    # D2 — schools tagged directly or surfaced above, and still alive. Asking for
    # the surfaced ids here (rather than trusting them) is what drops a deleted
    # school and a school_id that points at nothing.
    school_or = [{"tag_ids": {"$in": ids}}]
    if surfaced_school_ids:
        school_or.append({"school_id": {"$in": list(surfaced_school_ids)}})
    async for s in db.schools.find({"$or": school_or, **_LIVE}, {"_id": 0, "school_id": 1}):
        if s.get("school_id"):
            scope["school_ids"].add(s["school_id"])

    # D3 (roll-up half) — every live deal at a matching school.
    if scope["school_ids"]:
        async for lead in db.leads.find(
                {"school_id": {"$in": list(scope["school_ids"])}, **_LIVE},
                {"_id": 0, "lead_id": 1}):
            if lead.get("lead_id"):
                scope["lead_ids"].add(lead["lead_id"])

    return scope
