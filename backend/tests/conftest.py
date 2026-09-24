"""Suite-wide guards. Nothing in the test suite may reach a real network.

1. The `no_dry_run` marker (carried over from the untracked conftest this file replaces).
2. `_no_outbound_network` (autouse): httpx.AsyncClient.send and requests.Session.send raise
   NetworkBlocked unless the transport is in-process (ASGITransport / MockTransport), so the
   route tests that drive the FastAPI app through httpx keep working.
3. `_no_real_evolution` (autouse): every EvolutionClient network entry point raises. A WhatsApp
   test that needs Evolution to answer uses the `fake_evolution` fixture (below), a recorder.

A test that needs a real network does not exist in this suite and must not be added.
"""
import inspect
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import httpx
import pytest
import requests

from services import evolution_client as _ec


def pytest_configure(config):
    config.addinivalue_line(
        "markers", "no_dry_run: run only with the server started WITHOUT CALENDAR_INVITE_DRY_RUN")


class NetworkBlocked(AssertionError):
    """A test tried to leave the machine."""


_IN_PROCESS = tuple(t for t in (getattr(httpx, "ASGITransport", None),
                                getattr(httpx, "MockTransport", None)) if t)
_REAL_HTTPX_SEND = httpx.AsyncClient.send
_REAL_EVO = {name: fn for name, fn in vars(_ec.EvolutionClient).items()
             if inspect.iscoroutinefunction(fn)}


@pytest.fixture(autouse=True)
def _no_outbound_network(monkeypatch):
    async def _guarded_send(self, request, *a, **k):
        if isinstance(getattr(self, "_transport", None), _IN_PROCESS):
            return await _REAL_HTTPX_SEND(self, request, *a, **k)
        raise NetworkBlocked(f"a test tried to reach {request.method} {request.url}")
    monkeypatch.setattr(httpx.AsyncClient, "send", _guarded_send)

    def _blocked(self, request, **k):
        raise NetworkBlocked(f"a test tried to reach {request.method} {request.url}")
    monkeypatch.setattr(requests.Session, "send", _blocked)


@pytest.fixture(autouse=True)
def _no_real_evolution(monkeypatch):
    def _make(name):
        async def _blocked(self, *a, **k):
            raise NetworkBlocked(f"EvolutionClient.{name} called without the fake_evolution fixture")
        return _blocked
    for name in _REAL_EVO:
        if name == "is_connected":      # only calls get_status, and swallows its error by design
            continue
        monkeypatch.setattr(_ec.EvolutionClient, name, _make(name))
