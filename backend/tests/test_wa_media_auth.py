"""Inbound WhatsApp media is private (final review I1): `/api/files/whatsapp/in/...` — where
services/wa_inbox.store_media puts a customer's image / PDF — requires a logged-in user, checked
BEFORE the file is read. Every other `/api/files/...` path keeps today's public behaviour
(outbound attachments under `uploads/whatsapp/` are fetched by Evolution by URL).

Run:
    DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 \
    python -m pytest tests/test_wa_media_auth.py -q -p no:cacheprovider
"""
import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from fastapi import HTTPException
from fastapi.responses import FileResponse

import routes.inventory_routes as inv

USER = {"email": "parul@smartshape.in", "name": "Parul", "role": "sales_person"}


class FakeRequest:
    def __init__(self, body=None, query_params=None):
        self._body = body or {}
        self.query_params = query_params or {}

    async def json(self):
        return self._body


def _run(coro):
    return asyncio.run(coro)


def _status(coro):
    with pytest.raises(HTTPException) as e:
        _run(coro)
    return e.value.status_code


@pytest.fixture()
def uploads(tmp_path, monkeypatch):
    """An empty uploads root, so a missing file is a clean 404 and nothing on disk is served."""
    monkeypatch.setattr(inv, "UPLOADS_DIR", str(tmp_path))
    return tmp_path


def _anonymous(monkeypatch):
    calls = []

    async def _no_user(_request):
        calls.append(1)
        raise HTTPException(status_code=401, detail="Not authenticated")
    monkeypatch.setattr(inv, "get_current_user", _no_user)
    return calls


def _as(user, monkeypatch):
    calls = []

    async def _me(_request):
        calls.append(1)
        return user
    monkeypatch.setattr(inv, "get_current_user", _me)
    return calls


def test_inbound_media_needs_a_login_and_is_refused_before_the_disk_is_touched(uploads, monkeypatch):
    calls = _anonymous(monkeypatch)
    # the file exists — an anonymous request must still be turned away with 401, not served, not 404
    (uploads / "whatsapp" / "in" / "x").mkdir(parents=True)
    (uploads / "whatsapp" / "in" / "x" / "y.jpg").write_bytes(b"\xff\xd8secret")
    assert _status(inv.get_file("whatsapp/in/x/y.jpg", FakeRequest())) == 401
    assert calls == [1]


def test_a_logged_in_user_gets_the_inbound_file_or_a_404_when_it_is_missing(uploads, monkeypatch):
    calls = _as(USER, monkeypatch)
    assert _status(inv.get_file("whatsapp/in/x/missing.jpg", FakeRequest())) == 404
    assert calls == [1]
    (uploads / "whatsapp" / "in" / "x").mkdir(parents=True)
    (uploads / "whatsapp" / "in" / "x" / "y.jpg").write_bytes(b"\xff\xd8ok")
    res = _run(inv.get_file("whatsapp/in/x/y.jpg", FakeRequest()))
    assert isinstance(res, FileResponse)
    assert res.media_type == "image/jpeg"
    assert calls == [1, 1]


def test_every_other_path_stays_public_and_never_asks_who_you_are(uploads, monkeypatch):
    calls = _anonymous(monkeypatch)
    # outbound attachment (Evolution fetches it by URL), a die image, a plain upload
    for path in ("uploads/whatsapp/att_1.pdf", "dies/abc.png", "uploads/x.jpg", "whatsapp/out/rep/1.jpg"):
        assert _status(inv.get_file(path, FakeRequest())) == 404, path
    assert calls == []
    (uploads / "uploads" / "whatsapp").mkdir(parents=True)
    (uploads / "uploads" / "whatsapp" / "att_1.pdf").write_bytes(b"%PDF")
    res = _run(inv.get_file("uploads/whatsapp/att_1.pdf", FakeRequest()))
    assert isinstance(res, FileResponse) and res.media_type == "application/pdf"
    assert calls == []


def test_the_inbound_prefix_check_sees_the_path_the_way_the_filesystem_will():
    yes = ["whatsapp/in/x/y.jpg", "/whatsapp/in/x/y.jpg", "whatsapp\\in\\x\\y.jpg", "whatsapp//in/x/y.jpg",
           "./whatsapp/in/x/y.jpg", "whatsapp/out/../in/x/y.jpg", "whatsapp/in/../in/x/y.jpg"]
    no = ["whatsapp/out/x.jpg", "uploads/whatsapp/att.pdf", "whatsapp/inbox.jpg", "whatsapp/in", "", "dies/a.png"]
    for p in yes:
        assert inv.is_inbound_wa_media(p) is True, p
    for p in no:
        assert inv.is_inbound_wa_media(p) is False, p


def test_traversal_out_of_the_uploads_root_is_still_refused(uploads, monkeypatch):
    _as(USER, monkeypatch)
    assert _status(inv.get_file("../outside.txt", FakeRequest())) == 403
    assert _status(inv.get_file("whatsapp/in/../../../etc/passwd", FakeRequest())) == 403
