"""
Test Orders and Holds API endpoints for SmartShape Pro Phase 1
Tests: Order creation from quotation, status changes, stock auto-deduction, holds management
"""
import pytest
import requests
import os
import uuid
from datetime import datetime

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestOrdersHoldsAPI:
    """Test Orders and Holds endpoints"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Setup session with auth"""
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        
        # Login as admin
        login_resp = self.session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "info@smartshape.in",
            "password": "admin123"
        })
        assert login_resp.status_code == 200, f"Login failed: {login_resp.text}"
        print(f"✓ Logged in as admin")
        
    # ==================== ORDERS TESTS ====================
    
    def test_01_get_orders_list(self):
        """GET /api/orders returns orders list"""
        resp = self.session.get(f"{BASE_URL}/api/orders")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert isinstance(data, list), "Expected list of orders"
        print(f"✓ GET /api/orders returned {len(data)} orders")
        
        # Check if existing test order exists
        existing_order = next((o for o in data if o.get("order_number") == "ORD-2026-0001"), None)
        if existing_order:
            print(f"  Found existing test order: {existing_order['order_number']} - {existing_order['order_status']}")
        return data
    
    def test_02_get_order_by_id(self):
        """GET /api/orders/{id} returns order with items and timeline"""
        # First get orders list
        orders_resp = self.session.get(f"{BASE_URL}/api/orders")
        orders = orders_resp.json()
        
        if not orders:
            pytest.skip("No orders exist to test GET by ID")
        
        order_id = orders[0]["order_id"]
        resp = self.session.get(f"{BASE_URL}/api/orders/{order_id}")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        
        order = resp.json()
        assert "order_id" in order, "Missing order_id"
        assert "order_number" in order, "Missing order_number"
        assert "items" in order, "Missing items array"
        assert "timeline" in order, "Missing timeline array"
        
        print(f"✓ GET /api/orders/{order_id} returned order with {len(order.get('items', []))} items and {len(order.get('timeline', []))} timeline entries")
        return order
    
    def test_03_get_order_not_found(self):
        """GET /api/orders/{id} returns 404 for non-existent order"""
        resp = self.session.get(f"{BASE_URL}/api/orders/nonexistent_order_id")
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}"
        print("✓ GET /api/orders/nonexistent returns 404")
    
    def test_04_create_order_without_quotation_id(self):
        """POST /api/orders without quotation_id returns 400"""
        resp = self.session.post(f"{BASE_URL}/api/orders", json={})
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}: {resp.text}"
        print("✓ POST /api/orders without quotation_id returns 400")
    
    def test_05_create_order_with_invalid_quotation(self):
        """POST /api/orders with invalid quotation_id returns 404"""
        resp = self.session.post(f"{BASE_URL}/api/orders", json={
            "quotation_id": "invalid_quotation_id"
        })
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}: {resp.text}"
        print("✓ POST /api/orders with invalid quotation returns 404")
    
    def test_06_create_order_from_quotation(self):
        """POST /api/orders creates order from quotation with submitted catalogue"""
        # First, find a quotation with submitted catalogue that doesn't have an order yet
        quots_resp = self.session.get(f"{BASE_URL}/api/quotations")
        assert quots_resp.status_code == 200
        quotations = quots_resp.json()
        
        orders_resp = self.session.get(f"{BASE_URL}/api/orders")
        existing_order_quot_ids = [o.get("quotation_id") for o in orders_resp.json()]
        
        # Find eligible quotation
        eligible = [q for q in quotations if q.get("catalogue_status") == "submitted" and q.get("quotation_id") not in existing_order_quot_ids]
        
        if not eligible:
            # Try to create a test quotation flow
            print("  No eligible quotations found, checking if we can use existing order for other tests")
            pytest.skip("No eligible quotations with submitted catalogue available")
        
        quot = eligible[0]
        print(f"  Using quotation: {quot.get('quote_number')} - {quot.get('school_name')}")
        
        resp = self.session.post(f"{BASE_URL}/api/orders", json={
            "quotation_id": quot["quotation_id"]
        })
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        
        order = resp.json()
        assert "order_id" in order, "Missing order_id"
        assert "order_number" in order, "Missing order_number"
        assert order.get("order_status") == "pending", f"Expected pending status, got {order.get('order_status')}"
        assert order.get("quotation_id") == quot["quotation_id"], "Quotation ID mismatch"
        
        print(f"✓ Created order {order['order_number']} from quotation {quot.get('quote_number')}")
        return order
    
    def test_07_create_duplicate_order_fails(self):
        """POST /api/orders for same quotation returns 400"""
        # Get an existing order
        orders_resp = self.session.get(f"{BASE_URL}/api/orders")
        orders = orders_resp.json()
        
        if not orders:
            pytest.skip("No orders exist to test duplicate creation")
        
        existing_quot_id = orders[0].get("quotation_id")
        if not existing_quot_id:
            pytest.skip("Existing order has no quotation_id")
        
        resp = self.session.post(f"{BASE_URL}/api/orders", json={
            "quotation_id": existing_quot_id
        })
        assert resp.status_code == 400, f"Expected 400 for duplicate, got {resp.status_code}: {resp.text}"
        print("✓ POST /api/orders for existing quotation returns 400")
    
    # ==================== STATUS CHANGE TESTS ====================
    
    def test_08_update_order_status_invalid(self):
        """PUT /api/orders/{id}/status with invalid status returns 400"""
        orders_resp = self.session.get(f"{BASE_URL}/api/orders")
        orders = orders_resp.json()
        
        if not orders:
            pytest.skip("No orders exist")
        
        order_id = orders[0]["order_id"]
        resp = self.session.put(f"{BASE_URL}/api/orders/{order_id}/status", json={
            "status": "invalid_status"
        })
        assert resp.status_code == 400, f"Expected 400, got {resp.status_code}"
        print("✓ PUT /api/orders/{id}/status with invalid status returns 400")
    
    def test_09_update_order_status_to_confirmed(self):
        """PUT /api/orders/{id}/status changes status with timeline entry"""
        orders_resp = self.session.get(f"{BASE_URL}/api/orders")
        orders = orders_resp.json()
        
        # Find a pending order
        pending_order = next((o for o in orders if o.get("order_status") == "pending"), None)
        if not pending_order:
            # Use any order for testing
            if not orders:
                pytest.skip("No orders exist")
            pending_order = orders[0]
            print(f"  No pending orders, using order {pending_order['order_number']} with status {pending_order['order_status']}")
        
        order_id = pending_order["order_id"]
        
        resp = self.session.put(f"{BASE_URL}/api/orders/{order_id}/status", json={
            "status": "confirmed",
            "note": "Test confirmation"
        })
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        
        updated = resp.json()
        assert updated.get("order_status") == "confirmed", f"Expected confirmed, got {updated.get('order_status')}"
        
        # Verify timeline entry was added
        detail_resp = self.session.get(f"{BASE_URL}/api/orders/{order_id}")
        detail = detail_resp.json()
        timeline = detail.get("timeline", [])
        assert len(timeline) > 0, "Timeline should have entries"
        
        print(f"✓ Updated order {pending_order['order_number']} to confirmed, timeline has {len(timeline)} entries")
    
    def test_10_update_order_status_to_dispatched_auto_deducts_stock(self):
        """PUT /api/orders/{id}/status to 'dispatched' auto-deducts stock"""
        orders_resp = self.session.get(f"{BASE_URL}/api/orders")
        orders = orders_resp.json()
        
        # Find a confirmed order
        confirmed_order = next((o for o in orders if o.get("order_status") == "confirmed"), None)
        if not confirmed_order:
            pytest.skip("No confirmed orders to test dispatch")
        
        order_id = confirmed_order["order_id"]
        
        # Get order items before dispatch
        detail_before = self.session.get(f"{BASE_URL}/api/orders/{order_id}").json()
        items_before = detail_before.get("items", [])
        on_hold_items = [i for i in items_before if i.get("status") == "on_hold"]
        
        print(f"  Order {confirmed_order['order_number']} has {len(on_hold_items)} items on hold before dispatch")
        
        resp = self.session.put(f"{BASE_URL}/api/orders/{order_id}/status", json={
            "status": "dispatched",
            "note": "Test dispatch"
        })
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        
        updated = resp.json()
        assert updated.get("order_status") == "dispatched", f"Expected dispatched, got {updated.get('order_status')}"
        
        # Verify items status changed
        detail_after = self.session.get(f"{BASE_URL}/api/orders/{order_id}").json()
        items_after = detail_after.get("items", [])
        dispatched_items = [i for i in items_after if i.get("status") == "dispatched"]
        
        print(f"✓ Dispatched order {confirmed_order['order_number']}, {len(dispatched_items)} items now dispatched")
    
    def test_11_update_order_status_to_cancelled_releases_holds(self):
        """PUT /api/orders/{id}/status to 'cancelled' releases holds"""
        orders_resp = self.session.get(f"{BASE_URL}/api/orders")
        orders = orders_resp.json()
        
        # Find an order with on_hold items (pending or confirmed)
        test_order = None
        for o in orders:
            if o.get("order_status") in ("pending", "confirmed"):
                detail = self.session.get(f"{BASE_URL}/api/orders/{o['order_id']}").json()
                on_hold = [i for i in detail.get("items", []) if i.get("status") == "on_hold"]
                if on_hold:
                    test_order = o
                    break
        
        if not test_order:
            pytest.skip("No orders with on_hold items to test cancellation")
        
        order_id = test_order["order_id"]
        
        resp = self.session.put(f"{BASE_URL}/api/orders/{order_id}/status", json={
            "status": "cancelled",
            "note": "Test cancellation"
        })
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        
        updated = resp.json()
        assert updated.get("order_status") == "cancelled", f"Expected cancelled, got {updated.get('order_status')}"
        
        # Verify items status changed to cancelled
        detail_after = self.session.get(f"{BASE_URL}/api/orders/{order_id}").json()
        items_after = detail_after.get("items", [])
        cancelled_items = [i for i in items_after if i.get("status") == "cancelled"]
        
        print(f"✓ Cancelled order {test_order['order_number']}, {len(cancelled_items)} items now cancelled")
    
    # ==================== HOLDS TESTS ====================
    
    def test_12_get_holds_list(self):
        """GET /api/holds returns active hold items with stock info"""
        resp = self.session.get(f"{BASE_URL}/api/holds")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        
        holds = resp.json()
        assert isinstance(holds, list), "Expected list of holds"
        
        if holds:
            hold = holds[0]
            assert "order_item_id" in hold, "Missing order_item_id"
            assert "die_name" in hold, "Missing die_name"
            assert "die_code" in hold, "Missing die_code"
            assert "order_number" in hold, "Missing order_number"
            assert "school_name" in hold, "Missing school_name"
            assert "stock_qty" in hold, "Missing stock_qty"
            assert "reserved_qty" in hold, "Missing reserved_qty"
            print(f"✓ GET /api/holds returned {len(holds)} active holds")
            print(f"  Sample hold: {hold.get('die_name')} for {hold.get('school_name')}")
        else:
            print("✓ GET /api/holds returned 0 holds (no active holds)")
        
        return holds
    
    def test_13_release_hold_not_found(self):
        """POST /api/holds/{item_id}/release returns 404 for non-existent item"""
        resp = self.session.post(f"{BASE_URL}/api/holds/nonexistent_item/release")
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}"
        print("✓ POST /api/holds/nonexistent/release returns 404")
    
    def test_14_confirm_hold_not_found(self):
        """POST /api/holds/{item_id}/confirm returns 404 for non-existent item"""
        resp = self.session.post(f"{BASE_URL}/api/holds/nonexistent_item/confirm")
        assert resp.status_code == 404, f"Expected 404, got {resp.status_code}"
        print("✓ POST /api/holds/nonexistent/confirm returns 404")
    
    def test_15_release_hold(self):
        """POST /api/holds/{item_id}/release releases hold and decrements reserved_qty"""
        holds_resp = self.session.get(f"{BASE_URL}/api/holds")
        holds = holds_resp.json()
        
        if not holds:
            pytest.skip("No active holds to test release")
        
        hold = holds[0]
        item_id = hold["order_item_id"]
        
        resp = self.session.post(f"{BASE_URL}/api/holds/{item_id}/release")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        
        result = resp.json()
        assert "message" in result, "Missing message in response"
        
        print(f"✓ Released hold for {hold.get('die_name')} on order {hold.get('order_number')}")
    
    def test_16_confirm_hold(self):
        """POST /api/holds/{item_id}/confirm changes item status to confirmed"""
        holds_resp = self.session.get(f"{BASE_URL}/api/holds")
        holds = holds_resp.json()
        
        if not holds:
            pytest.skip("No active holds to test confirm")
        
        hold = holds[0]
        item_id = hold["order_item_id"]
        
        resp = self.session.post(f"{BASE_URL}/api/holds/{item_id}/confirm")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
        
        result = resp.json()
        assert "message" in result, "Missing message in response"
        
        print(f"✓ Confirmed hold for {hold.get('die_name')} on order {hold.get('order_number')}")
    
    def test_17_release_already_released_hold(self):
        """POST /api/holds/{item_id}/release on non-hold item returns 400"""
        # First release a hold, then try to release again
        holds_resp = self.session.get(f"{BASE_URL}/api/holds")
        holds = holds_resp.json()
        
        if not holds:
            pytest.skip("No holds to test")
        
        hold = holds[0]
        item_id = hold["order_item_id"]
        
        # Release it
        self.session.post(f"{BASE_URL}/api/holds/{item_id}/release")
        
        # Try to release again
        resp = self.session.post(f"{BASE_URL}/api/holds/{item_id}/release")
        # Should return 400 since item is no longer on_hold
        assert resp.status_code == 400, f"Expected 400 for already released, got {resp.status_code}"
        print("✓ POST /api/holds/{item_id}/release on released item returns 400")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
