"""Phase 3-2: public Quotation Request form → request list + email to sales team."""
import asyncio
import json
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from fastapi import HTTPException
from mongomock_motor import AsyncMongoMockClient

import rbac
import routes.quotation_request_routes as qreq

ADMIN = {"email": "info@smartshape.in", "name": "Owner", "role": "admin"}
NOBODY = {"email": "x@smartshape.in", "name": "X", "role": "store"}


class FakeClient:
    host = "1.2.3.4"


class FakeRequest:
    def __init__(self, body=None, ip="1.2.3.4"):
        self._body = body or {}
        self.headers = {"x-forwarded-for": ip}
        self.client = FakeClient()

    async def json(self):
        return self._body


def _run(c):
    return asyncio.run(c)


@pytest.fixture()
def env(monkeypatch):
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(qreq, "db", d)
    monkeypatch.setattr(rbac, "MODULE_RBAC_MODE", "enforce", raising=False)
    qreq._RATE.clear()
    sent, bells = [], []

    async def _send(to, subject, html):
        sent.append({"to": to, "subject": subject, "html": html})
        return True

    async def _bell(email, **kw):
        bells.append({"email": email, **kw})
        return "n1"
    monkeypatch.setattr(qreq, "_send_email", _send)
    monkeypatch.setattr(qreq, "notify_user", _bell)
    _run(d.settings.insert_one({"type": "email", "sender_email": "company@smartshape.in"}))
    _run(d.schools.insert_one({"school_id": "s1", "school_name": "Alpha Public School", "city": "Delhi",
                               "assigned_to": "rep@smartshape.in"}))
    _run(d.dies.insert_many([
        {"die_id": "d1", "code": "SS-1", "name": "Rose", "is_active": True},
        {"die_id": "d2", "code": "SS-2", "name": "Hidden", "is_active": False},
    ]))
    return {"db": d, "sent": sent, "bells": bells}


def _as(user, monkeypatch):
    async def _me(_r):
        return user
    monkeypatch.setattr(qreq, "get_current_user", _me)


GOOD = {"email": "principal@alpha.edu", "name": "Ms Rao", "school_name": "Alpha Public School",
        "address": "12 Ring Road", "city": "Delhi", "principal_name": "Ms Rao", "phone": "9876543210",
        "message": "Need dies for art room", "selections": [{"die_id": "d1", "quantity": 3}]}


def test_submit_creates_request_and_mails_team(env):
    out = _run(qreq.submit_quote_request(FakeRequest(GOOD)))
    assert out["ok"] is True and out["request_id"].startswith("qr_")
    doc = _run(env["db"].quotation_requests.find_one({"request_id": out["request_id"]}))
    assert doc["status"] == "new" and doc["source"] == "public_form"
    assert doc["school_id"] == "s1"                         # matched existing school
    assert doc["items"] == [{"die_id": "d1", "die_code": "SS-1", "name": "Rose", "quantity": 3}]
    to = {m["to"] for m in env["sent"]}
    assert "company@smartshape.in" in to                    # fallback recipient
    assert "principal@alpha.edu" not in to                  # never mail a stranger-supplied address
    team_mail = next(m for m in env["sent"] if m["to"] == "company@smartshape.in")
    assert "Alpha Public School" in team_mail["subject"] and "SS-1" in team_mail["html"]
    assert any(b["email"] == "rep@smartshape.in" for b in env["bells"])   # school owner's bell


def test_configured_recipients_used(env):
    _run(env["db"].settings.insert_one({"type": "notifications",
                                        "quotation_request_recipients": "sales@x.in, boss@x.in"}))
    _run(qreq.submit_quote_request(FakeRequest(GOOD)))
    to = {m["to"] for m in env["sent"]}
    assert {"sales@x.in", "boss@x.in"} <= to and "company@smartshape.in" not in to


def test_required_fields(env):
    for k in ("email", "name", "school_name", "address"):
        with pytest.raises(HTTPException) as e:
            _run(qreq.submit_quote_request(FakeRequest({**GOOD, k: ""})))
        assert e.value.status_code == 400
    with pytest.raises(HTTPException):
        _run(qreq.submit_quote_request(FakeRequest({**GOOD, "email": "not-an-email"})))


def test_optional_fields_and_unknown_school(env):
    body = {k: GOOD[k] for k in ("email", "name", "address")}
    out = _run(qreq.submit_quote_request(FakeRequest({**body, "school_name": "Brand New School"})))
    doc = _run(env["db"].quotation_requests.find_one({"request_id": out["request_id"]}))
    assert doc["school_id"] is None and doc["items"] == [] and doc["principal_name"] == ""
    assert _run(env["db"].schools.count_documents({})) == 1   # never creates a school


def test_inactive_or_unknown_dies_ignored(env):
    out = _run(qreq.submit_quote_request(FakeRequest({**GOOD, "selections": [
        {"die_id": "d2", "quantity": 1}, {"die_id": "zz", "quantity": 1}, {"die_id": "d1", "quantity": 0}]})))
    doc = _run(env["db"].quotation_requests.find_one({"request_id": out["request_id"]}))
    assert doc["items"] == []


def test_honeypot_fakes_success_and_saves_nothing(env):
    out = _run(qreq.submit_quote_request(FakeRequest({**GOOD, "website": "http://spam"})))
    assert out["ok"] is True
    assert _run(env["db"].quotation_requests.count_documents({})) == 0 and env["sent"] == []


def test_rate_limited(env):
    for _ in range(5):
        _run(qreq.submit_quote_request(FakeRequest(GOOD, ip="9.9.9.9")))
    with pytest.raises(HTTPException) as e:
        _run(qreq.submit_quote_request(FakeRequest(GOOD, ip="9.9.9.9")))
    assert e.value.status_code == 429


def test_public_catalogue_only_visible_active(env):
    out = _run(qreq.public_quote_catalogue())
    assert [d["die_id"] for d in out["dies"]] == ["d1"]


def test_list_and_update_require_quotations_access(env, monkeypatch):
    _run(qreq.submit_quote_request(FakeRequest(GOOD)))
    _as(NOBODY, monkeypatch)
    with pytest.raises(HTTPException) as e:
        _run(qreq.list_quote_requests(FakeRequest(), status=None))
    assert e.value.status_code == 403
    _as(ADMIN, monkeypatch)
    rows = _run(qreq.list_quote_requests(FakeRequest(), status=None))
    assert len(rows) == 1 and rows[0]["bought_before"] is False
    rid = rows[0]["request_id"]
    out = _run(qreq.update_quote_request(rid, FakeRequest({"status": "closed", "notes": "spam"})))
    assert out["status"] == "closed"
    with pytest.raises(HTTPException):
        _run(qreq.update_quote_request(rid, FakeRequest({"status": "weird"})))


def test_bought_before_flag(env, monkeypatch):
    _run(env["db"].past_purchases.insert_one({"purchase_id": "p1", "school_id": "s1", "purchase_date": "2024-01-01",
                                               "is_deleted": False, "items": []}))
    _run(qreq.submit_quote_request(FakeRequest(GOOD)))
    _as(ADMIN, monkeypatch)
    assert _run(qreq.list_quote_requests(FakeRequest(), status="new"))[0]["bought_before"] is True


def test_mark_quoted_links_quotation(env):
    out = _run(qreq.submit_quote_request(FakeRequest(GOOD)))
    _run(qreq.mark_request_quoted(env["db"], out["request_id"], {"quotation_id": "q1", "quote_number": "QT-1"}))
    doc = _run(env["db"].quotation_requests.find_one({"request_id": out["request_id"]}))
    assert doc["status"] == "quoted" and doc["quotation_id"] == "q1" and doc["quote_number"] == "QT-1"


# ── Security review fixes ────────────────────────────────────────────────────

SCOPED = {"email": "rep@smartshape.in", "name": "Rep", "role": "sales",
          "module_permissions": {"quotations": {"level": "read_write", "scope": "own"}}}


def test_public_catalogue_hides_stock(env):
    _run(env["db"].dies.update_one({"die_id": "d1"}, {"$set": {"stock_qty": 7, "reserved_qty": 2, "min_level": 5,
                                                                "cost_price": 99}}))
    die = _run(qreq.public_quote_catalogue())["dies"][0]
    for k in ("stock_qty", "reserved_qty", "min_level", "cost_price"):
        assert k not in die
    assert die["code"] == "SS-1" and die["name"] == "Rose"


def test_daily_public_cap(env, monkeypatch):
    monkeypatch.setattr(qreq, "DAILY_PUBLIC_CAP", 2)
    for ip in ("1.1.1.1", "2.2.2.2"):
        _run(qreq.submit_quote_request(FakeRequest(GOOD, ip=ip)))
    with pytest.raises(HTTPException) as e:
        _run(qreq.submit_quote_request(FakeRequest(GOOD, ip="3.3.3.3")))
    assert e.value.status_code == 429


def test_newlines_stripped_from_single_line_fields(env):
    evil = "Alpha" + chr(13) + chr(10) + "Bcc: x@evil.com"
    out = _run(qreq.submit_quote_request(FakeRequest({**GOOD, "school_name": evil})))
    doc = _run(env["db"].quotation_requests.find_one({"request_id": out["request_id"]}))
    assert chr(10) not in doc["school_name"] and chr(13) not in doc["school_name"]
    assert all(chr(10) not in m["subject"] and chr(13) not in m["subject"] for m in env["sent"])


def test_bad_bodies_are_400_not_500(env):
    class ListBody(FakeRequest):
        async def json(self):
            return ["x"]
    with pytest.raises(HTTPException) as e:
        _run(qreq.submit_quote_request(ListBody()))
    assert e.value.status_code == 400
    out = _run(qreq.submit_quote_request(FakeRequest({**GOOD, "selections": "abc"})))
    assert out["ok"] is True
    out = _run(qreq.submit_quote_request(FakeRequest({**GOOD, "selections": ["abc", 5]})))
    assert out["ok"] is True


def test_recipients_setting_as_list_still_works(env):
    _run(env["db"].settings.insert_one({"type": "notifications", "quotation_request_recipients": ["a@x.in"]}))
    _run(qreq.submit_quote_request(FakeRequest(GOOD)))
    assert any(m["to"] == "a@x.in" for m in env["sent"])


def test_scoped_rep_sees_own_and_unassigned_only(env, monkeypatch):
    _run(qreq.submit_quote_request(FakeRequest(GOOD)))                                   # assigned to rep (school owner)
    _run(qreq.submit_quote_request(FakeRequest({**GOOD, "school_name": "Nobody School", "city": ""}, ip="5.5.5.5")))
    other = _run(qreq.submit_quote_request(FakeRequest({**GOOD, "school_name": "Other School"}, ip="6.6.6.6")))
    _run(env["db"].quotation_requests.update_one({"request_id": other["request_id"]},
                                                 {"$set": {"assigned_to": "someone@else.in"}}))
    _as(SCOPED, monkeypatch)
    names = {r["school_name"] for r in _run(qreq.list_quote_requests(FakeRequest(), status=None))}
    assert names == {"Alpha Public School", "Nobody School"}
    with pytest.raises(HTTPException) as e:
        _run(qreq.get_quote_request(other["request_id"], FakeRequest()))
    assert e.value.status_code == 404


def test_mark_quoted_does_not_overwrite_an_answered_request(env):
    out = _run(qreq.submit_quote_request(FakeRequest(GOOD)))
    _run(qreq.mark_request_quoted(env["db"], out["request_id"], {"quotation_id": "q1", "quote_number": "QT-1"}))
    _run(qreq.mark_request_quoted(env["db"], out["request_id"], {"quotation_id": "q2", "quote_number": "QT-2"}))
    doc = _run(env["db"].quotation_requests.find_one({"request_id": out["request_id"]}))
    assert doc["quotation_id"] == "q1"


def test_real_send_path_reads_settings_and_uses_thread(monkeypatch):
    """_send_email reads mail settings on the app loop, then SMTP runs in a thread."""
    import importlib
    mod = importlib.reload(qreq)          # un-patched _send_email
    d = AsyncMongoMockClient()["smartshape_test"]
    monkeypatch.setattr(mod, "db", d)
    sent = []

    class FakeSMTP:
        def __init__(self, host, port, timeout=None):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def login(self, u, p):
            sent.append(("login", u))

        def sendmail(self, frm, to, msg):
            sent.append(("send", tuple(to)))
    monkeypatch.setattr(mod.smtplib, "SMTP_SSL", FakeSMTP)
    assert _run(mod._send_email("a@x.in", "S", "<p>h</p>")) is False      # not configured
    _run(d.settings.insert_one({"type": "email", "sender_email": "co@x.in", "gmail_app_password": "pw"}))
    assert _run(mod._send_email("a@x.in", "S", "<p>h</p>")) is True
    assert sent == [("login", "co@x.in"), ("send", ("a@x.in",))]
