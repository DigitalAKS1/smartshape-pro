"""Phase 3-3: Catalogue Master — named catalogues, emailed to a school without a
quotation; the school's picks become a Quotation Request (source "catalogue")."""
import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from fastapi import HTTPException
from mongomock_motor import AsyncMongoMockClient

import rbac
import routes.catalogue_master_routes as cm
import routes.quotation_request_routes as qreq
import routes.crm_routes as crm

ADMIN = {"email": "info@smartshape.in", "name": "Owner", "role": "admin"}
STORE = {"email": "st@smartshape.in", "name": "St", "role": "store"}


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
    for m in (cm, qreq, crm):
        monkeypatch.setattr(m, "db", d)
    monkeypatch.setattr(rbac, "MODULE_RBAC_MODE", "enforce", raising=False)
    cm._RATE.clear()
    sent = []

    async def _send(to, subject, html):
        sent.append({"to": to, "subject": subject, "html": html})
        return True

    async def _bell(email, **kw):
        return "n"
    monkeypatch.setattr(qreq, "_send_email", _send)
    monkeypatch.setattr(cm, "_send_email", _send)
    monkeypatch.setattr(qreq, "notify_user", _bell)

    async def _me(_r):
        return ADMIN
    monkeypatch.setattr(cm, "get_current_user", _me)
    _run(d.settings.insert_one({"type": "email", "sender_email": "co@smartshape.in"}))
    _run(d.schools.insert_one({"school_id": "s1", "school_name": "Alpha School", "city": "Delhi",
                               "email": "office@alpha.in", "address": "Ring Rd", "assigned_to": "rep@smartshape.in"}))
    _run(d.dies.insert_many([
        {"die_id": "d1", "code": "F-1", "name": "Rose", "category": "flowers", "is_active": True, "stock_qty": 9},
        {"die_id": "d2", "code": "A-1", "name": "Parrot", "category": "animals_birds", "is_active": True},
        {"die_id": "d3", "code": "F-2", "name": "Lily", "category": "flowers", "is_active": False},
        {"die_id": "d4", "code": "M-1", "name": "Machine X", "category": "other", "is_active": True,
         "product_type_id": "ptype_machine"},
    ]))
    _run(d.product_types.insert_one({"product_type_id": "ptype_machine", "name": "Machines",
                                     "visible_to_schools": True, "is_active": True}))
    _run(d.past_purchases.insert_one({"purchase_id": "p1", "school_id": "s1", "purchase_date": "2024-03-05",
                                      "is_deleted": False,
                                      "items": [{"die_id": "d1", "die_code": "F-1", "name": "Rose", "qty": 2}]}))
    return {"db": d, "sent": sent}


def _cat(env, **body):
    return _run(cm.create_catalogue(FakeRequest({"name": "Flowers", "intro": "Spring range", **body})))


def test_create_and_preview_by_category(env):
    c = _cat(env, categories=["flowers"])
    assert c["catalogue_id"].startswith("cat_")
    prev = _run(cm.preview_catalogue(c["catalogue_id"], FakeRequest()))
    assert [d["die_id"] for d in prev["dies"]] == ["d1"]          # active flowers only


def test_filter_by_product_type_and_explicit_dies(env):
    c = _cat(env, product_type_ids=["ptype_machine"], die_ids=["d2"])
    ids = {d["die_id"] for d in _run(cm.preview_catalogue(c["catalogue_id"], FakeRequest()))["dies"]}
    assert ids == {"d4", "d2"}


def test_empty_filter_means_everything_visible(env):
    c = _cat(env)
    ids = {d["die_id"] for d in _run(cm.preview_catalogue(c["catalogue_id"], FakeRequest()))["dies"]}
    assert ids == {"d1", "d2", "d4"}


def test_name_required_and_requires_quotations_write(env, monkeypatch):
    with pytest.raises(HTTPException):
        _run(cm.create_catalogue(FakeRequest({"name": ""})))

    async def _store(_r):
        return STORE
    monkeypatch.setattr(cm, "get_current_user", _store)
    with pytest.raises(HTTPException) as e:
        _run(cm.create_catalogue(FakeRequest({"name": "X"})))
    assert e.value.status_code == 403


def test_send_to_school_mails_link_and_records_share(env):
    c = _cat(env, categories=["flowers"])
    out = _run(cm.send_catalogue(c["catalogue_id"], FakeRequest({"school_id": "s1"})))
    assert out["sent"] == ["office@alpha.in"] and len(out["shares"]) == 1
    share = _run(env["db"].catalogue_shares.find_one({"catalogue_id": c["catalogue_id"]}))
    assert share["school_id"] == "s1" and share["status"] == "sent"
    mail = env["sent"][0]
    assert mail["to"] == "office@alpha.in" and f"/c/{share['token']}" in mail["html"]


def test_send_to_plain_emails(env):
    c = _cat(env)
    out = _run(cm.send_catalogue(c["catalogue_id"], FakeRequest({"emails": "a@x.in, bad, b@x.in"})))
    assert out["sent"] == ["a@x.in", "b@x.in"] and out["invalid"] == ["bad"]


def test_send_needs_a_recipient(env):
    c = _cat(env)
    with pytest.raises(HTTPException) as e:
        _run(cm.send_catalogue(c["catalogue_id"], FakeRequest({})))
    assert e.value.status_code == 400


def _share(env, **body):
    c = _cat(env, categories=["flowers"])
    _run(cm.send_catalogue(c["catalogue_id"], FakeRequest(body or {"school_id": "s1"})))
    return _run(env["db"].catalogue_shares.find_one({"catalogue_id": c["catalogue_id"]}))


def test_public_open_returns_dies_owned_and_marks_opened(env):
    share = _share(env)
    out = _run(cm.public_catalogue_share(share["token"]))
    assert out["catalogue"]["name"] == "Flowers" and out["school_name"] == "Alpha School"
    assert [d["die_id"] for d in out["dies"]] == ["d1"]
    assert "stock_qty" not in out["dies"][0]
    assert out["owned"]["d1"]["qty"] == 2
    assert _run(env["db"].catalogue_shares.find_one({"token": share["token"]}))["status"] == "opened"


def test_public_unknown_token_404(env):
    with pytest.raises(HTTPException) as e:
        _run(cm.public_catalogue_share("nope"))
    assert e.value.status_code == 404


def test_submit_creates_quotation_request(env):
    share = _share(env)
    out = _run(cm.submit_catalogue_share(share["token"], FakeRequest(
        {"selections": [{"die_id": "d1", "quantity": 4}, {"die_id": "d2", "quantity": 1}],
         "name": "Ms Rao", "phone": "98765", "message": "asap"})))
    req = _run(env["db"].quotation_requests.find_one({"request_id": out["request_id"]}))
    assert req["source"] == "catalogue" and req["school_id"] == "s1"
    assert req["catalogue_name"] == "Flowers" and req["email"] == "office@alpha.in"
    assert [i["die_id"] for i in req["items"]] == ["d1"]          # d2 is not in this catalogue
    assert req["assigned_to"] == "rep@smartshape.in" and req["name"] == "Ms Rao"
    s = _run(env["db"].catalogue_shares.find_one({"token": share["token"]}))
    assert s["status"] == "submitted" and s["request_id"] == out["request_id"]
    assert any("Alpha School" in m["subject"] for m in env["sent"] if m["to"] == "co@smartshape.in")


def test_submit_twice_409_and_empty_400(env):
    share = _share(env)
    with pytest.raises(HTTPException) as e:
        _run(cm.submit_catalogue_share(share["token"], FakeRequest({"selections": []})))
    assert e.value.status_code == 400
    _run(cm.submit_catalogue_share(share["token"], FakeRequest({"selections": [{"die_id": "d1", "quantity": 1}]})))
    with pytest.raises(HTTPException) as e:
        _run(cm.submit_catalogue_share(share["token"], FakeRequest({"selections": [{"die_id": "d1", "quantity": 1}]})))
    assert e.value.status_code == 409


def test_list_catalogues_with_share_counts(env):
    _share(env)
    rows = _run(cm.list_catalogues(FakeRequest()))
    assert rows[0]["name"] == "Flowers" and rows[0]["shares"]["sent"] == 1 and rows[0]["die_count"] == 1


def test_deleted_catalogue_link_stops_working(env):
    share = _share(env)
    _run(cm.delete_catalogue(share["catalogue_id"], FakeRequest()))
    with pytest.raises(HTTPException) as e:
        _run(cm.public_catalogue_share(share["token"]))
    assert e.value.status_code == 404


# ── Review fixes ─────────────────────────────────────────────────────────────

REP = {"email": "rep2@smartshape.in", "name": "Rep2", "role": "sales",
       "module_permissions": {"quotations": {"level": "read_write", "scope": "own"},
                              "leads": {"level": "read_write", "scope": "own"}}}


def test_submit_while_another_submit_in_flight_is_409(env):
    share = _share(env)
    _run(env["db"].catalogue_shares.update_one({"token": share["token"]}, {"$set": {"status": "submitting"}}))
    with pytest.raises(HTTPException) as e:
        _run(cm.submit_catalogue_share(share["token"], FakeRequest({"selections": [{"die_id": "d1", "quantity": 1}]})))
    assert e.value.status_code == 409
    assert _run(env["db"].quotation_requests.count_documents({})) == 0


def test_rep_cannot_send_to_a_school_they_cannot_see(env, monkeypatch):
    c = _cat(env)

    async def _rep(_r):
        return REP
    monkeypatch.setattr(cm, "get_current_user", _rep)
    with pytest.raises(HTTPException) as e:
        _run(cm.send_catalogue(c["catalogue_id"], FakeRequest({"school_id": "s1", "emails": "me@x.in"})))
    assert e.value.status_code == 404


def test_send_caps_per_call_and_per_day(env, monkeypatch):
    c = _cat(env)
    many = ",".join(f"u{i}@x.in" for i in range(30))
    out = _run(cm.send_catalogue(c["catalogue_id"], FakeRequest({"emails": many})))
    assert len(out["shares"]) == cm.SEND_PER_CALL == 20
    monkeypatch.setattr(cm, "SEND_DAILY_CAP", 21)
    with pytest.raises(HTTPException) as e:
        _run(cm.send_catalogue(c["catalogue_id"], FakeRequest({"emails": "a@x.in, b@x.in"})))
    assert e.value.status_code == 429


def test_request_list_hides_share_token(env, monkeypatch):
    share = _share(env)
    _run(cm.submit_catalogue_share(share["token"], FakeRequest({"selections": [{"die_id": "d1", "quantity": 1}]})))

    async def _admin(_r):
        return ADMIN
    monkeypatch.setattr(qreq, "get_current_user", _admin)
    rows = _run(qreq.list_quote_requests(FakeRequest(), status=None))
    assert rows and "share_token" not in rows[0]
    assert "share_token" not in _run(qreq.get_quote_request(rows[0]["request_id"], FakeRequest()))


# ── Link-only shares (manual WhatsApp / email / broadcast) ───────────────────

def test_link_mode_for_school_sends_no_mail(env):
    c = _cat(env, categories=["flowers"])
    out = _run(cm.send_catalogue(c["catalogue_id"], FakeRequest({"mode": "link", "school_id": "s1"})))
    assert out["link"].endswith(f"/c/{out['token']}") and env["sent"] == []
    share = _run(env["db"].catalogue_shares.find_one({"token": out["token"]}))
    assert share["school_id"] == "s1" and share["channel"] == "link" and share["multi_use"] is False
    assert out["school_phone"] == ""


def test_generic_link_is_multi_use_and_asks_for_contact(env):
    c = _cat(env, categories=["flowers"])
    out = _run(cm.send_catalogue(c["catalogue_id"], FakeRequest({"mode": "link"})))
    page = _run(cm.public_catalogue_share(out["token"]))
    assert page["needs_contact"] is True and page["owned"] == {}
    with pytest.raises(HTTPException) as e:          # contact required on a generic link
        _run(cm.submit_catalogue_share(out["token"], FakeRequest({"selections": [{"die_id": "d1", "quantity": 1}]})))
    assert e.value.status_code == 400
    body = {"selections": [{"die_id": "d1", "quantity": 2}], "email": "p@beta.in", "school_name": "Alpha School",
            "city": "Delhi", "name": "Ms B"}
    r1 = _run(cm.submit_catalogue_share(out["token"], FakeRequest(body)))
    r2 = _run(cm.submit_catalogue_share(out["token"], FakeRequest({**body, "email": "q@gamma.in",
                                                                    "school_name": "Gamma", "city": ""}, ip="7.7.7.7")))
    a = _run(env["db"].quotation_requests.find_one({"request_id": r1["request_id"]}))
    b = _run(env["db"].quotation_requests.find_one({"request_id": r2["request_id"]}))
    assert a["school_id"] == "s1" and a["email"] == "p@beta.in"     # matched by name + city
    assert b["school_id"] is None and b["school_name"] == "Gamma"
    assert _run(env["db"].catalogue_shares.find_one({"token": out["token"]}))["status"] != "submitted"


def test_school_link_does_not_ask_for_contact(env):
    c = _cat(env)
    out = _run(cm.send_catalogue(c["catalogue_id"], FakeRequest({"mode": "link", "school_id": "s1"})))
    assert _run(cm.public_catalogue_share(out["token"]))["needs_contact"] is False
