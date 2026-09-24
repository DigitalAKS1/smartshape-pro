"""
Evolution API client — the REST API of the self-hosted Evolution API (v2.3.x) that gives the
CRM its WhatsApp Web connections. One Evolution *instance* = one linked WhatsApp number.

Every method names its instance. A call that omits `instance` uses the env default
(WHATSAPP_INSTANCE — the company number), so the pre-W1 callers keep working until they move
to services/wa_send.py (spec 2026-09-24, D3).

All network traffic goes through `EvolutionClient._request`: the one place the test suite stubs
(backend/tests/conftest.py) and the one place the auth header is chosen — an instance's own
token when the caller has it (instance-scoped calls), else the global apikey.
"""

import logging
import mimetypes
import os
from typing import Literal, Optional
from urllib.parse import quote

import httpx

logger = logging.getLogger(__name__)

EVOLUTION_BASE = os.getenv("EVOLUTION_API_URL", "http://localhost:8080")
EVOLUTION_KEY = os.getenv("EVOLUTION_API_KEY", "smartshape_key_change_me")
INSTANCE_NAME = os.getenv("WHATSAPP_INSTANCE", "smartshape")
_TIMEOUT_SHORT = 15.0   # control calls
_TIMEOUT_SEND = 45.0    # message sends (media can be slow)

# W1 needs CONNECTION_UPDATE / QRCODE_UPDATED / MESSAGES_UPDATE / SEND_MESSAGE; W2 ingests
# MESSAGES_UPSERT. All five are subscribed from day one so W2 needs no re-registration.
WEBHOOK_EVENTS = ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE",
                  "QRCODE_UPDATED", "SEND_MESSAGE"]

_MEDIA_MIME = {"image": "image/jpeg", "video": "video/mp4", "document": "application/octet-stream"}


def _norm_phone(phone: str) -> str:
    """Normalise an Indian phone number to E.164 without '+' (Evolution format)."""
    digits = "".join(c for c in str(phone or "") if c.isdigit())
    if len(digits) == 12 and digits.startswith("91"):
        return digits
    if len(digits) == 10:
        return "91" + digits
    if digits.startswith("0") and len(digits) == 11:
        return "91" + digits[1:]
    return digits  # pass through and let Evolution handle it


def webhook_url(instance: str) -> str:
    """The per-instance webhook Evolution posts to. Read from env at call time so the secret
    can be rotated with a backend restart and tests can set it."""
    base = os.getenv("WA_WEBHOOK_BASE", "https://app.smartshape.in").rstrip("/")
    secret = os.getenv("WA_WEBHOOK_SECRET", "")
    return f"{base}/api/webhooks/whatsapp/{quote(instance, safe='')}?t={quote(secret, safe='')}"


def instance_token(create_response: dict) -> str:
    """The instance's own API token from a /instance/create response (v2 returns `hash` as a
    string; some 2.x builds nest it as {"apikey": ...})."""
    h = (create_response or {}).get("hash")
    if isinstance(h, str):
        return h
    if isinstance(h, dict):
        return h.get("apikey") or ""
    return ""


def provider_message_id(send_response: dict) -> str:
    r = send_response or {}
    return (r.get("key") or {}).get("id") or r.get("id") or ""


class EvolutionError(RuntimeError):
    def __init__(self, status_code: int, body: str = ""):
        super().__init__(f"Evolution API {status_code}: {body[:200]}")
        self.status_code = status_code
        self.body = body


class EvolutionClient:
    def __init__(self, base: Optional[str] = None, key: Optional[str] = None,
                 instance: Optional[str] = None) -> None:
        self.base = (base or EVOLUTION_BASE).rstrip("/")
        self.instance = instance or INSTANCE_NAME
        self._key = key or EVOLUTION_KEY
        # Kept for any code that still reads it; new code never does.
        self._headers = {"apikey": self._key, "Content-Type": "application/json"}

    def _inst(self, instance: Optional[str]) -> str:
        return instance or self.instance

    async def _request(self, method: str, path: str, *, json: Optional[dict] = None,
                       token: Optional[str] = None, timeout: float = _TIMEOUT_SHORT):
        """The ONE network chokepoint."""
        headers = {"apikey": token or self._key, "Content-Type": "application/json"}
        async with httpx.AsyncClient(timeout=timeout) as c:
            r = await c.request(method, f"{self.base}{path}", headers=headers, json=json)
        if r.status_code >= 400:
            raise EvolutionError(r.status_code, r.text or "")
        try:
            return r.json()
        except ValueError:
            return {}

    # ── Instance management ────────────────────────────────────────────────────

    async def create_instance(self, instance: Optional[str] = None) -> dict:
        return await self._request("POST", "/instance/create", json={
            "instanceName": self._inst(instance),
            "integration": "WHATSAPP-BAILEYS",
            "qrcode": True,
            # W2 wants the multi-device history sync on first link (spec D6).
            "syncFullHistory": True,
        })

    async def get_qr(self, instance: Optional[str] = None, *, token: Optional[str] = None) -> dict:
        """{ 'code': '...', 'base64': 'data:image/png;base64,...', 'count': n }"""
        return await self._request("GET", f"/instance/connect/{self._inst(instance)}", token=token)

    async def get_status(self, instance: Optional[str] = None, *, token: Optional[str] = None) -> dict:
        """{ 'instance': { 'instanceName': ..., 'state': 'open'|'close'|'connecting' } }"""
        return await self._request("GET", f"/instance/connectionState/{self._inst(instance)}", token=token)

    async def connection_state(self, instance: Optional[str] = None, *, token: Optional[str] = None) -> str:
        data = await self.get_status(instance, token=token)
        return ((data.get("instance") or data).get("state") or "close") if isinstance(data, dict) else "close"

    async def fetch_instance(self, instance: str) -> dict:
        data = await self._request("GET", f"/instance/fetchInstances?instanceName={quote(instance, safe='')}")
        if isinstance(data, list):
            return data[0] if data else {}
        return data or {}

    async def logout(self, instance: Optional[str] = None, *, token: Optional[str] = None) -> dict:
        return await self._request("DELETE", f"/instance/logout/{self._inst(instance)}", token=token)

    async def delete_instance(self, instance: str) -> dict:
        return await self._request("DELETE", f"/instance/delete/{instance}")

    async def is_connected(self, instance: Optional[str] = None, *, token: Optional[str] = None) -> bool:
        try:
            return await self.connection_state(instance, token=token) == "open"
        except Exception:
            return False

    async def set_webhook(self, instance: str, *, url: Optional[str] = None,
                          events: Optional[list] = None, token: Optional[str] = None) -> dict:
        return await self._request("POST", f"/webhook/set/{instance}", token=token, json={"webhook": {
            "enabled": True,
            "url": url or webhook_url(instance),
            "byEvents": False,     # one URL; the event name is in the body
            "base64": False,       # W2 fetches media explicitly (getBase64FromMediaMessage)
            "events": list(events or WEBHOOK_EVENTS),
        }})

    async def set_proxy(self, instance: str, proxy: Optional[dict], *, token: Optional[str] = None) -> dict:
        p = proxy or {}
        return await self._request("POST", f"/proxy/set/{instance}", token=token, json={
            "enabled": bool(p.get("host")),
            "host": p.get("host", ""),
            "port": str(p.get("port") or ""),
            "protocol": p.get("protocol") or "socks5",
            "username": p.get("username", ""),
            "password": p.get("password", ""),
        })

    async def find_proxy(self, instance: str, *, token: Optional[str] = None) -> dict:
        return await self._request("GET", f"/proxy/find/{instance}", token=token) or {}

    async def check_numbers(self, numbers: list, *, instance: Optional[str] = None,
                            token: Optional[str] = None) -> dict:
        """{e164: exists} for each number, via POST /chat/whatsappNumbers/{instance}."""
        data = await self._request("POST", f"/chat/whatsappNumbers/{self._inst(instance)}",
                                   token=token, json={"numbers": list(numbers)})
        out = {}
        for item in data or []:
            num = (item.get("jid") or "").split("@")[0] or "".join(
                c for c in str(item.get("number") or "") if c.isdigit())
            if num:
                out[num] = bool(item.get("exists"))
        return out

    # ── Send ───────────────────────────────────────────────────────────────────

    async def send_text(self, phone: str, message: str, *, instance: Optional[str] = None,
                        token: Optional[str] = None) -> dict:
        return await self._request("POST", f"/message/sendText/{self._inst(instance)}", token=token,
                                   timeout=_TIMEOUT_SEND,
                                   json={"number": _norm_phone(phone), "text": message})

    async def send_media(self, phone: str, url: str, *, mediatype: str, caption: str = "",
                         filename: str = "", mimetype: str = "", instance: Optional[str] = None,
                         token: Optional[str] = None) -> dict:
        mime = mimetype or (mimetypes.guess_type(filename or url)[0] or _MEDIA_MIME.get(mediatype, "application/octet-stream"))
        body = {"number": _norm_phone(phone), "mediatype": mediatype, "mimetype": mime,
                "media": url, "caption": caption}
        if filename:
            body["fileName"] = filename
        return await self._request("POST", f"/message/sendMedia/{self._inst(instance)}", token=token,
                                   timeout=_TIMEOUT_SEND, json=body)

    async def send_image(self, phone: str, url: str, caption: str = "", **kw) -> dict:
        return await self.send_media(phone, url, mediatype="image", caption=caption, mimetype="image/jpeg", **kw)

    async def send_document(self, phone: str, url: str, filename: str, caption: str = "", **kw) -> dict:
        return await self.send_media(phone, url, mediatype="document", caption=caption, filename=filename, **kw)

    async def send_video(self, phone: str, url: str, caption: str = "", **kw) -> dict:
        return await self.send_media(phone, url, mediatype="video", caption=caption, mimetype="video/mp4", **kw)

    async def send_message_with_attachment(
        self, phone: str, text: str, attachment_url: Optional[str],
        attachment_type: Literal["none", "image", "video", "document"] = "none",
        attachment_filename: str = "attachment", **kw,
    ) -> dict:
        """Text alone, or media with the text as its caption (capped at 1000 characters)."""
        if not attachment_url or attachment_type == "none":
            return await self.send_text(phone, text, **kw)
        if attachment_type == "image":
            return await self.send_image(phone, attachment_url, caption=text[:1000], **kw)
        if attachment_type == "video":
            return await self.send_video(phone, attachment_url, caption=text[:1000], **kw)
        return await self.send_document(phone, attachment_url, attachment_filename, caption=text[:1000], **kw)


# Singleton — the default (company) instance. New code passes instance=... explicitly.
evolution = EvolutionClient()
