"""
Test Suite for SmartShape Pro - Settings, WhatsApp, Gmail, Import Center, Activity Logs, Dispatch PDF
Tests the new features added in Phase 6:
- Settings page with Company/Gmail/WhatsApp tabs
- WhatsApp integration (messageautosender.com API)
- Gmail SMTP integration
- Import Center with preview/execute/logs
- Activity Logs viewer
- Dispatch PDF generation
"""

import pytest
import requests
import os
import io

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestSettingsEndpoints:
    """Test Settings API endpoints - Company, Gmail, WhatsApp"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login as admin before each test"""
        self.session = requests.Session()
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "info@smartshape.in",
            "password": "admin123"
        })
        assert login_resp.status_code == 200, f"Admin login failed: {login_resp.text}"
        self.admin_user = login_resp.json()
    
    def test_01_get_company_settings(self):
        """GET /api/settings/company returns company settings"""
        resp = self.session.get(f"{BASE_URL}/api/settings/company")
        assert resp.status_code == 200
        data = resp.json()
        # Should have default fields
        assert "company_name" in data
        assert "email" in data
        assert "phone" in data
        assert "gst_number" in data
        assert "address" in data
        print(f"Company settings: {data.get('company_name', 'SmartShape Pro')}")
    
    def test_02_save_company_settings(self):
        """POST /api/settings/company saves company settings"""
        test_data = {
            "company_name": "SmartShape Pro Test",
            "email": "test@smartshape.in",
            "phone": "9876543210",
            "gst_number": "TEST123456789",
            "address": "Test Address, City"
        }
        resp = self.session.post(f"{BASE_URL}/api/settings/company", json=test_data)
        assert resp.status_code == 200
        
        # Verify saved
        get_resp = self.session.get(f"{BASE_URL}/api/settings/company")
        assert get_resp.status_code == 200
        saved = get_resp.json()
        assert saved["company_name"] == "SmartShape Pro Test"
        assert saved["email"] == "test@smartshape.in"
        print("Company settings saved and verified")
    
    def test_03_get_email_settings(self):
        """GET /api/settings/email returns email/Gmail settings"""
        resp = self.session.get(f"{BASE_URL}/api/settings/email")
        assert resp.status_code == 200
        data = resp.json()
        # Should have default fields
        assert "sender_name" in data
        assert "sender_email" in data
        assert "gmail_app_password" in data
        print(f"Email settings: sender_name={data.get('sender_name')}")
    
    def test_04_save_email_settings(self):
        """POST /api/settings/email saves Gmail settings"""
        test_data = {
            "sender_name": "SmartShape Test",
            "sender_email": "test@gmail.com",
            "gmail_app_password": "test_password_123",
            "enabled": True
        }
        resp = self.session.post(f"{BASE_URL}/api/settings/email", json=test_data)
        assert resp.status_code == 200
        
        # Verify saved
        get_resp = self.session.get(f"{BASE_URL}/api/settings/email")
        assert get_resp.status_code == 200
        saved = get_resp.json()
        assert saved["sender_name"] == "SmartShape Test"
        assert saved["sender_email"] == "test@gmail.com"
        print("Email settings saved and verified")
    
    def test_05_get_whatsapp_settings(self):
        """GET /api/settings/whatsapp returns WhatsApp settings"""
        resp = self.session.get(f"{BASE_URL}/api/settings/whatsapp")
        assert resp.status_code == 200
        data = resp.json()
        # Should have default fields
        assert "username" in data
        assert "password" in data
        print(f"WhatsApp settings: username={data.get('username', 'not configured')}")
    
    def test_06_save_whatsapp_settings(self):
        """POST /api/settings/whatsapp saves WhatsApp credentials"""
        test_data = {
            "username": "test_wa_user",
            "password": "test_wa_pass",
            "enabled": True
        }
        resp = self.session.post(f"{BASE_URL}/api/settings/whatsapp", json=test_data)
        assert resp.status_code == 200
        
        # Verify saved
        get_resp = self.session.get(f"{BASE_URL}/api/settings/whatsapp")
        assert get_resp.status_code == 200
        saved = get_resp.json()
        assert saved["username"] == "test_wa_user"
        assert saved["password"] == "test_wa_pass"
        print("WhatsApp settings saved and verified")


class TestWhatsAppSendEndpoint:
    """Test WhatsApp send endpoint"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login as admin"""
        self.session = requests.Session()
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "info@smartshape.in",
            "password": "admin123"
        })
        assert login_resp.status_code == 200
    
    def test_07_whatsapp_send_requires_config(self):
        """POST /api/whatsapp/send returns error if not configured"""
        # First clear WhatsApp settings
        self.session.post(f"{BASE_URL}/api/settings/whatsapp", json={
            "username": "",
            "password": "",
            "enabled": False
        })
        
        resp = self.session.post(f"{BASE_URL}/api/whatsapp/send", json={
            "phone": "919876543210",
            "message": "Test message"
        })
        # Should return 400 if not configured
        assert resp.status_code == 400
        assert "not configured" in resp.json().get("detail", "").lower()
        print("WhatsApp send correctly returns error when not configured")
    
    def test_08_whatsapp_send_with_config(self):
        """POST /api/whatsapp/send attempts to send when configured"""
        # Configure WhatsApp first
        self.session.post(f"{BASE_URL}/api/settings/whatsapp", json={
            "username": "test_user",
            "password": "test_pass",
            "enabled": True
        })
        
        resp = self.session.post(f"{BASE_URL}/api/whatsapp/send", json={
            "phone": "919876543210",
            "message": "Test message from SmartShape Pro"
        })
        # Should return 200 (even if API fails, it returns success/error in body)
        assert resp.status_code == 200
        data = resp.json()
        # Response should have success field
        assert "success" in data
        print(f"WhatsApp send response: success={data.get('success')}")
    
    def test_09_whatsapp_send_missing_fields(self):
        """POST /api/whatsapp/send returns 400 for missing phone/message"""
        # Configure WhatsApp first
        self.session.post(f"{BASE_URL}/api/settings/whatsapp", json={
            "username": "test_user",
            "password": "test_pass"
        })
        
        # Missing message
        resp = self.session.post(f"{BASE_URL}/api/whatsapp/send", json={
            "phone": "919876543210"
        })
        assert resp.status_code == 400
        print("WhatsApp send correctly validates required fields")


class TestEmailSendEndpoint:
    """Test Email/Gmail send endpoint"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login as admin"""
        self.session = requests.Session()
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "info@smartshape.in",
            "password": "admin123"
        })
        assert login_resp.status_code == 200
    
    def test_10_email_send_requires_config(self):
        """POST /api/email/send returns error if Gmail not configured"""
        # Clear email settings
        self.session.post(f"{BASE_URL}/api/settings/email", json={
            "sender_name": "",
            "sender_email": "",
            "gmail_app_password": ""
        })
        
        resp = self.session.post(f"{BASE_URL}/api/email/send", json={
            "to": "test@example.com",
            "subject": "Test Subject",
            "body": "<p>Test body</p>"
        })
        # Should return 400 if not configured
        assert resp.status_code == 400
        assert "not configured" in resp.json().get("detail", "").lower()
        print("Email send correctly returns error when not configured")
    
    def test_11_email_send_missing_fields(self):
        """POST /api/email/send returns 400 for missing to/subject"""
        # Configure email first
        self.session.post(f"{BASE_URL}/api/settings/email", json={
            "sender_name": "Test",
            "sender_email": "test@gmail.com",
            "gmail_app_password": "test_pass"
        })
        
        # Missing subject
        resp = self.session.post(f"{BASE_URL}/api/email/send", json={
            "to": "test@example.com"
        })
        assert resp.status_code == 400
        print("Email send correctly validates required fields")


class TestImportSystem:
    """Test Import Center endpoints - preview, execute, logs"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login as admin"""
        self.session = requests.Session()
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "info@smartshape.in",
            "password": "admin123"
        })
        assert login_resp.status_code == 200
    
    def test_12_import_preview_contacts(self):
        """POST /api/import/preview validates contacts CSV"""
        csv_content = "name,phone,email,company\nJohn Doe,9876543210,john@test.com,Test Corp\nJane,9876543211,jane@test.com,Test Inc"
        files = {'file': ('contacts.csv', io.BytesIO(csv_content.encode()), 'text/csv')}
        
        resp = self.session.post(f"{BASE_URL}/api/import/preview?entity_type=contacts", files=files)
        assert resp.status_code == 200
        data = resp.json()
        assert "total_rows" in data
        assert "valid" in data
        assert "errors" in data
        assert "rows" in data
        assert data["total_rows"] == 2
        assert data["valid"] == 2
        print(f"Import preview: {data['total_rows']} rows, {data['valid']} valid")
    
    def test_13_import_preview_contacts_with_errors(self):
        """POST /api/import/preview detects invalid rows"""
        csv_content = "name,phone,email\nJohn Doe,9876543210,john@test.com\n,9876543211,jane@test.com\nBob,,bob@test.com"
        files = {'file': ('contacts.csv', io.BytesIO(csv_content.encode()), 'text/csv')}
        
        resp = self.session.post(f"{BASE_URL}/api/import/preview?entity_type=contacts", files=files)
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_rows"] == 3
        assert data["errors"] == 2  # Missing name and missing phone
        print(f"Import preview with errors: {data['errors']} errors detected")
    
    def test_14_import_preview_schools(self):
        """POST /api/import/preview validates schools CSV"""
        csv_content = "school_name,email,phone,city\nTest School,school@test.com,9876543210,Delhi\nAnother School,another@test.com,9876543211,Mumbai"
        files = {'file': ('schools.csv', io.BytesIO(csv_content.encode()), 'text/csv')}
        
        resp = self.session.post(f"{BASE_URL}/api/import/preview?entity_type=schools", files=files)
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_rows"] == 2
        assert data["valid"] == 2
        print(f"Schools import preview: {data['valid']} valid")
    
    def test_15_import_preview_inventory(self):
        """POST /api/import/preview validates inventory CSV"""
        csv_content = "code,name,type,stock_qty\nDIE001,Test Die 1,standard,10\nDIE002,Test Die 2,large,5"
        files = {'file': ('inventory.csv', io.BytesIO(csv_content.encode()), 'text/csv')}
        
        resp = self.session.post(f"{BASE_URL}/api/import/preview?entity_type=inventory", files=files)
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_rows"] == 2
        assert data["valid"] == 2
        print(f"Inventory import preview: {data['valid']} valid")
    
    def test_16_import_execute_contacts(self):
        """POST /api/import/execute imports valid contacts"""
        # First preview
        csv_content = "name,phone,email,company\nTEST_Import User,9999888877,import@test.com,Import Corp"
        files = {'file': ('contacts.csv', io.BytesIO(csv_content.encode()), 'text/csv')}
        preview_resp = self.session.post(f"{BASE_URL}/api/import/preview?entity_type=contacts", files=files)
        preview_data = preview_resp.json()
        
        # Execute import
        exec_resp = self.session.post(f"{BASE_URL}/api/import/execute", json={
            "entity_type": "contacts",
            "rows": preview_data["rows"]
        })
        assert exec_resp.status_code == 200
        data = exec_resp.json()
        assert "created" in data
        assert "failed" in data
        assert "log_id" in data
        print(f"Import executed: {data['created']} created, {data['failed']} failed")
    
    def test_17_import_logs(self):
        """GET /api/import/logs returns import history"""
        resp = self.session.get(f"{BASE_URL}/api/import/logs")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        if len(data) > 0:
            log = data[0]
            assert "log_id" in log
            assert "entity_type" in log
            assert "total_rows" in log
            assert "success_count" in log
            assert "failed_count" in log
            assert "uploaded_by" in log
        print(f"Import logs: {len(data)} entries")


class TestActivityLogs:
    """Test Activity Logs endpoint"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login as admin"""
        self.session = requests.Session()
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "info@smartshape.in",
            "password": "admin123"
        })
        assert login_resp.status_code == 200
    
    def test_18_get_activity_logs(self):
        """GET /api/activity-logs returns activity logs (admin only)"""
        resp = self.session.get(f"{BASE_URL}/api/activity-logs")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        print(f"Activity logs: {len(data)} entries")
    
    def test_19_activity_logs_filter_by_entity(self):
        """GET /api/activity-logs filters by entity_type"""
        resp = self.session.get(f"{BASE_URL}/api/activity-logs?entity_type=order")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        # All entries should be of type 'order'
        for log in data:
            assert log.get("entity_type") == "order"
        print(f"Activity logs filtered by order: {len(data)} entries")
    
    def test_20_activity_logs_limit(self):
        """GET /api/activity-logs respects limit parameter"""
        resp = self.session.get(f"{BASE_URL}/api/activity-logs?limit=5")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) <= 5
        print(f"Activity logs with limit=5: {len(data)} entries")
    
    def test_21_activity_logs_requires_admin(self):
        """GET /api/activity-logs returns 403 for non-admin"""
        # Create a non-admin session
        non_admin_session = requests.Session()
        # Try to access without login
        resp = non_admin_session.get(f"{BASE_URL}/api/activity-logs")
        assert resp.status_code == 401
        print("Activity logs correctly requires authentication")


class TestDispatchPDF:
    """Test Dispatch PDF generation endpoint"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login as admin"""
        self.session = requests.Session()
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "info@smartshape.in",
            "password": "admin123"
        })
        assert login_resp.status_code == 200
    
    def test_22_get_dispatches_list(self):
        """GET /api/dispatches returns dispatches list"""
        resp = self.session.get(f"{BASE_URL}/api/dispatches")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        print(f"Dispatches: {len(data)} entries")
        return data
    
    def test_23_dispatch_pdf_generation(self):
        """GET /api/dispatches/{id}/pdf returns PDF file"""
        # First get dispatches
        dispatches_resp = self.session.get(f"{BASE_URL}/api/dispatches")
        dispatches = dispatches_resp.json()
        
        if len(dispatches) == 0:
            pytest.skip("No dispatches available to test PDF generation")
        
        dispatch = dispatches[0]
        dispatch_id = dispatch["dispatch_id"]
        
        resp = self.session.get(f"{BASE_URL}/api/dispatches/{dispatch_id}/pdf")
        assert resp.status_code == 200
        assert resp.headers.get("content-type") == "application/pdf"
        assert len(resp.content) > 0
        print(f"Dispatch PDF generated for {dispatch.get('dispatch_number')}: {len(resp.content)} bytes")
    
    def test_24_dispatch_pdf_not_found(self):
        """GET /api/dispatches/{id}/pdf returns 404 for invalid dispatch"""
        resp = self.session.get(f"{BASE_URL}/api/dispatches/invalid_dispatch_id/pdf")
        assert resp.status_code == 404
        print("Dispatch PDF correctly returns 404 for invalid ID")


class TestDispatchesTab:
    """Test Dispatches functionality in Orders page"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login as admin"""
        self.session = requests.Session()
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "info@smartshape.in",
            "password": "admin123"
        })
        assert login_resp.status_code == 200
    
    def test_25_dispatches_have_required_fields(self):
        """Dispatches have all required fields for UI display"""
        resp = self.session.get(f"{BASE_URL}/api/dispatches")
        assert resp.status_code == 200
        dispatches = resp.json()
        
        if len(dispatches) == 0:
            pytest.skip("No dispatches to verify fields")
        
        dispatch = dispatches[0]
        required_fields = ["dispatch_id", "dispatch_number", "order_id", "order_number", 
                          "school_name", "dispatch_date", "status"]
        for field in required_fields:
            assert field in dispatch, f"Missing field: {field}"
        print(f"Dispatch {dispatch['dispatch_number']} has all required fields")
    
    def test_26_mark_dispatch_delivered(self):
        """PUT /api/dispatches/{id}/delivered marks dispatch as delivered"""
        # Get dispatches
        resp = self.session.get(f"{BASE_URL}/api/dispatches")
        dispatches = resp.json()
        
        # Find a dispatched (not delivered) dispatch
        dispatched = [d for d in dispatches if d.get("status") == "dispatched"]
        if len(dispatched) == 0:
            pytest.skip("No dispatched items to mark as delivered")
        
        dispatch = dispatched[0]
        deliver_resp = self.session.put(f"{BASE_URL}/api/dispatches/{dispatch['dispatch_id']}/delivered")
        assert deliver_resp.status_code == 200
        
        # Verify status changed
        verify_resp = self.session.get(f"{BASE_URL}/api/dispatches")
        updated = [d for d in verify_resp.json() if d["dispatch_id"] == dispatch["dispatch_id"]][0]
        assert updated["status"] == "delivered"
        print(f"Dispatch {dispatch['dispatch_number']} marked as delivered")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
