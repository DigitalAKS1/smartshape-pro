from fastapi import APIRouter, HTTPException, Request
from database import db
from auth_utils import get_current_school

router = APIRouter()


@router.get("/school/me")
async def school_me(request: Request):
    school = await get_current_school(request)
    school["role"] = "school"
    return school


@router.get("/school/orders")
async def school_orders(request: Request):
    school = await get_current_school(request)
    orders = await db.orders.find({"school_id": school["school_id"]}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return orders


@router.get("/school/orders/{order_id}")
async def school_order_detail(order_id: str, request: Request):
    school = await get_current_school(request)
    order = await db.orders.find_one({"order_id": order_id, "school_id": school["school_id"]}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    items = await db.order_items.find({"order_id": order_id}, {"_id": 0}).to_list(1000)
    order["items"] = items
    timeline = await db.order_timeline.find({"order_id": order_id}, {"_id": 0}).sort("timestamp", 1).to_list(100)
    order["timeline"] = timeline
    return order


@router.get("/school/quotations")
async def school_quotations(request: Request):
    school = await get_current_school(request)
    quots = await db.quotations.find({"school_id": school["school_id"]}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return quots


@router.get("/school/notifications")
async def school_notifications(request: Request):
    school = await get_current_school(request)
    notifs = await db.school_notifications.find({"school_id": school["school_id"]}, {"_id": 0}).sort("created_at", -1).to_list(50)
    return notifs


@router.put("/school/notifications/read")
async def school_mark_notifications_read(request: Request):
    school = await get_current_school(request)
    await db.school_notifications.update_many({"school_id": school["school_id"], "read": False}, {"$set": {"read": True}})
    return {"message": "All notifications marked as read"}
