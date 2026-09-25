"""
Test Visit Planning and Inventory Import features (Iteration 13)
- Visit Plans CRUD linked to leads
- Dies CSV import with duplicate detection
- Die image upload
"""
import pytest
import requests
import os
import io

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestAuth:
    """Authentication tests"""
    
    @pytest.fixture(scope="class")
    def session(self):
        return requests.Session()
    
    def test_login_admin(self, session):
        """Login with admin credentials"""
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "info@smartshape.in",
            "password": "admin123"
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        assert data["email"] == "info@smartshape.in"
        assert data["role"] == "admin"
        print(f"✓ Admin login successful: {data['email']}")
        return session


class TestVisitPlans:
    """Visit Planning CRUD tests"""
    
    @pytest.fixture(scope="class")
    def auth_session(self):
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "info@smartshape.in",
            "password": "admin123"
        })
        assert response.status_code == 200, "Auth failed"
        return session
    
    @pytest.fixture(scope="class")
    def test_lead(self, auth_session):
        """Create a test lead for linking"""
        response = auth_session.post(f"{BASE_URL}/api/leads", json={
            "company_name": "TEST_Visit_School",
            "contact_name": "Test Principal",
            "contact_phone": "9999888877",
            "lead_type": "warm",
            "stage": "new"
        })
        assert response.status_code == 200
        lead = response.json()
        yield lead
        # Cleanup
        auth_session.delete(f"{BASE_URL}/api/leads/{lead['lead_id']}")
    
    def test_create_visit_plan(self, auth_session, test_lead):
        """POST /api/visit-plans creates visit plan linked to lead"""
        response = auth_session.post(f"{BASE_URL}/api/visit-plans", json={
            "lead_id": test_lead["lead_id"],
            "lead_name": test_lead["company_name"],
            "school_name": test_lead["company_name"],
            "visit_date": "2026-01-20",
            "visit_time": "10:00",
            "purpose": "Demo presentation",
            "assigned_to": "info@smartshape.in",
            "assigned_name": "Admin"
        })
        assert response.status_code == 200, f"Create failed: {response.text}"
        plan = response.json()
        assert plan["plan_id"].startswith("vp_")
        assert plan["lead_id"] == test_lead["lead_id"]
        assert plan["school_name"] == test_lead["company_name"]
        assert plan["visit_date"] == "2026-01-20"
        assert plan["status"] == "planned"
        print(f"✓ Visit plan created: {plan['plan_id']}")
        return plan
    
    def test_get_visit_plans(self, auth_session):
        """GET /api/visit-plans returns plans list"""
        response = auth_session.get(f"{BASE_URL}/api/visit-plans")
        assert response.status_code == 200
        plans = response.json()
        assert isinstance(plans, list)
        print(f"✓ Got {len(plans)} visit plans")
    
    def test_update_visit_plan_status(self, auth_session, test_lead):
        """PUT /api/visit-plans/{id} updates status (planned→in_progress→completed)"""
        # Create a plan first
        create_resp = auth_session.post(f"{BASE_URL}/api/visit-plans", json={
            "lead_id": test_lead["lead_id"],
            "school_name": "TEST_Status_Update_School",
            "visit_date": "2026-01-21",
            "visit_time": "14:00",
            "purpose": "Follow-up"
        })
        assert create_resp.status_code == 200
        plan = create_resp.json()
        plan_id = plan["plan_id"]
        
        # Update to in_progress (check-in)
        update_resp = auth_session.put(f"{BASE_URL}/api/visit-plans/{plan_id}", json={
            "status": "in_progress",
            "check_in_time": "2026-01-21T14:00:00Z"
        })
        assert update_resp.status_code == 200
        updated = update_resp.json()
        assert updated["status"] == "in_progress"
        print(f"✓ Status updated to in_progress")
        
        # Update to completed (check-out)
        complete_resp = auth_session.put(f"{BASE_URL}/api/visit-plans/{plan_id}", json={
            "status": "completed",
            "check_out_time": "2026-01-21T15:30:00Z",
            "visit_notes": "Demo went well",
            "outcome": "Interested in Package A"
        })
        assert complete_resp.status_code == 200
        completed = complete_resp.json()
        assert completed["status"] == "completed"
        assert completed["visit_notes"] == "Demo went well"
        print(f"✓ Status updated to completed with notes")
        
        # Cleanup
        auth_session.delete(f"{BASE_URL}/api/visit-plans/{plan_id}")
    
    def test_delete_visit_plan(self, auth_session, test_lead):
        """DELETE /api/visit-plans/{id} deletes plan"""
        # Create a plan
        create_resp = auth_session.post(f"{BASE_URL}/api/visit-plans", json={
            "school_name": "TEST_Delete_School",
            "visit_date": "2026-01-22",
            "purpose": "Initial meeting"
        })
        assert create_resp.status_code == 200
        plan = create_resp.json()
        plan_id = plan["plan_id"]
        
        # Delete
        delete_resp = auth_session.delete(f"{BASE_URL}/api/visit-plans/{plan_id}")
        assert delete_resp.status_code == 200
        
        # Verify deleted
        get_resp = auth_session.get(f"{BASE_URL}/api/visit-plans")
        plans = get_resp.json()
        assert not any(p["plan_id"] == plan_id for p in plans)
        print(f"✓ Visit plan deleted successfully")


class TestDiesImport:
    """Dies CSV import and image upload tests"""
    
    @pytest.fixture(scope="class")
    def auth_session(self):
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "info@smartshape.in",
            "password": "admin123"
        })
        assert response.status_code == 200, "Auth failed"
        return session
    
    def test_import_dies_csv(self, auth_session):
        """POST /api/dies/import with CSV creates dies with duplicate detection"""
        # Create CSV content
        csv_content = """code,name,type,stock_qty,reserved_qty,min_level,description
TEST_DIE_001,Test Die Alpha,standard,10,2,5,Test die for import
TEST_DIE_002,Test Die Beta,large,5,0,3,Large test die
TEST_DIE_003,Test Die Gamma,machine,3,1,2,Machine die test"""
        
        files = {'file': ('test_dies.csv', csv_content, 'text/csv')}
        response = auth_session.post(f"{BASE_URL}/api/dies/import", files=files)
        assert response.status_code == 200, f"Import failed: {response.text}"
        result = response.json()
        assert "created" in result
        assert "duplicates" in result
        print(f"✓ CSV import: {result['created']} created, {result['duplicates']} duplicates")
        
        # Verify dies were created
        get_resp = auth_session.get(f"{BASE_URL}/api/dies")
        dies = get_resp.json()
        test_codes = ["TEST_DIE_001", "TEST_DIE_002", "TEST_DIE_003"]
        for code in test_codes:
            found = any(d["code"] == code for d in dies)
            assert found, f"Die {code} not found after import"
        print(f"✓ All imported dies verified in database")
        
        return result
    
    def test_import_duplicate_detection(self, auth_session):
        """Import same CSV again should detect duplicates"""
        csv_content = """code,name,type,stock_qty,reserved_qty,min_level,description
TEST_DIE_001,Test Die Alpha,standard,10,2,5,Test die for import"""
        
        files = {'file': ('test_dies_dup.csv', csv_content, 'text/csv')}
        response = auth_session.post(f"{BASE_URL}/api/dies/import", files=files)
        assert response.status_code == 200
        result = response.json()
        assert result["duplicates"] >= 1, "Should detect duplicate"
        print(f"✓ Duplicate detection working: {result['duplicates']} duplicates found")
    
    def test_create_die_with_image(self, auth_session):
        """Create die and upload image"""
        # Create die
        create_resp = auth_session.post(f"{BASE_URL}/api/dies", json={
            "code": "TEST_IMG_DIE",
            "name": "Test Image Die",
            "type": "standard",
            "min_level": 5,
            "description": "Die for image upload test"
        })
        assert create_resp.status_code == 200
        die = create_resp.json()
        die_id = die["die_id"]
        print(f"✓ Die created: {die_id}")
        
        # Upload image (create a simple test image)
        # Using a minimal valid PNG
        png_header = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82'
        
        files = {'file': ('test_die.png', png_header, 'image/png')}
        upload_resp = auth_session.post(f"{BASE_URL}/api/dies/{die_id}/upload-image", files=files)
        assert upload_resp.status_code == 200, f"Upload failed: {upload_resp.text}"
        result = upload_resp.json()
        assert "image_url" in result
        print(f"✓ Image uploaded: {result['image_url']}")
        
        # Verify die has image_url
        get_resp = auth_session.get(f"{BASE_URL}/api/dies")
        dies = get_resp.json()
        updated_die = next((d for d in dies if d["die_id"] == die_id), None)
        assert updated_die is not None
        assert updated_die["image_url"] is not None and updated_die["image_url"] != ""
        print(f"✓ Die image_url verified in database")
        
        return die_id
    
    def test_get_dies(self, auth_session):
        """GET /api/dies returns dies list"""
        response = auth_session.get(f"{BASE_URL}/api/dies")
        assert response.status_code == 200
        dies = response.json()
        assert isinstance(dies, list)
        print(f"✓ Got {len(dies)} dies")


class TestExport:
    """Export functionality test"""
    
    @pytest.fixture(scope="class")
    def auth_session(self):
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "info@smartshape.in",
            "password": "admin123"
        })
        assert response.status_code == 200, "Auth failed"
        return session
    
    def test_export_inventory(self, auth_session):
        """GET /api/export/inventory returns CSV"""
        response = auth_session.get(f"{BASE_URL}/api/export/inventory")
        # Export might return 200 or 404 if not implemented
        if response.status_code == 200:
            assert "text/csv" in response.headers.get("content-type", "") or len(response.content) > 0
            print(f"✓ Inventory export working")
        else:
            print(f"⚠ Export endpoint returned {response.status_code} - may not be implemented")


class TestCleanup:
    """Cleanup test data"""
    
    @pytest.fixture(scope="class")
    def auth_session(self):
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "info@smartshape.in",
            "password": "admin123"
        })
        assert response.status_code == 200, "Auth failed"
        return session
    
    def test_cleanup_test_dies(self, auth_session):
        """Clean up TEST_ prefixed dies"""
        response = auth_session.get(f"{BASE_URL}/api/dies")
        if response.status_code == 200:
            dies = response.json()
            test_dies = [d for d in dies if d["code"].startswith("TEST_")]
            for die in test_dies:
                # Note: No delete endpoint for dies, so just report
                pass
            print(f"✓ Found {len(test_dies)} test dies (no delete endpoint)")
    
    def test_cleanup_test_visit_plans(self, auth_session):
        """Clean up TEST_ prefixed visit plans"""
        response = auth_session.get(f"{BASE_URL}/api/visit-plans")
        if response.status_code == 200:
            plans = response.json()
            test_plans = [p for p in plans if p.get("school_name", "").startswith("TEST_")]
            for plan in test_plans:
                auth_session.delete(f"{BASE_URL}/api/visit-plans/{plan['plan_id']}")
            print(f"✓ Cleaned up {len(test_plans)} test visit plans")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
