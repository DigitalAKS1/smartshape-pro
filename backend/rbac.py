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


def get_team(user: dict) -> str:
    """Return the logical team for a user: 'admin' | 'accounts' | 'store' | 'sales'"""
    role = user.get("role", "sales_person")
    if role == "admin":
        return "admin"
    if role == "accounts":
        return "accounts"
    if role == "store":
        return "store"
    return "sales"


def require_admin(user: dict):
    if get_team(user) != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")


def require_teams(user: dict, *teams: str):
    """Raise 403 if the user's team is not in the allowed set."""
    if get_team(user) not in teams:
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


# Per-role default capability grants. These REPRODUCE today's role-based access
# so flipping route gates to module-based changes nothing for existing users
# until an admin edits a grant. Admin is omitted (bypasses all checks).
_RW = {"level": "read_write", "can_download": True}
_RWD = {"level": "read_write_delete", "can_download": True}
_R = {"level": "read", "can_download": True}

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
        "dashboard": _R, "quotations": _RW, "leads": _RW, "field_sales": _RW,
        "sales_portal": _RW, "leave_management": _RW, "analytics": _R,
        "delegation": _RW, "forms": _RW,
    },
}


def default_permissions_for_role(role: str) -> dict:
    """Complete module_permissions for a role. Admin returns {} (bypasses checks)."""
    if role == "admin":
        return {}
    # deep-copy so callers can't mutate the shared template
    return {k: dict(v) for k, v in ROLE_DEFAULT_PERMISSIONS.get(role, {}).items()}
