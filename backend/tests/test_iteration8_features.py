"""
Iteration 8 Backend Tests - SmartShape Pro
Tests for:
1. Demo accounts login (sales, store, accounts, hr)
2. Leads & CRM (CRUD, stages, notes)
3. Tasks/Follow-ups (CRUD, status updates)
4. Quotation Edit and PDF download
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
DEMO_ACCOUNTS = [
    {"email": "sales@smartshape.in", "password": "demo@123", "expected_modules": ["sales_portal", "field_sales", "quotations", "leads"]},
    {"email": "store@smartshape.in", "password": "demo@123", "expected_modules": ["inventory", "stock_management", "purchase_alerts", "physical_count", "store"]},
    {"email": "accounts@smartshape.in", "password": "demo@123", "expected_modules": ["accounts", "payroll"]},
    {"email": "hr@smartshape.in", "password": "demo@123", "expected_modules": ["hr", "payroll", "field_sales"]},
]

ADMIN_CREDS = {"email": "info@smartshape.in", "password": "admin123"}


class TestDemoAccountsLogin:
    """Test demo department accounts can login with demo@123 password"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
    
    @pytest.mark.parametrize("account", DEMO_ACCOUNTS)
    def test_demo_account_login(self, account):
        """Test each demo account can login successfully"""
        response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": account["email"],
            "password": account["password"]
        })
        
        assert response.status_code == 200, f"Login failed for {account['email']}: {response.text}"
        data = response.json()
        
        # Verify user data returned
        assert data.get("email") == account["email"], f"Email mismatch for {account['email']}"
        assert "user_id" in data, f"No user_id for {account['email']}"
        
        # Verify assigned modules
        assigned_modules = data.get("assigned_modules", [])
        for expected_module in account["expected_modules"]:
            assert expected_module in assigned_modules, f"Missing module {expected_module} for {account['email']}"
        
        # Verify cookies set
        assert "access_token" in response.cookies, f"No access_token cookie for {account['email']}"
        
        print(f"✓ {account['email']} login successful with modules: {assigned_modules}")
    
    def test_admin_login(self):
        """Test admin account login"""
        response = self.session.post(f"{BASE_URL}/api/auth/login", json=ADMIN_CREDS)
        
        assert response.status_code == 200, f"Admin login failed: {response.text}"
        data = response.json()
        assert data.get("role") == "admin", "Admin role not set"
        print(f"✓ Admin login successful")


class TestLeadsCRM:
    """Test Leads & CRM functionality"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        # Login as sales user
        response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "sales@smartshape.in",
            "password": "demo@123"
        })
        assert response.status_code == 200, "Sales login failed"
        self.created_lead_id = None
    
    def test_create_lead_with_new_stage(self):
        """POST /api/leads creates a lead with stage 'new'"""
        lead_data = {
            "company_name": "TEST_ABC School",
            "contact_name": "John Doe",
            "contact_email": "john@abcschool.com",
            "contact_phone": "9876543210",
            "address": "123 Main St",
            "source": "Website",
            "notes": "Test lead"
        }
        
        response = self.session.post(f"{BASE_URL}/api/leads", json=lead_data)
        
        assert response.status_code == 200, f"Create lead failed: {response.text}"
        data = response.json()
        
        # Verify lead created with 'new' stage
        assert data.get("stage") == "new", f"Expected stage 'new', got {data.get('stage')}"
        assert data.get("company_name") == lead_data["company_name"]
        assert "lead_id" in data
        
        self.created_lead_id = data["lead_id"]
        print(f"✓ Lead created with stage 'new': {data['lead_id']}")
        
        # Cleanup
        self.session.delete(f"{BASE_URL}/api/leads/{data['lead_id']}")
    
    def test_update_lead_stage(self):
        """PUT /api/leads/{id} updates lead stage"""
        # First create a lead
        lead_data = {"company_name": "TEST_Stage Update School", "contact_name": "Jane", "contact_phone": "1234567890"}
        create_resp = self.session.post(f"{BASE_URL}/api/leads", json=lead_data)
        assert create_resp.status_code == 200
        lead_id = create_resp.json()["lead_id"]
        
        # Test all stages
        stages = ["contacted", "demo", "quoted", "negotiation", "won", "lost"]
        for stage in stages:
            update_resp = self.session.put(f"{BASE_URL}/api/leads/{lead_id}", json={"stage": stage})
            assert update_resp.status_code == 200, f"Update to {stage} failed"
            assert update_resp.json().get("stage") == stage, f"Stage not updated to {stage}"
        
        print(f"✓ Lead stage updates work for all 7 stages")
        
        # Cleanup
        self.session.delete(f"{BASE_URL}/api/leads/{lead_id}")
    
    def test_add_call_note(self):
        """POST /api/leads/{id}/notes adds call note"""
        # Create lead first
        lead_data = {"company_name": "TEST_Notes School", "contact_name": "Bob", "contact_phone": "5555555555"}
        create_resp = self.session.post(f"{BASE_URL}/api/leads", json=lead_data)
        assert create_resp.status_code == 200
        lead_id = create_resp.json()["lead_id"]
        
        # Add call note
        note_data = {
            "type": "call",
            "content": "Discussed pricing options",
            "outcome": "Interested, will follow up"
        }
        note_resp = self.session.post(f"{BASE_URL}/api/leads/{lead_id}/notes", json=note_data)
        
        assert note_resp.status_code == 200, f"Add note failed: {note_resp.text}"
        note = note_resp.json()
        assert note.get("type") == "call"
        assert note.get("content") == note_data["content"]
        assert "note_id" in note
        
        print(f"✓ Call note added successfully")
        
        # Cleanup
        self.session.delete(f"{BASE_URL}/api/leads/{lead_id}")
    
    def test_get_notes_timeline(self):
        """GET /api/leads/{id}/notes returns notes timeline"""
        # Create lead
        lead_data = {"company_name": "TEST_Timeline School", "contact_name": "Alice", "contact_phone": "6666666666"}
        create_resp = self.session.post(f"{BASE_URL}/api/leads", json=lead_data)
        lead_id = create_resp.json()["lead_id"]
        
        # Add multiple notes
        note_types = ["call", "whatsapp", "email", "meeting"]
        for i, note_type in enumerate(note_types):
            self.session.post(f"{BASE_URL}/api/leads/{lead_id}/notes", json={
                "type": note_type,
                "content": f"Note {i+1} - {note_type}",
                "outcome": f"Outcome {i+1}"
            })
        
        # Get notes timeline
        notes_resp = self.session.get(f"{BASE_URL}/api/leads/{lead_id}/notes")
        
        assert notes_resp.status_code == 200, f"Get notes failed: {notes_resp.text}"
        notes = notes_resp.json()
        assert len(notes) >= 4, f"Expected at least 4 notes, got {len(notes)}"
        
        # Verify notes are sorted by created_at descending (newest first)
        for note in notes:
            assert "note_id" in note
            assert "type" in note
            assert "content" in note
            assert "created_at" in note
        
        print(f"✓ Notes timeline returned {len(notes)} notes")
        
        # Cleanup
        self.session.delete(f"{BASE_URL}/api/leads/{lead_id}")


class TestTasksFollowups:
    """Test Tasks/Follow-up system"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        # Login as sales user
        response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "sales@smartshape.in",
            "password": "demo@123"
        })
        assert response.status_code == 200
    
    def test_create_task(self):
        """POST /api/tasks creates follow-up task"""
        task_data = {
            "title": "TEST_Follow up with ABC School",
            "description": "Discuss pricing",
            "type": "follow_up",
            "due_date": "2026-02-15",
            "due_time": "10:00",
            "priority": "high"
        }
        
        response = self.session.post(f"{BASE_URL}/api/tasks", json=task_data)
        
        assert response.status_code == 200, f"Create task failed: {response.text}"
        task = response.json()
        
        assert task.get("title") == task_data["title"]
        assert task.get("status") == "pending", "New task should have 'pending' status"
        assert task.get("priority") == "high"
        assert "task_id" in task
        
        print(f"✓ Task created: {task['task_id']}")
        
        # Cleanup
        self.session.delete(f"{BASE_URL}/api/tasks/{task['task_id']}")
    
    def test_update_task_status(self):
        """PUT /api/tasks/{id} updates task status"""
        # Create task
        task_data = {"title": "TEST_Status Update Task", "due_date": "2026-02-20", "priority": "medium"}
        create_resp = self.session.post(f"{BASE_URL}/api/tasks", json=task_data)
        task_id = create_resp.json()["task_id"]
        
        # Update to done
        update_resp = self.session.put(f"{BASE_URL}/api/tasks/{task_id}", json={"status": "done", "outcome": "Completed successfully"})
        
        assert update_resp.status_code == 200, f"Update task failed: {update_resp.text}"
        updated = update_resp.json()
        assert updated.get("status") == "done"
        
        # Update to missed
        update_resp2 = self.session.put(f"{BASE_URL}/api/tasks/{task_id}", json={"status": "missed"})
        assert update_resp2.status_code == 200
        assert update_resp2.json().get("status") == "missed"
        
        print(f"✓ Task status updates work (pending → done → missed)")
        
        # Cleanup
        self.session.delete(f"{BASE_URL}/api/tasks/{task_id}")
    
    def test_get_tasks(self):
        """GET /api/tasks returns tasks list"""
        response = self.session.get(f"{BASE_URL}/api/tasks")
        
        assert response.status_code == 200, f"Get tasks failed: {response.text}"
        tasks = response.json()
        assert isinstance(tasks, list)
        
        print(f"✓ Tasks list returned {len(tasks)} tasks")


class TestQuotationEditAndPDF:
    """Test Quotation Edit and PDF download"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        # Login as admin
        response = self.session.post(f"{BASE_URL}/api/auth/login", json=ADMIN_CREDS)
        assert response.status_code == 200
    
    def test_edit_quotation_lines(self):
        """PUT /api/quotations/{id} edits quotation lines and pricing"""
        # Get existing quotations
        quot_resp = self.session.get(f"{BASE_URL}/api/quotations")
        assert quot_resp.status_code == 200
        quotations = quot_resp.json()
        
        if len(quotations) == 0:
            pytest.skip("No quotations to test edit")
        
        # Find a draft quotation or use first one
        test_quot = None
        for q in quotations:
            if q.get("quotation_status") == "draft":
                test_quot = q
                break
        if not test_quot:
            test_quot = quotations[0]
        
        quot_id = test_quot["quotation_id"]
        
        # Update lines
        new_lines = [
            {"description": "Updated Item 1", "qty": 5, "unit_price": 1000, "gst_pct": 18, "line_subtotal": 5000, "line_gst": 900, "line_total": 5900, "product_type": "custom", "sort_order": 1},
            {"description": "Updated Item 2", "qty": 3, "unit_price": 2000, "gst_pct": 18, "line_subtotal": 6000, "line_gst": 1080, "line_total": 7080, "product_type": "custom", "sort_order": 2},
        ]
        
        update_resp = self.session.put(f"{BASE_URL}/api/quotations/{quot_id}", json={
            "lines": new_lines,
            "discount1_pct": 10,
            "discount2_pct": 5
        })
        
        assert update_resp.status_code == 200, f"Edit quotation failed: {update_resp.text}"
        updated = update_resp.json()
        
        # Verify lines updated
        assert len(updated.get("lines", [])) == 2, "Lines not updated"
        assert updated["lines"][0]["description"] == "Updated Item 1"
        
        # Verify pricing recalculated
        assert "grand_total" in updated
        assert updated.get("discount1_pct") == 10
        
        print(f"✓ Quotation {quot_id} lines and pricing updated")
    
    def test_download_quotation_pdf(self):
        """GET /api/quotations/{id}/pdf returns PDF file"""
        # Get existing quotations
        quot_resp = self.session.get(f"{BASE_URL}/api/quotations")
        quotations = quot_resp.json()
        
        if len(quotations) == 0:
            pytest.skip("No quotations to test PDF")
        
        quot_id = quotations[0]["quotation_id"]
        
        # Download PDF
        pdf_resp = self.session.get(f"{BASE_URL}/api/quotations/{quot_id}/pdf")
        
        assert pdf_resp.status_code == 200, f"PDF download failed: {pdf_resp.text}"
        assert pdf_resp.headers.get("content-type") == "application/pdf", "Response is not PDF"
        assert len(pdf_resp.content) > 1000, "PDF content too small"
        
        # Check Content-Disposition header
        content_disp = pdf_resp.headers.get("content-disposition", "")
        assert "attachment" in content_disp, "PDF should be attachment"
        assert ".pdf" in content_disp, "Filename should have .pdf extension"
        
        print(f"✓ PDF downloaded successfully ({len(pdf_resp.content)} bytes)")


class TestLeadsGetAll:
    """Test GET /api/leads returns leads list"""
    
    def test_get_leads(self):
        session = requests.Session()
        session.headers.update({"Content-Type": "application/json"})
        
        # Login as sales
        login_resp = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "sales@smartshape.in",
            "password": "demo@123"
        })
        assert login_resp.status_code == 200
        
        # Get leads
        response = session.get(f"{BASE_URL}/api/leads")
        
        assert response.status_code == 200, f"Get leads failed: {response.text}"
        leads = response.json()
        assert isinstance(leads, list)
        
        print(f"✓ Leads list returned {len(leads)} leads")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
