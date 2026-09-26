"""
Test Inventory Archive/Delete Features (Iteration 14)
- GET /api/dies with include_archived param
- PUT /api/dies/{die_id}/archive (toggle archive status)
- DELETE /api/dies/{die_id} (admin-only)
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

@pytest.fixture(scope="module")
def admin_session():
    """Login as admin and return session with cookies"""
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    response = session.post(f"{BASE_URL}/api/auth/login", json={
        "email": "info@smartshape.in",
        "password": "admin123"
    })
    assert response.status_code == 200, f"Admin login failed: {response.text}"
    return session

@pytest.fixture(scope="module")
def test_die(admin_session):
    """Create a test die for archive/delete tests"""
    unique_code = f"TEST_DIE_{uuid.uuid4().hex[:6].upper()}"
    response = admin_session.post(f"{BASE_URL}/api/dies", json={
        "code": unique_code,
        "name": f"Test Die {unique_code}",
        "type": "standard",
        "min_level": 5,
        "description": "Test die for archive/delete testing"
    })
    assert response.status_code == 200, f"Failed to create test die: {response.text}"
    die = response.json()
    yield die
    # Cleanup - try to delete the die after tests
    try:
        admin_session.delete(f"{BASE_URL}/api/dies/{die['die_id']}")
    except:
        pass


class TestGetDiesWithArchived:
    """Test GET /api/dies with include_archived parameter"""
    
    def test_get_dies_default_excludes_archived(self, admin_session):
        """Default GET /api/dies should exclude archived items"""
        response = admin_session.get(f"{BASE_URL}/api/dies")
        assert response.status_code == 200
        dies = response.json()
        assert isinstance(dies, list)
        # All returned dies should be active (is_active != False)
        for die in dies:
            assert die.get("is_active") != False, f"Found archived die in default list: {die['code']}"
        print(f"✓ GET /api/dies returns {len(dies)} active dies (excludes archived)")
    
    def test_get_dies_with_include_archived(self, admin_session):
        """GET /api/dies?include_archived=true should include all items"""
        response = admin_session.get(f"{BASE_URL}/api/dies", params={"include_archived": True})
        assert response.status_code == 200
        dies = response.json()
        assert isinstance(dies, list)
        print(f"✓ GET /api/dies?include_archived=true returns {len(dies)} total dies")


class TestArchiveDie:
    """Test PUT /api/dies/{die_id}/archive endpoint"""
    
    def test_archive_die_success(self, admin_session, test_die):
        """Admin can archive a die"""
        die_id = test_die["die_id"]
        
        # Archive the die
        response = admin_session.put(f"{BASE_URL}/api/dies/{die_id}/archive")
        assert response.status_code == 200
        updated_die = response.json()
        assert updated_die["is_active"] == False, "Die should be archived (is_active=False)"
        print(f"✓ Die {die_id} archived successfully")
        
        # Verify it's excluded from default list
        list_response = admin_session.get(f"{BASE_URL}/api/dies")
        assert list_response.status_code == 200
        dies = list_response.json()
        die_ids = [d["die_id"] for d in dies]
        assert die_id not in die_ids, "Archived die should not appear in default list"
        print(f"✓ Archived die excluded from default GET /api/dies")
        
        # Verify it appears when include_archived=true
        archived_response = admin_session.get(f"{BASE_URL}/api/dies", params={"include_archived": True})
        assert archived_response.status_code == 200
        all_dies = archived_response.json()
        all_die_ids = [d["die_id"] for d in all_dies]
        assert die_id in all_die_ids, "Archived die should appear with include_archived=true"
        print(f"✓ Archived die appears with include_archived=true")
    
    def test_restore_die_success(self, admin_session, test_die):
        """Admin can restore (un-archive) a die"""
        die_id = test_die["die_id"]
        
        # Restore the die (toggle archive again)
        response = admin_session.put(f"{BASE_URL}/api/dies/{die_id}/archive")
        assert response.status_code == 200
        updated_die = response.json()
        assert updated_die["is_active"] == True, "Die should be restored (is_active=True)"
        print(f"✓ Die {die_id} restored successfully")
    
    def test_archive_nonexistent_die(self, admin_session):
        """Archiving non-existent die returns 404"""
        response = admin_session.put(f"{BASE_URL}/api/dies/nonexistent_die_id/archive")
        assert response.status_code == 404
        print(f"✓ Archive non-existent die returns 404")


class TestDeleteDie:
    """Test DELETE /api/dies/{die_id} endpoint (admin-only)"""
    
    def test_admin_can_delete_die(self, admin_session):
        """Admin can permanently delete a die"""
        # Create a die specifically for deletion
        unique_code = f"TEST_DEL_{uuid.uuid4().hex[:6].upper()}"
        create_response = admin_session.post(f"{BASE_URL}/api/dies", json={
            "code": unique_code,
            "name": f"Delete Test Die {unique_code}",
            "type": "standard",
            "min_level": 5
        })
        assert create_response.status_code == 200
        die = create_response.json()
        die_id = die["die_id"]
        print(f"✓ Created test die {die_id} for deletion")
        
        # Delete the die
        delete_response = admin_session.delete(f"{BASE_URL}/api/dies/{die_id}")
        assert delete_response.status_code == 200
        result = delete_response.json()
        assert "deleted" in result.get("message", "").lower() or "success" in result.get("message", "").lower()
        print(f"✓ Admin deleted die {die_id} successfully")
        
        # Verify die no longer exists
        get_response = admin_session.get(f"{BASE_URL}/api/dies", params={"include_archived": True})
        assert get_response.status_code == 200
        all_dies = get_response.json()
        die_ids = [d["die_id"] for d in all_dies]
        assert die_id not in die_ids, "Deleted die should not exist"
        print(f"✓ Deleted die no longer in database")
    
    def test_delete_nonexistent_die(self, admin_session):
        """Deleting non-existent die returns 404"""
        response = admin_session.delete(f"{BASE_URL}/api/dies/nonexistent_die_id")
        assert response.status_code == 404
        print(f"✓ Delete non-existent die returns 404")


class TestNonAdminDeleteRestriction:
    """Test that non-admin users cannot delete dies"""
    
    def test_non_admin_cannot_delete(self, admin_session):
        """Non-admin user should get 403 when trying to delete"""
        # First, create a sales person user if not exists
        # For this test, we'll try to login as a non-admin user
        # If no sales user exists, we'll skip this test
        
        sales_session = requests.Session()
        sales_session.headers.update({"Content-Type": "application/json"})
        
        # Try to login as a sales person (from test credentials)
        login_response = sales_session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "rajesh@smartshape.com",
            "password": "password123"  # Common test password
        })
        
        if login_response.status_code != 200:
            # Try registering a test sales user
            register_response = sales_session.post(f"{BASE_URL}/api/auth/register", json={
                "email": "test_sales@smartshape.com",
                "password": "testpass123",
                "name": "Test Sales User"
            })
            if register_response.status_code == 200:
                login_response = sales_session.post(f"{BASE_URL}/api/auth/login", json={
                    "email": "test_sales@smartshape.com",
                    "password": "testpass123"
                })
        
        if login_response.status_code != 200:
            pytest.skip("No non-admin user available for testing")
        
        user_data = login_response.json()
        if user_data.get("role") == "admin":
            pytest.skip("Logged in user is admin, cannot test non-admin restriction")
        
        print(f"✓ Logged in as non-admin user: {user_data.get('email')}")
        
        # Create a die as admin to try deleting as non-admin
        unique_code = f"TEST_NONADMIN_{uuid.uuid4().hex[:6].upper()}"
        create_response = admin_session.post(f"{BASE_URL}/api/dies", json={
            "code": unique_code,
            "name": f"Non-Admin Delete Test {unique_code}",
            "type": "standard",
            "min_level": 5
        })
        assert create_response.status_code == 200
        die = create_response.json()
        die_id = die["die_id"]
        
        # Try to delete as non-admin
        delete_response = sales_session.delete(f"{BASE_URL}/api/dies/{die_id}")
        assert delete_response.status_code == 403, f"Expected 403, got {delete_response.status_code}"
        print(f"✓ Non-admin user correctly gets 403 when trying to delete")
        
        # Cleanup - delete as admin
        admin_session.delete(f"{BASE_URL}/api/dies/{die_id}")


class TestLeaveManagementAccess:
    """Test Leave Management endpoint accessibility"""
    
    def test_leave_management_endpoint_exists(self, admin_session):
        """Leave management endpoint should be accessible"""
        response = admin_session.get(f"{BASE_URL}/api/leaves")
        assert response.status_code == 200
        print(f"✓ GET /api/leaves accessible")
    
    def test_leave_balance_endpoint(self, admin_session):
        """Leave balance endpoint should work"""
        response = admin_session.get(f"{BASE_URL}/api/leaves/balance", params={"email": "info@smartshape.in"})
        # Should return 200 or 404 if no balance record
        assert response.status_code in [200, 404]
        print(f"✓ GET /api/leaves/balance returns {response.status_code}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
