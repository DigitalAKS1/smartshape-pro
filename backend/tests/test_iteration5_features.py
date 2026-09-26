"""
Test Suite for Iteration 5 Features:
1. New admin email (info@smartshape.in / admin123)
2. DME user (dme@pfcpl24.in / admin@123) with specific modules
3. New modules: accounts, hr, store
4. User-salesperson auto-linking
5. Module-based access control
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestAdminLogin:
    """Test new admin credentials (info@smartshape.in)"""
    
    def test_admin_login_success(self):
        """Admin login with info@smartshape.in / admin123"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "info@smartshape.in",
            "password": "admin123"
        })
        assert response.status_code == 200, f"Admin login failed: {response.text}"
        data = response.json()
        assert data["email"] == "info@smartshape.in"
        assert data["role"] == "admin"
        # Admin should have all modules
        assert "assigned_modules" in data
        assert len(data["assigned_modules"]) >= 10, f"Admin should have many modules, got {len(data.get('assigned_modules', []))}"
        print(f"✓ Admin login successful: {data['email']}, modules: {len(data['assigned_modules'])}")
        return response.cookies
    
    def test_admin_has_all_modules(self):
        """Verify admin has all 15 modules including new ones"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "info@smartshape.in",
            "password": "admin123"
        })
        assert response.status_code == 200
        data = response.json()
        modules = data.get("assigned_modules", [])
        
        # Check for new modules
        assert "accounts" in modules, "Admin missing 'accounts' module"
        assert "hr" in modules, "Admin missing 'hr' module"
        assert "store" in modules, "Admin missing 'store' module"
        print(f"✓ Admin has new modules: accounts, hr, store")


class TestDMEUserLogin:
    """Test DME user credentials (dme@pfcpl24.in)"""
    
    def test_dme_login_success(self):
        """DME user login with dme@pfcpl24.in / admin@123"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "dme@pfcpl24.in",
            "password": "admin@123"
        })
        assert response.status_code == 200, f"DME login failed: {response.text}"
        data = response.json()
        assert data["email"] == "dme@pfcpl24.in"
        print(f"✓ DME login successful: {data['email']}")
        return response.cookies
    
    def test_dme_has_correct_modules(self):
        """Verify DME user has exactly the assigned modules"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "dme@pfcpl24.in",
            "password": "admin@123"
        })
        assert response.status_code == 200
        data = response.json()
        modules = data.get("assigned_modules", [])
        
        expected_modules = ["accounts", "hr", "store", "inventory", "stock_management", 
                          "purchase_alerts", "physical_count", "payroll"]
        
        for mod in expected_modules:
            assert mod in modules, f"DME missing expected module: {mod}"
        
        # DME should NOT have dashboard, quotations, settings, user_management
        assert "dashboard" not in modules, "DME should NOT have dashboard"
        assert "quotations" not in modules, "DME should NOT have quotations"
        assert "settings" not in modules, "DME should NOT have settings"
        assert "user_management" not in modules, "DME should NOT have user_management"
        
        print(f"✓ DME has correct modules: {modules}")


class TestModulesAPI:
    """Test /api/modules endpoint"""
    
    @pytest.fixture
    def admin_cookies(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "info@smartshape.in",
            "password": "admin123"
        })
        return response.cookies
    
    def test_get_all_modules(self, admin_cookies):
        """GET /api/modules returns all 15 modules including accounts, hr, store"""
        response = requests.get(f"{BASE_URL}/api/modules", cookies=admin_cookies)
        assert response.status_code == 200, f"Failed to get modules: {response.text}"
        modules = response.json()
        
        module_names = [m["name"] for m in modules]
        
        # Check for new modules
        assert "accounts" in module_names, "Missing 'accounts' module"
        assert "hr" in module_names, "Missing 'hr' module"
        assert "store" in module_names, "Missing 'store' module"
        
        # Should have at least 15 modules
        assert len(modules) >= 15, f"Expected at least 15 modules, got {len(modules)}"
        
        print(f"✓ Found {len(modules)} modules including accounts, hr, store")


class TestUserSalespersonLinking:
    """Test user-salesperson auto-linking"""
    
    @pytest.fixture
    def admin_session(self):
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "info@smartshape.in",
            "password": "admin123"
        })
        assert response.status_code == 200
        return session
    
    def test_create_user_creates_salesperson(self, admin_session):
        """POST /api/admin/users creates user AND salesperson record"""
        import uuid
        test_email = f"test_sp_{uuid.uuid4().hex[:8]}@test.com"
        
        # Create user
        response = admin_session.post(f"{BASE_URL}/api/admin/users", json={
            "email": test_email,
            "password": "test123",
            "name": "Test Salesperson",
            "phone": "+91-9999999999",
            "role": "sales_person",
            "assigned_modules": ["sales_portal"]
        })
        assert response.status_code == 200, f"Failed to create user: {response.text}"
        user_data = response.json()
        user_id = user_data["user_id"]
        
        # Verify salesperson was created
        sp_response = admin_session.get(f"{BASE_URL}/api/salespersons")
        assert sp_response.status_code == 200
        salespersons = sp_response.json()
        
        sp_emails = [sp["email"] for sp in salespersons]
        assert test_email in sp_emails, f"Salesperson not created for user {test_email}"
        
        # Find the salesperson and verify linking
        sp = next((s for s in salespersons if s["email"] == test_email), None)
        assert sp is not None
        assert sp["name"] == "Test Salesperson"
        assert sp["user_id"] == user_id, "Salesperson not linked to user"
        
        print(f"✓ User creation auto-created linked salesperson: {test_email}")
        
        # Cleanup
        admin_session.delete(f"{BASE_URL}/api/admin/users/{user_id}")
    
    def test_update_user_syncs_salesperson(self, admin_session):
        """PUT /api/admin/users/{id} syncs salesperson name/phone"""
        import uuid
        test_email = f"test_sync_{uuid.uuid4().hex[:8]}@test.com"
        
        # Create user
        response = admin_session.post(f"{BASE_URL}/api/admin/users", json={
            "email": test_email,
            "password": "test123",
            "name": "Original Name",
            "phone": "+91-1111111111",
            "role": "sales_person",
            "assigned_modules": ["sales_portal"]
        })
        assert response.status_code == 200
        user_id = response.json()["user_id"]
        
        # Update user
        update_response = admin_session.put(f"{BASE_URL}/api/admin/users/{user_id}", json={
            "name": "Updated Name",
            "phone": "+91-2222222222"
        })
        assert update_response.status_code == 200
        
        # Verify salesperson was synced
        sp_response = admin_session.get(f"{BASE_URL}/api/salespersons")
        salespersons = sp_response.json()
        sp = next((s for s in salespersons if s["email"] == test_email), None)
        
        assert sp is not None
        assert sp["name"] == "Updated Name", f"Salesperson name not synced: {sp['name']}"
        assert sp["phone"] == "+91-2222222222", f"Salesperson phone not synced: {sp['phone']}"
        
        print(f"✓ User update synced to salesperson: {test_email}")
        
        # Cleanup
        admin_session.delete(f"{BASE_URL}/api/admin/users/{user_id}")
    
    def test_get_salespersons_returns_linked_users(self, admin_session):
        """GET /api/salespersons returns all active users as salespersons"""
        response = admin_session.get(f"{BASE_URL}/api/salespersons")
        assert response.status_code == 200
        salespersons = response.json()
        
        # Should have at least the seeded users
        assert len(salespersons) >= 3, f"Expected at least 3 salespersons, got {len(salespersons)}"
        
        # Check that admin and DME user are in salespersons
        sp_emails = [sp["email"] for sp in salespersons]
        assert "info@smartshape.in" in sp_emails, "Admin not in salespersons"
        assert "dme@pfcpl24.in" in sp_emails, "DME user not in salespersons"
        
        print(f"✓ Found {len(salespersons)} salespersons including admin and DME user")


class TestNewModulePages:
    """Test API access for new module pages (accounts, hr, store)"""
    
    @pytest.fixture
    def admin_session(self):
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "info@smartshape.in",
            "password": "admin123"
        })
        assert response.status_code == 200
        return session
    
    @pytest.fixture
    def dme_session(self):
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "dme@pfcpl24.in",
            "password": "admin@123"
        })
        assert response.status_code == 200
        return session
    
    def test_accounts_page_apis(self, admin_session):
        """Accounts page APIs work (quotations, reimbursements)"""
        # Quotations API
        quot_response = admin_session.get(f"{BASE_URL}/api/quotations")
        assert quot_response.status_code == 200, f"Quotations API failed: {quot_response.text}"
        
        # Reimbursements API
        reimb_response = admin_session.get(f"{BASE_URL}/api/payroll/reimbursements")
        assert reimb_response.status_code == 200, f"Reimbursements API failed: {reimb_response.text}"
        
        print("✓ Accounts page APIs working")
    
    def test_hr_page_apis(self, admin_session):
        """HR page APIs work (users, attendance)"""
        # Users API
        users_response = admin_session.get(f"{BASE_URL}/api/admin/users")
        assert users_response.status_code == 200, f"Users API failed: {users_response.text}"
        
        # Attendance API (admin)
        att_response = admin_session.get(f"{BASE_URL}/api/admin/attendance")
        assert att_response.status_code == 200, f"Attendance API failed: {att_response.text}"
        
        print("✓ HR page APIs working")
    
    def test_store_page_apis(self, admin_session):
        """Store page APIs work (dies, movements, alerts)"""
        # Dies API
        dies_response = admin_session.get(f"{BASE_URL}/api/dies")
        assert dies_response.status_code == 200, f"Dies API failed: {dies_response.text}"
        
        # Stock movements API
        mov_response = admin_session.get(f"{BASE_URL}/api/stock/movements")
        assert mov_response.status_code == 200, f"Stock movements API failed: {mov_response.text}"
        
        # Purchase alerts API
        alerts_response = admin_session.get(f"{BASE_URL}/api/purchase-alerts")
        assert alerts_response.status_code == 200, f"Purchase alerts API failed: {alerts_response.text}"
        
        print("✓ Store page APIs working")
    
    def test_dme_can_access_hr_attendance(self, dme_session):
        """DME user with hr module can access admin attendance"""
        response = dme_session.get(f"{BASE_URL}/api/admin/attendance")
        assert response.status_code == 200, f"DME cannot access HR attendance: {response.text}"
        print("✓ DME user can access HR attendance API")


class TestAccessControl:
    """Test module-based access control"""
    
    @pytest.fixture
    def dme_session(self):
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "dme@pfcpl24.in",
            "password": "admin@123"
        })
        assert response.status_code == 200
        return session
    
    def test_dme_cannot_access_user_management(self, dme_session):
        """DME user without user_management module cannot access admin users"""
        response = dme_session.get(f"{BASE_URL}/api/admin/users")
        assert response.status_code == 403, f"DME should not access user management, got {response.status_code}"
        print("✓ DME correctly denied access to user management")
    
    def test_dme_cannot_create_users(self, dme_session):
        """DME user cannot create users"""
        response = dme_session.post(f"{BASE_URL}/api/admin/users", json={
            "email": "hacker@test.com",
            "password": "test123",
            "name": "Hacker"
        })
        assert response.status_code == 403, f"DME should not create users, got {response.status_code}"
        print("✓ DME correctly denied user creation")
    
    def test_dme_can_access_inventory(self, dme_session):
        """DME user with inventory module can access dies"""
        response = dme_session.get(f"{BASE_URL}/api/dies")
        assert response.status_code == 200, f"DME should access inventory: {response.text}"
        print("✓ DME can access inventory (dies)")
    
    def test_dme_can_access_payroll(self, dme_session):
        """DME user with payroll module can access reimbursements"""
        response = dme_session.get(f"{BASE_URL}/api/payroll/reimbursements")
        assert response.status_code == 200, f"DME should access payroll: {response.text}"
        print("✓ DME can access payroll (reimbursements)")


class TestQuotationSalespersonDropdown:
    """Test that quotation creation shows linked salespersons"""
    
    @pytest.fixture
    def admin_session(self):
        session = requests.Session()
        response = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "info@smartshape.in",
            "password": "admin123"
        })
        assert response.status_code == 200
        return session
    
    def test_salespersons_available_for_quotation(self, admin_session):
        """Salespersons endpoint returns data for quotation dropdown"""
        response = admin_session.get(f"{BASE_URL}/api/salespersons")
        assert response.status_code == 200
        salespersons = response.json()
        
        # Should have salespersons with required fields
        assert len(salespersons) > 0, "No salespersons available"
        
        for sp in salespersons:
            assert "sales_person_id" in sp, "Missing sales_person_id"
            assert "name" in sp, "Missing name"
            assert "email" in sp, "Missing email"
        
        print(f"✓ {len(salespersons)} salespersons available for quotation dropdown")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
