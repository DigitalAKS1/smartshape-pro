"""webinar_templates_html.py — email-safe HTML for the 6 AUTOMATED webinar
lifecycle stages (spec §5.1 / Appendix A.2 / A.4):

    confirm      Stage 2  Registration Confirmation   (auto, on register)
    remind_24h   Stage 3  Reminder (1-day)             (auto, T-24h)
    remind_1h    Stage 4  Reminder (1-hour)             (auto, T-1h)
    live         Stage 5  Live Now                      (auto, at start)
    noshow       Stage 6a No-show Recovery              (auto, T+ no_show)
    attended     Stage 6b Attended Follow-up            (auto, T+ attended)

Stage 1 (Webinar Invite) is manual and already handled by the composer /
`notify_session` — not part of this module.

Copy is adapted verbatim from Appendix A.4's subject-line and "Key tokens"
columns; no new copy invented. Each body is a table-based, inline-CSS,
email-safe fragment on a 600px shell with a bulletproof CTA button
(`<td bgcolor="#e94560">` + padded `<a>`), matching the pattern already used
in `email_templates_html.py`.

`render_stage(stage, tokens) -> (subject, html)` substitutes SESSION-level
tokens (title/date/time/join_url/add_to_calendar_url/host_name/
recording_url/platform) via plain str.replace. `{name}` / `{school_name}`
are deliberately left untouched — the caller (training_routes.py) fills
those per-recipient with personalize()/personalize_html() downstream, which
also HTML-escapes contact-sourced values.
"""

_ACCENT = "#e94560"
_INK = "#1a1a1a"
_MUTED = "#555555"
_FAINT = "#888888"
_FONT = "Arial, Helvetica, sans-serif"

# Reasonable existing-token stand-ins for Appendix A.4 CTA links that aren't
# session fields (book_demo_url / quotation_request_url) — no new tokens
# beyond the approved set (spec §5.2).
_SITE_URL = "https://www.smartshape.in"


def _wrap(inner: str) -> str:
    """600px, table-based, inline-CSS email shell — same shape as
    email_templates_html._wrap(); the outer brand chrome/footer is added at
    send time by email_utils.wrap_email_shell()."""
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'style="background:#f4f4f5;"><tr><td align="center" style="padding:24px 12px;">'
        '<table role="presentation" width="600" cellpadding="0" cellspacing="0" '
        f'style="max-width:600px;width:100%;background:#ffffff;font-family:{_FONT};color:{_INK};">'
        f'<tr><td style="padding:28px;font-size:15px;line-height:1.6;">{inner}</td></tr>'
        "</table></td></tr></table>"
    )


def _btn(text: str, href: str, note: str = "") -> str:
    """Bulletproof CTA: a table cell with bgcolor + a padded <a> tag."""
    note_html = (
        f'<p style="margin:14px 0 0;font-size:12px;color:{_FAINT};">{note}</p>' if note else ""
    )
    return (
        '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0;">'
        "<tr>"
        f'<td align="center" bgcolor="{_ACCENT}" style="border-radius:6px;">'
        f'<a href="{href}" style="display:inline-block;padding:14px 32px;font-family:{_FONT};'
        f'font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;'
        f'border-radius:6px;background:{_ACCENT};">{text}</a>'
        "</td></tr></table>"
        f"{note_html}"
    )


def _p(text: str) -> str:
    return f'<p style="margin:0 0 14px;">{text}</p>'


def _heading(text: str) -> str:
    return f'<h2 style="margin:0 0 14px;font-size:19px;color:{_INK};">{text}</h2>'


def _signoff(closing: str = "Warm regards,") -> str:
    return (
        f'<p style="margin:18px 0 0;">{closing}<br>'
        f'<strong>SmartShape Team</strong><br>'
        f'<span style="color:{_MUTED};">www.smartshape.in</span></p>'
    )


def _calendar_link(url: str) -> str:
    return f'<p style="margin:0 0 14px;"><a href="{url}" style="color:{_ACCENT};">Add to Calendar</a></p>'


# ---------------------------------------------------------------------------
# Stage 2 — Registration Confirmation
# ---------------------------------------------------------------------------
STAGE_SUBJECT = {}
STAGE_HTML = {}

STAGE_SUBJECT["confirm"] = "You're Registered: {session_title}"
STAGE_HTML["confirm"] = _wrap(
    _heading("You're registered, {name}!")
    + _p(
        "You're confirmed for <strong>{session_title}</strong> &mdash; "
        "we've locked in your spot."
    )
    + _p(
        "<strong>Date:</strong> {session_date} &nbsp; "
        "<strong>Time:</strong> {session_time}"
    )
    + _btn("Join the Session", "{join_url}", "Save this link &mdash; you'll need it on the day.")
    + _calendar_link("{add_to_calendar_url}")
    + _p("Hosted by <strong>{host_name}</strong>.")
    + _signoff("See you there,")
)

# ---------------------------------------------------------------------------
# Stage 3 — Reminder (1-day)
# ---------------------------------------------------------------------------
STAGE_SUBJECT["remind_24h"] = "Tomorrow: {session_title} at {session_time}"
STAGE_HTML["remind_24h"] = _wrap(
    _heading("Hi {name}, it's tomorrow!")
    + _p(
        "Just a reminder &mdash; <strong>{session_title}</strong> is happening "
        "tomorrow at <strong>{session_time}</strong>."
    )
    + _btn("Join the Session", "{join_url}")
    + _calendar_link("{add_to_calendar_url}")
    + _p("We'll see you there &mdash; don't miss it!")
    + _signoff()
)

# ---------------------------------------------------------------------------
# Stage 4 — Reminder (1-hour)
# ---------------------------------------------------------------------------
STAGE_SUBJECT["remind_1h"] = "Starting in 1 Hour: {session_title}"
STAGE_HTML["remind_1h"] = _wrap(
    _heading("Starting soon, {name}!")
    + _p(
        "<strong>{session_title}</strong> goes live in about an hour, at "
        "<strong>{session_time}</strong>. Here's your one-tap join link:"
    )
    + _btn("Join Now", "{join_url}")
    + _p("See you shortly!")
    + _signoff()
)

# ---------------------------------------------------------------------------
# Stage 5 — Live Now
# ---------------------------------------------------------------------------
STAGE_SUBJECT["live"] = "We're Live Now — Join: {session_title}"
STAGE_HTML["live"] = _wrap(
    _heading("We're live now, {name}!")
    + _p("<strong>{session_title}</strong> has started &mdash; join us now.")
    + _btn("Join the Session", "{join_url}")
    + _signoff("See you inside,")
)

# ---------------------------------------------------------------------------
# Stage 6a — No-show Recovery
# ---------------------------------------------------------------------------
STAGE_SUBJECT["noshow"] = "Sorry We Missed You — {session_title} Recording Inside"
STAGE_HTML["noshow"] = _wrap(
    _heading("Sorry we missed you, {name}")
    + _p(
        "We noticed you couldn't make it to <strong>{session_title}</strong> &mdash; "
        "no worries, here's the recording so you don't miss out."
    )
    + _btn("Watch the Recording", "{recording_url}")
    + _p(
        "If you'd rather see it live and ask questions in real time, we'd love "
        "to set up a personal demo for you instead."
    )
    + _btn("Book a Demo", _SITE_URL, "Pick a time that works for you.")
    + _p("Hosted by <strong>{host_name}</strong>.")
    + _signoff("Talk soon,")
)

# ---------------------------------------------------------------------------
# Stage 6b — Attended Follow-up
# ---------------------------------------------------------------------------
STAGE_SUBJECT["attended"] = "Thanks for Joining {session_title} — Your Next Step"
STAGE_HTML["attended"] = _wrap(
    _heading("Thanks for joining, {name}!")
    + _p(
        "It was great having <strong>{school_name}</strong> at "
        "<strong>{session_title}</strong>. Here's how to take the next step:"
    )
    + _btn("Book a Demo", _SITE_URL, "See it live at your school.")
    + _btn("Request a Quotation", _SITE_URL, "Get pricing tailored to {school_name}.")
    + _p("Hosted by <strong>{host_name}</strong>.")
    + _signoff("Looking forward,")
)


_SESSION_TOKEN_KEYS = (
    "session_title", "session_date", "session_time", "platform",
    "join_url", "add_to_calendar_url", "host_name", "recording_url",
)


def render_stage(stage: str, tokens: dict) -> tuple[str, str]:
    """Returns (subject, html) with SESSION-level tokens substituted.

    `tokens` keys are plain names (no braces), e.g. {"session_title": "...",
    "join_url": "..."}. `{name}` / `{school_name}` are intentionally left
    unsubstituted in the output for the caller's per-recipient
    personalize()/personalize_html() pass.
    """
    if stage not in STAGE_SUBJECT or stage not in STAGE_HTML:
        raise ValueError(f"Unknown webinar stage: {stage}")

    subject = STAGE_SUBJECT[stage]
    html = STAGE_HTML[stage]
    for key in _SESSION_TOKEN_KEYS:
        value = tokens.get(key) or ""
        placeholder = "{" + key + "}"
        subject = subject.replace(placeholder, value)
        html = html.replace(placeholder, value)
    return subject, html
