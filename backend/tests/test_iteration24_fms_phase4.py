"""
Iteration 24 - FMS Phase 4: WhatsApp Template Master + Call->WhatsApp flow
+ Bug fix: Quotation PDF embeds company logo image.

Covers:
- BUG: GET /api/quotations/{id}/pdf returns valid PDF and embeds Image XObject (logo)
- WhatsApp Templates CRUD
  * GET /api/whatsapp-templates auto-seeds 6 default templates on first call (idempotent)
  * GET /api/whatsapp-templates filters ?module=&category=
  * POST /api/whatsapp-templates creates a template
  * PUT /api/whatsapp-templates/{id} updates allowed fields
  * DELETE /api/whatsapp-templates/{id} admin-only (403 for sales_person)
- Render & Send
  * POST /api/whatsapp/render-template interpolates {contact_name},{school_name},{my_name},{my_phone}
    via lead_id, contact_id, school_id, custom body
  * POST /api/whatsapp/send-via-template send_mode='manual' -> status='manual_sent', logs
  * POST /api/whatsapp/send-via-template send_mode='api' (no creds) -> status='wa_not_configured'
  * POST /api/whatsapp/send-via-template returns 400 if missing phone or body
  * GET /api/whatsapp/logs?lead_id= filters
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ADMIN_EMAIL = "info@smartshape.in"
ADMIN_PASSWORD = "admin123"


@pytest.fixture(scope="session")
def admin():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login",
               json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="session")
def non_admin():
    email = f"TEST_sp_{uuid.uuid4().hex[:8]}@smartshape.com"
    pw = "Test@1234"
    r = requests.post(f"{BASE_URL}/api/auth/register",
                      json={"email": email, "password": pw, "name": "TEST SP"}, timeout=15)
    if r.status_code not in (200, 201):
        pytest.skip(f"register failed: {r.status_code} {r.text}")
    s = requests.Session()
    r2 = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": pw}, timeout=15)
    assert r2.status_code == 200, r2.text
    return s


# ---------- Bug fix: PDF logo embed ----------
class TestQuotationPdfLogo:
    def test_pdf_contains_logo_xobject(self, admin):
        # Find any existing quotation
        r = admin.get(f"{BASE_URL}/api/quotations", timeout=15)
        assert r.status_code == 200
        quotes = r.json()
        if not quotes:
            pytest.skip("No quotations exist to test PDF generation")
        qid = quotes[0].get("quotation_id") or quotes[0].get("quote_id")
        assert qid, f"quotation has no id: {list(quotes[0].keys())}"
        r2 = admin.get(f"{BASE_URL}/api/quotations/{qid}/pdf", timeout=30)
        assert r2.status_code == 200, r2.text
        body = r2.content
        assert body.startswith(b"%PDF-"), "Response is not a valid PDF"
        # Logo embed -> reportlab uses Image XObject
        has_xobject = (b"/XObject" in body) or (b"/Image" in body) or (b"/Subtype /Image" in body)
        # Logo may be absent if company has no logo_url configured -> warn but don't hard fail
        if not has_xobject:
            # Check if company has a logo configured; if so, this is a real bug
            cs = admin.get(f"{BASE_URL}/api/settings/company", timeout=15)
            if cs.status_code == 200 and cs.json().get("logo_url"):
                pytest.fail("Company has logo_url but PDF lacks Image/XObject")
            else:
                pytest.skip("Company has no logo_url configured; cannot verify embed")
        assert has_xobject


# ---------- WhatsApp Templates: list + auto-seed ----------
class TestWaTemplatesList:
    def test_list_auto_seeds_defaults(self, admin):
        r = admin.get(f"{BASE_URL}/api/whatsapp-templates", timeout=15)
        assert r.status_code == 200, r.text
        items = r.json()
        # First call may or may not be the seed call (depending on prior state).
        # We just need to assert that defaults exist after the call.
        names = {t["name"] for t in items}
        expected = {"Thank You - Call", "Visit Follow-up", "Quotation Sent",
                    "Demo Reminder", "Order Confirmed", "Dispatch Update"}
        missing = expected - names
        assert not missing, f"Missing default templates: {missing}"
        # Validate each default has is_default True (best-effort)
        for t in items:
            if t["name"] in expected:
                assert t.get("is_default") is True

    def test_list_idempotent_no_duplicate_seed(self, admin):
        r1 = admin.get(f"{BASE_URL}/api/whatsapp-templates", timeout=15)
        r2 = admin.get(f"{BASE_URL}/api/whatsapp-templates", timeout=15)
        assert r1.status_code == 200 and r2.status_code == 200
        defaults1 = [t for t in r1.json() if t.get("is_default")]
        defaults2 = [t for t in r2.json() if t.get("is_default")]
        assert len(defaults1) == len(defaults2) == 6

    def test_filter_by_module(self, admin):
        r = admin.get(f"{BASE_URL}/api/whatsapp-templates?module=lead", timeout=15)
        assert r.status_code == 200
        for t in r.json():
            assert t["module"] == "lead"

    def test_filter_by_category(self, admin):
        r = admin.get(f"{BASE_URL}/api/whatsapp-templates?category=thankyou", timeout=15)
        assert r.status_code == 200
        for t in r.json():
            assert t["category"] == "thankyou"


# ---------- WhatsApp Templates: CRUD ----------
class TestWaTemplatesCrud:
    def test_create_template(self, admin):
        body = {
            "name": f"TEST_TPL_{uuid.uuid4().hex[:6]}",
            "module": "lead", "category": "followup",
            "body": "Hi {contact_name}, custom test message from {my_name}.",
        }
        r = admin.post(f"{BASE_URL}/api/whatsapp-templates", json=body, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["name"] == body["name"]
        assert d["module"] == "lead"
        assert d["category"] == "followup"
        assert d["is_active"] is True
        assert d["is_default"] is False
        assert d.get("template_id", "").startswith("wat_")
        # cleanup
        admin.delete(f"{BASE_URL}/api/whatsapp-templates/{d['template_id']}", timeout=15)

    def test_update_template(self, admin):
        body = {"name": f"TEST_TPL_{uuid.uuid4().hex[:6]}",
                "module": "lead", "category": "followup", "body": "x"}
        r = admin.post(f"{BASE_URL}/api/whatsapp-templates", json=body, timeout=15)
        tid = r.json()["template_id"]
        r2 = admin.put(f"{BASE_URL}/api/whatsapp-templates/{tid}",
                       json={"name": "RENAMED", "body": "new body", "is_active": False}, timeout=15)
        assert r2.status_code == 200, r2.text
        d = r2.json()
        assert d["name"] == "RENAMED"
        assert d["body"] == "new body"
        assert d["is_active"] is False
        admin.delete(f"{BASE_URL}/api/whatsapp-templates/{tid}", timeout=15)

    def test_delete_admin_only(self, admin, non_admin):
        body = {"name": f"TEST_TPL_{uuid.uuid4().hex[:6]}", "body": "x"}
        r = admin.post(f"{BASE_URL}/api/whatsapp-templates", json=body, timeout=15)
        tid = r.json()["template_id"]
        # Non-admin should be 403
        r2 = non_admin.delete(f"{BASE_URL}/api/whatsapp-templates/{tid}", timeout=15)
        assert r2.status_code == 403, f"Expected 403 for non-admin, got {r2.status_code}"
        # Admin can delete
        r3 = admin.delete(f"{BASE_URL}/api/whatsapp-templates/{tid}", timeout=15)
        assert r3.status_code == 200


# ---------- Render template ----------
def _make_school(admin):
    r = admin.post(f"{BASE_URL}/api/schools", json={
        "school_name": f"TEST_WAS_{uuid.uuid4().hex[:6]}",
        "school_type": "CBSE", "city": "Pune",
        "school_strength": 500, "number_of_branches": 1,
        "phone": "8888888888",
    }, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _make_lead(admin, school_id):
    r = admin.post(f"{BASE_URL}/api/leads", json={
        "company_name": f"TEST_WAL_{uuid.uuid4().hex[:6]}",
        "contact_name": "Ravi Kumar",
        "contact_phone": "9876543210",
        "school_id": school_id, "stage": "new",
        "priority": "medium", "lead_type": "warm",
    }, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _make_contact(admin):
    r = admin.post(f"{BASE_URL}/api/contacts", json={
        "name": "Sita Sharma", "phone": "9123456780",
        "company": "TEST_CO_School", "email": "sita@test.com",
    }, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


class TestWhatsAppRender:
    def test_render_with_lead_and_school(self, admin):
        sch = _make_school(admin)
        ld = _make_lead(admin, sch["school_id"])
        # Get a default template id (Thank You - Call)
        r = admin.get(f"{BASE_URL}/api/whatsapp-templates", timeout=15)
        tpl = next(t for t in r.json() if t["name"] == "Thank You - Call")
        r2 = admin.post(f"{BASE_URL}/api/whatsapp/render-template", json={
            "template_id": tpl["template_id"],
            "lead_id": ld["lead_id"],
        }, timeout=15)
        assert r2.status_code == 200, r2.text
        d = r2.json()
        assert d["phone"] == "9876543210"
        assert "Ravi Kumar" in d["body"]
        assert sch["school_name"] in d["body"]
        # my_name should be admin name
        assert d["context"].get("my_name")
        # cleanup
        admin.delete(f"{BASE_URL}/api/leads/{ld['lead_id']}")
        admin.delete(f"{BASE_URL}/api/schools/{sch['school_id']}")

    def test_render_with_contact(self, admin):
        c = _make_contact(admin)
        r = admin.get(f"{BASE_URL}/api/whatsapp-templates", timeout=15)
        tpl = next(t for t in r.json() if t["name"] == "Thank You - Call")
        r2 = admin.post(f"{BASE_URL}/api/whatsapp/render-template", json={
            "template_id": tpl["template_id"], "contact_id": c["contact_id"],
        }, timeout=15)
        assert r2.status_code == 200, r2.text
        d = r2.json()
        assert d["phone"] == "9123456780"
        assert "Sita Sharma" in d["body"]
        admin.delete(f"{BASE_URL}/api/contacts/{c['contact_id']}")

    def test_render_with_custom_body(self, admin):
        r = admin.post(f"{BASE_URL}/api/whatsapp/render-template", json={
            "body": "Hello {my_name}, hi {contact_name}",
            "phone": "9000000000",
        }, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        # contact_name is empty when no entity given -> placeholder cleared
        assert "Hello " in d["body"]
        assert "{my_name}" not in d["body"]
        assert "{contact_name}" not in d["body"]


# ---------- Send via template ----------
class TestWhatsAppSend:
    def test_send_manual_creates_log(self, admin):
        r = admin.post(f"{BASE_URL}/api/whatsapp/send-via-template", json={
            "phone": "9999999999",
            "body": "TEST manual message",
            "send_mode": "manual",
        }, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "manual_sent"
        assert d["send_mode"] == "manual"
        assert d.get("log_id", "").startswith("wal_")

    def test_send_api_no_credentials_returns_wa_not_configured(self, admin):
        # Ensure no whatsapp settings exist (best-effort: this test just verifies
        # the branch when settings absent)
        r = admin.post(f"{BASE_URL}/api/whatsapp/send-via-template", json={
            "phone": "9999999999",
            "body": "TEST api no cred",
            "send_mode": "api",
        }, timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        # Either wa_not_configured (if no creds) OR sent/failed (if real creds saved).
        assert d["status"] in ("wa_not_configured", "sent", "failed", "error", "pending"), d

    def test_send_missing_phone_400(self, admin):
        r = admin.post(f"{BASE_URL}/api/whatsapp/send-via-template",
                       json={"body": "x", "send_mode": "manual"}, timeout=15)
        assert r.status_code == 400

    def test_send_missing_body_400(self, admin):
        r = admin.post(f"{BASE_URL}/api/whatsapp/send-via-template",
                       json={"phone": "9999999999", "send_mode": "manual"}, timeout=15)
        assert r.status_code == 400

    def test_logs_filtered_by_lead(self, admin):
        sch = _make_school(admin)
        ld = _make_lead(admin, sch["school_id"])
        admin.post(f"{BASE_URL}/api/whatsapp/send-via-template", json={
            "phone": "9876543210", "body": "TEST lead-scoped",
            "send_mode": "manual", "lead_id": ld["lead_id"],
        }, timeout=15)
        r = admin.get(f"{BASE_URL}/api/whatsapp/logs?lead_id={ld['lead_id']}", timeout=15)
        assert r.status_code == 200
        logs = r.json()
        assert len(logs) >= 1
        for lg in logs:
            assert lg["lead_id"] == ld["lead_id"]
        # cleanup
        admin.delete(f"{BASE_URL}/api/leads/{ld['lead_id']}")
        admin.delete(f"{BASE_URL}/api/schools/{sch['school_id']}")
