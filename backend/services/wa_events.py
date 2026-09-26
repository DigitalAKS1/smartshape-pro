"""W2 event bus — MINIMAL local-only stub (Task 2 pre-flight ruling).

Task 3 replaces this with the Redis pub/sub version (`subscribe()`, `_redis_listener()`,
`_handle_redis_message()`); the surface `ingest` relies on stays the same:
`PROCESS_ID`, `_queues`, `publish(event)` (never raises, adds "at") and `_fan_out_local(event)`.
"""
import asyncio
import logging
from uuid import uuid4

from services import wa_send

log = logging.getLogger("wa_events")

PROCESS_ID = uuid4().hex
QUEUE_MAXSIZE = 200
_queues: set = set()            # local asyncio.Queue subscribers (a consumer registers its own)


def _fan_out_local(event: dict) -> None:
    """Put a copy of `event` on every registered queue; a full queue drops its oldest item."""
    for q in list(_queues):
        try:
            if q.full():
                try:
                    q.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            q.put_nowait(dict(event))
        except Exception as e:                       # a closed/foreign queue never breaks the caller
            log.debug("[wa-events] local fan-out skipped a queue: %s", str(e)[:120])


async def publish(event: dict) -> None:
    """Never raises. Adds "at" (UTC ISO) and fans the event out locally."""
    try:
        ev = dict(event or {})
        ev["at"] = ev.get("at") or wa_send._iso(wa_send._now())
        ev.setdefault("_local_origin", PROCESS_ID)
        _fan_out_local(ev)
    except Exception as e:
        log.warning("[wa-events] publish failed: %s", str(e)[:160])
