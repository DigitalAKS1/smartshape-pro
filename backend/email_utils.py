"""Pure, DB-free email HTML/text helpers. Unit-tested in tests/test_email_utils.py."""
import re
import bleach

_ALLOWED_TAGS = [
    "a", "b", "strong", "i", "em", "u", "p", "br", "hr", "span", "div",
    "ul", "ol", "li", "blockquote", "h1", "h2", "h3", "h4",
    "table", "thead", "tbody", "tr", "td", "th", "img", "center", "font",
]
_ALLOWED_ATTRS = {
    "*": ["style", "align", "width", "height", "bgcolor", "class"],
    "a": ["href", "target", "rel", "style"],
    "img": ["src", "alt", "width", "height", "style"],
    "table": ["cellpadding", "cellspacing", "border", "role", "width", "style", "align", "bgcolor"],
    "td": ["colspan", "rowspan", "valign", "align", "width", "height", "bgcolor", "style"],
    "font": ["color", "face", "size"],
}
_ALLOWED_PROTOCOLS = ["http", "https", "mailto"]


def sanitize_html(html: str) -> str:
    if not html:
        return ""
    # Use tinycss2 for CSS sanitization if available
    try:
        from bleach.css_sanitizer import CSSSanitizer
        css_sanitizer = CSSSanitizer()
    except ImportError:
        css_sanitizer = None

    cleaned = bleach.clean(
        html,
        tags=_ALLOWED_TAGS,
        attributes=_ALLOWED_ATTRS,
        protocols=_ALLOWED_PROTOCOLS,
        strip=True,
        strip_comments=True,
        css_sanitizer=css_sanitizer,
    )
    # bleach's css sanitizer isn't enabled by default; belt-and-braces on url()/expression
    cleaned = re.sub(r"(?i)expression\s*\(", "", cleaned)
    return cleaned


def personalize(text: str, name: str = "", school_name: str = "") -> str:
    if not text:
        return text or ""
    return text.replace("{name}", name or "").replace("{school_name}", school_name or "")


def plain_from_html(html: str) -> str:
    if not html:
        return ""
    text = re.sub(r"(?is)<(script|style).*?</\1>", "", html)
    text = re.sub(r"(?i)<br\s*/?>", "\n", text)
    text = re.sub(r"(?i)</p>", "\n\n", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"[ \t]+", " ", text)
    return text.strip()


_SHELL = """<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">
<tr><td style="background:#e94560;padding:20px 28px;">
<span style="color:#ffffff;font-size:20px;font-weight:bold;letter-spacing:.3px;">SmartShape</span></td></tr>
<tr><td style="padding:28px;">{INNER}</td></tr>
<tr><td style="padding:18px 28px;background:#fafafa;border-top:1px solid #eee;font-size:12px;color:#888;">
SmartShape, Faridabad · www.smartshape.in<br>{UNSUB}</td></tr>
</table></td></tr></table></body></html>"""


def wrap_email_shell(inner_html: str, *, unsubscribe_note: str = "") -> str:
    if inner_html and "<html" in inner_html.lower():
        return inner_html
    unsub = unsubscribe_note or 'To stop receiving these emails, reply with "unsubscribe".'
    return _SHELL.replace("{INNER}", inner_html or "").replace("{UNSUB}", unsub)
