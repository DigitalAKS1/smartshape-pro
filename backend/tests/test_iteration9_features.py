"""
Iteration 9 Tests: Quotation Permissions, Conversion Tracking, Auto-Reminders, Notifications
- Sales user can create/edit quotations
- Sales user CANNOT delete quotations (403)
- Accounts user CAN delete quotations
- Admin CAN delete quotations
- Conversion analytics API returns pipeline, conversion_rate, salesperson_conversion
- Notifications API returns notifications array
- Mark all notifications as read
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials from test_credentials.md
ADMIN_CREDS = {"email": "info@smartshape.in", "password": "admin123"}
SALES_CREDS = {"email": "sales@smartshape.in", "password": "demo@123"}
ACCOUNTS_CREDS = {"email": "accounts@smartshape.in", "password": "demo@123"}


class TestQuotationPermissions:
    """Test quotation CRUD permissions for different user roles"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup sessions for different users"""
        self.admin_session = requests.Session()
        self.sales_session = requests.Session()
        self.accounts_session = requests.Session()
        
        # Login as admin
        resp = self.admin_session.post(f"{BASE_URL}/api/auth/login", json=ADMIN_CREDS)
        assert resp.status_code == 200, f"Admin login failed: {resp.text}"
        
        # Login as sales
        resp = self.sales_session.post(f"{BASE_URL}/api/auth/login", json=SALES_CREDS)
        assert resp.status_code == 200, f"Sales login failed: {resp.text}"
        
        # Login as accounts
        resp = self.accounts_session.post(f"{BASE_URL}/api/auth/login", json=ACCOUNTS_CREDS)
        assert resp.status_code == 200, f"Accounts login failed: {resp.text}"
        
        yield
        
        # Cleanup
        self.admin_session.close()
        self.sales_session.close()
        self.accounts_session.close()
    
    def test_sales_can_create_quotation(self):
        """Sales user can create a quotation via POST /api/quotations"""
        # First get a package and salesperson
        packages_resp = self.sales_session.get(f"{BASE_URL}/api/packages")
        assert packages_resp.status_code == 200
        packages = packages_resp.json()
        
        sp_resp = self.sales_session.get(f"{BASE_URL}/api/salespersons")
        assert sp_resp.status_code == 200
        salespersons = sp_resp.json()
        
        if not packages or not salespersons:
            pytest.skip("No packages or salespersons available for testing")
        
        quotation_data = {
            "package_id": packages[0]["package_id"],
            "principal_name": "TEST_Principal",
            "school_name": "TEST_School_Sales_Create",
            "address": "123 Test Street",
            "customer_email": "test@school.com",
            "customer_phone": "9876543210",
            "sales_person_id": salespersons[0]["sales_person_id"],
            "discount1_pct": 5,
            "discount2_pct": 0,
            "freight_amount": 500,
            "lines": [
                {
                    "description": "Test Item",
                    "product_type": "standard_die",
                    "qty": 10,
                    "unit_price": 100,
                    "gst_pct": 18,
                    "line_subtotal": 1000,
                    "line_gst": 180,
                    "line_total": 1180,
                    "sort_order": 1
                }
            ]
        }
        
        resp = self.sales_session.post(f"{BASE_URL}/api/quotations", json=quotation_data)
        assert resp.status_code == 200, f"Sales user should be able to create quotation: {resp.text}"
        
        data = resp.json()
        assert "quotation_id" in data
        assert "quote_number" in data
        assert data["school_name"] == "TEST_School_Sales_Create"
        
        # Store for cleanup
        self.created_quotation_id = data["quotation_id"]
        print(f"Sales user created quotation: {data['quote_number']}")
        
        # Cleanup - admin deletes
        self.admin_session.delete(f"{BASE_URL}/api/quotations/{self.created_quotation_id}")
    
    def test_sales_can_edit_quotation(self):
        """Sales user can edit quotation via PUT /api/quotations/{id}"""
        # First create a quotation as admin
        packages_resp = self.admin_session.get(f"{BASE_URL}/api/packages")
        packages = packages_resp.json()
        sp_resp = self.admin_session.get(f"{BASE_URL}/api/salespersons")
        salespersons = sp_resp.json()
        
        if not packages or not salespersons:
            pytest.skip("No packages or salespersons available")
        
        quotation_data = {
            "package_id": packages[0]["package_id"],
            "principal_name": "TEST_Principal_Edit",
            "school_name": "TEST_School_Edit",
            "address": "456 Edit Street",
            "customer_email": "edit@school.com",
            "customer_phone": "9876543211",
            "sales_person_id": salespersons[0]["sales_person_id"],
            "discount1_pct": 0,
            "discount2_pct": 0,
            "freight_amount": 0,
            "lines": []
        }
        
        create_resp = self.admin_session.post(f"{BASE_URL}/api/quotations", json=quotation_data)
        assert create_resp.status_code == 200
        quotation_id = create_resp.json()["quotation_id"]
        
        # Sales user edits the quotation
        edit_data = {
            "school_name": "TEST_School_Edited_By_Sales",
            "discount1_pct": 10
        }
        
        edit_resp = self.sales_session.put(f"{BASE_URL}/api/quotations/{quotation_id}", json=edit_data)
        assert edit_resp.status_code == 200, f"Sales user should be able to edit quotation: {edit_resp.text}"
        
        edited = edit_resp.json()
        assert edited["school_name"] == "TEST_School_Edited_By_Sales"
        assert edited["discount1_pct"] == 10
        print(f"Sales user edited quotation: {edited['quote_number']}")
        
        # Cleanup
        self.admin_session.delete(f"{BASE_URL}/api/quotations/{quotation_id}")
    
    def test_sales_cannot_delete_quotation(self):
        """Sales user CANNOT delete quotation (should get 403)"""
        # Create a quotation as admin
        packages_resp = self.admin_session.get(f"{BASE_URL}/api/packages")
        packages = packages_resp.json()
        sp_resp = self.admin_session.get(f"{BASE_URL}/api/salespersons")
        salespersons = sp_resp.json()
        
        if not packages or not salespersons:
            pytest.skip("No packages or salespersons available")
        
        quotation_data = {
            "package_id": packages[0]["package_id"],
            "principal_name": "TEST_Principal_NoDelete",
            "school_name": "TEST_School_NoDelete",
            "address": "789 NoDelete Street",
            "customer_email": "nodelete@school.com",
            "customer_phone": "9876543212",
            "sales_person_id": salespersons[0]["sales_person_id"],
            "discount1_pct": 0,
            "discount2_pct": 0,
            "freight_amount": 0,
            "lines": []
        }
        
        create_resp = self.admin_session.post(f"{BASE_URL}/api/quotations", json=quotation_data)
        assert create_resp.status_code == 200
        quotation_id = create_resp.json()["quotation_id"]
        
        # Sales user tries to delete - should fail with 403
        delete_resp = self.sales_session.delete(f"{BASE_URL}/api/quotations/{quotation_id}")
        assert delete_resp.status_code == 403, f"Sales user should NOT be able to delete quotation, got {delete_resp.status_code}: {delete_resp.text}"
        
        error_data = delete_resp.json()
        assert "detail" in error_data
        assert "accounts" in error_data["detail"].lower() or "delete" in error_data["detail"].lower()
        print(f"Sales user correctly denied delete: {error_data['detail']}")
        
        # Cleanup - admin deletes
        self.admin_session.delete(f"{BASE_URL}/api/quotations/{quotation_id}")
    
    def test_accounts_can_delete_quotation(self):
        """Accounts user CAN delete quotation (should get 200)"""
        # Create a quotation as admin
        packages_resp = self.admin_session.get(f"{BASE_URL}/api/packages")
        packages = packages_resp.json()
        sp_resp = self.admin_session.get(f"{BASE_URL}/api/salespersons")
        salespersons = sp_resp.json()
        
        if not packages or not salespersons:
            pytest.skip("No packages or salespersons available")
        
        quotation_data = {
            "package_id": packages[0]["package_id"],
            "principal_name": "TEST_Principal_AccountsDelete",
            "school_name": "TEST_School_AccountsDelete",
            "address": "101 AccountsDelete Street",
            "customer_email": "accountsdelete@school.com",
            "customer_phone": "9876543213",
            "sales_person_id": salespersons[0]["sales_person_id"],
            "discount1_pct": 0,
            "discount2_pct": 0,
            "freight_amount": 0,
            "lines": []
        }
        
        create_resp = self.admin_session.post(f"{BASE_URL}/api/quotations", json=quotation_data)
        assert create_resp.status_code == 200
        quotation_id = create_resp.json()["quotation_id"]
        quote_number = create_resp.json()["quote_number"]
        
        # Accounts user deletes - should succeed
        delete_resp = self.accounts_session.delete(f"{BASE_URL}/api/quotations/{quotation_id}")
        assert delete_resp.status_code == 200, f"Accounts user should be able to delete quotation, got {delete_resp.status_code}: {delete_resp.text}"
        
        print(f"Accounts user successfully deleted quotation: {quote_number}")
        
        # Verify deletion
        get_resp = self.admin_session.get(f"{BASE_URL}/api/quotations")
        quotations = get_resp.json()
        assert not any(q["quotation_id"] == quotation_id for q in quotations), "Quotation should be deleted"
    
    def test_admin_can_delete_quotation(self):
        """Admin CAN delete quotation"""
        # Create a quotation
        packages_resp = self.admin_session.get(f"{BASE_URL}/api/packages")
        packages = packages_resp.json()
        sp_resp = self.admin_session.get(f"{BASE_URL}/api/salespersons")
        salespersons = sp_resp.json()
        
        if not packages or not salespersons:
            pytest.skip("No packages or salespersons available")
        
        quotation_data = {
            "package_id": packages[0]["package_id"],
            "principal_name": "TEST_Principal_AdminDelete",
            "school_name": "TEST_School_AdminDelete",
            "address": "102 AdminDelete Street",
            "customer_email": "admindelete@school.com",
            "customer_phone": "9876543214",
            "sales_person_id": salespersons[0]["sales_person_id"],
            "discount1_pct": 0,
            "discount2_pct": 0,
            "freight_amount": 0,
            "lines": []
        }
        
        create_resp = self.admin_session.post(f"{BASE_URL}/api/quotations", json=quotation_data)
        assert create_resp.status_code == 200
        quotation_id = create_resp.json()["quotation_id"]
        quote_number = create_resp.json()["quote_number"]
        
        # Admin deletes - should succeed
        delete_resp = self.admin_session.delete(f"{BASE_URL}/api/quotations/{quotation_id}")
        assert delete_resp.status_code == 200, f"Admin should be able to delete quotation, got {delete_resp.status_code}: {delete_resp.text}"
        
        print(f"Admin successfully deleted quotation: {quote_number}")


class TestConversionAnalytics:
    """Test conversion tracking API"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.session = requests.Session()
        resp = self.session.post(f"{BASE_URL}/api/auth/login", json=ADMIN_CREDS)
        assert resp.status_code == 200
        yield
        self.session.close()
    
    def test_conversion_analytics_returns_pipeline(self):
        """GET /api/analytics/conversion returns pipeline data"""
        resp = self.session.get(f"{BASE_URL}/api/analytics/conversion")
        assert resp.status_code == 200, f"Conversion analytics failed: {resp.text}"
        
        data = resp.json()
        assert "pipeline" in data, "Response should contain 'pipeline'"
        
        pipeline = data["pipeline"]
        expected_stages = ["new", "contacted", "demo", "quoted", "negotiation", "won", "lost"]
        for stage in expected_stages:
            assert stage in pipeline, f"Pipeline should contain stage '{stage}'"
            assert isinstance(pipeline[stage], int), f"Pipeline stage '{stage}' should be an integer"
        
        print(f"Pipeline data: {pipeline}")
    
    def test_conversion_analytics_returns_conversion_rate(self):
        """GET /api/analytics/conversion returns conversion_rate"""
        resp = self.session.get(f"{BASE_URL}/api/analytics/conversion")
        assert resp.status_code == 200
        
        data = resp.json()
        assert "conversion_rate" in data, "Response should contain 'conversion_rate'"
        assert isinstance(data["conversion_rate"], (int, float)), "conversion_rate should be a number"
        
        print(f"Conversion rate: {data['conversion_rate']}%")
    
    def test_conversion_analytics_returns_salesperson_conversion(self):
        """GET /api/analytics/conversion returns salesperson_conversion array"""
        resp = self.session.get(f"{BASE_URL}/api/analytics/conversion")
        assert resp.status_code == 200
        
        data = resp.json()
        assert "salesperson_conversion" in data, "Response should contain 'salesperson_conversion'"
        assert isinstance(data["salesperson_conversion"], list), "salesperson_conversion should be a list"
        
        if data["salesperson_conversion"]:
            sp = data["salesperson_conversion"][0]
            expected_fields = ["name", "email", "total_leads", "won", "lost", "active", "quotations", "revenue", "conversion_rate"]
            for field in expected_fields:
                assert field in sp, f"Salesperson data should contain '{field}'"
        
        print(f"Salesperson conversion data: {len(data['salesperson_conversion'])} salespersons")
    
    def test_conversion_analytics_returns_quotation_stats(self):
        """GET /api/analytics/conversion returns quotation_stats"""
        resp = self.session.get(f"{BASE_URL}/api/analytics/conversion")
        assert resp.status_code == 200
        
        data = resp.json()
        assert "quotation_stats" in data, "Response should contain 'quotation_stats'"
        
        stats = data["quotation_stats"]
        expected_fields = ["total", "draft", "sent", "confirmed"]
        for field in expected_fields:
            assert field in stats, f"quotation_stats should contain '{field}'"
        
        print(f"Quotation stats: {stats}")
    
    def test_conversion_analytics_returns_task_stats(self):
        """GET /api/analytics/conversion returns task_stats"""
        resp = self.session.get(f"{BASE_URL}/api/analytics/conversion")
        assert resp.status_code == 200
        
        data = resp.json()
        assert "task_stats" in data, "Response should contain 'task_stats'"
        
        stats = data["task_stats"]
        expected_fields = ["total", "pending", "done", "missed"]
        for field in expected_fields:
            assert field in stats, f"task_stats should contain '{field}'"
        
        print(f"Task stats: {stats}")


class TestNotifications:
    """Test notifications API"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.session = requests.Session()
        resp = self.session.post(f"{BASE_URL}/api/auth/login", json=ADMIN_CREDS)
        assert resp.status_code == 200
        yield
        self.session.close()
    
    def test_get_notifications_returns_array(self):
        """GET /api/notifications returns notifications array"""
        resp = self.session.get(f"{BASE_URL}/api/notifications")
        assert resp.status_code == 200, f"Get notifications failed: {resp.text}"
        
        data = resp.json()
        assert isinstance(data, list), "Notifications should be a list"
        
        print(f"Notifications count: {len(data)}")
    
    def test_mark_all_notifications_read(self):
        """PUT /api/notifications/read-all marks all as read"""
        resp = self.session.put(f"{BASE_URL}/api/notifications/read-all")
        assert resp.status_code == 200, f"Mark all read failed: {resp.text}"
        
        data = resp.json()
        assert "message" in data
        
        print(f"Mark all read response: {data['message']}")


class TestUserRoleModules:
    """Test that users have correct modules assigned"""
    
    def test_sales_user_has_sales_portal_module(self):
        """Sales user should have sales_portal module"""
        session = requests.Session()
        resp = session.post(f"{BASE_URL}/api/auth/login", json=SALES_CREDS)
        assert resp.status_code == 200
        
        user_data = resp.json()
        modules = user_data.get("assigned_modules", [])
        
        # Sales user should have sales_portal or quotations module
        has_sales_access = "sales_portal" in modules or "quotations" in modules or user_data.get("role") == "admin"
        assert has_sales_access or user_data.get("role") == "sales_person", f"Sales user should have sales access, got modules: {modules}"
        
        print(f"Sales user modules: {modules}")
        session.close()
    
    def test_accounts_user_has_accounts_module(self):
        """Accounts user should have accounts module"""
        session = requests.Session()
        resp = session.post(f"{BASE_URL}/api/auth/login", json=ACCOUNTS_CREDS)
        assert resp.status_code == 200
        
        user_data = resp.json()
        modules = user_data.get("assigned_modules", [])
        
        assert "accounts" in modules, f"Accounts user should have 'accounts' module, got: {modules}"
        
        print(f"Accounts user modules: {modules}")
        session.close()


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
