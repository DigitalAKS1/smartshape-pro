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
    """Every EvolutionClient method funnels through _request, so blocking it blocks them all."""
    async def _blocked(self, method, path, **k):
        raise NetworkBlocked(f"EvolutionClient {method} {path} called without the fake_evolution fixture")
    monkeypatch.setattr(_ec.EvolutionClient, "_request", _blocked)


class FakeEvolution:
    """Stands in for the Evolution server. `calls` holds every request; `sends` the
    sendText/sendMedia ones as {instance, number, text, media, mediatype, token}."""

    def __init__(self):
        self.calls, self.sends = [], []
        self.fail_sends = False
        self.fail_with = "provider rejected the message"
        self.not_on_whatsapp = set()
        self.check_raises = False
        self.state = {}
        self.owner_jid = {}
        self.on_send = None
        self.fail_if = None
        self.create_status = None
        self._n = 0

    async def request(self, method, path, json=None, token=None):
        self.calls.append({"method": method, "path": path, "json": json, "token": token})
        tail = path.split("?")[0].rstrip("/").split("/")[-1]
        if path.startswith("/message/send"):
            if self.fail_sends or (self.fail_if and self.fail_if()):
                raise _ec.EvolutionError(500, self.fail_with)
            self._n += 1
            rec = {"instance": tail, "number": json.get("number"),
                   "text": json.get("text", json.get("caption", "")),
                   "media": json.get("media"), "mediatype": json.get("mediatype"), "token": token}
            self.sends.append(rec)
            if self.on_send:
                await self.on_send(rec)          # may raise to simulate a provider error
            return {"key": {"id": f"PMID{self._n}", "fromMe": True,
                            "remoteJid": f"{json.get('number')}@s.whatsapp.net"}, "status": "PENDING"}
        if path.startswith("/chat/whatsappNumbers/"):
            if self.check_raises:
                raise _ec.EvolutionError(500, "check failed")
            return [{"number": n, "exists": n not in self.not_on_whatsapp, "jid": f"{n}@s.whatsapp.net"}
                    for n in json.get("numbers", [])]
        if path == "/instance/create":
            if self.create_status:
                raise _ec.EvolutionError(self.create_status, "This name is already in use.")
            name = json["instanceName"]
            self.state.setdefault(name, "connecting")
            return {"instance": {"instanceName": name, "status": "created"}, "hash": f"tok_{name}"}
        if path.startswith("/instance/connect/"):
            return {"code": "2@abc", "base64": "data:image/png;base64,QR", "count": 1}
        if path.startswith("/instance/connectionState/"):
            return {"instance": {"instanceName": tail, "state": self.state.get(tail, "close")}}
        if path.startswith("/instance/fetchInstances"):
            name = path.split("instanceName=")[-1]
            return [{"name": name, "connectionStatus": self.state.get(name, "close"),
                     "ownerJid": self.owner_jid.get(name)}]
        if path.startswith("/instance/logout/"):
            self.state[tail] = "close"
            return {"status": "SUCCESS"}
        return {}


@pytest.fixture()
def fake_evolution(monkeypatch):
    fake = FakeEvolution()

    async def _request(self, method, path, *, json=None, token=None, timeout=None):
        return await fake.request(method, path, json=json, token=token)
    monkeypatch.setattr(_ec.EvolutionClient, "_request", _request)
    return fake


@pytest.fixture()
def wa_env(monkeypatch, fake_evolution):
    """A fresh mongomock db wired into the WhatsApp service, the clock at 11:00 IST on
    Thu 24 Sep 2026, and recorders for Evolution, sleeps and pushes."""
    from mongomock_motor import AsyncMongoMockClient
    from wa_fixtures import wire_wa
    return wire_wa(monkeypatch, AsyncMongoMockClient()["smartshape_test"], fake_evolution)
