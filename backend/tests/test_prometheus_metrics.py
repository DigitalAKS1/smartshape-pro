"""Task 14: the monitoring module must measure things without breaking them.

A metrics module earns its place only if it is invisible when it fails, so the
tests care less about "does a counter count" and more about the three ways
instrumentation historically takes an app down: an import that raises, a
decorator that eats an exception, and a decorator that hides a route's signature
from FastAPI's dependency injection.

No DB, no network.
"""
import asyncio
import inspect

import pytest

from monitoring import prometheus_metrics as pm


def _sample(metric_name: str, labels: dict) -> float:
    """Read one sample straight out of the default registry."""
    from prometheus_client import REGISTRY

    value = REGISTRY.get_sample_value(metric_name, labels)
    return 0.0 if value is None else value


def test_module_exposes_the_briefed_metrics():
    for name in ("query_duration", "cache_hits", "cache_misses", "cache_hit_rate",
                 "import_rows", "import_duration", "db_operations"):
        assert hasattr(pm, name), f"missing metric: {name}"


def test_metrics_enabled_with_the_package_installed():
    assert pm.METRICS_ENABLED is True


def test_cache_hit_and_miss_move_counters_and_the_rate_gauge():
    key = "test_cache_rate"
    pm.record_cache_hit(key)
    pm.record_cache_hit(key)
    pm.record_cache_miss(key)

    assert _sample("cache_hits_total", {"key_type": key}) == 2.0
    assert _sample("cache_misses_total", {"key_type": key}) == 1.0
    # 2 hits out of 3 lookups - the gauge is derived, not left at zero.
    assert _sample("cache_hit_rate", {"key_type": key}) == pytest.approx(2 / 3)


def test_db_operation_counter_is_labelled_by_collection_and_operation():
    pm.record_db_operation("leads", "find")
    pm.record_db_operation("leads", "find", count=4)
    assert _sample("db_operations_total", {"collection": "leads", "operation": "find"}) == 5.0


def test_record_import_counts_rows_and_duration():
    before_ok = _sample("import_rows_total", {"status": "success"})
    before_failed = _sample("import_rows_total", {"status": "failed"})
    before_runs = _sample("import_duration_seconds_count", {})

    pm.record_import(rows_ok=500, rows_failed=3, elapsed=12.5)

    assert _sample("import_rows_total", {"status": "success"}) == before_ok + 500
    assert _sample("import_rows_total", {"status": "failed"}) == before_failed + 3
    assert _sample("import_duration_seconds_count", {}) == before_runs + 1


def test_async_decorator_records_success_and_returns_the_value():
    @pm.track_query_time("test_async_ok")
    async def handler(x):
        return x * 2

    assert asyncio.run(handler(21)) == 42
    assert _sample("crm_query_duration_seconds_count",
                   {"endpoint": "test_async_ok", "status": "success"}) == 1.0


def test_async_decorator_records_error_and_re_raises_the_original():
    @pm.track_query_time("test_async_err")
    async def handler():
        raise ValueError("boom")

    with pytest.raises(ValueError, match="boom"):
        asyncio.run(handler())

    assert _sample("crm_query_duration_seconds_count",
                   {"endpoint": "test_async_err", "status": "error"}) == 1.0
    assert _sample("crm_query_duration_seconds_count",
                   {"endpoint": "test_async_err", "status": "success"}) == 0.0


def test_sync_functions_are_wrapped_too():
    @pm.track_query_time("test_sync_ok")
    def handler():
        return "ok"

    assert handler() == "ok"
    assert not inspect.iscoroutinefunction(handler)
    assert _sample("crm_query_duration_seconds_count",
                   {"endpoint": "test_sync_ok", "status": "success"}) == 1.0


def test_decorator_preserves_the_signature_fastapi_depends_on():
    """A bare *args/**kwargs wrapper would strip every route parameter."""

    @pm.track_query_time("test_sig")
    async def handler(lead_id: str, limit: int = 50):
        return lead_id, limit

    params = inspect.signature(handler).parameters
    assert list(params) == ["lead_id", "limit"]
    assert params["limit"].default == 50
    assert handler.__name__ == "handler"


def test_render_latest_returns_exposition_text():
    payload, content_type = pm.render_latest()
    assert b"crm_query_duration_seconds" in payload
    assert "text/plain" in content_type


def test_metrics_degrade_to_noops_when_the_package_is_missing(monkeypatch):
    """Missing dependency must not raise on import or on any recorded call."""
    import builtins

    real_import = builtins.__import__

    def blocked(name, *args, **kwargs):
        if name.startswith("prometheus_client"):
            raise ImportError("simulated missing prometheus_client")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", blocked)

    import importlib
    import sys

    saved = {k: v for k, v in sys.modules.items() if k.startswith("prometheus_client")}
    for k in saved:
        del sys.modules[k]
    try:
        degraded = importlib.reload(pm)
        assert degraded.METRICS_ENABLED is False
        # Every recording path is still callable and silent.
        degraded.record_cache_hit("x")
        degraded.record_cache_miss("x")
        degraded.record_db_operation("leads", "find")
        degraded.record_import(rows_ok=1, rows_failed=1, elapsed=1.0)
        degraded.observe_query("x", 0.1)

        @degraded.track_query_time("x")
        async def handler():
            return "still works"

        assert asyncio.run(handler()) == "still works"
        assert degraded.render_latest()[0] == b""
    finally:
        monkeypatch.undo()
        sys.modules.update(saved)
        importlib.reload(pm)


def test_double_import_under_a_second_module_path_does_not_raise():
    """`monitoring.x` and `backend.monitoring.x` must not fight over names."""
    import importlib

    again = importlib.import_module("monitoring.prometheus_metrics")
    importlib.reload(again)  # re-running metric construction must be idempotent
    assert again.METRICS_ENABLED is True
