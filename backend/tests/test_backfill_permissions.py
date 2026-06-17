"""Pure-Python unit tests for the module-permission merge logic (no DB)."""
from migrations.backfill_module_permissions import merge_permissions


def test_missing_keys_get_role_default():
    out = merge_permissions({}, {"orders": {"level": "read_write"}})
    assert out["orders"]["level"] == "read_write"


def test_existing_higher_grant_is_preserved():
    existing = {"orders": {"level": "read_write_delete"}}
    out = merge_permissions(existing, {"orders": {"level": "read_write"}})
    assert out["orders"]["level"] == "read_write_delete"


def test_existing_lower_grant_is_raised_to_default():
    existing = {"orders": {"level": "read"}}
    out = merge_permissions(existing, {"orders": {"level": "read_write"}})
    assert out["orders"]["level"] == "read_write"


def test_extra_existing_module_not_in_defaults_is_kept():
    existing = {"custom_thing": {"level": "read_write"}}
    out = merge_permissions(existing, {"orders": {"level": "read"}})
    assert out["custom_thing"]["level"] == "read_write"
    assert out["orders"]["level"] == "read"


def test_idempotent_second_run_no_change():
    defaults = {"orders": {"level": "read_write", "can_download": True}}
    once = merge_permissions({}, defaults)
    twice = merge_permissions(once, defaults)
    assert once == twice
