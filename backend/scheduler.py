"""
SmartShape background automation engine.

Four perpetual asyncio loops:
  1. email_sender_loop    — every 2 min: flush email_scheduled queue via SMTP
  2. wa_sender_loop       — every 2 min: flush whatsapp_scheduled queue via WABA provider
  3. drip_executor_loop   — every 1 hr: advance drip enrollments whose next_step_at <= now
  4. greeting_loop        — daily 9am IST: fire greeting rules matching today's MM-DD
"""

import asyncio
import logging
import smtplib
import uuid
from datetime import datetime, timezone, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import httpx

from database import db

log = logging.getLogger("scheduler")

IST = timezone(timedelta(hours=5, minutes=30))


# ══════════════════════════════════════════════════════════════════════════════
# CONFIG HELPERS
# ══════════════════════════════════════════════════════════════════════════════

async def _email_cfg():
    cfg = await db.settings.find_one({"type": "email"}, {"_id": 0})
    if not cfg or not cfg.get("sender_email") or not cfg.get("gmail_app_password"):
        return None
    return cfg["sender_email"], cfg["gmail_app_password"], cfg.get("sender_name", "SmartShape")


async def _wa_cfg():
    cfg = await db.settings.find_one({"type": "whatsapp_provider"}, {"_id": 0})
    if not cfg or cfg.get("provider") in (None, "none", "") or not cfg.get("api_key"):
        return None
    return cfg


# ══════════════════════════════════════════════════════════════════════════════
# SMTP — sync, runs via asyncio.to_thread
# ══════════════════════════════════════════════════════════════════════════════

def _smtp_send(sender_email, app_password, sender_name, to_email, subject, body):
    msg = MIMEMultipart("alternative")
    msg["From"] = f"{sender_name} <{sender_email}>"
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.attach(MIMEText(body, "plain"))
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=20) as smtp:
        smtp.login(sender_email, app_password)
        smtp.sendmail(sender_email, [to_email], msg.as_string())


# ══════════════════════════════════════════════════════════════════════════════
# WA PROVIDER DISPATCH
# ══════════════════════════════════════════════════════════════════════════════

async def _send_via_gupshup(cfg: dict, to_phone: str, message: str):
    headers = {"apikey": cfg["api_key"], "Content-Type": "application/x-www-form-urlencoded"}
    data = {
        "channel": "whatsapp",
        "source": cfg["from_number"],
        "destination": to_phone,
        "message": f'{{"type":"text","text":"{message}"}}',
        "src.name": cfg.get("app_name", "SmartShape"),
    }
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post("https://api.gupshup.io/sm/api/v1/msg", data=data, headers=headers)
        if r.status_code >= 400:
            raise Exception(f"Gupshup {r.status_code}: {r.text[:200]}")


async def _send_via_360dialog(cfg: dict, to_phone: str, message: str):
    headers = {"D360-API-KEY": cfg["api_key"], "Content-Type": "application/json"}
    payload = {
        "messaging_product": "whatsapp",
        "to": to_phone.lstrip("+"),
        "type": "text",
        "text": {"body": message},
    }
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post("https://waba.360dialog.io/v1/messages", json=payload, headers=headers)
        if r.status_code >= 400:
            raise Exception(f"360dialog {r.status_code}: {r.text[:200]}")


async def _send_via_meta(cfg: dict, to_phone: str, message: str):
    """Meta Cloud API (official WABA)."""
    phone_number_id = cfg["phone_number_id"]
    token = cfg["api_key"]
    url = f"https://graph.facebook.com/v19.0/{phone_number_id}/messages"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    payload = {
        "messaging_product": "whatsapp",
        "to": to_phone.lstrip("+"),
        "type": "text",
        "text": {"body": message},
    }
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(url, json=payload, headers=headers)
        if r.status_code >= 400:
            raise Exception(f"Meta {r.status_code}: {r.text[:200]}")


async def _send_wa(cfg: dict, to_phone: str, message: str):
    provider = cfg.get("provider", "")
    if provider == "gupshup":
        await _send_via_gupshup(cfg, to_phone, message)
    elif provider == "360dialog":
        await _send_via_360dialog(cfg, to_phone, message)
    elif provider == "meta":
        await _send_via_meta(cfg, to_phone, message)
    else:
        raise Exception(f"unknown_provider:{provider}")


# ══════════════════════════════════════════════════════════════════════════════
# JOB 1 — Email Queue Processor
# ══════════════════════════════════════════════════════════════════════════════

async def process_email_queue():
    cfg = await _email_cfg()
    if not cfg:
        return

    sender_email, app_password, sender_name = cfg
    pending = await db.email_scheduled.find(
        {"status": "pending"}, {"_id": 0}
    ).limit(30).to_list(30)

    if not pending:
        return

    log.info(f"[email] processing {len(pending)} messages")
    now_iso = datetime.now(timezone.utc).isoformat()

    for msg in pending:
        to_email = (msg.get("to_email") or "").strip()
        if not to_email or "@" not in to_email:
            await db.email_scheduled.update_one(
                {"scheduled_id": msg["scheduled_id"]},
                {"$set": {"status": "failed", "error": "invalid_email", "sent_at": now_iso}},
            )
            await db.email_campaigns.update_one(
                {"campaign_id": msg["campaign_id"]}, {"$inc": {"failed_count": 1}}
            )
            continue

        try:
            await asyncio.to_thread(
                _smtp_send, sender_email, app_password, sender_name,
                to_email,
                msg.get("subject", "Message from SmartShape"),
                msg.get("body", ""),
            )
            await db.email_scheduled.update_one(
                {"scheduled_id": msg["scheduled_id"]},
                {"$set": {"status": "sent", "sent_at": now_iso}},
            )
            await db.email_campaigns.update_one(
                {"campaign_id": msg["campaign_id"]}, {"$inc": {"sent_count": 1}}
            )
            log.info(f"[email] sent → {to_email}")
        except Exception as exc:
            err = str(exc)[:250]
            log.warning(f"[email] failed → {to_email}: {err}")
            await db.email_scheduled.update_one(
                {"scheduled_id": msg["scheduled_id"]},
                {"$set": {"status": "failed", "error": err, "sent_at": now_iso}},
            )
            await db.email_campaigns.update_one(
                {"campaign_id": msg["campaign_id"]}, {"$inc": {"failed_count": 1}}
            )

        await asyncio.sleep(0.5)  # respect Gmail sending rate


# ══════════════════════════════════════════════════════════════════════════════
# JOB 2 — WhatsApp Queue Processor
# ══════════════════════════════════════════════════════════════════════════════

async def process_wa_queue():
    cfg = await _wa_cfg()
    now_iso = datetime.now(timezone.utc).isoformat()

    if not cfg:
        count = await db.whatsapp_scheduled.count_documents({"status": "pending"})
        if count:
            log.debug(f"[wa] {count} pending — WA provider not configured")
        return

    pending = await db.whatsapp_scheduled.find(
        {"status": "pending"}, {"_id": 0}
    ).limit(20).to_list(20)

    if not pending:
        return

    log.info(f"[wa] processing {len(pending)} messages")

    for msg in pending:
        to_phone = (msg.get("to_phone") or "").strip()
        if not to_phone:
            await db.whatsapp_scheduled.update_one(
                {"scheduled_id": msg["scheduled_id"]},
                {"$set": {"status": "failed", "error": "no_phone", "sent_at": now_iso}},
            )
            await db.whatsapp_campaigns.update_one(
                {"campaign_id": msg["campaign_id"]}, {"$inc": {"failed_count": 1}}
            )
            continue

        try:
            await _send_wa(cfg, to_phone, msg.get("message", ""))
            await db.whatsapp_scheduled.update_one(
                {"scheduled_id": msg["scheduled_id"]},
                {"$set": {"status": "sent", "sent_at": now_iso}},
            )
            await db.whatsapp_campaigns.update_one(
                {"campaign_id": msg["campaign_id"]}, {"$inc": {"sent_count": 1}}
            )
            log.info(f"[wa] sent → {to_phone}")
        except Exception as exc:
            err = str(exc)[:250]
            log.warning(f"[wa] failed → {to_phone}: {err}")
            await db.whatsapp_scheduled.update_one(
                {"scheduled_id": msg["scheduled_id"]},
                {"$set": {"status": "failed", "error": err, "sent_at": now_iso}},
            )
            await db.whatsapp_campaigns.update_one(
                {"campaign_id": msg["campaign_id"]}, {"$inc": {"failed_count": 1}}
            )

        await asyncio.sleep(1.0)  # WA rate limiting — 1 msg/sec


# ══════════════════════════════════════════════════════════════════════════════
# JOB 3 — Drip Step Executor
# ══════════════════════════════════════════════════════════════════════════════

async def run_drip_executor():
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()

    active = await db.drip_enrollments.find(
        {"status": "active", "next_step_at": {"$lte": now_iso}},
        {"_id": 0},
    ).to_list(500)

    if not active:
        return

    log.info(f"[drip] {len(active)} enrollments ready for step")
    email_cfg = await _email_cfg()
    wa_cfg = await _wa_cfg()

    for enr in active:
        try:
            seq = await db.drip_sequences.find_one(
                {"sequence_id": enr["sequence_id"]}, {"_id": 0}
            )
            if not seq or not seq.get("steps"):
                await db.drip_enrollments.update_one(
                    {"enrollment_id": enr["enrollment_id"]},
                    {"$set": {"status": "cancelled", "completed_at": now_iso}},
                )
                continue

            steps = sorted(seq["steps"], key=lambda s: s["step_number"])
            enrolled_at_raw = enr["enrolled_at"]
            # Normalize timezone
            if enrolled_at_raw.endswith("Z"):
                enrolled_at_raw = enrolled_at_raw[:-1] + "+00:00"
            enrolled_at = datetime.fromisoformat(enrolled_at_raw)

            current_idx = enr.get("current_step", 0)

            # Find which step is due at this moment
            step_to_fire = None
            next_step_for_after = None
            for i, step in enumerate(steps):
                step_due = enrolled_at + timedelta(days=step["delay_days"])
                if i < current_idx:
                    continue  # already fired
                if step_due <= now:
                    step_to_fire = (i, step)
                else:
                    next_step_for_after = (i, step, step_due)
                    break

            if step_to_fire is None:
                # Recalculate next_step_at based on remaining steps
                if next_step_for_after:
                    _, _, nxt_due = next_step_for_after
                    await db.drip_enrollments.update_one(
                        {"enrollment_id": enr["enrollment_id"]},
                        {"$set": {"next_step_at": nxt_due.isoformat()}},
                    )
                continue

            fire_idx, step = step_to_fire

            # Personalize message
            lead = await db.leads.find_one({"lead_id": enr["lead_id"]}, {"_id": 0})
            if not lead:
                await db.drip_enrollments.update_one(
                    {"enrollment_id": enr["enrollment_id"]},
                    {"$set": {"status": "cancelled", "completed_at": now_iso}},
                )
                continue

            first_name = (lead.get("contact_name") or "").split()[0] or "there"
            school = lead.get("company_name") or "your school"
            text = step["message_template"].replace("{name}", first_name).replace("{school_name}", school)
            msg_type = step.get("message_type", "whatsapp")
            sent = False
            err_detail = ""

            if msg_type == "whatsapp" and wa_cfg:
                phone = lead.get("contact_phone", "")
                if phone:
                    try:
                        await _send_wa(wa_cfg, phone, text)
                        sent = True
                    except Exception as e:
                        err_detail = str(e)[:200]

            elif msg_type == "email" and email_cfg:
                email_addr = lead.get("contact_email", "")
                if email_addr and "@" in email_addr:
                    try:
                        se, ap, sn = email_cfg
                        await asyncio.to_thread(_smtp_send, se, ap, sn, email_addr, "SmartShape", text)
                        sent = True
                    except Exception as e:
                        err_detail = str(e)[:200]

            # Log step
            await db.drip_step_logs.insert_one({
                "log_id": f"dlog_{uuid.uuid4().hex[:10]}",
                "enrollment_id": enr["enrollment_id"],
                "sequence_id": enr["sequence_id"],
                "lead_id": enr["lead_id"],
                "step_number": step["step_number"],
                "message_type": msg_type,
                "status": "sent" if sent else "failed",
                "error": err_detail,
                "fired_at": now_iso,
            })

            new_idx = fire_idx + 1
            if new_idx >= len(steps):
                await db.drip_enrollments.update_one(
                    {"enrollment_id": enr["enrollment_id"]},
                    {"$set": {
                        "status": "completed",
                        "current_step": new_idx,
                        "last_step_at": now_iso,
                        "next_step_at": None,
                        "completed_at": now_iso,
                    }},
                )
                log.info(f"[drip] {enr['enrollment_id']} completed sequence")
            else:
                nxt = steps[new_idx]
                nxt_due = enrolled_at + timedelta(days=nxt["delay_days"])
                await db.drip_enrollments.update_one(
                    {"enrollment_id": enr["enrollment_id"]},
                    {"$set": {
                        "current_step": new_idx,
                        "last_step_at": now_iso,
                        "next_step_at": nxt_due.isoformat(),
                    }},
                )
                log.info(f"[drip] {enr['enrollment_id']} → step {new_idx + 1} (due {nxt_due.date()})")

        except Exception as exc:
            log.error(f"[drip] error on enrollment {enr.get('enrollment_id')}: {exc}")


# ══════════════════════════════════════════════════════════════════════════════
# JOB 4 — Greeting Auto-Fire (9am IST daily)
# ══════════════════════════════════════════════════════════════════════════════

async def run_greeting_sender():
    today_ist = datetime.now(IST)
    today_mmdd = today_ist.strftime("%m-%d")
    today_key = today_ist.strftime("%Y-%m-%d")
    now_iso = datetime.now(timezone.utc).isoformat()

    rules = await db.greeting_rules.find(
        {"trigger": "fixed_date", "fixed_date": today_mmdd, "is_active": True},
        {"_id": 0},
    ).to_list(50)

    if not rules:
        log.debug(f"[greet] no rules for {today_mmdd}")
        return

    log.info(f"[greet] {len(rules)} rules match {today_mmdd}")
    email_cfg = await _email_cfg()
    wa_cfg = await _wa_cfg()

    contacts = await db.contacts.find(
        {"is_deleted": {"$ne": True}},
        {"_id": 0, "first_name": 1, "name": 1, "phone": 1, "email": 1},
    ).to_list(None)

    for rule in rules:
        rule_id = rule.get("rule_id") or rule.get("name")

        already = await db.greeting_fire_log.find_one({"rule_id": rule_id, "fired_date": today_key})
        if already:
            log.debug(f"[greet] {rule_id} already fired today")
            continue

        sent_count = 0
        for contact in contacts:
            first_name = (
                contact.get("first_name") or
                (contact.get("name") or "").split()[0] or
                "there"
            )
            text = rule.get("template_body", "").replace("{name}", first_name)

            if wa_cfg and contact.get("phone"):
                try:
                    await _send_wa(wa_cfg, contact["phone"], text)
                    sent_count += 1
                    await asyncio.sleep(0.8)
                except Exception as exc:
                    log.warning(f"[greet] WA → {contact['phone']}: {exc}")
            elif email_cfg and "@" in (contact.get("email") or ""):
                try:
                    se, ap, sn = email_cfg
                    await asyncio.to_thread(_smtp_send, se, ap, sn, contact["email"], rule["name"], text)
                    sent_count += 1
                    await asyncio.sleep(0.4)
                except Exception as exc:
                    log.warning(f"[greet] email → {contact['email']}: {exc}")

        await db.greeting_fire_log.insert_one({
            "rule_id": rule_id,
            "rule_name": rule.get("name", ""),
            "fired_date": today_key,
            "fired_at": now_iso,
            "sent_count": sent_count,
        })
        await db.greeting_rules.update_one(
            {"name": rule["name"]},
            {"$inc": {"sent_total": sent_count}, "$set": {"last_sent_at": now_iso}},
        )
        log.info(f"[greet] '{rule.get('name')}' → {sent_count} messages sent")


# ══════════════════════════════════════════════════════════════════════════════
# LOOP RUNNERS
# ══════════════════════════════════════════════════════════════════════════════

async def email_sender_loop():
    log.info("[scheduler] email sender started (interval: 2 min)")
    while True:
        try:
            await process_email_queue()
        except Exception as exc:
            log.error(f"[email loop] {exc}")
        await asyncio.sleep(120)


async def wa_sender_loop():
    log.info("[scheduler] WA sender started (interval: 2 min)")
    while True:
        try:
            await process_wa_queue()
        except Exception as exc:
            log.error(f"[wa loop] {exc}")
        await asyncio.sleep(120)


async def drip_executor_loop():
    log.info("[scheduler] drip executor started (interval: 1 hr)")
    while True:
        try:
            await run_drip_executor()
        except Exception as exc:
            log.error(f"[drip loop] {exc}")
        await asyncio.sleep(3600)


async def greeting_loop():
    log.info("[scheduler] greeting loop started (fires daily at 9am IST)")
    while True:
        try:
            now_ist = datetime.now(IST)
            target = now_ist.replace(hour=9, minute=0, second=0, microsecond=0)
            if now_ist >= target:
                target = target + timedelta(days=1)
            sleep_secs = (target - now_ist).total_seconds()
            log.info(f"[greet] next fire in {sleep_secs / 3600:.1f}h")
            await asyncio.sleep(max(60, sleep_secs))
            await run_greeting_sender()
        except Exception as exc:
            log.error(f"[greeting loop] {exc}")
            await asyncio.sleep(3600)


async def start_scheduler():
    """Start all background automation loops. Call once from FastAPI startup."""
    asyncio.create_task(email_sender_loop())
    asyncio.create_task(wa_sender_loop())
    asyncio.create_task(drip_executor_loop())
    asyncio.create_task(greeting_loop())
    log.info("[scheduler] all 4 background jobs running")
