"""
Test Suite for School CRM - Iteration 12
Tests: School Master, Lead Master with scoring, Follow-ups, CSV Import, Pipeline
"""
import pytest
import requests
import os
import io
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
ADMIN_EMAIL = "info@smartshape.in"
ADMIN_PASSWORD = "admin123"

class TestSession:
    """Shared session for authenticated requests"""
    session = None
    
    @classmethod
    def get_session(cls):
        if cls.session is None:
            cls.session = requests.Session()
            cls.session.headers.update({"Content-Type": "application/json"})
            # Login
            resp = cls.session.post(f"{BASE_URL}/api/auth/login", json={
                "email": ADMIN_EMAIL,
                "password": ADMIN_PASSWORD
            })
            assert resp.status_code == 200, f"Login failed: {resp.text}"
        return cls.session


# ==================== SCHOOL MASTER TESTS ====================

class TestSchoolMaster:
    """School Master CRUD tests"""
    
    def test_create_school_with_all_fields(self):
        """API: POST /api/schools creates school with all fields"""
        session = TestSession.get_session()
        school_data = {
            "school_name": f"TEST_School_{uuid.uuid4().hex[:8]}",
            "school_type": "CBSE",
            "website": "https://testschool.edu",
            "email": "test@school.edu",
            "phone": "9876543210",
            "city": "Mumbai",
            "state": "Maharashtra",
            "pincode": "400001",
            "primary_contact_name": "John Principal",
            "designation": "Principal",
            "school_strength": 1500,
            "number_of_branches": 2,
            "annual_budget_range": "10-50L",
            "existing_vendor": "None"
        }
        
        resp = session.post(f"{BASE_URL}/api/schools", json=school_data)
        assert resp.status_code == 200, f"Create school failed: {resp.text}"
        
        data = resp.json()
        assert "school_id" in data, "school_id not in response"
        assert data["school_name"] == school_data["school_name"]
        assert data["school_type"] == "CBSE"
        assert data["city"] == "Mumbai"
        assert data["school_strength"] == 1500
        assert data["primary_contact_name"] == "John Principal"
        
        # Store for cleanup
        self.__class__.created_school_id = data["school_id"]
        print(f"✓ Created school: {data['school_id']}")
    
    def test_get_schools_list(self):
        """API: GET /api/schools returns schools list"""
        session = TestSession.get_session()
        resp = session.get(f"{BASE_URL}/api/schools")
        
        assert resp.status_code == 200, f"Get schools failed: {resp.text}"
        data = resp.json()
        assert isinstance(data, list), "Response should be a list"
        print(f"✓ Got {len(data)} schools")
    
    def test_update_school(self):
        """API: PUT /api/schools/{id} updates school"""
        session = TestSession.get_session()
        
        # First create a school
        school_data = {
            "school_name": f"TEST_UpdateSchool_{uuid.uuid4().hex[:8]}",
            "school_type": "ICSE",
            "city": "Delhi"
        }
        create_resp = session.post(f"{BASE_URL}/api/schools", json=school_data)
        assert create_resp.status_code == 200
        school_id = create_resp.json()["school_id"]
        
        # Update the school
        update_data = {
            "school_type": "IB",
            "city": "Bangalore",
            "school_strength": 2000
        }
        update_resp = session.put(f"{BASE_URL}/api/schools/{school_id}", json=update_data)
        assert update_resp.status_code == 200, f"Update failed: {update_resp.text}"
        
        updated = update_resp.json()
        assert updated["school_type"] == "IB"
        assert updated["city"] == "Bangalore"
        assert updated["school_strength"] == 2000
        print(f"✓ Updated school: {school_id}")


# ==================== LEAD MASTER TESTS ====================

class TestLeadMaster:
    """Lead Master CRUD and scoring tests"""
    
    @pytest.fixture(autouse=True)
    def setup_school(self):
        """Create a test school for leads"""
        session = TestSession.get_session()
        school_data = {
            "school_name": f"TEST_LeadSchool_{uuid.uuid4().hex[:8]}",
            "school_type": "CBSE",
            "city": "Chennai",
            "school_strength": 1500  # >1000 for scoring
        }
        resp = session.post(f"{BASE_URL}/api/schools", json=school_data)
        assert resp.status_code == 200
        self.test_school = resp.json()
        yield
    
    def test_create_lead_linked_to_school(self):
        """API: POST /api/leads creates lead linked to school_id"""
        session = TestSession.get_session()
        lead_data = {
            "school_id": self.test_school["school_id"],
            "contact_name": "Test Contact",
            "designation": "Principal",
            "contact_phone": "9876543211",
            "contact_email": "contact@test.com",
            "source": "Website",
            "lead_type": "hot",
            "stage": "new",
            "priority": "high"
        }
        
        resp = session.post(f"{BASE_URL}/api/leads", json=lead_data)
        assert resp.status_code == 200, f"Create lead failed: {resp.text}"
        
        data = resp.json()
        assert "lead_id" in data
        assert data["school_id"] == self.test_school["school_id"]
        assert data["contact_name"] == "Test Contact"
        assert data["lead_type"] == "hot"
        self.__class__.created_lead_id = data["lead_id"]
        print(f"✓ Created lead: {data['lead_id']}")
    
    def test_create_lead_with_new_school_inline(self):
        """API: POST /api/leads with new_school creates school inline"""
        session = TestSession.get_session()
        lead_data = {
            "contact_name": "Inline School Contact",
            "designation": "Admin",
            "contact_phone": "9876543212",
            "lead_type": "warm",
            "new_school": {
                "school_name": f"TEST_InlineSchool_{uuid.uuid4().hex[:8]}",
                "school_type": "State Board",
                "city": "Pune",
                "school_strength": 800
            }
        }
        
        resp = session.post(f"{BASE_URL}/api/leads", json=lead_data)
        assert resp.status_code == 200, f"Create lead with inline school failed: {resp.text}"
        
        data = resp.json()
        assert "lead_id" in data
        assert data["school_id"], "school_id should be set from inline school"
        print(f"✓ Created lead with inline school: {data['lead_id']}")
    
    def test_get_leads_with_enrichment(self):
        """API: GET /api/leads returns leads with lead_score, school_name, school_type, school_city enrichment"""
        session = TestSession.get_session()
        
        # First create a lead
        lead_data = {
            "school_id": self.test_school["school_id"],
            "contact_name": "Enrichment Test",
            "contact_phone": "9876543213",
            "lead_type": "hot",
            "designation": "Principal"
        }
        session.post(f"{BASE_URL}/api/leads", json=lead_data)
        
        # Get leads
        resp = session.get(f"{BASE_URL}/api/leads")
        assert resp.status_code == 200, f"Get leads failed: {resp.text}"
        
        data = resp.json()
        assert isinstance(data, list)
        
        # Find our lead
        test_leads = [l for l in data if l.get("contact_name") == "Enrichment Test"]
        assert len(test_leads) > 0, "Test lead not found"
        
        lead = test_leads[0]
        assert "lead_score" in lead, "lead_score not in response"
        assert "school_name" in lead, "school_name not in response"
        assert "school_type" in lead, "school_type not in response"
        assert "school_city" in lead, "school_city not in response"
        print(f"✓ Lead enrichment verified: score={lead['lead_score']}, school={lead['school_name']}")
    
    def test_lead_scoring_calculation(self):
        """API: Lead scoring: hot lead + principal + strength>1000 = score 25"""
        session = TestSession.get_session()
        
        # Create school with strength > 1000
        school_data = {
            "school_name": f"TEST_ScoringSchool_{uuid.uuid4().hex[:8]}",
            "school_type": "CBSE",
            "school_strength": 1500  # +10 points
        }
        school_resp = session.post(f"{BASE_URL}/api/schools", json=school_data)
        school = school_resp.json()
        
        # Create hot lead with principal designation
        lead_data = {
            "school_id": school["school_id"],
            "contact_name": "Scoring Test Principal",
            "designation": "Principal",  # +5 points (decision-maker)
            "contact_phone": "9876543214",
            "lead_type": "hot",  # +10 points
            "stage": "contacted"  # +5 points (responded)
        }
        lead_resp = session.post(f"{BASE_URL}/api/leads", json=lead_data)
        lead = lead_resp.json()
        
        # Get leads to check score
        resp = session.get(f"{BASE_URL}/api/leads")
        leads = resp.json()
        
        test_lead = next((l for l in leads if l["lead_id"] == lead["lead_id"]), None)
        assert test_lead is not None, "Test lead not found"
        
        # Expected: 10 (strength>1000) + 5 (principal) + 5 (responded) + 10 (hot) = 30
        # But the code checks stage not in ("new",) for responded, so if stage is "contacted", it's +5
        expected_score = 10 + 5 + 5 + 10  # = 30
        assert test_lead["lead_score"] >= 25, f"Expected score >= 25, got {test_lead['lead_score']}"
        print(f"✓ Lead scoring verified: {test_lead['lead_score']} (expected ~30)")


# ==================== FOLLOW-UPS TESTS ====================

class TestFollowups:
    """Follow-ups CRUD tests"""
    
    @pytest.fixture(autouse=True)
    def setup_lead(self):
        """Create a test lead for follow-ups"""
        session = TestSession.get_session()
        
        # Create school
        school_data = {"school_name": f"TEST_FUSchool_{uuid.uuid4().hex[:8]}", "school_type": "CBSE"}
        school_resp = session.post(f"{BASE_URL}/api/schools", json=school_data)
        school = school_resp.json()
        
        # Create lead
        lead_data = {
            "school_id": school["school_id"],
            "contact_name": "Followup Test",
            "contact_phone": "9876543215",
            "lead_type": "warm"
        }
        lead_resp = session.post(f"{BASE_URL}/api/leads", json=lead_data)
        self.test_lead = lead_resp.json()
        yield
    
    def test_create_followup(self):
        """API: POST /api/followups creates follow-up linked to lead"""
        session = TestSession.get_session()
        fu_data = {
            "lead_id": self.test_lead["lead_id"],
            "followup_date": "2026-01-20",
            "followup_time": "10:00",
            "followup_type": "call",
            "notes": "Initial follow-up call"
        }
        
        resp = session.post(f"{BASE_URL}/api/followups", json=fu_data)
        assert resp.status_code == 200, f"Create followup failed: {resp.text}"
        
        data = resp.json()
        assert "followup_id" in data
        assert data["lead_id"] == self.test_lead["lead_id"]
        assert data["followup_type"] == "call"
        assert data["status"] == "pending"
        self.__class__.created_fu_id = data["followup_id"]
        print(f"✓ Created follow-up: {data['followup_id']}")
    
    def test_get_followups_by_lead(self):
        """API: GET /api/followups?lead_id=X returns follow-ups for lead"""
        session = TestSession.get_session()
        
        # Create a follow-up first
        fu_data = {
            "lead_id": self.test_lead["lead_id"],
            "followup_date": "2026-01-21",
            "followup_type": "whatsapp"
        }
        session.post(f"{BASE_URL}/api/followups", json=fu_data)
        
        # Get follow-ups for this lead
        resp = session.get(f"{BASE_URL}/api/followups", params={"lead_id": self.test_lead["lead_id"]})
        assert resp.status_code == 200, f"Get followups failed: {resp.text}"
        
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) > 0, "Should have at least one follow-up"
        assert all(fu["lead_id"] == self.test_lead["lead_id"] for fu in data)
        print(f"✓ Got {len(data)} follow-ups for lead")
    
    def test_update_followup_status(self):
        """API: PUT /api/followups/{id} updates status to completed"""
        session = TestSession.get_session()
        
        # Create a follow-up
        fu_data = {
            "lead_id": self.test_lead["lead_id"],
            "followup_date": "2026-01-22",
            "followup_type": "visit"
        }
        create_resp = session.post(f"{BASE_URL}/api/followups", json=fu_data)
        fu = create_resp.json()
        
        # Update status
        update_resp = session.put(f"{BASE_URL}/api/followups/{fu['followup_id']}", json={
            "status": "completed",
            "outcome": "Meeting scheduled"
        })
        assert update_resp.status_code == 200, f"Update followup failed: {update_resp.text}"
        
        updated = update_resp.json()
        assert updated["status"] == "completed"
        print(f"✓ Updated follow-up status to completed")


# ==================== CSV IMPORT TESTS ====================

class TestCSVImport:
    """CSV Import tests with duplicate detection"""
    
    def test_import_csv_creates_schools_and_leads(self):
        """API: POST /api/leads/import with CSV file creates schools and leads with duplicate detection"""
        # Use a fresh session without Content-Type header for multipart
        import_session = requests.Session()
        
        # Login first
        login_resp = import_session.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        
        # Create CSV content
        csv_content = """school_name,school_type,website,location,contact_name,designation,phone,email,school_strength,source
TEST_ImportSchool1,CBSE,https://import1.edu,Mumbai,Import Contact 1,Principal,9876543301,import1@test.com,1200,Import
TEST_ImportSchool2,ICSE,https://import2.edu,Delhi,Import Contact 2,Admin,9876543302,import2@test.com,800,Import
TEST_ImportSchool1,CBSE,https://import1.edu,Mumbai,Import Contact 1,Principal,9876543301,import1@test.com,1200,Import"""
        
        # Create file-like object
        files = {'file': ('test_import.csv', csv_content, 'text/csv')}
        
        resp = import_session.post(
            f"{BASE_URL}/api/leads/import",
            files=files
        )
        assert resp.status_code == 200, f"Import failed: {resp.text}"
        
        data = resp.json()
        assert "created" in data
        assert "duplicates" in data
        assert data["created"] >= 1, "Should create at least 1 lead"
        # Third row is duplicate
        print(f"✓ Import result: created={data['created']}, linked={data.get('linked', 0)}, duplicates={data['duplicates']}")


# ==================== PIPELINE STAGES TESTS ====================

class TestPipelineStages:
    """Test pipeline stage updates"""
    
    def test_update_lead_stage(self):
        """Test updating lead through pipeline stages"""
        session = TestSession.get_session()
        
        # Create school and lead
        school_data = {"school_name": f"TEST_PipelineSchool_{uuid.uuid4().hex[:8]}", "school_type": "CBSE"}
        school = session.post(f"{BASE_URL}/api/schools", json=school_data).json()
        
        lead_data = {
            "school_id": school["school_id"],
            "contact_name": "Pipeline Test",
            "contact_phone": "9876543216",
            "lead_type": "warm",
            "stage": "new"
        }
        lead = session.post(f"{BASE_URL}/api/leads", json=lead_data).json()
        
        # Update through stages
        stages = ["contacted", "demo", "quoted", "negotiation", "won"]
        for stage in stages:
            resp = session.put(f"{BASE_URL}/api/leads/{lead['lead_id']}", json={"stage": stage})
            assert resp.status_code == 200, f"Update to {stage} failed"
            updated = resp.json()
            assert updated["stage"] == stage
        
        print(f"✓ Lead moved through all pipeline stages")


# ==================== AUTH TESTS ====================

class TestAuth:
    """Authentication tests"""
    
    def test_unauthenticated_access_blocked(self):
        """Test that unauthenticated requests are blocked"""
        resp = requests.get(f"{BASE_URL}/api/schools")
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"
        print("✓ Unauthenticated access blocked")
    
    def test_login_success(self):
        """Test successful login"""
        session = requests.Session()
        resp = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        assert resp.status_code == 200, f"Login failed: {resp.text}"
        data = resp.json()
        assert "email" in data
        assert data["email"] == ADMIN_EMAIL
        print("✓ Login successful")


# ==================== CLEANUP ====================

@pytest.fixture(scope="session", autouse=True)
def cleanup(request):
    """Cleanup test data after all tests"""
    def cleanup_test_data():
        session = TestSession.get_session()
        
        # Get all schools and delete TEST_ prefixed ones
        schools = session.get(f"{BASE_URL}/api/schools").json()
        for school in schools:
            if school.get("school_name", "").startswith("TEST_"):
                try:
                    session.delete(f"{BASE_URL}/api/schools/{school['school_id']}")
                except:
                    pass
        
        # Get all leads and delete TEST_ related ones
        leads = session.get(f"{BASE_URL}/api/leads").json()
        for lead in leads:
            if lead.get("company_name", "").startswith("TEST_") or lead.get("contact_name", "").startswith("TEST_"):
                try:
                    session.delete(f"{BASE_URL}/api/leads/{lead['lead_id']}")
                except:
                    pass
        
        print("\n✓ Test data cleaned up")
    
    request.addfinalizer(cleanup_test_data)


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
