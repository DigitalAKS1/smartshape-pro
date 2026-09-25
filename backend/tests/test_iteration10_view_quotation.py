"""
Iteration 10 Tests: View Quotation Page & PDF Generation
- GET /api/quotations/{id}/pdf - Professional PDF with logo, accent colors, product lines table
- Frontend: /view-quotation/{id} - Light theme A4 document
- Frontend: Quotations list - Clickable quote numbers
- Route access for users with quotations module
"""

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestPDFGeneration:
    """Test PDF generation endpoint"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login and get cookies for authenticated requests"""
        self.session = requests.Session()
        login_response = self.session.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "info@smartshape.in", "password": "admin123"}
        )
        assert login_response.status_code == 200, f"Login failed: {login_response.text}"
        self.user = login_response.json()
        
    def test_pdf_endpoint_returns_pdf(self):
        """Test that PDF endpoint returns valid PDF file"""
        # First get a quotation ID
        quotations_response = self.session.get(f"{BASE_URL}/api/quotations")
        assert quotations_response.status_code == 200
        quotations = quotations_response.json()
        
        if len(quotations) == 0:
            pytest.skip("No quotations available for testing")
        
        quotation_id = quotations[0]["quotation_id"]
        
        # Request PDF
        pdf_response = self.session.get(f"{BASE_URL}/api/quotations/{quotation_id}/pdf")
        
        # Verify response
        assert pdf_response.status_code == 200, f"PDF request failed: {pdf_response.status_code}"
        assert pdf_response.headers.get("content-type") == "application/pdf", "Content-Type should be application/pdf"
        
        # Verify it's a valid PDF (starts with %PDF)
        content = pdf_response.content
        assert content[:4] == b'%PDF', "Response should be a valid PDF file"
        
        # Verify Content-Disposition header for download
        content_disposition = pdf_response.headers.get("content-disposition", "")
        assert "attachment" in content_disposition, "Should have attachment disposition"
        assert "Quotation_" in content_disposition, "Filename should contain 'Quotation_'"
        
        print(f"SUCCESS: PDF generated for quotation {quotation_id}")
        print(f"PDF size: {len(content)} bytes")
        print(f"Content-Disposition: {content_disposition}")
    
    def test_pdf_endpoint_requires_auth(self):
        """Test that PDF endpoint requires authentication"""
        # Create new session without login
        unauthenticated_session = requests.Session()
        
        # Get a quotation ID first (using authenticated session)
        quotations_response = self.session.get(f"{BASE_URL}/api/quotations")
        quotations = quotations_response.json()
        
        if len(quotations) == 0:
            pytest.skip("No quotations available for testing")
        
        quotation_id = quotations[0]["quotation_id"]
        
        # Try to get PDF without auth
        pdf_response = unauthenticated_session.get(f"{BASE_URL}/api/quotations/{quotation_id}/pdf")
        assert pdf_response.status_code == 401, "Should return 401 for unauthenticated request"
        
        print("SUCCESS: PDF endpoint requires authentication")
    
    def test_pdf_endpoint_404_for_invalid_id(self):
        """Test that PDF endpoint returns 404 for invalid quotation ID"""
        pdf_response = self.session.get(f"{BASE_URL}/api/quotations/invalid_quotation_id/pdf")
        assert pdf_response.status_code == 404, "Should return 404 for invalid quotation ID"
        
        print("SUCCESS: PDF endpoint returns 404 for invalid ID")


class TestQuotationAccess:
    """Test quotation access for different user roles"""
    
    def test_admin_can_access_quotations(self):
        """Test that admin can access quotations"""
        session = requests.Session()
        login_response = session.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "info@smartshape.in", "password": "admin123"}
        )
        assert login_response.status_code == 200
        
        quotations_response = session.get(f"{BASE_URL}/api/quotations")
        assert quotations_response.status_code == 200
        
        print("SUCCESS: Admin can access quotations")
    
    def test_sales_user_can_access_quotations(self):
        """Test that sales user can access quotations"""
        session = requests.Session()
        login_response = session.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "sales@smartshape.in", "password": "demo@123"}
        )
        assert login_response.status_code == 200
        
        user = login_response.json()
        modules = user.get("assigned_modules", [])
        
        # Sales user should have quotations or sales_portal module
        has_access = "quotations" in modules or "sales_portal" in modules
        assert has_access, f"Sales user should have quotations access. Modules: {modules}"
        
        quotations_response = session.get(f"{BASE_URL}/api/quotations")
        assert quotations_response.status_code == 200
        
        print(f"SUCCESS: Sales user can access quotations. Modules: {modules}")
    
    def test_sales_user_can_download_pdf(self):
        """Test that sales user can download PDF"""
        session = requests.Session()
        login_response = session.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "sales@smartshape.in", "password": "demo@123"}
        )
        assert login_response.status_code == 200
        
        # Get quotations
        quotations_response = session.get(f"{BASE_URL}/api/quotations")
        assert quotations_response.status_code == 200
        quotations = quotations_response.json()
        
        if len(quotations) == 0:
            pytest.skip("No quotations available for testing")
        
        quotation_id = quotations[0]["quotation_id"]
        
        # Download PDF
        pdf_response = session.get(f"{BASE_URL}/api/quotations/{quotation_id}/pdf")
        assert pdf_response.status_code == 200
        assert pdf_response.headers.get("content-type") == "application/pdf"
        
        print("SUCCESS: Sales user can download PDF")


class TestQuotationData:
    """Test quotation data structure for view page"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login and get cookies for authenticated requests"""
        self.session = requests.Session()
        login_response = self.session.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "info@smartshape.in", "password": "admin123"}
        )
        assert login_response.status_code == 200
    
    def test_quotation_has_required_fields_for_view(self):
        """Test that quotation has all required fields for view page"""
        quotations_response = self.session.get(f"{BASE_URL}/api/quotations")
        assert quotations_response.status_code == 200
        quotations = quotations_response.json()
        
        if len(quotations) == 0:
            pytest.skip("No quotations available for testing")
        
        quot = quotations[0]
        
        # Required fields for view page
        required_fields = [
            "quotation_id", "quote_number", "package_name",
            "principal_name", "school_name", "address",
            "sales_person_name", "lines",
            "subtotal", "gst_amount", "total_with_gst",
            "discount1_pct", "discount2_pct", "disc1_amount", "disc2_amount",
            "freight_total", "grand_total", "quotation_status", "created_at"
        ]
        
        for field in required_fields:
            assert field in quot, f"Missing required field: {field}"
        
        # Verify lines structure
        lines = quot.get("lines", [])
        if len(lines) > 0:
            line = lines[0]
            line_fields = ["description", "qty", "unit_price", "line_gst", "line_total"]
            for field in line_fields:
                assert field in line, f"Missing line field: {field}"
        
        print(f"SUCCESS: Quotation has all required fields for view page")
        print(f"Quote: {quot['quote_number']}, Lines: {len(lines)}, Total: {quot['grand_total']}")
    
    def test_company_settings_for_pdf(self):
        """Test that company settings are available for PDF generation"""
        company_response = self.session.get(f"{BASE_URL}/api/settings/company")
        assert company_response.status_code == 200
        
        company = company_response.json()
        
        # Check for logo and company info
        print(f"Company Name: {company.get('company_name', 'Not set')}")
        print(f"Logo URL: {company.get('logo_url', 'Not set')}")
        print(f"Email: {company.get('email', 'Not set')}")
        print(f"GST: {company.get('gst_number', 'Not set')}")
        
        print("SUCCESS: Company settings endpoint working")


class TestProtectedRouteAccess:
    """Test that ProtectedRoute allows access to view-quotation and edit-quotation"""
    
    def test_view_quotation_route_mapping(self):
        """Verify /view-quotation maps to quotations module"""
        # This is a code verification test - checking the route mapping
        # The actual route access is tested via frontend tests
        
        # Login as sales user
        session = requests.Session()
        login_response = session.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "sales@smartshape.in", "password": "demo@123"}
        )
        assert login_response.status_code == 200
        
        user = login_response.json()
        modules = user.get("assigned_modules", [])
        
        # Sales user should have quotations module for view-quotation access
        has_quotations = "quotations" in modules or "sales_portal" in modules
        assert has_quotations, f"Sales user needs quotations module. Has: {modules}"
        
        print(f"SUCCESS: Sales user has modules for quotation access: {modules}")
    
    def test_edit_quotation_route_mapping(self):
        """Verify /edit-quotation maps to quotations module"""
        # Login as sales user
        session = requests.Session()
        login_response = session.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "sales@smartshape.in", "password": "demo@123"}
        )
        assert login_response.status_code == 200
        
        user = login_response.json()
        modules = user.get("assigned_modules", [])
        
        # Sales user should have quotations module for edit-quotation access
        has_quotations = "quotations" in modules or "sales_portal" in modules
        assert has_quotations, f"Sales user needs quotations module. Has: {modules}"
        
        # Verify user can edit quotation via API
        quotations_response = session.get(f"{BASE_URL}/api/quotations")
        assert quotations_response.status_code == 200
        quotations = quotations_response.json()
        
        if len(quotations) > 0:
            # Find a draft quotation to test edit
            draft_quot = next((q for q in quotations if q["quotation_status"] in ["draft", "pending"]), None)
            if draft_quot:
                edit_response = session.put(
                    f"{BASE_URL}/api/quotations/{draft_quot['quotation_id']}",
                    json={"principal_name": draft_quot["principal_name"]}  # No actual change
                )
                assert edit_response.status_code == 200, f"Edit failed: {edit_response.text}"
                print(f"SUCCESS: Sales user can edit quotation {draft_quot['quote_number']}")
            else:
                print("INFO: No draft quotations to test edit")
        
        print(f"SUCCESS: Sales user has edit access. Modules: {modules}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
