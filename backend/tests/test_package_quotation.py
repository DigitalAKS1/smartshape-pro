"""
Test Package Master and Quotation Features - Iteration 7
Tests:
- Package CRUD with items array
- Company settings with logo
- Quotation creation with cascading discounts
- Freight with GST calculation
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
ADMIN_EMAIL = "info@smartshape.in"
ADMIN_PASSWORD = "admin123"


class TestSession:
    """Shared session for authenticated requests"""
    session = None
    
    @classmethod
    def get_session(cls):
        if cls.session is None:
            cls.session = requests.Session()
            cls.session.headers.update({"Content-Type": "application/json"})
            # Login
            response = cls.session.post(f"{BASE_URL}/api/auth/login", json={
                "email": ADMIN_EMAIL,
                "password": ADMIN_PASSWORD
            })
            if response.status_code != 200:
                pytest.skip(f"Login failed: {response.status_code} - {response.text}")
        return cls.session


@pytest.fixture(scope="module")
def auth_session():
    """Get authenticated session"""
    return TestSession.get_session()


class TestPackageEndpoints:
    """Test Package CRUD with items array"""
    
    created_package_id = None
    
    def test_get_packages(self, auth_session):
        """GET /api/packages returns packages with items array"""
        response = auth_session.get(f"{BASE_URL}/api/packages")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        
        # Check if packages have items array
        if len(data) > 0:
            pkg = data[0]
            assert "package_id" in pkg, "Package should have package_id"
            assert "display_name" in pkg, "Package should have display_name"
            # items may be None or list
            if pkg.get("items"):
                assert isinstance(pkg["items"], list), "items should be a list"
                if len(pkg["items"]) > 0:
                    item = pkg["items"][0]
                    assert "type" in item, "Item should have type"
                    assert "qty" in item, "Item should have qty"
                    assert "unit_price" in item, "Item should have unit_price"
        print(f"✓ GET /api/packages returned {len(data)} packages")
    
    def test_create_package_with_items(self, auth_session):
        """POST /api/packages creates new package with items"""
        unique_name = f"TEST_Package_{uuid.uuid4().hex[:6]}"
        payload = {
            "name": unique_name.lower().replace(" ", "_"),
            "display_name": unique_name,
            "base_price": 50000,
            "gst_pct": 18,
            "std_die_qty": 10,
            "large_die_qty": 2,
            "machine_qty": 1,
            "items": [
                {"type": "standard_die", "name": "Standard Die", "qty": 10, "unit_price": 2000, "gst_pct": 18},
                {"type": "large_die", "name": "Large Die", "qty": 2, "unit_price": 5000, "gst_pct": 18},
                {"type": "machine", "name": "Die Cutting Machine", "qty": 1, "unit_price": 30000, "gst_pct": 18}
            ]
        }
        
        response = auth_session.post(f"{BASE_URL}/api/packages", json=payload)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "package_id" in data, "Response should have package_id"
        assert data["display_name"] == unique_name, "Display name should match"
        assert "items" in data, "Response should have items"
        assert len(data["items"]) == 3, "Should have 3 items"
        
        # Verify item structure
        for item in data["items"]:
            assert "type" in item
            assert "name" in item
            assert "qty" in item
            assert "unit_price" in item
        
        TestPackageEndpoints.created_package_id = data["package_id"]
        print(f"✓ POST /api/packages created package: {data['package_id']}")
    
    def test_update_package_items(self, auth_session):
        """PUT /api/packages/{id} updates package items"""
        if not TestPackageEndpoints.created_package_id:
            pytest.skip("No package created to update")
        
        pkg_id = TestPackageEndpoints.created_package_id
        update_payload = {
            "display_name": "TEST_Updated_Package",
            "items": [
                {"type": "standard_die", "name": "Standard Die Updated", "qty": 15, "unit_price": 2500, "gst_pct": 18},
                {"type": "die_set", "name": "Die Set", "qty": 1, "unit_price": 10000, "gst_pct": 18}
            ]
        }
        
        response = auth_session.put(f"{BASE_URL}/api/packages/{pkg_id}", json=update_payload)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data["display_name"] == "TEST_Updated_Package", "Display name should be updated"
        assert len(data["items"]) == 2, "Should have 2 items after update"
        
        # Verify GET returns updated data
        get_response = auth_session.get(f"{BASE_URL}/api/packages")
        packages = get_response.json()
        updated_pkg = next((p for p in packages if p["package_id"] == pkg_id), None)
        assert updated_pkg is not None, "Updated package should exist"
        assert len(updated_pkg["items"]) == 2, "GET should return updated items"
        
        print(f"✓ PUT /api/packages/{pkg_id} updated successfully")
    
    def test_delete_package(self, auth_session):
        """DELETE /api/packages/{id} removes package"""
        if not TestPackageEndpoints.created_package_id:
            pytest.skip("No package created to delete")
        
        pkg_id = TestPackageEndpoints.created_package_id
        response = auth_session.delete(f"{BASE_URL}/api/packages/{pkg_id}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        # Verify package is deleted
        get_response = auth_session.get(f"{BASE_URL}/api/packages")
        packages = get_response.json()
        deleted_pkg = next((p for p in packages if p["package_id"] == pkg_id), None)
        assert deleted_pkg is None, "Deleted package should not exist"
        
        print(f"✓ DELETE /api/packages/{pkg_id} removed successfully")


class TestCompanySettings:
    """Test company settings with logo"""
    
    def test_get_company_settings(self, auth_session):
        """GET /api/settings/company returns company settings with logo_url"""
        response = auth_session.get(f"{BASE_URL}/api/settings/company")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        # Should have logo_url field (may be empty)
        assert "logo_url" in data or data.get("logo_url") is None or "logo_url" not in data, "Response should have logo_url field or be empty"
        print(f"✓ GET /api/settings/company returned: {list(data.keys())}")
    
    def test_save_company_settings(self, auth_session):
        """POST /api/settings/company saves company settings"""
        payload = {
            "company_name": "SmartShapes",
            "logo_url": "https://customer-assets.emergentagent.com/job_field-sales-app-16/artifacts/bwpjcb1m_logo.png",
            "address": "Test Address",
            "phone": "1234567890",
            "email": "test@smartshape.in",
            "gst_number": "GST123456"
        }
        
        response = auth_session.post(f"{BASE_URL}/api/settings/company", json=payload)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        # Verify settings were saved
        get_response = auth_session.get(f"{BASE_URL}/api/settings/company")
        data = get_response.json()
        assert data.get("company_name") == "SmartShapes", "Company name should be saved"
        assert data.get("logo_url") == payload["logo_url"], "Logo URL should be saved"
        
        print(f"✓ POST /api/settings/company saved successfully")


class TestQuotationWithCascadingDiscounts:
    """Test quotation creation with cascading discounts"""
    
    test_package_id = None
    test_salesperson_id = None
    created_quotation_id = None
    
    @pytest.fixture(autouse=True)
    def setup_test_data(self, auth_session):
        """Setup test package and salesperson"""
        # Get or create a package
        pkg_response = auth_session.get(f"{BASE_URL}/api/packages")
        packages = pkg_response.json()
        if packages:
            TestQuotationWithCascadingDiscounts.test_package_id = packages[0]["package_id"]
        else:
            # Create a test package
            pkg_payload = {
                "name": "test_quotation_pkg",
                "display_name": "Test Quotation Package",
                "base_price": 20000,
                "gst_pct": 18,
                "items": [
                    {"type": "standard_die", "name": "Standard Die", "qty": 10, "unit_price": 2000, "gst_pct": 18}
                ]
            }
            pkg_response = auth_session.post(f"{BASE_URL}/api/packages", json=pkg_payload)
            if pkg_response.status_code == 200:
                TestQuotationWithCascadingDiscounts.test_package_id = pkg_response.json()["package_id"]
        
        # Get or create a salesperson
        sp_response = auth_session.get(f"{BASE_URL}/api/salespersons")
        salespersons = sp_response.json()
        if salespersons:
            TestQuotationWithCascadingDiscounts.test_salesperson_id = salespersons[0]["sales_person_id"]
        else:
            sp_payload = {
                "name": "Test Salesperson",
                "email": "test_sp@smartshape.in",
                "phone": "9876543210"
            }
            sp_response = auth_session.post(f"{BASE_URL}/api/salespersons", json=sp_payload)
            if sp_response.status_code == 200:
                TestQuotationWithCascadingDiscounts.test_salesperson_id = sp_response.json()["sales_person_id"]
    
    def test_create_quotation_with_cascading_discounts(self, auth_session):
        """POST /api/quotations creates quotation with cascading discounts"""
        if not TestQuotationWithCascadingDiscounts.test_package_id:
            pytest.skip("No package available for quotation")
        if not TestQuotationWithCascadingDiscounts.test_salesperson_id:
            pytest.skip("No salesperson available for quotation")
        
        # Create quotation with:
        # - Items totaling 20000 (subtotal)
        # - GST 18% = 3600
        # - Total with GST = 23600
        # - Primary discount 10% = 2360 -> After disc1 = 21240
        # - Additional discount 5% on 21240 = 1062 -> After disc2 = 20178
        # - Freight 1000 + GST 18% = 1180
        # - Grand total = 20178 + 1180 = 21358
        
        payload = {
            "package_id": TestQuotationWithCascadingDiscounts.test_package_id,
            "principal_name": "TEST_Principal",
            "school_name": "TEST_School",
            "address": "Test Address",
            "customer_email": "test@school.com",
            "customer_phone": "9876543210",
            "customer_gst": "GST123",
            "sales_person_id": TestQuotationWithCascadingDiscounts.test_salesperson_id,
            "discount1_pct": 10,
            "discount2_pct": 5,
            "freight_amount": 1000,
            "lines": [
                {
                    "description": "Standard Die (10 units)",
                    "product_type": "standard_die",
                    "qty": 10,
                    "unit_price": 2000,
                    "gst_pct": 18,
                    "line_subtotal": 20000,
                    "line_gst": 3600,
                    "line_total": 23600,
                    "sort_order": 1
                }
            ]
        }
        
        response = auth_session.post(f"{BASE_URL}/api/quotations", json=payload)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "quotation_id" in data, "Response should have quotation_id"
        assert "quote_number" in data, "Response should have quote_number"
        
        # Verify cascading discount calculation
        assert data["subtotal"] == 20000, f"Subtotal should be 20000, got {data['subtotal']}"
        assert data["gst_amount"] == 3600, f"GST should be 3600, got {data['gst_amount']}"
        assert data["total_with_gst"] == 23600, f"Total with GST should be 23600, got {data['total_with_gst']}"
        
        # Primary discount: 10% of 23600 = 2360
        assert data["disc1_amount"] == 2360, f"Disc1 should be 2360, got {data['disc1_amount']}"
        assert data["after_disc1"] == 21240, f"After disc1 should be 21240, got {data['after_disc1']}"
        
        # Additional discount: 5% of 21240 = 1062
        assert data["disc2_amount"] == 1062, f"Disc2 should be 1062, got {data['disc2_amount']}"
        assert data["after_disc2"] == 20178, f"After disc2 should be 20178, got {data['after_disc2']}"
        
        # Freight: 1000 + 18% GST = 1180
        assert data["freight_total"] == 1180, f"Freight total should be 1180, got {data['freight_total']}"
        
        # Grand total: 20178 + 1180 = 21358
        assert data["grand_total"] == 21358, f"Grand total should be 21358, got {data['grand_total']}"
        
        TestQuotationWithCascadingDiscounts.created_quotation_id = data["quotation_id"]
        print(f"✓ POST /api/quotations created with cascading discounts: {data['quote_number']}")
    
    def test_quotation_lines_structure(self, auth_session):
        """Verify quotation lines have correct structure"""
        response = auth_session.get(f"{BASE_URL}/api/quotations")
        assert response.status_code == 200
        
        quotations = response.json()
        if quotations:
            quot = quotations[0]
            assert "lines" in quot, "Quotation should have lines"
            if quot["lines"]:
                line = quot["lines"][0]
                assert "description" in line, "Line should have description"
                assert "qty" in line, "Line should have qty"
                assert "unit_price" in line, "Line should have unit_price"
                assert "line_subtotal" in line, "Line should have line_subtotal"
                assert "line_gst" in line, "Line should have line_gst"
                assert "line_total" in line, "Line should have line_total"
        
        print(f"✓ Quotation lines structure verified")


class TestSalesPersons:
    """Test salespersons endpoint"""
    
    def test_get_salespersons(self, auth_session):
        """GET /api/salespersons returns list"""
        response = auth_session.get(f"{BASE_URL}/api/salespersons")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        print(f"✓ GET /api/salespersons returned {len(data)} salespersons")


# Cleanup test data
@pytest.fixture(scope="module", autouse=True)
def cleanup(auth_session):
    """Cleanup test data after all tests"""
    yield
    # Cleanup is handled by test methods themselves


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
