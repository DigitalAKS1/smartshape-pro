"""Pure-Python unit tests for the roles/scope backfill logic (no DB).

These exist to make the core correctness claim -- "inferred values match
rbac.module_scope() exactly" -- checkable by running pytest rather than by
inspection alone. Every case here was traced by hand against rbac.get_roles()/
rbac.get_teams()/rbac.module_scope() in task-5-report.md.
"""
from migrations.backfill_user_roles_scope import compute_update
from rbac import module_scope


def _grant(scope=None):
    g = {"level": "read_write", "can_download": True}
    if scope is not None:
        g["scope"] = scope
    return g


def test_plain_sales_user_gets_own_scope_and_roles_list():
    u = {"user_id": "1", "role": "sales_person", "module_permissions": {"leads": _grant()}}
    update = compute_update(u)
    assert update["roles"] == ["sales_person"]
    assert update["module_permissions"]["leads"]["scope"] == "own"
    # cross-check against the real read-time resolver
    merged = {**u, **update}
    assert module_scope(merged, "leads") == "own"


def test_accounts_user_gets_all_scope():
    u = {"user_id": "2", "role": "accounts", "module_permissions": {"invoices": _grant()}}
    update = compute_update(u)
    assert update["module_permissions"]["invoices"]["scope"] == "all"
    merged = {**u, **update}
    assert module_scope(merged, "invoices") == "all"


def test_admin_user_gets_all_scope():
    u = {"user_id": "3", "role": "admin", "module_permissions": {"orders": _grant()}}
    update = compute_update(u)
    assert update["module_permissions"]["orders"]["scope"] == "all"


def test_unrecognised_legacy_role_treated_as_sales_team():
    """rbac.get_teams() maps any role string outside _ROLE_TEAM to 'sales'."""
    u = {"user_id": "4", "role": "field_rep_legacy", "module_permissions": {"leads": _grant()}}
    update = compute_update(u)
    assert update["roles"] == ["sales_person"]
    assert update["module_permissions"]["leads"]["scope"] == "own"
    merged = {**u, **update}
    assert module_scope(merged, "leads") == "own"


def test_missing_module_permissions_field_does_not_crash_or_invent_grants():
    u = {"user_id": "5", "role": "sales_person"}
    update = compute_update(u)
    assert "module_permissions" not in update
    assert update["roles"] == ["sales_person"]


def test_multi_role_user_spanning_teams_gets_all_scope_not_own():
    """Regression: a user already holding roles=['sales_person','store'] must
    resolve to 'all' (team set != {'sales'}), NOT 'own'. A naive inference that
    only looks at the legacy singular `role` field would get this wrong."""
    u = {
        "user_id": "6",
        "role": "sales_person",  # stale legacy field, deliberately misleading
        "roles": ["sales_person", "store"],
        "module_permissions": {"orders": _grant()},
    }
    update = compute_update(u)
    assert "roles" not in update  # already has a usable roles list -- untouched
    assert update["module_permissions"]["orders"]["scope"] == "all"
    merged = {**u, **update}
    assert module_scope(merged, "orders") == "all"


def test_roles_list_with_no_recognised_entries_falls_back_like_missing():
    u = {"user_id": "7", "role": "store", "roles": ["typo_role", "also_bogus"],
         "module_permissions": {"inventory": _grant()}}
    update = compute_update(u)
    assert update["roles"] == ["store"]
    assert update["module_permissions"]["inventory"]["scope"] == "all"


def test_explicit_scope_is_never_overwritten():
    u = {"user_id": "8", "role": "sales_person", "module_permissions": {"leads": _grant("all")}}
    update = compute_update(u)
    assert "module_permissions" not in update  # untouched -- already explicit


def test_no_op_when_already_fully_self_describing():
    u = {
        "user_id": "9", "role": "sales_person", "roles": ["sales_person"],
        "module_permissions": {"leads": _grant("own")},
    }
    assert compute_update(u) == {}


def test_second_pass_after_apply_is_a_no_op():
    """Idempotency: applying compute_update's own output to the doc leaves
    nothing left to change."""
    u = {"user_id": "10", "role": "sales_person", "module_permissions": {"leads": _grant()}}
    first = compute_update(u)
    merged = {**u, **first}
    assert compute_update(merged) == {}
