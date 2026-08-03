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


# ---------------- multi-role + per-module scope ----------------

def _muser(roles=None, role=None, perms=None):
    u = {"email": "x@y.com"}
    if role is not None:
        u["role"] = role
    if roles is not None:
        u["roles"] = roles
    if perms is not None:
        u["module_permissions"] = perms
    return u


def test_get_roles_falls_back_to_single_role():
    assert rbac.get_roles(_muser(role="store")) == ["store"]


def test_get_roles_reads_roles_array():
    assert rbac.get_roles(_muser(role="sales_person", roles=["sales_person", "store"])) == [
        "sales_person", "store"
    ]


def test_get_roles_drops_unknown_entries_in_array():
    assert rbac.get_roles(_muser(role="store", roles=["store", "wizard"])) == ["store"]


def test_get_roles_falls_back_when_array_has_nothing_valid():
    assert rbac.get_roles(_muser(role="store", roles=["wizard"])) == ["store"]


def test_get_team_unchanged_for_single_role():
    assert rbac.get_team(_muser(role="admin")) == "admin"
    assert rbac.get_team(_muser(role="accounts")) == "accounts"
    assert rbac.get_team(_muser(role="store")) == "store"
    assert rbac.get_team(_muser(role="sales_person")) == "sales"
    assert rbac.get_team(_muser(role="wizard")) == "sales"
    assert rbac.get_team({"email": "x@y.com"}) == "sales"


def test_get_team_returns_highest_privilege_of_the_set():
    assert rbac.get_team(_muser(role="sales_person", roles=["sales_person", "store"])) == "store"
    assert rbac.get_team(_muser(role="store", roles=["store", "accounts"])) == "accounts"
    assert rbac.get_team(_muser(role="admin", roles=["admin", "sales_person"])) == "admin"


def test_get_teams_and_has_team():
    u = _muser(role="sales_person", roles=["sales_person", "store"])
    assert rbac.get_teams(u) == {"sales", "store"}
    assert rbac.has_team(u, "sales") is True
    assert rbac.has_team(u, "accounts") is False


def test_require_teams_passes_on_any_overlap():
    u = _muser(role="store", roles=["store", "sales_person"])
    rbac.require_teams(u, "sales")            # no raise — holds sales
    rbac.require_teams(u, "accounts", "store")  # no raise — holds store
    with pytest.raises(HTTPException) as e:
        rbac.require_teams(u, "accounts")
    assert e.value.status_code == 403


def test_require_admin_unchanged():
    rbac.require_admin(_muser(role="admin"))
    with pytest.raises(HTTPException):
        rbac.require_admin(_muser(role="store"))


def test_module_scope_uses_explicit_grant():
    u = _muser(role="store", perms={"leads": {"level": "read_write", "scope": "own"}})
    assert rbac.module_scope(u, "leads") == "own"
    assert rbac.sees_all(u, "leads") is False


def test_module_scope_admin_is_always_all():
    assert rbac.module_scope(_muser(role="admin"), "leads") == "all"


def test_module_scope_legacy_fallback_matches_today():
    # No scope key anywhere — must reproduce the old role-based rule exactly.
    sales = _muser(role="sales_person", perms={"quotations": {"level": "read_write"}})
    store = _muser(role="store", perms={"orders": {"level": "read_write"}})
    accounts = _muser(role="accounts", perms={"orders": {"level": "read_write"}})
    assert rbac.module_scope(sales, "quotations") == "own"
    assert rbac.module_scope(store, "orders") == "all"
    assert rbac.module_scope(accounts, "orders") == "all"


def test_module_scope_fallback_for_ungranted_module():
    assert rbac.module_scope(_muser(role="sales_person", perms={}), "orders") == "own"
    assert rbac.module_scope(_muser(role="store", perms={}), "orders") == "all"


def test_bad_scope_value_falls_back():
    u = _muser(role="sales_person", perms={"leads": {"level": "read", "scope": "galaxy"}})
    assert rbac.module_scope(u, "leads") == "own"


def test_has_module_is_non_raising():
    u = _muser(role="store", perms={"leads": {"level": "read"}})
    assert rbac.has_module(u, "leads") is True
    assert rbac.has_module(u, "leads", "read_write") is False
    assert rbac.has_module(u, "payroll") is False
    assert rbac.has_module(_muser(role="admin"), "payroll", "read_write_delete") is True


def test_merged_presets_take_max_level_with_scope_following_that_level():
    merged = rbac.default_permissions_for_roles(["sales_person", "store"])
    # store contributes org-wide orders at read_write (sales grants nothing here)
    assert merged["orders"]["level"] == "read_write"
    assert merged["orders"]["scope"] == "all"
    # sales contributes own-scoped leads (store grants nothing here)
    assert merged["leads"]["scope"] == "own"
    # quotations exist in both: sales read_write/own vs store read/all -> the higher
    # level (sales's read_write) wins outright and brings its own scope with it;
    # scope is NOT independently maximised to "all".
    assert merged["quotations"]["level"] == "read_write"
    assert merged["quotations"]["scope"] == "own"


def test_merge_does_not_cross_multiply_level_and_scope():
    """sales write-own + store read-all must NOT become write-all."""
    merged = rbac.default_permissions_for_roles(["sales_person", "store"])
    q = merged["quotations"]
    assert q["level"] == "read_write"
    assert q["scope"] == "own", "scope must follow the highest-level grant, not be maxed separately"


def test_merge_widens_scope_only_on_equal_levels():
    merged = rbac.default_permissions_for_roles(["sales_person", "store"])
    # orders: only store grants it (read_write/all) -> unchanged
    assert merged["orders"]["level"] == "read_write"
    assert merged["orders"]["scope"] == "all"
    # leads: only sales grants it (read_write/own) -> unchanged
    assert merged["leads"]["scope"] == "own"


def test_merge_is_order_independent():
    a = rbac.default_permissions_for_roles(["sales_person", "store"])
    b = rbac.default_permissions_for_roles(["store", "sales_person"])
    assert a == b


def test_merged_presets_with_admin_is_empty():
    assert rbac.default_permissions_for_roles(["admin", "store"]) == {}


def test_default_permissions_for_role_wrapper_still_works():
    assert rbac.default_permissions_for_role("store") == rbac.default_permissions_for_roles(["store"])


def test_preset_merge_does_not_mutate_the_template():
    before = rbac.ROLE_DEFAULT_PERMISSIONS["store"]["orders"]["level"]
    rbac.default_permissions_for_roles(["sales_person", "store"])
    assert rbac.ROLE_DEFAULT_PERMISSIONS["store"]["orders"]["level"] == before


def test_sales_person_presets_are_own_scoped():
    perms = rbac.default_permissions_for_roles(["sales_person"])
    assert all(g["scope"] == "own" for g in perms.values())


def test_store_presets_are_all_scoped():
    perms = rbac.default_permissions_for_roles(["store"])
    assert all(g["scope"] == "all" for g in perms.values())
