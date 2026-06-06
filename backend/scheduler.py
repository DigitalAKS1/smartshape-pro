"""
SmartShape background automation engine.

Five perpetual asyncio loops:
  1. email_sender_loop    — every 2 min: flush email_scheduled queue via SMTP
  2. wa_sender_loop       — every 2 min: flush whatsapp_scheduled queue via WABA provider
  3. drip_executor_loop   — every 1 hr: advance drip enrollments whose next_step_at <= now
  4. greeting_loop        — daily 9am IST: fire greeting rules matching today's MM-DD
  5. fms_sla_loop         — every 5 min: send SLA breach/escalate/warning notifications
"""

import asyncio
import logging
import os
import smtplib
import uuid
from datetime import datetime, timezone, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import httpx

from database import db
from services.evolution_client import evolution
from routes.fms_routes import get_fms_settings, render_template, pct_remaining
from routes.crm_routes import (
    get_crm_settings, compute_attention, resolve_lead_value,
    _build_quote_map, OPEN_STAGES, create_physical_from_drip,
)

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
        # field stored by email_routes is "email"; legacy records may use "to_email"
        to_email = (msg.get("email") or msg.get("to_email") or "").strip()
        if not to_email or "@" not in to_email:
            await db.email_scheduled.update_one(
                {"scheduled_id": msg["scheduled_id"]},
                {"$set": {"status": "failed", "error": "invalid_email", "sent_at": now_iso}},
            )
            await db.email_campaigns.update_one(
                {"campaign_id": msg["campaign_id"]}, {"$inc": {"failed_count": 1}}
            )
            continue

        # field stored by email_routes is "message"; legacy records may use "body"
        body_text = msg.get("message") or msg.get("body") or ""

        try:
            await asyncio.to_thread(
                _smtp_send, sender_email, app_password, sender_name,
                to_email,
                msg.get("subject", "Message from SmartShape"),
                body_text,
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
        # field stored by whatsapp_routes is "phone"; legacy records may use "to_phone"
        to_phone = (msg.get("phone") or msg.get("to_phone") or "").strip()
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

            if msg_type == "physical_material":
                try:
                    await create_physical_from_drip(lead, step.get("material_type", "brochure"), seq.get("name", "drip"))
                    sent = True
                except Exception as e:
                    err_detail = str(e)[:200]

            elif msg_type == "whatsapp" and wa_cfg:
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
                        subject = seq.get("name", "SmartShape") or "SmartShape"
                        await asyncio.to_thread(_smtp_send, se, ap, sn, email_addr, subject, text)
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

            delivered = False
            if wa_cfg and contact.get("phone"):
                try:
                    await _send_wa(wa_cfg, contact["phone"], text)
                    sent_count += 1
                    delivered = True
                    await asyncio.sleep(0.8)
                except Exception as exc:
                    log.warning(f"[greet] WA → {contact['phone']}: {exc}")
            # Always fall back to email if WA not delivered and contact has email
            if not delivered and email_cfg and "@" in (contact.get("email") or ""):
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


# ══════════════════════════════════════════════════════════════════════════════
# JOB 5 — FMS SLA Notification Engine
# ══════════════════════════════════════════════════════════════════════════════

FMS_DRY_RUN = os.getenv("FMS_NOTIFY_DRY_RUN", "0") == "1"
CRM_DIGEST_DRY_RUN = os.getenv("CRM_DIGEST_DRY_RUN", "0") == "1"


async def _fms_send_wa(phone: str, text: str) -> tuple[bool, str]:
    if not phone:
        return False, "no_phone"
    if FMS_DRY_RUN:
        log.info(f"[fms][dry] WA -> {phone}: {text[:60]}")
        return True, ""
    try:
        await evolution.send_text(phone, text)
        return True, ""
    except Exception as e:
        return False, str(e)[:200]


async def _fms_send_email(to_email: str, subject: str, body: str) -> tuple[bool, str]:
    if not to_email or "@" not in to_email:
        return False, "no_email"
    if FMS_DRY_RUN:
        log.info(f"[fms][dry] EMAIL -> {to_email}: {subject}")
        return True, ""
    cfg = await _email_cfg()
    if not cfg:
        return False, "email_not_configured"
    se, ap, sn = cfg
    try:
        await asyncio.to_thread(_smtp_send, se, ap, sn, to_email, subject, body)
        return True, ""
    except Exception as e:
        return False, str(e)[:200]


async def _resolve_recipient(email: str) -> dict:
    """Return {name, email, phone} for a staff member, looking in users then del_employees."""
    if not email:
        return {}
    u = await db.users.find_one({"email": email}, {"_id": 0}) or {}
    emp = await db.del_employees.find_one({"email": email}, {"_id": 0}) or {}
    return {
        "name": u.get("name") or emp.get("name") or email,
        "email": email,
        "phone": u.get("phone") or u.get("mobile") or emp.get("phone") or "",
        "manager_email": emp.get("manager_email") or "",
        "department_id": emp.get("department_id", ""),
    }


async def _fms_already_sent(stage_id: str, kind: str, channel: str) -> bool:
    return bool(await db.fms_notifications.find_one(
        {"stage_id": stage_id, "kind": kind, "channel": channel, "status": "sent"}))


async def _fms_record(flow_id, stage_id, kind, channel, recipient, ok, err):
    await db.fms_notifications.insert_one({
        "notif_id": f"fnotif_{uuid.uuid4().hex[:10]}",
        "flow_id": flow_id, "stage_id": stage_id, "kind": kind,
        "channel": channel, "recipient": recipient,
        "status": "sent" if ok else "failed", "error": err,
        "sent_at": datetime.now(timezone.utc).isoformat(),
    })


async def _fms_notify(flow, stage, kind, channels, templates, recipient):
    """Send `kind` notification to `recipient` over each channel, deduped, recorded."""
    tpl = templates.get(kind, "")
    due = (stage.get("plan_done") or "")[:16].replace("T", " ")
    text = render_template(
        tpl, stage=stage.get("label", ""), title=flow.get("title", ""),
        ref=flow.get("reference_id") or flow.get("flow_id", ""),
        due=due, customer_name=flow.get("customer_name", ""),
        assignee=recipient.get("name", ""),
    )
    subject = f"[SmartShape FMS] {stage.get('label','')}"
    for ch in channels:
        if await _fms_already_sent(stage["stage_id"], kind, ch):
            continue
        if ch == "whatsapp":
            ok, err = await _fms_send_wa(recipient.get("phone", ""), text)
        elif ch == "email":
            ok, err = await _fms_send_email(recipient.get("email", ""), subject, text)
        else:
            ok, err = False, "unknown_channel"
        await _fms_record(flow["flow_id"], stage["stage_id"], kind, ch,
                          recipient.get("email") or recipient.get("phone"), ok, err)


async def run_fms_sla_check():
    cfg = await get_fms_settings()
    channels = cfg["notify_channels"]
    templates = cfg["templates"]
    now = datetime.now(timezone.utc)

    stages = await db.fms_stages.find({"status": "active"}, {"_id": 0}).to_list(1000)
    for stage in stages:
        if not stage.get("plan_start") or not stage.get("plan_done"):
            continue
        ps = datetime.fromisoformat(stage["plan_start"])
        pd = datetime.fromisoformat(stage["plan_done"])
        rem = pct_remaining(ps, pd, stage.get("paused_intervals"))
        flow = await db.fms_flows.find_one({"flow_id": stage["flow_id"]}, {"_id": 0})
        if not flow or flow.get("status") not in ("active", "blocked"):
            continue
        recipient = await _resolve_recipient(stage.get("assigned_to", ""))

        # breach
        if cfg["notify_on_breach"] and now >= pd:
            await _fms_notify(flow, stage, "staff_breach", channels, templates, recipient)
            mgr = recipient.get("manager_email")
            if mgr:
                mgr_r = await _resolve_recipient(mgr)
                await _fms_notify(flow, stage, "manager_breach", channels, templates, mgr_r)
        # escalate
        elif rem <= cfg["notify_escalate_pct"]:
            await _fms_notify(flow, stage, "staff_escalate", channels, templates, recipient)
        # warning
        elif rem <= cfg["notify_warning_pct"]:
            await _fms_notify(flow, stage, "staff_warning", channels, templates, recipient)


async def fms_sla_loop():
    log.info("[scheduler] FMS SLA checker started (interval: 5 min)")
    while True:
        try:
            await run_fms_sla_check()
        except Exception as exc:
            log.error(f"[fms sla loop] {exc}")
        await asyncio.sleep(300)


# ══════════════════════════════════════════════════════════════════════════════
# JOB 6 — CRM "Needs Attention" Daily Digest
# ══════════════════════════════════════════════════════════════════════════════

REASON_LABEL = {"overdue": "overdue follow-up", "stuck": "no recent activity",
                "no_next_action": "no next step"}


async def _digest_compute() -> dict:
    """Return {rep_email: [attention rows]} across all open leads. Read-only."""
    now = datetime.now(timezone.utc)
    today = now.date().isoformat()
    settings = await get_crm_settings()
    leads = await db.leads.find(
        {"stage": {"$in": OPEN_STAGES}}, {"_id": 0}).to_list(20000)
    lead_ids = [l["lead_id"] for l in leads]
    upcoming, open_tasks = set(), set()
    async for fu in db.followups.find(
        {"lead_id": {"$in": lead_ids}, "status": "pending",
         "followup_date": {"$gte": today}}, {"_id": 0, "lead_id": 1}):
        upcoming.add(fu["lead_id"])
    async for t in db.tasks.find(
        {"lead_id": {"$in": lead_ids}, "status": "pending"}, {"_id": 0, "lead_id": 1}):
        open_tasks.add(t["lead_id"])
    quote_map = await _build_quote_map(leads)
    by_rep = {}
    for lead in leads:
        reasons = compute_attention(lead, now, settings,
                                    lead["lead_id"] in upcoming,
                                    lead["lead_id"] in open_tasks)
        if not reasons:
            continue
        rep = lead.get("assigned_to") or ""
        by_rep.setdefault(rep, []).append({
            "company": lead.get("company_name", ""),
            "value": resolve_lead_value(lead, quote_map),
            "reasons": reasons,
        })
    return by_rep


def _format_rep_digest(rows: list) -> str:
    rows = sorted(rows, key=lambda r: r["value"], reverse=True)
    lines = [f"Good morning! You have {len(rows)} lead(s) needing attention today:"]
    for r in rows[:15]:
        why = ", ".join(REASON_LABEL.get(x, x) for x in r["reasons"])
        val = f" (₹{int(r['value']):,})" if r["value"] else ""
        lines.append(f"• {r['company']}{val} — {why}")
    if len(rows) > 15:
        lines.append(f"…and {len(rows) - 15} more. Open SmartShape CRM to review.")
    return "\n".join(lines)


async def run_crm_digest():
    settings = await get_crm_settings()
    if not settings.get("digest_enabled"):
        log.debug("[digest] disabled — skipping")
        return
    by_rep = await _digest_compute()
    if not by_rep:
        log.info("[digest] nothing to send")
        return
    admin_summary = []
    total_at_risk = 0.0
    for rep_email, rows in by_rep.items():
        at_risk = sum(r["value"] for r in rows)
        total_at_risk += at_risk
        admin_summary.append((rep_email, len(rows), at_risk))
        if not rep_email:
            continue
        recipient = await _resolve_recipient(rep_email)
        text = _format_rep_digest(rows)
        if CRM_DIGEST_DRY_RUN:
            log.info(f"[digest][dry] -> {rep_email}\n{text}")
            continue
        await _fms_send_wa(recipient.get("phone", ""), text)
        await _fms_send_email(recipient.get("email", ""),
                              "SmartShape CRM — leads needing attention", text)
    admins = await db.users.find({"role": "admin"}, {"_id": 0, "email": 1}).to_list(20)
    summary_lines = ["CRM daily summary — leads needing attention by rep:"]
    for rep_email, n, at_risk in sorted(admin_summary, key=lambda x: x[2], reverse=True):
        summary_lines.append(f"• {rep_email or 'Unassigned'}: {n} leads, ₹{int(at_risk):,} at risk")
    summary_lines.append(f"Total at risk: ₹{int(total_at_risk):,}")
    summary = "\n".join(summary_lines)
    for a in admins:
        if CRM_DIGEST_DRY_RUN:
            log.info(f"[digest][dry] admin -> {a['email']}\n{summary}")
            continue
        r = await _resolve_recipient(a["email"])
        await _fms_send_wa(r.get("phone", ""), summary)
        await _fms_send_email(a["email"], "SmartShape CRM — daily summary", summary)


async def crm_digest_loop():
    log.info("[scheduler] CRM digest loop started")
    while True:
        try:
            settings = await get_crm_settings()
            hhmm = (settings.get("digest_time") or "08:00").split(":")
            hh, mm = int(hhmm[0]), int(hhmm[1])
            now_ist = datetime.now(IST)
            target = now_ist.replace(hour=hh, minute=mm, second=0, microsecond=0)
            if now_ist >= target:
                target += timedelta(days=1)
            sleep_secs = (target - now_ist).total_seconds()
            log.info(f"[digest] next run in {sleep_secs/3600:.1f}h")
            await asyncio.sleep(max(60, sleep_secs))
            await run_crm_digest()
        except Exception as exc:
            log.error(f"[digest loop] {exc}")
            await asyncio.sleep(3600)


async def start_scheduler():
    """Start all background automation loops. Call once from FastAPI startup."""
    asyncio.create_task(email_sender_loop())
    asyncio.create_task(wa_sender_loop())
    asyncio.create_task(drip_executor_loop())
    asyncio.create_task(greeting_loop())
    asyncio.create_task(fms_sla_loop())
    asyncio.create_task(crm_digest_loop())
    log.info("[scheduler] all 6 background jobs running")
