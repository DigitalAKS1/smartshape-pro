"""
Iteration 11 Tests: Leave Management & Theme Toggle
- Leave CRUD APIs (apply, approve/reject, cancel, balance)
- Permission checks (admin/HR can approve, anyone can apply)
- Leave balance tracking per year
"""
import pytest
import requests
import os
from datetime import datetime, timedelta

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestLeaveManagement:
    """Leave Management API Tests"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup test data and auth"""
        self.admin_creds = {"email": "info@smartshape.in", "password": "admin123"}
        self.hr_creds = {"email": "hr@smartshape.in", "password": "demo@123"}
        self.sales_creds = {"email": "sales@smartshape.in", "password": "demo@123"}
        self.session = requests.Session()
        
    def login(self, creds):
        """Login and return session with cookies"""
        session = requests.Session()
        resp = session.post(f"{BASE_URL}/api/auth/login", json=creds)
        return session, resp
    
    def test_admin_login(self):
        """Test admin can login"""
        session, resp = self.login(self.admin_creds)
        assert resp.status_code == 200, f"Admin login failed: {resp.text}"
        data = resp.json()
        assert data.get("email") == "info@smartshape.in"
        assert data.get("role") == "admin"
        print("✓ Admin login successful")
        
    def test_apply_leave_as_admin(self):
        """Test applying leave as admin"""
        session, login_resp = self.login(self.admin_creds)
        assert login_resp.status_code == 200
        
        # Apply leave
        tomorrow = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
        leave_data = {
            "leave_type": "casual",
            "from_date": tomorrow,
            "to_date": tomorrow,
            "half_day": False,
            "reason": "TEST_Admin leave application"
        }
        resp = session.post(f"{BASE_URL}/api/leaves", json=leave_data)
        assert resp.status_code == 200, f"Apply leave failed: {resp.text}"
        data = resp.json()
        assert data.get("leave_type") == "casual"
        assert data.get("status") == "pending"
        assert data.get("from_date") == tomorrow
        assert "leave_id" in data
        print(f"✓ Leave applied successfully: {data.get('leave_id')}")
        
        # Cleanup - cancel the leave
        leave_id = data.get("leave_id")
        session.delete(f"{BASE_URL}/api/leaves/{leave_id}")
        
    def test_apply_leave_with_half_day(self):
        """Test applying half day leave"""
        session, login_resp = self.login(self.admin_creds)
        assert login_resp.status_code == 200
        
        tomorrow = (datetime.now() + timedelta(days=2)).strftime("%Y-%m-%d")
        leave_data = {
            "leave_type": "sick",
            "from_date": tomorrow,
            "to_date": tomorrow,
            "half_day": True,
            "reason": "TEST_Half day sick leave"
        }
        resp = session.post(f"{BASE_URL}/api/leaves", json=leave_data)
        assert resp.status_code == 200, f"Apply half day leave failed: {resp.text}"
        data = resp.json()
        assert data.get("half_day") == True
        assert data.get("days") == 0.5
        print(f"✓ Half day leave applied: {data.get('leave_id')}")
        
        # Cleanup
        session.delete(f"{BASE_URL}/api/leaves/{data.get('leave_id')}")
        
    def test_get_leaves_list(self):
        """Test getting leaves list"""
        session, login_resp = self.login(self.admin_creds)
        assert login_resp.status_code == 200
        
        resp = session.get(f"{BASE_URL}/api/leaves")
        assert resp.status_code == 200, f"Get leaves failed: {resp.text}"
        data = resp.json()
        assert isinstance(data, list)
        print(f"✓ Got {len(data)} leaves")
        
    def test_get_leave_balance(self):
        """Test getting leave balance"""
        session, login_resp = self.login(self.admin_creds)
        assert login_resp.status_code == 200
        
        resp = session.get(f"{BASE_URL}/api/leaves/balance")
        assert resp.status_code == 200, f"Get balance failed: {resp.text}"
        data = resp.json()
        
        # Verify balance structure
        assert "total" in data, "Missing 'total' in balance"
        assert "used" in data, "Missing 'used' in balance"
        assert "balance" in data, "Missing 'balance' in balance"
        
        # Verify default totals
        assert data["total"].get("casual") == 12, f"Casual total should be 12, got {data['total'].get('casual')}"
        assert data["total"].get("sick") == 6, f"Sick total should be 6, got {data['total'].get('sick')}"
        assert data["total"].get("earned") == 15, f"Earned total should be 15, got {data['total'].get('earned')}"
        
        print(f"✓ Leave balance: Casual={data['balance'].get('casual')}, Sick={data['balance'].get('sick')}, Earned={data['balance'].get('earned')}")
        
    def test_admin_can_approve_leave(self):
        """Test admin can approve leaves"""
        session, login_resp = self.login(self.admin_creds)
        assert login_resp.status_code == 200
        
        # First apply a leave
        tomorrow = (datetime.now() + timedelta(days=3)).strftime("%Y-%m-%d")
        leave_data = {
            "leave_type": "earned",
            "from_date": tomorrow,
            "to_date": tomorrow,
            "half_day": False,
            "reason": "TEST_Leave for approval test"
        }
        apply_resp = session.post(f"{BASE_URL}/api/leaves", json=leave_data)
        assert apply_resp.status_code == 200
        leave_id = apply_resp.json().get("leave_id")
        
        # Approve the leave
        approve_resp = session.put(f"{BASE_URL}/api/leaves/{leave_id}/approve", json={"status": "approved", "remarks": "Approved by admin"})
        assert approve_resp.status_code == 200, f"Approve failed: {approve_resp.text}"
        data = approve_resp.json()
        assert data.get("status") == "approved"
        assert data.get("approved_by") == "info@smartshape.in"
        print(f"✓ Admin approved leave: {leave_id}")
        
        # Cleanup - delete the leave
        session.delete(f"{BASE_URL}/api/leaves/{leave_id}")
        
    def test_admin_can_reject_leave(self):
        """Test admin can reject leaves"""
        session, login_resp = self.login(self.admin_creds)
        assert login_resp.status_code == 200
        
        # Apply a leave
        tomorrow = (datetime.now() + timedelta(days=4)).strftime("%Y-%m-%d")
        leave_data = {
            "leave_type": "casual",
            "from_date": tomorrow,
            "to_date": tomorrow,
            "reason": "TEST_Leave for rejection test"
        }
        apply_resp = session.post(f"{BASE_URL}/api/leaves", json=leave_data)
        assert apply_resp.status_code == 200
        leave_id = apply_resp.json().get("leave_id")
        
        # Reject the leave
        reject_resp = session.put(f"{BASE_URL}/api/leaves/{leave_id}/approve", json={"status": "rejected", "remarks": "Rejected by admin"})
        assert reject_resp.status_code == 200, f"Reject failed: {reject_resp.text}"
        data = reject_resp.json()
        assert data.get("status") == "rejected"
        print(f"✓ Admin rejected leave: {leave_id}")
        
        # Cleanup
        session.delete(f"{BASE_URL}/api/leaves/{leave_id}")
        
    def test_cancel_own_pending_leave(self):
        """Test user can cancel their own pending leave"""
        session, login_resp = self.login(self.admin_creds)
        assert login_resp.status_code == 200
        
        # Apply a leave
        tomorrow = (datetime.now() + timedelta(days=5)).strftime("%Y-%m-%d")
        leave_data = {
            "leave_type": "casual",
            "from_date": tomorrow,
            "to_date": tomorrow,
            "reason": "TEST_Leave for cancel test"
        }
        apply_resp = session.post(f"{BASE_URL}/api/leaves", json=leave_data)
        assert apply_resp.status_code == 200
        leave_id = apply_resp.json().get("leave_id")
        
        # Cancel the leave
        cancel_resp = session.delete(f"{BASE_URL}/api/leaves/{leave_id}")
        assert cancel_resp.status_code == 200, f"Cancel failed: {cancel_resp.text}"
        print(f"✓ User cancelled own pending leave: {leave_id}")
        
    def test_cannot_cancel_approved_leave(self):
        """Test user cannot cancel approved leave"""
        session, login_resp = self.login(self.admin_creds)
        assert login_resp.status_code == 200
        
        # Apply and approve a leave
        tomorrow = (datetime.now() + timedelta(days=6)).strftime("%Y-%m-%d")
        leave_data = {
            "leave_type": "casual",
            "from_date": tomorrow,
            "to_date": tomorrow,
            "reason": "TEST_Leave for cancel approved test"
        }
        apply_resp = session.post(f"{BASE_URL}/api/leaves", json=leave_data)
        assert apply_resp.status_code == 200
        leave_id = apply_resp.json().get("leave_id")
        
        # Approve it
        session.put(f"{BASE_URL}/api/leaves/{leave_id}/approve", json={"status": "approved"})
        
        # Try to cancel - should fail
        cancel_resp = session.delete(f"{BASE_URL}/api/leaves/{leave_id}")
        assert cancel_resp.status_code == 400, f"Should not be able to cancel approved leave, got {cancel_resp.status_code}"
        print("✓ Cannot cancel approved leave (expected 400)")
        
    def test_unauthenticated_cannot_access_leaves(self):
        """Test unauthenticated user cannot access leaves"""
        session = requests.Session()
        resp = session.get(f"{BASE_URL}/api/leaves")
        assert resp.status_code == 401, f"Should be 401, got {resp.status_code}"
        print("✓ Unauthenticated access blocked (401)")
        
    def test_leave_types_supported(self):
        """Test all leave types are supported"""
        session, login_resp = self.login(self.admin_creds)
        assert login_resp.status_code == 200
        
        for leave_type in ["casual", "sick", "earned"]:
            tomorrow = (datetime.now() + timedelta(days=7 + ["casual", "sick", "earned"].index(leave_type))).strftime("%Y-%m-%d")
            leave_data = {
                "leave_type": leave_type,
                "from_date": tomorrow,
                "to_date": tomorrow,
                "reason": f"TEST_{leave_type} leave type test"
            }
            resp = session.post(f"{BASE_URL}/api/leaves", json=leave_data)
            assert resp.status_code == 200, f"Failed to apply {leave_type} leave: {resp.text}"
            data = resp.json()
            assert data.get("leave_type") == leave_type
            # Cleanup
            session.delete(f"{BASE_URL}/api/leaves/{data.get('leave_id')}")
            print(f"✓ {leave_type.capitalize()} leave type supported")


class TestHRUserPermissions:
    """Test HR user permissions for leave management"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.admin_creds = {"email": "info@smartshape.in", "password": "admin123"}
        self.hr_creds = {"email": "hr@smartshape.in", "password": "demo@123"}
        self.sales_creds = {"email": "sales@smartshape.in", "password": "demo@123"}
        
    def login(self, creds):
        session = requests.Session()
        resp = session.post(f"{BASE_URL}/api/auth/login", json=creds)
        return session, resp
        
    def test_create_hr_user_if_not_exists(self):
        """Ensure HR user exists for testing"""
        # Try to login as HR
        session, resp = self.login(self.hr_creds)
        if resp.status_code == 200:
            print("✓ HR user already exists")
            return
            
        # Create HR user via admin
        admin_session, admin_resp = self.login(self.admin_creds)
        assert admin_resp.status_code == 200
        
        # Register HR user
        register_resp = requests.post(f"{BASE_URL}/api/auth/register", json={
            "email": "hr@smartshape.in",
            "password": "demo@123",
            "name": "HR Manager",
            "role": "sales_person"
        })
        
        if register_resp.status_code in [200, 400]:  # 400 if already exists
            # Update user to have HR module
            users_resp = admin_session.get(f"{BASE_URL}/api/users")
            if users_resp.status_code == 200:
                users = users_resp.json()
                hr_user = next((u for u in users if u.get("email") == "hr@smartshape.in"), None)
                if hr_user:
                    admin_session.put(f"{BASE_URL}/api/users/{hr_user.get('user_id')}", json={
                        "assigned_modules": ["hr", "leave_management"]
                    })
            print("✓ HR user created/updated")
            
    def test_create_sales_user_if_not_exists(self):
        """Ensure Sales user exists for testing"""
        session, resp = self.login(self.sales_creds)
        if resp.status_code == 200:
            print("✓ Sales user already exists")
            return
            
        # Register sales user
        register_resp = requests.post(f"{BASE_URL}/api/auth/register", json={
            "email": "sales@smartshape.in",
            "password": "demo@123",
            "name": "Sales Person",
            "role": "sales_person"
        })
        print(f"✓ Sales user registration: {register_resp.status_code}")


class TestNonHRUserPermissions:
    """Test that non-HR users cannot approve leaves"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.admin_creds = {"email": "info@smartshape.in", "password": "admin123"}
        self.sales_creds = {"email": "sales@smartshape.in", "password": "demo@123"}
        
    def login(self, creds):
        session = requests.Session()
        resp = session.post(f"{BASE_URL}/api/auth/login", json=creds)
        return session, resp
        
    def test_non_hr_cannot_approve_leave(self):
        """Test non-HR user cannot approve leaves (should get 403)"""
        # First create a leave as admin
        admin_session, admin_resp = self.login(self.admin_creds)
        if admin_resp.status_code != 200:
            pytest.skip("Admin login failed")
            
        tomorrow = (datetime.now() + timedelta(days=10)).strftime("%Y-%m-%d")
        leave_data = {
            "leave_type": "casual",
            "from_date": tomorrow,
            "to_date": tomorrow,
            "reason": "TEST_Leave for non-HR approval test"
        }
        apply_resp = admin_session.post(f"{BASE_URL}/api/leaves", json=leave_data)
        if apply_resp.status_code != 200:
            pytest.skip("Could not create test leave")
        leave_id = apply_resp.json().get("leave_id")
        
        # Try to approve as sales user (non-HR)
        sales_session, sales_resp = self.login(self.sales_creds)
        if sales_resp.status_code != 200:
            # Cleanup and skip
            admin_session.delete(f"{BASE_URL}/api/leaves/{leave_id}")
            pytest.skip("Sales user login failed - user may not exist")
            
        # Check if sales user has HR module
        user_data = sales_resp.json()
        has_hr = "hr" in (user_data.get("assigned_modules") or [])
        
        if has_hr:
            # User has HR module, so they can approve
            admin_session.delete(f"{BASE_URL}/api/leaves/{leave_id}")
            pytest.skip("Sales user has HR module - cannot test non-HR restriction")
            
        # Try to approve - should fail with 403
        approve_resp = sales_session.put(f"{BASE_URL}/api/leaves/{leave_id}/approve", json={"status": "approved"})
        
        # Cleanup
        admin_session.delete(f"{BASE_URL}/api/leaves/{leave_id}")
        
        assert approve_resp.status_code == 403, f"Non-HR user should get 403, got {approve_resp.status_code}"
        print("✓ Non-HR user cannot approve leaves (403)")


class TestLeaveBalanceCalculation:
    """Test leave balance calculation"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        self.admin_creds = {"email": "info@smartshape.in", "password": "admin123"}
        
    def login(self, creds):
        session = requests.Session()
        resp = session.post(f"{BASE_URL}/api/auth/login", json=creds)
        return session, resp
        
    def test_balance_defaults(self):
        """Test default leave balance values"""
        session, login_resp = self.login(self.admin_creds)
        assert login_resp.status_code == 200
        
        resp = session.get(f"{BASE_URL}/api/leaves/balance")
        assert resp.status_code == 200
        data = resp.json()
        
        # Verify defaults
        assert data["total"]["casual"] == 12
        assert data["total"]["sick"] == 6
        assert data["total"]["earned"] == 15
        
        # Balance should be total - used
        for lt in ["casual", "sick", "earned"]:
            expected_balance = data["total"][lt] - data["used"].get(lt, 0)
            assert data["balance"][lt] == expected_balance, f"{lt} balance mismatch"
            
        print("✓ Leave balance defaults correct")
        
    def test_half_days_tracked(self):
        """Test half days are tracked separately"""
        session, login_resp = self.login(self.admin_creds)
        assert login_resp.status_code == 200
        
        resp = session.get(f"{BASE_URL}/api/leaves/balance")
        assert resp.status_code == 200
        data = resp.json()
        
        assert "half_days_used" in data, "half_days_used should be in balance response"
        print(f"✓ Half days tracked: {data.get('half_days_used', 0)} used")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
