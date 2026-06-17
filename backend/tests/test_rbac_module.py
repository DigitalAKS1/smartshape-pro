"""Pure-Python unit tests for module-based capability gating (no DB / no network)."""
import pytest
from fastapi import HTTPException
import rbac


def _user(role="accounts", perms=None):
    u = {"role": role, "email": "x@y.com"}
    if perms is not None:
        u["module_permissions"] = perms
    return u


def test_admin_bypasses_every_module(monkeypatch):
    monkeypatch.setattr(rbac, "MODULE_RBAC_MODE", "enforce")
    rbac.require_module(_user(role="admin"), "procurement", "read_write_delete")  # no raise


def test_grant_at_or_above_required_passes(monkeypatch):
    monkeypatch.setattr(rbac, "MODULE_RBAC_MODE", "enforce")
    u = _user(perms={"orders": {"level": "read_write"}})
    rbac.require_module(u, "orders", "read_write")
    rbac.require_module(u, "orders", "read")


def test_grant_below_required_is_403(monkeypatch):
    monkeypatch.setattr(rbac, "MODULE_RBAC_MODE", "enforce")
    u = _user(perms={"orders": {"level": "read"}})
    with pytest.raises(HTTPException) as e:
        rbac.require_module(u, "orders", "read_write")
    assert e.value.status_code == 403


def test_missing_module_is_403(monkeypatch):
    monkeypatch.setattr(rbac, "MODULE_RBAC_MODE", "enforce")
    u = _user(perms={})
    with pytest.raises(HTTPException) as e:
        rbac.require_module(u, "procurement", "read")
    assert e.value.status_code == 403


def test_shadow_mode_never_raises(monkeypatch):
    monkeypatch.setattr(rbac, "MODULE_RBAC_MODE", "shadow")
    # would be a 403 under enforce, but shadow must let it through
    rbac.require_module(_user(perms={}), "procurement", "read_write")  # no raise


def test_enforce_mode_raises(monkeypatch):
    monkeypatch.setattr(rbac, "MODULE_RBAC_MODE", "enforce")
    with pytest.raises(HTTPException):
        rbac.require_module(_user(perms={}), "procurement", "read_write")


def test_accounts_default_can_create_po_and_orders():
    perms = rbac.default_permissions_for_role("accounts")
    assert rbac.LEVELS[perms["procurement"]["level"]] >= rbac.LEVELS["read_write"]
    assert rbac.LEVELS[perms["orders"]["level"]] >= rbac.LEVELS["read_write"]


def test_sales_default_has_no_procurement():
    perms = rbac.default_permissions_for_role("sales_person")
    assert perms.get("procurement", {}).get("level", "none") == "none" or "procurement" not in perms


def test_admin_default_is_empty():
    assert rbac.default_permissions_for_role("admin") == {}
