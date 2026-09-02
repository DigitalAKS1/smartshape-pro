"""Single upload entry point. Cloudinary-first; falls back to the caller's legacy
mechanism so behavior is unchanged until Cloudinary credentials are saved.

Cloudinary becomes primary the moment db.settings {type:"cloudinary"} is filled in.
"""
import io
import os
from typing import Optional

import requests

from database import db

UPLOADS_DIR = os.environ.get("UPLOADS_DIR", "/app/uploads")

# Emergent object store — the legacy upload target for certificates and WhatsApp
# media. Moved here from server.py, which was 5,576 lines of unmounted code that
# only this one function still needed (see tests/test_no_dead_routes.py).
STORAGE_URL = "https://integrations.emergentagent.com/objstore/api/v1/storage"
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")
_storage_key = None


def init_storage():
    global _storage_key
    if _storage_key:
        return _storage_key
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
    resp.raise_for_status()
    _storage_key = resp.json()["storage_key"]
    return _storage_key


def put_object(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    resp = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data, timeout=120,
    )
    resp.raise_for_status()
    return resp.json()


async def _cloudinary_config() -> Optional[dict]:
    cfg = await db.settings.find_one({"type": "cloudinary"}, {"_id": 0})
    if not cfg:
        return None
    name = (cfg.get("cloud_name") or "").strip()
    key = (cfg.get("api_key") or "").strip()
    sec = (cfg.get("api_secret") or "").strip()
    if not (name and key and sec):
        return None
    return {"cloud_name": name, "api_key": key, "api_secret": sec}


def _upload_cloudinary(cfg: dict, path: str, data: bytes, content_type: str) -> str:
    import cloudinary
    import cloudinary.uploader
    cloudinary.config(cloud_name=cfg["cloud_name"], api_key=cfg["api_key"],
                      api_secret=cfg["api_secret"], secure=True)
    public_id = path.rsplit(".", 1)[0]  # cloudinary appends format from the bytes
    res = cloudinary.uploader.upload(io.BytesIO(data), public_id=public_id,
                                     resource_type="auto", overwrite=True)
    return res["secure_url"]


def _save_file_local(path: str, data: bytes) -> None:
    full_path = os.path.join(UPLOADS_DIR, path)
    os.makedirs(os.path.dirname(full_path), exist_ok=True)
    with open(full_path, "wb") as f:
        f.write(data)


def _put_object_emergent(path: str, data: bytes, content_type: str) -> None:
    put_object(path, data, content_type)


async def save_upload(path: str, data: bytes, content_type: str, *, legacy: str = "local") -> str:
    """Return a URL for the stored object.
    - Cloudinary if configured (absolute secure_url).
    - Else the caller's legacy mechanism, returning /api/files/{path}.
      legacy="local"    -> write under UPLOADS_DIR (matches the logo upload path).
      legacy="emergent" -> push to the Emergent object store (matches certs/whatsapp).
    """
    cfg = await _cloudinary_config()
    if cfg:
        return _upload_cloudinary(cfg, path, data, content_type)
    if legacy == "emergent":
        _put_object_emergent(path, data, content_type)
    else:
        _save_file_local(path, data)
    return f"/api/files/{path}"
