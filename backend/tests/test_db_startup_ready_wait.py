"""Startup race fix — _wait_for_db_ready() in database.py.

Covers the silent-startup-failure bug: at container start, Atlas connections are
cold (SRV DNS + TLS handshake routinely exceeds the client's
serverSelectionTimeoutMS=5000), so the FIRST database operation in connect_db()
could raise ServerSelectionTimeoutError while every later one succeeded. Because
every downstream startup step (index creation, the field-definition seed,
backfills) is individually wrapped in a non-fatal guard, that first failure was
silent — in production it left the field-definition seed un-run, so phone/source/
notes import column aliases went stale and CSV columns were silently dropped.

_wait_for_db_ready() is a bounded, non-fatal readiness ping loop added at the top
of connect_db(), before any of that startup work runs. These tests exercise the
helper directly against a fake db object — no real Mongo connection is made.

Run with:
    DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 \
        python -m pytest tests/test_db_startup_ready_wait.py -q
"""

import asyncio
import logging
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest

import database as db_module


def _run(coro):
    return asyncio.run(coro)


class _FakePingError(Exception):
    """Stand-in for pymongo's ServerSelectionTimeoutError — the helper catches
    generic Exception, so the real error type isn't load-bearing here."""


class FakeDb:
    """Fake db whose .command('ping') raises on the first `fail_times` calls,
    then succeeds. Records how many times it was called."""

    def __init__(self, fail_times: int = 0, always_fail: bool = False):
        self.fail_times = fail_times
        self.always_fail = always_fail
        self.calls = 0

    async def command(self, name):
        self.calls += 1
        if self.always_fail or self.calls <= self.fail_times:
            raise _FakePingError(f"fake server selection timeout (call {self.calls})")
        return {"ok": 1}


# ── returns promptly on first success ───────────────────────────────────────

def test_returns_promptly_when_first_ping_succeeds():
    fake = FakeDb(fail_times=0)
    _run(db_module._wait_for_db_ready(fake, timeout_s=5.0, interval_s=1.0))
    assert fake.calls == 1


def test_first_ping_success_is_silent(caplog):
    fake = FakeDb(fail_times=0)
    with caplog.at_level(logging.INFO, logger=None):
        _run(db_module._wait_for_db_ready(fake, timeout_s=5.0, interval_s=1.0))
    # Happy path: no "ready after" / warmed-up log noise on the very first attempt.
    assert not any("ready after" in r.message for r in caplog.records)


# ── retries then succeeds, and reports having waited ────────────────────────

def test_retries_and_succeeds_after_n_failures():
    fake = FakeDb(fail_times=3)
    _run(db_module._wait_for_db_ready(fake, timeout_s=5.0, interval_s=0.01))
    assert fake.calls == 4  # 3 failures + 1 success


def test_reports_having_waited_when_it_retried(caplog):
    fake = FakeDb(fail_times=2)
    with caplog.at_level(logging.INFO, logger=None):
        _run(db_module._wait_for_db_ready(fake, timeout_s=5.0, interval_s=0.01))
    assert any(
        r.levelno == logging.INFO and "ready after" in r.message
        for r in caplog.records
    )


# ── gives up after its bound without raising ────────────────────────────────

def test_gives_up_after_timeout_and_returns_normally():
    fake = FakeDb(always_fail=True)
    # Small bounds so the test stays fast; behavior is the same shape as prod
    # bounds, just compressed.
    _run(db_module._wait_for_db_ready(fake, timeout_s=0.05, interval_s=0.01))
    assert fake.calls >= 1  # it did try


def test_gives_up_logs_error_when_every_ping_fails(caplog):
    fake = FakeDb(always_fail=True)
    with caplog.at_level(logging.ERROR, logger=None):
        _run(db_module._wait_for_db_ready(fake, timeout_s=0.05, interval_s=0.01))
    assert any(
        r.levelno == logging.ERROR and "unreachable" in r.message
        for r in caplog.records
    )


# ── never propagates an exception ───────────────────────────────────────────

def test_never_raises_when_db_permanently_unreachable():
    fake = FakeDb(always_fail=True)
    try:
        _run(db_module._wait_for_db_ready(fake, timeout_s=0.05, interval_s=0.01))
    except Exception as e:  # pragma: no cover - the point of the test is that we don't get here
        pytest.fail(f"_wait_for_db_ready raised instead of returning: {e!r}")


def test_never_raises_with_none_db():
    # connect_db() guards on `db is None` before calling this, but the helper
    # itself should still be inert/safe if ever called with None directly.
    try:
        _run(db_module._wait_for_db_ready(None, timeout_s=0.05, interval_s=0.01))
    except Exception as e:  # pragma: no cover
        pytest.fail(f"_wait_for_db_ready raised on db=None: {e!r}")
