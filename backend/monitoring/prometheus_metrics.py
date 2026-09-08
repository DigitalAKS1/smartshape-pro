"""Prometheus metrics for CRM performance monitoring.

Instrumentation only: importing this module must never change behaviour and must
never be able to take the API down. Two things follow from that rule.

1. `prometheus_client` is treated as OPTIONAL. If the package is missing (an old
   image layer, a slim worker, a dev box that skipped a `pip install`) every
   metric degrades to a no-op object with the same surface, `METRICS_ENABLED`
   goes False, and callers keep working. A monitoring import is never worth a
   500.
2. Metric construction is idempotent. Prometheus raises on duplicate timeseries
   names, and this module can legitimately be imported twice under two different
   module paths (`monitoring.…` from the app, `backend.monitoring.…` from tests).
   `_get_or_create` returns the already-registered collector instead of blowing
   up at import time.

Recorded values are per-process and cumulative since boot. Under more than one
uvicorn worker each worker keeps its own registry, so a real scrape needs either
a single worker or `prometheus_client` multiprocess mode (PROMETHEUS_MULTIPROC_DIR).

Nothing here is wired into a route yet — `render_latest()` is the hook for a
future `GET /metrics`. See task-14 brief.
"""
from __future__ import annotations

import functools
import inspect
import threading
import time
from typing import Any, Callable, Dict, Iterable, Tuple

try:  # pragma: no cover - exercised by whichever install the runtime has
    from prometheus_client import (
        CONTENT_TYPE_LATEST,
        REGISTRY,
        Counter,
        Gauge,
        Histogram,
        generate_latest,
    )

    METRICS_ENABLED = True
except Exception:  # ImportError, or a broken partial install
    CONTENT_TYPE_LATEST = "text/plain; version=0.0.4; charset=utf-8"
    REGISTRY = None
    Counter = Gauge = Histogram = None  # type: ignore[assignment]
    generate_latest = None  # type: ignore[assignment]

    METRICS_ENABLED = False


class _NoopMetric:
    """Stand-in with the same call surface as a Counter/Gauge/Histogram."""

    def labels(self, *args: Any, **kwargs: Any) -> "_NoopMetric":
        return self

    def observe(self, amount: float) -> None:
        return None

    def inc(self, amount: float = 1) -> None:
        return None

    def dec(self, amount: float = 1) -> None:
        return None

    def set(self, value: float) -> None:
        return None


def _get_or_create(factory: Any, name: str, documentation: str,
                   labelnames: Iterable[str] = (), **kwargs: Any) -> Any:
    """Build a collector, or hand back the one already in the registry."""
    if not METRICS_ENABLED:
        return _NoopMetric()
    try:
        return factory(name, documentation, list(labelnames), **kwargs)
    except ValueError:
        # Duplicated timeseries: this module was imported twice. Reuse.
        existing = getattr(REGISTRY, "_names_to_collectors", {}).get(name)
        if existing is not None:
            return existing
        return _NoopMetric()


# --- Query latency ---------------------------------------------------------
# Buckets straddle the plan's <500ms lead-list / <200ms tag-filter targets so a
# regression past either shows up as a bucket shift, not just a moving average.
query_duration = _get_or_create(
    Histogram,
    "crm_query_duration_seconds",
    "Time to execute CRM queries",
    ["endpoint", "status"],
    buckets=[0.1, 0.2, 0.5, 1.0, 2.0, 5.0],
)

# --- Cache performance -----------------------------------------------------
cache_hits = _get_or_create(Counter, "cache_hits_total", "Cache hit count", ["key_type"])
cache_misses = _get_or_create(Counter, "cache_misses_total", "Cache miss count", ["key_type"])
cache_hit_rate = _get_or_create(
    Gauge, "cache_hit_rate", "Fraction of cache lookups that hit (0-1)", ["key_type"]
)

# --- Import performance ----------------------------------------------------
import_rows = _get_or_create(Counter, "import_rows_total", "Rows imported", ["status"])
import_duration = _get_or_create(
    Histogram, "import_duration_seconds", "Time to import", buckets=[1, 5, 10, 30, 60]
)

# --- Database operations ---------------------------------------------------
db_operations = _get_or_create(
    Counter, "db_operations_total", "DB operations", ["collection", "operation"]
)


# --- Helpers ---------------------------------------------------------------
# The Gauge cannot derive itself from two Counters, so hit/miss tallies are kept
# alongside it. Process-local and lock-guarded; the counters remain the source of
# truth for any cross-process rate.
_hit_rate_lock = threading.Lock()
_hit_rate_tally: Dict[str, list] = {}  # key_type -> [hits, lookups]


def _bump_hit_rate(key_type: str, hit: bool) -> None:
    with _hit_rate_lock:
        tally = _hit_rate_tally.setdefault(key_type, [0, 0])
        tally[0] += 1 if hit else 0
        tally[1] += 1
        rate = tally[0] / tally[1]
    cache_hit_rate.labels(key_type=key_type).set(rate)


def record_cache_hit(key_type: str) -> None:
    """Count a cache hit and refresh the hit-rate gauge for that key type."""
    cache_hits.labels(key_type=key_type).inc()
    _bump_hit_rate(key_type, True)


def record_cache_miss(key_type: str) -> None:
    """Count a cache miss and refresh the hit-rate gauge for that key type."""
    cache_misses.labels(key_type=key_type).inc()
    _bump_hit_rate(key_type, False)


def record_db_operation(collection: str, operation: str, count: int = 1) -> None:
    """Count DB operations, e.g. record_db_operation('leads', 'find')."""
    db_operations.labels(collection=collection, operation=operation).inc(count)


def record_import(rows_ok: int = 0, rows_failed: int = 0, elapsed: float | None = None) -> None:
    """Record the outcome of one import run (row counts + wall time)."""
    if rows_ok:
        import_rows.labels(status="success").inc(rows_ok)
    if rows_failed:
        import_rows.labels(status="failed").inc(rows_failed)
    if elapsed is not None:
        import_duration.observe(elapsed)


def observe_query(endpoint: str, elapsed: float, status: str = "success") -> None:
    """Record one query latency sample without using the decorator."""
    query_duration.labels(endpoint=endpoint, status=status).observe(elapsed)


def track_query_time(endpoint_name: str) -> Callable:
    """Time a handler and record it under `endpoint_name`.

    Wraps sync and async callables alike, and keeps `functools.wraps` so the
    wrapped signature survives — FastAPI reads the signature to build dependency
    injection, and a bare `*args, **kwargs` wrapper would silently strip every
    parameter off a decorated route. The original exception always propagates;
    only the recorded `status` label changes.
    """

    def decorator(func: Callable) -> Callable:
        if inspect.iscoroutinefunction(func):

            @functools.wraps(func)
            async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
                start = time.perf_counter()
                status = "success"
                try:
                    return await func(*args, **kwargs)
                except Exception:
                    status = "error"
                    raise
                finally:
                    observe_query(endpoint_name, time.perf_counter() - start, status)

            return async_wrapper

        @functools.wraps(func)
        def sync_wrapper(*args: Any, **kwargs: Any) -> Any:
            start = time.perf_counter()
            status = "success"
            try:
                return func(*args, **kwargs)
            except Exception:
                status = "error"
                raise
            finally:
                observe_query(endpoint_name, time.perf_counter() - start, status)

        return sync_wrapper

    return decorator


def render_latest() -> Tuple[bytes, str]:
    """Exposition payload + content type for a future `GET /metrics` route."""
    if not METRICS_ENABLED or generate_latest is None:
        return b"", CONTENT_TYPE_LATEST
    return generate_latest(REGISTRY), CONTENT_TYPE_LATEST
