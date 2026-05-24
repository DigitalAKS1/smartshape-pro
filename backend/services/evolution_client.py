"""
Evolution API client — wraps the REST API of the self-hosted Evolution API
(https://github.com/EvolutionAPI/evolution-api) that provides WhatsApp Web connectivity.

All methods are async (httpx).  A global `evolution` singleton is exported for use in routes.
"""

import os
import logging
import mimetypes
from typing import Literal, Optional

import httpx

logger = logging.getLogger(__name__)

EVOLUTION_BASE     = os.getenv("EVOLUTION_API_URL", "http://localhost:8080")
EVOLUTION_KEY      = os.getenv("EVOLUTION_API_KEY", "smartshape_key_change_me")
INSTANCE_NAME      = os.getenv("WHATSAPP_INSTANCE", "smartshape")
_TIMEOUT_SHORT     = 15.0   # for control calls
_TIMEOUT_SEND      = 45.0   # for message send (media can be slow)


def _norm_phone(phone: str) -> str:
    """Normalise an Indian phone number to E.164 without '+' (Evolution format)."""
    digits = "".join(c for c in phone if c.isdigit())
    # Already has country code
    if len(digits) == 12 and digits.startswith("91"):
        return digits
    if len(digits) == 10:
        return "91" + digits
    if digits.startswith("0") and len(digits) == 11:
        return "91" + digits[1:]
    return digits  # pass through and let Evolution handle it


class EvolutionClient:
    def __init__(self) -> None:
        self.base     = EVOLUTION_BASE.rstrip("/")
        self.instance = INSTANCE_NAME
        self._headers = {"apikey": EVOLUTION_KEY, "Content-Type": "application/json"}

    # ── Instance management ────────────────────────────────────────────────────

    async def create_instance(self) -> dict:
        async with httpx.AsyncClient(timeout=_TIMEOUT_SHORT) as c:
            r = await c.post(
                f"{self.base}/instance/create",
                headers=self._headers,
                json={
                    "instanceName": self.instance,
                    "integration": "WHATSAPP-BAILEYS",
                    "qrcode": True,
                    "webhookByEvents": True,
                },
            )
            r.raise_for_status()
            return r.json()

    async def get_qr(self) -> dict:
        """Returns { 'code': '...', 'base64': 'data:image/png;base64,...' }"""
        async with httpx.AsyncClient(timeout=_TIMEOUT_SHORT) as c:
            r = await c.get(
                f"{self.base}/instance/connect/{self.instance}",
                headers=self._headers,
            )
            r.raise_for_status()
            return r.json()

    async def get_status(self) -> dict:
        """Returns { 'instance': { 'instanceName': ..., 'state': 'open'|'close'|'connecting' } }"""
        async with httpx.AsyncClient(timeout=_TIMEOUT_SHORT) as c:
            r = await c.get(
                f"{self.base}/instance/connectionState/{self.instance}",
                headers=self._headers,
            )
            r.raise_for_status()
            return r.json()

    async def logout(self) -> dict:
        async with httpx.AsyncClient(timeout=_TIMEOUT_SHORT) as c:
            r = await c.delete(
                f"{self.base}/instance/logout/{self.instance}",
                headers=self._headers,
            )
            r.raise_for_status()
            return r.json()

    async def is_connected(self) -> bool:
        try:
            data = await self.get_status()
            state = (data.get("instance") or data).get("state", "")
            return state == "open"
        except Exception:
            return False

    # ── Send text ──────────────────────────────────────────────────────────────

    async def send_text(self, phone: str, message: str) -> dict:
        async with httpx.AsyncClient(timeout=_TIMEOUT_SEND) as c:
            r = await c.post(
                f"{self.base}/message/sendText/{self.instance}",
                headers=self._headers,
                json={"number": _norm_phone(phone), "text": message},
            )
            r.raise_for_status()
            return r.json()

    # ── Send media (image / video / PDF) ──────────────────────────────────────

    async def send_image(self, phone: str, url: str, caption: str = "") -> dict:
        async with httpx.AsyncClient(timeout=_TIMEOUT_SEND) as c:
            r = await c.post(
                f"{self.base}/message/sendMedia/{self.instance}",
                headers=self._headers,
                json={
                    "number":    _norm_phone(phone),
                    "mediatype": "image",
                    "mimetype":  "image/jpeg",
                    "media":     url,
                    "caption":   caption,
                },
            )
            r.raise_for_status()
            return r.json()

    async def send_document(self, phone: str, url: str, filename: str, caption: str = "") -> dict:
        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "pdf"
        mime = mimetypes.types_map.get(f".{ext}", "application/octet-stream")
        async with httpx.AsyncClient(timeout=_TIMEOUT_SEND) as c:
            r = await c.post(
                f"{self.base}/message/sendMedia/{self.instance}",
                headers=self._headers,
                json={
                    "number":    _norm_phone(phone),
                    "mediatype": "document",
                    "mimetype":  mime,
                    "media":     url,
                    "fileName":  filename,
                    "caption":   caption,
                },
            )
            r.raise_for_status()
            return r.json()

    async def send_video(self, phone: str, url: str, caption: str = "") -> dict:
        async with httpx.AsyncClient(timeout=_TIMEOUT_SEND) as c:
            r = await c.post(
                f"{self.base}/message/sendMedia/{self.instance}",
                headers=self._headers,
                json={
                    "number":    _norm_phone(phone),
                    "mediatype": "video",
                    "mimetype":  "video/mp4",
                    "media":     url,
                    "caption":   caption,
                },
            )
            r.raise_for_status()
            return r.json()

    async def send_message_with_attachment(
        self,
        phone: str,
        text: str,
        attachment_url: Optional[str],
        attachment_type: Literal["none", "image", "video", "document"] = "none",
        attachment_filename: str = "attachment",
    ) -> dict:
        """High-level helper: sends text; if attachment provided, sends as media with text as caption."""
        if not attachment_url or attachment_type == "none":
            return await self.send_text(phone, text)
        if attachment_type == "image":
            return await self.send_image(phone, attachment_url, caption=text[:1000])
        if attachment_type == "video":
            return await self.send_video(phone, attachment_url, caption=text[:1000])
        # document / PDF
        return await self.send_document(phone, attachment_url, attachment_filename, caption=text[:1000])


# Singleton — import this in routes
evolution = EvolutionClient()
