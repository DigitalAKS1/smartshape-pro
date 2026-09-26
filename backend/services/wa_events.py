"""W2 event bus: what the inbox UI listens to (spec W2 "Live updates").

    publish(event)      never raises; adds "at"; sends the JSON to the Redis channel `wa:events`
                        (so every backend process hears it) AND fans it out to this process's
                        local subscribers. Redis down / slow / absent only costs a warning (at
                        most one a minute): the local fan-out always runs, and prod is one
                        backend process today.
    subscribe()         an async generator a consumer (the SSE route, Task 4) iterates; it
                        registers a bounded local queue (QUEUE_MAX; a full queue drops its
                        OLDEST event) and starts, once per process, the Redis listener.
    _redis_listener()   pubsub on `wa:events`; every decoded event goes to the local queues
                        EXCEPT one this process published itself (`_local_origin` == PROCESS_ID:
                        it was fanned out at publish time, and must not be delivered twice).
                        Retries every LISTENER_RETRY_S while Redis is unreachable.

Event shapes (every one carries the scope fields the SSE route filters on):
    {"type": "message_new" | "message_status" | "chat_updated" | "instance_state",
     "instance_name", "chat_id", "contact_id", "lead_id", "school_id",
     "message_id"?, "status"?, "direction"?, "preview"?, "unread_count"?, "at"}
"""
import asyncio
import inspect
import json
import logging
import time
from uuid import uuid4

from services import wa_send

log = logging.getLogger("wa_events")

PROCESS_ID = uuid4().hex
CHANNEL = "wa:events"
QUEUE_MAX = 200
QUEUE_MAXSIZE = QUEUE_MAX               # the Task 2 stub's name for the same limit
PUBLISH_TIMEOUT = 0.5                   # seconds a publish may wait on Redis before giving up
SUBSCRIBE_TIMEOUT = 2.0
LISTENER_RETRY_S = 15.0
WARN_EVERY_S = 60.0

_queues: set = set()                    # local asyncio.Queue subscribers (a consumer registers its own)
_listener_task = None
_last_redis_warning = 0.0


# ── Redis access (lazy, guarded) ─────────────────────────────────────────────

def _redis():
    """cache.redis_client (connects lazily; nothing is opened by importing it), or None when the
    cache module cannot be imported at all."""
    try:
        from cache import redis_client
        return redis_client
    except Exception as e:                                       # pragma: no cover - redis not installed
        _warn("client", e)
        return None


def _warn(what: str, e: BaseException) -> None:
    """One WARNING a minute for Redis trouble (the bus keeps working locally); the rest at DEBUG."""
    global _last_redis_warning
    msg = str(e)[:160] or type(e).__name__
    now = time.monotonic()
    if now - _last_redis_warning < WARN_EVERY_S:
        log.debug("[wa-events] redis %s failed (local fan-out only): %s", what, msg)
        return
    _last_redis_warning = now
    log.warning("[wa-events] redis %s failed (local fan-out only): %s", what, msg)


# ── Local fan-out ────────────────────────────────────────────────────────────

def _fan_out_local(event: dict) -> None:
    """Put a copy of `event` on every registered queue; a full queue drops its oldest item.
    The wire-only `_local_origin` marker never reaches a consumer."""
    ev = {k: v for k, v in (event or {}).items() if k != "_local_origin"}
    for q in list(_queues):
        try:
            if q.full():
                try:
                    q.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            q.put_nowait(dict(ev))
        except Exception as e:                       # a closed/foreign queue never breaks the caller
            log.debug("[wa-events] local fan-out skipped a queue: %s", str(e)[:120])


async def publish(event: dict) -> None:
    """Never raises. Adds "at" (UTC ISO), stamps this process as the origin, sends the JSON to
    Redis (bounded by PUBLISH_TIMEOUT) and fans the event out locally whatever Redis did."""
    try:
        ev = dict(event or {})
        ev["at"] = ev.get("at") or wa_send._iso(wa_send._now())
        ev.setdefault("_local_origin", PROCESS_ID)
        payload = None
        try:
            payload = json.dumps(ev, default=str)
        except Exception as e:
            log.warning("[wa-events] event not JSON-encodable, local delivery only: %s", str(e)[:160])
        if payload is not None:
            try:
                client = _redis()
                if client is not None:
                    await asyncio.wait_for(client.publish(CHANNEL, payload), PUBLISH_TIMEOUT)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                _warn("publish", e)
        _fan_out_local(ev)
    except asyncio.CancelledError:
        raise
    except Exception as e:
        log.warning("[wa-events] publish failed: %s", str(e)[:160])


# ── Subscribers ──────────────────────────────────────────────────────────────

async def subscribe():
    """Yields events for this process (published here, or heard from Redis) until the consumer
    stops iterating or is cancelled; the queue is unregistered either way."""
    q: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_MAX)
    _queues.add(q)
    _ensure_listener()
    try:
        while True:
            yield await q.get()
    finally:
        _queues.discard(q)


def _ensure_listener() -> None:
    """Start the Redis listener once per process (per running loop: a task left behind by a
    closed loop, as in tests, is replaced)."""
    global _listener_task
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    t = _listener_task
    if t is not None and not t.done():
        try:
            if t.get_loop() is loop:
                return
        except Exception:
            pass
    _listener_task = loop.create_task(_redis_listener(), name="wa-events-redis-listener")


# ── The Redis side ───────────────────────────────────────────────────────────

def _handle_redis_message(raw) -> bool:
    """One payload from the channel. Returns True when it was fanned out locally; False for our
    own echo (already delivered at publish time), junk, or anything that is not an event."""
    try:
        if isinstance(raw, (bytes, bytearray)):
            raw = raw.decode("utf-8", "replace")
        if not isinstance(raw, str):
            return False
        ev = json.loads(raw)
    except Exception as e:
        log.debug("[wa-events] undecodable message on %s: %s", CHANNEL, str(e)[:120])
        return False
    if not isinstance(ev, dict):
        return False
    if ev.get("_local_origin") == PROCESS_ID:
        return False
    _fan_out_local(ev)
    return True


async def _close_pubsub(ps) -> None:
    if ps is None:
        return
    try:
        close = getattr(ps, "aclose", None) or getattr(ps, "close", None)
        if close is not None:
            r = close()
            if inspect.isawaitable(r):
                await asyncio.wait_for(r, 1.0)
    except Exception:
        pass


async def _redis_listener() -> None:
    """Runs for the life of the process: subscribe, deliver, and on any failure warn (rate
    limited) and retry after LISTENER_RETRY_S. Cancellation closes the pubsub and stops."""
    while True:
        ps = None
        try:
            client = _redis()
            if client is None:
                raise ConnectionError("no redis client")
            ps = client.pubsub()
            await asyncio.wait_for(ps.subscribe(CHANNEL), SUBSCRIBE_TIMEOUT)
            log.info("[wa-events] listening on %s", CHANNEL)
            async for msg in ps.listen():
                if isinstance(msg, dict) and msg.get("type") == "message":
                    _handle_redis_message(msg.get("data"))
            raise ConnectionError("pubsub stream ended")
        except asyncio.CancelledError:
            await _close_pubsub(ps)
            raise
        except Exception as e:
            _warn("listener", e)
        await _close_pubsub(ps)
        await asyncio.sleep(LISTENER_RETRY_S)
