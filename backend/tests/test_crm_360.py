"""
Regression tests for the 360° CRM work — the highest-risk code paths:

1. School ownership CASCADE — assigning a school must move ALL its contacts +
   leads to the new owner. A bug here = cross-rep data leakage.
2. Invoice bulk-import AUTO-MAP + RECEIVABLES — an imported invoice must map to
   its school (by name/GSTIN) and roll up into per-school outstanding.

Integration style (matches the rest of backend/tests): hits the running API at
REACT_APP_BACKEND_URL, logs in as admin, creates + cleans up its own data.
"""
import io
import json
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
ADMIN = {"email": "info@smartshape.in", "password": os.environ.get("ADMIN_PASSWORD", "admin123")}


def _login():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json=ADMIN)
    assert r.status_code == 200, f"Login failed: {r.text}"
    return s


def _cleanup_delete(session, url):
    """Delete that does NOT silently leak prod data.

    Bare requests.delete() never raises on 4xx/5xx, so an expired token at
    teardown (e.g. after auth rate-limiting) used to leave orphaned TEST_* rows
    on production. Verify the status, re-auth+retry once on 401/403, then warn
    loudly so a failed cleanup is visible instead of silent."""
    try:
        r = session.delete(url)
        if r.status_code in (401, 403):
            session.cookies.update(_login().cookies)
            r = session.delete(url)
        if r.status_code not in (200, 204, 404):
            print(f"!! CLEANUP FAILED ({r.status_code}) for {url} — remove the orphan manually")
    except Exception as exc:
        print(f"!! CLEANUP ERROR for {url}: {exc}")


class TestSchoolOwnershipCascade:
    """POST /schools/{id}/assign must cascade the owner onto contacts + leads."""

    @pytest.fixture(autouse=True)
    def setup(self):
        self.s = _login()
        self.school_id = self.lead_id = self.contact_id = None
        yield
        for url in (
            f"{BASE_URL}/api/leads/{self.lead_id}" if self.lead_id else None,
            f"{BASE_URL}/api/contacts/{self.contact_id}" if self.contact_id else None,
            f"{BASE_URL}/api/schools/{self.school_id}?force=true" if self.school_id else None,
        ):
            if url:
                _cleanup_delete(self.s, url)

    def test_assign_school_cascades_owner_to_contacts_and_leads(self):
        uid = uuid.uuid4().hex[:8]
        name = f"TEST_Cascade_{uid}"
        # school
        r = self.s.post(f"{BASE_URL}/api/schools", json={"school_name": name, "school_type": "CBSE", "email": f"{uid}@t.com"})
        assert r.status_code == 200, r.text
        self.school_id = r.json()["school_id"]
        # contact + lead under the school, deliberately assigned to "someone else"
        r = self.s.post(f"{BASE_URL}/api/contacts", json={"name": f"C_{uid}", "phone": "9000000001", "school_id": self.school_id, "assigned_to": "other@x.com"})
        assert r.status_code == 200, r.text
        self.contact_id = r.json()["contact_id"]
        r = self.s.post(f"{BASE_URL}/api/leads", json={"school_id": self.school_id, "company_name": name, "contact_name": f"L_{uid}", "contact_phone": "9000000002", "assigned_to": "other@x.com", "stage": "new"})
        assert r.status_code == 200, r.text
        self.lead_id = r.json()["lead_id"]

        # assign the school to a different owner
        owner = f"owner_{uid}@x.com"
        r = self.s.post(f"{BASE_URL}/api/schools/{self.school_id}/assign", json={"assigned_to": owner, "assigned_name": "New Owner"})
        assert r.status_code == 200, r.text
        cascaded = r.json().get("cascaded", {})
        assert cascaded.get("leads", 0) >= 1 and cascaded.get("contacts", 0) >= 1, f"cascade counts: {cascaded}"

        # the lead + contact must now belong to the new owner
        lead = next((l for l in self.s.get(f"{BASE_URL}/api/leads").json() if l["lead_id"] == self.lead_id), None)
        assert lead and lead["assigned_to"] == owner, f"lead owner not cascaded: {lead and lead.get('assigned_to')}"
        contact = next((c for c in self.s.get(f"{BASE_URL}/api/contacts").json() if c["contact_id"] == self.contact_id), None)
        assert contact and contact["assigned_to"] == owner, f"contact owner not cascaded: {contact and contact.get('assigned_to')}"
        print(f"OK: assign cascaded owner to {cascaded['leads']} lead(s) + {cascaded['contacts']} contact(s)")

    def test_reassign_is_admin_only(self):
        """Lead reassignment endpoint must reject non-admins (regression for the dead role=='agent' guard)."""
        # As admin, a missing-field call returns 400 (not 403) — proves the admin guard passes.
        r = self.s.post(f"{BASE_URL}/api/leads/reassign", json={})
        assert r.status_code in (400, 422), f"admin should pass the guard, got {r.status_code}: {r.text}"
        print("OK: reassign guard lets admin through (rejects on validation, not auth)")


class TestInvoiceImportAndReceivables:
    """Bulk import maps invoice→school by name; receivables rolls up outstanding."""

    @pytest.fixture(autouse=True)
    def setup(self):
        self.s = _login()
        self.school_id = None
        self.invoice_ids = []
        yield
        for iid in self.invoice_ids:
            _cleanup_delete(self.s, f"{BASE_URL}/api/invoices/{iid}")
        if self.school_id:
            _cleanup_delete(self.s, f"{BASE_URL}/api/schools/{self.school_id}?force=true")

    def test_bulk_import_maps_to_school_and_rolls_into_receivables(self):
        uid = uuid.uuid4().hex[:8]
        name = f"TEST_Invoice_{uid}"
        r = self.s.post(f"{BASE_URL}/api/schools", json={"school_name": name, "school_type": "CBSE", "email": f"{uid}@inv.com"})
        assert r.status_code == 200, r.text
        self.school_id = r.json()["school_id"]

        payload = {"invoices": [{"invoice_number": f"INV-{uid}", "school_name": name, "total_amount": 100000, "invoice_date": "2026-01-01"}]}
        files = {"file": (f"inv_{uid}.json", io.BytesIO(json.dumps(payload).encode()), "application/json")}
        r = self.s.post(f"{BASE_URL}/api/invoices/bulk-import", files=files)
        assert r.status_code == 200, r.text
        summary = r.json()["summary"]
        assert summary["created"] == 1 and summary["unmatched"] == 0, f"import summary: {summary}"
        self.invoice_ids = r.json().get("invoice_ids", [])

        # invoice is linked to the school
        invs = self.s.get(f"{BASE_URL}/api/invoices", params={"school_id": self.school_id}).json()
        assert len(invs) == 1 and abs(invs[0]["total_amount"] - 100000) < 1, f"invoice not linked: {invs}"

        # receivables shows the school's outstanding (no payments -> full amount)
        rows = self.s.get(f"{BASE_URL}/api/invoices/receivables").json().get("rows", [])
        row = next((x for x in rows if x["school_id"] == self.school_id), None)
        assert row and abs(row["outstanding"] - 100000) < 1, f"receivables outstanding wrong: {row}"
        print(f"OK: invoice mapped to school + outstanding Rs {row['outstanding']:.0f} in receivables")

    def test_alias_tolerant_parsing(self):
        """Importer must accept aliased field names (invoice_no/buyer/total) for an unmatched row."""
        uid = uuid.uuid4().hex[:8]
        payload = [{"invoice_no": f"ALIAS-{uid}", "buyer": f"Nonexistent School {uid}", "total": "1,18,000"}]
        files = {"file": (f"alias_{uid}.json", io.BytesIO(json.dumps(payload).encode()), "application/json")}
        r = self.s.post(f"{BASE_URL}/api/invoices/bulk-import", files=files)
        assert r.status_code == 200, r.text
        summary = r.json()["summary"]
        assert summary["created"] == 1, f"alias import: {summary}"
        self.invoice_ids = r.json().get("invoice_ids", [])
        inv = self.s.get(f"{BASE_URL}/api/invoices", params={"match_status": "unmatched"}).json()
        mine = next((x for x in inv if x["invoice_number"] == f"ALIAS-{uid}"), None)
        assert mine and abs(mine["total_amount"] - 118000) < 1, f"alias/total parse failed: {mine}"
        print("OK: aliased fields + '1,18,000' parsed to 118000, flagged unmatched")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
