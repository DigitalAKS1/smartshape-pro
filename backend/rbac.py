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
