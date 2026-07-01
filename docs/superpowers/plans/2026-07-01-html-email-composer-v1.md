# HTML Email Engine + Composer (v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade SmartShape's single email pipeline to send branded HTML, add one reusable Email Composer (rich-text + paste-HTML + template picker + recipient multi-select + preview/test/confirm), and route every "Send" button through it.

**Architecture:** Every email already flows `email_scheduled` → `scheduler.process_email_queue` → `_smtp_send` (Gmail SMTP). We add an optional `body_html` that rides that same pipe as a `multipart/alternative` HTML part, plus compliance headers (`List-Unsubscribe`) and a suppression check. A new `POST /email/send-now` creates a source-tagged campaign and enqueues personalized HTML; the frontend `<EmailComposerDialog>` is the single UI that calls it. The two rogue inline-SMTP blast paths are retired onto the queue.

**Tech Stack:** FastAPI + Motor/MongoDB (Python), React + Tailwind (CRA), `bleach` (server HTML sanitize), `react-quill` + `dompurify` (client editor + preview sanitize), `smtplib`/`email.mime` (existing).

## Global Constraints

- **NEVER run tests against production data.** Backend integration tests require a server started with `DB_NAME=smartshape_test`. Pure-logic tests must mock `smtplib` and touch no DB. (Repo convention: tests in `backend/tests/` hit a live server via `REACT_APP_BACKEND_URL`, login `info@smartshape.in`.)
- **Backward compatible:** `body_html` is always optional; when absent, behavior is byte-identical to today (plain text).
- **No schema migration:** new fields are additive and defaulted at read/write time.
- **Sanitize all HTML** server-side with `bleach` before storing or sending; render previews only inside a sandboxed iframe client-side.
- **Email-safe HTML:** 600px max width, table-based layout, inline CSS, bulletproof CTA buttons. No flexbox/grid in email bodies.
- **Personalization tokens** are `{name}` and `{school_name}`; unknown tokens resolve to empty string, never raise.
- **Deps floor:** `react-quill@^2`, `dompurify@^3`, `bleach@^6` (add to `frontend/package.json` / `backend/requirements.txt`).
- **Commit** after every green test.

---

## File Structure

**Backend**
- Modify `backend/scheduler.py` — `_smtp_send` (add `body_html`), `process_email_queue` (pass `body_html`).
- Create `backend/email_utils.py` — pure helpers: `sanitize_html`, `personalize`, `wrap_email_shell`, `plain_from_html`. One responsibility: HTML/text transforms, DB-free, unit-testable.
- Modify `backend/routes/email_routes.py` — `body_html` on template/campaign models + personalization in `launch_email_campaign`; new `POST /email/send-now`, `POST /email/send-test`; suppression check helper.
- Modify `backend/routes/training_routes.py` — retire `notify_session` inline SMTP (route through queue helper).
- Modify `backend/routes/customer_routes.py` — retire the inline blast at ~L664 (route through queue helper).
- Create `backend/email_templates_html.py` — the shared HTML shell + evergreen template bodies seeded into `email_templates.body_html`.

**Frontend**
- Create `frontend/src/components/email/RecipientPicker.js` — search + tag/role/city/board filters + checkbox list + select-all.
- Create `frontend/src/components/email/EmailComposerDialog.js` — the reusable composer.
- Modify `frontend/src/lib/api.js` — add `email.sendNow`, `email.sendTest` (templates/campaigns/contacts/tags likely already exist).
- Modify `frontend/src/pages/admin/CustomerEngagement.js` + `frontend/src/hooks/useCustomerEngagement.js` — open the composer from the 3 Send buttons.

---

## Task 1: `email_utils.py` — pure HTML/text helpers

**Files:**
- Create: `backend/email_utils.py`
- Test: `backend/tests/test_email_utils.py`

**Interfaces:**
- Produces:
  - `sanitize_html(html: str) -> str` — strips `<script>`, `on*=` handlers, `javascript:` URLs; keeps common formatting/layout tags + inline `style`.
  - `personalize(text: str, name: str = "", school_name: str = "") -> str` — replaces `{name}`/`{school_name}`; unknown braces untouched, never raises.
  - `plain_from_html(html: str) -> str` — crude tag-strip fallback for the plain part.
  - `wrap_email_shell(inner_html: str, *, unsubscribe_note: str = "") -> str` — wraps a body fragment in the 600px table shell. If `inner_html` already contains `<html`, returns it unchanged (a full pasted document).

- [ ] **Step 1: Add dependency**

Add `bleach>=6` to `backend/requirements.txt`. Install: `pip install "bleach>=6"`.

- [ ] **Step 2: Write the failing tests**

```python
# backend/tests/test_email_utils.py
from email_utils import sanitize_html, personalize, plain_from_html, wrap_email_shell

def test_sanitize_strips_script_and_handlers():
    dirty = '<p onclick="x()">Hi</p><script>alert(1)</script><a href="javascript:evil()">y</a>'
    clean = sanitize_html(dirty)
    assert "<script" not in clean.lower()
    assert "onclick" not in clean.lower()
    assert "javascript:" not in clean.lower()
    assert "Hi" in clean

def test_sanitize_keeps_formatting_and_inline_style():
    html = '<p style="color:#e94560"><strong>Bold</strong> <a href="https://x.com">link</a></p>'
    clean = sanitize_html(html)
    assert "<strong>" in clean
    assert 'href="https://x.com"' in clean
    assert "color:#e94560" in clean.replace(" ", "")

def test_personalize_replaces_known_tokens_only():
    out = personalize("Hi {name} at {school_name} — {unknown}", "Asha", "DPS")
    assert out == "Hi Asha at DPS — {unknown}"

def test_personalize_blank_name_is_safe():
    assert personalize("Dear {name},", "", "") == "Dear ,"

def test_plain_from_html_strips_tags():
    assert "Hello" in plain_from_html("<p>Hello <b>world</b></p>")
    assert "<" not in plain_from_html("<p>Hello</p>")

def test_wrap_shell_wraps_fragment_but_not_full_doc():
    wrapped = wrap_email_shell("<p>Body</p>")
    assert "max-width:600px" in wrapped.replace(" ", "")
    assert "<p>Body</p>" in wrapped
    full = "<html><body><p>x</p></body></html>"
    assert wrap_email_shell(full) == full
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/test_email_utils.py -v`
Expected: FAIL (`ModuleNotFoundError: email_utils`).

- [ ] **Step 4: Implement `email_utils.py`**

```python
# backend/email_utils.py
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
    cleaned = bleach.clean(
        html,
        tags=_ALLOWED_TAGS,
        attributes=_ALLOWED_ATTRS,
        protocols=_ALLOWED_PROTOCOLS,
        strip=True,
        strip_comments=True,
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_email_utils.py -v`
Expected: 6 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/email_utils.py backend/tests/test_email_utils.py backend/requirements.txt
git commit -m "feat(email): pure HTML sanitize/personalize/shell helpers"
```

---

## Task 2: HTML multipart in `_smtp_send`

**Files:**
- Modify: `backend/scheduler.py:58-66` (`_smtp_send`)
- Test: `backend/tests/test_smtp_html.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: `_smtp_send(sender_email, app_password, sender_name, to_email, subject, body, body_html=None)` — sends `multipart/alternative`; attaches HTML part + `List-Unsubscribe` header only when `body_html` is truthy.

- [ ] **Step 1: Write the failing test (mock SMTP, no DB, no network)**

```python
# backend/tests/test_smtp_html.py
import types
import scheduler

class _FakeSMTP:
    last = {}
    def __init__(self, *a, **k): pass
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def login(self, *a): pass
    def sendmail(self, frm, to, raw): _FakeSMTP.last = {"frm": frm, "to": to, "raw": raw}

def _patch(monkeypatch):
    monkeypatch.setattr(scheduler.smtplib, "SMTP_SSL", _FakeSMTP)

def test_plain_only_when_no_html(monkeypatch):
    _patch(monkeypatch)
    scheduler._smtp_send("s@x.com", "pw", "SmartShape", "to@x.com", "Subj", "Hello plain")
    raw = _FakeSMTP.last["raw"]
    assert "Hello plain" in raw
    assert "text/html" not in raw

def test_html_part_and_unsubscribe_when_html(monkeypatch):
    _patch(monkeypatch)
    scheduler._smtp_send("s@x.com", "pw", "SmartShape", "to@x.com", "Subj",
                         "Hello plain", body_html="<p>Hello <b>rich</b></p>")
    raw = _FakeSMTP.last["raw"]
    assert "text/html" in raw
    assert "Hello <b>rich</b>".replace(" ", "") in raw.replace("=\n", "").replace(" ", "") or "rich" in raw
    assert "List-Unsubscribe" in raw
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_smtp_html.py -v`
Expected: FAIL (`TypeError: _smtp_send() got an unexpected keyword argument 'body_html'`).

- [ ] **Step 3: Modify `_smtp_send`**

Replace `backend/scheduler.py:58-66` with:

```python
def _smtp_send(sender_email, app_password, sender_name, to_email, subject, body, body_html=None):
    msg = MIMEMultipart("alternative")
    msg["From"] = f"{sender_name} <{sender_email}>"
    msg["To"] = to_email
    msg["Subject"] = subject
    if body_html:
        msg["List-Unsubscribe"] = f"<mailto:{sender_email}?subject=unsubscribe>"
        msg["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
    msg.attach(MIMEText(body or "", "plain", "utf-8"))
    if body_html:
        msg.attach(MIMEText(body_html, "html", "utf-8"))
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=20) as smtp:
        smtp.login(sender_email, app_password)
        smtp.sendmail(sender_email, [to_email], msg.as_string())
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_smtp_html.py -v`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/scheduler.py backend/tests/test_smtp_html.py
git commit -m "feat(email): _smtp_send supports optional HTML + List-Unsubscribe"
```

---

## Task 3: Queue processor forwards `body_html`

**Files:**
- Modify: `backend/scheduler.py:186-194` (inside `process_email_queue`)
- Test: covered by Task 7 integration; add a unit assert here.

**Interfaces:**
- Consumes: `email_scheduled` docs may now carry `body_html`.
- Produces: queue delivers HTML when present.

- [ ] **Step 1: Modify the send call**

In `process_email_queue`, after `body_text = msg.get("message") or msg.get("body") or ""`, change the `_smtp_send` call to forward HTML:

```python
        body_html = msg.get("body_html")
        try:
            await asyncio.to_thread(
                _smtp_send, sender_email, app_password, sender_name,
                to_email,
                msg.get("subject", "Message from SmartShape"),
                body_text,
                body_html,
            )
```

- [ ] **Step 2: Sanity-run the existing scheduler import**

Run: `cd backend && python -c "import scheduler; print('ok')"`
Expected: `ok` (no syntax/import error).

- [ ] **Step 3: Commit**

```bash
git add backend/scheduler.py
git commit -m "feat(email): queue processor forwards body_html to SMTP"
```

---

## Task 4: Suppression check + `body_html` on templates/campaigns + personalize on launch

**Files:**
- Modify: `backend/routes/email_routes.py` (template create/update ~L459-495; campaign create ~L515-547; `launch_email_campaign` ~L577-642)
- Test: `backend/tests/test_email_html_api.py` (server-backed; requires `DB_NAME=smartshape_test`)

**Interfaces:**
- Produces:
  - `_is_suppressed(email: str) -> bool` — true if `db.email_suppressions` has this (lowercased) email.
  - Template & campaign docs accept/echo `body_html`.
  - `launch_email_campaign` writes `body_html` (personalized, sanitized) into each `email_scheduled` row and skips suppressed addresses.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_email_html_api.py
import os, requests
BASE = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
S = requests.Session(); S.headers.update({"Content-Type": "application/json"})
def _login():
    r = S.post(f"{BASE}/api/auth/login", json={"email":"info@smartshape.in","password":"admin123"})
    assert r.status_code == 200, r.text

def test_template_roundtrips_body_html():
    _login()
    r = S.post(f"{BASE}/api/email/templates", json={
        "name": f"HTMLTest {os.urandom(3).hex()}", "category": "intro",
        "subject": "Hi {name}", "body": "plain", "body_html": "<p>Hi {name}</p>"})
    assert r.status_code == 200, r.text
    tid = r.json()["template_id"]
    got = [t for t in S.get(f"{BASE}/api/email/templates").json() if t["template_id"] == tid][0]
    assert got.get("body_html") == "<p>Hi {name}</p>"
    S.delete(f"{BASE}/api/email/templates/{tid}")
```

- [ ] **Step 2: Run test to verify it fails**

Start a test server first (separate shell), then:
Run: `cd backend && REACT_APP_BACKEND_URL=$REACT_APP_BACKEND_URL python -m pytest tests/test_email_html_api.py::test_template_roundtrips_body_html -v`
Expected: FAIL (`body_html` is `None` — not persisted).

- [ ] **Step 3: Implement**

In `create_email_template` doc dict, add: `"body_html": body.get("body_html", ""),`
In `update_email_template`, add `"body_html"` to the updatable `for field in (...)` tuple.
In `create_email_campaign` doc dict, add: `"body_html": body.get("body_html", ""), "source": body.get("source", "manual"), "source_id": body.get("source_id", ""),`
In `update_email_campaign`, add `"body_html"` to its field tuple.

Add near the top of `email_routes.py` (after imports):

```python
from email_utils import sanitize_html, personalize

async def _is_suppressed(email_addr: str) -> bool:
    return bool(await db.email_suppressions.find_one({"email": (email_addr or "").strip().lower()}))
```

In `launch_email_campaign`, resolve the HTML source and personalize/sanitize per contact. After `message = ...` resolution and before the `for contact in contacts:` loop:

```python
    body_html_tmpl = (camp.get("body_html") or "").strip()
    if not body_html_tmpl and camp.get("template_id"):
        tmpl = await db.email_templates.find_one({"template_id": camp["template_id"]})
        if tmpl:
            body_html_tmpl = (tmpl.get("body_html") or "").strip()
    body_html_tmpl = sanitize_html(body_html_tmpl) if body_html_tmpl else ""
```

Inside the loop, after computing `first_name`/`school`, add suppression skip + HTML personalization:

```python
        if await _is_suppressed(email_addr):
            continue
        personalized_html = personalize(body_html_tmpl, first_name, school) if body_html_tmpl else None
```

and add `"body_html": personalized_html,` to the `email_scheduled.insert_one({...})` doc.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_email_html_api.py::test_template_roundtrips_body_html -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/email_routes.py backend/tests/test_email_html_api.py
git commit -m "feat(email): body_html on templates/campaigns + suppression skip on launch"
```

---

## Task 5: `POST /email/send-test`

**Files:**
- Modify: `backend/routes/email_routes.py` (add endpoint)
- Test: `backend/tests/test_email_html_api.py` (add case)

**Interfaces:**
- Produces: `POST /email/send-test` body `{subject, body_html, body_text?}` → sends ONE email immediately to the current user via `_smtp_send`, bypassing the queue. Returns `{sent: true, to: <email>}`.

- [ ] **Step 1: Write the failing test (mock the actual send via a monkeypatchable indirection)**

```python
def test_send_test_requires_auth_and_returns_recipient(monkeypatch=None):
    _login()
    r = S.post(f"{BASE}/api/email/send-test", json={"subject":"T","body_html":"<p>hi {name}</p>"})
    # In smartshape_test with email configured OR not: endpoint must respond 200 (sent) or 400 (email not configured)
    assert r.status_code in (200, 400), r.text
    if r.status_code == 200:
        assert r.json().get("to") == "info@smartshape.in"
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && python -m pytest tests/test_email_html_api.py::test_send_test_requires_auth_and_returns_recipient -v`
Expected: FAIL (404 — route missing).

- [ ] **Step 3: Implement the endpoint**

```python
@router.post("/email/send-test")
async def send_test_email(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    s = await db.settings.find_one({"type": "email"}, {"_id": 0})
    se = s.get("sender_email") if s else None
    ap = s.get("gmail_app_password") if s else None
    sn = s.get("sender_name", "SmartShape Pro") if s else "SmartShape Pro"
    if not se or not ap:
        raise HTTPException(400, "Email not configured")
    from email_utils import sanitize_html, personalize, plain_from_html, wrap_email_shell
    subject = personalize((body.get("subject") or "Test email").strip(), user.get("name",""), "")
    html = sanitize_html((body.get("body_html") or "").strip())
    html = wrap_email_shell(personalize(html, user.get("name",""), "Your School")) if html else ""
    text = personalize((body.get("body_text") or plain_from_html(html) or "Test").strip(), user.get("name",""), "")
    import asyncio
    from scheduler import _smtp_send
    await asyncio.to_thread(_smtp_send, se, ap, sn, user["email"], f"[TEST] {subject}", text, html or None)
    return {"sent": True, "to": user["email"]}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && python -m pytest tests/test_email_html_api.py::test_send_test_requires_auth_and_returns_recipient -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/email_routes.py backend/tests/test_email_html_api.py
git commit -m "feat(email): POST /email/send-test (immediate self-send)"
```

---

## Task 6: `POST /email/send-now`

**Files:**
- Modify: `backend/routes/email_routes.py` (add endpoint)
- Test: `backend/tests/test_email_html_api.py` (add case)

**Interfaces:**
- Consumes: `email_scheduled`, `email_campaigns`, `sanitize_html`, `personalize`, `wrap_email_shell`, `_is_suppressed`.
- Produces: `POST /email/send-now` body `{subject, body_html, body_text?, recipient_ids[], source, source_id?, template_id?}` → creates a `email_campaigns` doc (status `queued`, source-tagged) and enqueues one personalized `email_scheduled` row per non-suppressed recipient contact that has an email. Returns `{queued: int, campaign_id: str}`. Validates: ≥1 recipient, non-empty subject, non-empty body_html.

- [ ] **Step 1: Write the failing test**

```python
def test_send_now_queues_rows_for_selected_contacts():
    _login()
    # create a throwaway contact with an email
    c = S.post(f"{BASE}/api/contacts", json={"name":"QA Person","email":f"qa{os.urandom(3).hex()}@example.com","company":"QA School"})
    assert c.status_code in (200,201), c.text
    cid = c.json().get("contact_id") or c.json().get("id")
    r = S.post(f"{BASE}/api/email/send-now", json={
        "subject":"Hi {name}", "body_html":"<p>Hello {name} at {school_name}</p>",
        "recipient_ids":[cid], "source":"manual"})
    assert r.status_code == 200, r.text
    assert r.json()["queued"] == 1
    assert r.json()["campaign_id"].startswith("ecamp_")
    # verify a scheduled row carries body_html
    q = S.get(f"{BASE}/api/email/queue?type=campaign").json()
    assert any(row.get("body_html") and "Hello" in row["body_html"] for row in q)
    S.delete(f"{BASE}/api/contacts/{cid}")
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && python -m pytest tests/test_email_html_api.py::test_send_now_queues_rows_for_selected_contacts -v`
Expected: FAIL (404).

- [ ] **Step 3: Implement the endpoint**

```python
@router.post("/email/send-now")
async def send_now(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    from email_utils import sanitize_html, personalize, plain_from_html, wrap_email_shell
    subject = (body.get("subject") or "").strip()
    html_raw = (body.get("body_html") or "").strip()
    recipient_ids = body.get("recipient_ids") or []
    if not recipient_ids:
        raise HTTPException(400, "Select at least one recipient")
    if not subject:
        raise HTTPException(400, "Subject is required")
    if not html_raw:
        raise HTTPException(400, "Message body is required")
    html_tmpl = wrap_email_shell(sanitize_html(html_raw))
    text_tmpl = (body.get("body_text") or plain_from_html(html_raw) or "").strip()

    contacts = await db.contacts.find(
        {"contact_id": {"$in": recipient_ids}, "is_deleted": {"$ne": True}}, {"_id": 0}
    ).to_list(None)
    now = datetime.now(timezone.utc).isoformat()
    campaign_id = f"ecamp_{uuid.uuid4().hex[:10]}"
    await db.email_campaigns.insert_one({
        "campaign_id": campaign_id,
        "name": body.get("name") or subject[:60],
        "subject": subject, "body_html": html_tmpl, "message": text_tmpl,
        "template_id": body.get("template_id"),
        "source": body.get("source", "manual"), "source_id": body.get("source_id", ""),
        "audience_filter": {}, "audience_label": f"{len(contacts)} selected",
        "audience_count": len(contacts), "status": "queued",
        "sent_count": 0, "delivered_count": 0, "failed_count": 0,
        "created_by": user["email"], "created_by_name": user.get("name", user["email"]),
        "created_at": now, "updated_at": now, "sent_at": now,
    })
    queued = 0
    for contact in contacts:
        email_addr = (contact.get("email") or "").strip()
        if not email_addr or "@" not in email_addr:
            continue
        if await _is_suppressed(email_addr):
            continue
        first = (contact.get("first_name") or contact.get("name") or "").split(" ")[0] if (contact.get("first_name") or contact.get("name")) else ""
        school = contact.get("company") or "your school"
        await db.email_scheduled.insert_one({
            "scheduled_id": f"esched_{uuid.uuid4().hex[:10]}",
            "campaign_id": campaign_id, "contact_id": contact.get("contact_id", ""),
            "contact_name": first, "email": email_addr,
            "subject": personalize(subject, first, school),
            "message": personalize(text_tmpl, first, school),
            "body_html": personalize(html_tmpl, first, school),
            "status": "pending", "queued_at": now, "sent_at": None, "type": "campaign",
        })
        queued += 1
    await db.email_campaigns.update_one({"campaign_id": campaign_id},
        {"$set": {"audience_count": queued, "sent_count": 0}})
    return {"queued": queued, "campaign_id": campaign_id}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && python -m pytest tests/test_email_html_api.py::test_send_now_queues_rows_for_selected_contacts -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/email_routes.py backend/tests/test_email_html_api.py
git commit -m "feat(email): POST /email/send-now (campaign + HTML queue for selected contacts)"
```

---

## Task 7: Retire the two rogue blast paths onto the queue

**Files:**
- Modify: `backend/routes/training_routes.py:74-137` (`notify_session`)
- Modify: `backend/routes/customer_routes.py` (~L664 inline blast)
- Test: `backend/tests/test_email_html_api.py` (add case asserting `notify_session` now enqueues instead of sending inline)

**Interfaces:**
- Consumes: the campaign+queue path (reuse a small helper or call the same enqueue logic).
- Produces: `notify_session` and the customer_routes blast enqueue HTML rows into `email_scheduled` (type `campaign`) and return `{queued: int}` instead of `{sent: int}` sent synchronously.

- [ ] **Step 1: Write the failing test**

```python
def test_notify_session_enqueues_not_inline():
    _login()
    sess = S.post(f"{BASE}/api/training/sessions", json={"title":"QA Webinar","date":"2099-01-01","time":"10:00","platform":"zoom","meeting_link":"https://zoom.us/j/1","is_published":True}).json()
    sid = sess["session_id"]
    r = S.post(f"{BASE}/api/training/sessions/{sid}/notify")
    assert r.status_code == 200, r.text
    assert "queued" in r.json()
    S.delete(f"{BASE}/api/training/sessions/{sid}")
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && python -m pytest tests/test_email_html_api.py::test_notify_session_enqueues_not_inline -v`
Expected: FAIL (response has `sent`, not `queued`).

- [ ] **Step 3: Rewrite `notify_session`**

Replace the body of `notify_session` (after loading `session`) so it builds a webinar-invite HTML from the session and enqueues via the same mechanism as send-now, targeting the same quotation-customer audience it used before BUT through `email_scheduled` (no inline `smtplib`). Reuse `email_utils`. Return `{"queued": queued}`. Remove the inline `import smtplib` block entirely. (Customer_routes ~L664: apply the identical treatment — replace its inline `_smtp_send`/`MIMEText` loop with enqueue rows.)

Concretely, for `notify_session`, after the `if not session` check:

```python
    from email_utils import sanitize_html, personalize, plain_from_html, wrap_email_shell
    import os
    frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:3000")
    link_line = (f'<p><a href="{session.get("meeting_link","")}" style="background:#e94560;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block;">Join the Session</a></p>'
                 if session.get("meeting_link") else f'<p>Location: {session.get("location","")}</p>')
    inner = (f'<h2 style="color:#e94560;margin:0 0 8px;">{session["title"]}</h2>'
             f'<p><strong>Date:</strong> {session.get("date","")} &nbsp; <strong>Time:</strong> {session.get("time","")}</p>'
             f'<p>{session.get("description","")}</p>{link_line}'
             f'<p style="color:#666;font-size:13px;">Dear {{name}}, you are invited to this SmartShape training session.</p>')
    html_tmpl = wrap_email_shell(sanitize_html(inner))
    text_tmpl = plain_from_html(inner)

    now = _now()
    campaign_id = f"ecamp_{uuid.uuid4().hex[:10]}"
    await db.email_campaigns.insert_one({
        "campaign_id": campaign_id, "name": f"Session: {session['title']}"[:60],
        "subject": f"Training Session: {session['title']}", "body_html": html_tmpl, "message": text_tmpl,
        "source": "training_session", "source_id": session_id, "audience_filter": {},
        "audience_label": "Quotation customers", "audience_count": 0, "status": "queued",
        "sent_count": 0, "delivered_count": 0, "failed_count": 0,
        "created_by": user["email"], "created_at": now, "updated_at": now, "sent_at": now,
    })
    quotations = await db.quotations.find(
        {"customer_email": {"$exists": True, "$ne": ""}},
        {"_id": 0, "customer_email": 1, "principal_name": 1, "school_name": 1}).to_list(2000)
    seen, queued = set(), 0
    for q in quotations:
        email_addr = (q.get("customer_email") or "").strip().lower()
        if not email_addr or "@" not in email_addr or email_addr in seen:
            continue
        seen.add(email_addr)
        first = q.get("principal_name") or "Sir/Ma'am"
        school = q.get("school_name") or "your school"
        await db.email_scheduled.insert_one({
            "scheduled_id": f"esched_{uuid.uuid4().hex[:10]}", "campaign_id": campaign_id,
            "email": q["customer_email"].strip(), "contact_name": first,
            "subject": f"Training Session: {session['title']}",
            "message": personalize(text_tmpl, first, school),
            "body_html": personalize(html_tmpl, first, school),
            "status": "pending", "queued_at": now, "sent_at": None, "type": "campaign",
        })
        queued += 1
    await db.email_campaigns.update_one({"campaign_id": campaign_id}, {"$set": {"audience_count": queued}})
    return {"queued": queued}
```

(Ensure `user = await get_current_user(request)` remains at the top of the function.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && python -m pytest tests/test_email_html_api.py::test_notify_session_enqueues_not_inline -v`
Expected: PASS. Also run the whole file: `python -m pytest tests/test_email_html_api.py tests/test_email_utils.py tests/test_smtp_html.py -v`.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/training_routes.py backend/routes/customer_routes.py backend/tests/test_email_html_api.py
git commit -m "refactor(email): route Training/Customer blasts through the HTML queue (no inline SMTP)"
```

---

## Task 8: Frontend deps + api wiring

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/src/lib/api.js`

**Interfaces:**
- Produces: `email.sendNow(payload)`, `email.sendTest(payload)` axios helpers. Confirm `email.getTemplates`, `email.createTemplate`, `contacts.getAll`, `tags.getAll`, `contactRoles.getAll` already exist (used by MarketingHub) — reuse them.

- [ ] **Step 1: Add deps**

Run: `cd frontend && npm install react-quill@^2 dompurify@^3`

- [ ] **Step 2: Add api helpers**

In `frontend/src/lib/api.js`, locate the exported `email` object (used as `email as emailApi` in `EmailHubTab.js`) and add:

```javascript
  sendNow:  (payload) => API.post('/email/send-now', payload),
  sendTest: (payload) => API.post('/email/send-test', payload),
```

If a distinct `email` export is not present, add one mirroring the existing module pattern in the file.

- [ ] **Step 3: Verify build compiles**

Run: `cd frontend && DISABLE_ESLINT_PLUGIN=true npm run build 2>&1 | tail -20`
Expected: `Compiled` (build succeeds). *(Per repo note, verify with `DISABLE_ESLINT_PLUGIN=true` due to a pre-existing react-hooks lint rule.)*

- [ ] **Step 4: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/lib/api.js
git commit -m "feat(email): add react-quill/dompurify + sendNow/sendTest api helpers"
```

---

## Task 9: `RecipientPicker` component

**Files:**
- Create: `frontend/src/components/email/RecipientPicker.js`

**Interfaces:**
- Consumes: `contacts` (array with `contact_id, name, email, tag_ids[], designation, city, board, company`), `allTags`, `roles`.
- Produces: `<RecipientPicker contacts allTags roles selectedIds onChange />` — controlled; `onChange(idsArray)`. Search box, filter chips (tag/role/city/board), checkbox list (only contacts WITH an email), "Select all N matching" toggle, live selected-count. Mirrors the existing `eFilteredContactsForPicker` logic in `EmailHubTab.js` (reuse that filtering approach; do not invent a new one).

- [ ] **Step 1: Implement the component**

Build a controlled component: internal state for `search`, `tagFilter`, `roleFilter`, `cityFilter`, `boardFilter`. Compute `filtered = contacts.filter(has email && matches all active filters && matches search)`. Render: filter row (a search `<input>` + `<select>`s for tag/role/city/board derived from `allTags`, `roles`, and distinct `contacts` city/board values), a "Select all N" button that calls `onChange([...new Set([...selectedIds, ...filtered.map(c=>c.contact_id)])])`, a "Clear" button, a scrollable checkbox list, and a footer `"{selectedIds.length} selected"`. Style with the existing Tailwind token classes used in `CustomerEngagement.js` (`var(--bg-card)`, `#e94560`).

- [ ] **Step 2: Verify build compiles**

Run: `cd frontend && DISABLE_ESLINT_PLUGIN=true npm run build 2>&1 | tail -5`
Expected: Compiled.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/email/RecipientPicker.js
git commit -m "feat(email): reusable RecipientPicker (search + filters + select-all)"
```

---

## Task 10: `EmailComposerDialog` component

**Files:**
- Create: `frontend/src/components/email/EmailComposerDialog.js`

**Interfaces:**
- Consumes: `email.getTemplates/createTemplate/sendNow/sendTest`, `contacts.getAll`, `tags.getAll`, `contactRoles.getAll`, `<RecipientPicker>`, `dompurify`, `react-quill`.
- Produces: `<EmailComposerDialog open onClose source sourceId initialSubject initialHtml />`.

- [ ] **Step 1: Implement the dialog**

Sections, top to bottom, inside the existing `<Dialog>`/`<DialogContent>` primitives:
1. **Subject** input (prefilled from `initialSubject`).
2. **Content mode toggle** `[Rich text | Paste HTML]`. Rich text → `<ReactQuill value={html} onChange={setHtml} />`. Paste HTML → `<textarea value={html} onChange>`. Both bind the same `html` state. An "Insert field" `<select>` inserts `{name}`/`{school_name}` into the subject/body.
3. **Template row:** "Load template" `<select>` (from `email.getTemplates`, options where `body_html` exists → set subject+html); "Save as template" button (prompts name → `email.createTemplate({name, subject, body_html: html, category:'custom'})`).
4. **Recipients:** `<RecipientPicker contacts allTags roles selectedIds={recipientIds} onChange={setRecipientIds} />` (load `contacts/tags/roles` on open).
5. **Guardrails:** "Preview" toggle → renders `dangerouslySetInnerHTML={{__html: DOMPurify.sanitize(html)}}` inside a bordered box (or `<iframe sandbox>` for isolation); "Send test to me" → `email.sendTest({subject, body_html: html})` + toast; footer "Send" button.
6. **Send flow:** clicking Send opens a confirm ("Send to {recipientIds.length} recipients?"). On confirm → `email.sendNow({subject, body_html: html, recipient_ids: recipientIds, source, source_id: sourceId})` → toast `Queued {queued}` → `onClose()`. Block send if `recipientIds.length===0` or `!subject` or `!html`.

- [ ] **Step 2: Verify build compiles**

Run: `cd frontend && DISABLE_ESLINT_PLUGIN=true npm run build 2>&1 | tail -5`
Expected: Compiled.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/email/EmailComposerDialog.js
git commit -m "feat(email): reusable EmailComposerDialog (rich-text/paste-HTML + template + preview/test/confirm)"
```

---

## Task 11: Wire the three Send buttons

**Files:**
- Modify: `frontend/src/pages/admin/CustomerEngagement.js`
- Modify: `frontend/src/hooks/useCustomerEngagement.js`

**Interfaces:**
- Consumes: `<EmailComposerDialog>`.
- Produces: Clicking Send on a Session/Offer/Announcement opens the composer prefilled; the old `notifySession`/`notifyPromo`/`notifyAnn` immediate calls are replaced by opening the dialog.

- [ ] **Step 1: Add composer state to the hook**

In `useCustomerEngagement.js`, add:
```javascript
const [composer, setComposer] = useState({ open: false, source: '', sourceId: '', subject: '', html: '' });
const openComposerForSession = (s) => setComposer({ open: true, source: 'training_session', sourceId: s.session_id,
  subject: `Training Session: ${s.title}`,
  html: `<h2 style="color:#e94560">${s.title}</h2><p><strong>Date:</strong> ${s.date} ${s.time||''}</p><p>${s.description||''}</p>` +
        (s.meeting_link ? `<p><a href="${s.meeting_link}">Join the session</a></p>` : '') +
        `<p>Dear {name}, you're invited to this SmartShape training session.</p>` });
```
Add analogous `openComposerForPromo(p)` and `openComposerForAnn(a)`. Return `composer, setComposer, openComposerForSession, openComposerForPromo, openComposerForAnn`.

- [ ] **Step 2: Swap the button handlers + mount the dialog**

In `CustomerEngagement.js`, change the session Send button `onClick={() => hook.notifySession(s.session_id)}` → `onClick={() => hook.openComposerForSession(s)}`; promo Notify → `openComposerForPromo(p)`; announcement Notify All → `openComposerForAnn(a)`. Mount once near the root:
```jsx
<EmailComposerDialog open={hook.composer.open} onClose={() => hook.setComposer(c => ({ ...c, open: false }))}
  source={hook.composer.source} sourceId={hook.composer.sourceId}
  initialSubject={hook.composer.subject} initialHtml={hook.composer.html} />
```
Import `EmailComposerDialog`. Leave `notifySession` etc. in the hook (unused) or delete — either is fine; prefer deleting the now-dead functions.

- [ ] **Step 3: Verify build compiles**

Run: `cd frontend && DISABLE_ESLINT_PLUGIN=true npm run build 2>&1 | tail -5`
Expected: Compiled.

- [ ] **Step 4: Manual smoke (test DB / local)**

Start local frontend against a test backend, open `/customer-engagement`, click Send on a session → composer opens prefilled → pick a recipient → Preview → Send → toast shows `Queued N`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/admin/CustomerEngagement.js frontend/src/hooks/useCustomerEngagement.js
git commit -m "feat(email): open EmailComposerDialog from Training/Offer/Announcement Send buttons"
```

---

## Task 12: Seed evergreen HTML templates

**Files:**
- Create: `backend/email_templates_html.py`
- Modify: `backend/routes/email_routes.py` (`_seed_templates` sets `body_html` for matching system templates)

**Interfaces:**
- Consumes: `wrap_email_shell` (from `email_utils`).
- Produces: `HTML_BODIES: dict[str, str]` keyed by template `name`; `_seed_templates` writes `body_html` for any system template whose name is a key. Non-webinar evergreens only (webinar templates ship in the Next plan).

- [ ] **Step 1: Author the HTML bodies**

In `backend/email_templates_html.py`, export `HTML_BODIES` mapping the existing system template names (e.g. `"Principal Introduction Email"`, `"Demo Invitation Email"`, `"ROI Savings Calculator Email"`, `"New Academic Year Email"`) to email-safe HTML fragments (hero + body + a bulletproof CTA button using a table cell with `bgcolor="#e94560"`), keeping `{name}`/`{school_name}` tokens. Also add the three refreshed evergreens from spec A.4 (New Die Collection, Seasonal Offer, Re-engagement) as new system templates.

- [ ] **Step 2: Wire into `_seed_templates`**

In `_seed_templates`, after upserting each system template, set its `body_html` from `HTML_BODIES.get(tmpl["name"], "")` (both in the update `$set` and the insert doc).

- [ ] **Step 3: Verify seed runs**

Run: `cd backend && python -c "import routes.email_routes as e; import email_templates_html as h; print(len(h.HTML_BODIES))"`
Expected: prints a positive integer, no import error.

- [ ] **Step 4: Commit**

```bash
git add backend/email_templates_html.py backend/routes/email_routes.py
git commit -m "feat(email): seed evergreen templates with email-safe HTML bodies"
```

---

## Self-Review Notes (author)

- **Spec coverage:** HTML multipart (T2/T3), sanitize (T1), body_html on templates/campaigns + personalize (T4), List-Unsubscribe + suppression (T2/T4/T6), send-now/send-test (T5/T6), retire both rogue paths (T7), composer w/ rich-text+paste-HTML+template+preview+test+confirm (T10), recipient multi-select + filters + select-all (T9), wire 3 buttons (T11), evergreen HTML templates (T12). **Webinar lifecycle (spec §5) is intentionally the *Next* plan — not covered here.**
- **Test-DB safety:** logic tasks (T1/T2) are DB-free with mocked SMTP; endpoint tasks require `DB_NAME=smartshape_test`.
- **Type consistency:** `send-now` payload keys (`subject, body_html, recipient_ids, source, source_id`) match the composer (T10) and api helper (T8). `_is_suppressed`, `sanitize_html`, `personalize`, `wrap_email_shell` names are consistent across T1/T4/T5/T6/T7.
