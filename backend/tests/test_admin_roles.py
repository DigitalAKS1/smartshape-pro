"""Pure-Python tests for role-array normalisation on the admin user API."""
from routes.admin_routes import normalize_roles


def test_single_role_string_still_works():
    assert normalize_roles({"role": "store"}) == (["store"], "store")


def test_roles_array_wins_over_role_string():
    assert normalize_roles({"role": "sales_person", "roles": ["store", "accounts"]}) == (
        ["store", "accounts"], "accounts"
    )


def test_admin_is_exclusive():
    assert normalize_roles({"roles": ["admin", "store"]}) == (["admin"], "admin")


def test_unknown_roles_are_dropped():
    assert normalize_roles({"roles": ["store", "wizard"]}) == (["store"], "store")


def test_empty_after_validation_defaults_to_sales():
    assert normalize_roles({"roles": ["wizard"]}) == (["sales_person"], "sales_person")
    assert normalize_roles({}) == (["sales_person"], "sales_person")


def test_duplicates_are_collapsed_preserving_order():
    assert normalize_roles({"roles": ["store", "store", "sales_person"]}) == (
        ["store", "sales_person"], "store"
    )


def test_primary_is_the_highest_privilege_held():
    assert normalize_roles({"roles": ["sales_person", "store"]})[1] == "store"
    assert normalize_roles({"roles": ["sales_person", "accounts"]})[1] == "accounts"
