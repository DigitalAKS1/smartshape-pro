"""
Central Role-Based Access Control for SmartShape Pro.

Teams / Roles:
  admin      – full access to everything
  accounts   – all quotations, orders, payments, expenses/payroll; no CRM
  store      – all orders, dispatches, inventory; read quotations; no CRM
  sales      – own data only (assigned leads, own contacts, own quotations, own orders)
"""

from fastapi import HTTPException


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
