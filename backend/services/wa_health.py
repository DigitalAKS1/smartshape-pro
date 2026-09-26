"""WhatsApp health (spec 2026-09-24, W1 -> Infrastructure -> Health).

Two halves:
  * run_wa_health_pass (hourly, scheduler.wa_health_loop): ask Evolution for every number's
    connection state, correct wa_instances.state, and tell people when a number drops.
  * record_host_health: written by scripts/ss-wa-health.sh from the HOST (the container
    cannot see the VPS's real free memory) into settings{type:"wa_health"}; read here and by
    the admin page (D7 RAM headroom).

Rulings (review, 2026-09-24):
  1. This sweep never changes a `paused` or `qr` instance's `state` — only `evolution_state`.
     It never un-pauses (only an admin can, from Settings -> WhatsApp).
  2. A disconnect alert is deduped ONE per instance per IST day with an atomic claim on the
     instance (`health_alert_day`), the same pattern the webhook uses for `close_alert_day`
     (routes/wa_routes.py `_on_close`) — safe against two overlapping sweeps.
  3. Evolution `open` while our row still says `disconnected` self-heals to `connected` and
     clears `health_alert_day`, so a genuine new drop later the same day can alert again.
  4. Evolution unreachable for every checked instance marks the whole sweep `evolution_down` in
     settings{type:"wa_health"} (self-healing back to False once it answers again), alerts admins
     once per day, and never touches an instance row.
  5. `wa_health.mem_available_mb < RAM_HEADROOM_MIN_MB` on a FRESH reading alerts admins once
     per IST day; a stale reading raises nothing (reported as `health_stale`).
"""
import logging
from datetime import timedelta
from typing import Optional

from services import wa_send
from services.evolution_client import evolution
from services.wa_config import RAM_HEADROOM_MIN_MB

log = logging.getLogger("wa_health")
HEALTH_STALE_HOURS = 3


async def record_host_health(db, mem_available_mb: int, mem_total_mb: int, evolution_mem_mb: int,
                             *, at: Optional[str] = None) -> dict:
    doc = {"type": "wa_health", "mem_available_mb": int(mem_available_mb), "mem_total_mb": int(mem_total_mb),
           "evolution_mem_mb": int(evolution_mem_mb), "at": at or wa_send._iso(wa_send._now())}
    await db.settings.update_one({"type": "wa_health"}, {"$set": doc}, upsert=True)
    return doc


async def run_wa_health_pass(db) -> dict:
    now = wa_send._now()
    now_iso = wa_send._iso(now)
    day = wa_send.ist_day(now)
    admins = await wa_send.admin_emails(db)
    rows = await db.wa_instances.find({"state": {"$in": ["qr", "connected", "disconnected", "paused"]}},
                                      {"_id": 0}).to_list(100)
    checked = changed = unreachable = 0
    for inst in rows:
        name = inst["instance_name"]
        checked += 1
        try:
            st = await evolution.connection_state(name, token=inst.get("instance_token") or None)
        except Exception as e:
            unreachable += 1
            log.warning("[wa-health] %s: %s", name, str(e)[:120])
            await db.wa_instances.update_one({"instance_name": name}, {"$set": {
                "last_checked_at": now_iso, "evolution_state": "unreachable"}})
            continue
        cur = inst.get("state")
        new = cur
        if st == "open" and cur in ("disconnected", "qr"):
            new = "connected"
        elif st != "open" and cur == "connected":
            new = "disconnected"
        sets = {"last_checked_at": now_iso, "evolution_state": st}
        if new != cur:
            sets.update({"state": new, "state_at": now_iso})
            changed += 1
        await db.wa_instances.update_one({"instance_name": name}, {"$set": sets})
        if cur == "connected" and new == "disconnected":
            # Ruling 2: an atomic claim on the instance, independent of whether the previous bell
            # was read, and safe against two overlapping sweeps double-alerting.
            claim = await db.wa_instances.update_one(
                {"instance_name": name, "health_alert_day": {"$ne": day}},
                {"$set": {"health_alert_day": day}})
            if getattr(claim, "modified_count", 0) != 1:
                continue
            company = inst.get("kind") == "company"
            who = "The company WhatsApp number" if company else \
                f"{inst.get('label') or inst.get('owner_email') or name}'s WhatsApp number"
            await wa_send.alert(
                db, emails=([] if company else [inst.get("owner_email")]) + admins,
                title="Company WhatsApp disconnected" if company else "A WhatsApp number disconnected",
                body=(f"{who} (+{inst.get('phone_e164') or '?'}) is no longer connected (hourly check). "
                      + ("Messages for unowned records are held until it is relinked in Settings → WhatsApp."
                         if company else "Relink it on My WhatsApp; until then the company number sends.")),
                dedup_key=f"wa_close:{name}:{day}", ref_id=name)
        elif cur == "disconnected" and new == "connected":
            # Ruling 3: self-heal. A fresh drop later today should still be able to alert.
            await db.wa_instances.update_one({"instance_name": name}, {"$unset": {"health_alert_day": ""}})
    if rows and unreachable == len(rows):
        # Ruling 4: the sweep itself is down — say so in settings{type:"wa_health"} (self-heals
        # back to False the next time Evolution answers), never touch an instance row.
        await db.settings.update_one({"type": "wa_health"}, {"$set": {
            "type": "wa_health", "evolution_down": True, "evolution_down_at": now_iso}}, upsert=True)
        await wa_send.alert(
            db, emails=admins, title="WhatsApp server not answering",
            body=("The WhatsApp (Evolution) server did not answer the hourly check for any number, so nothing "
                  "can be sent. On the server: `docker ps --filter name=smartshape_evolution` and "
                  "`docker logs --tail 100 smartshape_evolution`."),
            dedup_key=f"wa_down:{day}")
    elif rows:
        await db.settings.update_one({"type": "wa_health"}, {"$set": {"evolution_down": False}})
    health = await db.settings.find_one({"type": "wa_health"}, {"_id": 0}) or {}
    stale = (not health.get("at")) or wa_send._parse(health["at"]) < now - timedelta(hours=HEALTH_STALE_HOURS)
    low = (not stale) and int(health.get("mem_available_mb") or 0) < RAM_HEADROOM_MIN_MB
    if low:
        await wa_send.alert(
            db, emails=admins, title="Server memory is low",
            body=(f"Only {health['mem_available_mb']} MB of memory is free on the server (WhatsApp uses "
                  f"{health.get('evolution_mem_mb', '?')} MB). Do not link another WhatsApp number until the server "
                  "is upgraded."),
            dedup_key=f"wa_ram:{day}")
    return {"checked": checked, "changed": changed, "unreachable": unreachable, "ram_low": low,
            "health_stale": stale}
