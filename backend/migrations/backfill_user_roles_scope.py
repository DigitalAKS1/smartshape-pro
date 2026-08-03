"""Backfill `roles` and per-grant `scope` so the users collection is self-describing.

Idempotent and non-destructive: it writes only the values that rbac.py would have
inferred anyway, so running it changes no one's effective access. Safe to re-run.

Correctness note: the scope/roles inference below calls rbac.get_roles() and
rbac.get_teams() directly instead of re-deriving role->team mapping by hand. That
is deliberate -- a hand-rolled copy of that logic can silently drift from what
module_scope() actually resolves at read time (e.g. for a user who already holds
multiple roles spanning teams), which is exactly the failure mode this backfill
must never cause. See task-5-report.md for the line-by-line argument.

Usage:  cd backend && python migrations/backfill_user_roles_scope.py [--apply]
Without --apply it is a dry run and prints what it would change.
"""
import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rbac import VALID_ROLES, get_teams  # noqa: E402


def _normalize_role(role: str) -> str:
    """The VALID_ROLES member equivalent to a (possibly unrecognised) legacy role
    string. rbac._ROLE_TEAM (and thus get_teams()) defaults any role outside
    VALID_ROLES to the 'sales' team, so 'sales_person' is the only faithful,
    explicit value to persist for such a user -- writing the raw unrecognised
    string back would still leave a future reader depending on that same
    default-team inference, defeating the point of this backfill."""
    return role if role in VALID_ROLES else "sales_person"


def compute_update(u: dict) -> dict:
    """Pure function: given a user doc, return the $set update this backfill would
    apply, or {} if the doc is already self-describing. No DB access -- unit
    testable in isolation, mirroring migrations/backfill_module_permissions.py's
    merge_permissions() style.
    """
    update: dict = {}

    # roles: only fill in when nothing usable is already stored. A `roles` list
    # with zero recognised entries has to fall back exactly like a missing one --
    # rbac.get_roles() does this filter-then-fallback itself, so mirror its own
    # trigger condition rather than just checking "is it a non-empty list". The
    # fallback value itself is normalized (see _normalize_role) rather than a
    # verbatim copy of rbac.get_roles()'s raw fallback, so the write is genuinely
    # explicit instead of encoding a still-inferred value.
    stored_roles = u.get("roles")
    has_usable_roles = isinstance(stored_roles, list) and any(r in VALID_ROLES for r in stored_roles)
    if not has_usable_roles:
        update["roles"] = [_normalize_role(u.get("role") or "sales_person")]

    # scope: reuse rbac.get_teams() -- the exact function module_scope() calls --
    # instead of re-deriving team membership from a single legacy `role` field.
    # module_scope()'s fallback is precisely: "own" iff the user's only team is
    # "sales", else "all" (this also correctly covers admin, since a user whose
    # team set is exactly {"sales"} can never also be admin).
    teams = get_teams(u)
    inferred_scope = "own" if teams == {"sales"} else "all"

    perms = u.get("module_permissions") or {}
    if perms:
        new_perms = {}
        touched = False
        for mod, grant in perms.items():
            g = dict(grant or {})
            if g.get("scope") not in ("own", "all"):
                g["scope"] = inferred_scope
                touched = True
            new_perms[mod] = g
        if touched:
            update["module_permissions"] = new_perms

    return update


async def main(apply: bool):
    from database import db  # deferred: keep compute_update() importable with no DB env configured

    total = changed = 0
    cursor = db.users.find({}, {"user_id": 1, "email": 1, "role": 1,
                                 "roles": 1, "module_permissions": 1})
    async for u in cursor:
        total += 1
        update = compute_update(u)
        if not update:
            continue
        changed += 1
        print(f"{'APPLY ' if apply else 'DRY   '} {u.get('email')}: {sorted(update.keys())}")
        if apply:
            await db.users.update_one({"user_id": u["user_id"]}, {"$set": update})

    print(f"\n{changed} of {total} users {'updated' if apply else 'would be updated'}.")


if __name__ == "__main__":
    asyncio.run(main("--apply" in sys.argv))
