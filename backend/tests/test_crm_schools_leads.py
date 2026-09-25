"""
Test CRM Schools and Leads CRUD operations
- Schools: GET, POST, PUT, DELETE
- Leads: GET, POST, PUT, DELETE with sorting
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestSchoolsCRUD:
    """Schools endpoint tests - Create, Read, Update, Delete"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login and get auth cookies"""
        self.session = requests.Session()
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "info@smartshape.in",
            "password": "admin123"
        })
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        self.test_school_id = None
        yield
        # Cleanup
        if self.test_school_id:
            try:
                self.session.delete(f"{BASE_URL}/api/schools/{self.test_school_id}")
            except:
                pass
    
    def test_get_schools(self):
        """GET /api/schools - List all schools"""
        resp = self.session.get(f"{BASE_URL}/api/schools")
        assert resp.status_code == 200, f"Failed to get schools: {resp.text}"
        data = resp.json()
        assert isinstance(data, list), "Response should be a list"
        print(f"✓ GET /api/schools returned {len(data)} schools")
    
    def test_create_school(self):
        """POST /api/schools - Create new school"""
        unique_id = uuid.uuid4().hex[:8]
        school_data = {
            "school_name": f"TEST_School_{unique_id}",
            "school_type": "CBSE",
            "email": f"test_{unique_id}@school.com",
            "phone": "9876543210",
            "city": "Test City",
            "state": "Test State",
            "primary_contact_name": "Test Principal",
            "designation": "Principal",
            "school_strength": 500
        }
        resp = self.session.post(f"{BASE_URL}/api/schools", json=school_data)
        assert resp.status_code == 200, f"Failed to create school: {resp.text}"
        
        data = resp.json()
        assert "school_id" in data, "Response should contain school_id"
        assert data["school_name"] == school_data["school_name"]
        assert data["email"] == school_data["email"]
        assert data["city"] == school_data["city"]
        
        self.test_school_id = data["school_id"]
        print(f"✓ POST /api/schools created school: {data['school_id']}")
        
        # Verify persistence with GET
        get_resp = self.session.get(f"{BASE_URL}/api/schools")
        schools = get_resp.json()
        created_school = next((s for s in schools if s["school_id"] == self.test_school_id), None)
        assert created_school is not None, "Created school not found in list"
        assert created_school["school_name"] == school_data["school_name"]
        print(f"✓ Verified school persisted in database")
    
    def test_update_school(self):
        """PUT /api/schools/{id} - Update school data"""
        # First create a school
        unique_id = uuid.uuid4().hex[:8]
        create_resp = self.session.post(f"{BASE_URL}/api/schools", json={
            "school_name": f"TEST_Update_School_{unique_id}",
            "school_type": "CBSE",
            "email": f"update_{unique_id}@school.com",
            "city": "Original City"
        })
        assert create_resp.status_code == 200
        school_id = create_resp.json()["school_id"]
        self.test_school_id = school_id
        
        # Update the school
        update_data = {
            "school_name": f"TEST_Updated_School_{unique_id}",
            "city": "Updated City",
            "school_strength": 1000,
            "email": f"updated_{unique_id}@school.com"
        }
        update_resp = self.session.put(f"{BASE_URL}/api/schools/{school_id}", json=update_data)
        assert update_resp.status_code == 200, f"Failed to update school: {update_resp.text}"
        
        updated = update_resp.json()
        assert updated["school_name"] == update_data["school_name"]
        assert updated["city"] == update_data["city"]
        assert updated["school_strength"] == update_data["school_strength"]
        assert updated["email"] == update_data["email"]
        print(f"✓ PUT /api/schools/{school_id} updated successfully")
        
        # Verify persistence
        get_resp = self.session.get(f"{BASE_URL}/api/schools")
        schools = get_resp.json()
        found = next((s for s in schools if s["school_id"] == school_id), None)
        assert found is not None
        assert found["city"] == "Updated City"
        print(f"✓ Verified update persisted in database")
    
    def test_delete_school(self):
        """DELETE /api/schools/{id} - Delete school"""
        # First create a school
        unique_id = uuid.uuid4().hex[:8]
        create_resp = self.session.post(f"{BASE_URL}/api/schools", json={
            "school_name": f"TEST_Delete_School_{unique_id}",
            "school_type": "ICSE",
            "email": f"delete_{unique_id}@school.com"
        })
        assert create_resp.status_code == 200
        school_id = create_resp.json()["school_id"]
        
        # Delete the school
        delete_resp = self.session.delete(f"{BASE_URL}/api/schools/{school_id}")
        assert delete_resp.status_code == 200, f"Failed to delete school: {delete_resp.text}"
        print(f"✓ DELETE /api/schools/{school_id} successful")
        
        # Verify deletion
        get_resp = self.session.get(f"{BASE_URL}/api/schools")
        schools = get_resp.json()
        found = next((s for s in schools if s["school_id"] == school_id), None)
        assert found is None, "Deleted school should not exist"
        print(f"✓ Verified school deleted from database")


class TestLeadsCRUD:
    """Leads endpoint tests - Create, Read, Update, Delete"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login and get auth cookies"""
        self.session = requests.Session()
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "info@smartshape.in",
            "password": "admin123"
        })
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        self.test_lead_id = None
        self.test_school_id = None
        yield
        # Cleanup
        if self.test_lead_id:
            try:
                self.session.delete(f"{BASE_URL}/api/leads/{self.test_lead_id}")
            except:
                pass
        if self.test_school_id:
            try:
                self.session.delete(f"{BASE_URL}/api/schools/{self.test_school_id}")
            except:
                pass
    
    def test_get_leads(self):
        """GET /api/leads - List all leads"""
        resp = self.session.get(f"{BASE_URL}/api/leads")
        assert resp.status_code == 200, f"Failed to get leads: {resp.text}"
        data = resp.json()
        assert isinstance(data, list), "Response should be a list"
        print(f"✓ GET /api/leads returned {len(data)} leads")
        
        # Check lead structure
        if len(data) > 0:
            lead = data[0]
            assert "lead_id" in lead
            assert "contact_name" in lead
            print(f"✓ Lead structure verified")
    
    def test_create_lead(self):
        """POST /api/leads - Create new lead"""
        # First create a school
        unique_id = uuid.uuid4().hex[:8]
        school_resp = self.session.post(f"{BASE_URL}/api/schools", json={
            "school_name": f"TEST_Lead_School_{unique_id}",
            "school_type": "CBSE",
            "email": f"lead_school_{unique_id}@test.com",
            "city": "Lead City"
        })
        assert school_resp.status_code == 200
        school_id = school_resp.json()["school_id"]
        self.test_school_id = school_id
        
        # Create lead
        lead_data = {
            "school_id": school_id,
            "company_name": f"TEST_Lead_School_{unique_id}",
            "contact_name": f"Test Contact {unique_id}",
            "contact_phone": "9876543210",
            "contact_email": f"contact_{unique_id}@test.com",
            "lead_type": "warm",
            "stage": "new",
            "priority": "medium",
            "source": "Website"
        }
        resp = self.session.post(f"{BASE_URL}/api/leads", json=lead_data)
        assert resp.status_code == 200, f"Failed to create lead: {resp.text}"
        
        data = resp.json()
        assert "lead_id" in data
        assert data["contact_name"] == lead_data["contact_name"]
        assert data["lead_type"] == lead_data["lead_type"]
        
        self.test_lead_id = data["lead_id"]
        print(f"✓ POST /api/leads created lead: {data['lead_id']}")
        
        # Verify persistence
        get_resp = self.session.get(f"{BASE_URL}/api/leads")
        leads = get_resp.json()
        found = next((l for l in leads if l["lead_id"] == self.test_lead_id), None)
        assert found is not None, "Created lead not found"
        print(f"✓ Verified lead persisted in database")
    
    def test_update_lead(self):
        """PUT /api/leads/{id} - Update lead data"""
        # Create school and lead
        unique_id = uuid.uuid4().hex[:8]
        school_resp = self.session.post(f"{BASE_URL}/api/schools", json={
            "school_name": f"TEST_Update_Lead_School_{unique_id}",
            "school_type": "CBSE",
            "email": f"update_lead_{unique_id}@test.com"
        })
        school_id = school_resp.json()["school_id"]
        self.test_school_id = school_id
        
        lead_resp = self.session.post(f"{BASE_URL}/api/leads", json={
            "school_id": school_id,
            "company_name": f"TEST_Update_Lead_School_{unique_id}",
            "contact_name": "Original Contact",
            "contact_phone": "1111111111",
            "lead_type": "cold",
            "stage": "new"
        })
        lead_id = lead_resp.json()["lead_id"]
        self.test_lead_id = lead_id
        
        # Update lead
        update_data = {
            "contact_name": "Updated Contact",
            "contact_phone": "2222222222",
            "lead_type": "hot",
            "stage": "contacted"
        }
        update_resp = self.session.put(f"{BASE_URL}/api/leads/{lead_id}", json=update_data)
        assert update_resp.status_code == 200, f"Failed to update lead: {update_resp.text}"
        
        updated = update_resp.json()
        assert updated["contact_name"] == "Updated Contact"
        assert updated["lead_type"] == "hot"
        assert updated["stage"] == "contacted"
        print(f"✓ PUT /api/leads/{lead_id} updated successfully")
        
        # Verify persistence
        get_resp = self.session.get(f"{BASE_URL}/api/leads")
        leads = get_resp.json()
        found = next((l for l in leads if l["lead_id"] == lead_id), None)
        assert found is not None
        assert found["contact_name"] == "Updated Contact"
        print(f"✓ Verified update persisted in database")
    
    def test_delete_lead(self):
        """DELETE /api/leads/{id} - Delete lead"""
        # Create school and lead
        unique_id = uuid.uuid4().hex[:8]
        school_resp = self.session.post(f"{BASE_URL}/api/schools", json={
            "school_name": f"TEST_Delete_Lead_School_{unique_id}",
            "school_type": "CBSE",
            "email": f"delete_lead_{unique_id}@test.com"
        })
        school_id = school_resp.json()["school_id"]
        self.test_school_id = school_id
        
        lead_resp = self.session.post(f"{BASE_URL}/api/leads", json={
            "school_id": school_id,
            "company_name": f"TEST_Delete_Lead_School_{unique_id}",
            "contact_name": "Delete Contact",
            "contact_phone": "3333333333",
            "lead_type": "warm",
            "stage": "new"
        })
        lead_id = lead_resp.json()["lead_id"]
        
        # Delete lead
        delete_resp = self.session.delete(f"{BASE_URL}/api/leads/{lead_id}")
        assert delete_resp.status_code == 200, f"Failed to delete lead: {delete_resp.text}"
        print(f"✓ DELETE /api/leads/{lead_id} successful")
        
        # Verify deletion
        get_resp = self.session.get(f"{BASE_URL}/api/leads")
        leads = get_resp.json()
        found = next((l for l in leads if l["lead_id"] == lead_id), None)
        assert found is None, "Deleted lead should not exist"
        print(f"✓ Verified lead deleted from database")


class TestContactsCRUD:
    """Contacts endpoint tests - Create, Read, Update, Delete, Convert to Lead"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login and get auth cookies"""
        self.session = requests.Session()
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "info@smartshape.in",
            "password": "admin123"
        })
        assert login_resp.status_code == 200
        self.test_contact_id = None
        yield
        if self.test_contact_id:
            try:
                self.session.delete(f"{BASE_URL}/api/contacts/{self.test_contact_id}")
            except:
                pass
    
    def test_get_contacts(self):
        """GET /api/contacts - List all contacts"""
        resp = self.session.get(f"{BASE_URL}/api/contacts")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        print(f"✓ GET /api/contacts returned {len(data)} contacts")
    
    def test_create_contact(self):
        """POST /api/contacts - Create new contact"""
        unique_id = uuid.uuid4().hex[:8]
        contact_data = {
            "name": f"TEST_Contact_{unique_id}",
            "phone": "9876543210",
            "email": f"contact_{unique_id}@test.com",
            "company": "Test Company",
            "designation": "Principal",
            "source": "Website"
        }
        resp = self.session.post(f"{BASE_URL}/api/contacts", json=contact_data)
        assert resp.status_code == 200, f"Failed: {resp.text}"
        
        data = resp.json()
        assert "contact_id" in data
        assert data["name"] == contact_data["name"]
        self.test_contact_id = data["contact_id"]
        print(f"✓ POST /api/contacts created: {data['contact_id']}")
    
    def test_update_contact(self):
        """PUT /api/contacts/{id} - Update contact"""
        unique_id = uuid.uuid4().hex[:8]
        create_resp = self.session.post(f"{BASE_URL}/api/contacts", json={
            "name": f"TEST_Update_Contact_{unique_id}",
            "phone": "1111111111"
        })
        contact_id = create_resp.json()["contact_id"]
        self.test_contact_id = contact_id
        
        update_resp = self.session.put(f"{BASE_URL}/api/contacts/{contact_id}", json={
            "name": f"TEST_Updated_Contact_{unique_id}",
            "phone": "2222222222",
            "company": "Updated Company"
        })
        assert update_resp.status_code == 200
        updated = update_resp.json()
        assert updated["company"] == "Updated Company"
        print(f"✓ PUT /api/contacts/{contact_id} updated successfully")
    
    def test_delete_contact(self):
        """DELETE /api/contacts/{id} - Delete contact"""
        unique_id = uuid.uuid4().hex[:8]
        create_resp = self.session.post(f"{BASE_URL}/api/contacts", json={
            "name": f"TEST_Delete_Contact_{unique_id}",
            "phone": "3333333333"
        })
        contact_id = create_resp.json()["contact_id"]
        
        delete_resp = self.session.delete(f"{BASE_URL}/api/contacts/{contact_id}")
        assert delete_resp.status_code == 200
        print(f"✓ DELETE /api/contacts/{contact_id} successful")
        
        # Verify deletion
        get_resp = self.session.get(f"{BASE_URL}/api/contacts")
        contacts = get_resp.json()
        found = next((c for c in contacts if c["contact_id"] == contact_id), None)
        assert found is None
        print(f"✓ Verified contact deleted")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
