"""W2 event bus (services/wa_events.py): Redis pub/sub between backend processes with a local
fan-out that always works — Redis down, slow or absent never loses a local subscriber an event.

Run:
    DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 \
    python -m pytest tests/test_wa_events.py -q -p no:cacheprovider
"""
import asyncio
import json
import logging
import os
import time

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest

import cache
from services import wa_events
from wa_fixtures import redis_down


@pytest.fixture(autouse=True)
def bus(monkeypatch):
    """Redis unreachable (no socket is ever opened), a fast listener retry, the once-a-minute
    warning reset, and no queue left over from another test."""
    redis_down(monkeypatch)
    monkeypatch.setattr(wa_events, "_last_redis_warning", 0.0)
    wa_events._queues.clear()
    yield
    wa_events._queues.clear()


def _run(coro):
    return asyncio.run(coro)


def _consumer(got: list):
    """A task that runs `subscribe()` and appends every event to `got`; its queue is registered
    once the loop has run it to its first await (one `sleep(0)`)."""
    async def run():
        async for ev in wa_events.subscribe():
            got.append(ev)
    return asyncio.ensure_future(run())


def _drain(q):
    out = []
    while not q.empty():
        out.append(q.get_nowait())
    return out


# ── the four named tests ─────────────────────────────────────────────────────

def test_publish_reaches_a_local_subscriber_without_redis():
    async def go():
        agen = wa_events.subscribe()
        first = asyncio.ensure_future(agen.__anext__())
        await asyncio.sleep(0)                                  # the queue is registered
        assert len(wa_events._queues) == 1
        await wa_events.publish({"type": "message_new", "chat_id": "c1"})
        ev = await asyncio.wait_for(first, 1)
        assert ev["type"] == "message_new" and ev["chat_id"] == "c1" and ev["at"]
        assert "_local_origin" not in ev                        # wire-only marker never reaches a consumer
        await agen.aclose()
        assert len(wa_events._queues) == 0
    _run(go())


def test_a_redis_echo_of_our_own_event_is_not_delivered_twice():
    async def go():
        got = []
        task = _consumer(got)
        await asyncio.sleep(0)
        ev = {"type": "message_new", "chat_id": "c1", "message_id": "wam_1"}
        await wa_events.publish(ev)
        # what Redis would hand back to every process, this one included
        assert wa_events._handle_redis_message(
            json.dumps({**ev, "at": "2026-09-26T00:00:00+00:00", "_local_origin": wa_events.PROCESS_ID})) is False
        await asyncio.sleep(0)
        assert len(got) == 1 and got[0]["message_id"] == "wam_1"
        # the same event published by ANOTHER process is delivered
        assert wa_events._handle_redis_message(
            json.dumps({**ev, "message_id": "wam_2", "at": "x", "_local_origin": "someone-else"})) is True
        await asyncio.sleep(0)
        assert [e["message_id"] for e in got] == ["wam_1", "wam_2"] and "_local_origin" not in got[1]
        # junk on the channel is dropped, never raised
        assert wa_events._handle_redis_message("not json") is False
        assert wa_events._handle_redis_message(json.dumps([1, 2])) is False
        assert wa_events._handle_redis_message(None) is False
        await asyncio.sleep(0)
        assert len(got) == 2
        task.cancel()
    _run(go())


def test_a_full_queue_drops_the_oldest_not_the_newest():
    async def go():
        q = asyncio.Queue(maxsize=wa_events.QUEUE_MAX)
        wa_events._queues.add(q)
        for i in range(205):
            await wa_events.publish({"type": "message_new", "n": i})
        assert q.qsize() == 200 and wa_events.QUEUE_MAX == 200
        assert q.get_nowait()["n"] == 5                          # 0..4 were dropped
        assert _drain(q)[-1]["n"] == 204
        # subscribe() registers a queue of that size
        task = _consumer([])
        await asyncio.sleep(0)
        assert [x.maxsize for x in wa_events._queues if x is not q] == [200]
        task.cancel()
    _run(go())


def test_unsubscribe_on_cancel():
    async def go():
        got = []
        task = _consumer(got)
        await asyncio.sleep(0)
        assert len(wa_events._queues) == 1
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert len(wa_events._queues) == 0
        await wa_events.publish({"type": "message_new"})         # nobody listening: nothing breaks
    _run(go())


# ── the Redis side ───────────────────────────────────────────────────────────

def test_a_hung_redis_does_not_block_publish(monkeypatch):
    async def _hang(*a, **k):
        await asyncio.sleep(5)
    monkeypatch.setattr(cache.redis_client, "publish", _hang)
    monkeypatch.setattr(wa_events, "PUBLISH_TIMEOUT", 0.05)

    async def go():
        q = asyncio.Queue()
        wa_events._queues.add(q)
        t0 = time.monotonic()
        await wa_events.publish({"type": "message_new", "chat_id": "c1"})
        assert time.monotonic() - t0 < 1.0
        assert _drain(q)[0]["chat_id"] == "c1"                   # local delivery happened anyway
    _run(go())


def test_publish_sends_the_event_to_redis_when_it_is_up(monkeypatch):
    sent = []

    async def _publish(channel, payload):
        sent.append((channel, payload))
        return 1
    monkeypatch.setattr(cache.redis_client, "publish", _publish)

    async def go():
        q = asyncio.Queue()
        wa_events._queues.add(q)
        await wa_events.publish({"type": "message_status", "chat_id": "c1", "status": "read"})
        assert len(sent) == 1 and sent[0][0] == "wa:events"
        wire = json.loads(sent[0][1])
        assert wire["_local_origin"] == wa_events.PROCESS_ID and wire["status"] == "read" and wire["at"]
        assert _drain(q)[0]["status"] == "read"
    _run(go())


def test_redis_failures_are_logged_once_a_minute(caplog):
    async def go():
        with caplog.at_level(logging.WARNING, logger="wa_events"):
            for _ in range(5):
                await wa_events.publish({"type": "message_new"})
        warnings = [r for r in caplog.records if r.levelname == "WARNING" and "redis" in r.getMessage().lower()]
        assert len(warnings) == 1
    _run(go())


def test_publish_never_raises(monkeypatch):
    async def go():
        class Bad:
            def __repr__(self):
                raise RuntimeError("unprintable")
        await wa_events.publish({"type": "message_new", "weird": Bad()})     # json falls back to str()
        await wa_events.publish(None)
        monkeypatch.setattr(wa_events, "_fan_out_local", lambda ev: (_ for _ in ()).throw(RuntimeError("boom")))
        await wa_events.publish({"type": "message_new"})
    _run(go())


def test_the_listener_retries_while_redis_is_down(monkeypatch, caplog):
    tries = []

    def _pubsub(*a, **k):
        tries.append(1)
        raise ConnectionError("refused")
    monkeypatch.setattr(cache.redis_client, "pubsub", _pubsub)

    async def go():
        with caplog.at_level(logging.WARNING, logger="wa_events"):
            with pytest.raises(asyncio.TimeoutError):
                await asyncio.wait_for(wa_events._redis_listener(), 0.2)
        assert len(tries) >= 3                                   # kept retrying (LISTENER_RETRY_S is 0.01)
        assert any("listener" in r.getMessage() for r in caplog.records)
    _run(go())


class FakePubSub:
    def __init__(self, messages):
        self.messages, self.subscribed, self.closed = messages, [], False

    async def subscribe(self, *channels):
        self.subscribed += channels

    async def listen(self):
        for m in self.messages:
            yield m
        await asyncio.sleep(10)                                  # then hang like a live socket

    async def aclose(self):
        self.closed = True


def test_the_listener_fans_out_foreign_events_and_skips_our_own_echo(monkeypatch):
    ours = json.dumps({"type": "message_new", "message_id": "mine", "_local_origin": wa_events.PROCESS_ID})
    theirs = json.dumps({"type": "message_new", "message_id": "theirs", "_local_origin": "other-process"})
    fake = FakePubSub([{"type": "subscribe", "data": 1}, {"type": "message", "data": ours},
                       {"type": "message", "data": theirs}, {"type": "message", "data": "junk"}])
    monkeypatch.setattr(cache.redis_client, "pubsub", lambda *a, **k: fake)

    async def go():
        q = asyncio.Queue()
        wa_events._queues.add(q)
        task = asyncio.ensure_future(wa_events._redis_listener())
        for _ in range(20):
            await asyncio.sleep(0)
        assert fake.subscribed == ["wa:events"]
        assert [e["message_id"] for e in _drain(q)] == ["theirs"]
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert fake.closed is True
    _run(go())


def test_subscribe_starts_one_listener_per_process(monkeypatch):
    starts = []

    async def _listener():
        starts.append(1)
        await asyncio.sleep(10)
    monkeypatch.setattr(wa_events, "_redis_listener", _listener)

    async def go():
        before = len(starts)
        a, b = _consumer([]), _consumer([])
        for _ in range(3):                                      # the consumers run, then the listener they start
            await asyncio.sleep(0)
        assert len(starts) == before + 1                        # two subscribers, one listener
        a.cancel(); b.cancel()
    _run(go())
    # a new loop (the previous one cancelled its task): the listener starts again
    _run(go())
    assert starts == [1, 1]
