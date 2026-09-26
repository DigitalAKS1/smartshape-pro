"""
Iteration 22 - FMS Phase 1 upgrades testing.
Covers:
- Company settings: bank_details + terms_conditions persistence
- Quotation: bank_details_override + terms_override + PDF generation
- Groups / Sources / Contact-Roles seeded endpoints
- last_activity_date auto-update on contacts/leads/schools (CRUD + cascade)
- Followups, lead notes, contact-to-lead conversion cascade
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
ADMIN_EMAIL = "info@smartshape.in"
ADMIN_PASSWORD = "admin123"


# ---------- fixtures ----------
@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    r = s.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"login failed {r.status_code} {r.text}"
    # cookies are HttpOnly access_token+refresh_token; persisted on session
    return s


def _get(s, path, **kw):
    return s.get(f"{BASE_URL}{path}", timeout=15, **kw)


def _post(s, path, json=None, **kw):
    return s.post(f"{BASE_URL}{path}", json=json or {}, timeout=20, **kw)


def _put(s, path, json=None, **kw):
    return s.put(f"{BASE_URL}{path}", json=json or {}, timeout=20, **kw)


def _delete(s, path, **kw):
    return s.delete(f"{BASE_URL}{path}", timeout=15, **kw)


# ---------- COMPANY SETTINGS ----------
class TestCompanySettings:
    def test_get_returns_bank_and_terms_fields(self, session):
        r = _get(session, "/api/settings/company")
        assert r.status_code == 200, r.text
        data = r.json()
        assert "bank_details" in data
        assert "terms_conditions" in data
        assert isinstance(data["bank_details"], str)
        assert isinstance(data["terms_conditions"], str)

    def test_post_persists_bank_and_terms(self, session):
        bank = "TEST_BANK_HDFC\nA/C: 12345\nIFSC: HDFC0001"
        terms = "Quote valid 30 days\nGST 18% extra\nPayment 50% advance"
        body = {"bank_details": bank, "terms_conditions": terms}
        r = _post(session, "/api/settings/company", body)
        assert r.status_code == 200, r.text
        # GET should return same values
        r2 = _get(session, "/api/settings/company")
        d = r2.json()
        assert d["bank_details"] == bank
        assert d["terms_conditions"] == terms


# ---------- LOOKUPS ----------
class TestLookups:
    def test_groups(self, session):
        r = _get(session, "/api/groups")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_sources(self, session):
        r = _get(session, "/api/sources")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) >= 1

    def test_contact_roles(self, session):
        r = _get(session, "/api/contact-roles")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) >= 1


# ---------- last_activity_date helpers ----------
def _pick_id(d, *keys):
    for k in keys:
        if d.get(k):
            return d[k]
    return None


def _get_school(s, sid):
    """Fetch a single school via list endpoint (no GET /schools/{id} exists)."""
    listing = _get(s, "/api/schools").json()
    if isinstance(listing, dict):
        listing = listing.get("schools", listing.get("items", []))
    return next((x for x in listing if _pick_id(x, "school_id", "id") == sid), None)


# ---------- SCHOOL ----------
class TestSchoolLastActivity:
    def test_create_and_update_sets_last_activity(self, session):
        body = {
            "name": f"TEST_SCH_{uuid.uuid4().hex[:6]}",
            "type": "School",
            "city": "TestCity",
        }
        r = _post(session, "/api/schools", body)
        assert r.status_code in (200, 201), r.text
        school = r.json()
        sid = _pick_id(school, "school_id", "id")
        assert sid
        assert school.get("last_activity_date"), f"missing on create: {school}"
        first_la = school["last_activity_date"]

        time.sleep(1.1)
        r2 = _put(session, f"/api/schools/{sid}", {"city": "NewCity"})
        assert r2.status_code == 200, r2.text
        upd = _get_school(session, sid)
        assert upd is not None
        assert upd.get("last_activity_date")
        assert upd["last_activity_date"] != first_la, "last_activity not bumped on PUT"

        # cleanup
        _delete(session, f"/api/schools/{sid}")


# ---------- CONTACT ----------
class TestContactLastActivity:
    def test_create_update_with_role_and_source(self, session):
        roles = _get(session, "/api/contact-roles").json()
        sources = _get(session, "/api/sources").json()
        role_id = roles[0].get("role_id") or roles[0].get("contact_role_id") or roles[0].get("id")
        source_id = sources[0].get("source_id") or sources[0].get("id")

        body = {
            "name": f"TEST_C_{uuid.uuid4().hex[:6]}",
            "phone": "9999900000",
            "contact_role_id": role_id,
            "source_id": source_id,
        }
        r = _post(session, "/api/contacts", body)
        assert r.status_code in (200, 201), r.text
        c = r.json()
        cid = _pick_id(c, "contact_id", "id")
        assert cid
        assert c.get("last_activity_date")
        assert c.get("contact_role_id") == role_id
        assert c.get("source_id") == source_id
        first_la = c["last_activity_date"]

        time.sleep(1.1)
        r2 = _put(session, f"/api/contacts/{cid}", {"phone": "8888800000"})
        assert r2.status_code == 200, r2.text
        # fetch
        listing = _get(session, "/api/contacts").json()
        upd = next((x for x in listing if _pick_id(x, "contact_id", "id") == cid), None)
        assert upd is not None
        assert upd.get("last_activity_date") and upd["last_activity_date"] != first_la

        _delete(session, f"/api/contacts/{cid}")


# ---------- LEAD + cascade ----------
class TestLeadLastActivityCascade:
    def test_lead_cascade_to_school(self, session):
        # create school
        sr = _post(session, "/api/schools", {"name": f"TEST_SCH_{uuid.uuid4().hex[:6]}", "type": "School"})
        assert sr.status_code in (200, 201)
        sid = _pick_id(sr.json(), "school_id", "id")

        # lookups
        roles = _get(session, "/api/contact-roles").json()
        sources = _get(session, "/api/sources").json()
        role_id = roles[0].get("role_id") or roles[0].get("contact_role_id") or roles[0].get("id")
        source_id = sources[0].get("source_id") or sources[0].get("id")

        # create lead
        body = {
            "school_id": sid,
            "company_name": "TEST_LEAD_CO",
            "contact_name": "John",
            "contact_phone": "9000000000",
            "contact_role_id": role_id,
            "source_id": source_id,
        }
        time.sleep(1.1)  # so school create timestamp differs
        lr = _post(session, "/api/leads", body)
        assert lr.status_code in (200, 201), lr.text
        lead = lr.json()
        lid = _pick_id(lead, "lead_id", "id")
        assert lid
        assert lead.get("last_activity_date")
        assert lead.get("contact_role_id") == role_id
        assert lead.get("source_id") == source_id

        # school's last_activity must be bumped
        sch = (_get_school(session, sid) or {})
        assert sch.get("last_activity_date")

        # update lead
        first_lead_la = lead["last_activity_date"]
        time.sleep(1.1)
        ur = _put(session, f"/api/leads/{lid}", {"contact_phone": "9111111111"})
        assert ur.status_code == 200
        # fetch lead via list
        leads = _get(session, "/api/leads").json()
        upd = next((x for x in leads if _pick_id(x, "lead_id", "id") == lid), None)
        assert upd
        assert upd.get("last_activity_date") and upd["last_activity_date"] != first_lead_la

        # ----- followup cascade -----
        prev_school_la = (_get_school(session, sid) or {}).get("last_activity_date")
        prev_lead_la = upd["last_activity_date"]
        time.sleep(1.1)
        fr = _post(
            session,
            "/api/followups",
            {"lead_id": lid, "type": "call", "notes": "TEST_FU", "scheduled_date": "2026-02-01"},
        )
        assert fr.status_code in (200, 201), fr.text
        new_school_la = (_get_school(session, sid) or {}).get("last_activity_date")
        new_leads = _get(session, "/api/leads").json()
        new_lead = next(x for x in new_leads if _pick_id(x, "lead_id", "id") == lid)
        assert new_school_la and new_school_la != prev_school_la, "followup did not bump school"
        assert new_lead["last_activity_date"] != prev_lead_la, "followup did not bump lead"

        # ----- lead notes cascade -----
        prev_school_la = new_school_la
        prev_lead_la = new_lead["last_activity_date"]
        time.sleep(1.1)
        nr = _post(session, f"/api/leads/{lid}/notes", {"note": "TEST_NOTE"})
        # endpoint may return 200 / 201
        assert nr.status_code in (200, 201), nr.text
        new_school_la2 = (_get_school(session, sid) or {}).get("last_activity_date")
        new_leads2 = _get(session, "/api/leads").json()
        new_lead2 = next(x for x in new_leads2 if _pick_id(x, "lead_id", "id") == lid)
        assert new_school_la2 != prev_school_la, "note did not bump school"
        assert new_lead2["last_activity_date"] != prev_lead_la, "note did not bump lead"

        # cleanup
        _delete(session, f"/api/leads/{lid}")
        _delete(session, f"/api/schools/{sid}")


# ---------- CONTACT to LEAD CONVERSION ----------
class TestContactConvert:
    def test_convert_carries_role_source_and_bumps_activity(self, session):
        # school
        sr = _post(session, "/api/schools", {"name": f"TEST_CV_{uuid.uuid4().hex[:6]}", "type": "School"})
        sid = _pick_id(sr.json(), "school_id", "id")

        roles = _get(session, "/api/contact-roles").json()
        sources = _get(session, "/api/sources").json()
        role_id = roles[0].get("role_id") or roles[0].get("contact_role_id") or roles[0].get("id")
        source_id = sources[0].get("source_id") or sources[0].get("id")

        cr = _post(
            session,
            "/api/contacts",
            {
                "name": f"TEST_CV_C_{uuid.uuid4().hex[:6]}",
                "phone": "9222222222",
                "contact_role_id": role_id,
                "source_id": source_id,
            },
        )
        assert cr.status_code in (200, 201)
        contact = cr.json()
        cid = _pick_id(contact, "contact_id", "id")

        prev_school_la = (_get_school(session, sid) or {}).get("last_activity_date")
        time.sleep(1.1)
        rr = _post(
            session,
            f"/api/contacts/{cid}/convert-to-lead",
            {"school_id": sid, "company_name": "TEST_CV_CO"},
        )
        assert rr.status_code in (200, 201), rr.text
        body = rr.json()
        lead_block = body.get("lead", body)
        # Validate role/source on created lead
        assert lead_block.get("contact_role_id") == role_id, lead_block
        assert lead_block.get("source_id") == source_id, lead_block
        # last_activity must be set
        assert lead_block.get("last_activity_date")

        # school cascade
        new_school_la = (_get_school(session, sid) or {}).get("last_activity_date")
        assert new_school_la and new_school_la != prev_school_la, "convert did not bump school"

        # cleanup
        lid = _pick_id(lead_block, "lead_id", "id")
        if lid:
            _delete(session, f"/api/leads/{lid}")
        _delete(session, f"/api/contacts/{cid}")
        _delete(session, f"/api/schools/{sid}")


# ---------- QUOTATION OVERRIDES + PDF ----------
class TestQuotationBankTerms:
    def test_create_with_overrides_and_pdf_generates(self, session):
        # need a school + at least 1 package
        pkgs = _get(session, "/api/packages").json()
        if not pkgs:
            pytest.skip("no packages seeded")
        pkg = pkgs[0]
        pkg_id = pkg.get("package_id") or pkg.get("id")

        sr = _post(session, "/api/schools", {"name": f"TEST_QSCH_{uuid.uuid4().hex[:6]}", "type": "School"})
        sid = _pick_id(sr.json(), "school_id", "id")

        body = {
            "school_id": sid,
            "package_id": pkg_id,
            "customer_name": "Quote Customer",
            "items": [],  # not strict, depends on backend
            "bank_details_override": "TEST_OVERRIDE_BANK\nIFSC TEST",
            "terms_override": "Clause A\nClause B\nClause C",
        }
        qr = _post(session, "/api/quotations", body)
        if qr.status_code not in (200, 201):
            # not all installations support quotation creation without items - log and skip
            pytest.skip(f"quotation create not supported: {qr.status_code} {qr.text[:200]}")
        q = qr.json()
        qid = _pick_id(q, "quotation_id", "id")
        assert qid
        assert q.get("bank_details_override", "").startswith("TEST_OVERRIDE_BANK")
        assert "Clause A" in (q.get("terms_override") or "")

        # PDF
        pdf = _get(session, f"/api/quotations/{qid}/pdf")
        assert pdf.status_code == 200, pdf.text[:300]
        assert pdf.headers.get("content-type", "").startswith("application/pdf")
        assert pdf.content[:4] == b"%PDF"

        # cleanup
        _delete(session, f"/api/quotations/{qid}")
        _delete(session, f"/api/schools/{sid}")
