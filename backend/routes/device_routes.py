from fastapi import APIRouter, HTTPException, Request
from datetime import datetime, timezone
import uuid

from database import db
from auth_utils import get_current_user

router = APIRouter()


def _s(docs):
    for d in docs:
        d.pop("_id", None)
    return docs


@router.get("/admin/devices")
async def list_devices(request: Request, status: str = "all", user_email: str = ""):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    filt = {}
    if status != "all":
        filt["status"] = status
    if user_email:
        filt["user_email"] = user_email
    devices = await db.trusted_devices.find(filt, {"_id": 0}).sort("requested_at", -1).to_list(500)
    pending  = await db.trusted_devices.count_documents({"status": "pending"})
    approved = await db.trusted_devices.count_documents({"status": "approved"})
    revoked  = await db.trusted_devices.count_documents({"status": "revoked"})
    return {
        "devices": devices,
        "counts": {"pending": pending, "approved": approved, "revoked": revoked, "total": pending + approved + revoked},
    }


@router.get("/admin/devices/policy")
async def get_device_policy(request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    policy = await db.settings.find_one({"type": "device_policy"}, {"_id": 0})
    if not policy:
        return {"enforcement_enabled": False, "max_devices_per_user": 3, "auto_approve_admin": True}
    policy.pop("_id", None)
    return policy


@router.put("/admin/devices/policy")
async def save_device_policy(request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    body = await request.json()
    await db.settings.update_one(
        {"type": "device_policy"},
        {"$set": {
            "type": "device_policy",
            "enforcement_enabled": bool(body.get("enforcement_enabled", False)),
            "max_devices_per_user": int(body.get("max_devices_per_user", 3)),
            "auto_approve_admin": bool(body.get("auto_approve_admin", True)),
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "updated_by": user["email"],
        }},
        upsert=True,
    )
    return {"message": "Policy saved"}


@router.post("/admin/devices/{device_id}/approve")
async def approve_device(device_id: str, request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    result = await db.trusted_devices.update_one(
        {"device_id": device_id},
        {"$set": {
            "status": "approved",
            "approved_at": datetime.now(timezone.utc).isoformat(),
            "approved_by": user["email"],
        }},
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Device not found")
    return {"message": "Device approved"}


@router.post("/admin/devices/{device_id}/revoke")
async def revoke_device(device_id: str, request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    result = await db.trusted_devices.update_one(
        {"device_id": device_id},
        {"$set": {
            "status": "revoked",
            "revoked_at": datetime.now(timezone.utc).isoformat(),
            "revoked_by": user["email"],
        }},
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Device not found")
    return {"message": "Device revoked"}


@router.delete("/admin/devices/{device_id}")
async def delete_device(device_id: str, request: Request):
    user = await get_current_user(request)
    if user.get("role") != "admin":
        raise HTTPException(403, "Admin only")
    await db.trusted_devices.delete_one({"device_id": device_id})
    return {"message": "Device removed"}
