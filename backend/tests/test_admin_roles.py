"""Tests for role-array normalisation and the merged role-presets endpoint
on the admin user API. Most tests are pure-Python; the endpoint tests spin
up routes.admin_routes.router in-process against an isolated test DB,
following the pattern in test_forms_crud.py (patch module-level `db` and
`get_current_user`, never import main)."""
import os
import pytest
import pytest_asyncio
from motor.motor_asyncio import AsyncIOMotorClient
from fastapi import FastAPI
from httpx import AsyncClient, ASGITransport

from routes.admin_routes import normalize_roles
import routes.admin_routes as ar

_DB_NAME = os.getenv("DB_NAME", "smartshape_test")
assert _DB_NAME.endswith("_test") or _DB_NAME == "mtt_ci", f"refusing non-test DB: {_DB_NAME}"

_MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")

ADMIN = {"user_id": "user_admin", "email": "admin@smartshape.in", "role": "admin",
         "roles": ["admin"], "module_permissions": {}}
NON_ADMIN = {"user_id": "user_rep", "email": "rep@smartshape.in", "role": "sales_person",
             "roles": ["sales_person"], "module_permissions": {}}


@pytest_asyncio.fixture
async def ctx():
    motor_client = AsyncIOMotorClient(_MONGO_URL)
    d = motor_client[_DB_NAME]
    orig_db = ar.db
    ar.db = d
    app = FastAPI()
    app.include_router(ar.router, prefix="/api")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://t") as client:
        yield d, client
    ar.db = orig_db
    for coll in ("users", "salespersons"):
        await d[coll].delete_many({})
    motor_client.close()


def _as(user):
    async def fake(request):
        return user
    return fake


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


# ==================== GET /admin/role-presets ====================

@pytest.mark.asyncio
async def test_role_presets_requires_admin(ctx, monkeypatch):
    d, client = ctx
    monkeypatch.setattr(ar, "get_current_user", _as(NON_ADMIN))
    r = await client.get("/api/admin/role-presets", params={"roles": "store"})
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_role_presets_filters_to_valid_roles(ctx, monkeypatch):
    """The endpoint must not pass an arbitrary client-supplied string through to
    the permission engine.

    Comparing responses alone proves nothing here: default_permissions_for_roles
    is total (`ROLE_DEFAULT_PERMISSIONS.get(role, {})`), so an unknown role
    contributes nothing whether or not the VALID_ROLES filter exists — the old
    version of this test passed with the filter deleted. So observe the filter
    directly: spy on what the endpoint actually hands the engine."""
    d, client = ctx
    monkeypatch.setattr(ar, "get_current_user", _as(ADMIN))
    seen = []
    real = ar.default_permissions_for_roles

    def spy(roles):
        seen.append(list(roles))
        return real(roles)

    monkeypatch.setattr(ar, "default_permissions_for_roles", spy)
    r = await client.get("/api/admin/role-presets",
                          params={"roles": " store , accounts ,wizard,,admin_ish"})
    assert r.status_code == 200, r.text
    assert seen == [["store", "accounts"]], \
        "junk roles must be filtered out before reaching default_permissions_for_roles"
    assert r.json()["module_permissions"]


@pytest.mark.asyncio
async def test_role_presets_empty_or_all_invalid_returns_empty_dict(ctx, monkeypatch):
    d, client = ctx
    monkeypatch.setattr(ar, "get_current_user", _as(ADMIN))
    empty = await client.get("/api/admin/role-presets")
    all_invalid = await client.get("/api/admin/role-presets", params={"roles": "wizard,ghost"})
    assert empty.status_code == 200
    assert empty.json() == {"module_permissions": {}}
    assert all_invalid.status_code == 200
    assert all_invalid.json() == {"module_permissions": {}}


@pytest.mark.asyncio
async def test_role_presets_admin_role_returns_empty_dict():
    from rbac import default_permissions_for_roles
    assert default_permissions_for_roles(["admin"]) == {}


# ==================== PUT /admin/users/{id} — roles preservation ====================
# Verifies the three-payload table required by review Finding 1: a routine
# legacy-console edit must not collapse a stored multi-role array.

@pytest_asyncio.fixture
async def multi_role_user(ctx):
    d, client = ctx
    await d.users.insert_one({
        "user_id": "user_multi", "email": "multi@smartshape.in", "name": "Multi Role",
        "role": "accounts", "roles": ["accounts", "store"],
        "sales_role": None, "assigned_modules": [], "is_active": True,
    })
    return d, client


@pytest.mark.asyncio
async def test_routine_edit_with_legacy_role_field_preserves_multi_role(ctx, monkeypatch, multi_role_user):
    """{"name": "New Name", "role": "accounts"} (today's console, routine edit)
    -> roles must stay ["accounts", "store"]."""
    d, client = multi_role_user
    monkeypatch.setattr(ar, "get_current_user", _as(ADMIN))
    r = await client.put("/api/admin/users/user_multi",
                          json={"name": "New Name", "role": "accounts"})
    assert r.status_code == 200, r.text
    doc = await d.users.find_one({"user_id": "user_multi"}, {"_id": 0})
    assert doc["name"] == "New Name"
    assert doc["role"] == "accounts"
    assert doc["roles"] == ["accounts", "store"]


@pytest.mark.asyncio
async def test_legacy_role_change_that_disagrees_with_stored_collapses_to_single_role(ctx, monkeypatch, multi_role_user):
    """{"role": "store"} (legacy client, real role change) -> roles becomes ["store"]."""
    d, client = multi_role_user
    monkeypatch.setattr(ar, "get_current_user", _as(ADMIN))
    r = await client.put("/api/admin/users/user_multi", json={"role": "store"})
    assert r.status_code == 200, r.text
    doc = await d.users.find_one({"user_id": "user_multi"}, {"_id": 0})
    assert doc["role"] == "store"
    assert doc["roles"] == ["store"]
    assert doc["sales_role"] is None


@pytest.mark.asyncio
async def test_explicit_roles_array_is_authoritative(ctx, monkeypatch, multi_role_user):
    """{"roles": ["store"], "role": "accounts"} (new client) -> roles becomes
    ["store"], role "store" (roles wins over the stale legacy field)."""
    d, client = multi_role_user
    monkeypatch.setattr(ar, "get_current_user", _as(ADMIN))
    r = await client.put("/api/admin/users/user_multi",
                          json={"roles": ["store"], "role": "accounts"})
    assert r.status_code == 200, r.text
    doc = await d.users.find_one({"user_id": "user_multi"}, {"_id": 0})
    assert doc["role"] == "store"
    assert doc["roles"] == ["store"]
