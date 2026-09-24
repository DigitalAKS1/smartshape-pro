"""Shared WhatsApp test wiring — not a test module (no test_ prefix). `from wa_fixtures import …`."""
from datetime import datetime, timezone
from types import SimpleNamespace

T_1100_IST = datetime(2026, 9, 24, 5, 30, tzinfo=timezone.utc)   # Thu 24 Sep 2026, 11:00 IST
FAST = {"gap_min_s": 0, "gap_max_s": 0}
COMPANY = "smartshape"
OLD = "2026-01-01T00:00:00+00:00"                                 # a number well past warm-up


def wire_wa(monkeypatch, db, fake_evolution, *, now=T_1100_IST):
    """Point every module the WhatsApp service writes through at `db`, freeze the clock, and
    record sleeps and pushes. The Evolution server is `fake_evolution` (conftest)."""
    import notify
    import services.engagement as engagement
    import services.wa_send as ws
    monkeypatch.setattr(notify, "db", db)
    monkeypatch.setattr(engagement, "db", db)
    clock = {"now": now, "slept": []}
    monkeypatch.setattr(ws, "_now", lambda: clock["now"])

    async def _sleep(s):
        clock["slept"].append(s)
    monkeypatch.setattr(ws, "_sleep", _sleep)
    pushes = []

    async def _push(email, title, body):
        pushes.append({"email": email, "title": title, "body": body})
    monkeypatch.setattr(ws, "_push", _push)
    return SimpleNamespace(db=db, evo=fake_evolution, clock=clock, pushes=pushes)


async def seed_user(db, email, *, role="sales", user_id=None, phone="", **extra):
    doc = {"email": email, "name": email.split("@")[0].title(), "role": role,
           "user_id": user_id or f"user_{email.split('@')[0].replace('.', '')}", "phone": phone,
           "is_active": True, **extra}
    await db.users.insert_one(dict(doc))
    return doc


async def seed_instance(db, name, *, kind="rep", owner_email="", state="connected", phone="",
                        warmup_started_at=OLD, **extra):
    doc = {"instance_name": name, "kind": kind, "owner_email": owner_email, "label": name, "state": state,
           "phone_e164": phone, "jid": f"{phone}@s.whatsapp.net" if phone else "",
           "instance_token": f"tok_{name}", "warmup_started_at": warmup_started_at,
           "daily_cap_override": None, "consecutive_failures": 0, "paused_reason": "", "proxy": {},
           "created_at": OLD, **extra}
    await db.wa_instances.insert_one(dict(doc))
    if kind == "rep" and owner_email:
        await db.users.update_one({"email": owner_email}, {"$set": {"wa_instance_name": name}}, upsert=True)
    return doc


async def seed_wa(db, *, company="connected", reps=None, settings=None):
    """company: the company number's state, or None for no company row.
    reps: {email: state}; each rep gets a number rep_<local-part>. settings: overrides (FAST by default)."""
    await db.settings.update_one({"type": "wa"}, {"$set": {"type": "wa", **FAST, **(settings or {})}}, upsert=True)
    if company:
        await seed_instance(db, COMPANY, kind="company", state=company, phone="919000000001")
    for i, (email, state) in enumerate((reps or {}).items()):
        await seed_instance(db, f"rep_{email.split('@')[0].replace('.', '')}", owner_email=email,
                            state=state, phone=f"9190000001{i:02d}")
