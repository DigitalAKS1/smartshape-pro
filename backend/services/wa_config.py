"""WhatsApp settings, names and defaults (spec 2026-09-24, D5 / D7).

One settings document, settings{type:"wa"}. Every key has a default here, so a fresh database
behaves safely (warm-up on, business hours on, fallback off, WhatsApp drips and greetings held
until the owner switches them on — Rollout step 2).
"""
import os
import re
from datetime import datetime, timezone

WA_SETTINGS_TYPE = "wa"
# The company number IS the env default instance, so the old `evolution` singleton and the
# company row always name the same Evolution instance.
COMPANY_INSTANCE = os.getenv("WHATSAPP_INSTANCE", "smartshape")

PRIVACY_NOTICE = ("Every message this number sends or receives is visible to managers in the app. "
                  "Link a company number, not your personal one.")

INSTANCE_STATES = ("unlinked", "qr", "connected", "disconnected", "paused")
# States that hold one of the server's `max_instances` slots (an unlinked number frees its slot).
SLOT_STATES = ("qr", "connected", "disconnected", "paused")

# D7: below this much free server memory, do not link another number (admin page + health alert).
RAM_HEADROOM_MIN_MB = 500

WA_DEFAULTS = {
    "warmup_start_cap": 20,
    "warmup_double_every_days": 3,
    "warmup_days": 14,
    "daily_cap": 200,
    "hourly_cap": 30,
    "gap_min_s": 8,
    "gap_max_s": 25,
    "business_start": "09:00",
    "business_end": "19:00",
    "per_contact_per_day": 1,
    "failure_pause_after": 5,
    "number_check_ttl_days": 30,
    "opt_out_keywords": ["STOP", "UNSUBSCRIBE", "बंद", "रोकें"],
    "fallback_provider": "none",
    "max_instances": 4,
    "drip_wa_enabled": False,
    "greetings_enabled": False,
}

_INT_RANGES = {
    "warmup_start_cap": (1, 1000), "warmup_double_every_days": (1, 30), "warmup_days": (0, 60),
    "daily_cap": (1, 2000), "hourly_cap": (1, 500), "gap_min_s": (0, 600), "gap_max_s": (0, 600),
    "per_contact_per_day": (1, 10), "failure_pause_after": (1, 50), "number_check_ttl_days": (1, 365),
    "max_instances": (1, 20),
}
_BOOLS = ("drip_wa_enabled", "greetings_enabled")
_HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


class WaSettingsError(ValueError):
    pass


async def get_wa_settings(db) -> dict:
    doc = await db.settings.find_one({"type": WA_SETTINGS_TYPE}, {"_id": 0}) or {}
    out = {k: (list(v) if isinstance(v, list) else v) for k, v in WA_DEFAULTS.items()}
    for k in WA_DEFAULTS:
        if doc.get(k) is not None:
            out[k] = doc[k]
    return out


def validate_wa_settings(body: dict, current: dict) -> dict:
    out = dict(current)
    for k, v in (body or {}).items():
        if k in _INT_RANGES:
            lo, hi = _INT_RANGES[k]
            try:
                iv = int(v)
            except (TypeError, ValueError):
                raise WaSettingsError(f"{k} must be a whole number")
            if not lo <= iv <= hi:
                raise WaSettingsError(f"{k} must be between {lo} and {hi}")
            out[k] = iv
        elif k in _BOOLS:
            out[k] = bool(v)
        elif k in ("business_start", "business_end"):
            if not isinstance(v, str) or not _HHMM.match(v):
                raise WaSettingsError(f"{k} must be HH:MM (24-hour, IST)")
            out[k] = v
        elif k == "opt_out_keywords":
            words = [str(x).strip() for x in (v if isinstance(v, list) else []) if str(x).strip()]
            if not 1 <= len(words) <= 30 or any(len(w) > 30 for w in words):
                raise WaSettingsError("opt_out_keywords must be 1-30 words, each up to 30 characters")
            out[k] = words
        elif k == "fallback_provider":
            if v not in ("none", "autosender"):
                raise WaSettingsError("fallback_provider must be 'none' or 'autosender'")
            out[k] = v
        # any other key is ignored — never stored
    if out["gap_min_s"] > out["gap_max_s"]:
        raise WaSettingsError("gap_min_s cannot be more than gap_max_s")
    if out["business_start"] >= out["business_end"]:
        raise WaSettingsError("business_start must be before business_end")
    if out["warmup_start_cap"] > out["daily_cap"]:
        raise WaSettingsError("warmup_start_cap cannot be more than daily_cap")
    return out


async def save_wa_settings(db, body: dict, *, by: str) -> dict:
    new = validate_wa_settings(body, await get_wa_settings(db))
    await db.settings.update_one(
        {"type": WA_SETTINGS_TYPE},
        {"$set": {**new, "type": WA_SETTINGS_TYPE, "updated_by": by,
                  "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True)
    return new


def rep_instance_name(user: dict) -> str:
    uid = re.sub(r"[^a-z0-9_]", "", str(user.get("user_id") or "").lower())
    if not uid:
        local = str(user.get("email") or "").split("@")[0].lower()
        uid = re.sub(r"[^a-z0-9]+", "_", local).strip("_") or "user"
    return f"rep_{uid}"[:60]
