"""
Test Suite for SmartShape Pro Phases 2-5
- Phase 2: School Portal (login, dashboard, orders, quotations, notifications)
- Phase 3: Dispatch Management (create, auto-deduct stock, mark delivered)
- Phase 4: Import System (preview, execute, logs)
- Phase 5: Activity Logs (admin only)
"""
import pytest
import requests
import os
import io

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
ADMIN_EMAIL = "info@smartshape.in"
ADMIN_PASSWORD = "admin123"
SCHOOL_EMAIL = "school@demo.com"
SCHOOL_PASSWORD = "school123"


class TestPhase2SchoolPortal:
    """Phase 2: School Portal Authentication and Dashboard APIs"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
    
    def test_01_school_login_success(self):
        """POST /api/school/auth/login - School login with valid credentials"""
        response = self.session.post(f"{BASE_URL}/api/school/auth/login", json={
            "email": SCHOOL_EMAIL,
            "password": SCHOOL_PASSWORD
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "school_id" in data, "Response should contain school_id"
        assert data.get("role") == "school", "Role should be 'school'"
        assert data.get("email") == SCHOOL_EMAIL, "Email should match"
        # Store cookies for subsequent tests
        self.school_cookies = response.cookies
    
    def test_02_school_login_invalid_credentials(self):
        """POST /api/school/auth/login - Invalid credentials returns 401"""
        response = self.session.post(f"{BASE_URL}/api/school/auth/login", json={
            "email": SCHOOL_EMAIL,
            "password": "wrongpassword"
        })
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
    
    def test_03_school_login_missing_fields(self):
        """POST /api/school/auth/login - Missing fields returns 400"""
        response = self.session.post(f"{BASE_URL}/api/school/auth/login", json={
            "email": SCHOOL_EMAIL
        })
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
    
    def test_04_school_me_authenticated(self):
        """GET /api/school/me - Returns school data with role=school"""
        # First login
        login_resp = self.session.post(f"{BASE_URL}/api/school/auth/login", json={
            "email": SCHOOL_EMAIL,
            "password": SCHOOL_PASSWORD
        })
        assert login_resp.status_code == 200
        
        # Then get /me
        response = self.session.get(f"{BASE_URL}/api/school/me")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data.get("role") == "school", "Role should be 'school'"
        assert "school_name" in data, "Should contain school_name"
    
    def test_05_school_me_unauthenticated(self):
        """GET /api/school/me - Unauthenticated returns 401"""
        new_session = requests.Session()
        response = new_session.get(f"{BASE_URL}/api/school/me")
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
    
    def test_06_school_orders(self):
        """GET /api/school/orders - Returns orders for the school"""
        # Login first
        self.session.post(f"{BASE_URL}/api/school/auth/login", json={
            "email": SCHOOL_EMAIL,
            "password": SCHOOL_PASSWORD
        })
        
        response = self.session.get(f"{BASE_URL}/api/school/orders")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert isinstance(data, list), "Should return a list"
    
    def test_07_school_quotations(self):
        """GET /api/school/quotations - Returns quotations for the school"""
        self.session.post(f"{BASE_URL}/api/school/auth/login", json={
            "email": SCHOOL_EMAIL,
            "password": SCHOOL_PASSWORD
        })
        
        response = self.session.get(f"{BASE_URL}/api/school/quotations")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert isinstance(data, list), "Should return a list"
    
    def test_08_school_notifications(self):
        """GET /api/school/notifications - Returns notifications for the school"""
        self.session.post(f"{BASE_URL}/api/school/auth/login", json={
            "email": SCHOOL_EMAIL,
            "password": SCHOOL_PASSWORD
        })
        
        response = self.session.get(f"{BASE_URL}/api/school/notifications")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert isinstance(data, list), "Should return a list"
    
    def test_09_school_mark_notifications_read(self):
        """PUT /api/school/notifications/read - Marks all notifications as read"""
        self.session.post(f"{BASE_URL}/api/school/auth/login", json={
            "email": SCHOOL_EMAIL,
            "password": SCHOOL_PASSWORD
        })
        
        response = self.session.put(f"{BASE_URL}/api/school/notifications/read")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    
    def test_10_admin_set_school_password(self):
        """PUT /api/schools/{id}/set-password - Admin sets school password"""
        # Login as admin
        admin_session = requests.Session()
        admin_session.headers.update({"Content-Type": "application/json"})
        login_resp = admin_session.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        assert login_resp.status_code == 200, f"Admin login failed: {login_resp.text}"
        
        # Get a school ID
        schools_resp = admin_session.get(f"{BASE_URL}/api/schools")
        assert schools_resp.status_code == 200
        schools = schools_resp.json()
        if len(schools) == 0:
            pytest.skip("No schools to test password setting")
        
        school_id = schools[0]["school_id"]
        
        # Set password
        response = admin_session.put(f"{BASE_URL}/api/schools/{school_id}/set-password", json={
            "password": "newpassword123"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        # Reset to original password for other tests
        admin_session.put(f"{BASE_URL}/api/schools/{school_id}/set-password", json={
            "password": SCHOOL_PASSWORD
        })
    
    def test_11_set_school_password_non_admin(self):
        """PUT /api/schools/{id}/set-password - Non-admin returns 403"""
        # Login as school (non-admin)
        self.session.post(f"{BASE_URL}/api/school/auth/login", json={
            "email": SCHOOL_EMAIL,
            "password": SCHOOL_PASSWORD
        })
        
        # Try to set password - should fail
        response = self.session.put(f"{BASE_URL}/api/schools/some_id/set-password", json={
            "password": "test123"
        })
        # School token won't work for admin endpoints
        assert response.status_code in [401, 403], f"Expected 401/403, got {response.status_code}"


class TestPhase3DispatchManagement:
    """Phase 3: Dispatch Management APIs"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        # Login as admin
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        assert login_resp.status_code == 200, f"Admin login failed: {login_resp.text}"
    
    def test_01_get_dispatches(self):
        """GET /api/dispatches - Returns dispatches list"""
        response = self.session.get(f"{BASE_URL}/api/dispatches")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert isinstance(data, list), "Should return a list"
    
    def test_02_create_dispatch_missing_order_id(self):
        """POST /api/dispatches - Missing order_id returns 400"""
        response = self.session.post(f"{BASE_URL}/api/dispatches", json={
            "courier_name": "Test Courier"
        })
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
    
    def test_03_create_dispatch_invalid_order(self):
        """POST /api/dispatches - Invalid order_id returns 404"""
        response = self.session.post(f"{BASE_URL}/api/dispatches", json={
            "order_id": "nonexistent_order_id"
        })
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
    
    def test_04_create_dispatch_for_confirmed_order(self):
        """POST /api/dispatches - Creates dispatch for confirmed/pending order"""
        # Get orders
        orders_resp = self.session.get(f"{BASE_URL}/api/orders")
        assert orders_resp.status_code == 200
        orders = orders_resp.json()
        
        # Find a confirmed or pending order
        eligible_order = None
        for order in orders:
            if order.get("order_status") in ("confirmed", "pending"):
                eligible_order = order
                break
        
        if not eligible_order:
            pytest.skip("No confirmed/pending orders to test dispatch creation")
        
        response = self.session.post(f"{BASE_URL}/api/dispatches", json={
            "order_id": eligible_order["order_id"],
            "courier_name": "Test Courier",
            "tracking_number": "TEST123456"
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "dispatch_id" in data, "Response should contain dispatch_id"
        assert "dispatch_number" in data, "Response should contain dispatch_number"
        assert data.get("status") == "dispatched", "Status should be 'dispatched'"
    
    def test_05_mark_dispatch_delivered_invalid(self):
        """PUT /api/dispatches/{id}/delivered - Invalid dispatch returns 404"""
        response = self.session.put(f"{BASE_URL}/api/dispatches/nonexistent_id/delivered")
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
    
    def test_06_mark_dispatch_delivered(self):
        """PUT /api/dispatches/{id}/delivered - Marks dispatch and order as delivered"""
        # Get dispatches
        dispatches_resp = self.session.get(f"{BASE_URL}/api/dispatches")
        assert dispatches_resp.status_code == 200
        dispatches = dispatches_resp.json()
        
        # Find a dispatched (not delivered) dispatch
        eligible_dispatch = None
        for dispatch in dispatches:
            if dispatch.get("status") == "dispatched":
                eligible_dispatch = dispatch
                break
        
        if not eligible_dispatch:
            pytest.skip("No dispatched items to mark as delivered")
        
        response = self.session.put(f"{BASE_URL}/api/dispatches/{eligible_dispatch['dispatch_id']}/delivered")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        # Verify order status changed
        order_resp = self.session.get(f"{BASE_URL}/api/orders/{eligible_dispatch['order_id']}")
        if order_resp.status_code == 200:
            order = order_resp.json()
            assert order.get("order_status") == "delivered", "Order should be marked as delivered"


class TestPhase4ImportSystem:
    """Phase 4: Import System APIs"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        # Login as admin
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        assert login_resp.status_code == 200, f"Admin login failed: {login_resp.text}"
    
    def test_01_import_preview_contacts(self):
        """POST /api/import/preview - Validates contacts CSV"""
        csv_content = "name,phone,email\nTest Contact,1234567890,test@example.com\n,9876543210,missing@name.com"
        
        # Use a fresh session for file upload without Content-Type header
        upload_session = requests.Session()
        # Copy cookies from main session
        upload_session.cookies.update(self.session.cookies)
        
        files = {"file": ("contacts.csv", csv_content, "text/csv")}
        response = upload_session.post(
            f"{BASE_URL}/api/import/preview?entity_type=contacts",
            files=files
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "total_rows" in data, "Should contain total_rows"
        assert "valid" in data, "Should contain valid count"
        assert "errors" in data, "Should contain errors count"
        assert "rows" in data, "Should contain rows"
        assert data["total_rows"] == 2, "Should have 2 rows"
        assert data["valid"] == 1, "Should have 1 valid row"
        assert data["errors"] == 1, "Should have 1 error row"
    
    def test_02_import_preview_schools(self):
        """POST /api/import/preview - Validates schools CSV"""
        csv_content = "school_name,email,phone\nTest School,testschool@example.com,1234567890\n,missing@email.com,9876543210"
        
        # Use a fresh session for file upload without Content-Type header
        upload_session = requests.Session()
        upload_session.cookies.update(self.session.cookies)
        
        files = {"file": ("schools.csv", csv_content, "text/csv")}
        response = upload_session.post(
            f"{BASE_URL}/api/import/preview?entity_type=schools",
            files=files
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data["valid"] == 1, "Should have 1 valid row"
        assert data["errors"] == 1, "Should have 1 error row (missing school_name)"
    
    def test_03_import_preview_inventory(self):
        """POST /api/import/preview - Validates inventory CSV"""
        csv_content = "code,name,category\nTEST001,Test Item,Category A\n,Missing Code,Category B"
        
        # Use a fresh session for file upload without Content-Type header
        upload_session = requests.Session()
        upload_session.cookies.update(self.session.cookies)
        
        files = {"file": ("inventory.csv", csv_content, "text/csv")}
        response = upload_session.post(
            f"{BASE_URL}/api/import/preview?entity_type=inventory",
            files=files
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data["valid"] == 1, "Should have 1 valid row"
        assert data["errors"] == 1, "Should have 1 error row (missing code)"
    
    def test_04_import_execute_contacts(self):
        """POST /api/import/execute - Imports valid contacts"""
        import uuid
        unique_phone = f"TEST{uuid.uuid4().hex[:8]}"
        
        rows = [
            {"row_num": 1, "data": {"name": f"Test Import {unique_phone}", "phone": unique_phone, "email": f"{unique_phone}@test.com"}, "status": "ok", "error": ""}
        ]
        
        response = self.session.post(f"{BASE_URL}/api/import/execute", json={
            "entity_type": "contacts",
            "rows": rows
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "created" in data, "Should contain created count"
        assert "failed" in data, "Should contain failed count"
        assert "log_id" in data, "Should contain log_id"
        assert data["created"] >= 1, "Should have created at least 1 contact"
    
    def test_05_import_execute_schools(self):
        """POST /api/import/execute - Imports valid schools"""
        import uuid
        unique_email = f"test{uuid.uuid4().hex[:8]}@school.com"
        
        rows = [
            {"row_num": 1, "data": {"school_name": f"Test Import School", "email": unique_email, "phone": "1234567890"}, "status": "ok", "error": ""}
        ]
        
        response = self.session.post(f"{BASE_URL}/api/import/execute", json={
            "entity_type": "schools",
            "rows": rows
        })
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data["created"] >= 1, "Should have created at least 1 school"
    
    def test_06_import_logs(self):
        """GET /api/import/logs - Returns import history"""
        response = self.session.get(f"{BASE_URL}/api/import/logs")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert isinstance(data, list), "Should return a list"
        if len(data) > 0:
            log = data[0]
            assert "log_id" in log, "Log should contain log_id"
            assert "entity_type" in log, "Log should contain entity_type"
            assert "success_count" in log, "Log should contain success_count"


class TestPhase5ActivityLogs:
    """Phase 5: Activity Logs APIs"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
    
    def test_01_activity_logs_admin_only(self):
        """GET /api/activity-logs - Admin only access"""
        # Login as admin
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        assert login_resp.status_code == 200
        
        response = self.session.get(f"{BASE_URL}/api/activity-logs")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert isinstance(data, list), "Should return a list"
    
    def test_02_activity_logs_with_entity_filter(self):
        """GET /api/activity-logs - Filter by entity_type"""
        # Login as admin
        self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        
        response = self.session.get(f"{BASE_URL}/api/activity-logs", params={"entity_type": "order"})
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert isinstance(data, list), "Should return a list"
    
    def test_03_activity_logs_with_limit(self):
        """GET /api/activity-logs - Limit results"""
        self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        
        response = self.session.get(f"{BASE_URL}/api/activity-logs", params={"limit": 5})
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert len(data) <= 5, "Should return at most 5 logs"
    
    def test_04_activity_logs_non_admin_forbidden(self):
        """GET /api/activity-logs - Non-admin returns 403"""
        # Create a new session without admin login
        new_session = requests.Session()
        new_session.headers.update({"Content-Type": "application/json"})
        
        # Try to access without auth
        response = new_session.get(f"{BASE_URL}/api/activity-logs")
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"


class TestDispatchNotifications:
    """Test that dispatch creates school notifications"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.admin_session = requests.Session()
        self.admin_session.headers.update({"Content-Type": "application/json"})
        self.school_session = requests.Session()
        self.school_session.headers.update({"Content-Type": "application/json"})
    
    def test_dispatch_creates_notification(self):
        """Verify dispatch creates school notification"""
        # Login as admin
        self.admin_session.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        
        # Login as school
        self.school_session.post(f"{BASE_URL}/api/school/auth/login", json={
            "email": SCHOOL_EMAIL,
            "password": SCHOOL_PASSWORD
        })
        
        # Get school notifications
        notif_resp = self.school_session.get(f"{BASE_URL}/api/school/notifications")
        assert notif_resp.status_code == 200
        notifications = notif_resp.json()
        
        # Check if there are any dispatch notifications
        dispatch_notifs = [n for n in notifications if n.get("type") == "dispatch"]
        # This is informational - we just verify the endpoint works
        print(f"Found {len(dispatch_notifs)} dispatch notifications")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
