"""Backfill every non-admin user's module_permissions from their role default,
merging (never lowering) any explicit grant they already have. Idempotent.

This is the safety net for the module-based RBAC switch: it reproduces each
user's current role-based access as explicit module grants so that flipping
route gates to module-based locks nobody out. Run at startup and re-runnable
as a standalone script.
"""
from rbac import LEVELS, default_permissions_for_role


def merge_permissions(existing: dict, defaults: dict) -> dict:
    """Merge role defaults into a user's existing grants without ever lowering a
    level or dropping an extra module the user already has."""
    existing = existing or {}
    out = {k: dict(v) for k, v in existing.items()}
    for mod, dperm in defaults.items():
        cur = out.get(mod)
        if not cur:
            out[mod] = dict(dperm)
            continue
        cur_lvl = LEVELS.get(cur.get("level", "none"), 0)
        def_lvl = LEVELS.get(dperm.get("level", "none"), 0)
        if def_lvl > cur_lvl:
            cur["level"] = dperm["level"]
        if dperm.get("can_download") and not cur.get("can_download"):
            cur["can_download"] = True
        out[mod] = cur
    return out


async def backfill_module_permissions(db) -> dict:
    """Apply role-default merge to every non-admin user. Returns counts."""
    updated = skipped = 0
    cursor = db.users.find({}, {"user_id": 1, "role": 1, "module_permissions": 1})
    async for u in cursor:
        role = u.get("role", "sales_person")
        if role == "admin":
            skipped += 1
            continue
        defaults = default_permissions_for_role(role)
        merged = merge_permissions(u.get("module_permissions") or {}, defaults)
        if merged != (u.get("module_permissions") or {}):
            assigned = [m for m, p in merged.items() if p.get("level", "none") != "none"]
            await db.users.update_one(
                {"user_id": u["user_id"]},
                {"$set": {"module_permissions": merged, "assigned_modules": assigned}},
            )
            updated += 1
        else:
            skipped += 1
    return {"updated": updated, "skipped": skipped}


if __name__ == "__main__":
    import asyncio
    from database import db

    print(asyncio.run(backfill_module_permissions(db)))
