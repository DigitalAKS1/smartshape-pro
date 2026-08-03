"""
Central Role-Based Access Control for SmartShape Pro.

Teams / Roles:
  admin      – full access to everything
  accounts   – all quotations, orders, payments, expenses/payroll; no CRM
  store      – all orders, dispatches, inventory; read quotations; no CRM
  sales      – own data only (assigned leads, own contacts, own quotations, own orders)
"""

import os

from fastapi import HTTPException

# The single owner account allowed to perform irreversible deletes across CRM + ERP
# (orders, and cascade-deleting a school/contact with all related data). This is a
# stricter gate than the 'admin' role — only this exact email qualifies.
SUPERADMIN_EMAIL = (os.getenv("SUPERADMIN_EMAIL") or "info@smartshape.in").strip().lower()


VALID_ROLES = ("admin", "accounts", "store", "sales_person")

# role -> logical team
_ROLE_TEAM = {
    "admin": "admin",
    "accounts": "accounts",
    "store": "store",
    "sales_person": "sales",
}

# Highest privilege last. get_team() returns the highest team a user holds so the
# ~100 legacy call sites behave as "widest role wins" without being edited.
_TEAM_RANK = {"sales": 0, "store": 1, "accounts": 2, "admin": 3}

# Order used to pick the derived primary `role` when several are held.
PRIMARY_ROLE_ORDER = ["admin", "accounts", "store", "sales_person"]


def get_roles(user: dict) -> list[str]:
    """Every role the user holds. Falls back to the legacy single `role` string."""
    roles = user.get("roles")
    if isinstance(roles, list):
        valid = [r for r in roles if r in _ROLE_TEAM]
        if valid:
            return valid
    return [user.get("role") or "sales_person"]


def get_teams(user: dict) -> set:
    """All logical teams the user belongs to."""
    return {_ROLE_TEAM.get(r, "sales") for r in get_roles(user)}


def has_team(user: dict, team: str) -> bool:
    return team in get_teams(user)


def get_team(user: dict) -> str:
    """The user's highest-privilege team: 'admin' | 'accounts' | 'store' | 'sales'.

    Signature unchanged. For a single-role user this returns exactly what it always
    did; for a multi-role user it returns the widest, which is what the legacy
    call sites want.
    """
    return max(get_teams(user), key=lambda t: _TEAM_RANK[t])


def require_admin(user: dict):
    if not has_team(user, "admin"):
        raise HTTPException(status_code=403, detail="Admin access required")


def require_teams(user: dict, *teams: str):
    """Raise 403 unless the user holds at least one of the allowed teams."""
    if not (get_teams(user) & set(teams)):
        raise HTTPException(status_code=403, detail="Access denied for your role")


def is_superadmin(user: dict) -> bool:
    return (user.get("email") or "").strip().lower() == SUPERADMIN_EMAIL


def require_superadmin(user: dict):
    """Gate for irreversible destructive actions — only the owner account qualifies."""
    if not is_superadmin(user):
        raise HTTPException(status_code=403, detail="Only the owner account can perform this action")


# ====================================================================
# Module-based CAPABILITY gating
# --------------------------------------------------------------------
# Role decides WHAT DATA you can see (get_team + data-scope filters).
# Module grant decides WHAT YOU CAN DO. This lets a small team work
# cross-functionally: grant a module in User Management and the
# capability follows the grant — no code change required.
# ====================================================================

import logging

LEVELS = {"none": 0, "read": 1, "read_write": 2, "read_write_delete": 3}

# Live-rollout switch: "shadow" logs would-be denials but blocks no one;
# "enforce" (default) actually returns 403. First prod deploy sets shadow.
MODULE_RBAC_MODE = (os.getenv("MODULE_RBAC_MODE") or "enforce").strip().lower()
_rbac_shadow_log = logging.getLogger("rbac.shadow")


def require_module(user: dict, module: str, level: str = "read") -> None:
    """Gate an ACTION by the user's per-module permission grant, not their role.

    Admin always passes. In MODULE_RBAC_MODE="shadow" a would-be 403 is logged,
    not raised, so a live deploy can surface who'd be locked out before
    enforcement is turned on. Data VISIBILITY (which rows) stays role-based via
    get_team() and is untouched by this gate.
    """
    if get_team(user) == "admin":
        return
    perms = (user.get("module_permissions") or {}).get(module) or {}
    have = LEVELS.get(perms.get("level", "none"), 0)
    if have < LEVELS.get(level, 99):
        if MODULE_RBAC_MODE == "shadow":
            _rbac_shadow_log.warning(
                "[SHADOW] would 403: email=%s module=%s need=%s have=%s",
                user.get("email"), module, level, perms.get("level", "none"),
            )
            return
        raise HTTPException(
            status_code=403,
            detail=f"You don't have '{level}' access to '{module}'",
        )


def has_module(user: dict, module: str, level: str = "read") -> bool:
    """Non-raising sibling of require_module. Admin always True."""
    if has_team(user, "admin"):
        return True
    perms = (user.get("module_permissions") or {}).get(module) or {}
    return LEVELS.get(perms.get("level", "none"), 0) >= LEVELS.get(level, 99)


def module_scope(user: dict, module: str) -> str:
    """'own' (only records the user owns) or 'all' (org-wide) for this module.

    Reads the grant's explicit `scope`. When absent — every pre-existing user —
    it falls back to the legacy role rule: a sales-only user sees own records,
    everyone else sees all. That keeps untouched users behaving identically.
    """
    if has_team(user, "admin"):
        return "all"
    grant = (user.get("module_permissions") or {}).get(module) or {}
    scope = grant.get("scope")
    if scope in ("own", "all"):
        return scope
    return "own" if get_teams(user) == {"sales"} else "all"


def sees_all(user: dict, module: str) -> bool:
    """True when the user may see every record in this module, not just their own."""
    return module_scope(user, module) == "all"


# Per-role default capability grants. These REPRODUCE today's role-based access
# so flipping route gates to module-based changes nothing for existing users
# until an admin edits a grant. Admin is omitted (bypasses all checks).
_RW = {"level": "read_write", "can_download": True, "scope": "all"}
_RWD = {"level": "read_write_delete", "can_download": True, "scope": "all"}
_R = {"level": "read", "can_download": True, "scope": "all"}
_RW_OWN = {"level": "read_write", "can_download": True, "scope": "own"}
_R_OWN = {"level": "read", "can_download": True, "scope": "own"}

ROLE_DEFAULT_PERMISSIONS = {
    # delegation = the universal task system; every member needs it to receive
    # and complete delegated tasks, so it's read_write for all roles.
    "accounts": {
        "dashboard": _R, "quotations": _RWD, "orders": _RW, "procurement": _RW,
        "invoices": _RWD, "accounts": _RW, "payroll": _RW, "analytics": _R,
        "field_sales": _R, "hr": _R, "leave_management": _RW, "settings": _R,
        "delegation": _RW, "forms": _RW,
    },
    "store": {
        "dashboard": _R, "quotations": _R, "orders": _RW, "procurement": _RW,
        "inventory": _RWD, "stock_management": _RW, "purchase_alerts": _RW,
        "package_master": _RW, "physical_count": _RW, "store": _RW,
        "leave_management": _RW, "analytics": _R, "delegation": _RW,
        "forms": _RW,
    },
    "sales_person": {
        "dashboard": _R_OWN, "quotations": _RW_OWN, "leads": _RW_OWN,
        "field_sales": _RW_OWN, "sales_portal": _RW_OWN,
        "leave_management": _RW_OWN, "analytics": _R_OWN,
        "delegation": _RW_OWN, "forms": _RW_OWN,
    },
}


def default_permissions_for_roles(roles: list) -> dict:
    """Merge the presets of every role held.

    Level takes the maximum. Scope follows the grant that supplied that maximum
    level — it is NOT maximised independently, because doing so would invent a
    privilege no single role grants (e.g. sales's write-own + store's read-all
    cross-multiplying into write-all on quotations). Scope widens only when two
    roles contribute the SAME level. can_download is OR'd.

    Admin returns {} — it bypasses all module checks.
    """
    if "admin" in roles:
        return {}
    merged: dict = {}
    for role in roles:
        for mod, grant in ROLE_DEFAULT_PERMISSIONS.get(role, {}).items():
            cur = merged.get(mod)
            if cur is None:
                merged[mod] = dict(grant)
                continue
            new_level = LEVELS[grant["level"]]
            cur_level = LEVELS[cur["level"]]
            if new_level > cur_level:
                # Higher level wins outright, and brings its own scope with it.
                cur["level"] = grant["level"]
                cur["scope"] = grant.get("scope", "all")
            elif new_level == cur_level and grant.get("scope") == "all":
                # Equal level — the wider scope wins.
                cur["scope"] = "all"
            cur["can_download"] = bool(cur.get("can_download")) or bool(grant.get("can_download"))
    return merged


def default_permissions_for_role(role: str) -> dict:
    """Complete module_permissions for a single role. Admin returns {}."""
    return default_permissions_for_roles([role])
