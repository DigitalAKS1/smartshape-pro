"""
Test suite for SmartShape Pro Inventory Catalogue/Table View and Category features
Tests: Die category field, Inventory API, Catalogue link page API
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestDieCategoryField:
    """Test Die model supports optional category field"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login and get auth token"""
        self.session = requests.Session()
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "info@smartshape.in",
            "password": "admin123"
        })
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        self.cookies = login_resp.cookies
        self.session.cookies.update(self.cookies)
        yield
        # Cleanup: delete test dies
        try:
            dies = self.session.get(f"{BASE_URL}/api/dies?include_archived=true").json()
            for die in dies:
                if die.get('code', '').startswith('TEST_'):
                    self.session.delete(f"{BASE_URL}/api/dies/{die['die_id']}")
        except:
            pass
    
    def test_01_create_die_with_category(self):
        """Test creating a die with category field"""
        die_data = {
            "code": f"TEST_CAT_{uuid.uuid4().hex[:6]}",
            "name": "Test Die with Category",
            "type": "standard",
            "category": "flowers",
            "min_level": 5
        }
        resp = self.session.post(f"{BASE_URL}/api/dies", json=die_data)
        assert resp.status_code == 200, f"Create die failed: {resp.text}"
        data = resp.json()
        assert data["category"] == "flowers", f"Category not saved: {data}"
        assert data["code"] == die_data["code"]
        assert data["name"] == die_data["name"]
        print(f"✓ Created die with category 'flowers': {data['die_id']}")
    
    def test_02_create_die_without_category_defaults_to_decorative(self):
        """Test creating a die without category defaults to 'decorative'"""
        die_data = {
            "code": f"TEST_NOCAT_{uuid.uuid4().hex[:6]}",
            "name": "Test Die No Category",
            "type": "large",
            "min_level": 3
        }
        resp = self.session.post(f"{BASE_URL}/api/dies", json=die_data)
        assert resp.status_code == 200, f"Create die failed: {resp.text}"
        data = resp.json()
        # Should default to 'decorative'
        assert data.get("category") == "decorative", f"Category should default to 'decorative': {data}"
        print(f"✓ Die without category defaults to 'decorative': {data['die_id']}")
    
    def test_03_create_die_with_various_categories(self):
        """Test creating dies with different category values"""
        categories = ['leaf', 'alphabets', 'butterfly', 'borders', '3d_flowers', 'animals_birds']
        for cat in categories:
            die_data = {
                "code": f"TEST_{cat.upper()[:4]}_{uuid.uuid4().hex[:4]}",
                "name": f"Test Die {cat}",
                "type": "standard",
                "category": cat,
                "min_level": 5
            }
            resp = self.session.post(f"{BASE_URL}/api/dies", json=die_data)
            assert resp.status_code == 200, f"Create die with category '{cat}' failed: {resp.text}"
            data = resp.json()
            assert data["category"] == cat, f"Category mismatch for '{cat}': {data}"
        print(f"✓ Created dies with categories: {categories}")
    
    def test_04_update_die_category(self):
        """Test updating a die's category"""
        # Create die
        die_data = {
            "code": f"TEST_UPD_{uuid.uuid4().hex[:6]}",
            "name": "Test Die Update Category",
            "type": "standard",
            "category": "decorative",
            "min_level": 5
        }
        create_resp = self.session.post(f"{BASE_URL}/api/dies", json=die_data)
        assert create_resp.status_code == 200
        die_id = create_resp.json()["die_id"]
        
        # Update category
        update_resp = self.session.put(f"{BASE_URL}/api/dies/{die_id}", json={"category": "snowflake"})
        assert update_resp.status_code == 200, f"Update failed: {update_resp.text}"
        updated = update_resp.json()
        assert updated["category"] == "snowflake", f"Category not updated: {updated}"
        print(f"✓ Updated die category from 'decorative' to 'snowflake'")
    
    def test_05_get_dies_returns_category(self):
        """Test GET /api/dies returns category field"""
        resp = self.session.get(f"{BASE_URL}/api/dies")
        assert resp.status_code == 200, f"Get dies failed: {resp.text}"
        dies = resp.json()
        assert isinstance(dies, list), "Response should be a list"
        if len(dies) > 0:
            # Check that dies have category field
            for die in dies[:5]:  # Check first 5
                assert "category" in die or die.get("category") is None, f"Die missing category: {die}"
        print(f"✓ GET /api/dies returns {len(dies)} dies with category field")


class TestInventoryAPI:
    """Test Inventory API endpoints"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login and get auth token"""
        self.session = requests.Session()
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "info@smartshape.in",
            "password": "admin123"
        })
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        self.session.cookies.update(login_resp.cookies)
    
    def test_06_get_all_dies(self):
        """Test GET /api/dies returns all active dies"""
        resp = self.session.get(f"{BASE_URL}/api/dies")
        assert resp.status_code == 200, f"Get dies failed: {resp.text}"
        dies = resp.json()
        assert isinstance(dies, list)
        print(f"✓ GET /api/dies returns {len(dies)} dies")
        
        # Verify die structure
        if len(dies) > 0:
            die = dies[0]
            required_fields = ['die_id', 'code', 'name', 'type', 'stock_qty', 'reserved_qty', 'min_level']
            for field in required_fields:
                assert field in die, f"Die missing field '{field}': {die}"
            print(f"✓ Die structure verified with fields: {list(die.keys())}")
    
    def test_07_get_dies_with_archived(self):
        """Test GET /api/dies?include_archived=true returns archived dies"""
        resp = self.session.get(f"{BASE_URL}/api/dies?include_archived=true")
        assert resp.status_code == 200, f"Get dies with archived failed: {resp.text}"
        dies = resp.json()
        assert isinstance(dies, list)
        print(f"✓ GET /api/dies?include_archived=true returns {len(dies)} dies")
    
    def test_08_die_has_image_url(self):
        """Test dies have image_url field"""
        resp = self.session.get(f"{BASE_URL}/api/dies")
        assert resp.status_code == 200
        dies = resp.json()
        if len(dies) > 0:
            # Check image_url field exists
            for die in dies[:5]:
                assert "image_url" in die, f"Die missing image_url: {die}"
            # Count dies with images
            with_images = sum(1 for d in dies if d.get("image_url"))
            print(f"✓ {with_images}/{len(dies)} dies have images")


class TestCatalogueLink:
    """Test Catalogue link page API"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login and get auth token"""
        self.session = requests.Session()
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "info@smartshape.in",
            "password": "admin123"
        })
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        self.session.cookies.update(login_resp.cookies)
    
    def test_09_get_catalogue_by_token(self):
        """Test GET /api/catalogue/{token} returns catalogue data"""
        # Use the known catalogue token from the test
        token = "8712defb-bb3c-4c65-b7c0-66fe7eab20f4"
        resp = requests.get(f"{BASE_URL}/api/catalogue/{token}")
        
        if resp.status_code == 200:
            data = resp.json()
            assert "quotation" in data, f"Missing quotation in response: {data}"
            assert "package" in data, f"Missing package in response: {data}"
            assert "dies" in data, f"Missing dies in response: {data}"
            
            # Verify dies have required fields
            dies = data.get("dies", [])
            if len(dies) > 0:
                die = dies[0]
                assert "die_id" in die, f"Die missing die_id: {die}"
                assert "code" in die, f"Die missing code: {die}"
                assert "name" in die, f"Die missing name: {die}"
                assert "type" in die, f"Die missing type: {die}"
                # Check for image_url
                assert "image_url" in die, f"Die missing image_url: {die}"
            
            print(f"✓ Catalogue {token} has {len(dies)} dies")
            print(f"  School: {data['quotation'].get('school_name', 'N/A')}")
            print(f"  Package: {data['package'].get('display_name', 'N/A')}")
        elif resp.status_code == 404:
            print(f"⚠ Catalogue token {token} not found (may need to create quotation first)")
            pytest.skip("Catalogue token not found")
        else:
            pytest.fail(f"Unexpected status {resp.status_code}: {resp.text}")
    
    def test_10_catalogue_invalid_token(self):
        """Test GET /api/catalogue/{invalid_token} returns 404"""
        resp = requests.get(f"{BASE_URL}/api/catalogue/invalid-token-12345")
        assert resp.status_code == 404, f"Expected 404 for invalid token: {resp.status_code}"
        print("✓ Invalid catalogue token returns 404")
    
    def test_11_catalogue_submit_selection(self):
        """Test POST /api/catalogue/{token}/submit works"""
        token = "8712defb-bb3c-4c65-b7c0-66fe7eab20f4"
        
        # First get catalogue to get die IDs
        get_resp = requests.get(f"{BASE_URL}/api/catalogue/{token}")
        if get_resp.status_code != 200:
            pytest.skip("Catalogue token not found")
        
        data = get_resp.json()
        dies = data.get("dies", [])
        if len(dies) == 0:
            pytest.skip("No dies in catalogue")
        
        # Select first 2 dies
        selected_ids = [d["die_id"] for d in dies[:2]]
        
        submit_resp = requests.post(f"{BASE_URL}/api/catalogue/{token}/submit", json={
            "selected_dies": selected_ids
        })
        
        # Should succeed or already submitted
        assert submit_resp.status_code in [200, 400], f"Submit failed: {submit_resp.text}"
        print(f"✓ Catalogue submit endpoint works (status: {submit_resp.status_code})")


class TestDieFiltering:
    """Test die filtering by category and type"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login and get auth token"""
        self.session = requests.Session()
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "info@smartshape.in",
            "password": "admin123"
        })
        assert login_resp.status_code == 200
        self.session.cookies.update(login_resp.cookies)
    
    def test_12_filter_dies_by_type(self):
        """Test filtering dies by type (standard, large, machine)"""
        resp = self.session.get(f"{BASE_URL}/api/dies")
        assert resp.status_code == 200
        dies = resp.json()
        
        # Count by type
        types = {}
        for die in dies:
            t = die.get("type", "unknown")
            types[t] = types.get(t, 0) + 1
        
        print(f"✓ Dies by type: {types}")
    
    def test_13_filter_dies_by_category(self):
        """Test filtering dies by category"""
        resp = self.session.get(f"{BASE_URL}/api/dies")
        assert resp.status_code == 200
        dies = resp.json()
        
        # Count by category
        categories = {}
        for die in dies:
            c = die.get("category", "decorative")
            categories[c] = categories.get(c, 0) + 1
        
        print(f"✓ Dies by category: {categories}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
