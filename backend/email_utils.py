"""Pure, DB-free email HTML/text helpers. Unit-tested in tests/test_email_utils.py.

`bleach` is imported LAZILY inside sanitize_html (never at module load) so a missing
dependency on a server that hasn't pip-installed it cannot crash the whole app at import.
When bleach is absent we fall back to a regex sanitizer that strips the dangerous bits.
"""
import re
import html as _html

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


def _fallback_sanitize(html: str) -> str:
    """Regex sanitizer used only when bleach isn't installed. Not a full allowlist,
    but strips the genuinely dangerous constructs (contact values are also HTML-escaped
    via personalize_html, so this is defense-in-depth on app-controlled template HTML)."""
    html = re.sub(r"(?is)<(script|style|iframe|object|embed)[^>]*>.*?</\1\s*>", "", html)
    html = re.sub(r"(?is)<(script|style|iframe|object|embed)[^>]*/?>", "", html)
    html = re.sub(r'(?i)\son\w+\s*=\s*("[^"]*"|\'[^\']*\'|[^\s>]+)', "", html)
    html = re.sub(r'(?i)(href|src)\s*=\s*(["\']?)\s*javascript:[^"\'>\s]*', r'\1=\2#', html)
    return html


def _sanitize_email_doc(html: str) -> str:
    """For staff-authored FULL email designs (a <style> block or a whole <html> document):
    KEEP the structure + CSS + layout so the design renders, and strip ONLY the executable
    vectors (script/iframe/object/embed/form, on*= handlers, javascript: URLs, CSS expression()).
    Contact-sourced values are separately HTML-escaped via personalize_html, so this is safe."""
    html = re.sub(r"(?is)<(script|iframe|object|embed|form)\b[^>]*>.*?</\1\s*>", "", html)
    html = re.sub(r"(?is)<(script|iframe|object|embed|form)\b[^>]*/?>", "", html)
    html = re.sub(r'(?i)\son\w+\s*=\s*("[^"]*"|\'[^\']*\'|[^\s>]+)', "", html)   # onload=, onclick=…
    html = re.sub(r'(?i)(href|src)\s*=\s*(["\']?)\s*javascript:[^"\'>\s]*', r'\1=\2#', html)
    html = re.sub(r"(?i)expression\s*\(", "", html)
    return html


def sanitize_html(html: str) -> str:
    if not html:
        return ""
    low = html.lower()
    # Staff-authored email designs — preserve <style>/layout/full document; strip only JS vectors.
    if "<style" in low or "<html" in low or "<!doctype" in low:
        return _sanitize_email_doc(html)
    # Plain fragments — strict allow-list via bleach (fallback regex if bleach missing).
    try:
        import bleach  # lazy — a missing dep must never crash app startup
        cleaned = bleach.clean(
            html,
            tags=_ALLOWED_TAGS,
            attributes=_ALLOWED_ATTRS,
            protocols=_ALLOWED_PROTOCOLS,
            strip=True,
            strip_comments=True,
        )
    except Exception:
        cleaned = _fallback_sanitize(html)
    cleaned = re.sub(r"(?i)expression\s*\(", "", cleaned)
    return cleaned


def personalize(text: str, name: str = "", school_name: str = "") -> str:
    if not text:
        return text or ""
    return text.replace("{name}", name or "").replace("{school_name}", school_name or "")


def personalize_html(text: str, name: str = "", school_name: str = "") -> str:
    """Like personalize(), but HTML-escapes the substituted values so contact-sourced
    data cannot inject markup into already-sanitized HTML. Use for HTML bodies only."""
    if not text:
        return text or ""
    return (text.replace("{name}", _html.escape(name or ""))
                .replace("{school_name}", _html.escape(school_name or "")))


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
