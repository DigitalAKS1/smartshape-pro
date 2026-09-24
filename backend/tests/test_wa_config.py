"""wa.* settings: safe defaults, strict validation, and the index set (D5, D7, D9).

Run:
    DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 \
    python -m pytest tests/test_wa_config.py -q
"""
import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

import database
from services import wa_config as wc


def _run(coro):
    return asyncio.run(coro)


def test_defaults_on_an_empty_database_are_the_spec_values():
    db = AsyncMongoMockClient()["smartshape_test"]
    cfg = _run(wc.get_wa_settings(db))
    assert cfg["warmup_start_cap"] == 20 and cfg["warmup_double_every_days"] == 3 and cfg["daily_cap"] == 200
    assert cfg["hourly_cap"] == 30 and (cfg["gap_min_s"], cfg["gap_max_s"]) == (8, 25)
    assert (cfg["business_start"], cfg["business_end"]) == ("09:00", "19:00")
    assert cfg["failure_pause_after"] == 5 and cfg["number_check_ttl_days"] == 30
    assert cfg["max_instances"] == 4 and cfg["fallback_provider"] == "none"
    assert cfg["opt_out_keywords"] == ["STOP", "UNSUBSCRIBE", "बंद", "रोकें"]
    assert cfg["drip_wa_enabled"] is False and cfg["greetings_enabled"] is False


def test_saved_values_override_and_unknown_keys_are_ignored():
    db = AsyncMongoMockClient()["smartshape_test"]
    _run(db.settings.insert_one({"type": "wa", "hourly_cap": 12, "evil": "x"}))
    cfg = _run(wc.get_wa_settings(db))
    assert cfg["hourly_cap"] == 12 and "evil" not in cfg


@pytest.mark.parametrize("body,msg", [
    ({"hourly_cap": 0}, "hourly_cap"),
    ({"daily_cap": "lots"}, "whole number"),
    ({"gap_min_s": 30, "gap_max_s": 10}, "gap_min_s"),
    ({"business_start": "19:00", "business_end": "09:00"}, "before"),
    ({"business_start": "9am"}, "HH:MM"),
    ({"fallback_provider": "gupshup"}, "fallback_provider"),
    ({"opt_out_keywords": []}, "opt_out_keywords"),
    ({"max_instances": 99}, "max_instances"),
])
def test_validation_rejects_unsafe_values(body, msg):
    with pytest.raises(wc.WaSettingsError) as e:
        wc.validate_wa_settings(body, dict(wc.WA_DEFAULTS))
    assert msg in str(e.value)


def test_save_round_trips_and_records_who():
    db = AsyncMongoMockClient()["smartshape_test"]
    out = _run(wc.save_wa_settings(db, {"hourly_cap": 20, "fallback_provider": "autosender",
                                        "opt_out_keywords": [" stop ", "बंद"]}, by="info@smartshape.in"))
    assert out["hourly_cap"] == 20 and out["opt_out_keywords"] == ["stop", "बंद"]
    doc = _run(db.settings.find_one({"type": "wa"}, {"_id": 0}))
    assert doc["updated_by"] == "info@smartshape.in" and doc["fallback_provider"] == "autosender"


def test_rep_instance_name():
    assert wc.rep_instance_name({"user_id": "user_ab12CD", "email": "x@y"}) == "rep_user_ab12cd"
    assert wc.rep_instance_name({"email": "parul.k@smartshape.in"}) == "rep_parul_k"


class _Rec:
    def __init__(self):
        self.calls = []

    def __getattr__(self, coll):
        rec = self

        class _C:
            async def create_index(self, keys, **kw):
                rec.calls.append((coll, keys, kw))
        return _C()


def test_wa_indexes_include_the_partial_unique_provider_key_and_the_ledger_key():
    rec = _Rec()
    _run(database.ensure_wa_indexes(rec))
    by = {(c, str(k)): kw for c, k, kw in rec.calls}
    key = by[("wa_messages", str([("instance_name", 1), ("provider_msg_id", 1)]))]
    assert key["unique"] is True
    assert key["partialFilterExpression"] == {"provider_msg_id": {"$type": "string"}}
    assert by[("wa_send_ledger", str([("instance_name", 1), ("day", 1)]))]["unique"] is True
    assert by[("wa_instances", str("instance_name"))]["unique"] is True
    assert ("wa_messages", str([("status", 1), ("instance_name", 1), ("send_after", 1)])) in by
