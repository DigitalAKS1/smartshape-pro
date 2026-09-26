"""
Backend tests for User Management, Module Master, and Role-based Access
Tests the new features: admin user CRUD, module management, and token refresh
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
ADMIN_EMAIL = "admin@smartshape.com"
ADMIN_PASSWORD = "admin123"
STORE_EMAIL = "store@smartshape.com"
STORE_PASSWORD = "store123"
SALES_EMAIL = "test_sales@smartshape.com"
SALES_PASSWORD = "test123"


class TestAuthAndRefresh:
    """Test authentication and token refresh endpoints"""
    
    def test_admin_login_success(self):
        """Admin login should return user data with all modules"""
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        assert data["email"] == ADMIN_EMAIL
        assert data["role"] == "admin"
        assert "assigned_modules" in data
        assert len(data["assigned_modules"]) > 0
        print(f"✓ Admin login successful, has {len(data['assigned_modules'])} modules")
    
    def test_store_user_login_success(self):
        """Store user login should return user with limited modules"""
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": STORE_EMAIL,
            "password": STORE_PASSWORD
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        assert data["email"] == STORE_EMAIL
        assert "inventory" in data.get("assigned_modules", [])
        print(f"✓ Store user login successful, modules: {data.get('assigned_modules', [])}")
    
    def test_sales_user_login_success(self):
        """Sales user login should return user with sales_portal module"""
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": SALES_EMAIL,
            "password": SALES_PASSWORD
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        assert data["email"] == SALES_EMAIL
        assert "sales_portal" in data.get("assigned_modules", [])
        print(f"✓ Sales user login successful, modules: {data.get('assigned_modules', [])}")
    
    def test_token_refresh_endpoint(self):
        """Token refresh should work after login"""
        session = requests.Session()
        # First login
        login_resp = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        assert login_resp.status_code == 200
        
        # Then refresh
        refresh_resp = session.post(f"{BASE_URL}/api/auth/refresh")
        assert refresh_resp.status_code == 200, f"Refresh failed: {refresh_resp.text}"
        data = refresh_resp.json()
        assert data["email"] == ADMIN_EMAIL
        print("✓ Token refresh successful")
    
    def test_invalid_login_credentials(self):
        """Invalid credentials should return 401"""
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "invalid@test.com",
            "password": "wrongpassword"
        })
        assert response.status_code == 401
        print("✓ Invalid login correctly rejected")


class TestModuleManagement:
    """Test module CRUD endpoints"""
    
    @pytest.fixture
    def admin_session(self):
        session = requests.Session()
        resp = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        assert resp.status_code == 200
        return session
    
    def test_get_all_modules(self, admin_session):
        """Should return all modules"""
        response = admin_session.get(f"{BASE_URL}/api/modules")
        assert response.status_code == 200
        modules = response.json()
        assert isinstance(modules, list)
        assert len(modules) >= 10  # Should have at least 10 modules
        
        # Verify module structure
        for mod in modules:
            assert "module_id" in mod
            assert "name" in mod
            assert "display_name" in mod
            assert "is_active" in mod
        print(f"✓ Retrieved {len(modules)} modules")
    
    def test_update_module_toggle(self, admin_session):
        """Admin should be able to toggle module active status"""
        # Get modules first
        modules_resp = admin_session.get(f"{BASE_URL}/api/modules")
        modules = modules_resp.json()
        
        # Find a non-critical module to toggle (e.g., analytics)
        test_module = next((m for m in modules if m["name"] == "analytics"), None)
        if not test_module:
            pytest.skip("Analytics module not found")
        
        original_status = test_module["is_active"]
        
        # Toggle it
        update_resp = admin_session.put(
            f"{BASE_URL}/api/modules/{test_module['module_id']}",
            json={"is_active": not original_status}
        )
        assert update_resp.status_code == 200
        
        # Verify change
        updated = update_resp.json()
        assert updated["is_active"] == (not original_status)
        
        # Restore original status
        admin_session.put(
            f"{BASE_URL}/api/modules/{test_module['module_id']}",
            json={"is_active": original_status}
        )
        print("✓ Module toggle works correctly")
    
    def test_non_admin_cannot_update_module(self):
        """Non-admin users should not be able to update modules"""
        session = requests.Session()
        session.post(f"{BASE_URL}/api/auth/login", json={
            "email": STORE_EMAIL,
            "password": STORE_PASSWORD
        })
        
        response = session.put(
            f"{BASE_URL}/api/modules/mod_analytics",
            json={"is_active": False}
        )
        assert response.status_code == 403
        print("✓ Non-admin correctly blocked from updating modules")


class TestAdminUserManagement:
    """Test admin user CRUD endpoints"""
    
    @pytest.fixture
    def admin_session(self):
        session = requests.Session()
        resp = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        assert resp.status_code == 200
        return session
    
    def test_get_all_users(self, admin_session):
        """Admin should be able to get all users"""
        response = admin_session.get(f"{BASE_URL}/api/admin/users")
        assert response.status_code == 200
        users = response.json()
        assert isinstance(users, list)
        assert len(users) >= 1  # At least admin user
        
        # Verify user structure (no password_hash)
        for user in users:
            assert "user_id" in user
            assert "email" in user
            assert "password_hash" not in user
        print(f"✓ Retrieved {len(users)} users")
    
    def test_create_user_with_modules(self, admin_session):
        """Admin should be able to create a user with specific modules"""
        test_email = f"TEST_user_{uuid.uuid4().hex[:8]}@test.com"
        
        create_resp = admin_session.post(f"{BASE_URL}/api/admin/users", json={
            "email": test_email,
            "password": "testpass123",
            "name": "TEST User",
            "role": "sales_person",
            "phone": "+91-1234567890",
            "assigned_modules": ["inventory", "quotations"]
        })
        assert create_resp.status_code == 200, f"Create failed: {create_resp.text}"
        
        created_user = create_resp.json()
        assert created_user["email"] == test_email.lower()  # Email is lowercased by backend
        assert created_user["name"] == "TEST User"
        assert "inventory" in created_user.get("assigned_modules", [])
        assert "quotations" in created_user.get("assigned_modules", [])
        
        # Cleanup - delete the test user
        admin_session.delete(f"{BASE_URL}/api/admin/users/{created_user['user_id']}")
        print("✓ User creation with modules works")
    
    def test_update_user_modules(self, admin_session):
        """Admin should be able to update user's assigned modules"""
        # Create a test user first
        test_email = f"TEST_update_{uuid.uuid4().hex[:8]}@test.com"
        create_resp = admin_session.post(f"{BASE_URL}/api/admin/users", json={
            "email": test_email,
            "password": "testpass123",
            "name": "TEST Update User",
            "role": "sales_person",
            "assigned_modules": ["inventory"]
        })
        assert create_resp.status_code == 200
        user_id = create_resp.json()["user_id"]
        
        # Update modules
        update_resp = admin_session.put(f"{BASE_URL}/api/admin/users/{user_id}", json={
            "assigned_modules": ["inventory", "quotations", "analytics"]
        })
        assert update_resp.status_code == 200
        
        updated_user = update_resp.json()
        assert len(updated_user.get("assigned_modules", [])) == 3
        
        # Cleanup
        admin_session.delete(f"{BASE_URL}/api/admin/users/{user_id}")
        print("✓ User module update works")
    
    def test_delete_user(self, admin_session):
        """Admin should be able to delete a user"""
        # Create a test user first
        test_email = f"TEST_delete_{uuid.uuid4().hex[:8]}@test.com"
        create_resp = admin_session.post(f"{BASE_URL}/api/admin/users", json={
            "email": test_email,
            "password": "testpass123",
            "name": "TEST Delete User",
            "role": "sales_person"
        })
        assert create_resp.status_code == 200
        user_id = create_resp.json()["user_id"]
        
        # Delete the user
        delete_resp = admin_session.delete(f"{BASE_URL}/api/admin/users/{user_id}")
        assert delete_resp.status_code == 200
        
        # Verify deletion
        users_resp = admin_session.get(f"{BASE_URL}/api/admin/users")
        users = users_resp.json()
        assert not any(u["user_id"] == user_id for u in users)
        print("✓ User deletion works")
    
    def test_cannot_delete_self(self, admin_session):
        """Admin should not be able to delete their own account"""
        # Get admin user_id
        me_resp = admin_session.get(f"{BASE_URL}/api/auth/me")
        admin_user_id = me_resp.json()["user_id"]
        
        # Try to delete self
        delete_resp = admin_session.delete(f"{BASE_URL}/api/admin/users/{admin_user_id}")
        assert delete_resp.status_code == 400
        print("✓ Self-deletion correctly blocked")
    
    def test_duplicate_email_rejected(self, admin_session):
        """Creating user with existing email should fail"""
        response = admin_session.post(f"{BASE_URL}/api/admin/users", json={
            "email": ADMIN_EMAIL,  # Already exists
            "password": "testpass123",
            "name": "Duplicate User"
        })
        assert response.status_code == 400
        print("✓ Duplicate email correctly rejected")
    
    def test_non_admin_cannot_access_user_management(self):
        """Non-admin users should not access user management"""
        session = requests.Session()
        session.post(f"{BASE_URL}/api/auth/login", json={
            "email": STORE_EMAIL,
            "password": STORE_PASSWORD
        })
        
        response = session.get(f"{BASE_URL}/api/admin/users")
        assert response.status_code == 403
        print("✓ Non-admin correctly blocked from user management")


class TestDashboardAndAnalytics:
    """Test that dashboard and analytics work without 401 errors"""
    
    @pytest.fixture
    def admin_session(self):
        session = requests.Session()
        resp = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        assert resp.status_code == 200
        return session
    
    def test_dashboard_no_401(self, admin_session):
        """Dashboard endpoint should work without 401"""
        response = admin_session.get(f"{BASE_URL}/api/analytics/dashboard")
        assert response.status_code == 200, f"Dashboard failed: {response.text}"
        data = response.json()
        assert "total_dies" in data
        print("✓ Dashboard works without 401")
    
    def test_analytics_charts_no_401(self, admin_session):
        """Analytics charts endpoint should work without 401"""
        response = admin_session.get(f"{BASE_URL}/api/analytics/charts")
        assert response.status_code == 200, f"Charts failed: {response.text}"
        print("✓ Analytics charts work without 401")
    
    def test_quotations_no_401(self, admin_session):
        """Quotations endpoint should work without 401"""
        response = admin_session.get(f"{BASE_URL}/api/quotations")
        assert response.status_code == 200, f"Quotations failed: {response.text}"
        print("✓ Quotations work without 401")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
