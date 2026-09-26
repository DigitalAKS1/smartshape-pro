"""
Test CSV Export Endpoints - Iteration 6
Tests for Google Sheets export functionality (CSV download endpoints)
"""
import pytest
import requests
import os
import csv
import io

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestCSVExportEndpoints:
    """Test CSV export endpoints for quotations, inventory, attendance, expenses, field-visits, users"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup session and login as admin"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        # Login as admin
        login_response = self.session.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "info@smartshape.in", "password": "admin123"}
        )
        assert login_response.status_code == 200, f"Admin login failed: {login_response.text}"
        self.admin_user = login_response.json()
        print(f"✓ Admin login successful: {self.admin_user.get('email')}")
        yield
        # Logout
        self.session.post(f"{BASE_URL}/api/auth/logout")
    
    def test_export_quotations_returns_csv(self):
        """GET /api/export/quotations returns valid CSV with headers"""
        response = self.session.get(f"{BASE_URL}/api/export/quotations")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        assert "text/csv" in response.headers.get("Content-Type", ""), "Content-Type should be text/csv"
        assert "attachment" in response.headers.get("Content-Disposition", ""), "Should have attachment disposition"
        
        # Parse CSV and verify headers
        csv_content = response.text
        reader = csv.reader(io.StringIO(csv_content))
        headers = next(reader)
        
        expected_headers = ["Quote Number", "School Name", "Principal Name", "Package", "Sales Person",
                          "Subtotal", "GST", "Discount 1%", "Discount 2%", "Freight", "Grand Total",
                          "Status", "Catalogue Status", "Created At"]
        assert headers == expected_headers, f"Headers mismatch. Got: {headers}"
        print(f"✓ Quotations CSV export working - Headers: {headers}")
    
    def test_export_inventory_returns_csv(self):
        """GET /api/export/inventory returns valid CSV"""
        response = self.session.get(f"{BASE_URL}/api/export/inventory")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        assert "text/csv" in response.headers.get("Content-Type", ""), "Content-Type should be text/csv"
        
        # Parse CSV and verify headers
        csv_content = response.text
        reader = csv.reader(io.StringIO(csv_content))
        headers = next(reader)
        
        expected_headers = ["Code", "Name", "Type", "Stock Qty", "Reserved Qty", "Available", "Min Level", "Status"]
        assert headers == expected_headers, f"Headers mismatch. Got: {headers}"
        
        # Verify we have data rows (seeded dies)
        rows = list(reader)
        assert len(rows) > 0, "Should have inventory data from seeded dies"
        print(f"✓ Inventory CSV export working - {len(rows)} items exported")
    
    def test_export_attendance_returns_csv(self):
        """GET /api/export/attendance returns valid CSV"""
        response = self.session.get(f"{BASE_URL}/api/export/attendance")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        assert "text/csv" in response.headers.get("Content-Type", ""), "Content-Type should be text/csv"
        
        # Parse CSV and verify headers
        csv_content = response.text
        reader = csv.reader(io.StringIO(csv_content))
        headers = next(reader)
        
        expected_headers = ["Sales Person", "Email", "Date", "Work Type", "Check In Time", "Check In Address",
                          "Check Out Time", "Check Out Address"]
        assert headers == expected_headers, f"Headers mismatch. Got: {headers}"
        print(f"✓ Attendance CSV export working - Headers: {headers}")
    
    def test_export_expenses_returns_csv(self):
        """GET /api/export/expenses returns valid CSV"""
        response = self.session.get(f"{BASE_URL}/api/export/expenses")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        assert "text/csv" in response.headers.get("Content-Type", ""), "Content-Type should be text/csv"
        
        # Parse CSV and verify headers
        csv_content = response.text
        reader = csv.reader(io.StringIO(csv_content))
        headers = next(reader)
        
        expected_headers = ["Sales Person", "Date", "From", "To", "Distance KM", "Transport Mode",
                          "Rate/KM", "Amount", "Status"]
        assert headers == expected_headers, f"Headers mismatch. Got: {headers}"
        print(f"✓ Expenses CSV export working - Headers: {headers}")
    
    def test_export_field_visits_returns_csv(self):
        """GET /api/export/field-visits returns valid CSV"""
        response = self.session.get(f"{BASE_URL}/api/export/field-visits")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        assert "text/csv" in response.headers.get("Content-Type", ""), "Content-Type should be text/csv"
        
        # Parse CSV and verify headers
        csv_content = response.text
        reader = csv.reader(io.StringIO(csv_content))
        headers = next(reader)
        
        expected_headers = ["Sales Person", "School Name", "Contact Person", "Contact Phone",
                          "Visit Date", "Visit Time", "Status", "Purpose", "Outcome", "Address"]
        assert headers == expected_headers, f"Headers mismatch. Got: {headers}"
        print(f"✓ Field Visits CSV export working - Headers: {headers}")
    
    def test_export_users_returns_csv_for_admin(self):
        """GET /api/export/users returns valid CSV (admin only)"""
        response = self.session.get(f"{BASE_URL}/api/export/users")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        assert "text/csv" in response.headers.get("Content-Type", ""), "Content-Type should be text/csv"
        
        # Parse CSV and verify headers
        csv_content = response.text
        reader = csv.reader(io.StringIO(csv_content))
        headers = next(reader)
        
        expected_headers = ["Name", "Email", "Role", "Phone", "Modules", "Active", "Created At"]
        assert headers == expected_headers, f"Headers mismatch. Got: {headers}"
        
        # Verify we have data rows (seeded users)
        rows = list(reader)
        assert len(rows) > 0, "Should have user data"
        print(f"✓ Users CSV export working - {len(rows)} users exported")


class TestCSVExportAccessControl:
    """Test access control for CSV export endpoints"""
    
    def test_non_admin_cannot_access_users_export(self):
        """Non-admin user should get 403 when accessing /api/export/users"""
        session = requests.Session()
        session.headers.update({"Content-Type": "application/json"})
        
        # Login as DME user (non-admin)
        login_response = session.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "dme@pfcpl24.in", "password": "admin@123"}
        )
        assert login_response.status_code == 200, f"DME login failed: {login_response.text}"
        print(f"✓ DME user login successful")
        
        # Try to access users export
        response = session.get(f"{BASE_URL}/api/export/users")
        assert response.status_code == 403, f"Expected 403 for non-admin, got {response.status_code}"
        print(f"✓ Non-admin correctly denied access to users export (403)")
        
        # Logout
        session.post(f"{BASE_URL}/api/auth/logout")
    
    def test_non_admin_can_access_other_exports(self):
        """Non-admin user should be able to access other export endpoints"""
        session = requests.Session()
        session.headers.update({"Content-Type": "application/json"})
        
        # Login as DME user (non-admin)
        login_response = session.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "dme@pfcpl24.in", "password": "admin@123"}
        )
        assert login_response.status_code == 200, f"DME login failed: {login_response.text}"
        
        # Test other exports (should work for authenticated users)
        endpoints = ["quotations", "inventory", "attendance", "expenses", "field-visits"]
        for endpoint in endpoints:
            response = session.get(f"{BASE_URL}/api/export/{endpoint}")
            assert response.status_code == 200, f"Expected 200 for {endpoint}, got {response.status_code}"
            print(f"✓ DME user can access /api/export/{endpoint}")
        
        # Logout
        session.post(f"{BASE_URL}/api/auth/logout")
    
    def test_unauthenticated_cannot_access_exports(self):
        """Unauthenticated user should get 401 when accessing export endpoints"""
        session = requests.Session()
        
        endpoints = ["quotations", "inventory", "attendance", "expenses", "field-visits", "users"]
        for endpoint in endpoints:
            response = session.get(f"{BASE_URL}/api/export/{endpoint}")
            assert response.status_code == 401, f"Expected 401 for {endpoint}, got {response.status_code}"
        
        print(f"✓ Unauthenticated users correctly denied access to all export endpoints (401)")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
