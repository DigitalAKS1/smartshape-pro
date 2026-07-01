"""email_templates_html.py — email-safe HTML bodies for seeded system email templates.

HTML_BODIES maps a template `name` (must match an entry in
routes.email_routes._DEFAULT_TEMPLATES) to an email-safe HTML fragment:
table-based layout, inline CSS only, no external stylesheets/JS, a
bulletproof CTA button (table/td bgcolor + padded <a>, not a CSS-only
button). `{name}` / `{school_name}` merge tokens are preserved verbatim so
existing personalize()/personalize_html() substitution keeps working.

_seed_templates() in routes/email_routes.py sets each template's `body_html`
from HTML_BODIES.get(name, ""). Templates not listed here simply seed with
an empty body_html (unaffected / not yet authored).
"""

_ACCENT = "#e94560"
_INK = "#1a1a1a"
_MUTED = "#555555"
_FAINT = "#888888"
_BORDER = "#eeeeee"
_FONT = "Arial, Helvetica, sans-serif"


def _wrap(inner: str) -> str:
    """600px, table-based, inline-CSS email shell (no header/footer chrome —
    routes.email_utils.wrap_email_shell() adds the outer brand chrome/footer
    at send time). This just wraps the template's own content block in a
    centered 600px table so it renders correctly on its own too."""
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'style="background:#f4f4f5;"><tr><td align="center" style="padding:24px 12px;">'
        '<table role="presentation" width="600" cellpadding="0" cellspacing="0" '
        f'style="max-width:600px;width:100%;background:#ffffff;font-family:{_FONT};color:{_INK};">'
        f'<tr><td style="padding:28px;font-size:15px;line-height:1.6;">{inner}</td></tr>'
        "</table></td></tr></table>"
    )


def _btn(text: str, note: str = "") -> str:
    """Bulletproof CTA: a table cell with bgcolor + a padded <a> tag (works even
    with images/CSS disabled in Outlook and most webmail clients)."""
    note_html = (
        f'<p style="margin:14px 0 0;font-size:12px;color:{_FAINT};">{note}</p>' if note else ""
    )
    return (
        '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0;">'
        "<tr>"
        f'<td align="center" bgcolor="{_ACCENT}" style="border-radius:6px;">'
        f'<a href="#" style="display:inline-block;padding:14px 32px;font-family:{_FONT};'
        f'font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;'
        f'border-radius:6px;background:{_ACCENT};">{text}</a>'
        "</td></tr></table>"
        f"{note_html}"
    )


def _p(text: str) -> str:
    return f'<p style="margin:0 0 14px;">{text}</p>'


def _list(items) -> str:
    lis = "".join(
        f'<li style="margin:0 0 8px;">{item}</li>' for item in items
    )
    return f'<ul style="margin:0 0 14px;padding-left:20px;">{lis}</ul>'


def _signoff(closing: str = "Warm regards,") -> str:
    return (
        f'<p style="margin:18px 0 0;">{closing}<br>'
        f'<strong>SmartShape Team</strong><br>'
        f'<span style="color:{_MUTED};">www.smartshape.in</span></p>'
    )


def _heading(text: str) -> str:
    return (
        f'<h2 style="margin:0 0 14px;font-size:19px;color:{_INK};">{text}</h2>'
    )


# ---------------------------------------------------------------------------
# 1. Principal Introduction Email
# ---------------------------------------------------------------------------
HTML_BODIES = {}

HTML_BODIES["Principal Introduction Email"] = _wrap(
    _heading("Namaskar {name} ji,")
    + _p(
        "I'm writing from <strong>SmartShape</strong> (founded 1999, Faridabad) &mdash; "
        "makers of the <strong>SMARTS-SHAPES</strong> die-cutting machine, used by "
        "<strong>750+ schools</strong> and <strong>1,500+ teachers</strong> across India."
    )
    + _p(
        "The machine lets your school produce unlimited craft shapes, decorations, "
        "charts, and activity materials in-house &mdash; from foam, paper, and fabric &mdash; "
        "in seconds, with no skill required. Schools that adopt it typically save "
        "<strong>&#8377;2&ndash;5 Lakhs</strong> every year on craft purchases and outsourced cutting."
    )
    + _p(
        "I'd love to share a brief overview and our ROI calculation for your school's "
        "scale. Would a 20-minute call or demo visit work for you this week?"
    )
    + _btn("Book My 20-Minute Call")
    + _signoff()
)

# ---------------------------------------------------------------------------
# 2. Demo Invitation Email
# ---------------------------------------------------------------------------
HTML_BODIES["Demo Invitation Email"] = _wrap(
    _heading("Hello {name},")
    + _p(
        "I'd like to invite you to a live demonstration of the <strong>SMARTS-SHAPES</strong> "
        "die-cutting machine at <strong>{school_name}</strong> &mdash; it takes just 20 minutes "
        "and consistently impresses both principals and teachers."
    )
    + _p("During the demo you'll see:")
    + _list(
        [
            "Perfect die-cut shapes from foam, paper, and fabric in seconds",
            "The full die library &mdash; 750+ designs across categories",
            "How teachers use it daily without any training burden",
            "A live ROI comparison for {school_name}'s spending",
        ]
    )
    + _p(
        "No purchase obligation &mdash; just a look at what 750+ schools are already using. "
        "We can work around your school schedule completely."
    )
    + _btn("Book a Demo at {school_name}", "Reply to this email or call us to book a slot.")
    + _signoff("Best,")
)

# ---------------------------------------------------------------------------
# 3. ROI Savings Calculator Email
# ---------------------------------------------------------------------------
HTML_BODIES["ROI Savings Calculator Email"] = _wrap(
    _heading("Hello {name},")
    + _p(
        "Quick question: what does <strong>{school_name}</strong> spend annually on craft "
        "materials, die-cut shapes, activity kits, and outsourced cutting?"
    )
    + _p(
        "Most schools we work with are surprised when they add it up &mdash; typically "
        "<strong>&#8377;3&ndash;6 Lakhs per year</strong>. With the SMARTS-SHAPES machine:"
    )
    + _list(
        [
            "One machine replaces all outsourced cutting and most craft material purchases",
            "Average school saves &#8377;2&ndash;5 Lakhs in year one",
            "Machine pays for itself within 8&ndash;14 months",
            "750+ schools across India have already made the switch",
        ]
    )
    + _p(
        "I can prepare a customised ROI calculation for {school_name}'s scale &mdash; "
        "based on student count and current craft spend &mdash; at no cost."
    )
    + _btn("Get My Free ROI Calculation")
    + _signoff("Best,")
)

# ---------------------------------------------------------------------------
# 4. Quotation Follow-up Email
# ---------------------------------------------------------------------------
HTML_BODIES["Quotation Follow-up Email"] = _wrap(
    _heading("Hello {name},")
    + _p(
        "I wanted to follow up on the SMARTS-SHAPES quotation I sent for "
        "<strong>{school_name}</strong>. I hope you had a chance to review it."
    )
    + _p("A few things to know:")
    + _list(
        [
            "The quotation is fully adjustable &mdash; we can modify the die selection, "
            "payment terms, or bundle composition to match your budget",
            "We can arrange a second demo or a reference call with another school if helpful",
            "Installation timelines are currently running 2&ndash;3 weeks from order confirmation",
        ]
    )
    + _p(
        "Is there anything specific holding the decision back? I'd love to help work "
        "through any concerns &mdash; budget, approvals, timing, or anything else."
    )
    + _btn("Discuss the Quotation", "Please feel free to reply or call directly.")
    + _signoff("Regards,")
)

# ---------------------------------------------------------------------------
# 5. New Academic Year Email
# ---------------------------------------------------------------------------
HTML_BODIES["New Academic Year Email"] = _wrap(
    _heading("Hello {name},")
    + _p(
        "A new academic year is approaching &mdash; and with it comes the familiar "
        "challenge of sourcing craft materials, managing activity budgets, and preparing "
        "for competitions, events, and daily art classes."
    )
    + _p(
        "This is the year many schools we work with decided to bring it all in-house "
        "with the SMARTS-SHAPES machine. The difference is significant:"
    )
    + _list(
        [
            "<strong>Before:</strong> ordering craft materials monthly, waiting for stock, paying per piece",
            "<strong>After:</strong> all shapes made in-house, on demand, at a fraction of the cost",
        ]
    )
    + _p(
        "750+ schools across India have already made this shift. Could this be the "
        "right session for <strong>{school_name}</strong>?"
    )
    + _btn("Schedule a Demo Before Budget Finalisation")
    + _signoff("Best,")
)

# ---------------------------------------------------------------------------
# 6. NEW — New Die Collection Announcement (seasonal)
# ---------------------------------------------------------------------------
NEW_DIE_COLLECTION_BODY = (
    "Hello {name},\n\n"
    "Big news from SmartShape &mdash; our newest Die Collection has just launched, "
    "with 80+ fresh designs across festive, STEM, and activity categories.\n\n"
    "Highlights:\n"
    "- New festival sets (seasonal celebrations across the school calendar)\n"
    "- STEM & subject-specific shapes for science and math activities\n"
    "- Regional alphabets and language sets\n"
    "- Bulletin board borders and frames refreshed for the new session\n\n"
    "As always, the full collection is included at no extra cost for existing "
    "{school_name} SMARTS-SHAPES owners, and available in the starter bundle for "
    "new installations.\n\n"
    "Would you like the updated catalogue PDF sent over?\n\n"
    "Best,\nSmartShape Team"
)
HTML_BODIES["New Die Collection Announcement"] = _wrap(
    _heading("Hello {name},")
    + _p(
        "Big news from SmartShape &mdash; our newest <strong>Die Collection</strong> has "
        "just launched, with <strong>80+ fresh designs</strong> across festive, STEM, and "
        "activity categories."
    )
    + _p("Highlights:")
    + _list(
        [
            "New festival sets (seasonal celebrations across the school calendar)",
            "STEM & subject-specific shapes for science and math activities",
            "Regional alphabets and language sets",
            "Bulletin board borders and frames refreshed for the new session",
        ]
    )
    + _p(
        "As always, the full collection is included at no extra cost for existing "
        "<strong>{school_name}</strong> SMARTS-SHAPES owners, and available in the "
        "starter bundle for new installations."
    )
    + _btn("Send Me the Updated Catalogue")
    + _signoff("Best,")
)

# ---------------------------------------------------------------------------
# 7. NEW — Seasonal Offer / Promo (offer)
# ---------------------------------------------------------------------------
SEASONAL_OFFER_BODY = (
    "Hello {name},\n\n"
    "For a limited time, SmartShape is running a seasonal offer on the "
    "SMARTS-SHAPES machine for schools planning ahead of the new term.\n\n"
    "Offer includes:\n"
    "- SMARTS-SHAPES machine at a special seasonal price\n"
    "- Free 50-die starter pack (worth Rs 8,000)\n"
    "- Priority installation slot before the rush\n"
    "- 1-year warranty + dedicated support\n\n"
    "This pricing is available only while the seasonal offer window is open. "
    "Would you like the details sent over for {school_name}?\n\n"
    "Best,\nSmartShape Team"
)
HTML_BODIES["Seasonal Offer / Promo"] = _wrap(
    _heading("Hello {name},")
    + _p(
        "For a limited time, SmartShape is running a <strong>seasonal offer</strong> on "
        "the SMARTS-SHAPES machine for schools planning ahead of the new term."
    )
    + _p("Offer includes:")
    + _list(
        [
            "SMARTS-SHAPES machine at a special seasonal price",
            "Free 50-die starter pack (worth &#8377;8,000)",
            "Priority installation slot before the rush",
            "1-year warranty + dedicated support",
        ]
    )
    + _p(
        "This pricing is available only while the seasonal offer window is open. "
        "Would you like the details sent over for <strong>{school_name}</strong>?"
    )
    + _btn("Claim the Seasonal Offer", "Offer valid for a limited time only.")
    + _signoff("Best,")
)

# ---------------------------------------------------------------------------
# 8. Cold Lead Revival Email — HTML for the EXISTING reengagement template
#    (no duplicate created; _DEFAULT_TEMPLATES already has this name/category)
# ---------------------------------------------------------------------------
HTML_BODIES["Cold Lead Revival Email"] = _wrap(
    _heading("Hello {name},")
    + _p(
        "It's been some time since we last connected, and I wanted to reach out "
        "with a genuine update &mdash; a lot has changed at SmartShape."
    )
    + _p("What's new:")
    + _list(
        [
            "150+ new die designs added to our library (STEM, regional, festive)",
            "Improved payment plans &mdash; 12-month zero-cost EMI now available",
            "Extended warranty on all new machines",
            "50+ new school installations in the past 6 months &mdash; now 750+ schools",
        ]
    )
    + _p(
        "If the timing wasn't right before, I'd love to reconnect and see if "
        "things look different now. Even a 15-minute call could be worth it."
    )
    + _btn("Let's Reconnect", "No pressure &mdash; just wanted to stay in touch.")
    + _signoff("Best,")
)


# ---------------------------------------------------------------------------
# New system template dicts, ready to append to _DEFAULT_TEMPLATES in
# routes/email_routes.py. Kept here so the plain-text `body` lives alongside
# its HTML counterpart and both stay in sync.
# ---------------------------------------------------------------------------
NEW_DEFAULT_TEMPLATES = [
    {
        "name": "New Die Collection Announcement",
        "category": "seasonal",
        "variables": ["name", "school_name"],
        "subject": "80+ New Designs Just Launched — SmartShape Die Collection Update",
        "body": NEW_DIE_COLLECTION_BODY,
        "is_active": True, "usage_count": 0,
    },
    {
        "name": "Seasonal Offer / Promo",
        "category": "offer",
        "variables": ["name", "school_name"],
        "subject": "Seasonal Offer: Free Starter Pack + Priority Installation for {school_name}",
        "body": SEASONAL_OFFER_BODY,
        "is_active": True, "usage_count": 0,
    },
]
