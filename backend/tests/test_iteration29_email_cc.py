"""Iteration 29 - Email CC + auto-enable + credential-based gate.

Verifies:
1. POST /api/settings/email auto-sets enabled=True when sender_email and
   gmail_app_password are present (no manual toggle needed).
2. POST /api/quotations/{id}/send-catalogue-email returns email_sent=true for
   admin AND a freshly-registered non-admin sales user (no "Email not configured").
3. POST /api/email/send returns a `cc` field, auto-CC's the logged-in user when
   they are not the sender or the recipient, and does NOT self-CC admin when
   admin IS the sender.
4. send_catalogue_email gate is credential-based: temporarily clearing
   sender_email returns email_sent=false with the credential error message.
5. /api/auth/register auto-assigns ['sales_portal'] to new sales_person users
   (so direct login goes to /sales without admin intervention).

NOTE: Tests run against the deployed REACT_APP_BACKEND_URL, so smtplib cannot
be mocked. Real Gmail SMTP is used; we only assert response fields. Test
credentials are kept as `info@smartshape.in / admin123` (DO NOT modify the
settings row outside of test 4 which restores it).
"""
import os
import uuid
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://field-sales-app-16.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "info@smartshape.in"
ADMIN_PASSWORD = "admin123"


def _login(s, email, password):
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text[:200]}"
    return r.json()


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    _login(s, ADMIN_EMAIL, ADMIN_PASSWORD)
    return s


@pytest.fixture(scope="module")
def original_email_settings(admin_session):
    """Snapshot the live email settings row so we can restore after destructive tests."""
    r = admin_session.get(f"{API}/settings/email", timeout=20)
    assert r.status_code == 200
    snap = r.json()
    yield snap
    # Restore
    payload = {
        "type": "email",
        "sender_name": snap.get("sender_name", "SmartShape Pro"),
        "sender_email": snap.get("sender_email", ""),
        "gmail_app_password": snap.get("gmail_app_password", ""),
    }
    admin_session.post(f"{API}/settings/email", json=payload, timeout=20)


@pytest.fixture(scope="module")
def sales_user_session(admin_session):
    """Register a fresh non-admin user (auto-gets sales_portal via fixed register endpoint)."""
    email = f"test_email_cc_{uuid.uuid4().hex[:8]}@example.com"
    password = "Sales@123456"
    s = requests.Session()
    r = s.post(f"{API}/auth/register", json={"email": email, "password": password, "name": "Email CC Test"}, timeout=20)
    assert r.status_code == 200, f"register: {r.status_code} {r.text[:200]}"
    user = r.json()
    return {"session": s, "email": email, "user": user}


@pytest.fixture(scope="module")
def existing_quotation_id(admin_session):
    r = admin_session.get(f"{API}/quotations", timeout=30)
    assert r.status_code == 200
    quots = r.json()
    if not quots:
        pytest.skip("no quotations seeded — cannot test catalogue email")
    return quots[0]["quotation_id"]


# -------- Test 1: auto-enable on save --------

def test_save_email_settings_auto_enables(admin_session, original_email_settings):
    """When sender_email + gmail_app_password are present, enabled must be auto-set to True."""
    payload = {
        "type": "email",
        "sender_name": original_email_settings.get("sender_name", "SmartShape Pro"),
        "sender_email": original_email_settings.get("sender_email"),
        "gmail_app_password": original_email_settings.get("gmail_app_password"),
        # Notice: NO 'enabled' field in payload
    }
    assert payload["sender_email"], "fixture missing sender_email — admin must have configured Gmail"
    r = admin_session.post(f"{API}/settings/email", json=payload, timeout=20)
    assert r.status_code == 200, r.text
    # Verify
    g = admin_session.get(f"{API}/settings/email", timeout=20)
    assert g.status_code == 200
    data = g.json()
    assert data.get("enabled") is True, f"enabled not auto-set: {data}"
    assert data.get("sender_email") == payload["sender_email"]


# -------- Test 2: send-catalogue-email works for admin and non-admin sales user --------

def test_send_catalogue_email_admin(admin_session, existing_quotation_id):
    r = admin_session.post(f"{API}/quotations/{existing_quotation_id}/send-catalogue-email", timeout=60)
    assert r.status_code == 200, r.text
    data = r.json()
    # Most important: not the old "Email not configured" path
    assert data.get("email_sent") is True, f"email_sent false: {data}"
    err = data.get("email_error") or ""
    assert "not configured" not in err.lower(), f"unexpected 'not configured' error: {err}"
    assert "catalogue_url" in data and data["catalogue_url"]


def test_send_catalogue_email_non_admin_sales(sales_user_session, existing_quotation_id, admin_session):
    # The sales_user may not own the quotation; quotations endpoint scopes for non-admins.
    # The /send-catalogue-email endpoint only does get_current_user (no ownership filter),
    # so any logged-in user can trigger send for any existing quotation.
    s = sales_user_session["session"]
    r = s.post(f"{API}/quotations/{existing_quotation_id}/send-catalogue-email", timeout=60)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("email_sent") is True, f"email_sent false for sales user: {data}"
    err = data.get("email_error") or ""
    assert "not configured" not in err.lower(), f"sales user got 'not configured': {err}"


# -------- Test 3: /api/email/send CC behavior --------

def test_email_send_admin_no_self_cc(admin_session):
    """When admin IS the sender, admin's email must NOT appear in the CC list."""
    payload = {"to": "throwaway_cc_target@example.com", "subject": "TEST_CC_admin", "body": "<p>cc test</p>"}
    r = admin_session.post(f"{API}/email/send", json=payload, timeout=60)
    assert r.status_code == 200, r.text
    data = r.json()
    cc = data.get("cc")
    assert isinstance(cc, list), f"cc field missing/invalid: {data}"
    # admin (logged-in user) is also the sender → must NOT be in cc
    assert ADMIN_EMAIL.lower() not in [e.lower() for e in cc], f"admin self-CC'd unexpectedly: {cc}"


def test_email_send_non_admin_auto_cc_self(sales_user_session):
    """Non-admin sender → their own email must appear in CC (since they aren't the gmail sender)."""
    s = sales_user_session["session"]
    user_email = sales_user_session["email"]
    payload = {"to": "throwaway_cc_target2@example.com", "subject": "TEST_CC_user", "body": "<p>cc test</p>"}
    r = s.post(f"{API}/email/send", json=payload, timeout=60)
    assert r.status_code == 200, r.text
    data = r.json()
    cc = data.get("cc")
    assert isinstance(cc, list), f"cc field missing: {data}"
    assert user_email.lower() in [e.lower() for e in cc], f"logged-in user not auto-CC'd: cc={cc}"


def test_email_send_does_not_cc_recipient(admin_session):
    """If logged-in user happens to be the recipient, they shouldn't be CC'd."""
    payload = {"to": ADMIN_EMAIL, "subject": "TEST_CC_self", "body": "<p>self</p>"}
    r = admin_session.post(f"{API}/email/send", json=payload, timeout=60)
    assert r.status_code == 200, r.text
    cc = r.json().get("cc", [])
    assert ADMIN_EMAIL.lower() not in [e.lower() for e in cc]


# -------- Test 4: credential-based gate (NOT the old enabled flag) --------

def test_send_catalogue_email_credential_gate(admin_session, original_email_settings, existing_quotation_id):
    """Temporarily clear sender_email — endpoint must respond email_sent=false with credential error."""
    cleared = {"type": "email", "sender_name": "SmartShape Pro", "sender_email": "", "gmail_app_password": ""}
    r = admin_session.post(f"{API}/settings/email", json=cleared, timeout=20)
    assert r.status_code == 200
    try:
        r2 = admin_session.post(f"{API}/quotations/{existing_quotation_id}/send-catalogue-email", timeout=30)
        assert r2.status_code == 200, r2.text
        data = r2.json()
        assert data.get("email_sent") is False, f"expected email_sent=false when creds missing, got {data}"
        err = (data.get("email_error") or "").lower()
        assert "credentials" in err or "not configured" in err, f"expected credential error: {err}"
    finally:
        # Restore via the fixture's teardown — but force-restore here too in case
        # the fixture ordering doesn't run before the next test.
        restore = {
            "type": "email",
            "sender_name": original_email_settings.get("sender_name", "SmartShape Pro"),
            "sender_email": original_email_settings.get("sender_email", ""),
            "gmail_app_password": original_email_settings.get("gmail_app_password", ""),
        }
        admin_session.post(f"{API}/settings/email", json=restore, timeout=20)


# -------- Test 5: register auto-assigns sales_portal --------

def test_register_assigns_sales_portal_module():
    email = f"test_register_{uuid.uuid4().hex[:8]}@example.com"
    s = requests.Session()
    r = s.post(f"{API}/auth/register", json={"email": email, "password": "Sales@123456", "name": "Reg Test"}, timeout=20)
    assert r.status_code == 200, r.text
    user = r.json()
    assert user.get("role") == "sales_person"
    modules = user.get("assigned_modules") or []
    # The fix per request: register now auto-assigns ['sales_portal']
    assert "sales_portal" in modules, f"sales_portal not auto-assigned on register: {modules}"
    # Also confirm /auth/me returns the same
    me = s.get(f"{API}/auth/me", timeout=20)
    assert me.status_code == 200
    assert "sales_portal" in (me.json().get("assigned_modules") or [])
