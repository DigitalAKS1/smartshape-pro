"""
Claude AI message personalizer for WhatsApp campaigns.

Primary path  : claude-haiku-4-5 generates a unique, context-aware message per recipient.
Fallback path : simple {variable} substitution when Claude is unavailable/times out.

Import:
    from services.ai_personalizer import personalize_message
"""

import os
import logging
import asyncio
from functools import lru_cache

logger = logging.getLogger(__name__)

_HAIKU_MODEL = "claude-haiku-4-5-20251001"

# ── SmartShape company context injected into every personalisation prompt ──────
_COMPANY_CONTEXT = """
SmartShape (est. 1999, Faridabad, India) manufactures the SMARTS-SHAPES die-cutting machine.
Key facts to weave in naturally when relevant:
- Used by 750+ schools across India
- Saves schools ₹2–5 Lakhs per year vs. outsourcing craft/activity materials
- Creates 100+ shapes per hour (bulletin boards, teaching aids, festive decor, math manipulatives)
- Includes free installation, teacher training (worth ₹25,000), and 200+ die designs
- GST invoice provided; EMI available
- Sales reps do free live demos at school — 15 minutes, no obligation
""".strip()

_STAGE_NUDGES = {
    "demo":        "subtly mention the sales rep can arrange a live demo this week",
    "negotiation": "add a soft urgency nudge — installation slots for the academic term are limited",
    "quoted":      "remind them the quote is valid for 30 days and they can reply to confirm",
    "follow_up":   "be warm and check in — ask if they have any questions about the machine",
    "won":         "congratulate and share excitement about their upcoming installation",
}


@lru_cache(maxsize=1)
def _get_client():
    """Lazy-load Anthropic client — cached after first call."""
    key = os.getenv("ANTHROPIC_API_KEY", "")
    if not key:
        logger.warning("ANTHROPIC_API_KEY not set — AI personalisation disabled, using template fallback")
        return None
    try:
        import anthropic
        return anthropic.Anthropic(api_key=key)
    except ImportError:
        logger.error("anthropic package not installed")
        return None


def _simple_substitute(template: str, contact: dict) -> str:
    """Guaranteed-safe fallback: simple variable substitution."""
    first_name = ((contact.get("first_name") or contact.get("name") or "").split() or [""])[0]
    return (
        template
        .replace("{name}", first_name)
        .replace("{first_name}", first_name)
        .replace("{school_name}", contact.get("company") or "your school")
        .replace("{city}", contact.get("city") or "")
        .replace("{designation}", contact.get("designation") or "")
    )


async def personalize_message(
    template: str,
    contact: dict,
    campaign_name: str = "",
    ai_enabled: bool = True,
) -> str:
    """
    Returns a personalised WhatsApp message for *contact* based on *template*.

    If `ai_enabled=False` or Claude is unavailable, falls back to simple substitution.
    Never raises — always returns a sendable string.
    """
    if not ai_enabled:
        return _simple_substitute(template, contact)

    client = _get_client()
    if client is None:
        return _simple_substitute(template, contact)

    name        = contact.get("name", "")
    school      = contact.get("company") or "your school"
    designation = contact.get("designation", "")
    city        = contact.get("city", "")
    stage       = (contact.get("stage") or "").lower()
    stage_nudge = _STAGE_NUDGES.get(stage, "")

    prompt = f"""You are a WhatsApp sales copywriter for SmartShape, an Indian school equipment company.

COMPANY CONTEXT:
{_COMPANY_CONTEXT}

RECIPIENT:
- Name: {name}
- School: {school}
- Designation: {designation or "not specified"}
- City: {city or "not specified"}
- Pipeline stage: {stage or "new"}
{f"- Nudge: {stage_nudge}" if stage_nudge else ""}

BASE TEMPLATE TO PERSONALISE:
\"\"\"
{template}
\"\"\"

RULES:
1. Output ONLY the final WhatsApp message — no quotes, no explanation, no prefix
2. Use the same language mix as the template (Hindi + English is fine)
3. For Principals/Directors, use "ji" after their name (Indian cultural norm)
4. Naturally mention their school name once
5. Keep the same emoji style and approximate length as the template
6. Do NOT make up facts not in the context above
7. If stage nudge is given, weave it in naturally at the end (1 short line)"""

    try:
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            None,
            lambda: client.messages.create(
                model=_HAIKU_MODEL,
                max_tokens=600,
                messages=[{"role": "user", "content": prompt}],
            ),
        )
        text = response.content[0].text.strip()
        return text if text else _simple_substitute(template, contact)
    except Exception as exc:
        logger.warning(f"Claude personalisation failed ({exc}) — using template fallback for {contact.get('name')}")
        return _simple_substitute(template, contact)
