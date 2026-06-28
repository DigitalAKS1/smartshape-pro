from fastapi import APIRouter, Request, HTTPException
from datetime import datetime, timezone
import json
import base64
import logging
import asyncio
import os

from database import db
from auth_utils import get_current_user

router = APIRouter()
logger = logging.getLogger(__name__)

# ── Firebase Cloud Messaging (native iOS/Android push) ───────────────────────────
# Web push (above) uses VAPID/pywebpush for browsers. Native apps need FCM, which
# relays to APNs on iOS. The Firebase Admin app is initialised lazily from
# FCM_SERVICE_ACCOUNT_JSON (a path to the service-account file, or the raw JSON).
_fcm_app = None


def _ensure_fcm_app():
    """Initialise the Firebase Admin app once. Returns None if not configured."""
    global _fcm_app
    if _fcm_app is not None:
        return _fcm_app
    raw = os.environ.get("FCM_SERVICE_ACCOUNT_JSON")
    if not raw:
        return None
    try:
        import firebase_admin
        from firebase_admin import credentials
        if os.path.exists(raw):
            cred = credentials.Certificate(raw)
        else:
            cred = credentials.Certificate(json.loads(raw))
        _fcm_app = firebase_admin.initialize_app(cred, name="smartshape-fcm")
        logger.info("[fcm] Firebase Admin initialised")
        return _fcm_app
    except Exception as exc:
        logger.warning(f"[fcm] init failed: {exc}")
        return None


async def send_fcm_to_user(email: str, title: str, body: str, data: dict | None = None) -> int:
    """Send a native FCM push to every device token registered for `email`.
    Returns the number of successful sends. Never raises — safe for schedulers."""
    try:
        if _ensure_fcm_app() is None:
            return 0
        from firebase_admin import messaging
        tokens = await db.fcm_tokens.find({"email": email}).to_list(20)
        if not tokens:
            return 0
        sent, dead = 0, []
        str_data = {k: str(v) for k, v in (data or {}).items()}
        for t in tokens:
            try:
                msg = messaging.Message(
                    notification=messaging.Notification(title=title, body=body),
                    data=str_data,
                    token=t["fcm_token"],
                )
                await asyncio.get_event_loop().run_in_executor(
                    None, lambda m=msg: messaging.send(m, app=_fcm_app)
                )
                sent += 1
            except messaging.UnregisteredError:
                dead.append(t["fcm_token"])
            except Exception as exc:
                logger.warning(f"[fcm] send failed for {email}: {exc}")
        if dead:
            await db.fcm_tokens.delete_many({"fcm_token": {"$in": dead}})
        return sent
    except Exception as exc:
        logger.warning(f"[fcm] send_fcm_to_user error ({email}): {exc}")
        return 0


async def notify_user(email: str, title: str, body: str, url: str = "/today", tag: str = "general") -> int:
    """Fan a notification out to BOTH web push and native FCM for `email`."""
    web = await send_push_to_user(email, title, body, url, tag)
    fcm = await send_fcm_to_user(email, title, body, {"url": url, "tag": tag})
    return web + fcm

# ── VAPID key management ───────────────────────────────────────────────────────

async def _ensure_vapid():
    """Load VAPID keys from DB, auto-generate once if missing."""
    doc = await db.app_config.find_one({"_id": "vapid"})
    if doc:
        return doc["private_pem"], doc["public_b64url"]

    from pywebpush import Vapid
    from cryptography.hazmat.primitives import serialization

    v = Vapid()
    v.generate_keys()

    private_pem = v.private_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.TraditionalOpenSSL,
        serialization.NoEncryption(),
    ).decode()

    raw_pub = v.public_key.public_bytes(
        serialization.Encoding.X962,
        serialization.PublicFormat.UncompressedPoint,
    )
    public_b64url = base64.urlsafe_b64encode(raw_pub).rstrip(b"=").decode()

    await db.app_config.update_one(
        {"_id": "vapid"},
        {"$set": {
            "private_pem": private_pem,
            "public_b64url": public_b64url,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True,
    )
    logger.info("[push] Generated new VAPID key pair")
    return private_pem, public_b64url


# ── Core send helper — import this from other routes ─────────────────────────

async def send_push_to_user(email: str, title: str, body: str, url: str = "/today", tag: str = "general"):
    """
    Send a web push to every browser subscription registered for `email`.
    Returns the number of successful sends. Never raises — safe to call from schedulers.
    """
    try:
        private_pem, _ = await _ensure_vapid()
        subs = await db.push_subscriptions.find({"email": email}).to_list(20)
        if not subs:
            return 0

        from pywebpush import webpush, WebPushException
        from py_vapid import Vapid01

        # pywebpush 2.x rejects a multiline PEM *string* for vapid_private_key
        # (it base64-decodes it as raw DER and raises "Could not deserialize key
        # data"). Build a Vapid object from the PEM and pass that instead.
        vapid_obj = Vapid01.from_pem(private_pem.encode())

        payload = json.dumps({"title": title, "body": body, "url": url, "tag": tag})
        sent = 0
        expired_ids = []

        for sub in subs:
            try:
                await asyncio.get_event_loop().run_in_executor(
                    None,
                    lambda s=sub: webpush(
                        subscription_info=s["subscription"],
                        data=payload,
                        vapid_private_key=vapid_obj,
                        vapid_claims={"sub": "mailto:info@smartshape.in"},
                    ),
                )
                sent += 1
            except WebPushException as exc:
                status = str(exc)
                if "410" in status or "404" in status:
                    expired_ids.append(sub.get("_id"))
                else:
                    logger.warning(f"[push] send failed for {email}: {exc}")
            except Exception as exc:
                logger.warning(f"[push] unexpected error for {email}: {exc}")

        if expired_ids:
            await db.push_subscriptions.delete_many({"_id": {"$in": expired_ids}})

        return sent
    except Exception as exc:
        logger.warning(f"[push] send_push_to_user error ({email}): {exc}")
        return 0


async def send_push_to_all_admins(title: str, body: str, url: str = "/today", tag: str = "admin"):
    """Broadcast a push to all admin users."""
    try:
        admins = await db.users.find({"role": "admin"}, {"_id": 0, "email": 1}).to_list(50)
        for a in admins:
            await send_push_to_user(a["email"], title, body, url, tag)
    except Exception as exc:
        logger.warning(f"[push] send_push_to_all_admins error: {exc}")


# ── API Endpoints ──────────────────────────────────────────────────────────────

@router.get("/push/public-key")
async def get_vapid_public_key():
    """Return the VAPID public key so the frontend can subscribe."""
    _, public_b64url = await _ensure_vapid()
    return {"public_key": public_b64url}


@router.post("/push/subscribe")
async def subscribe_push(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    subscription = body.get("subscription")
    if not subscription or not subscription.get("endpoint"):
        raise HTTPException(400, "Invalid subscription object")

    endpoint = subscription["endpoint"]
    await db.push_subscriptions.update_one(
        {"email": user["email"], "endpoint": endpoint},
        {"$set": {
            "email": user["email"],
            "name": user.get("name", ""),
            "role": user.get("role", ""),
            "endpoint": endpoint,
            "subscription": subscription,
            "subscribed_at": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True,
    )
    logger.info(f"[push] subscribed: {user['email']}")
    return {"ok": True}


@router.delete("/push/unsubscribe")
async def unsubscribe_push(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    endpoint = body.get("endpoint")
    if endpoint:
        await db.push_subscriptions.delete_many({"email": user["email"], "endpoint": endpoint})
    else:
        await db.push_subscriptions.delete_many({"email": user["email"]})
    logger.info(f"[push] unsubscribed: {user['email']}")
    return {"ok": True}


@router.post("/push/test")
async def test_push(request: Request):
    user = await get_current_user(request)
    sent = await send_push_to_user(
        user["email"],
        "SmartShape Pro",
        "Push notifications are working! You'll get alerts even when the app is closed.",
        "/today",
        "test",
    )
    if sent == 0:
        raise HTTPException(400, "No active subscriptions found. Enable push notifications first.")
    return {"ok": True, "sent": sent}


# ── Native FCM token registration (mobile) ───────────────────────────────────────

@router.post("/push/fcm/register")
async def register_fcm_token(request: Request):
    """Register a native device's FCM token for the logged-in user."""
    user = await get_current_user(request)
    body = await request.json()
    fcm_token = body.get("fcm_token")
    platform = body.get("platform", "")
    if not fcm_token:
        raise HTTPException(400, "fcm_token required")
    await db.fcm_tokens.update_one(
        {"email": user["email"], "fcm_token": fcm_token},
        {"$set": {
            "email": user["email"],
            "name": user.get("name", ""),
            "role": user.get("role", ""),
            "fcm_token": fcm_token,
            "platform": platform,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True,
    )
    logger.info(f"[fcm] registered token for {user['email']} ({platform})")
    return {"ok": True}


@router.delete("/push/fcm/unregister")
async def unregister_fcm_token(request: Request):
    """Remove a device's FCM token (logout / token rotation). Empty body removes all."""
    user = await get_current_user(request)
    try:
        body = await request.json()
    except Exception:
        body = {}
    fcm_token = body.get("fcm_token")
    if fcm_token:
        await db.fcm_tokens.delete_many({"email": user["email"], "fcm_token": fcm_token})
    else:
        await db.fcm_tokens.delete_many({"email": user["email"]})
    return {"ok": True}


@router.post("/push/fcm/test")
async def test_fcm(request: Request):
    """Send a test FCM push to the current user's registered devices."""
    user = await get_current_user(request)
    sent = await send_fcm_to_user(
        user["email"],
        "SmartShape Sales",
        "Push is working! You'll get alerts even when the app is closed.",
        {"url": "/dashboard", "tag": "test"},
    )
    if sent == 0:
        raise HTTPException(400, "No registered devices (or FCM not configured on the server).")
    return {"ok": True, "sent": sent}
