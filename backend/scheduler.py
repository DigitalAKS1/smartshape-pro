"""
SmartShape background automation engine.

Five perpetual asyncio loops:
  1. email_sender_loop        — every 2 min: flush email_scheduled queue via SMTP
  2. wa_sender_loop           — every 2 min: flush whatsapp_scheduled queue via WABA provider
  3. drip_executor_loop       — every 1 hr: advance drip enrollments whose next_step_at <= now
  4. greeting_loop            — daily 9am IST: fire greeting rules matching today's MM-DD
  5. fms_sla_loop             — every 5 min: send SLA breach/escalate/warning notifications
  6. webinar_lifecycle_loop   — every 10 min: fire time-based webinar emails
                                (remind_24h/remind_1h/live/noshow/attended)
"""

import asyncio
import logging
import os
import re
import smtplib
import uuid
from datetime import datetime, timezone, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import httpx

from database import db
from notify import notify_user
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

# One contact's "email" field may hold several addresses jammed together with
# commas, semicolons, spaces or newlines (common with imported data). Sending
# that raw string to Gmail fails RFC-5321 validation ("not a valid address") or
# crashes on an embedded newline ("folded header contains newline"). Extract the
# real addresses so every reachable recipient still gets the mail.
_ADDR_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")


def _clean_recipients(raw: str) -> list:
    """Return the de-duplicated list of valid email addresses found in a field."""
    if not raw:
        return []
    out = []
    for a in _ADDR_RE.findall(raw):
        a = a.strip().strip(".,;")
        if a and a.lower() not in [x.lower() for x in out]:
            out.append(a)
    return out


def _send_batch_sync(sender_email, app_password, sender_name, jobs):
    """Send many messages over ONE SMTP connection (one login) — far faster and
    kinder to Gmail than reconnecting per message. `jobs` is a list of dicts:
    {scheduled_id, recipients[list], subject, body, body_html, reply_to}.
    Returns (results, conn_error): results = [(scheduled_id, ok, error)];
    conn_error set (str) if the connection/login itself failed → caller should
    leave the whole batch pending and retry next cycle."""
    try:
        smtp = smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=30)
        smtp.login(sender_email, app_password)
    except Exception as exc:
        return [], str(exc)[:250]
    results = []
    try:
        for j in jobs:
            try:
                msg = MIMEMultipart("alternative")
                msg["From"] = f"{sender_name} <{sender_email}>"
                msg["To"] = ", ".join(j["recipients"])
                msg["Subject"] = j.get("subject") or "Message from SmartShape"
                if j.get("reply_to"):
                    msg["Reply-To"] = j["reply_to"]
                if j.get("body_html"):
                    msg["List-Unsubscribe"] = f"<mailto:{sender_email}?subject=unsubscribe>"
                    msg["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
                msg.attach(MIMEText(j.get("body") or "", "plain"))
                if j.get("body_html"):
                    msg.attach(MIMEText(j["body_html"], "html"))
                smtp.sendmail(sender_email, j["recipients"], msg.as_string())
                results.append((j["scheduled_id"], True, None))
            except Exception as exc:
                results.append((j["scheduled_id"], False, str(exc)[:250]))
    finally:
        try:
            smtp.quit()
        except Exception:
            pass
    return results, None


def _smtp_send(sender_email, app_password, sender_name, to_email, subject, body, body_html=None, reply_to=None):
    msg = MIMEMultipart("alternative")
    msg["From"] = f"{sender_name} <{sender_email}>"
    msg["To"] = to_email
    msg["Subject"] = subject
    if reply_to:
        # replies go to the user who sent it (e.g. the salesperson), not the shared mailbox
        msg["Reply-To"] = reply_to
    if body_html:
        msg["List-Unsubscribe"] = f"<mailto:{sender_email}?subject=unsubscribe>"
        msg["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
    msg.attach(MIMEText(body or "", "plain"))
    if body_html:
        msg.attach(MIMEText(body_html, "html"))
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=20) as smtp:
        smtp.login(sender_email, app_password)
        smtp.sendmail(sender_email, [to_email], msg.as_string())


def _smtp_send_attachment(sender_email, app_password, sender_name, to_email,
                          subject, body, file_path, filename):
    from email.mime.base import MIMEBase
    from email import encoders
    msg = MIMEMultipart()
    msg["From"] = f"{sender_name} <{sender_email}>"
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.attach(MIMEText(body, "plain"))
    with open(file_path, "rb") as fh:
        part = MIMEBase("application", "pdf")
        part.set_payload(fh.read())
    encoders.encode_base64(part)
    part.add_header("Content-Disposition", f'attachment; filename="{filename}"')
    msg.attach(part)
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=30) as smtp:
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
    # One connection per cycle handles a big batch fast, so pull a generous slice.
    pending = await db.email_scheduled.find(
        {"status": "pending"}, {"_id": 0}
    ).limit(100).to_list(100)

    if not pending:
        return

    log.info(f"[email] processing {len(pending)} messages")
    now_iso = datetime.now(timezone.utc).isoformat()

    jobs = []
    for msg in pending:
        # field stored by email_routes is "email"; legacy records may use "to_email".
        # A field may contain several addresses (comma/space/newline) → split them.
        recipients = _clean_recipients(msg.get("email") or msg.get("to_email") or "")
        if not recipients:
            await db.email_scheduled.update_one(
                {"scheduled_id": msg["scheduled_id"]},
                {"$set": {"status": "failed", "error": "invalid_email", "sent_at": now_iso}},
            )
            if msg.get("campaign_id"):
                await db.email_campaigns.update_one(
                    {"campaign_id": msg["campaign_id"]}, {"$inc": {"failed_count": 1}}
                )
            continue
        jobs.append({
            "scheduled_id": msg["scheduled_id"],
            "campaign_id": msg.get("campaign_id"),
            "recipients": recipients,
            "subject": msg.get("subject", "Message from SmartShape"),
            # field stored by email_routes is "message"; legacy records may use "body"
            "body": msg.get("message") or msg.get("body") or "",
            "body_html": msg.get("body_html"),
            "reply_to": msg.get("reply_to"),
        })

    if jobs:
        results, conn_err = await asyncio.to_thread(
            _send_batch_sync, sender_email, app_password, sender_name, jobs
        )
        if conn_err:
            # Connection/login itself failed — leave the batch pending, retry next cycle.
            log.warning(f"[email] SMTP connect/login failed, deferring batch: {conn_err}")
            return
        jobmap = {j["scheduled_id"]: j for j in jobs}
        for sid, ok, err in results:
            j = jobmap.get(sid, {})
            if ok:
                await db.email_scheduled.update_one(
                    {"scheduled_id": sid},
                    {"$set": {"status": "sent", "sent_at": now_iso}},
                )
                if j.get("campaign_id"):
                    await db.email_campaigns.update_one(
                        {"campaign_id": j["campaign_id"]}, {"$inc": {"sent_count": 1}}
                    )
                log.info(f"[email] sent → {', '.join(j.get('recipients', []))}")
            else:
                log.warning(f"[email] failed → {', '.join(j.get('recipients', []))}: {err}")
                await db.email_scheduled.update_one(
                    {"scheduled_id": sid},
                    {"$set": {"status": "failed", "error": err, "sent_at": now_iso}},
                )
                if j.get("campaign_id"):
                    await db.email_campaigns.update_one(
                        {"campaign_id": j["campaign_id"]}, {"$inc": {"failed_count": 1}}
                    )

    # Mark campaigns "completed" once their queue has fully drained — otherwise a
    # fully-sent campaign shows "Queued" forever (its status is never advanced).
    for cid in {m.get("campaign_id") for m in pending if m.get("campaign_id")}:
        if await db.email_scheduled.count_documents({"campaign_id": cid, "status": "pending"}) == 0:
            await db.email_campaigns.update_one(
                {"campaign_id": cid, "status": {"$in": ["queued", "scheduled"]}},
                {"$set": {"status": "completed", "completed_at": now_iso}},
            )


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

async def _wa_consent_ok(lead: dict) -> bool:
    """May we send a MARKETING WhatsApp to this lead?

    Meta requires prior opt-in for marketing-category templates; sending without it
    risks the whole number being suspended, not just one message. Consent is read
    from the lead, falling back to the school — opt-in is given by the school, not
    by a row in our CRM. The rule itself is a setting (`require_wa_consent`, in
    App Settings -> Notifications) but it defaults to ON, because the safe default
    for a policy whose downside is a permanent ban is to refuse.
    """
    cfg = await db.settings.find_one({"type": "notifications"}, {"_id": 0}) or {}
    if not cfg.get("require_wa_consent", True):
        return True
    if lead.get("wa_consent"):
        return True
    sid = lead.get("school_id")
    if sid:
        sch = await db.schools.find_one({"school_id": sid}, {"_id": 0, "wa_consent": 1})
        if (sch or {}).get("wa_consent"):
            return True
    return False


# Consecutive send failures on one step before the enrolment pauses and the owner
# is told. Retries happen on the loop's own 1-hour cadence.
DRIP_MAX_STEP_FAILURES = 3


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

            _name_parts = (lead.get("contact_name") or "").split()
            first_name = _name_parts[0] if _name_parts else "there"
            school = lead.get("company_name") or "your school"
            text = step["message_template"].replace("{name}", first_name).replace("{school_name}", school)
            msg_type = step.get("message_type", "whatsapp")
            sent = False
            skipped = False          # refused on policy, not a send failure
            err_detail = ""

            if msg_type == "physical_material":
                try:
                    await create_physical_from_drip(
                        lead, step.get("material_type", "brochure"), seq.get("name", "drip"),
                        material_name=step.get("material_name", ""),
                        sequence_id=enr["sequence_id"], enrollment_id=enr["enrollment_id"],
                        step_number=step["step_number"],
                        planned_date=(enrolled_at + timedelta(days=step["delay_days"])).strftime("%Y-%m-%d"))
                    sent = True
                except Exception as e:
                    err_detail = str(e)[:200]

            elif msg_type == "whatsapp" and wa_cfg:
                phone = lead.get("contact_phone", "")
                if not await _wa_consent_ok(lead):
                    # Not a failure — a refusal. Retrying would stall the school on a
                    # step that can never send, so it is skipped and the sequence
                    # carries on to the post and call steps, which need no opt-in.
                    skipped = True
                    err_detail = "no WhatsApp consent on record for this school"
                elif phone:
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

            elif msg_type == "call_task":
                # A human step: drop a call reminder onto the owner's plate. It
                # becomes a crm_activity, so it surfaces on the calendar + the
                # rep's daily "Marketing Touches" queue (Phase 1a/1b).
                try:
                    await db.crm_activities.insert_one({
                        "activity_id": f"act_{uuid.uuid4().hex[:10]}",
                        "school_id": lead.get("school_id", ""),
                        "school_name": lead.get("company_name", ""),
                        "activity_type": "Call", "channel": "call",
                        "title": (text[:80].strip() or "Follow-up call") if text else "Follow-up call",
                        "notes": text or "", "due_date": now_iso[:10],
                        "assigned_to": lead.get("assigned_to", ""),
                        "assigned_name": lead.get("assigned_name", ""),
                        "status": "pending", "source": "drip",
                        "created_by": "drip", "created_at": now_iso, "done_at": None,
                    })
                    sent = True
                except Exception as e:
                    err_detail = str(e)[:200]

            # Mirror every fired step onto the engagement ledger so it shows on
            # the school's unified Timeline (Phase 0), tagged by channel.
            if sent:
                try:
                    from services.engagement import log_engagement_event
                    _ch = {"whatsapp": "whatsapp", "email": "email",
                           "physical_material": "mail", "call_task": "call"}.get(msg_type, "drip")
                    _title = (f"{step.get('material_type', 'material')} sent"
                              if msg_type == "physical_material" else (text[:100] if text else "Drip step"))
                    await log_engagement_event(
                        channel=_ch, kind=f"{seq.get('name', 'Drip')} · step {step['step_number']}",
                        title=_title, school_id=lead.get("school_id", ""),
                        lead_id=enr["lead_id"], contact_id=lead.get("contact_id", ""),
                        status="sent", direction="out", by="Drip sequence", at=now_iso,
                        meta={"sequence_id": enr["sequence_id"], "step": step["step_number"]},
                        dedup_key=f"drip:{enr['enrollment_id']}:{step['step_number']}")
                except Exception as e:
                    log.error(f"[drip] ledger log failed: {e}")

            # Log step
            await db.drip_step_logs.insert_one({
                "log_id": f"dlog_{uuid.uuid4().hex[:10]}",
                "enrollment_id": enr["enrollment_id"],
                "sequence_id": enr["sequence_id"],
                "lead_id": enr["lead_id"],
                "step_number": step["step_number"],
                "message_type": msg_type,
                "status": "sent" if sent else ("skipped" if skipped else "failed"),
                "error": err_detail,
                "fired_at": now_iso,
            })

            # A step that could not send must NOT advance the sequence. Before this
            # guard, an unconfigured provider burned every step and closed the
            # enrolment, so the school was marked "completed" having received
            # nothing — and could never be enrolled again.
            if not sent and not skipped:
                fails = int(enr.get("step_fail_count", 0) or 0) + 1
                if fails >= DRIP_MAX_STEP_FAILURES:
                    await db.drip_enrollments.update_one(
                        {"enrollment_id": enr["enrollment_id"]},
                        {"$set": {"status": "paused", "step_fail_count": fails,
                                  "paused_at": now_iso,
                                  "paused_reason": err_detail or
                                  f"step {step['step_number']} ({msg_type}) could not be sent"}})
                    owner = lead.get("assigned_to", "")
                    if owner:
                        await notify_user(
                            owner, type="drip_stalled",
                            dedup_key=f"dripstall:{enr['enrollment_id']}",
                            title="⚠️ A drip sequence has stalled",
                            body=(f"\"{seq.get('name', 'A sequence')}\" could not send step "
                                  f"{step['step_number']} to {lead.get('company_name', 'a school')} "
                                  f"after {fails} tries, so it is paused. "
                                  + (f"Reason: {err_detail}. " if err_detail else
                                     f"The {msg_type} channel looks unconfigured. ")
                                  + "Nothing further will be sent until this is fixed."),
                            ref_type="lead", ref_id=enr["lead_id"],
                            from_name="Drip sequence")
                    log.warning(f"[drip] {enr['enrollment_id']} PAUSED after {fails} failed "
                                f"attempts on step {step['step_number']} ({msg_type})")
                else:
                    # Retry on the next pass rather than skipping the school.
                    await db.drip_enrollments.update_one(
                        {"enrollment_id": enr["enrollment_id"]},
                        {"$set": {"step_fail_count": fails,
                                  "next_step_at": (now + timedelta(hours=1)).isoformat()}})
                    log.info(f"[drip] {enr['enrollment_id']} step {step['step_number']} "
                             f"failed ({fails}/{DRIP_MAX_STEP_FAILURES}) — will retry")
                continue

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
                        "step_fail_count": 0,
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
                        "step_fail_count": 0,
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
# JOB — Daily "your day" WhatsApp digest (tasks / visits / follow-ups / CRM)
# ══════════════════════════════════════════════════════════════════════════════

def _digest_base_url():
    return os.getenv("PUBLIC_BASE_URL", "https://app.smartshape.in").rstrip("/")


def _due_label(due, today):
    if not due:
        return ""
    if due >= today:
        return "Today"
    try:
        d = datetime.strptime(due, "%Y-%m-%d").date()
        t = datetime.strptime(today, "%Y-%m-%d").date()
        return f"Overdue {(t - d).days}d"
    except Exception:
        return "Overdue"


async def build_and_enqueue_daily_digests():
    """Per-person 'your day' WhatsApp digest of due-today + overdue items. Returns a summary."""
    today = datetime.now(IST).date().isoformat()
    base = _digest_base_url()
    emps = await db.del_employees.find(
        {"is_active": True},
        {"_id": 0, "emp_id": 1, "name": 1, "email": 1, "phone": 1, "mobile": 1},
    ).to_list(1000)
    sent = skipped = 0
    for e in emps:
        try:
            phone = (e.get("phone") or e.get("mobile") or "").strip()
            if not phone:
                skipped += 1
                continue
            emp_id = e.get("emp_id")
            email = e.get("email") or ""
            tasks = await db.del_task_instances.find(
                {"emp_id": emp_id, "status": "pending", "due_date": {"$lte": today}},
                {"_id": 0, "task_title": 1, "due_date": 1}).sort("due_date", 1).to_list(50)
            visits = await db.visit_plans.find(
                {"assigned_to": email, "status": {"$in": ["planned", "in_progress"]},
                 "visit_date": {"$lte": today}},
                {"_id": 0, "school_name": 1, "visit_time": 1, "visit_date": 1}).sort("visit_date", 1).to_list(50) if email else []
            fups = await db.followups.find(
                {"assigned_to": email, "status": "pending", "followup_date": {"$lte": today}},
                {"_id": 0, "followup_type": 1, "lead_name": 1, "contact_name": 1,
                 "followup_date": 1}).sort("followup_date", 1).to_list(50) if email else []
            crm = await db.tasks.find(
                {"assigned_to": email, "status": {"$nin": ["done", "completed"]}, "due_date": {"$lte": today}},
                {"_id": 0, "title": 1, "due_date": 1}).sort("due_date", 1).to_list(50) if email else []
            if (len(tasks) + len(visits) + len(fups) + len(crm)) == 0:
                skipped += 1
                continue

            first = (e.get("name") or "there").split(" ")[0]
            lines = [f"Good morning {first} \U0001F305 — your day at SmartShape", ""]

            def section(title, items, fmt):
                if not items:
                    return
                lines.append(f"{title} ({len(items)})")
                for it in items[:8]:
                    lines.append("• " + fmt(it))
                if len(items) > 8:
                    lines.append(f"  +{len(items) - 8} more")
                lines.append("")

            section("\U0001F4CB Tasks", tasks, lambda t: f"{t.get('task_title', 'Task')} — {_due_label(t.get('due_date'), today)}")
            section("\U0001F4CD Visits", visits, lambda v: f"{v.get('school_name', 'Visit')}" + (f" · {v.get('visit_time')}" if v.get('visit_time') else ""))
            section("\U0001F4DE Follow-ups", fups,
                    lambda f: (f"{(f.get('followup_type') or 'call').title()}: "
                               f"{f.get('lead_name') or f.get('contact_name')}"
                               if (f.get('lead_name') or f.get('contact_name'))
                               else (f.get('followup_type') or 'call').title()))
            section("\U0001F5D2 CRM", crm, lambda c: f"{c.get('title', 'Task')} — {_due_label(c.get('due_date'), today)}")
            lines.append(f"Open ▶ {base}/today")
            message = "\n".join(lines).strip()

            if DAILY_DIGEST_DRY_RUN:
                log.info(f"[digest][dry] {phone}\n{message}")
            else:
                await db.whatsapp_scheduled.insert_one({
                    "scheduled_id": f"wsch_{uuid.uuid4().hex[:12]}", "campaign_id": "daily_digest",
                    "status": "pending", "phone": phone, "message": message,
                    "created_at": datetime.now(timezone.utc).isoformat()})
            sent += 1
        except Exception as exc:
            log.warning(f"[digest] {e.get('email')} failed: {exc}")
            skipped += 1
    log.info(f"[digest] {sent} enqueued, {skipped} skipped")
    return {"sent": sent, "skipped": skipped, "recipients": sent}


async def daily_digest_loop():
    log.info("[scheduler] daily digest loop started")
    last_fired = None
    while True:
        try:
            cfg = await db.settings.find_one({"type": "daily_digest"}, {"_id": 0}) or {}
            now_ist = datetime.now(IST)
            today = now_ist.date().isoformat()
            if cfg.get("enabled") and now_ist.strftime("%H:%M") == cfg.get("send_time", "08:00") and last_fired != today:
                last_fired = today
                if await _wa_cfg():
                    await build_and_enqueue_daily_digests()
                else:
                    log.info("[digest] due but WhatsApp not configured — skipped")
        except Exception as exc:
            log.error(f"[digest loop] {exc}")
        await asyncio.sleep(45)   # < 60s so every target minute gets a tick


# ══════════════════════════════════════════════════════════════════════════════
# JOB 4b — Daily "Orders Received" evening report (in-app notification + WhatsApp)
# ══════════════════════════════════════════════════════════════════════════════

def _format_orders_report(orders, today):
    """Build the evening 'orders received today' summary text.

    `orders` is a list of dicts with school_name / grand_total / order_number.
    Returns None when there are no orders (nothing to send)."""
    if not orders:
        return None
    total = sum(float(o.get("grand_total") or 0) for o in orders)
    lines = [
        f"\U0001F4E6 Orders received today ({today})", "",
        f"Total orders: {len(orders)}",
        f"Total value: ₹{total:,.0f}", "",
    ]
    for o in orders[:15]:
        nm = o.get("school_name") or "Unknown"
        amt = float(o.get("grand_total") or 0)
        no = o.get("order_number") or ""
        lines.append(f"• {nm} — ₹{amt:,.0f} ({no})".rstrip(" ()"))
    if len(orders) > 15:
        lines.append(f"  +{len(orders) - 15} more")
    return "\n".join(lines).strip()


async def build_and_enqueue_daily_orders_report():
    """Compute today's orders and deliver as an in-app notification + WhatsApp.

    In-app notification has no `assigned_to`, so it shows to admins (who see all
    notifications). WhatsApp goes to the phones configured in settings."""
    cfg = await db.settings.find_one({"type": "daily_orders_report"}, {"_id": 0}) or {}
    now_ist = datetime.now(IST)
    today = now_ist.date().isoformat()
    # IST midnight today, expressed as UTC isoformat to match how orders store created_at.
    start_ist = now_ist.replace(hour=0, minute=0, second=0, microsecond=0)
    start_utc = start_ist.astimezone(timezone.utc).isoformat()
    orders = await db.orders.find(
        {"created_at": {"$gte": start_utc}},
        {"_id": 0, "school_name": 1, "grand_total": 1, "order_number": 1},
    ).to_list(1000)
    text = _format_orders_report(orders, today)
    if not text:
        log.info("[orders-report] no orders today — nothing sent")
        return {"orders": 0, "wa": 0}
    total = sum(float(o.get("grand_total") or 0) for o in orders)

    # 1) In-app notification (admins see it; keyed per-day so it stays single).
    await db.notifications.update_one(
        {"type": "daily_orders_report", "report_date": today},
        {"$set": {
            "type": "daily_orders_report",
            "report_date": today,
            "title": f"Orders today: {len(orders)} (₹{total:,.0f})",
            "message": text,
            "assigned_to": None,
            "is_read": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True,
    )

    # 2) WhatsApp to configured recipients (only if WhatsApp is set up).
    phones = [p.strip() for p in (cfg.get("recipients") or []) if p and p.strip()]
    wa = 0
    if phones and await _wa_cfg():
        for phone in phones:
            await db.whatsapp_scheduled.insert_one({
                "scheduled_id": f"wsch_{uuid.uuid4().hex[:12]}", "campaign_id": "daily_orders_report",
                "status": "pending", "phone": phone, "message": text,
                "created_at": datetime.now(timezone.utc).isoformat()})
            wa += 1
    log.info(f"[orders-report] {len(orders)} orders, in-app posted, {wa} WhatsApp queued")
    return {"orders": len(orders), "wa": wa}


async def daily_orders_report_loop():
    log.info("[scheduler] daily orders report loop started")
    last_fired = None
    while True:
        try:
            cfg = await db.settings.find_one({"type": "daily_orders_report"}, {"_id": 0}) or {}
            now_ist = datetime.now(IST)
            today = now_ist.date().isoformat()
            if cfg.get("enabled") and now_ist.strftime("%H:%M") == cfg.get("send_time", "19:00") and last_fired != today:
                last_fired = today
                await build_and_enqueue_daily_orders_report()
        except Exception as exc:
            log.error(f"[orders-report loop] {exc}")
        await asyncio.sleep(45)   # < 60s so every target minute gets a tick


# ══════════════════════════════════════════════════════════════════════════════
# JOB 5 — FMS SLA Notification Engine
# ══════════════════════════════════════════════════════════════════════════════

FMS_DRY_RUN = os.getenv("FMS_NOTIFY_DRY_RUN", "0") == "1"
CRM_DIGEST_DRY_RUN = os.getenv("CRM_DIGEST_DRY_RUN", "0") == "1"
DAILY_DIGEST_DRY_RUN = os.getenv("DAILY_DIGEST_DRY_RUN", "0") == "1"


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
            if stage.get("actions"):
                from fms_actions import run_stage_actions
                await run_stage_actions(flow, stage, "on_overdue")
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
# JOB — Zoom Webinar Lifecycle (time-based reminder/live/follow-up emails)
# ══════════════════════════════════════════════════════════════════════════════

async def process_webinar_lifecycle(now=None):
    """One pass over published webinar sessions: fire whichever time-based
    stages (remind_24h/remind_1h/live/noshow/attended) are due right now.

    `now` is injectable (tests pass a fixed UTC-aware datetime); defaults to
    the real wall clock. Deps are imported lazily inside the function body to
    avoid any circular-import risk at module load (scheduler is imported very
    early by main.py, and routes.training_routes / webinar_lifecycle both sit
    downstream of database/db setup).
    """
    from webinar_lifecycle import due_time_stages
    from routes.training_routes import _enqueue_webinar_stage

    if now is None:
        now = datetime.now(timezone.utc)

    sessions = await db.training_sessions.find(
        {"is_published": True, "meeting_link": {"$nin": ["", None]}}, {"_id": 0}
    ).to_list(500)

    for session in sessions:
        try:
            stages = due_time_stages(session, now)
            if not stages:
                continue

            sid = session.get("session_id")
            for stage in stages:
                if stage in ("remind_24h", "remind_1h", "live"):
                    status_filter = "registered"
                elif stage == "attended":
                    status_filter = "attended"
                elif stage == "noshow":
                    if not session.get("recording_url"):
                        # No recording yet — hold this stage; it'll fire on a
                        # later cycle once the recording is set.
                        continue
                    status_filter = "no_show"
                else:
                    continue

                # Load registrations fresh from DB each cycle so the
                # idempotency guard in _enqueue_webinar_stage (which reads
                # reg["sent_stages"]) sees the current state.
                regs = await db.session_registrations.find(
                    {"session_id": sid, "status": status_filter}, {"_id": 0}
                ).to_list(2000)
                for reg in regs:
                    await _enqueue_webinar_stage(session, reg, stage)
                    if stage in ("remind_24h", "remind_1h"):
                        # WhatsApp companion for form-linked sessions (no-op otherwise)
                        try:
                            from routes.form_routes import enqueue_form_wa_stage
                            await enqueue_form_wa_stage(session, reg, stage)
                        except Exception as exc:
                            log.warning(f"[webinar loop] form wa {stage}: {exc}")
        except Exception as exc:
            log.error(f"[webinar loop] session {session.get('session_id')} error: {exc}")


async def webinar_lifecycle_loop():
    log.info("[scheduler] webinar lifecycle loop started (interval: 10 min)")
    while True:
        try:
            await process_webinar_lifecycle()
        except Exception as exc:
            log.warning(f"[webinar loop] {exc}")
        await asyncio.sleep(600)


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


# ══════════════════════════════════════════════════════════════════════════════
# JOB 7 — Certificate Generation Pass (cert_loop)
# ══════════════════════════════════════════════════════════════════════════════

from cert_engine import (
    render_certificate_pdf, render_certificate_pdf_merge, render_certificate_pdf_overlay,
    sanitize_filename, render_placeholders,
    DEFAULT_EMAIL_SUBJECT, DEFAULT_EMAIL_BODY, DEFAULT_WA_CAPTION,
)

CERT_DRY_RUN = os.getenv("CERT_DRY_RUN", "0") == "1"
_CERT_DIR = os.path.join(os.path.dirname(__file__), "uploads", "certificates")
_PUBLIC_BASE = os.getenv("PUBLIC_BASE", "").rstrip("/")


async def _generate_pending_certs():
    batches = await db.cert_batches.find({"status": "generating"}, {"_id": 0}).to_list(100)
    for batch in batches:
        tpl = await db.cert_templates.find_one({"template_id": batch["template_id"]}, {"_id": 0})
        if not tpl:
            await db.cert_batches.update_one({"batch_id": batch["batch_id"]}, {"$set": {"status": "draft"}})
            continue
        try:
            from cert_engine import safe_bg_path
            bg_path = safe_bg_path(_CERT_DIR, tpl.get("background_url", ""))
        except ValueError:
            await db.cert_batches.update_one({"batch_id": batch["batch_id"]}, {"$set": {"status": "draft"}})
            continue
        items = await db.cert_items.find(
            {"batch_id": batch["batch_id"], "gen_status": "pending"}, {"_id": 0}).to_list(2000)
        for it in items:
            # Honour a Stop requested mid-pass: if the batch left "generating", halt now
            # (remaining items stay pending so the user can resume with Generate).
            cur = await db.cert_batches.find_one({"batch_id": batch["batch_id"]}, {"_id": 0, "status": 1})
            if not cur or cur.get("status") != "generating":
                break
            # Atomic claim so overlapping passes (background loop vs manual run) don't
            # double-render or double-count this item.
            claim = await db.cert_items.update_one(
                {"item_id": it["item_id"], "gen_status": "pending"},
                {"$set": {"gen_status": "generating"}})
            if claim.modified_count != 1:
                continue
            out_name = f"{it['item_id']}.pdf"
            out_path = os.path.join(_CERT_DIR, out_name)
            try:
                item = {"name": it["name"], "school": it.get("school", "")}
                if tpl.get("kind") == "pdf":
                    if tpl.get("fields"):
                        render_certificate_pdf_overlay(bg_path, out_path, tpl.get("fields", []),
                                                       item, batch.get("shared_values", {}),
                                                       tpl.get("width_px") or 0, tpl.get("height_px") or 0)
                    else:
                        render_certificate_pdf_merge(bg_path, out_path,
                                                     item, batch.get("shared_values", {}))
                else:
                    render_certificate_pdf(bg_path, out_path, tpl.get("fields", []),
                                           item, batch.get("shared_values", {}))
                await db.cert_items.update_one({"item_id": it["item_id"]}, {"$set": {
                    "gen_status": "generated", "pdf_url": f"/uploads/certificates/{out_name}",
                    "pdf_compressed": True}})   # render fns already compress on save
                await db.cert_batches.update_one({"batch_id": batch["batch_id"]},
                                                 {"$inc": {"counts.generated": 1}})
            except Exception as e:
                await db.cert_items.update_one({"item_id": it["item_id"]}, {"$set": {
                    "gen_status": "failed", "gen_error": str(e)[:200]}})
                await db.cert_batches.update_one({"batch_id": batch["batch_id"]},
                                                 {"$inc": {"counts.failed": 1}})
        final_status = "sending" if batch.get("origin_flow_id") else "ready"
        # Conditional: don't resurrect a batch the user Stopped mid-pass.
        await db.cert_batches.update_one(
            {"batch_id": batch["batch_id"], "status": "generating"},
            {"$set": {"status": final_status}})


async def _deliver_pending_certs():
    batches = await db.cert_batches.find({"status": {"$in": ["sending", "ready"]}}, {"_id": 0}).to_list(100)
    for batch in batches:
        if batch.get("status") != "sending":
            continue
        channels = batch.get("channels", [])
        items = await db.cert_items.find(
            {"batch_id": batch["batch_id"], "gen_status": "generated"}, {"_id": 0}).to_list(2000)
        for it in items:
            # Honour a Stop requested mid-send: halt promptly; unsent items stay pending
            # so the user can resume with Send (delivery is idempotent per channel).
            cur = await db.cert_batches.find_one({"batch_id": batch["batch_id"]}, {"_id": 0, "status": 1})
            if not cur or cur.get("status") != "sending":
                break
            for ch in channels:
                # Atomic claim: only one concurrent pass (background loop vs a manual
                # run) can move this channel pending/failed -> sending, so a certificate
                # is sent (and counted) exactly once even under overlapping passes.
                claim = await db.cert_items.update_one(
                    {"item_id": it["item_id"], f"delivery.{ch}.status": {"$in": ["pending", "failed"]}},
                    {"$set": {f"delivery.{ch}.status": "sending"}})
                if claim.modified_count != 1:
                    continue   # already sent/skipped, or claimed by another pass
                ok, err = await _cert_send_one(ch, it, batch)
                if ok is None:
                    new_status = "skipped"
                elif ok:
                    new_status = "sent"
                else:
                    new_status = "failed"
                await db.cert_items.update_one({"item_id": it["item_id"]},
                    {"$set": {f"delivery.{ch}.status": new_status,
                              f"delivery.{ch}.at": datetime.now(timezone.utc).isoformat(),
                              f"delivery.{ch}.error": err}})
                if new_status == "sent":
                    field = "sent_whatsapp" if ch == "whatsapp" else "sent_email"
                    await db.cert_batches.update_one({"batch_id": batch["batch_id"]},
                                                     {"$inc": {f"counts.{field}": 1}})
                elif new_status == "failed":
                    await db.cert_batches.update_one({"batch_id": batch["batch_id"]},
                                                     {"$inc": {"counts.failed": 1}})
        # Conditional: a Stop during delivery set status to "stopped" — don't mark it done.
        await db.cert_batches.update_one(
            {"batch_id": batch["batch_id"], "status": "sending"},
            {"$set": {"status": "done"}})


async def _cert_send_one(channel: str, it: dict, batch: dict):
    """Returns (ok, err): ok True=sent, False=failed, None=skipped (no contact)."""
    fname = f"certificate_{sanitize_filename(it['name'])}.pdf"
    pdf_url = it.get("pdf_url", "")
    local_pdf = os.path.join(_CERT_DIR, pdf_url.split("/uploads/certificates/")[-1]) if pdf_url else ""
    shared = batch.get("shared_values", {})
    # Mail-merge: per-batch templates override engine defaults; {Name}/{Date}/{Theme}/{Conducted By}.
    subject = render_placeholders(batch.get("email_subject") or DEFAULT_EMAIL_SUBJECT, it, shared)
    body = render_placeholders(batch.get("email_body") or DEFAULT_EMAIL_BODY, it, shared)
    caption = render_placeholders(batch.get("wa_caption") or DEFAULT_WA_CAPTION, it, shared)
    if channel == "whatsapp":
        if not it.get("phone"):
            return None, "no_phone"
        if CERT_DRY_RUN:
            log.info(f"[cert][dry] WA doc -> {it['phone']}: {fname}")
            return True, None
        try:
            full_url = f"{_PUBLIC_BASE}{pdf_url}" if _PUBLIC_BASE else pdf_url
            await evolution.send_document(it["phone"], full_url, fname, caption)
            return True, None
        except Exception as e:
            return False, str(e)[:200]
    if channel == "email":
        if not it.get("email") or "@" not in it["email"]:
            return None, "no_email"
        if CERT_DRY_RUN:
            log.info(f"[cert][dry] EMAIL -> {it['email']}: {fname}")
            return True, None
        cfg = await _email_cfg()
        if not cfg:
            return False, "email_not_configured"
        se, ap, sn = cfg
        try:
            await asyncio.to_thread(_smtp_send_attachment, se, ap, sn, it["email"],
                                    subject, body,
                                    local_pdf, fname)
            return True, None
        except Exception as e:
            return False, str(e)[:200]
    return None, "unknown_channel"


async def run_cert_pass():
    """One pass: generate pending certs, then deliver (delivery added in Task 6)."""
    await _generate_pending_certs()
    await _deliver_pending_certs()


async def cert_loop():
    log.info("[scheduler] cert loop started (interval: 30s)")
    while True:
        try:
            await run_cert_pass()
        except Exception as exc:
            log.error(f"[cert loop] {exc}")
        await asyncio.sleep(30)


# ══════════════════════════════════════════════════════════════════════════════
# JOB 8 — Low-stock daily digest (in-app notification + email to admin/store)
# ══════════════════════════════════════════════════════════════════════════════

def _low_stock_email_body(low, out):
    lines = [
        f"{len(low)} die(s) are at or below their minimum stock level"
        + (f" — {len(out)} are OUT OF STOCK." if out else ".."),
        "",
    ]
    if out:
        lines.append("OUT OF STOCK:")
        lines += [f"  - {d.get('code','?')}  {d.get('name','')}" for d in out]
        lines.append("")
    low_only = [d for d in low if (d.get("stock_qty", 0) or 0) > 0]
    if low_only:
        lines.append("LOW (at or below minimum):")
        lines += [
            f"  - {d.get('code','?')}  {d.get('name','')}: {d.get('stock_qty',0)} (min {d.get('min_level',0)})"
            for d in low_only
        ]
        lines.append("")
    lines.append("Open the Reorder list to act: https://app.smartshape.in/inventory")
    return "\n".join(lines)


async def run_low_stock_check(trigger="scheduled"):
    """Find active dies at/below min level; alert admins in-app + email admin/store.
    Returns a summary dict (also used by the manual 'run now' endpoint)."""
    dies = await db.dies.find(
        {"is_active": {"$ne": False}},
        {"_id": 0, "die_id": 1, "code": 1, "name": 1, "stock_qty": 1, "min_level": 1},
    ).to_list(10000)
    low = [d for d in dies if (d.get("stock_qty", 0) or 0) <= (d.get("min_level", 0) or 0)]
    out = [d for d in low if (d.get("stock_qty", 0) or 0) == 0]
    if not low:
        log.info("[low_stock] nothing at/below min level")
        return {"ok": True, "low": 0, "out": 0, "notified": 0, "emailed": False, "trigger": trigger}

    low.sort(key=lambda d: (d.get("stock_qty", 0) or 0) - (d.get("min_level", 0) or 0))
    today = datetime.now(IST).strftime("%Y-%m-%d")
    title = f"Low stock: {len(low)} item{'s' if len(low) != 1 else ''} need reordering"
    top = ", ".join(f"{d.get('code','?')} ({d.get('stock_qty',0)})" for d in low[:6])
    more = f" +{len(low) - 6} more" if len(low) > 6 else ""
    message = f"{len(out)} out of stock, {len(low)} at/below minimum. Most urgent: {top}{more}."

    # ONE in-app digest for admins (admin notifications query returns all). Deduped per day.
    await db.notifications.update_one(
        {"type": "low_stock_digest", "assigned_to": None, "date": today},
        {
            "$set": {"title": title, "message": message, "task_id": f"lowstock-{today}"},
            "$setOnInsert": {
                "type": "low_stock_digest", "assigned_to": None, "date": today,
                "is_read": False, "created_at": datetime.now(timezone.utc).isoformat(),
            },
        },
        upsert=True,
    )

    # Email digest to admin + store users (only if SMTP is configured).
    # Throttle: send the low-stock email AT MOST ONCE PER CALENDAR DAY for any
    # automatic trigger, so it never fires on every stock update — only the first
    # run of the day emails. A manual "Run now" (trigger="manual") always sends.
    allow_email = True
    if trigger != "manual":
        guard = await db.app_meta.update_one(
            {"_id": f"low_stock_email_{today}"},
            {"$setOnInsert": {"sent_at": datetime.now(timezone.utc).isoformat()}},
            upsert=True,
        )
        allow_email = guard.upserted_id is not None  # True only on the day's first run
        if not allow_email:
            log.info(f"[low_stock] email already sent today ({today}) — skipping (trigger={trigger})")

    recipients = await db.users.find(
        {"role": {"$in": ["admin", "store"]}, "is_active": {"$ne": False}},
        {"_id": 0, "email": 1},
    ).to_list(500)
    emails = sorted({u["email"] for u in recipients if u.get("email")})
    cfg = await _email_cfg()
    sent = 0
    if cfg and emails and allow_email:
        se, ap, sn = cfg
        body = _low_stock_email_body(low, out)
        subject = f"[SmartShape] Low stock — {len(low)} item(s) need reordering"
        for em in emails:
            try:
                await asyncio.to_thread(_smtp_send, se, ap, sn, em, subject, body)
                sent += 1
            except Exception as exc:
                log.error(f"[low_stock] email to {em} failed: {exc}")

    log.info(f"[low_stock] {len(low)} low ({len(out)} out) trigger={trigger} emailed={sent}")
    return {"ok": True, "low": len(low), "out": len(out),
            "notified": 1, "emailed": sent, "trigger": trigger}


async def low_stock_loop():
    log.info("[scheduler] low-stock checker started (fires daily at 8am IST)")
    while True:
        try:
            now_ist = datetime.now(IST)
            target = now_ist.replace(hour=8, minute=0, second=0, microsecond=0)
            if now_ist >= target:
                target += timedelta(days=1)
            await asyncio.sleep(max(60, (target - now_ist).total_seconds()))
            await run_low_stock_check(trigger="scheduled")
        except Exception as exc:
            log.error(f"[low_stock loop] {exc}")
            await asyncio.sleep(3600)


# ══════════════════════════════════════════════════════════════════════════════
# JOB 10 — Returnable-challan due reminders (admin / accounts / store)
# ══════════════════════════════════════════════════════════════════════════════

def _challans_due(challans, today):
    """Open/partially-returned returnable challans whose return date is today or past."""
    out = []
    for c in challans or []:
        if c.get("status") == "closed":
            continue
        d = c.get("expected_return_date")
        if d and d <= today:
            out.append(c)
    return out


async def run_challan_due_check():
    """Notify admin/accounts/store about returnable challans due back today or overdue.

    One notification per challan, broadcast via `target_roles` so non-admins see it
    too (admins see all notifications)."""
    today = datetime.now(IST).date().isoformat()
    challans = await db.challans.find(
        {"type": "returnable_out", "status": {"$ne": "closed"},
         "expected_return_date": {"$ne": None}},
        {"_id": 0}).to_list(2000)
    due = _challans_due(challans, today)
    if not due:
        log.info("[challan-due] none due")
        return {"due": 0, "notified": 0}
    for c in due:
        overdue = (c.get("expected_return_date") or "") < today
        label = "overdue" if overdue else "due today"
        party = c.get("party_name") or "party"
        pending = sum(
            1 for l in c.get("lines", [])
            if float(l.get("qty", 0) or 0) > float(l.get("returned_qty", 0) or 0))
        cno = c.get("challan_no", "")
        await db.notifications.update_one(
            {"type": "returnable_challan_due", "challan_id": c.get("challan_id"), "date": today},
            {"$set": {
                "title": f"Returnable challan {label}: {cno}",
                "message": f"{cno} to {party} — {pending} item(s) to come back "
                           f"(expected {c.get('expected_return_date')})",
             },
             "$setOnInsert": {
                "type": "returnable_challan_due", "challan_id": c.get("challan_id"),
                "date": today, "assigned_to": None,
                "target_roles": ["admin", "accounts", "store"],
                "is_read": False, "created_at": datetime.now(timezone.utc).isoformat(),
             }},
            upsert=True)
    log.info(f"[challan-due] {len(due)} due, notifications upserted")
    return {"due": len(due), "notified": len(due)}


async def challan_due_loop():
    log.info("[scheduler] returnable-challan due checker started (daily 08:30 IST)")
    while True:
        try:
            now_ist = datetime.now(IST)
            target = now_ist.replace(hour=8, minute=30, second=0, microsecond=0)
            if now_ist >= target:
                target += timedelta(days=1)
            await asyncio.sleep(max(60, (target - now_ist).total_seconds()))
            await run_challan_due_check()
        except Exception as exc:
            log.error(f"[challan-due loop] {exc}")
            await asyncio.sleep(3600)


# ══════════════════════════════════════════════════════════════════════════════
# JOB 13 — Keep-in-touch: re-touch silent accounts (Engagement OS, Phase 4)
# ══════════════════════════════════════════════════════════════════════════════

async def run_silence_retouch(force=False):
    """Keep-in-touch: queue a check-in call task for accounts that have gone
    silent, so nothing goes cold. Two rhythms:
      • Active leads (open stages) — the sales nudge.
      • Won customers — the post-sale reorder/referral nudge (closes the
        'funnel forgets customers the moment they buy' gap).
    Idempotent per lead, capped, lands on the owner's calendar + daily queue."""
    cfg = await db.settings.find_one({"type": "keepintouch"}, {"_id": 0}) or {}
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    today = now.strftime("%Y-%m-%d")
    total = {"created": 0}

    async def _pass(stages, days, title, note, source):
        cutoff = (now - timedelta(days=days)).isoformat()
        n = 0
        cur = db.leads.find(
            {"stage": {"$in": list(stages)}},
            {"_id": 0, "lead_id": 1, "school_id": 1, "company_name": 1,
             "assigned_to": 1, "assigned_name": 1, "last_activity_date": 1, "created_at": 1})
        async for lead in cur:
            if n >= 300:
                break
            owner = lead.get("assigned_to")
            if not owner:
                continue
            la = lead.get("last_activity_date") or lead.get("created_at") or ""
            if not la or la >= cutoff:
                continue
            lid = lead.get("lead_id")
            if await db.crm_activities.find_one(
                    {"lead_id": lid, "source": source, "status": "pending"}, {"_id": 0, "activity_id": 1}):
                continue
            await db.crm_activities.insert_one({
                "activity_id": f"act_{uuid.uuid4().hex[:10]}",
                "lead_id": lid, "school_id": lead.get("school_id", ""),
                "school_name": lead.get("company_name", ""),
                "activity_type": "Call", "channel": "call", "priority": "medium",
                "title": title, "notes": note, "due_date": today,
                "assigned_to": owner, "assigned_name": lead.get("assigned_name", ""),
                "status": "pending", "source": source,
                "created_by": "system", "created_at": now_iso, "done_at": None})
            n += 1
        return n

    # Sales pass — active leads.
    leads_days = 0
    if force or cfg.get("enabled"):
        leads_days = max(7, int(cfg.get("silence_days", 60) or 60))
        total["created"] += await _pass(
            OPEN_STAGES, leads_days,
            f"Keep in touch — no contact in {leads_days}+ days",
            "Auto keep-in-touch: this account has gone quiet. A quick check-in keeps it warm.",
            "keepintouch")

    # Customer pass — Won accounts (reorder / referral nurture).
    cust_days = 0
    if force or cfg.get("customers_enabled"):
        cust_days = max(7, int(cfg.get("customer_silence_days", 45) or 45))
        total["created"] += await _pass(
            ["won"], cust_days,
            f"Keep in touch with customer — {cust_days}+ days since contact",
            "Post-sale keep-in-touch: check in on this customer — reorder, referral, or a simple hello keeps them loyal.",
            "keepintouch_customer")

    if not force and not cfg.get("enabled") and not cfg.get("customers_enabled"):
        return {"created": 0, "skipped": "disabled"}
    log.info(f"[keepintouch] queued {total['created']} (leads>={leads_days}d, customers>={cust_days}d)")
    return {"created": total["created"], "silence_days": leads_days, "customer_silence_days": cust_days}


async def keepintouch_loop():
    log.info("[scheduler] keep-in-touch loop started")
    last_fired = None
    while True:
        try:
            cfg = await db.settings.find_one({"type": "keepintouch"}, {"_id": 0}) or {}
            now_ist = datetime.now(IST)
            today = now_ist.date().isoformat()
            on = cfg.get("enabled") or cfg.get("customers_enabled")
            if on and now_ist.strftime("%H:%M") == cfg.get("send_time", "09:30") and last_fired != today:
                last_fired = today
                await run_silence_retouch()
        except Exception as exc:
            log.error(f"[keepintouch loop] {exc}")
        await asyncio.sleep(45)


# ══════════════════════════════════════════════════════════════════════════════
# JOB 15 — Overdue post: pieces that were planned but never actually went out
# ══════════════════════════════════════════════════════════════════════════════

async def run_mail_overdue_nudge():
    """Post that was planned but never posted. Opt-in, once per run per day.

    Two deliberately quiet thresholds: printed but unposted for over a day (the
    sticker exists, the packet didn't move), and planned but never even printed
    for over three days.
    """
    cfg = await db.settings.find_one({"type": "notifications"}, {"_id": 0}) or {}
    if not cfg.get("mail_overdue_nudge"):
        return

    now = datetime.now(timezone.utc)
    today = now.strftime("%Y-%m-%d")
    printed_cut = (now - timedelta(days=1)).isoformat()
    planned_cut = (now - timedelta(days=3)).strftime("%Y-%m-%d")

    overdue = await db.mail_touches.find({
        "verify_status": "pending",
        "planned_date": {"$lt": today, "$ne": ""},
        "$or": [
            {"printed_at": {"$ne": None, "$lt": printed_cut}},
            {"printed_at": None, "planned_date": {"$lt": planned_cut}},
        ],
    }, {"_id": 0}).to_list(2000)
    if not overdue:
        return

    by_run = {}
    for t in overdue:
        by_run.setdefault(t.get("run_id", ""), []).append(t)

    for run_id, touches in by_run.items():
        run = await db.mail_runs.find_one({"run_id": run_id}, {"_id": 0}) or {}
        owner = touches[0].get("owner") or run.get("created_by") or ""
        if not owner:
            continue
        n = len(touches)
        # notify_user does the de-duplication (per recipient, while unread), so
        # the nudge doesn't repeat every hour until the post actually goes out.
        await notify_user(
            owner, type="mail_overdue", dedup_key=f"mailnudge:{run_id}:{today}",
            title="📮 Post still waiting to go out",
            body=(f"{n} piece{'s' if n != 1 else ''} from \"{run.get('name', 'a mail run')}\" "
                  f"{'were' if n != 1 else 'was'} planned earlier and "
                  f"{'have' if n != 1 else 'has'} not been posted yet."),
            ref_type="mail_run", ref_id=run_id, from_name="Offline Mail")
        log.info(f"[mail] overdue nudge → {owner}: {n} piece(s) on run {run_id}")


async def mail_overdue_loop():
    log.info("[scheduler] mail overdue nudge started (interval: 6 hr)")
    while True:
        try:
            await run_mail_overdue_nudge()
        except Exception as exc:
            log.error(f"[mail overdue loop] {exc}")
        await asyncio.sleep(6 * 60 * 60)


# ══════════════════════════════════════════════════════════════════════════════
# JOB 14 — Balance-due reminders (chase money on dispatched/credit orders)
# ══════════════════════════════════════════════════════════════════════════════

async def run_balance_reminders(force=False):
    """Queue a 'collect balance' task for every shipped order that still has an
    outstanding balance older than N days — so credit/part-paid sales get chased
    instead of just sitting on the outstanding report. Idempotent per order."""
    cfg = await db.settings.find_one({"type": "balance_reminder"}, {"_id": 0}) or {}
    if not force and not cfg.get("enabled"):
        return {"created": 0, "skipped": "disabled"}
    days = max(0, int(cfg.get("days", 7) or 7))
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    today = now.strftime("%Y-%m-%d")
    cutoff = (now - timedelta(days=days)).strftime("%Y-%m-%d")

    created = 0
    shipped = {"$in": ["dispatched", "delivered", "partially_dispatched"]}
    cur = db.orders.find(
        {"order_status": shipped},
        {"_id": 0, "order_id": 1, "order_number": 1, "school_id": 1, "school_name": 1,
         "grand_total": 1, "total_paid": 1, "payment_received": 1, "assigned_to": 1,
         "assigned_name": 1, "dispatch_date": 1, "created_at": 1, "dispatched_on_credit": 1})
    async for o in cur:
        if created >= 300:
            break
        grand = float(o.get("grand_total", 0) or 0)
        paid = float(o.get("total_paid", o.get("payment_received", 0)) or 0)
        outstanding = round(grand - paid, 2)
        if outstanding <= 0:
            continue
        ship_day = (o.get("dispatch_date") or o.get("created_at") or "")[:10]
        if not ship_day or ship_day > cutoff:
            continue  # too recent
        oid = o.get("order_id")
        if await db.crm_activities.find_one(
                {"order_id": oid, "source": "balance_due", "status": "pending"}, {"_id": 0, "activity_id": 1}):
            continue
        owner = o.get("assigned_to", "")
        owner_name = o.get("assigned_name", "")
        if not owner and o.get("school_id"):
            sch = await db.schools.find_one({"school_id": o["school_id"]}, {"_id": 0, "assigned_to": 1, "assigned_name": 1})
            owner = (sch or {}).get("assigned_to", "")
            owner_name = (sch or {}).get("assigned_name", "")
        credit = " (credit)" if o.get("dispatched_on_credit") else ""
        await db.crm_activities.insert_one({
            "activity_id": f"act_{uuid.uuid4().hex[:10]}", "order_id": oid,
            "school_id": o.get("school_id", ""), "school_name": o.get("school_name", ""),
            "activity_type": "Call", "channel": "call", "priority": "high",
            "title": f"💰 Collect balance ₹{outstanding:,.0f} — {o.get('school_name') or o.get('order_number') or 'order'}{credit}",
            "notes": f"Order {o.get('order_number', oid)} shipped {ship_day}; balance ₹{outstanding:,.0f} of ₹{grand:,.0f} outstanding.",
            "due_date": today, "assigned_to": owner, "assigned_name": owner_name,
            "status": "pending", "source": "balance_due",
            "created_by": "system", "created_at": now_iso, "done_at": None})
        created += 1
    log.info(f"[balance] queued {created} balance-due reminders (>= {days}d after dispatch)")
    return {"created": created, "days": days}


async def balance_reminder_loop():
    log.info("[scheduler] balance-reminder loop started")
    last_fired = None
    while True:
        try:
            cfg = await db.settings.find_one({"type": "balance_reminder"}, {"_id": 0}) or {}
            now_ist = datetime.now(IST)
            today = now_ist.date().isoformat()
            if cfg.get("enabled") and now_ist.strftime("%H:%M") == cfg.get("send_time", "10:00") and last_fired != today:
                last_fired = today
                await run_balance_reminders()
        except Exception as exc:
            log.error(f"[balance loop] {exc}")
        await asyncio.sleep(45)


async def start_scheduler():
    """Start all background automation loops. Call once from FastAPI startup."""
    asyncio.create_task(email_sender_loop())
    asyncio.create_task(wa_sender_loop())
    asyncio.create_task(drip_executor_loop())
    asyncio.create_task(greeting_loop())
    asyncio.create_task(fms_sla_loop())
    asyncio.create_task(crm_digest_loop())
    asyncio.create_task(cert_loop())
    asyncio.create_task(low_stock_loop())
    asyncio.create_task(daily_digest_loop())
    asyncio.create_task(daily_orders_report_loop())
    asyncio.create_task(challan_due_loop())
    asyncio.create_task(webinar_lifecycle_loop())
    asyncio.create_task(keepintouch_loop())
    asyncio.create_task(balance_reminder_loop())
    asyncio.create_task(mail_overdue_loop())
    log.info("[scheduler] cert loop running")
    log.info("[scheduler] all 14 background jobs running")
