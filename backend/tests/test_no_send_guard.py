"""The suite-wide guard: nothing in the test suite may reach a real network.

Pinned here so a later edit to conftest.py that weakens the guard fails loudly.
Run:
    DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 \
    python -m pytest tests/test_no_send_guard.py -q
"""
import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import httpx
import pytest
import requests
from fastapi import FastAPI

from conftest import NetworkBlocked
from services.evolution_client import EvolutionClient, evolution


def _run(coro):
    return asyncio.run(coro)


def test_httpx_to_the_internet_is_blocked():
    async def go():
        async with httpx.AsyncClient() as c:
            await c.post("https://app.messageautosender.com/message/new", data={"x": "1"})
    with pytest.raises(NetworkBlocked):
        _run(go())


def test_httpx_in_process_asgi_still_works():
    app = FastAPI()

    @app.get("/ping")
    async def ping():
        return {"ok": True}

    async def go():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
            return (await c.get("/ping")).json()
    assert _run(go()) == {"ok": True}


def test_requests_is_blocked():
    with pytest.raises(NetworkBlocked):
        requests.get("https://example.com", timeout=1)


def test_every_evolution_call_is_blocked():
    with pytest.raises(NetworkBlocked):
        _run(evolution.send_text("9811111111", "hi"))
    with pytest.raises(NetworkBlocked):
        _run(EvolutionClient().get_status())


def test_is_connected_swallows_the_block_and_says_no():
    # is_connected() catches every exception by design — the guard must not make it True.
    assert _run(evolution.is_connected()) is False
