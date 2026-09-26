"""
Test suite for Contacts feature in SmartShape Pro CRM
Tests: GET/POST/PUT/DELETE /api/contacts, POST /api/contacts/{id}/convert-to-lead
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
ADMIN_EMAIL = "info@smartshape.in"
ADMIN_PASSWORD = "admin123"


class TestContactsAPI:
    """Test suite for Contacts CRUD and conversion to Lead"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup session with authentication"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        # Login as admin
        login_response = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        assert login_response.status_code == 200, f"Login failed: {login_response.text}"
        self.user = login_response.json()
        
        yield
        
        # Cleanup: logout
        self.session.post(f"{BASE_URL}/api/auth/logout")
    
    # ==================== GET /api/contacts ====================
    def test_get_contacts_returns_list(self):
        """GET /api/contacts returns contacts list"""
        response = self.session.get(f"{BASE_URL}/api/contacts")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        print(f"✓ GET /api/contacts returns list with {len(data)} contacts")
    
    # ==================== POST /api/contacts ====================
    def test_create_contact_success(self):
        """POST /api/contacts creates a new contact with name and phone required"""
        unique_id = uuid.uuid4().hex[:8]
        contact_data = {
            "name": f"TEST_Contact_{unique_id}",
            "phone": f"+91987654{unique_id[:4]}",
            "email": f"test_{unique_id}@example.com",
            "company": "Test Company",
            "designation": "Principal",
            "source": "Website",
            "notes": "Test contact for automated testing"
        }
        
        response = self.session.post(f"{BASE_URL}/api/contacts", json=contact_data)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        created = response.json()
        assert "contact_id" in created, "Response should contain contact_id"
        assert created["name"] == contact_data["name"], "Name should match"
        assert created["phone"] == contact_data["phone"], "Phone should match"
        assert created["email"] == contact_data["email"], "Email should match"
        assert created["company"] == contact_data["company"], "Company should match"
        assert created["status"] == "active", "Status should be 'active'"
        assert created["converted_to_lead"] == False, "converted_to_lead should be False"
        
        # Verify persistence with GET
        get_response = self.session.get(f"{BASE_URL}/api/contacts")
        assert get_response.status_code == 200
        contacts = get_response.json()
        found = any(c["contact_id"] == created["contact_id"] for c in contacts)
        assert found, "Created contact should be in contacts list"
        
        print(f"✓ POST /api/contacts created contact: {created['contact_id']}")
        
        # Cleanup
        self.session.delete(f"{BASE_URL}/api/contacts/{created['contact_id']}")
    
    def test_create_contact_missing_name_fails(self):
        """POST /api/contacts fails without name"""
        response = self.session.post(f"{BASE_URL}/api/contacts", json={
            "phone": "+919876543210"
        })
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        print("✓ POST /api/contacts without name returns 400")
    
    def test_create_contact_missing_phone_fails(self):
        """POST /api/contacts fails without phone"""
        response = self.session.post(f"{BASE_URL}/api/contacts", json={
            "name": "Test Contact"
        })
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        print("✓ POST /api/contacts without phone returns 400")
    
    # ==================== PUT /api/contacts/{id} ====================
    def test_update_contact_success(self):
        """PUT /api/contacts/{id} updates contact fields"""
        # First create a contact
        unique_id = uuid.uuid4().hex[:8]
        create_response = self.session.post(f"{BASE_URL}/api/contacts", json={
            "name": f"TEST_Update_{unique_id}",
            "phone": f"+91111111{unique_id[:4]}"
        })
        assert create_response.status_code == 200
        contact = create_response.json()
        contact_id = contact["contact_id"]
        
        # Update the contact
        update_data = {
            "name": f"TEST_Updated_{unique_id}",
            "email": f"updated_{unique_id}@example.com",
            "company": "Updated Company",
            "designation": "Director"
        }
        update_response = self.session.put(f"{BASE_URL}/api/contacts/{contact_id}", json=update_data)
        assert update_response.status_code == 200, f"Expected 200, got {update_response.status_code}: {update_response.text}"
        
        updated = update_response.json()
        assert updated["name"] == update_data["name"], "Name should be updated"
        assert updated["email"] == update_data["email"], "Email should be updated"
        assert updated["company"] == update_data["company"], "Company should be updated"
        
        # Verify persistence
        get_response = self.session.get(f"{BASE_URL}/api/contacts")
        contacts = get_response.json()
        found_contact = next((c for c in contacts if c["contact_id"] == contact_id), None)
        assert found_contact is not None, "Contact should exist"
        assert found_contact["name"] == update_data["name"], "Updated name should persist"
        
        print(f"✓ PUT /api/contacts/{contact_id} updated successfully")
        
        # Cleanup
        self.session.delete(f"{BASE_URL}/api/contacts/{contact_id}")
    
    # ==================== DELETE /api/contacts/{id} ====================
    def test_delete_contact_success(self):
        """DELETE /api/contacts/{id} deletes contact"""
        # First create a contact
        unique_id = uuid.uuid4().hex[:8]
        create_response = self.session.post(f"{BASE_URL}/api/contacts", json={
            "name": f"TEST_Delete_{unique_id}",
            "phone": f"+91222222{unique_id[:4]}"
        })
        assert create_response.status_code == 200
        contact_id = create_response.json()["contact_id"]
        
        # Delete the contact
        delete_response = self.session.delete(f"{BASE_URL}/api/contacts/{contact_id}")
        assert delete_response.status_code == 200, f"Expected 200, got {delete_response.status_code}"
        
        # Verify deletion
        get_response = self.session.get(f"{BASE_URL}/api/contacts")
        contacts = get_response.json()
        found = any(c["contact_id"] == contact_id for c in contacts)
        assert not found, "Deleted contact should not be in list"
        
        print(f"✓ DELETE /api/contacts/{contact_id} deleted successfully")
    
    def test_delete_nonexistent_contact_returns_404(self):
        """DELETE /api/contacts/{id} returns 404 for non-existent contact"""
        response = self.session.delete(f"{BASE_URL}/api/contacts/nonexistent_id_12345")
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("✓ DELETE non-existent contact returns 404")
    
    # ==================== POST /api/contacts/{id}/convert-to-lead ====================
    def test_convert_contact_to_lead_success(self):
        """POST /api/contacts/{id}/convert-to-lead creates a lead from contact data"""
        # Create a contact
        unique_id = uuid.uuid4().hex[:8]
        create_response = self.session.post(f"{BASE_URL}/api/contacts", json={
            "name": f"TEST_Convert_{unique_id}",
            "phone": f"+91333333{unique_id[:4]}",
            "email": f"convert_{unique_id}@example.com",
            "company": "Convert Test School",
            "designation": "Principal",
            "source": "Referral",
            "notes": "Contact to be converted"
        })
        assert create_response.status_code == 200
        contact = create_response.json()
        contact_id = contact["contact_id"]
        
        # Convert to lead
        convert_data = {
            "lead_type": "hot",
            "priority": "high",
            "interested_product": "Premium Package",
            "assigned_to": ADMIN_EMAIL
        }
        convert_response = self.session.post(f"{BASE_URL}/api/contacts/{contact_id}/convert-to-lead", json=convert_data)
        assert convert_response.status_code == 200, f"Expected 200, got {convert_response.status_code}: {convert_response.text}"
        
        lead = convert_response.json()
        assert "lead_id" in lead, "Response should contain lead_id"
        assert lead["contact_name"] == contact["name"], "Lead contact_name should match contact name"
        assert lead["contact_phone"] == contact["phone"], "Lead contact_phone should match contact phone"
        assert lead["contact_email"] == contact["email"], "Lead contact_email should match contact email"
        assert lead["lead_type"] == convert_data["lead_type"], "Lead type should match"
        assert lead["priority"] == convert_data["priority"], "Priority should match"
        assert lead["converted_from_contact"] == contact_id, "Lead should reference original contact"
        
        # Verify contact is marked as converted
        get_contacts = self.session.get(f"{BASE_URL}/api/contacts")
        contacts = get_contacts.json()
        converted_contact = next((c for c in contacts if c["contact_id"] == contact_id), None)
        assert converted_contact is not None, "Contact should still exist"
        assert converted_contact["converted_to_lead"] == True, "Contact should be marked as converted"
        assert converted_contact["lead_id"] == lead["lead_id"], "Contact should have lead_id set"
        assert converted_contact["status"] == "converted", "Contact status should be 'converted'"
        
        print(f"✓ POST /api/contacts/{contact_id}/convert-to-lead created lead: {lead['lead_id']}")
        
        # Cleanup - delete lead and contact
        self.session.delete(f"{BASE_URL}/api/leads/{lead['lead_id']}")
        self.session.delete(f"{BASE_URL}/api/contacts/{contact_id}")
    
    def test_convert_already_converted_contact_returns_400(self):
        """Converting already-converted contact returns 400 error"""
        # Create and convert a contact
        unique_id = uuid.uuid4().hex[:8]
        create_response = self.session.post(f"{BASE_URL}/api/contacts", json={
            "name": f"TEST_DoubleConvert_{unique_id}",
            "phone": f"+91444444{unique_id[:4]}"
        })
        assert create_response.status_code == 200
        contact_id = create_response.json()["contact_id"]
        
        # First conversion
        convert_response = self.session.post(f"{BASE_URL}/api/contacts/{contact_id}/convert-to-lead", json={
            "lead_type": "warm"
        })
        assert convert_response.status_code == 200
        lead_id = convert_response.json()["lead_id"]
        
        # Second conversion should fail
        second_convert = self.session.post(f"{BASE_URL}/api/contacts/{contact_id}/convert-to-lead", json={
            "lead_type": "hot"
        })
        assert second_convert.status_code == 400, f"Expected 400, got {second_convert.status_code}"
        
        error_detail = second_convert.json().get("detail", "")
        assert "already converted" in error_detail.lower(), f"Error should mention already converted: {error_detail}"
        
        print("✓ Converting already-converted contact returns 400")
        
        # Cleanup
        self.session.delete(f"{BASE_URL}/api/leads/{lead_id}")
        self.session.delete(f"{BASE_URL}/api/contacts/{contact_id}")
    
    def test_convert_nonexistent_contact_returns_404(self):
        """Converting non-existent contact returns 404"""
        response = self.session.post(f"{BASE_URL}/api/contacts/nonexistent_contact_xyz/convert-to-lead", json={
            "lead_type": "warm"
        })
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("✓ Converting non-existent contact returns 404")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
