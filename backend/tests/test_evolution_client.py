"""EvolutionClient talks to one named instance per call; old callers keep the default instance.

Run:
    DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 \
    python -m pytest tests/test_evolution_client.py -q
"""
import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import httpx
import pytest

from services import evolution_client as ec


def _run(coro):
    return asyncio.run(coro)


def test_legacy_singleton_call_still_targets_the_default_instance(fake_evolution):
    _run(ec.evolution.send_text("98111 11111", "hi"))
    call = fake_evolution.calls[-1]
    assert call["path"] == f"/message/sendText/{ec.INSTANCE_NAME}"
    assert call["json"] == {"number": "919811111111", "text": "hi"}
    assert call["token"] is None


def test_named_instance_and_its_token_are_used(fake_evolution):
    _run(ec.evolution.send_text("9811111111", "hi", instance="rep_u1", token="tok_rep_u1"))
    call = fake_evolution.calls[-1]
    assert call["path"] == "/message/sendText/rep_u1" and call["token"] == "tok_rep_u1"
    assert fake_evolution.sends[-1]["instance"] == "rep_u1"


def test_send_media_carries_caption_filename_and_type(fake_evolution):
    _run(ec.evolution.send_media("9811111111", "https://x/y.pdf", mediatype="document",
                                 caption="Brochure", filename="y.pdf", instance="rep_u1"))
    body = fake_evolution.calls[-1]["json"]
    assert body["mediatype"] == "document" and body["fileName"] == "y.pdf"
    assert body["caption"] == "Brochure" and body["mimetype"] == "application/pdf"


def test_webhook_is_per_instance_with_the_secret_and_all_w1_w2_events(fake_evolution, monkeypatch):
    monkeypatch.setenv("WA_WEBHOOK_SECRET", "s3cret")
    monkeypatch.setenv("WA_WEBHOOK_BASE", "https://app.smartshape.in")
    _run(ec.evolution.set_webhook("rep_u1"))
    call = fake_evolution.calls[-1]
    assert call["path"] == "/webhook/set/rep_u1"
    hook = call["json"]["webhook"]
    # Fix round 1: the secret rides in a header, never in the URL (access logs record URLs).
    assert hook["url"] == "https://app.smartshape.in/api/webhooks/whatsapp/rep_u1"
    assert "s3cret" not in hook["url"] and hook["headers"] == {"X-WA-Secret": "s3cret"}
    assert hook["enabled"] is True and hook["byEvents"] is False and hook["base64"] is False
    assert set(hook["events"]) == {"MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE",
                                   "QRCODE_UPDATED", "SEND_MESSAGE"}


def test_proxy_set_and_disable(fake_evolution):
    _run(ec.evolution.set_proxy("rep_u1", {"host": "gate.decodo.com", "port": 10001,
                                           "protocol": "socks5", "username": "u", "password": "p"}))
    assert fake_evolution.calls[-1]["json"] == {"enabled": True, "host": "gate.decodo.com", "port": "10001",
                                                "protocol": "socks5", "username": "u", "password": "p"}
    _run(ec.evolution.set_proxy("rep_u1", None))
    assert fake_evolution.calls[-1]["json"]["enabled"] is False


def test_check_numbers_maps_by_e164(fake_evolution):
    fake_evolution.not_on_whatsapp.add("919822222222")
    out = _run(ec.evolution.check_numbers(["919811111111", "919822222222"], instance="rep_u1"))
    assert out == {"919811111111": True, "919822222222": False}
    assert fake_evolution.calls[-1]["path"] == "/chat/whatsappNumbers/rep_u1"


def test_connection_state_and_fetch_instance(fake_evolution):
    fake_evolution.state["rep_u1"] = "open"
    fake_evolution.owner_jid["rep_u1"] = "919811111111@s.whatsapp.net"
    assert _run(ec.evolution.connection_state("rep_u1")) == "open"
    assert _run(ec.evolution.fetch_instance("rep_u1"))["ownerJid"] == "919811111111@s.whatsapp.net"


@pytest.mark.parametrize("resp,tok", [({"hash": "abc"}, "abc"), ({"hash": {"apikey": "def"}}, "def"), ({}, "")])
def test_instance_token_shapes(resp, tok):
    assert ec.instance_token(resp) == tok


def test_provider_message_id_shapes():
    assert ec.provider_message_id({"key": {"id": "A1"}}) == "A1"
    assert ec.provider_message_id({"id": "B2"}) == "B2"
    assert ec.provider_message_id({}) == ""


def test_http_errors_become_evolution_error(monkeypatch):
    # Real _request, fake transport (the guard lets MockTransport through).
    from conftest import _REAL_EVO
    monkeypatch.setattr(ec.EvolutionClient, "_request", _REAL_EVO["_request"])
    transport = httpx.MockTransport(lambda req: httpx.Response(403, text='{"error":"in use"}'))
    real_client = httpx.AsyncClient
    monkeypatch.setattr(ec.httpx, "AsyncClient", lambda **kw: real_client(transport=transport, **kw))
    with pytest.raises(ec.EvolutionError) as e:
        _run(ec.EvolutionClient().create_instance("rep_u1"))
    assert e.value.status_code == 403


def test_mark_read_posts_the_keys(fake_evolution):
    c = ec.EvolutionClient(base="http://evo", key="k")
    asyncio.run(c.mark_read("rep_parul", [{"remoteJid": "919800000001@s.whatsapp.net", "fromMe": False, "id": "IN1"}], token="tok"))
    call = fake_evolution.calls[-1]
    assert call["path"] == "/chat/markMessageAsRead/rep_parul" and call["token"] == "tok"
    assert call["json"] == {"readMessages": [{"remoteJid": "919800000001@s.whatsapp.net", "fromMe": False, "id": "IN1"}]}
    assert fake_evolution.read_marks == [call["json"]]


def test_get_media_base64_returns_the_fake_media_or_404(fake_evolution):
    c = ec.EvolutionClient(base="http://evo", key="k")
    fake_evolution.media["IN2"] = {"mediaType": "image", "fileName": "a.jpg", "mimetype": "image/jpeg", "base64": "QUJD"}
    out = asyncio.run(c.get_media_base64("rep_parul", "IN2"))
    assert out["base64"] == "QUJD" and fake_evolution.calls[-1]["json"] == {"message": {"key": {"id": "IN2"}}, "convertToMp4": False}
    with pytest.raises(ec.EvolutionError) as e:
        asyncio.run(c.get_media_base64("rep_parul", "missing"))
    assert e.value.status_code == 404


def test_find_messages_pages_the_fake(fake_evolution):
    c = ec.EvolutionClient(base="http://evo", key="k")
    fake_evolution.messages[("rep_parul", "919800000001@s.whatsapp.net")] = [{"key": {"id": f"M{i}"}} for i in range(120)]
    p1 = asyncio.run(c.find_messages("rep_parul", "919800000001@s.whatsapp.net", page=1))
    p3 = asyncio.run(c.find_messages("rep_parul", "919800000001@s.whatsapp.net", page=3))
    assert p1["total"] == 120 and p1["pages"] == 3 and len(p1["records"]) == 50 and len(p3["records"]) == 20
    assert fake_evolution.calls[-1]["json"]["where"] == {"key": {"remoteJid": "919800000001@s.whatsapp.net"}}


def test_find_chats_unwraps_a_dict_answer(fake_evolution):
    c = ec.EvolutionClient(base="http://evo", key="k")
    fake_evolution.chats["rep_parul"] = [{"remoteJid": "919800000001@s.whatsapp.net", "name": "Sunita"}]
    assert asyncio.run(c.find_chats("rep_parul"))[0]["name"] == "Sunita"


def test_find_messages_wraps_a_flat_list_under_messages(monkeypatch):
    # Some Evolution builds answer findMessages with {"messages": [...]} — a bare list under
    # the key, not the {"records","total","pages"} shape. find_messages must still wrap it.
    c = ec.EvolutionClient(base="http://evo", key="k")

    async def _fake_request(self, method, path, *, json=None, token=None, timeout=None):
        return {"messages": [{"key": {"id": "M1"}}]}
    monkeypatch.setattr(ec.EvolutionClient, "_request", _fake_request)
    out = asyncio.run(c.find_messages("rep_parul", "919800000001@s.whatsapp.net"))
    assert out == {"records": [{"key": {"id": "M1"}}], "total": 1, "pages": 1}


def test_find_messages_wraps_a_top_level_list(monkeypatch):
    # And some builds answer with a bare list at the top level (no "messages" key at all).
    c = ec.EvolutionClient(base="http://evo", key="k")

    async def _fake_request(self, method, path, *, json=None, token=None, timeout=None):
        return [{"key": {"id": "M1"}}]
    monkeypatch.setattr(ec.EvolutionClient, "_request", _fake_request)
    out = asyncio.run(c.find_messages("rep_parul", "919800000001@s.whatsapp.net"))
    assert out == {"records": [{"key": {"id": "M1"}}], "total": 1, "pages": 1}
