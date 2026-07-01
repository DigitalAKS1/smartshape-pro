"""test_email_html_api.py — in-process HTTP API tests for email templates/campaigns body_html.

IMPORTANT: does NOT import main.app (which would trigger start_scheduler() against
prod Atlas). Builds a minimal FastAPI app with only the email router.

Motor is event-loop-bound. database.py creates its Motor client at import time.
To avoid "Event loop is closed" errors between pytest-asyncio per-test loops,
we patch routes.email_routes.db with a fresh Motor client created INSIDE each
async test (so it binds to the current test's event loop).

email_routes calls `await get_current_user(request)` directly (not as a FastAPI
Depends), so we monkeypatch the module-level name in routes.email_routes rather
than relying solely on app.dependency_overrides.
"""
import os
import pytest
import pytest_asyncio
from motor.motor_asyncio import AsyncIOMotorClient
from httpx import AsyncClient, ASGITransport
from fastapi import FastAPI

# Verify we are not running against prod
_DB_NAME = os.getenv("DB_NAME", "smartshape_test")
assert _DB_NAME.endswith("_test") or _DB_NAME == "mtt_ci", (
    f"refusing non-test DB: {_DB_NAME}"
)

import routes.email_routes as er_mod
import auth_utils
import scheduler

# Build minimal app — no scheduler, no startup hooks
_app = FastAPI()
_app.include_router(er_mod.router, prefix="/api")

_FAKE_USER = {
    "email": "admin@t",
    "team": "admin",
    "role": "admin",
    "assigned_modules": ["settings"],
}
_app.dependency_overrides[auth_utils.get_current_user] = lambda: _FAKE_USER


async def _fake_get_current_user(request=None):
    return _FAKE_USER


_MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")


@pytest_asyncio.fixture
async def test_db(monkeypatch):
    """Fresh Motor db handle created INSIDE the current test's event loop.

    Patches er_mod.db so the route handlers use this same connection, and
    monkeypatches er_mod.get_current_user since email_routes calls it directly
    (not via FastAPI Depends). Tears down all test collections after each test.
    """
    motor_client = AsyncIOMotorClient(_MONGO_URL)
    d = motor_client[_DB_NAME]

    monkeypatch.setattr(er_mod, "db", d)
    monkeypatch.setattr(er_mod, "get_current_user", _fake_get_current_user)

    yield d

    await d.email_templates.delete_many({})
    await d.email_campaigns.delete_many({})
    await d.email_scheduled.delete_many({})
    await d.email_suppressions.delete_many({})
    await d.contacts.delete_many({})
    await d.settings.delete_many({"type": "email"})
    motor_client.close()


@pytest_asyncio.fixture
async def client(test_db):
    """Async HTTP client wrapping the minimal app — shares the test event loop."""
    transport = ASGITransport(app=_app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


# ---------------------------------------------------------------------------
# Template body_html round-trip
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_template_roundtrips_body_html(client):
    r = await client.post("/api/email/templates", json={
        "name": f"HTMLTest {os.urandom(3).hex()}", "category": "intro",
        "subject": "Hi {name}", "body": "plain", "body_html": "<p>Hi {name}</p>",
    })
    assert r.status_code == 200, r.text
    tid = r.json()["template_id"]

    got_list = (await client.get("/api/email/templates")).json()
    got = [t for t in got_list if t["template_id"] == tid][0]
    assert got.get("body_html") == "<p>Hi {name}</p>"

    del_r = await client.delete(f"/api/email/templates/{tid}")
    assert del_r.status_code == 200


@pytest.mark.asyncio
async def test_template_update_body_html(client):
    r = await client.post("/api/email/templates", json={
        "name": f"HTMLUpd {os.urandom(3).hex()}", "category": "intro",
        "subject": "Hi", "body": "plain", "body_html": "<p>Old</p>",
    })
    tid = r.json()["template_id"]

    upd = await client.put(f"/api/email/templates/{tid}", json={"body_html": "<p>New</p>"})
    assert upd.status_code == 200
    assert upd.json()["body_html"] == "<p>New</p>"


# ---------------------------------------------------------------------------
# Campaign body_html / source / source_id round-trip
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_campaign_roundtrips_body_html_and_source(client):
    r = await client.post("/api/email/campaigns", json={
        "name": f"Camp {os.urandom(3).hex()}",
        "subject": "Hi {name}",
        "body_html": "<p>Hi {name}, from {school_name}</p>",
        "source": "lead",
        "source_id": "lead_123",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["body_html"] == "<p>Hi {name}, from {school_name}</p>"
    assert body["source"] == "lead"
    assert body["source_id"] == "lead_123"


# ---------------------------------------------------------------------------
# Launch: suppression skip + personalized/sanitized body_html written
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_launch_skips_suppressed_and_personalizes_html(client, test_db):
    # Two contacts, one of which is suppressed
    await test_db.contacts.insert_one({
        "contact_id": "c1", "first_name": "Asha", "email": "asha@example.com",
        "company": "Sunrise School", "is_deleted": False,
    })
    await test_db.contacts.insert_one({
        "contact_id": "c2", "first_name": "Ravi", "email": "ravi@example.com",
        "company": "Green Valley School", "is_deleted": False,
    })
    await test_db.email_suppressions.insert_one({"email": "ravi@example.com"})

    camp_r = await client.post("/api/email/campaigns", json={
        "name": f"LaunchTest {os.urandom(3).hex()}",
        "subject": "Hello {name}",
        "message": "Plain hi {name}",
        "body_html": "<p onclick=\"x\">Hi {name} from {school_name}</p><script>bad()</script>",
        "audience_filter": {},
    })
    cid = camp_r.json()["campaign_id"]

    launch_r = await client.post(f"/api/email/campaigns/{cid}/launch")
    assert launch_r.status_code == 200, launch_r.text
    assert launch_r.json()["queued"] == 1  # only the non-suppressed contact

    rows = await test_db.email_scheduled.find({"campaign_id": cid}).to_list(None)
    assert len(rows) == 1
    row = rows[0]
    assert row["email"] == "asha@example.com"
    assert "Asha" in row["body_html"]
    assert "Sunrise School" in row["body_html"]
    assert "<script>" not in row["body_html"]
    assert "onclick" not in row["body_html"]


# ---------------------------------------------------------------------------
# POST /email/send-test — immediate single self-send, bypassing the queue
# ---------------------------------------------------------------------------

class _FakeSMTP:
    last = {}
    def __init__(self, *a, **k): pass
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def login(self, *a): pass
    def sendmail(self, frm, to, raw): _FakeSMTP.last = {"frm": frm, "to": to, "raw": raw}


@pytest.mark.asyncio
async def test_send_test_400_when_email_not_configured(client, test_db):
    r = await client.post("/api/email/send-test", json={
        "subject": "Hello {name}", "body_html": "<p>hi {name}</p>",
    })
    assert r.status_code == 400, r.text


@pytest.mark.asyncio
async def test_send_test_sends_to_current_user(client, test_db, monkeypatch):
    await test_db.settings.insert_one({
        "type": "email",
        "sender_email": "s@x.com",
        "gmail_app_password": "pw",
        "sender_name": "SmartShape",
    })
    monkeypatch.setattr(scheduler.smtplib, "SMTP_SSL", _FakeSMTP)

    r = await client.post("/api/email/send-test", json={
        "subject": "Hello {name}", "body_html": "<p>hi {name}</p>",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["sent"] is True
    assert body["to"] == "admin@t"
    assert "text/html" in _FakeSMTP.last["raw"]


# ---------------------------------------------------------------------------
# POST /email/send-now — composer: campaign + per-recipient queue rows
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_send_now_queues_rows_for_selected_contacts(client, test_db):
    await test_db.contacts.insert_one({
        "contact_id": "con_qa1", "name": "QA Person",
        "email": "qa1@example.com", "company": "QA School",
    })

    r = await client.post("/api/email/send-now", json={
        "subject": "Hi {name}",
        "body_html": "<p>Hello {name} at {school_name}</p>",
        "recipient_ids": ["con_qa1"],
        "source": "manual",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["queued"] == 1
    assert body["campaign_id"].startswith("ecamp_")

    rows = await test_db.email_scheduled.find({"campaign_id": body["campaign_id"]}).to_list(None)
    assert len(rows) == 1
    row = rows[0]
    assert "QA" in row["body_html"]
    assert "QA School" in row["body_html"]
    assert "{name}" not in row["body_html"]
    assert "{school_name}" not in row["body_html"]


@pytest.mark.asyncio
async def test_send_now_escapes_contact_html(client, test_db):
    await test_db.contacts.insert_one({
        "contact_id": "con_xss1", "name": "<script>evil</script>",
        "email": "xss@example.com", "company": "<b>Hax</b> School",
    })

    r = await client.post("/api/email/send-now", json={
        "subject": "Hi {name}",
        "body_html": "<p>Hi {name} at {school_name}</p>",
        "recipient_ids": ["con_xss1"],
        "source": "manual",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["queued"] == 1

    rows = await test_db.email_scheduled.find({"campaign_id": body["campaign_id"]}).to_list(None)
    assert len(rows) == 1
    row = rows[0]
    assert "&lt;script&gt;" in row["body_html"]
    assert "<script>evil</script>" not in row["body_html"]


@pytest.mark.asyncio
async def test_send_now_skips_suppressed(client, test_db):
    await test_db.contacts.insert_one({
        "contact_id": "con_qa2", "name": "Asha Kumar",
        "email": "asha@example.com", "company": "Sunrise School",
    })
    await test_db.contacts.insert_one({
        "contact_id": "con_qa3", "name": "Ravi Singh",
        "email": "ravi@example.com", "company": "Green Valley School",
    })
    await test_db.email_suppressions.insert_one({"email": "ravi@example.com"})

    r = await client.post("/api/email/send-now", json={
        "subject": "Hi {name}",
        "body_html": "<p>Hello {name}</p>",
        "recipient_ids": ["con_qa2", "con_qa3"],
        "source": "manual",
    })
    assert r.status_code == 200, r.text
    assert r.json()["queued"] == 1


# ---------------------------------------------------------------------------
# Seeded system templates: body_html must be populated for evergreen templates
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_seeded_templates_have_html(client):
    r = await client.get("/api/email/templates")
    assert r.status_code == 200, r.text
    templates = r.json()

    with_html = [t for t in templates if (t.get("body_html") or "").strip()]
    assert len(with_html) >= 1, "expected at least one seeded template with body_html"

    demo = next((t for t in templates if t["name"] == "Demo Invitation Email"), None)
    assert demo is not None, "seeded 'Demo Invitation Email' template not found"
    html = demo.get("body_html") or ""
    assert html, "Demo Invitation Email body_html should not be empty"
    assert "{school_name}" in html or "{name}" in html
    assert "#e94560" in html


@pytest.mark.asyncio
async def test_send_now_validation(client, test_db):
    r = await client.post("/api/email/send-now", json={
        "subject": "Hi", "body_html": "<p>hi</p>", "recipient_ids": [],
    })
    assert r.status_code == 400

    r = await client.post("/api/email/send-now", json={
        "subject": "", "body_html": "<p>hi</p>", "recipient_ids": ["con_qa1"],
    })
    assert r.status_code == 400

    r = await client.post("/api/email/send-now", json={
        "subject": "Hi", "body_html": "", "recipient_ids": ["con_qa1"],
    })
    assert r.status_code == 400
