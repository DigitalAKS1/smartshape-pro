# WhatsApp W1 — Foundation (Evolution upgrade, one sending service, "My WhatsApp") — Implementation Plan

**Goal.** Put every WhatsApp message the CRM sends through one service that picks the right
number (the record owner's linked company SIM, else the company number), enforces consent,
opt-out, business hours and per-number ban-protection caps, and writes one audit row per
message — and give each rep a "My WhatsApp" page to link their number and each admin a
Settings → WhatsApp page to run all numbers, on an Evolution API server that is upgraded,
private, and authenticated.

**Architecture.** `backend/services/wa_send.py: send_whatsapp(...)` becomes the only code that
sends; it resolves the sender from `users.wa_instance_name` → `wa_instances` (company
fallback), gates the message on `settings{type:"wa"}` policy, sends through a refactored
per-instance `EvolutionClient`, and records `wa_messages` + `wa_send_ledger` + an engagement
event, deferring anything outside hours or over cap to a `queued` row that a per-instance
drainer in `scheduler.py` sends every minute. Evolution calls a per-instance, secret-checked
webhook (`/api/webhooks/whatsapp/{instance}?t=`) that keeps `wa_instances.state` and
`wa_messages.status` current, and an hourly health job (plus a host script for RAM) raises
bell + push alerts. Two React surfaces sit on `/api/wa/*`: My WhatsApp (`/me/whatsapp`) for
reps and Settings → WhatsApp for admins, replacing `WhatsAppConnectionSection` and the
Marketing Setup provider form.

**Tech stack.** FastAPI + Motor (MongoDB), `httpx` (already imported), `redis.asyncio` (existing
`backend/cache.py`, not used by W1 code but reserved for W2 pub/sub), Evolution API
`evoapicloud/evolution-api:v2.3.7` (Baileys), React 18 + craco/Jest, docker compose on the VPS.
Tests: pytest + `mongomock_motor`, Jest with `react-dom/client` `createRoot` + `act`.

**Spec (binding):** `F:\ss-wa\docs\superpowers\specs\2026-09-24-whatsapp-team-numbers-inbox-design.md`
— this plan covers **Sub-project W1 only** (Infrastructure, Sending service, Routes, Frontend,
Testing → W1, Security and privacy, Rollout steps 1–3). W2–W4 interfaces it leaves room for are
listed under each task's **Interfaces**.

**Branch / worktree.** `feat/whatsapp-team` in `F:\ss-wa` (HEAD `5b7c0a3`, = origin/main `b9151a3`
+ the spec). Line numbers below were re-grepped in `F:\ss-wa` on 2026-09-24; re-grep before each
edit, earlier tasks shift later line numbers in the same file.

---

## Global Constraints

### Decisions (copied verbatim from the spec — D8 is W2's and is omitted)

- **D1 — Dedicated company SIM per rep.** Each salesperson links a company-owned number used only through the CRM. A ban costs a SIM,
  not a personal account. The linking page warns in plain words if the number looks personal; it does not block it.
- **D2 — Owner-routed sending with company fallback.** Every automated message is sent from the linked number of the record's owner
  (`contact.assigned_to` → `school.assigned_to` → company). If the owner has no connected number, the **company number** sends and the
  log says so. The 409 unowned contacts always go via the company number until assigned.
- **D3 — One door.** A single service, `services/wa_send.py: send_whatsapp(...)`, is the only code allowed to send. It resolves the
  sender, checks consent/opt-out/quiet hours/caps, sends through Evolution, and writes one log row. The four stacks and six copied
  AutoSender calls are removed or rerouted through it. MessageAutoSender stays configurable as an **emergency fallback provider**
  behind a setting (`wa.fallback_provider: none|autosender`), default `none`, until the team has run on Evolution for two weeks.
- **D4 — Managers read and reply as the rep.** A manager/admin can open any conversation and send from the rep's number. The message
  row records `typed_by` (the manager) and `sent_via` (the rep's number); the school sees the rep. Reps see only their own numbers'
  chats plus company-number chats for records they own.
- **D5 — Ban protection is enforced in the service, per number, and is configurable.** Defaults from community experience:
  warm-up 20/day → doubling every 3 days → cap 200/day; ≤ 30/hour; random 8–25 s gap between automated sends from one number;
  business hours 09:00–19:00 IST for automations (greetings at 09:00–09:30); max one automated message per contact per number per day;
  number-exists check before first contact; auto-pause a number after 5 consecutive send failures or a `CONNECTION_UPDATE` close,
  with an admin alert. Manual chat replies bypass the daily cap but not the hourly rate.
- **D6 — Evolution is upgraded first**, to the current stable `evoapicloud/evolution-api:v2.3.7`, with a Postgres backup before the
  image bump, the `CONFIG_SESSION_PHONE_VERSION` pin removed (removed upstream in 2.3.1), `SYNC_FULL_HISTORY=true`,
  `MESSAGES_UPSERT` enabled, `WEBSOCKET` disabled (we fan out ourselves), port 8080 bound to `127.0.0.1` only, and the repo's
  `docker-compose.evolution.yml` rewritten so a redeploy can never downgrade it. The `warp`/`tor-sidecar` services are dropped.
- **D7 — Capacity is server-bound.** Each Baileys instance costs ~300–500 MB RAM; the VPS has 3.9 GB. Phase 1 caps linked numbers at
  **3 reps + company** via a setting (`wa.max_instances`, default 4) and shows RAM headroom on the admin page. Going beyond needs a
  VPS upgrade first; the design does not change.
- **D9 — Every message is stored once, keyed by (instance, provider message id).** Webhook deliveries are idempotent; duplicates are
  dropped. Inbound media is downloaded via `getBase64FromMediaMessage` and stored through `services/storage.py` (Cloudinary when
  configured, else local `uploads/whatsapp/`), never left as an encrypted WhatsApp reference.
- **D10 — Consent and opt-out are enforced in the service, not per caller.** `require_wa_consent` (existing setting) gates
  automations; a contact/school with `wa_opt_out: true` is never messaged by an automation and the inbox shows "opted out". Inbound
  `STOP`/`UNSUBSCRIBE`/`बंद`/`रोकें` (configurable list) sets opt-out and replies once with a confirmation.
- **D11 — Official WhatsApp Business API is out of scope now, designed-for later.** `send_whatsapp` takes a `channel` hint
  (`rep|company|official`) so a BSP channel can be added for bulk blasts without touching callers.

### Execution rules (binding for every task)

1. **Never a bare `pytest tests/`.** Every backend run is prefixed and names its files:
   `cd backend && DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 python -m pytest tests/test_a.py tests/test_b.py -q`
2. **`python`, never `python3`** (the Store `python3` stub is broken on this machine). On the VPS, `python3` is fine.
3. **Stage explicit filenames.** Never `git add -A` / `git add .`.
4. **`git add -f` for every new file under `backend/tests/`** (`tests/` is in `.gitignore` — line 89 — so a new test file,
   `conftest.py` and `wa_fixtures.py` are silently not staged otherwise).
5. **No new top-level third-party backend import.** Only stdlib and modules the edited file already imports (`httpx`,
   `fastapi`, `pymongo` via motor). SSE (W2) will use Starlette's `StreamingResponse`; pub/sub (W2) the existing
   `redis.asyncio` client in `backend/cache.py`. A route module imports `services.*` lazily when a cycle is possible.
6. **Tests must never send.** Task 1 adds a suite-wide autouse guard in `backend/tests/conftest.py`: `httpx.AsyncClient.send`
   and `requests.Session.send` raise unless the transport is in-process (ASGI/Mock), and every `EvolutionClient` network
   entry point raises. A WhatsApp test that needs Evolution to answer uses the `fake_evolution` recorder fixture (Task 2);
   every WhatsApp test asserts on that recorder, never on a live call.
7. **Frontend bundle rebuild before merge:** `bash scripts/build-frontend.sh`, then commit `frontend/build/`. Never build on the VPS.
8. **The Evolution upgrade is an OPERATIONAL task** (Task 12) run with the owner present, following its runbook exactly:
   backup → image bump → verify → link company number → test message → rollback path. It is not app code and is not
   done by pushing to `main`.
9. Commit trailer on every commit: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
10. Frontend tests: `cd frontend && npx craco test --watchAll=false --testPathPattern "<pattern>"` (no testing-library;
    `createRoot` + `act`, `jest.mock` for `../lib/api`, `sonner`, layouts).

---

## Review Focus — the five untested input classes most likely to bite

| # | Input class | Why it bites | Pinned to |
|---|---|---|---|
| RF1 | **A webhook for an instance we don't know** (or whose `payload.instance` differs from the path) | Evolution retries non-2xx forever; an unknown name must not create rows, and a forged body must not move another number's state. | Task 6 tests `test_unknown_instance_is_acknowledged_and_ignored`, `test_payload_instance_must_match_the_path`, `test_secret_is_checked_before_the_body_is_read` |
| RF2 | **A rep linking a number already linked by someone else** (same SIM scanned on two instances) | Two instances on one number double-send and split the history; the second must be unlinked, logged out and both people told. | Task 6 test `test_open_on_a_number_already_linked_elsewhere_unlinks_the_newcomer` |
| RF3 | **The company instance itself disconnecting** | Every unowned record (409 contacts) and every fallback depends on it; a silent close means silent skips. | Task 4 test `test_company_down_and_no_owner_number_is_skipped_no_sender_not_failed`; Task 6 test `test_company_close_alerts_every_admin`; Task 8 test `test_health_sweep_marks_company_disconnected_and_alerts` |
| RF4 | **A phone stored as `+91 98xxx` vs `98xxx` vs `0…` vs `0091…` vs a landline** | The same person must hit the same ledger/opt-out/number-exists keys; a landline must never reach Evolution. | Task 4 test `test_phone_forms_normalise_to_one_e164` (parametrised) and `test_a_landline_is_skipped_bad_phone_with_a_row` |
| RF5 | **IST vs UTC around midnight/23:30 for the daily ledger and business hours** | A UTC day key resets the cap at 05:30 IST; a UTC hour check sends "09:00" greetings at 14:30. | Task 5 tests `test_ledger_day_is_the_ist_date_at_2330_and_0001_ist`, `test_quiet_hours_queue_until_0900_ist_next_day`, `test_before_0900_ist_queues_for_the_same_morning` |

---

## File map

| Action | Path | Task |
|---|---|---|
| create | `backend/tests/conftest.py` (tracked copy; keeps the existing marker) | 1, 2, 4 |
| create | `backend/tests/wa_fixtures.py` | 4 |
| create | `backend/tests/test_no_send_guard.py` | 1 |
| modify | `backend/services/evolution_client.py` (whole file, 182 lines) | 2 |
| create | `backend/tests/test_evolution_client.py` | 2 |
| create | `backend/services/wa_config.py` | 3 |
| modify | `backend/database.py` (`connect_db` index block ends `:333`) | 3 |
| create | `backend/tests/test_wa_config.py` | 3 |
| create | `backend/services/wa_send.py` | 4, 5 |
| create | `backend/tests/test_wa_send.py`, `backend/tests/test_wa_send_caps.py` | 4, 5 |
| modify | `backend/scheduler.py` (`start_scheduler` `:2025-2036`, new loops) | 5, 8, 9 |
| create | `backend/routes/wa_routes.py` | 6, 7 |
| modify | `backend/main.py` (router imports `:59`, includes `:112`) | 6 |
| modify | `backend/routes/whatsapp_routes.py` (instance routes `:717-890`, webhook `:948-992`, campaigns `:571-666`) | 6, 7, 9 |
| create | `backend/tests/test_wa_webhook.py`, `backend/tests/test_wa_routes.py` | 6, 7 |
| create | `backend/services/wa_health.py`, `scripts/ss-wa-health.sh`, `backend/tests/test_wa_health.py` | 8 |
| modify | `backend/routes/settings_routes.py`, `crm_routes.py`, `school_routes.py`, `admin_routes.py`, `fms_routes.py`, `backend/fms_actions.py` | 9 |
| modify | tests: `test_contact_drip_executor.py`, `test_drip_executor_concurrency.py`, `test_to_post_linking.py`, `test_wa_tag_broadcast.py`, `test_tag_scope.py`, `test_auto_reminders_no_drip.py`; create `test_wa_callers.py` | 9 |
| modify | `frontend/src/components/WhatsAppSendDialog.jsx`, `frontend/src/hooks/useCRMMasters.js` (+ its test) | 9 |
| modify | `frontend/src/lib/api.js` (`:491-535`), `frontend/src/App.js`, `frontend/src/components/layouts/AdminSidebar.js`, `SalesLayout.js` | 10 |
| create | `frontend/src/hooks/useMyWhatsApp.js`, `frontend/src/pages/MyWhatsApp.js`, `frontend/src/pages/__tests__/MyWhatsApp.test.js` | 10 |
| create | `frontend/src/components/settings/WhatsAppNumbersSection.js` + `__tests__/WhatsAppNumbersSection.test.js` | 11 |
| modify | `frontend/src/pages/admin/AppSettings.js`, `frontend/src/hooks/useAppSettings.js`, `frontend/src/components/marketing/SetupTab.js`, `frontend/src/pages/admin/MarketingHub.js` | 11 |
| delete | `frontend/src/components/settings/WhatsAppConnectionSection.js` | 11 |
| modify | `docker-compose.evolution.yml`, `.env.evolution.example`, `docker-compose.prod.yml`, `backend/.env.example` (if present — else `.env.example`) | 12 |

---

## Task 1 — Suite-wide no-send guard

### Files

| Action | Path | Current refs |
|---|---|---|
| create | `backend/tests/conftest.py` | Not tracked in git today (only an untracked copy in `F:\SMARTSHAPE APP\backend\tests\conftest.py` that registers the `no_dry_run` marker). This task creates the tracked file and keeps that marker verbatim. |
| create | `backend/tests/test_no_send_guard.py` | new |

### Interfaces

**Produces**
- `conftest.NetworkBlocked(AssertionError)` — raised by every guard.
- autouse fixture `_no_outbound_network` — `httpx.AsyncClient.send` raises `NetworkBlocked` unless `self._transport` is an
  `httpx.ASGITransport` or `httpx.MockTransport` (the existing ASGI route tests — `test_admin_roles.py:11,35`,
  `test_forms_*.py` — keep working); `requests.Session.send` always raises.
- autouse fixture `_no_real_evolution` — every coroutine method of `services.evolution_client.EvolutionClient` raises
  `NetworkBlocked` (except `is_connected`, which only calls `get_status` and swallows its error). (Task 2 narrows this to the single chokepoint `_request` and adds `fake_evolution`.)
- module constant `_REAL_EVO: dict[str, callable]` — the real `EvolutionClient` coroutine methods, captured at import so
  `fake_evolution` (Task 2) can restore them.

**Consumes:** nothing new.

### Steps

**1. Write the failing test** — `backend/tests/test_no_send_guard.py`:

```python
"""The suite-wide guard: nothing in the test suite may reach a real network.

Pinned here so a later edit to conftest.py that weakens the guard fails loudly.
Run:
    DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 \
    python -m pytest tests/test_no_send_guard.py -q
"""
import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import httpx
import pytest
import requests
from fastapi import FastAPI

from conftest import NetworkBlocked
from services.evolution_client import EvolutionClient, evolution


def _run(coro):
    return asyncio.run(coro)


def test_httpx_to_the_internet_is_blocked():
    async def go():
        async with httpx.AsyncClient() as c:
            await c.post("https://app.messageautosender.com/message/new", data={"x": "1"})
    with pytest.raises(NetworkBlocked):
        _run(go())


def test_httpx_in_process_asgi_still_works():
    app = FastAPI()

    @app.get("/ping")
    async def ping():
        return {"ok": True}

    async def go():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
            return (await c.get("/ping")).json()
    assert _run(go()) == {"ok": True}


def test_requests_is_blocked():
    with pytest.raises(NetworkBlocked):
        requests.get("https://example.com", timeout=1)


def test_every_evolution_call_is_blocked():
    with pytest.raises(NetworkBlocked):
        _run(evolution.send_text("9811111111", "hi"))
    with pytest.raises(NetworkBlocked):
        _run(EvolutionClient().get_status())


def test_is_connected_swallows_the_block_and_says_no():
    # is_connected() catches every exception by design — the guard must not make it True.
    assert _run(evolution.is_connected()) is False
```

**2. Run — expect failure** (`ImportError: cannot import name 'NetworkBlocked' from 'conftest'`, or the httpx test
reaching the network):

```bash
cd backend && DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 python -m pytest tests/test_no_send_guard.py -q
```

**3. Implement** — create `backend/tests/conftest.py`:

```python
"""Suite-wide guards. Nothing in the test suite may reach a real network.

1. The `no_dry_run` marker (carried over from the untracked conftest this file replaces).
2. `_no_outbound_network` (autouse): httpx.AsyncClient.send and requests.Session.send raise
   NetworkBlocked unless the transport is in-process (ASGITransport / MockTransport), so the
   route tests that drive the FastAPI app through httpx keep working.
3. `_no_real_evolution` (autouse): every EvolutionClient network entry point raises. A WhatsApp
   test that needs Evolution to answer uses the `fake_evolution` fixture (below), a recorder.

A test that needs a real network does not exist in this suite and must not be added.
"""
import inspect
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import httpx
import pytest
import requests

from services import evolution_client as _ec


def pytest_configure(config):
    config.addinivalue_line(
        "markers", "no_dry_run: run only with the server started WITHOUT CALENDAR_INVITE_DRY_RUN")


class NetworkBlocked(AssertionError):
    """A test tried to leave the machine."""


_IN_PROCESS = tuple(t for t in (getattr(httpx, "ASGITransport", None),
                                getattr(httpx, "MockTransport", None)) if t)
_REAL_HTTPX_SEND = httpx.AsyncClient.send
_REAL_EVO = {name: fn for name, fn in vars(_ec.EvolutionClient).items()
             if inspect.iscoroutinefunction(fn)}


@pytest.fixture(autouse=True)
def _no_outbound_network(monkeypatch):
    async def _guarded_send(self, request, *a, **k):
        if isinstance(getattr(self, "_transport", None), _IN_PROCESS):
            return await _REAL_HTTPX_SEND(self, request, *a, **k)
        raise NetworkBlocked(f"a test tried to reach {request.method} {request.url}")
    monkeypatch.setattr(httpx.AsyncClient, "send", _guarded_send)

    def _blocked(self, request, **k):
        raise NetworkBlocked(f"a test tried to reach {request.method} {request.url}")
    monkeypatch.setattr(requests.Session, "send", _blocked)


@pytest.fixture(autouse=True)
def _no_real_evolution(monkeypatch):
    def _make(name):
        async def _blocked(self, *a, **k):
            raise NetworkBlocked(f"EvolutionClient.{name} called without the fake_evolution fixture")
        return _blocked
    for name in _REAL_EVO:
        if name == "is_connected":      # only calls get_status, and swallows its error by design
            continue
        monkeypatch.setattr(_ec.EvolutionClient, name, _make(name))
```

**4. Run — expect pass**, then run the suites most likely to be disturbed by a global guard:

```bash
cd backend && DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 python -m pytest tests/test_no_send_guard.py tests/test_admin_roles.py tests/test_forms_crud.py tests/test_forms_public.py tests/test_wa_tag_broadcast.py tests/test_tag_scope.py tests/test_contact_drip_executor.py tests/test_drip_executor_concurrency.py tests/test_auto_reminders_no_drip.py -q
```

Expected: all green (the existing tests stub their own senders; `test_wa_tag_broadcast.py` and `test_tag_scope.py` replace
`httpx.AsyncClient` itself, which the guard does not fight).

**5. Commit**

```bash
git add -f backend/tests/conftest.py backend/tests/test_no_send_guard.py
git commit -m "test: suite-wide guard - no test may reach httpx, requests or Evolution

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 2 — `EvolutionClient`: per-instance calls, one chokepoint, webhook/proxy/token helpers, `check_numbers`

### Files

| Action | Path | Current refs |
|---|---|---|
| modify (rewrite) | `backend/services/evolution_client.py` | whole file `:1-182`; singleton bound to env instance `:40`; singleton `:182` |
| modify | `backend/tests/conftest.py` | from Task 1 |
| create | `backend/tests/test_evolution_client.py` | new |

Existing callers that must keep working unchanged until Task 9 migrates them: `whatsapp_routes.py:584,628,724,729,740,751,763`
(and `evolution.base` / `evolution._headers` at `:776-877`), `scheduler.py:1089` (`send_text`), `scheduler.py:1539` (`send_document`).

### Interfaces

**Produces** (`services/evolution_client.py`)
- constants `EVOLUTION_BASE`, `EVOLUTION_KEY`, `INSTANCE_NAME` (unchanged env names), `WEBHOOK_EVENTS =
  ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE", "QRCODE_UPDATED", "SEND_MESSAGE"]`.
- `class EvolutionError(RuntimeError)` with `.status_code: int`, `.body: str`.
- `def webhook_url(instance: str) -> str` → `f"{WA_WEBHOOK_BASE}/api/webhooks/whatsapp/{instance}?t={WA_WEBHOOK_SECRET}"`
  (env read at call time; base default `https://app.smartshape.in`).
- `def instance_token(create_response: dict) -> str` — handles `{"hash": "<tok>"}` and `{"hash": {"apikey": "<tok>"}}`.
- `def provider_message_id(send_response: dict) -> str` — `key.id`, else `id`, else `""`.
- `class EvolutionClient(base=None, key=None, instance=None)`; every network call goes through
  `async def _request(self, method: str, path: str, *, json: dict | None = None, token: str | None = None,
  timeout: float = 15.0) -> dict | list` (raises `EvolutionError` on HTTP ≥ 400).
- Per-instance methods (keyword `instance=None` falls back to `self.instance`; `token=None` falls back to the global key):
  `create_instance(instance=None)`, `get_qr(instance=None, *, token=None)`, `get_status(instance=None, *, token=None)`,
  `connection_state(instance=None, *, token=None) -> "open"|"close"|"connecting"`, `fetch_instance(instance) -> dict`,
  `logout(instance=None, *, token=None)`, `delete_instance(instance)`, `is_connected(instance=None, *, token=None) -> bool`,
  `set_webhook(instance, *, url=None, events=None, token=None)`, `set_proxy(instance, proxy: dict | None, *, token=None)`,
  `find_proxy(instance, *, token=None)`, `check_numbers(numbers: list[str], *, instance=None, token=None) -> dict[str, bool]`,
  `send_text(phone, message, *, instance=None, token=None)`,
  `send_media(phone, url, *, mediatype, caption="", filename="", mimetype="", instance=None, token=None)`,
  `send_image / send_document / send_video` (old positional signatures + `instance`/`token` keywords),
  `send_message_with_attachment(...)` (old signature + `instance`/`token` keywords).
- `evolution = EvolutionClient()` — unchanged singleton (company/default instance).

**Produces** (`tests/conftest.py`)
- `_no_real_evolution` now patches only `EvolutionClient._request` (every method funnels through it).
- fixture `fake_evolution` → `FakeEvolution` recorder: `.calls` (every request), `.sends` (`{instance, number, text,
  media, mediatype, token}`), knobs `.fail_sends`, `.fail_with`, `.not_on_whatsapp: set[str]`, `.check_raises`,
  `.state: dict[instance, "open"|"close"|"connecting"]`, `.owner_jid: dict[instance, jid]`, `.on_send` (async hook
  called with the send record after it is recorded; raising from it simulates a provider error), `.fail_if` (callable →
  bool, checked before each send — lets an existing test keep its own `sent["wa_raises"]` flag),
  `.create_status` (HTTP status to raise on `/instance/create`, e.g. 403 = "name in use").

**Consumes:** nothing new.

### Steps

**1. Failing test** — `backend/tests/test_evolution_client.py`:

```python
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
    assert hook["url"] == "https://app.smartshape.in/api/webhooks/whatsapp/rep_u1?t=s3cret"
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
```

**2. Run — expect failure** (`fake_evolution` fixture not found; `set_webhook` / `check_numbers` missing):

```bash
cd backend && DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 python -m pytest tests/test_evolution_client.py -q
```

**3. Implement** — replace `backend/services/evolution_client.py` entirely:

```python
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
```

Then replace `_no_real_evolution` in `backend/tests/conftest.py` and add `FakeEvolution` + `fake_evolution` (append to the file):

```python
@pytest.fixture(autouse=True)
def _no_real_evolution(monkeypatch):
    """Every EvolutionClient method funnels through _request, so blocking it blocks them all."""
    async def _blocked(self, method, path, **k):
        raise NetworkBlocked(f"EvolutionClient {method} {path} called without the fake_evolution fixture")
    monkeypatch.setattr(_ec.EvolutionClient, "_request", _blocked)


class FakeEvolution:
    """Stands in for the Evolution server. `calls` holds every request; `sends` the
    sendText/sendMedia ones as {instance, number, text, media, mediatype, token}."""

    def __init__(self):
        self.calls, self.sends = [], []
        self.fail_sends = False
        self.fail_with = "provider rejected the message"
        self.not_on_whatsapp = set()
        self.check_raises = False
        self.state = {}
        self.owner_jid = {}
        self.on_send = None
        self.fail_if = None
        self.create_status = None
        self._n = 0

    async def request(self, method, path, json=None, token=None):
        self.calls.append({"method": method, "path": path, "json": json, "token": token})
        tail = path.split("?")[0].rstrip("/").split("/")[-1]
        if path.startswith("/message/send"):
            if self.fail_sends or (self.fail_if and self.fail_if()):
                raise _ec.EvolutionError(500, self.fail_with)
            self._n += 1
            rec = {"instance": tail, "number": json.get("number"),
                   "text": json.get("text", json.get("caption", "")),
                   "media": json.get("media"), "mediatype": json.get("mediatype"), "token": token}
            self.sends.append(rec)
            if self.on_send:
                await self.on_send(rec)          # may raise to simulate a provider error
            return {"key": {"id": f"PMID{self._n}", "fromMe": True,
                            "remoteJid": f"{json.get('number')}@s.whatsapp.net"}, "status": "PENDING"}
        if path.startswith("/chat/whatsappNumbers/"):
            if self.check_raises:
                raise _ec.EvolutionError(500, "check failed")
            return [{"number": n, "exists": n not in self.not_on_whatsapp, "jid": f"{n}@s.whatsapp.net"}
                    for n in json.get("numbers", [])]
        if path == "/instance/create":
            if self.create_status:
                raise _ec.EvolutionError(self.create_status, "This name is already in use.")
            name = json["instanceName"]
            self.state.setdefault(name, "connecting")
            return {"instance": {"instanceName": name, "status": "created"}, "hash": f"tok_{name}"}
        if path.startswith("/instance/connect/"):
            return {"code": "2@abc", "base64": "data:image/png;base64,QR", "count": 1}
        if path.startswith("/instance/connectionState/"):
            return {"instance": {"instanceName": tail, "state": self.state.get(tail, "close")}}
        if path.startswith("/instance/fetchInstances"):
            name = path.split("instanceName=")[-1]
            return [{"name": name, "connectionStatus": self.state.get(name, "close"),
                     "ownerJid": self.owner_jid.get(name)}]
        if path.startswith("/instance/logout/"):
            self.state[tail] = "close"
            return {"status": "SUCCESS"}
        return {}


@pytest.fixture()
def fake_evolution(monkeypatch):
    fake = FakeEvolution()

    async def _request(self, method, path, *, json=None, token=None, timeout=None):
        return await fake.request(method, path, json=json, token=token)
    monkeypatch.setattr(_ec.EvolutionClient, "_request", _request)
    return fake
```

Also delete the now-unused `_REAL_EVO` loop body from `_no_real_evolution` (the dict itself stays — `test_evolution_client.py`
imports `_REAL_EVO["_request"]`). `_REAL_EVO` is built at import from the real class, so it holds the real `_request`.

**4. Run — expect pass**, plus the Task 1 guard test and the two modules that import the singleton:

```bash
cd backend && DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 python -m pytest tests/test_evolution_client.py tests/test_no_send_guard.py -q
cd backend && python -c "import routes.whatsapp_routes, scheduler; print('imports ok')"
```

**5. Commit**

```bash
git add backend/services/evolution_client.py
git add -f backend/tests/conftest.py backend/tests/test_evolution_client.py
git commit -m "feat(wa): per-instance Evolution client with one network chokepoint, webhook/proxy/number-check helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## Task 3 — Data model, indexes, `wa.*` settings defaults

### Files

| Action | Path | Current refs |
|---|---|---|
| create | `backend/services/wa_config.py` | new |
| modify | `backend/database.py` | `_i()` `:40-46`; `connect_db()` `:120`; engagement index block `:327-333`; log line `:335` |
| create | `backend/tests/test_wa_config.py` | new |

### Interfaces

**Produces** (`services/wa_config.py`)
- `WA_SETTINGS_TYPE = "wa"`; `COMPANY_INSTANCE = os.getenv("WHATSAPP_INSTANCE", "smartshape")` — the company number *is* the
  env default instance, so the `evolution` singleton and the company row name the same Evolution instance.
- `PRIVACY_NOTICE: str` (spec wording, verbatim).
- `INSTANCE_STATES = ("unlinked", "qr", "connected", "disconnected", "paused")`.
- `WA_DEFAULTS: dict` — `warmup_start_cap 20, warmup_double_every_days 3, warmup_days 14, daily_cap 200, hourly_cap 30,
  gap_min_s 8, gap_max_s 25, business_start "09:00", business_end "19:00", per_contact_per_day 1, failure_pause_after 5,
  number_check_ttl_days 30, opt_out_keywords ["STOP","UNSUBSCRIBE","बंद","रोकें"], fallback_provider "none",
  max_instances 4, drip_wa_enabled False, greetings_enabled False`.
- `class WaSettingsError(ValueError)`.
- `async def get_wa_settings(db) -> dict` (defaults merged with `settings{type:"wa"}`; unknown keys ignored).
- `def validate_wa_settings(body: dict, current: dict) -> dict` (raises `WaSettingsError`).
- `async def save_wa_settings(db, body: dict, *, by: str) -> dict`.
- `def rep_instance_name(user: dict) -> str` → `"rep_<user_id>"` (email-derived when a legacy user has no `user_id`).

**Produces** (`database.py`)
- `async def ensure_wa_indexes(target_db) -> None`, called from `connect_db()`:
  - `wa_messages (instance_name, provider_msg_id)` **unique, partial** on `provider_msg_id: {$type: "string"}` — queued,
    skipped and failed rows have no provider id yet; a plain unique index would reject the second one (D9).
  - `wa_messages message_id` unique; `(chat_id, created_at)`; `(contact_id, created_at)`; `(school_id, created_at)`;
    `(status, instance_name, send_after)` (the drainer's query).
  - `wa_chats (instance_name, last_message_at)`, `wa_chats contact_id` (W2 fills the collection).
  - `wa_send_ledger (instance_name, day)` **unique**.
  - `wa_instances instance_name` unique; `wa_instances owner_email`; `wa_instances phone_e164`.
  - `wa_number_cache phone_e164` unique; `wa_opt_outs phone_e164`; `wa_events_raw (instance_name, received_at)`.

**Data model written from W1 on** (spec "Data model", with W1 additions marked ✚):

```
wa_instances   {instance_name, kind "rep"|"company", owner_email, label, phone_e164, jid, state, state_at, last_seen_at,
                proxy{host,port,protocol,username,password}, instance_token, warmup_started_at, daily_cap_override,
                paused_reason, created_at, notice_accepted_at, notice_accepted_by ✚, qr_base64 ✚, qr_at ✚,
                consecutive_failures ✚, last_error ✚, last_sent_at ✚, last_checked_at ✚, evolution_state ✚}
wa_messages    {message_id, instance_name, provider_msg_id, chat_id, direction, from_jid, to_jid, to_e164 ✚, contact_id,
                lead_id, school_id, kind, ref{…, dedup_key ✚}, text, media{type,url,mime,filename,size,caption},
                quoted_provider_msg_id, typed_by, owner_email ✚, channel ✚, enforce_consent ✚, sent_via_owner_email,
                sender_kind ✚, used_company_fallback ✚, provider ✚ "evolution"|"autosender", status, status_history,
                fail_reason, send_after ✚, claimed_at ✚, sent_at ✚, sent_day ✚ (IST date), source ✚ "app"|"phone",
                created_at, provider_ts}
wa_send_ledger {instance_name, day (IST date), sent_count, hour_bucket{"09": n}, last_sent_at}
wa_number_cache ✚ {phone_e164, exists, checked_at}          (mirrored onto contacts.wa_number_exists/…_checked_at)
wa_events_raw   ✚ {instance_name, event, data, received_at}  (W2's MESSAGES_UPSERT input until W2 ingests it)
users          + {wa_instance_name}
settings       + {type:"wa", …WA_DEFAULTS} ; {type:"wa_health", …} (Task 8) ; {type:"wa_proxy_default", …} (Task 7)
```

Deviation noted: `consecutive_failures` lives on `wa_instances`, not on the per-day ledger row the spec lists it under — a
failure streak must survive IST midnight (five failures at 23:58–00:03 are still five in a row).

### Steps

**1. Failing test** — `backend/tests/test_wa_config.py`:

```python
"""wa.* settings: safe defaults, strict validation, and the index set (D5, D7, D9).

Run:
    DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 \
    python -m pytest tests/test_wa_config.py -q
"""
import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from mongomock_motor import AsyncMongoMockClient

import database
from services import wa_config as wc


def _run(coro):
    return asyncio.run(coro)


def test_defaults_on_an_empty_database_are_the_spec_values():
    db = AsyncMongoMockClient()["smartshape_test"]
    cfg = _run(wc.get_wa_settings(db))
    assert cfg["warmup_start_cap"] == 20 and cfg["warmup_double_every_days"] == 3 and cfg["daily_cap"] == 200
    assert cfg["hourly_cap"] == 30 and (cfg["gap_min_s"], cfg["gap_max_s"]) == (8, 25)
    assert (cfg["business_start"], cfg["business_end"]) == ("09:00", "19:00")
    assert cfg["failure_pause_after"] == 5 and cfg["number_check_ttl_days"] == 30
    assert cfg["max_instances"] == 4 and cfg["fallback_provider"] == "none"
    assert cfg["opt_out_keywords"] == ["STOP", "UNSUBSCRIBE", "बंद", "रोकें"]
    assert cfg["drip_wa_enabled"] is False and cfg["greetings_enabled"] is False


def test_saved_values_override_and_unknown_keys_are_ignored():
    db = AsyncMongoMockClient()["smartshape_test"]
    _run(db.settings.insert_one({"type": "wa", "hourly_cap": 12, "evil": "x"}))
    cfg = _run(wc.get_wa_settings(db))
    assert cfg["hourly_cap"] == 12 and "evil" not in cfg


@pytest.mark.parametrize("body,msg", [
    ({"hourly_cap": 0}, "hourly_cap"),
    ({"daily_cap": "lots"}, "whole number"),
    ({"gap_min_s": 30, "gap_max_s": 10}, "gap_min_s"),
    ({"business_start": "19:00", "business_end": "09:00"}, "before"),
    ({"business_start": "9am"}, "HH:MM"),
    ({"fallback_provider": "gupshup"}, "fallback_provider"),
    ({"opt_out_keywords": []}, "opt_out_keywords"),
    ({"max_instances": 99}, "max_instances"),
])
def test_validation_rejects_unsafe_values(body, msg):
    with pytest.raises(wc.WaSettingsError) as e:
        wc.validate_wa_settings(body, dict(wc.WA_DEFAULTS))
    assert msg in str(e.value)


def test_save_round_trips_and_records_who():
    db = AsyncMongoMockClient()["smartshape_test"]
    out = _run(wc.save_wa_settings(db, {"hourly_cap": 20, "fallback_provider": "autosender",
                                        "opt_out_keywords": [" stop ", "बंद"]}, by="info@smartshape.in"))
    assert out["hourly_cap"] == 20 and out["opt_out_keywords"] == ["stop", "बंद"]
    doc = _run(db.settings.find_one({"type": "wa"}, {"_id": 0}))
    assert doc["updated_by"] == "info@smartshape.in" and doc["fallback_provider"] == "autosender"


def test_rep_instance_name():
    assert wc.rep_instance_name({"user_id": "user_ab12CD", "email": "x@y"}) == "rep_user_ab12cd"
    assert wc.rep_instance_name({"email": "parul.k@smartshape.in"}) == "rep_parul_k"


class _Rec:
    def __init__(self):
        self.calls = []

    def __getattr__(self, coll):
        rec = self

        class _C:
            async def create_index(self, keys, **kw):
                rec.calls.append((coll, keys, kw))
        return _C()


def test_wa_indexes_include_the_partial_unique_provider_key_and_the_ledger_key():
    rec = _Rec()
    _run(database.ensure_wa_indexes(rec))
    by = {(c, str(k)): kw for c, k, kw in rec.calls}
    key = by[("wa_messages", str([("instance_name", 1), ("provider_msg_id", 1)]))]
    assert key["unique"] is True
    assert key["partialFilterExpression"] == {"provider_msg_id": {"$type": "string"}}
    assert by[("wa_send_ledger", str([("instance_name", 1), ("day", 1)]))]["unique"] is True
    assert by[("wa_instances", str("instance_name"))]["unique"] is True
    assert ("wa_messages", str([("status", 1), ("instance_name", 1), ("send_after", 1)])) in by
```

**2. Run — expect failure** (`ModuleNotFoundError: services.wa_config`).

```bash
cd backend && DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 python -m pytest tests/test_wa_config.py -q
```

**3. Implement** — create `backend/services/wa_config.py`:

```python
"""WhatsApp settings, names and defaults (spec 2026-09-24, D5 / D7).

One settings document, settings{type:"wa"}. Every key has a default here, so a fresh database
behaves safely (warm-up on, business hours on, fallback off, WhatsApp drips and greetings held
until the owner switches them on — Rollout step 2).
"""
import os
import re
from datetime import datetime, timezone

WA_SETTINGS_TYPE = "wa"
# The company number IS the env default instance, so the old `evolution` singleton and the
# company row always name the same Evolution instance.
COMPANY_INSTANCE = os.getenv("WHATSAPP_INSTANCE", "smartshape")

PRIVACY_NOTICE = ("Every message this number sends or receives is visible to managers in the app. "
                  "Link a company number, not your personal one.")

INSTANCE_STATES = ("unlinked", "qr", "connected", "disconnected", "paused")

WA_DEFAULTS = {
    "warmup_start_cap": 20,
    "warmup_double_every_days": 3,
    "warmup_days": 14,
    "daily_cap": 200,
    "hourly_cap": 30,
    "gap_min_s": 8,
    "gap_max_s": 25,
    "business_start": "09:00",
    "business_end": "19:00",
    "per_contact_per_day": 1,
    "failure_pause_after": 5,
    "number_check_ttl_days": 30,
    "opt_out_keywords": ["STOP", "UNSUBSCRIBE", "बंद", "रोकें"],
    "fallback_provider": "none",
    "max_instances": 4,
    "drip_wa_enabled": False,
    "greetings_enabled": False,
}

_INT_RANGES = {
    "warmup_start_cap": (1, 1000), "warmup_double_every_days": (1, 30), "warmup_days": (0, 60),
    "daily_cap": (1, 2000), "hourly_cap": (1, 500), "gap_min_s": (0, 600), "gap_max_s": (0, 600),
    "per_contact_per_day": (1, 10), "failure_pause_after": (1, 50), "number_check_ttl_days": (1, 365),
    "max_instances": (1, 20),
}
_BOOLS = ("drip_wa_enabled", "greetings_enabled")
_HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


class WaSettingsError(ValueError):
    pass


async def get_wa_settings(db) -> dict:
    doc = await db.settings.find_one({"type": WA_SETTINGS_TYPE}, {"_id": 0}) or {}
    out = {k: (list(v) if isinstance(v, list) else v) for k, v in WA_DEFAULTS.items()}
    for k in WA_DEFAULTS:
        if doc.get(k) is not None:
            out[k] = doc[k]
    return out


def validate_wa_settings(body: dict, current: dict) -> dict:
    out = dict(current)
    for k, v in (body or {}).items():
        if k in _INT_RANGES:
            lo, hi = _INT_RANGES[k]
            try:
                iv = int(v)
            except (TypeError, ValueError):
                raise WaSettingsError(f"{k} must be a whole number")
            if not lo <= iv <= hi:
                raise WaSettingsError(f"{k} must be between {lo} and {hi}")
            out[k] = iv
        elif k in _BOOLS:
            out[k] = bool(v)
        elif k in ("business_start", "business_end"):
            if not isinstance(v, str) or not _HHMM.match(v):
                raise WaSettingsError(f"{k} must be HH:MM (24-hour, IST)")
            out[k] = v
        elif k == "opt_out_keywords":
            words = [str(x).strip() for x in (v if isinstance(v, list) else []) if str(x).strip()]
            if not 1 <= len(words) <= 30 or any(len(w) > 30 for w in words):
                raise WaSettingsError("opt_out_keywords must be 1-30 words, each up to 30 characters")
            out[k] = words
        elif k == "fallback_provider":
            if v not in ("none", "autosender"):
                raise WaSettingsError("fallback_provider must be 'none' or 'autosender'")
            out[k] = v
        # any other key is ignored — never stored
    if out["gap_min_s"] > out["gap_max_s"]:
        raise WaSettingsError("gap_min_s cannot be more than gap_max_s")
    if out["business_start"] >= out["business_end"]:
        raise WaSettingsError("business_start must be before business_end")
    if out["warmup_start_cap"] > out["daily_cap"]:
        raise WaSettingsError("warmup_start_cap cannot be more than daily_cap")
    return out


async def save_wa_settings(db, body: dict, *, by: str) -> dict:
    new = validate_wa_settings(body, await get_wa_settings(db))
    await db.settings.update_one(
        {"type": WA_SETTINGS_TYPE},
        {"$set": {**new, "type": WA_SETTINGS_TYPE, "updated_by": by,
                  "updated_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True)
    return new


def rep_instance_name(user: dict) -> str:
    uid = re.sub(r"[^a-z0-9_]", "", str(user.get("user_id") or "").lower())
    if not uid:
        local = str(user.get("email") or "").split("@")[0].lower()
        uid = re.sub(r"[^a-z0-9]+", "_", local).strip("_") or "user"
    return f"rep_{uid}"[:60]
```

In `backend/database.py`, add after `close_db`-independent helpers (directly above `async def connect_db():` at `:120`):

```python
async def ensure_wa_indexes(target_db):
    """WhatsApp collections (spec 2026-09-24, W1). All via _i(): an index that cannot be built
    over existing data logs and moves on instead of crashing startup."""
    # D9: one row per (instance, provider message id). PARTIAL: queued/skipped/failed rows have
    # no provider id yet, and a plain unique index would reject the second such row.
    await _i(target_db.wa_messages.create_index(
        [("instance_name", 1), ("provider_msg_id", 1)], unique=True,
        partialFilterExpression={"provider_msg_id": {"$type": "string"}}, background=True))
    await _i(target_db.wa_messages.create_index("message_id", unique=True, background=True))
    await _i(target_db.wa_messages.create_index([("chat_id", 1), ("created_at", -1)], background=True))
    await _i(target_db.wa_messages.create_index([("contact_id", 1), ("created_at", -1)], background=True))
    await _i(target_db.wa_messages.create_index([("school_id", 1), ("created_at", -1)], background=True))
    await _i(target_db.wa_messages.create_index(
        [("status", 1), ("instance_name", 1), ("send_after", 1)], background=True))   # queue drainer
    await _i(target_db.wa_chats.create_index([("instance_name", 1), ("last_message_at", -1)], background=True))
    await _i(target_db.wa_chats.create_index("contact_id", background=True))
    await _i(target_db.wa_send_ledger.create_index([("instance_name", 1), ("day", 1)], unique=True, background=True))
    await _i(target_db.wa_instances.create_index("instance_name", unique=True, background=True))
    await _i(target_db.wa_instances.create_index("owner_email", background=True))
    await _i(target_db.wa_instances.create_index("phone_e164", background=True))
    await _i(target_db.wa_number_cache.create_index("phone_e164", unique=True, background=True))
    await _i(target_db.wa_opt_outs.create_index("phone_e164", background=True))
    await _i(target_db.wa_events_raw.create_index([("instance_name", 1), ("received_at", -1)], background=True))
```

and inside `connect_db()`, directly after the engagement index block (after `:333`, before the `logging.info("Database
indexes created/verified …")` line at `:335`):

```python
    # ── WhatsApp team numbers (spec 2026-09-24, W1) ───────────────────────────
    await ensure_wa_indexes(db)
```

**4. Run — expect pass.**

```bash
cd backend && DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 python -m pytest tests/test_wa_config.py tests/test_db_startup_ready_wait.py -q
```

**5. Commit**

```bash
git add backend/services/wa_config.py backend/database.py
git add -f backend/tests/test_wa_config.py
git commit -m "feat(wa): wa.* settings with safe defaults, WhatsApp collections and guarded indexes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 4 — `services/wa_send.py` core: sender resolution, opt-out/consent, number check, one row, one event

### Files

| Action | Path | Current refs |
|---|---|---|
| create | `backend/services/wa_send.py` | new |
| create | `backend/tests/wa_fixtures.py` | new (shared seeders, imported by W1 tests and by the tests Task 9 updates) |
| modify | `backend/tests/conftest.py` | add `wa_env` fixture |
| create | `backend/tests/test_wa_send.py` | new |

Logic moved here (deleted from its old home in Task 9): consent rule from `scheduler._wa_consent_ok` (`scheduler.py:380-400`),
AutoSender call from `settings_routes._send_wa_autosender` (`settings_routes.py:960-971`).

### Interfaces

**Produces** (`services/wa_send.py`)

```python
async def send_whatsapp(db, *, to: str, text: str = "", media: dict | None = None, kind: str, ref: dict | None = None,
                        owner_email: str | None = None, contact_id: str = "", lead_id: str = "", school_id: str = "",
                        typed_by: str | None = None, channel: str = "auto", enforce_consent: bool = True) -> dict
# -> {"status": "sent"|"queued"|"skipped"|"failed", "message_id": str, "instance_name": str, "reason": str}
```

- `kind` ∈ `KINDS = {chat, drip, greeting, campaign, broadcast, dispatch, intro, demo, form, fms, portal, certificate,
  scheduled, digest, alert, system}` (spec list + `demo, portal, certificate, scheduled, alert` for the W1 callers;
  an unknown kind raises `ValueError`). Policy classes: `MANUAL_KINDS={chat}`, `INTERNAL_KINDS={digest, alert}` (staff
  recipients), `MARKETING_KINDS={drip, greeting, campaign, broadcast}` (per-number caps + one-per-contact-per-day), of which only
  `CONSENT_KINDS={drip, greeting}` are consent-gated — RULING 2026-09-24: consent gates AUTOMATIONS; a human-triggered
  bulk send (campaign, broadcast) respects opt-out only, and its preview reports how many recipients lack consent.
  Everything else transactional.
- `channel`: `"auto"`/`"rep"` (owner → company), `"company"`, `"official"` (→ `skipped official_channel_not_configured`,
  D11), or an explicit `instance_name` (W2 chat replies; no silent reroute: `skipped sender_not_connected`).
- `media`: `{type: image|video|document|audio, url, mime?, filename?, size?, caption?}`; a `whatsapp_attachments` doc
  (`attachment_type`, `content_type`, `size_bytes`) is accepted as-is.
- `ref`: free dict stored on the row; `ref["dedup_key"]` becomes the engagement event's `dedup_key` (default `wa:<message_id>`).
- `def to_e164(phone) -> str` (`""` = not a WhatsApp-able number), `def jid_for(e164) -> str`.
- `async def resolve_owner(db, *, lead_id="", contact_id="", school_id="") -> str | None` (lead → contact → school, D2).
- `async def resolve_sender(db, *, owner_email=None, channel="auto") -> tuple[dict | None, str]`.
- `async def consent_ok(db, *, lead_id="", contact_id="", school_id="") -> bool`;
  `async def is_opted_out(db, *, e164, contact_id="", school_id="") -> bool`.
- `async def admin_emails(db) -> list[str]`; `async def alert(db, *, emails, title, body, dedup_key, ref_id="")`
  (bell via `notify.notify_user`, push via `_push` only when the bell entry is new).
- `async def wa_available(db) -> bool` (a connected number exists, or the AutoSender fallback is ready) — Task 9's `_wa_cfg` shim.
- Test seams: `_now()`, `_sleep(s)`, `_jitter(lo, hi)`, `_push(email, title, body)`, `_send_via_autosender(db, e164, text, file_url)`.
- Row lifecycle helpers `_finish(db, row, status, reason)`, `_finish_queued(db, row, reason, send_after)`,
  `_route_and_send(db, row, cfg, *, from_queue)` (Task 5 extends; W2 reuses).

**Produces** (tests): `wa_fixtures.wire_wa(monkeypatch, db, fake_evolution, *, now=T_1100_IST)`, `seed_user`,
`seed_instance`, `seed_wa(db, *, company="connected", reps=None, settings=None)`, constants `T_1100_IST`, `FAST`, `COMPANY`;
conftest fixture `wa_env` → `SimpleNamespace(db, evo, clock, pushes)`.

**Consumes:** `get_wa_settings` (Task 3), `EvolutionClient` per-instance methods + `provider_message_id` (Task 2),
`services.engagement.log_engagement_event` (`engagement.py:213-255`), `notify.notify_user` (`notify.py:29`),
`routes.push_routes.send_push_to_user` (`push_routes.py:55`), `rbac.SUPERADMIN_EMAIL` (`rbac.py:18`).

### Steps

**1. Shared test wiring** — create `backend/tests/wa_fixtures.py`:

```python
"""Shared WhatsApp test wiring — not a test module (no test_ prefix). `from wa_fixtures import …`."""
from datetime import datetime, timezone
from types import SimpleNamespace

T_1100_IST = datetime(2026, 9, 24, 5, 30, tzinfo=timezone.utc)   # Thu 24 Sep 2026, 11:00 IST
FAST = {"gap_min_s": 0, "gap_max_s": 0}
COMPANY = "smartshape"
OLD = "2026-01-01T00:00:00+00:00"                                 # a number well past warm-up


def wire_wa(monkeypatch, db, fake_evolution, *, now=T_1100_IST):
    """Point every module the WhatsApp service writes through at `db`, freeze the clock, and
    record sleeps and pushes. The Evolution server is `fake_evolution` (conftest)."""
    import notify
    import services.engagement as engagement
    import services.wa_send as ws
    monkeypatch.setattr(notify, "db", db)
    monkeypatch.setattr(engagement, "db", db)
    clock = {"now": now, "slept": []}
    monkeypatch.setattr(ws, "_now", lambda: clock["now"])

    async def _sleep(s):
        clock["slept"].append(s)
    monkeypatch.setattr(ws, "_sleep", _sleep)
    pushes = []

    async def _push(email, title, body):
        pushes.append({"email": email, "title": title, "body": body})
    monkeypatch.setattr(ws, "_push", _push)
    return SimpleNamespace(db=db, evo=fake_evolution, clock=clock, pushes=pushes)


async def seed_user(db, email, *, role="sales", user_id=None, phone="", **extra):
    doc = {"email": email, "name": email.split("@")[0].title(), "role": role,
           "user_id": user_id or f"user_{email.split('@')[0].replace('.', '')}", "phone": phone,
           "is_active": True, **extra}
    await db.users.insert_one(dict(doc))
    return doc


async def seed_instance(db, name, *, kind="rep", owner_email="", state="connected", phone="",
                        warmup_started_at=OLD, **extra):
    doc = {"instance_name": name, "kind": kind, "owner_email": owner_email, "label": name, "state": state,
           "phone_e164": phone, "jid": f"{phone}@s.whatsapp.net" if phone else "",
           "instance_token": f"tok_{name}", "warmup_started_at": warmup_started_at,
           "daily_cap_override": None, "consecutive_failures": 0, "paused_reason": "", "proxy": {},
           "created_at": OLD, **extra}
    await db.wa_instances.insert_one(dict(doc))
    if kind == "rep" and owner_email:
        await db.users.update_one({"email": owner_email}, {"$set": {"wa_instance_name": name}}, upsert=True)
    return doc


async def seed_wa(db, *, company="connected", reps=None, settings=None):
    """company: the company number's state, or None for no company row.
    reps: {email: state}; each rep gets a number rep_<local-part>. settings: overrides (FAST by default)."""
    await db.settings.update_one({"type": "wa"}, {"$set": {"type": "wa", **FAST, **(settings or {})}}, upsert=True)
    if company:
        await seed_instance(db, COMPANY, kind="company", state=company, phone="919000000001")
    for i, (email, state) in enumerate((reps or {}).items()):
        await seed_instance(db, f"rep_{email.split('@')[0].replace('.', '')}", owner_email=email,
                            state=state, phone=f"9190000001{i:02d}")
```

Append to `backend/tests/conftest.py`:

```python
@pytest.fixture()
def wa_env(monkeypatch, fake_evolution):
    """A fresh mongomock db wired into the WhatsApp service, the clock at 11:00 IST on
    Thu 24 Sep 2026, and recorders for Evolution, sleeps and pushes."""
    from mongomock_motor import AsyncMongoMockClient
    from wa_fixtures import wire_wa
    return wire_wa(monkeypatch, AsyncMongoMockClient()["smartshape_test"], fake_evolution)
```

**2. Failing test** — `backend/tests/test_wa_send.py`:

```python
"""send_whatsapp: the one door (D3). Sender resolution (D2), opt-out and consent (D10), the
number check, and exactly one wa_messages row per call.

Run:
    DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 \
    python -m pytest tests/test_wa_send.py -q
"""
import asyncio
import os
from datetime import timedelta

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest

import services.wa_send as ws
from services.wa_send import send_whatsapp, to_e164
from wa_fixtures import COMPANY, seed_instance, seed_wa

PARUL = "parul@smartshape.in"
KALPANA = "kalpana@smartshape.in"


def _run(coro):
    return asyncio.run(coro)


async def _contact(db, cid="c1", *, assigned_to="", school_id="s1", phone="9811111111", **extra):
    await db.contacts.insert_one({"contact_id": cid, "name": "Ritu", "phone": phone, "school_id": school_id,
                                  "assigned_to": assigned_to, "is_deleted": False, **extra})


async def _school(db, sid="s1", *, assigned_to="", wa_consent=False, **extra):
    await db.schools.insert_one({"school_id": sid, "school_name": "DPS", "assigned_to": assigned_to,
                                 "wa_consent": wa_consent, "is_deleted": False, **extra})


async def _row(db, message_id):
    return await db.wa_messages.find_one({"message_id": message_id}, {"_id": 0})


# ── D2: who sends ────────────────────────────────────────────────────────────

def test_owner_with_connected_number_sends_from_it(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db, reps={PARUL: "connected"})
        res = await send_whatsapp(db, to="9811111111", text="Hi", kind="dispatch", owner_email=PARUL)
        assert res["status"] == "sent" and res["instance_name"] == "rep_parul"
        assert wa_env.evo.sends[-1]["instance"] == "rep_parul"
        assert wa_env.evo.sends[-1]["token"] == "tok_rep_parul"
        row = await _row(db, res["message_id"])
        assert row["sent_via_owner_email"] == PARUL and row["used_company_fallback"] is False
    _run(go())


def test_owner_disconnected_falls_back_to_company_and_says_so(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db, reps={PARUL: "disconnected"})
        res = await send_whatsapp(db, to="9811111111", text="Hi", kind="dispatch", owner_email=PARUL)
        assert res["status"] == "sent" and res["instance_name"] == COMPANY
        row = await _row(db, res["message_id"])
        assert row["used_company_fallback"] is True and row["owner_email"] == PARUL
    _run(go())


def test_paused_owner_number_is_not_used(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db, reps={PARUL: "paused"})
        res = await send_whatsapp(db, to="9811111111", text="Hi", kind="dispatch", owner_email=PARUL)
        assert res["instance_name"] == COMPANY
    _run(go())


def test_no_owner_anywhere_uses_company(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db, reps={PARUL: "connected"})
        await _school(db)
        await _contact(db)
        res = await send_whatsapp(db, to="9811111111", text="Hi", kind="dispatch", contact_id="c1", school_id="s1")
        assert res["instance_name"] == COMPANY
    _run(go())


def test_owner_is_resolved_contact_first_then_school(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db, reps={PARUL: "connected", KALPANA: "connected"})
        await _school(db, assigned_to=KALPANA)
        await _contact(db, assigned_to="")                       # unowned contact at Kalpana's school
        await _contact(db, "c2", assigned_to=PARUL, phone="9822222222")
        r1 = await send_whatsapp(db, to="9811111111", text="Hi", kind="dispatch", contact_id="c1")
        r2 = await send_whatsapp(db, to="9822222222", text="Hi", kind="dispatch", contact_id="c2")
        assert r1["instance_name"] == "rep_kalpana" and r2["instance_name"] == "rep_parul"
    _run(go())


def test_channel_company_ignores_the_owner(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db, reps={PARUL: "connected"})
        res = await send_whatsapp(db, to="9811111111", text="x", kind="alert", owner_email=PARUL, channel="company")
        assert res["instance_name"] == COMPANY
    _run(go())


def test_explicit_instance_channel_is_never_silently_rerouted(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db, reps={PARUL: "disconnected"})
        res = await send_whatsapp(db, to="9811111111", text="x", kind="chat", channel="rep_parul")
        assert res["status"] == "skipped" and res["reason"] == "sender_not_connected"
        assert wa_env.evo.sends == []
    _run(go())


def test_official_channel_is_skipped_until_built(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db)
        res = await send_whatsapp(db, to="9811111111", text="x", kind="campaign", channel="official")
        assert res == {**res, "status": "skipped", "reason": "official_channel_not_configured"}
    _run(go())


def test_company_down_and_no_owner_number_is_skipped_no_sender_not_failed(wa_env):   # RF3
    db = wa_env.db

    async def go():
        await seed_wa(db, company="disconnected")
        res = await send_whatsapp(db, to="9811111111", text="x", kind="dispatch")
        assert res["status"] == "skipped" and res["reason"] == "no_sender"
        row = await _row(db, res["message_id"])
        assert row["status"] == "skipped" and row["instance_name"] == ""
        assert await db.wa_instances.count_documents({"state": "paused"}) == 0   # a skip never pauses
    _run(go())


# ── RF4: one person, one key ─────────────────────────────────────────────────

@pytest.mark.parametrize("raw", ["+91 98111 11111", "9811111111", "098111 11111", "919811111111",
                                 "0091-98111-11111", "+91-98111-11111", " 98111-11111 "])
def test_phone_forms_normalise_to_one_e164(raw):
    assert to_e164(raw) == "919811111111"


@pytest.mark.parametrize("raw", ["011 2345 6789", "12345", "", None, "0000000000", "+91 1234567890"])
def test_non_mobile_numbers_normalise_to_empty(raw):
    assert to_e164(raw) == ""


def test_an_explicit_foreign_number_is_kept():
    assert to_e164("+1 415 555 0100") == "14155550100"


def test_a_landline_is_skipped_bad_phone_with_a_row(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db)
        res = await send_whatsapp(db, to="011 2345 6789", text="x", kind="dispatch")
        assert res["status"] == "skipped" and res["reason"] == "bad_phone"
        assert (await _row(db, res["message_id"]))["to_raw"] == "011 2345 6789"
        assert wa_env.evo.calls == []
    _run(go())


def test_empty_message_is_skipped(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db)
        res = await send_whatsapp(db, to="9811111111", text="  ", kind="dispatch")
        assert res["reason"] == "empty_message"
    _run(go())


def test_unknown_kind_is_a_programming_error(wa_env):
    with pytest.raises(ValueError):
        _run(send_whatsapp(wa_env.db, to="9811111111", text="x", kind="newsletter"))


# ── D10: opt-out and consent ─────────────────────────────────────────────────

def test_opted_out_contact_is_skipped_for_automations_but_a_manual_chat_goes(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db)
        await _contact(db, wa_opt_out=True)
        a = await send_whatsapp(db, to="9811111111", text="x", kind="dispatch", contact_id="c1")
        b = await send_whatsapp(db, to="9811111111", text="x", kind="chat", contact_id="c1", typed_by=PARUL)
        assert (a["status"], a["reason"]) == ("skipped", "opt_out")
        assert b["status"] == "sent"
    _run(go())


def test_opted_out_school_blocks_its_contacts(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db)
        await _school(db, wa_opt_out=True)
        res = await send_whatsapp(db, to="9811111111", text="x", kind="dispatch", school_id="s1")
        assert res["reason"] == "opt_out"
    _run(go())


def test_an_opt_out_recorded_against_the_number_blocks_without_a_record(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db)
        await db.wa_opt_outs.insert_one({"phone_e164": "919811111111", "active": True})
        res = await send_whatsapp(db, to="+91 98111 11111", text="x", kind="intro")
        assert res["reason"] == "opt_out"
    _run(go())


def test_marketing_needs_consent_transactional_does_not(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db)
        await _school(db, wa_consent=False)
        await _contact(db)
        drip = await send_whatsapp(db, to="9811111111", text="x", kind="drip", contact_id="c1")
        disp = await send_whatsapp(db, to="9811111111", text="x", kind="dispatch", contact_id="c1")
        assert (drip["status"], drip["reason"]) == ("skipped", "no_consent")
        assert disp["status"] == "sent"
    _run(go())


def test_school_consent_or_lead_consent_lets_marketing_through(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db)
        await _school(db, wa_consent=True)
        await _contact(db)
        await db.leads.insert_one({"lead_id": "L1", "school_id": "s9", "wa_consent": True, "is_deleted": False})
        a = await send_whatsapp(db, to="9811111111", text="x", kind="drip", contact_id="c1")
        b = await send_whatsapp(db, to="9822222222", text="x", kind="drip", lead_id="L1")
        assert a["status"] == "sent" and b["status"] == "sent"
    _run(go())


def test_consent_setting_off_lets_marketing_through(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db)
        await db.settings.insert_one({"type": "notifications", "require_wa_consent": False})
        res = await send_whatsapp(db, to="9811111111", text="x", kind="campaign")
        assert res["status"] == "sent"
    _run(go())


def test_enforce_consent_false_is_honoured(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db)
        res = await send_whatsapp(db, to="9811111111", text="x", kind="greeting", enforce_consent=False)
        assert res["status"] == "sent"
    _run(go())


# ── number-exists check ──────────────────────────────────────────────────────

def test_not_on_whatsapp_is_skipped_and_cached_on_the_contact(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db)
        await _contact(db)
        wa_env.evo.not_on_whatsapp.add("919811111111")
        res = await send_whatsapp(db, to="9811111111", text="x", kind="dispatch", contact_id="c1")
        assert (res["status"], res["reason"]) == ("skipped", "not_on_whatsapp")
        c = await db.contacts.find_one({"contact_id": "c1"}, {"_id": 0})
        assert c["wa_number_exists"] is False and c["wa_number_checked_at"]
        assert wa_env.evo.sends == []
    _run(go())


def test_number_check_is_cached_for_30_days_then_rechecked(wa_env):
    db = wa_env.db

    def checks():
        return sum(1 for c in wa_env.evo.calls if c["path"].startswith("/chat/whatsappNumbers/"))

    async def go():
        await seed_wa(db)
        await send_whatsapp(db, to="9811111111", text="a", kind="dispatch")
        wa_env.clock["now"] += timedelta(days=29)
        await send_whatsapp(db, to="9811111111", text="b", kind="dispatch")
        assert checks() == 1
        wa_env.clock["now"] += timedelta(days=2)
        await send_whatsapp(db, to="9811111111", text="c", kind="dispatch")
        assert checks() == 2
    _run(go())


def test_a_manual_chat_skips_the_number_check(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db)
        await send_whatsapp(db, to="9811111111", text="a", kind="chat", typed_by=PARUL)
        assert not any(c["path"].startswith("/chat/whatsappNumbers/") for c in wa_env.evo.calls)
    _run(go())


def test_a_failed_number_check_does_not_block_the_send(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db)
        wa_env.evo.check_raises = True
        res = await send_whatsapp(db, to="9811111111", text="a", kind="dispatch")
        assert res["status"] == "sent"
        assert await db.wa_number_cache.count_documents({}) == 0
    _run(go())


# ── the row and the event ────────────────────────────────────────────────────

def test_sent_row_and_one_engagement_event(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db, reps={PARUL: "connected"})
        await _school(db, assigned_to=PARUL)
        await _contact(db, assigned_to=PARUL)
        res = await send_whatsapp(db, to="9811111111", text="Your kit shipped", kind="dispatch",
                                  contact_id="c1", school_id="s1", ref={"dispatch_id": "d1", "dedup_key": "disp:d1"})
        row = await _row(db, res["message_id"])
        assert row["status"] == "sent" and row["provider"] == "evolution"
        assert row["provider_msg_id"] == "PMID1" and row["to_jid"] == "919811111111@s.whatsapp.net"
        assert row["chat_id"] == "rep_parul:919811111111@s.whatsapp.net"
        assert row["sent_day"] == "2026-09-24" and [h["status"] for h in row["status_history"]] == ["sent"]
        assert row["ref"] == {"dispatch_id": "d1", "dedup_key": "disp:d1"}
        evs = await db.engagement_events.find({}, {"_id": 0}).to_list(None)
        assert len(evs) == 1 and evs[0]["dedup_key"] == "disp:d1" and evs[0]["channel"] == "whatsapp"
        assert evs[0]["contact_id"] == "c1" and evs[0]["meta"]["instance_name"] == "rep_parul"
    _run(go())


def test_a_manager_reply_records_who_typed_it(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db, reps={PARUL: "connected"})
        res = await send_whatsapp(db, to="9811111111", text="x", kind="chat", channel="rep_parul",
                                  typed_by="info@smartshape.in")
        row = await _row(db, res["message_id"])
        assert row["typed_by"] == "info@smartshape.in" and row["sent_via_owner_email"] == PARUL
    _run(go())


def test_an_evolution_failure_is_failed_with_reason_and_no_event(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db)
        wa_env.evo.fail_sends = True
        res = await send_whatsapp(db, to="9811111111", text="x", kind="dispatch", contact_id="c1")
        assert res["status"] == "failed" and "rejected" in res["reason"]
        assert (await _row(db, res["message_id"]))["fail_reason"]
        assert await db.engagement_events.count_documents({}) == 0
    _run(go())


def test_autosender_fallback_when_no_number_and_enabled(wa_env, monkeypatch):
    db = wa_env.db
    sent = []

    async def _fake_autosender(dbh, e164, text, file_url=None):
        sent.append((e164, text, file_url))
        return True
    monkeypatch.setattr(ws, "_send_via_autosender", _fake_autosender)

    async def go():
        await seed_wa(db, company=None, settings={"fallback_provider": "autosender"})
        await db.settings.insert_one({"type": "whatsapp", "username": "u", "password": "p"})
        res = await send_whatsapp(db, to="9811111111", text="x", kind="dispatch")
        assert res["status"] == "sent" and sent == [("919811111111", "x", None)]
        assert (await _row(db, res["message_id"]))["provider"] == "autosender"
    _run(go())


def test_autosender_is_not_used_when_the_setting_is_none(wa_env, monkeypatch):
    db = wa_env.db

    async def _boom(*a, **k):
        raise AssertionError("fallback used while fallback_provider is none")
    monkeypatch.setattr(ws, "_send_via_autosender", _boom)

    async def go():
        await seed_wa(db, company=None)
        await db.settings.insert_one({"type": "whatsapp", "username": "u", "password": "p"})
        res = await send_whatsapp(db, to="9811111111", text="x", kind="dispatch")
        assert res["reason"] == "no_sender"
    _run(go())


def test_media_goes_as_send_media_with_the_text_as_caption(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db)
        att = {"attachment_id": "att1", "url": "https://app.smartshape.in/uploads/whatsapp/a.jpg",
               "attachment_type": "image", "content_type": "image/jpeg", "filename": "a.jpg", "size_bytes": 10}
        res = await send_whatsapp(db, to="9811111111", text="Diwali wishes", media=att, kind="dispatch")
        s = wa_env.evo.sends[-1]
        assert res["status"] == "sent" and s["mediatype"] == "image" and s["text"] == "Diwali wishes"
        row = await _row(db, res["message_id"])
        assert row["media"]["type"] == "image" and row["media"]["filename"] == "a.jpg"
    _run(go())
```

**3. Run — expect failure** (`ModuleNotFoundError: services.wa_send`).

```bash
cd backend && DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 python -m pytest tests/test_wa_send.py -q
```

**4. Implement** — create `backend/services/wa_send.py`:

```python
"""The one door for WhatsApp (spec 2026-09-24, D3).

Every WhatsApp message the CRM sends goes through `send_whatsapp` and nowhere else. In order:
  1. normalise the number — one person is one key however the phone was typed (RF4);
  2. pick the sender (D2): the record owner's connected number, else the company number;
  3. policy (D5, D10): opt-out, consent, business hours, per-number caps. A refusal is
     `skipped`; a deferral is `queued` and the drainer in scheduler.py sends it later;
  4. number-exists check, cached 30 days;
  5. send through Evolution — or the AutoSender emergency fallback when configured;
  6. exactly one `wa_messages` row per call, whatever happened, plus an engagement event
     when it actually went.

`skipped` is a refusal, never a failure: callers must not retry or pause on it.
"""
import asyncio
import logging
import random
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from services import evolution_client as evo_mod
from services.wa_config import get_wa_settings

log = logging.getLogger("wa_send")
IST = timezone(timedelta(hours=5, minutes=30))

KINDS = frozenset({"chat", "drip", "greeting", "campaign", "broadcast", "dispatch", "intro", "demo", "form",
                   "fms", "portal", "certificate", "scheduled", "digest", "alert", "system"})
MANUAL_KINDS = frozenset({"chat"})                      # a person pressed send
INTERNAL_KINDS = frozenset({"digest", "alert"})         # to our own staff
MARKETING_KINDS = frozenset({"drip", "greeting", "campaign", "broadcast"})   # caps + 1/contact/day
CONSENT_KINDS = frozenset({"drip", "greeting"})   # D10: consent gates automations only (ruling 2026-09-24)
YOUNG_NUMBER_BLOCKED_KINDS = frozenset({"campaign", "broadcast"})           # Rollout 3 (Task 5)
AUTOSENDER_URL = "https://app.messageautosender.com/message/new"


# ── Test seams ────────────────────────────────────────────────────────────────

def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _sleep(seconds: float) -> None:
    await asyncio.sleep(seconds)


def _jitter(lo: float, hi: float) -> float:
    return random.uniform(lo, hi) if hi > lo else float(lo)


def _client() -> evo_mod.EvolutionClient:
    return evo_mod.evolution


async def _push(email: str, title: str, body: str) -> None:
    try:
        from routes.push_routes import send_push_to_user   # lazy: routes import this module
        await send_push_to_user(email, title, body, url="/app-settings?tab=whatsapp", tag="whatsapp")
    except Exception as e:
        log.warning("[wa] push to %s failed: %s", email, str(e)[:120])


# ── Small helpers ─────────────────────────────────────────────────────────────

def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def _parse(s) -> datetime:
    d = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def ist_day(dt: datetime) -> str:
    return dt.astimezone(IST).strftime("%Y-%m-%d")


def ist_hour(dt: datetime) -> str:
    return dt.astimezone(IST).strftime("%H")


def to_e164(phone) -> str:
    """'+91 98111 11111', '98111-11111', '098111 11111', '919811111111', '0091…' -> '919811111111'.
    An explicit foreign '+<cc>…' number is kept. Anything else (a landline, a short or junk
    number) returns '' — it can never be a WhatsApp chat."""
    raw = str(phone or "").strip()
    digits = re.sub(r"\D", "", raw)
    if digits.startswith("00"):
        digits = digits[2:]
    elif digits.startswith("0") and len(digits) == 11:
        digits = digits[1:]
    if len(digits) == 10:
        return "91" + digits if digits[0] in "6789" else ""
    if len(digits) == 12 and digits.startswith("91"):
        return digits if digits[2] in "6789" else ""
    if raw.startswith("+") and not digits.startswith("91") and 8 <= len(digits) <= 15:
        return digits
    return ""


def jid_for(e164: str) -> str:
    return f"{e164}@s.whatsapp.net" if e164 else ""


def _clean_media(media: Optional[dict]) -> Optional[dict]:
    if not media or not media.get("url"):
        return None
    t = media.get("type") or media.get("attachment_type") or "document"
    if t not in ("image", "video", "document", "audio"):
        t = "document"
    return {"type": t, "url": media["url"],
            "mime": media.get("mime") or media.get("content_type") or "",
            "filename": media.get("filename") or "",
            "size": media.get("size") or media.get("size_bytes"),
            "caption": media.get("caption") or ""}


# ── D2: owner and sender ──────────────────────────────────────────────────────

async def resolve_owner(db, *, lead_id: str = "", contact_id: str = "", school_id: str = "") -> Optional[str]:
    """The record's owner: the lead's, else the contact's, else the school's."""
    if lead_id:
        lead = await db.leads.find_one({"lead_id": lead_id}, {"_id": 0, "assigned_to": 1, "school_id": 1}) or {}
        if lead.get("assigned_to"):
            return lead["assigned_to"]
        school_id = school_id or lead.get("school_id") or ""
    if contact_id:
        c = await db.contacts.find_one({"contact_id": contact_id}, {"_id": 0, "assigned_to": 1, "school_id": 1}) or {}
        if c.get("assigned_to"):
            return c["assigned_to"]
        school_id = school_id or c.get("school_id") or ""
    if school_id:
        s = await db.schools.find_one({"school_id": school_id}, {"_id": 0, "assigned_to": 1}) or {}
        return s.get("assigned_to") or None
    return None


async def resolve_sender(db, *, owner_email: Optional[str] = None, channel: str = "auto"):
    """-> (instance doc, "") or (None, reason). Only a `connected` number sends."""
    if channel == "official":
        return None, "official_channel_not_configured"
    if channel not in ("auto", "rep", "company"):           # an explicit instance (W2 chat reply)
        inst = await db.wa_instances.find_one({"instance_name": channel}, {"_id": 0})
        if inst and inst.get("state") == "connected":
            return inst, ""
        return None, "sender_not_connected"
    if channel != "company" and owner_email:
        u = await db.users.find_one({"email": owner_email}, {"_id": 0, "wa_instance_name": 1}) or {}
        if u.get("wa_instance_name"):
            inst = await db.wa_instances.find_one(
                {"instance_name": u["wa_instance_name"], "state": "connected"}, {"_id": 0})
            if inst:
                return inst, ""
    comp = await db.wa_instances.find_one({"kind": "company", "state": "connected"}, {"_id": 0})
    if comp:
        return comp, ""
    return None, "no_sender"


def _stamp_sender(row: dict, inst: dict) -> None:
    row["instance_name"] = inst["instance_name"]
    row["from_jid"] = inst.get("jid") or ""
    row["sent_via_owner_email"] = inst.get("owner_email") or ""
    row["sender_kind"] = inst.get("kind") or ""
    row["chat_id"] = f"{inst['instance_name']}:{row['to_jid']}"
    # D2: "the log says so" when the owner's own number could not be used.
    row["used_company_fallback"] = (inst.get("kind") == "company" and bool(row["owner_email"])
                                    and row["channel"] in ("auto", "rep"))


# ── D10: consent and opt-out ──────────────────────────────────────────────────

async def consent_ok(db, *, lead_id: str = "", contact_id: str = "", school_id: str = "") -> bool:
    """May we send a MARKETING WhatsApp here? Lead, else contact, else school consent; the rule
    itself is `notifications.require_wa_consent` (default ON — the safe side of a ban)."""
    cfg = await db.settings.find_one({"type": "notifications"}, {"_id": 0}) or {}
    if not cfg.get("require_wa_consent", True):
        return True
    if lead_id:
        lead = await db.leads.find_one({"lead_id": lead_id}, {"_id": 0, "wa_consent": 1, "school_id": 1}) or {}
        if lead.get("wa_consent"):
            return True
        school_id = school_id or lead.get("school_id") or ""
    if contact_id:
        c = await db.contacts.find_one({"contact_id": contact_id}, {"_id": 0, "wa_consent": 1, "school_id": 1}) or {}
        if c.get("wa_consent"):
            return True
        school_id = school_id or c.get("school_id") or ""
    if school_id:
        s = await db.schools.find_one({"school_id": school_id}, {"_id": 0, "wa_consent": 1}) or {}
        if s.get("wa_consent"):
            return True
    return False


async def is_opted_out(db, *, e164: str, contact_id: str = "", school_id: str = "") -> bool:
    if contact_id:
        c = await db.contacts.find_one({"contact_id": contact_id}, {"_id": 0, "wa_opt_out": 1, "school_id": 1}) or {}
        if c.get("wa_opt_out"):
            return True
        school_id = school_id or c.get("school_id") or ""
    if school_id:
        s = await db.schools.find_one({"school_id": school_id}, {"_id": 0, "wa_opt_out": 1}) or {}
        if s.get("wa_opt_out"):
            return True
    if e164 and await db.wa_opt_outs.find_one({"phone_e164": e164, "active": True}, {"_id": 1}):
        return True
    return False


# ── Alerts ────────────────────────────────────────────────────────────────────

async def admin_emails(db) -> list:
    from rbac import SUPERADMIN_EMAIL
    out = [SUPERADMIN_EMAIL]
    async for u in db.users.find({"$or": [{"role": "admin"}, {"roles": "admin"}], "is_active": {"$ne": False}},
                                 {"_id": 0, "email": 1}):
        e = (u.get("email") or "").strip().lower()
        if e and e not in out:
            out.append(e)
    return out


async def alert(db, *, emails, title: str, body: str, dedup_key: str, ref_id: str = "") -> None:
    """Bell + push to each address once. The bell de-duplicates on (recipient, dedup_key) while
    unread; the push is sent only when the bell entry is new, so an hourly re-check does not buzz."""
    import notify
    seen = set()
    for e in emails or ():
        e = (e or "").strip().lower()
        if not e or e in seen:
            continue
        seen.add(e)
        existing = await db.notifications.find_one(
            {"assigned_to": e, "dedup_key": dedup_key, "is_read": False}, {"_id": 1})
        await notify.notify_user(e, type="whatsapp_alert", title=title, body=body, ref_type="wa_instance",
                                 ref_id=ref_id, from_name="WhatsApp", dedup_key=dedup_key)
        if not existing:
            await _push(e, title, body)


# ── AutoSender emergency fallback (D3) ────────────────────────────────────────

async def _autosender_ready(db) -> bool:
    wa = await db.settings.find_one({"type": "whatsapp"}, {"_id": 0}) or {}
    return bool(wa.get("username") and wa.get("password"))


async def _send_via_autosender(db, e164: str, text: str, file_url: Optional[str] = None) -> bool:
    """The one remaining MessageAutoSender call (was six copies). True when accepted."""
    import httpx
    wa = await db.settings.find_one({"type": "whatsapp"}, {"_id": 0}) or {}
    data = {"username": wa.get("username", ""), "password": wa.get("password", ""),
            "receiverMobileNo": e164[2:] if e164.startswith("91") and len(e164) == 12 else e164,
            "message": text}
    if file_url:
        data["filePathUrl"] = file_url
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(AUTOSENDER_URL, data=data)
    return 200 <= resp.status_code < 300


async def _try_autosender(db, row: dict) -> bool:
    if not await _autosender_ready(db):
        return False
    try:
        return await _send_via_autosender(db, row["to_e164"], row["text"], (row.get("media") or {}).get("url"))
    except Exception as e:
        log.warning("[wa] autosender fallback failed: %s", str(e)[:160])
        return False


async def wa_available(db) -> bool:
    """Is there any way to send right now? (Used by the digest/report producers.)"""
    if await db.wa_instances.find_one({"state": "connected"}, {"_id": 1}):
        return True
    cfg = await get_wa_settings(db)
    return cfg["fallback_provider"] == "autosender" and await _autosender_ready(db)


# ── Policy (Task 5 extends with hours and caps) ───────────────────────────────

async def _policy(db, row: dict, inst: Optional[dict], cfg: dict, *, from_queue: bool = False):
    """-> ("send", "", None) | ("skip", reason, None) | ("queue", reason, send_after)."""
    kind = row["kind"]
    if kind not in MANUAL_KINDS and kind not in INTERNAL_KINDS:
        if await is_opted_out(db, e164=row["to_e164"], contact_id=row["contact_id"], school_id=row["school_id"]):
            return "skip", "opt_out", None
        if kind in CONSENT_KINDS and row["enforce_consent"]:
            if not await consent_ok(db, lead_id=row["lead_id"], contact_id=row["contact_id"],
                                    school_id=row["school_id"]):
                return "skip", "no_consent", None
    return "send", "", None


# ── Number-exists check ───────────────────────────────────────────────────────

async def _number_exists(db, inst: dict, e164: str, contact_id: str, cfg: dict) -> Optional[bool]:
    """True/False from cache or Evolution; None when the check itself failed (does not block)."""
    now = _now()
    cached = await db.wa_number_cache.find_one({"phone_e164": e164}, {"_id": 0})
    if cached and _parse(cached["checked_at"]) > now - timedelta(days=int(cfg["number_check_ttl_days"])):
        return bool(cached["exists"])
    try:
        res = await _client().check_numbers([e164], instance=inst["instance_name"],
                                             token=inst.get("instance_token") or None)
    except Exception as e:
        log.warning("[wa] number check failed on %s: %s", inst["instance_name"], str(e)[:120])
        return None
    exists = bool(res.get(e164))
    await db.wa_number_cache.update_one(
        {"phone_e164": e164}, {"$set": {"phone_e164": e164, "exists": exists, "checked_at": _iso(now)}}, upsert=True)
    if contact_id:
        await db.contacts.update_one({"contact_id": contact_id}, {"$set": {
            "wa_number_exists": exists, "wa_number_checked_at": _iso(now)}})
    return exists


# ── Delivery ──────────────────────────────────────────────────────────────────

async def _evolution_send(inst: dict, row: dict) -> dict:
    c, name, tok = _client(), inst["instance_name"], inst.get("instance_token") or None
    media = row.get("media")
    if media and media.get("url"):
        return await c.send_media(row["to_e164"], media["url"], mediatype=media["type"],
                                  caption=(row.get("text") or media.get("caption") or "")[:1000],
                                  filename=media.get("filename") or "", mimetype=media.get("mime") or "",
                                  instance=name, token=tok)
    return await c.send_text(row["to_e164"], row["text"], instance=name, token=tok)


async def _record_success(db, inst: dict) -> None:
    await db.wa_instances.update_one({"instance_name": inst["instance_name"]}, {"$set": {
        "consecutive_failures": 0, "last_sent_at": _iso(_now()), "last_error": ""}})


async def _record_failure(db, inst: dict, err: str, cfg: dict) -> None:
    await db.wa_instances.update_one({"instance_name": inst["instance_name"]}, {
        "$inc": {"consecutive_failures": 1}, "$set": {"last_error": err, "last_error_at": _iso(_now())}})


async def _log_event(row: dict) -> None:
    if not (row.get("contact_id") or row.get("lead_id") or row.get("school_id")):
        return
    from services.engagement import log_engagement_event
    try:
        await log_engagement_event(
            channel="whatsapp", kind=f"WhatsApp · {row['kind']}",
            title=(row.get("text") or (row.get("media") or {}).get("filename") or "WhatsApp")[:100],
            school_id=row.get("school_id") or "", lead_id=row.get("lead_id") or "",
            contact_id=row.get("contact_id") or "", status="sent", direction="out",
            by=row.get("typed_by") or row.get("sent_via_owner_email") or "Company WhatsApp",
            at=row["sent_at"],
            meta={"message_id": row["message_id"], "instance_name": row.get("instance_name") or "",
                  "kind": row["kind"], "ref": row.get("ref") or {}},
            dedup_key=(row.get("ref") or {}).get("dedup_key") or f"wa:{row['message_id']}")
    except Exception as e:
        log.error("[wa] engagement event failed for %s: %s", row["message_id"], str(e)[:160])


async def _finish(db, row: dict, status: str, reason: str) -> dict:
    now = _now()
    row["status"] = status
    row["fail_reason"] = reason if status in ("failed", "skipped") else ""
    row.setdefault("status_history", []).append({"status": status, "at": _iso(now), "reason": reason})
    row["send_after"] = None
    if status == "sent":
        row["sent_at"] = _iso(now)
        row["sent_day"] = ist_day(now)
    if row.get("provider_msg_id"):
        # A SEND_MESSAGE webhook can beat us here and store a bare "phone" row under the same
        # provider id (Task 6). Ours is the full record: drop the placeholder, keep one row (D9).
        await db.wa_messages.delete_one({"instance_name": row["instance_name"],
                                         "provider_msg_id": row["provider_msg_id"], "source": "phone"})
    await db.wa_messages.update_one({"message_id": row["message_id"]}, {"$set": row}, upsert=True)
    if status == "sent":
        await _log_event(row)
    return {"status": status, "message_id": row["message_id"],
            "instance_name": row.get("instance_name") or "", "reason": reason}


async def _finish_queued(db, row: dict, reason: str, send_after: datetime) -> dict:
    row["status"] = "queued"
    row["send_after"] = _iso(send_after)
    row["queue_reason"] = reason
    row.setdefault("status_history", []).append({"status": "queued", "at": _iso(_now()), "reason": reason})
    await db.wa_messages.update_one({"message_id": row["message_id"]}, {"$set": row}, upsert=True)
    return {"status": "queued", "message_id": row["message_id"],
            "instance_name": row.get("instance_name") or "", "reason": reason}


async def _deliver(db, row: dict, inst: Optional[dict], cfg: dict) -> dict:
    kind = row["kind"]
    if inst is None:                     # only reached for the AutoSender fallback
        if await _try_autosender(db, row):
            row["provider"] = "autosender"
            return await _finish(db, row, "sent", "")
        return await _finish(db, row, "failed", "autosender_failed")
    if kind not in MANUAL_KINDS and kind not in INTERNAL_KINDS:
        if await _number_exists(db, inst, row["to_e164"], row["contact_id"], cfg) is False:
            return await _finish(db, row, "skipped", "not_on_whatsapp")
    try:
        resp = await _evolution_send(inst, row)
    except Exception as e:
        err = str(e)[:200]
        await _record_failure(db, inst, err, cfg)
        if cfg["fallback_provider"] == "autosender" and await _try_autosender(db, row):
            row["provider"] = "autosender"
            row.setdefault("status_history", []).append(
                {"status": "failed", "at": _iso(_now()), "reason": f"evolution: {err}"})
            return await _finish(db, row, "sent", "")
        return await _finish(db, row, "failed", err)
    row["provider"] = "evolution"
    row["provider_msg_id"] = evo_mod.provider_message_id(resp) or None
    await _record_success(db, inst)
    return await _finish(db, row, "sent", "")


async def _route_and_send(db, row: dict, cfg: dict, *, from_queue: bool) -> dict:
    inst, why = await resolve_sender(db, owner_email=row["owner_email"] or None, channel=row["channel"])
    if inst is None:
        if not (why == "no_sender" and cfg["fallback_provider"] == "autosender" and await _autosender_ready(db)):
            return await _finish(db, row, "skipped", why)
        row["instance_name"] = ""
    else:
        _stamp_sender(row, inst)
    decision, reason, after = await _policy(db, row, inst, cfg, from_queue=from_queue)
    if decision == "skip":
        return await _finish(db, row, "skipped", reason)
    if decision == "queue":
        return await _finish_queued(db, row, reason, after)
    return await _deliver(db, row, inst, cfg)


async def send_whatsapp(db, *, to: str, text: str = "", media: Optional[dict] = None, kind: str,
                        ref: Optional[dict] = None, owner_email: Optional[str] = None, contact_id: str = "",
                        lead_id: str = "", school_id: str = "", typed_by: Optional[str] = None,
                        channel: str = "auto", enforce_consent: bool = True) -> dict:
    if kind not in KINDS:
        raise ValueError(f"unknown WhatsApp kind: {kind!r}")
    cfg = await get_wa_settings(db)
    e164 = to_e164(to)
    contact_id, lead_id, school_id = contact_id or "", lead_id or "", school_id or ""
    if owner_email is None and channel in ("auto", "rep"):
        owner_email = await resolve_owner(db, lead_id=lead_id, contact_id=contact_id, school_id=school_id)
    row = {
        "message_id": f"wam_{uuid.uuid4().hex[:16]}", "instance_name": "", "provider_msg_id": None,
        "chat_id": "", "direction": "out", "from_jid": "", "to_jid": jid_for(e164), "to_e164": e164,
        "to_raw": str(to or "")[:40], "contact_id": contact_id, "lead_id": lead_id, "school_id": school_id,
        "kind": kind, "ref": dict(ref or {}), "text": (text or "").strip(), "media": _clean_media(media),
        "quoted_provider_msg_id": None, "typed_by": typed_by, "owner_email": owner_email or "",
        "channel": channel, "enforce_consent": bool(enforce_consent), "sent_via_owner_email": "",
        "sender_kind": "", "used_company_fallback": False, "provider": "", "status": "queued",
        "status_history": [], "fail_reason": "", "send_after": None, "source": "app",
        "created_at": _iso(_now()), "provider_ts": None,
    }
    if not e164:
        return await _finish(db, row, "skipped", "bad_phone")
    if not (row["text"] or row["media"]):
        return await _finish(db, row, "skipped", "empty_message")
    return await _route_and_send(db, row, cfg, from_queue=False)
```

Note the "+91 1234567890" case in the test: `to_e164` sees 12 digits starting `91` with a non-mobile third digit → `""`.
`"0000000000"` → 10 digits starting `0` → `""`.

**5. Run — expect pass.**

```bash
cd backend && DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 python -m pytest tests/test_wa_send.py tests/test_evolution_client.py tests/test_no_send_guard.py -q
```

**6. Commit**

```bash
git add backend/services/wa_send.py
git add -f backend/tests/conftest.py backend/tests/wa_fixtures.py backend/tests/test_wa_send.py
git commit -m "feat(wa): send_whatsapp - owner-routed sender, opt-out and consent in the service, number check, one row per message

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 5 — Caps and ledger, business hours → queued, the per-instance drainer, auto-pause + alert

### Files

| Action | Path | Current refs |
|---|---|---|
| modify | `backend/services/wa_send.py` | from Task 4: replace `_policy`, `_record_success`, `_record_failure`, `_route_and_send`; add the rest |
| modify | `backend/scheduler.py` | loops block `:815-866`; `start_scheduler()` `:2025-2036` |
| create | `backend/tests/test_wa_send_caps.py` | new |

Claim pattern copied from the drip executor: `_DRIP_LOCK` / `_claim_enrollment` (`scheduler.py:423-469`).

### Interfaces

**Produces** (`services/wa_send.py`)
- `def warmup_day(inst, now) -> int` (1-based; day 1 = the IST date the number first connected).
- `def daily_cap(inst, cfg, now) -> int` — `daily_cap_override`, else `min(daily_cap, warmup_start_cap × 2^((day−1) // warmup_double_every_days))`.
- `def next_business_open(now, cfg) -> datetime | None` (None inside business hours; IST window, UTC result).
- `async def pause_instance(db, inst, *, reason, by="system")` (state `paused` + alert to the number's owner and every admin).
- `async def run_wa_queue_pass(db, *, budget_s=50.0) -> dict` → `{"instances": n, "processed": n}` or `{"skipped": "already_running"}`.
- ledger rows `wa_send_ledger{instance_name, day (IST), sent_count, hour_bucket{"HH": n}, last_sent_at}`.
- Queued-row transient status `"sending"` + `claimed_at` (reclaimed after 10 min) — internal to the drainer; never returned to callers.

**Produces** (`scheduler.py`)
- `async def wa_queue_loop()` (every 60 s) started from `start_scheduler()`.

**Policy table** (automations = every kind except `chat`):

| Check | chat | digest/alert | transactional | marketing |
|---|---|---|---|---|
| opt-out | – | – | skip | skip |
| consent (`enforce_consent`) | – | – | – | skip |
| business hours 09:00–19:00 IST | – | – | queue | queue |
| hourly cap (≤ 30) | queue | queue | queue | queue |
| daily cap / warm-up | – | queue | queue | queue |
| one per contact per number per day | – | – | – | queue |
| jittered gap 8–25 s | – | queue | queue | queue |
| number-exists | – | – | skip | skip |
| young number (< 14 days) | – | – | – | campaign/broadcast → company number |

### Steps

**1. Failing test** — `backend/tests/test_wa_send_caps.py`:

```python
"""D5 ban protection, per number: warm-up ramp, hourly and daily caps, one marketing message per
contact per day, the jittered gap, business hours (IST), the drainer, and auto-pause.

Run:
    DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 \
    python -m pytest tests/test_wa_send_caps.py -q
"""
import asyncio
import os
from datetime import datetime, timedelta, timezone

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest

import services.wa_send as ws
from services.wa_config import WA_DEFAULTS
from services.wa_send import send_whatsapp
from wa_fixtures import COMPANY, seed_instance, seed_wa

PARUL = "parul@smartshape.in"
UTC = timezone.utc


def _run(coro):
    return asyncio.run(coro)


def _at(y, mo, d, h, mi):          # a UTC instant
    return datetime(y, mo, d, h, mi, tzinfo=UTC)


@pytest.mark.parametrize("started_days_ago,cap", [(0, 20), (2, 20), (3, 40), (5, 40), (6, 80), (9, 160),
                                                  (12, 200), (40, 200)])
def test_warmup_ramp_doubles_every_three_days_to_200(started_days_ago, cap):
    now = _at(2026, 9, 24, 5, 30)
    inst = {"warmup_started_at": (now - timedelta(days=started_days_ago)).isoformat()}
    assert ws.daily_cap(inst, dict(WA_DEFAULTS), now) == cap
    assert ws.warmup_day(inst, now) == started_days_ago + 1


def test_daily_cap_override_wins():
    now = _at(2026, 9, 24, 5, 30)
    assert ws.daily_cap({"warmup_started_at": now.isoformat(), "daily_cap_override": 150}, dict(WA_DEFAULTS), now) == 150


def test_ledger_day_is_the_ist_date_at_2330_and_0001_ist(wa_env):                    # RF5
    db = wa_env.db
    assert ws.ist_day(_at(2026, 9, 24, 18, 0)) == "2026-09-24"      # 23:30 IST
    assert ws.ist_day(_at(2026, 9, 24, 18, 31)) == "2026-09-25"     # 00:01 IST

    async def go():
        await seed_wa(db)
        wa_env.clock["now"] = _at(2026, 9, 24, 18, 0)
        await send_whatsapp(db, to="9811111111", text="late reply", kind="chat", typed_by=PARUL)
        wa_env.clock["now"] = _at(2026, 9, 24, 18, 31)
        await send_whatsapp(db, to="9811111111", text="after midnight", kind="chat", typed_by=PARUL)
        days = sorted(r["day"] for r in await db.wa_send_ledger.find({}, {"_id": 0}).to_list(None))
        assert days == ["2026-09-24", "2026-09-25"]
        rows = await db.wa_send_ledger.find({}, {"_id": 0}).to_list(None)
        assert all(r["sent_count"] == 1 for r in rows)
        assert {tuple(r["hour_bucket"].items()) for r in rows} == {(("23", 1),), (("00", 1),)}
    _run(go())


def test_quiet_hours_queue_until_0900_ist_next_day(wa_env):                          # RF5
    db = wa_env.db

    async def go():
        await seed_wa(db)
        wa_env.clock["now"] = _at(2026, 9, 24, 14, 30)                # 20:00 IST
        res = await send_whatsapp(db, to="9811111111", text="x", kind="dispatch")
        assert (res["status"], res["reason"]) == ("queued", "quiet_hours")
        row = await db.wa_messages.find_one({"message_id": res["message_id"]}, {"_id": 0})
        assert row["send_after"] == "2026-09-25T03:30:00+00:00"       # 09:00 IST tomorrow
        assert wa_env.evo.sends == []
    _run(go())


def test_before_0900_ist_queues_for_the_same_morning(wa_env):                        # RF5
    db = wa_env.db

    async def go():
        await seed_wa(db)
        wa_env.clock["now"] = _at(2026, 9, 24, 3, 29)                 # 08:59 IST
        res = await send_whatsapp(db, to="9811111111", text="x", kind="intro")
        row = await db.wa_messages.find_one({"message_id": res["message_id"]}, {"_id": 0})
        assert row["send_after"] == "2026-09-24T03:30:00+00:00"
    _run(go())


def test_manual_chat_and_internal_alerts_ignore_business_hours(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db)
        wa_env.clock["now"] = _at(2026, 9, 24, 17, 0)                # 22:30 IST
        a = await send_whatsapp(db, to="9811111111", text="x", kind="chat", typed_by=PARUL)
        b = await send_whatsapp(db, to="9822222222", text="x", kind="alert", channel="company")
        assert a["status"] == "sent" and b["status"] == "sent"
    _run(go())


def test_hourly_cap_queues_even_a_manual_chat(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db, settings={"hourly_cap": 2})
        r = [await send_whatsapp(db, to=f"98111111{i:02d}", text="x", kind="chat", typed_by=PARUL) for i in range(3)]
        assert [x["status"] for x in r] == ["sent", "sent", "queued"] and r[2]["reason"] == "hourly_cap"
        row = await db.wa_messages.find_one({"message_id": r[2]["message_id"]}, {"_id": 0})
        assert row["send_after"] == "2026-09-24T06:30:00+00:00"       # 12:00 IST
    _run(go())


def test_daily_cap_queues_automations_to_tomorrow_but_not_a_chat(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db, company=None)
        await seed_instance(db, COMPANY, kind="company", phone="919000000001", daily_cap_override=1)
        a = await send_whatsapp(db, to="9811111111", text="x", kind="dispatch")
        b = await send_whatsapp(db, to="9822222222", text="x", kind="dispatch")
        c = await send_whatsapp(db, to="9833333333", text="x", kind="chat", typed_by=PARUL)
        assert (a["status"], b["status"], b["reason"], c["status"]) == ("sent", "queued", "daily_cap", "sent")
        row = await db.wa_messages.find_one({"message_id": b["message_id"]}, {"_id": 0})
        assert row["send_after"] == "2026-09-25T03:30:00+00:00"
    _run(go())


def test_one_marketing_message_per_contact_per_number_per_day(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db)
        await db.settings.insert_one({"type": "notifications", "require_wa_consent": False})
        a = await send_whatsapp(db, to="9811111111", text="step 1", kind="drip")
        b = await send_whatsapp(db, to="+91 98111 11111", text="festival", kind="greeting")
        c = await send_whatsapp(db, to="9811111111", text="your kit shipped", kind="dispatch")
        assert (a["status"], b["status"], b["reason"], c["status"]) == ("sent", "queued", "per_contact_per_day", "sent")
    _run(go())


def test_the_gap_queues_a_second_automation_but_never_a_chat(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db, settings={"gap_min_s": 8, "gap_max_s": 8})
        a = await send_whatsapp(db, to="9811111111", text="x", kind="dispatch")
        b = await send_whatsapp(db, to="9822222222", text="x", kind="dispatch")
        c = await send_whatsapp(db, to="9833333333", text="x", kind="chat", typed_by=PARUL)
        assert (a["status"], b["status"], b["reason"], c["status"]) == ("sent", "queued", "gap", "sent")
        wa_env.clock["now"] += timedelta(seconds=9)
        d = await send_whatsapp(db, to="9844444444", text="x", kind="dispatch")
        assert d["status"] == "sent"
    _run(go())


def test_drainer_sends_due_rows_oldest_first_and_sleeps_between(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db, settings={"gap_min_s": 8, "gap_max_s": 25})
        wa_env.clock["now"] = _at(2026, 9, 24, 14, 30)                # 20:00 IST — both queue
        first = await send_whatsapp(db, to="9811111111", text="first", kind="dispatch")
        wa_env.clock["now"] += timedelta(minutes=1)
        second = await send_whatsapp(db, to="9822222222", text="second", kind="dispatch")
        wa_env.clock["now"] = _at(2026, 9, 25, 3, 35)                 # 09:05 IST next day
        out = await ws.run_wa_queue_pass(db)
        assert out == {"instances": 1, "processed": 2}
        assert [s["text"] for s in wa_env.evo.sends] == ["first", "second"]
        assert len(wa_env.clock["slept"]) == 2 and all(8 <= s <= 25 for s in wa_env.clock["slept"])
        for r in (first, second):
            assert (await db.wa_messages.find_one({"message_id": r["message_id"]}))["status"] == "sent"
    _run(go())


def test_drainer_leaves_rows_that_are_not_yet_due(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db)
        wa_env.clock["now"] = _at(2026, 9, 24, 14, 30)
        await send_whatsapp(db, to="9811111111", text="x", kind="dispatch")
        out = await ws.run_wa_queue_pass(db)
        assert out["processed"] == 0 and wa_env.evo.sends == []
    _run(go())


def test_drainer_reroutes_when_the_owner_number_went_down(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db, reps={PARUL: "connected"})
        wa_env.clock["now"] = _at(2026, 9, 24, 14, 30)
        res = await send_whatsapp(db, to="9811111111", text="x", kind="dispatch", owner_email=PARUL)
        assert res["instance_name"] == "rep_parul"
        await db.wa_instances.update_one({"instance_name": "rep_parul"}, {"$set": {"state": "disconnected"}})
        wa_env.clock["now"] = _at(2026, 9, 25, 3, 35)
        await ws.run_wa_queue_pass(db)
        assert wa_env.evo.sends[-1]["instance"] == COMPANY
    _run(go())


def test_drainer_reclaims_a_stale_sending_row(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db)
        wa_env.clock["now"] = _at(2026, 9, 24, 14, 30)
        res = await send_whatsapp(db, to="9811111111", text="x", kind="dispatch")
        wa_env.clock["now"] = _at(2026, 9, 25, 3, 35)
        await db.wa_messages.update_one({"message_id": res["message_id"]}, {"$set": {
            "status": "sending", "claimed_at": (wa_env.clock["now"] - timedelta(minutes=11)).isoformat()}})
        await ws.run_wa_queue_pass(db)
        assert (await db.wa_messages.find_one({"message_id": res["message_id"]}))["status"] == "sent"
    _run(go())


def test_a_pass_already_running_is_not_doubled(wa_env):
    async def go():
        async with ws._QUEUE_LOCK:
            assert await ws.run_wa_queue_pass(wa_env.db) == {"skipped": "already_running"}
    _run(go())


def test_five_consecutive_failures_pause_the_number_and_alert(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db, reps={PARUL: "connected"})
        wa_env.evo.fail_sends = True
        for i in range(5):
            r = await send_whatsapp(db, to=f"98111111{i:02d}", text="x", kind="chat", owner_email=PARUL,
                                    typed_by=PARUL)
            assert r["status"] == "failed"
        inst = await db.wa_instances.find_one({"instance_name": "rep_parul"}, {"_id": 0})
        assert inst["state"] == "paused" and "5 sends in a row failed" in inst["paused_reason"]
        notes = await db.notifications.find({"type": "whatsapp_alert"}, {"_id": 0}).to_list(None)
        assert {n["assigned_to"] for n in notes} == {PARUL, "info@smartshape.in"}
        assert {p["email"] for p in wa_env.pushes} == {PARUL, "info@smartshape.in"}
        wa_env.evo.fail_sends = False
        nxt = await send_whatsapp(db, to="9899999999", text="x", kind="chat", owner_email=PARUL, typed_by=PARUL)
        assert nxt["instance_name"] == COMPANY                         # the paused number is not used
    _run(go())


def test_a_success_resets_the_failure_streak(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db)
        wa_env.evo.fail_sends = True
        for i in range(4):
            await send_whatsapp(db, to=f"98111111{i:02d}", text="x", kind="chat", typed_by=PARUL)
        wa_env.evo.fail_sends = False
        await send_whatsapp(db, to="9899999999", text="x", kind="chat", typed_by=PARUL)
        wa_env.evo.fail_sends = True
        await send_whatsapp(db, to="9899999998", text="x", kind="chat", typed_by=PARUL)
        inst = await db.wa_instances.find_one({"instance_name": COMPANY}, {"_id": 0})
        assert inst["state"] == "connected" and inst["consecutive_failures"] == 1
    _run(go())


def test_a_young_rep_number_does_not_carry_campaigns(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db)
        await seed_instance(db, "rep_parul", owner_email=PARUL, phone="919000000111",
                            warmup_started_at=(wa_env.clock["now"] - timedelta(days=5)).isoformat())
        await db.settings.insert_one({"type": "notifications", "require_wa_consent": False})
        camp = await send_whatsapp(db, to="9811111111", text="x", kind="campaign", owner_email=PARUL)
        disp = await send_whatsapp(db, to="9822222222", text="x", kind="dispatch", owner_email=PARUL)
        assert camp["instance_name"] == COMPANY and disp["instance_name"] == "rep_parul"
    _run(go())
```

**2. Run — expect failure** (`AttributeError: module 'services.wa_send' has no attribute 'daily_cap'`, then cap tests).

```bash
cd backend && DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 python -m pytest tests/test_wa_send_caps.py -q
```

**3. Implement** — in `backend/services/wa_send.py`:

(a) Add after `jid_for`:

```python
def _hm(s: str):
    h, m = str(s).split(":")
    return int(h), int(m)


def warmup_day(inst: dict, now: datetime) -> int:
    started = inst.get("warmup_started_at")
    if not started:
        return 1
    return max(0, (now.astimezone(IST).date() - _parse(started).astimezone(IST).date()).days) + 1


def daily_cap(inst: dict, cfg: dict, now: datetime) -> int:
    """D5 warm-up: 20/day, doubling every 3 days, capped at 200 — or the admin's override."""
    if inst.get("daily_cap_override"):
        return int(inst["daily_cap_override"])
    if not inst.get("warmup_started_at"):
        return int(cfg["warmup_start_cap"])
    doublings = (warmup_day(inst, now) - 1) // int(cfg["warmup_double_every_days"])
    return int(min(int(cfg["daily_cap"]), int(cfg["warmup_start_cap"]) * (2 ** min(doublings, 20))))


def next_business_open(now: datetime, cfg: dict) -> Optional[datetime]:
    """None inside business hours (IST); otherwise the next opening instant, in UTC."""
    loc = now.astimezone(IST)
    sh, sm = _hm(cfg["business_start"])
    eh, em = _hm(cfg["business_end"])
    start = loc.replace(hour=sh, minute=sm, second=0, microsecond=0)
    end = loc.replace(hour=eh, minute=em, second=0, microsecond=0)
    if start <= loc < end:
        return None
    return (start if loc < start else start + timedelta(days=1)).astimezone(timezone.utc)


def _tomorrow_open(now: datetime, cfg: dict) -> datetime:
    loc = now.astimezone(IST)
    sh, sm = _hm(cfg["business_start"])
    return (loc.replace(hour=sh, minute=sm, second=0, microsecond=0) + timedelta(days=1)).astimezone(timezone.utc)


def _next_hour(now: datetime) -> datetime:
    loc = now.astimezone(IST)
    return (loc.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)).astimezone(timezone.utc)
```

(b) Add the ledger helpers above `_policy`:

```python
async def _ledger(db, name: str, now: datetime) -> dict:
    day = ist_day(now)                                  # RF5: the IST date, never the UTC one
    await db.wa_send_ledger.update_one(
        {"instance_name": name, "day": day},
        {"$setOnInsert": {"instance_name": name, "day": day, "sent_count": 0, "hour_bucket": {},
                          "last_sent_at": None}},
        upsert=True)
    return await db.wa_send_ledger.find_one({"instance_name": name, "day": day}, {"_id": 0}) or {}


async def _claim_gap(db, name: str, now: datetime, cfg: dict) -> bool:
    """Atomically take the next send slot on this number: succeeds only if the last send was at
    least a random 8–25 s ago. Two concurrent callers cannot both win."""
    if float(cfg["gap_max_s"]) <= 0:
        return True
    gap = _jitter(float(cfg["gap_min_s"]), float(cfg["gap_max_s"]))
    res = await db.wa_send_ledger.update_one(
        {"instance_name": name, "day": ist_day(now),
         "$or": [{"last_sent_at": None}, {"last_sent_at": {"$lte": _iso(now - timedelta(seconds=gap))}}]},
        {"$set": {"last_sent_at": _iso(now)}})
    return getattr(res, "modified_count", 0) == 1


async def _contacted_today(db, name: str, to_jid: str, now: datetime, cfg: dict) -> bool:
    n = await db.wa_messages.count_documents({
        "instance_name": name, "to_jid": to_jid, "direction": "out",
        "kind": {"$in": sorted(MARKETING_KINDS)}, "sent_day": ist_day(now),
        "status": {"$in": ["sent", "delivered", "read"]}})
    return n >= int(cfg["per_contact_per_day"])
```

(c) Replace `_policy` with:

```python
async def _policy(db, row: dict, inst: Optional[dict], cfg: dict, *, from_queue: bool = False):
    """-> ("send", "", None) | ("skip", reason, None) | ("queue", reason, send_after). See the
    policy table in the W1 plan (Task 5)."""
    kind = row["kind"]
    now = _now()
    automated = kind not in MANUAL_KINDS
    customer_facing = automated and kind not in INTERNAL_KINDS
    if customer_facing:
        if await is_opted_out(db, e164=row["to_e164"], contact_id=row["contact_id"], school_id=row["school_id"]):
            return "skip", "opt_out", None
        if kind in CONSENT_KINDS and row["enforce_consent"]:
            if not await consent_ok(db, lead_id=row["lead_id"], contact_id=row["contact_id"],
                                    school_id=row["school_id"]):
                return "skip", "no_consent", None
        opens = next_business_open(now, cfg)
        if opens is not None:
            return "queue", "quiet_hours", opens
    if inst is None:                                    # AutoSender fallback: no per-number ledger
        return "send", "", None
    led = await _ledger(db, inst["instance_name"], now)
    if int((led.get("hour_bucket") or {}).get(ist_hour(now), 0)) >= int(cfg["hourly_cap"]):
        nxt = _next_hour(now)
        if customer_facing:
            nxt = next_business_open(nxt, cfg) or nxt
        return "queue", "hourly_cap", nxt
    if automated:
        if int(led.get("sent_count", 0)) >= daily_cap(inst, cfg, now):
            return "queue", "daily_cap", _tomorrow_open(now, cfg)
        if kind in MARKETING_KINDS and await _contacted_today(db, inst["instance_name"], row["to_jid"], now, cfg):
            return "queue", "per_contact_per_day", _tomorrow_open(now, cfg)
        if not from_queue and not await _claim_gap(db, inst["instance_name"], now, cfg):
            return "queue", "gap", now + timedelta(seconds=_jitter(float(cfg["gap_min_s"]), float(cfg["gap_max_s"])))
    return "send", "", None
```

(d) Replace `_record_success` and `_record_failure`, and add `pause_instance`:

```python
async def _record_success(db, inst: dict) -> None:
    now = _now()
    name = inst["instance_name"]
    await _ledger(db, name, now)
    await db.wa_send_ledger.update_one(
        {"instance_name": name, "day": ist_day(now)},
        {"$inc": {"sent_count": 1, f"hour_bucket.{ist_hour(now)}": 1}, "$set": {"last_sent_at": _iso(now)}})
    await db.wa_instances.update_one({"instance_name": name}, {"$set": {
        "consecutive_failures": 0, "last_sent_at": _iso(now), "last_error": ""}})


async def _record_failure(db, inst: dict, err: str, cfg: dict) -> None:
    name = inst["instance_name"]
    await db.wa_instances.update_one({"instance_name": name}, {
        "$inc": {"consecutive_failures": 1}, "$set": {"last_error": err, "last_error_at": _iso(_now())}})
    cur = await db.wa_instances.find_one({"instance_name": name}, {"_id": 0}) or {}
    streak = int(cur.get("consecutive_failures", 0))
    if streak >= int(cfg["failure_pause_after"]) and cur.get("state") != "paused":
        await pause_instance(db, cur, reason=f"{streak} sends in a row failed. Last error: {err}")


async def pause_instance(db, inst: dict, *, reason: str, by: str = "system") -> None:
    now = _iso(_now())
    await db.wa_instances.update_one({"instance_name": inst["instance_name"]}, {"$set": {
        "state": "paused", "state_at": now, "paused_reason": reason, "paused_by": by}})
    who = ("The company WhatsApp number" if inst.get("kind") == "company"
           else f"{inst.get('label') or inst.get('owner_email') or inst['instance_name']}'s WhatsApp number")
    await alert(db, emails=[inst.get("owner_email")] + await admin_emails(db),
                title="WhatsApp number paused",
                body=(f"{who} (+{inst.get('phone_e164') or '?'}) was paused: {reason} "
                      "Nothing more goes out from it until an admin resumes it in Settings → WhatsApp."),
                dedup_key=f"wa_paused:{inst['instance_name']}", ref_id=inst["instance_name"])
```

(e) Replace `_route_and_send` (adds the young-number rule — Rollout step 3):

```python
async def _route_and_send(db, row: dict, cfg: dict, *, from_queue: bool) -> dict:
    inst, why = await resolve_sender(db, owner_email=row["owner_email"] or None, channel=row["channel"])
    if (inst is not None and row["kind"] in YOUNG_NUMBER_BLOCKED_KINDS and inst.get("kind") == "rep"
            and warmup_day(inst, _now()) <= int(cfg["warmup_days"])):
        # Rollout 3: no campaigns from a number younger than the warm-up period.
        inst, why = await resolve_sender(db, channel="company")
        if inst is None:
            return await _finish(db, row, "skipped", "number_warming_up")
    if inst is None:
        if not (why == "no_sender" and cfg["fallback_provider"] == "autosender" and await _autosender_ready(db)):
            return await _finish(db, row, "skipped", why)
        row["instance_name"] = ""
    else:
        _stamp_sender(row, inst)
    decision, reason, after = await _policy(db, row, inst, cfg, from_queue=from_queue)
    if decision == "skip":
        return await _finish(db, row, "skipped", reason)
    if decision == "queue":
        return await _finish_queued(db, row, reason, after)
    return await _deliver(db, row, inst, cfg)
```

(f) Append the drainer:

```python
# ── The queue drainer (scheduler.wa_queue_loop, every minute) ─────────────────
# Same two guards as the drip executor (scheduler.py _DRIP_LOCK / _claim_enrollment):
# an in-process lock so overlapping passes collapse, and a per-row compare-and-set claim
# (queued -> sending) so two workers can never send one row. A claim older than
# QUEUE_CLAIM_MINUTES is a pass that died mid-send; the row goes back to the queue.
_QUEUE_LOCK = asyncio.Lock()
QUEUE_CLAIM_MINUTES = 10


async def run_wa_queue_pass(db, *, budget_s: float = 50.0) -> dict:
    if _QUEUE_LOCK.locked():
        return {"skipped": "already_running"}
    async with _QUEUE_LOCK:
        now = _now()
        await db.wa_messages.update_many(
            {"status": "sending", "claimed_at": {"$lt": _iso(now - timedelta(minutes=QUEUE_CLAIM_MINUTES))}},
            {"$set": {"status": "queued"}})
        names = await db.wa_messages.distinct("instance_name", {"status": "queued", "send_after": {"$lte": _iso(now)}})
        deadline = now + timedelta(seconds=budget_s)
        counts = await asyncio.gather(*[_drain_instance(db, n, deadline=deadline) for n in names])
        return {"instances": len(names), "processed": sum(counts)}


async def _drain_instance(db, name: str, *, deadline: datetime) -> int:
    """Oldest first, one at a time per number, a jittered pause after each real send."""
    cfg = await get_wa_settings(db)
    done = 0
    while _now() < deadline:
        now_iso = _iso(_now())
        row = await db.wa_messages.find_one_and_update(
            {"status": "queued", "instance_name": name, "send_after": {"$lte": now_iso}},
            {"$set": {"status": "sending", "claimed_at": now_iso}},
            sort=[("created_at", 1)], projection={"_id": 0})
        if not row:
            break
        # `row` is the document before the claim; the sender is re-resolved (the owner's
        # number may have gone down since this was queued) and every cap re-checked except
        # the gap, which this loop enforces itself by sleeping.
        res = await _route_and_send(db, row, cfg, from_queue=True)
        done += 1
        if res["status"] == "sent":
            await _sleep(_jitter(float(cfg["gap_min_s"]), float(cfg["gap_max_s"])))
    return done
```

In `backend/scheduler.py`, add after `drip_executor_loop` (currently `:839-846`):

```python
async def wa_queue_loop():
    """Send queued WhatsApp messages (outside hours / over cap / behind the gap) once they are
    due. services/wa_send.py owns the rules; this is only the clock."""
    log.info("[scheduler] WhatsApp queue drainer started (every 60s)")
    from services.wa_send import run_wa_queue_pass
    while True:
        try:
            out = await run_wa_queue_pass(db)
            if out.get("processed"):
                log.info(f"[wa-queue] {out}")
        except Exception as exc:
            log.error(f"[wa-queue] {exc}")
        await asyncio.sleep(60)
```

and in `start_scheduler()` (`:2025-2036`) add `asyncio.create_task(wa_queue_loop())` after `asyncio.create_task(wa_sender_loop())`.

**4. Run — expect pass** (and Task 4's suite, which must stay green: its tests run at 11:00 IST with `FAST` gaps).

```bash
cd backend && DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 python -m pytest tests/test_wa_send_caps.py tests/test_wa_send.py -q
cd backend && python -c "import scheduler; print('ok')"
```

**5. Commit**

```bash
git add backend/services/wa_send.py backend/scheduler.py
git add -f backend/tests/test_wa_send_caps.py
git commit -m "feat(wa): per-number warm-up, hourly/daily caps, IST business hours, jittered gap, queue drainer and auto-pause

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## Task 6 — Webhook receiver `/api/webhooks/whatsapp/{instance}?t=`

### Files

| Action | Path | Current refs |
|---|---|---|
| create | `backend/routes/wa_routes.py` | new (Task 7 appends the `/wa` routes) |
| modify | `backend/main.py` | router imports `:49-70` (whatsapp at `:59`); includes `:92-122` (whatsapp at `:112`) |
| modify | `backend/routes/whatsapp_routes.py` | delete the unauthenticated webhook `:948-992` |
| create | `backend/tests/test_wa_webhook.py` | new |

### Interfaces

**Produces**
- `POST /api/webhooks/whatsapp/{instance}?t=<WA_WEBHOOK_SECRET>` — `routes.wa_routes.wa_instance_webhook(instance: str,
  request: Request, t: str = "")`:
  - 401 when `WA_WEBHOOK_SECRET` is unset, or `t` does not match (constant-time compare) — **checked before the body is read**;
  - 401 when `payload.instance` is present and differs from the path;
  - 200 `{"ok": true, "ignored": "unknown_instance"}` for an instance with no `wa_instances` row (RF1 — acknowledged so
    Evolution stops retrying; nothing written);
  - 200 `{"ok": true}` after dispatch; `{"ok": true, "ignored": "<EVENT>"}` for events we do not handle.
- Event handlers (event names accepted as `connection.update` or `CONNECTION_UPDATE`):
  - `CONNECTION_UPDATE` → `wa_instances.state`: `open` → `connected` (stays `paused` if paused), sets `phone_e164`/`jid`
    from `data.wuid` or `fetch_instance().ownerJid`, starts `warmup_started_at` for a new SIM; **same SIM already linked
    on another instance → the newcomer is logged out and set `unlinked`, both owners + admins alerted** (RF2);
    `close` with `statusReason` 401/403/440 → `paused` + alert; other `close` → `disconnected` + alert (daily dedup);
    `connecting` → no state change.
  - `QRCODE_UPDATED` → `qr_base64`, `qr_at`, state `qr` (unless connected/paused) — read by `GET /wa/me`.
  - `MESSAGES_UPDATE` → `wa_messages.status` + `status_history` by `(instance_name, provider_msg_id)`, forward-only
    (`sent < delivered < read`; `failed` only from `sent`); legacy `whatsapp_scheduled.wa_message_id` rows mirrored.
  - `SEND_MESSAGE` → a message sent **from the phone itself** is stored once as a `source: "phone"` row keyed by provider id
    (our own API sends already have their row; see `wa_send._finish` for the race).
  - `MESSAGES_UPSERT` → **W1 stub:** the raw event is stored in `wa_events_raw {instance_name, event, data, received_at,
    processed: false}` and nothing else. **W2's ingest replaces this handler** (normalise → `wa_messages`/`wa_chats`,
    contact match, media download) and back-fills from `wa_events_raw`.
- `_HANDLERS: dict[str, coroutine(inst, data)]` — W2 swaps `MESSAGES_UPSERT` (and extends `SEND_MESSAGE`) here.

**Consumes:** `wa_send.alert`, `wa_send.admin_emails`, `wa_send._now/_iso/ist_day` (Task 4/5); `evolution.fetch_instance`,
`evolution.logout` (Task 2).

### Steps

**1. Failing test** — `backend/tests/test_wa_webhook.py`:

```python
"""The per-instance webhook: secret first, instance must match, unknown instances ignored, and
the four W1 event handlers (+ the W2 raw stub).

Run:
    DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 \
    python -m pytest tests/test_wa_webhook.py -q
"""
import asyncio
import os

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from fastapi import HTTPException

import routes.wa_routes as wr
from services.wa_send import send_whatsapp
from wa_fixtures import COMPANY, seed_instance, seed_user, seed_wa

PARUL = "parul@smartshape.in"
KALPANA = "kalpana@smartshape.in"
OWNER = "info@smartshape.in"


class FakeRequest:
    def __init__(self, body=None):
        self._body = body if body is not None else {}
        self.read = False

    async def json(self):
        self.read = True
        return self._body


@pytest.fixture()
def env(wa_env, monkeypatch):
    monkeypatch.setattr(wr, "db", wa_env.db)
    monkeypatch.setenv("WA_WEBHOOK_SECRET", "s3cret")
    return wa_env


def _run(coro):
    return asyncio.run(coro)


def _hook(instance, body, t="s3cret"):
    return wr.wa_instance_webhook(instance, FakeRequest(body), t=t)


async def _inst(db, name):
    return await db.wa_instances.find_one({"instance_name": name}, {"_id": 0})


# ── RF1: authentication and routing ──────────────────────────────────────────

def test_secret_is_checked_before_the_body_is_read(env):
    for t in ("wrong", ""):
        req = FakeRequest({"event": "connection.update"})
        with pytest.raises(HTTPException) as e:
            _run(wr.wa_instance_webhook("rep_parul", req, t=t))
        assert e.value.status_code == 401 and req.read is False


def test_no_secret_configured_refuses_everything(env, monkeypatch):
    monkeypatch.delenv("WA_WEBHOOK_SECRET")
    with pytest.raises(HTTPException) as e:
        _run(_hook("rep_parul", {"event": "connection.update"}, t=""))
    assert e.value.status_code == 401


def test_payload_instance_must_match_the_path(env):
    db = env.db

    async def go():
        await seed_instance(db, "rep_parul", owner_email=PARUL, state="connected", phone="919811111111")
        with pytest.raises(HTTPException) as e:
            await _hook("rep_parul", {"event": "connection.update", "instance": COMPANY,
                                      "data": {"state": "close", "statusReason": 401}})
        assert e.value.status_code == 401
        assert (await _inst(db, "rep_parul"))["state"] == "connected"
    _run(go())


def test_unknown_instance_is_acknowledged_and_ignored(env):
    db = env.db

    async def go():
        out = await _hook("rep_ghost", {"event": "messages.upsert", "instance": "rep_ghost", "data": {"x": 1}})
        assert out == {"ok": True, "ignored": "unknown_instance"}
        assert await db.wa_instances.count_documents({}) == 0
        assert await db.wa_events_raw.count_documents({}) == 0
    _run(go())


# ── CONNECTION_UPDATE ────────────────────────────────────────────────────────

def test_open_marks_connected_with_phone_and_starts_warmup(env):
    db = env.db

    async def go():
        await seed_instance(db, "rep_parul", owner_email=PARUL, state="qr", warmup_started_at=None,
                            qr_base64="data:QR")
        await _hook("rep_parul", {"event": "connection.update", "instance": "rep_parul",
                                  "data": {"state": "open", "wuid": "919811111111@s.whatsapp.net"}})
        i = await _inst(db, "rep_parul")
        assert i["state"] == "connected" and i["phone_e164"] == "919811111111"
        assert i["jid"] == "919811111111@s.whatsapp.net" and i["qr_base64"] == ""
        assert i["warmup_started_at"] == env.clock["now"].isoformat()
    _run(go())


def test_open_without_wuid_asks_evolution_for_the_owner(env):
    db = env.db

    async def go():
        await seed_instance(db, "rep_parul", owner_email=PARUL, state="qr")
        env.evo.owner_jid["rep_parul"] = "919822222222:12@s.whatsapp.net"
        await _hook("rep_parul", {"event": "CONNECTION_UPDATE", "data": {"state": "open"}})
        assert (await _inst(db, "rep_parul"))["phone_e164"] == "919822222222"
    _run(go())


def test_open_while_paused_stays_paused(env):
    db = env.db

    async def go():
        await seed_instance(db, "rep_parul", owner_email=PARUL, state="paused", phone="919811111111")
        await _hook("rep_parul", {"event": "connection.update", "data": {"state": "open",
                                                                         "wuid": "919811111111@s.whatsapp.net"}})
        assert (await _inst(db, "rep_parul"))["state"] == "paused"
    _run(go())


def test_relinking_the_same_sim_keeps_warmup_but_a_new_sim_restarts_it(env):
    db = env.db

    async def go():
        await seed_instance(db, "rep_parul", owner_email=PARUL, state="qr", phone="919811111111")
        await _hook("rep_parul", {"event": "connection.update", "data": {"state": "open",
                                                                         "wuid": "919811111111@s.whatsapp.net"}})
        assert (await _inst(db, "rep_parul"))["warmup_started_at"] == "2026-01-01T00:00:00+00:00"
        await _hook("rep_parul", {"event": "connection.update", "data": {"state": "open",
                                                                         "wuid": "919833333333@s.whatsapp.net"}})
        assert (await _inst(db, "rep_parul"))["warmup_started_at"] == env.clock["now"].isoformat()
    _run(go())


def test_open_on_a_number_already_linked_elsewhere_unlinks_the_newcomer(env):          # RF2
    db = env.db

    async def go():
        await seed_instance(db, "rep_kalpana", owner_email=KALPANA, state="connected", phone="919811111111")
        await seed_instance(db, "rep_parul", owner_email=PARUL, state="qr")
        await _hook("rep_parul", {"event": "connection.update", "data": {"state": "open",
                                                                         "wuid": "919811111111@s.whatsapp.net"}})
        p = await _inst(db, "rep_parul")
        assert p["state"] == "unlinked" and "already linked" in p["paused_reason"]
        assert p.get("phone_e164", "") == ""
        assert any(c["path"] == "/instance/logout/rep_parul" for c in env.evo.calls)
        k = await _inst(db, "rep_kalpana")
        assert k["state"] == "connected" and k["phone_e164"] == "919811111111"
        told = {n["assigned_to"] for n in await db.notifications.find({}, {"_id": 0}).to_list(None)}
        assert told == {PARUL, KALPANA, OWNER}
    _run(go())


def test_close_401_pauses_and_alerts_the_rep_and_admins(env):
    db = env.db

    async def go():
        await seed_instance(db, "rep_parul", owner_email=PARUL, state="connected", phone="919811111111")
        await _hook("rep_parul", {"event": "connection.update", "data": {"state": "close", "statusReason": 401}})
        i = await _inst(db, "rep_parul")
        assert i["state"] == "paused" and "logged this number out" in i["paused_reason"]
        told = {n["assigned_to"] for n in await db.notifications.find({}, {"_id": 0}).to_list(None)}
        assert told == {PARUL, OWNER}
    _run(go())


def test_transient_close_marks_disconnected_and_alerts_once_a_day(env):
    db = env.db

    async def go():
        await seed_instance(db, "rep_parul", owner_email=PARUL, state="connected", phone="919811111111")
        for _ in range(2):
            await _hook("rep_parul", {"event": "connection.update", "data": {"state": "close", "statusReason": 428}})
            await db.wa_instances.update_one({"instance_name": "rep_parul"}, {"$set": {"state": "connected"}})
        assert await db.notifications.count_documents({"assigned_to": PARUL}) == 1
        assert len([p for p in env.pushes if p["email"] == PARUL]) == 1
    _run(go())


def test_company_close_alerts_every_admin(env):                                        # RF3
    db = env.db

    async def go():
        await seed_user(db, "bde@smartshape.in", role="admin")
        await seed_wa(db, reps={PARUL: "connected"})
        await _hook(COMPANY, {"event": "connection.update", "data": {"state": "close", "statusReason": 500}})
        assert (await _inst(db, COMPANY))["state"] == "disconnected"
        notes = await db.notifications.find({}, {"_id": 0}).to_list(None)
        assert {n["assigned_to"] for n in notes} == {OWNER, "bde@smartshape.in"}
        assert all(n["title"] == "Company WhatsApp disconnected" for n in notes)
    _run(go())


# ── QRCODE_UPDATED ───────────────────────────────────────────────────────────

def test_qrcode_updated_caches_the_qr_for_wa_me(env):
    db = env.db

    async def go():
        await seed_instance(db, "rep_parul", owner_email=PARUL, state="disconnected")
        await _hook("rep_parul", {"event": "qrcode.updated",
                                  "data": {"qrcode": {"base64": "data:image/png;base64,NEW", "code": "2@x"}}})
        i = await _inst(db, "rep_parul")
        assert i["state"] == "qr" and i["qr_base64"] == "data:image/png;base64,NEW" and i["qr_at"]
    _run(go())


# ── MESSAGES_UPDATE ──────────────────────────────────────────────────────────

def test_messages_update_moves_status_forward_only(env):
    db = env.db

    async def go():
        await seed_wa(db)
        res = await send_whatsapp(db, to="9811111111", text="x", kind="dispatch")        # provider id PMID1
        await _hook(COMPANY, {"event": "messages.update",
                              "data": {"keyId": "PMID1", "fromMe": True, "status": "DELIVERY_ACK"}})
        await _hook(COMPANY, {"event": "MESSAGES_UPDATE",
                              "data": [{"key": {"id": "PMID1"}, "update": {"status": 4}}]})
        await _hook(COMPANY, {"event": "messages.update",
                              "data": {"keyId": "PMID1", "status": "DELIVERY_ACK"}})        # late, out of order
        row = await db.wa_messages.find_one({"message_id": res["message_id"]}, {"_id": 0})
        assert row["status"] == "read"
        assert [h["status"] for h in row["status_history"]] == ["sent", "delivered", "read"]
    _run(go())


def test_messages_update_for_a_legacy_campaign_row_updates_whatsapp_scheduled(env):
    db = env.db

    async def go():
        await seed_wa(db)
        await db.whatsapp_scheduled.insert_one({"scheduled_id": "s1", "wa_message_id": "OLD1", "status": "sent"})
        await _hook(COMPANY, {"event": "messages.update", "data": {"keyId": "OLD1", "status": "READ"}})
        assert (await db.whatsapp_scheduled.find_one({"scheduled_id": "s1"}))["status"] == "read"
    _run(go())


# ── SEND_MESSAGE ─────────────────────────────────────────────────────────────

def test_a_message_sent_from_the_phone_is_recorded_once(env):
    db = env.db
    body = {"event": "send.message", "data": {"key": {"id": "PHONE1", "fromMe": True,
                                                       "remoteJid": "919811111111@s.whatsapp.net"},
                                               "message": {"conversation": "typed on the phone"},
                                               "messageTimestamp": 1790000000}}

    async def go():
        await seed_instance(db, "rep_parul", owner_email=PARUL, state="connected", phone="919000000111")
        await _hook("rep_parul", body)
        await _hook("rep_parul", body)
        rows = await db.wa_messages.find({"provider_msg_id": "PHONE1"}, {"_id": 0}).to_list(None)
        assert len(rows) == 1
        r = rows[0]
        assert r["source"] == "phone" and r["text"] == "typed on the phone" and r["direction"] == "out"
        assert r["chat_id"] == "rep_parul:919811111111@s.whatsapp.net" and r["to_e164"] == "919811111111"
    _run(go())


def test_our_send_racing_its_own_send_message_webhook_leaves_one_row(env):
    db = env.db

    async def go():
        await seed_wa(db)
        # The webhook for our message arrives before our own write (the fake will answer PMID1).
        await _hook(COMPANY, {"event": "send.message", "data": {"key": {"id": "PMID1", "fromMe": True,
                                                                         "remoteJid": "919811111111@s.whatsapp.net"},
                                                                 "message": {"conversation": "x"}}})
        res = await send_whatsapp(db, to="9811111111", text="x", kind="dispatch", ref={"dispatch_id": "d1"})
        rows = await db.wa_messages.find({"provider_msg_id": "PMID1"}, {"_id": 0}).to_list(None)
        assert len(rows) == 1 and rows[0]["message_id"] == res["message_id"]
        assert rows[0]["source"] == "app" and rows[0]["kind"] == "dispatch"
    _run(go())


# ── MESSAGES_UPSERT (W2 stub) ────────────────────────────────────────────────

def test_messages_upsert_is_stored_raw_for_w2(env):
    db = env.db

    async def go():
        await seed_instance(db, "rep_parul", owner_email=PARUL, state="connected")
        data = {"key": {"id": "IN1", "fromMe": False, "remoteJid": "919811111111@s.whatsapp.net"},
                "message": {"conversation": "STOP"}, "pushName": "Ritu"}
        out = await _hook("rep_parul", {"event": "messages.upsert", "data": data})
        assert out == {"ok": True}
        raw = await db.wa_events_raw.find_one({}, {"_id": 0})
        assert raw["event"] == "MESSAGES_UPSERT" and raw["data"] == data and raw["processed"] is False
        assert await db.wa_messages.count_documents({}) == 0     # W2 ingests; W1 only keeps it
    _run(go())


def test_the_old_unauthenticated_webhook_is_gone():
    import routes.whatsapp_routes as old
    assert not [r for r in old.router.routes if getattr(r, "path", "").startswith("/webhooks/whatsapp")]
```

**2. Run — expect failure** (`ModuleNotFoundError: routes.wa_routes`).

```bash
cd backend && DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 python -m pytest tests/test_wa_webhook.py -q
```

**3. Implement** — create `backend/routes/wa_routes.py`:

```python
"""WhatsApp team numbers (spec 2026-09-24, W1): the per-instance webhook (this block) and the
/wa routes for "My WhatsApp" and Settings → WhatsApp (appended in Task 7)."""
import hmac
import logging
import os
import re
import uuid
from datetime import timedelta

from fastapi import APIRouter, HTTPException, Request

from auth_utils import get_current_user
from database import db
from rbac import get_team
from services import wa_send
from services.evolution_client import EvolutionError, evolution, instance_token

router = APIRouter()
log = logging.getLogger("wa_routes")


def _now_iso() -> str:
    return wa_send._iso(wa_send._now())


# ══ Webhook ═══════════════════════════════════════════════════════════════════

_STATUS_RANK = {"queued": 0, "sending": 0, "sent": 1, "delivered": 2, "read": 3}
_ACK_BY_INT = {0: "ERROR", 1: "PENDING", 2: "SERVER_ACK", 3: "DELIVERY_ACK", 4: "READ", 5: "PLAYED"}
_ACK_TO_STATUS = {"SERVER_ACK": "sent", "DELIVERY_ACK": "delivered", "READ": "read", "PLAYED": "read",
                  "ERROR": "failed"}
_TERMINAL_CLOSE = {
    401: "WhatsApp logged this number out (unlinked from the phone, or banned).",
    403: "WhatsApp refused this number (it may be banned).",
    440: "This number was opened on another device and this session was replaced.",
}


def _event_name(raw) -> str:
    return str(raw or "").strip().upper().replace(".", "_")


@router.post("/webhooks/whatsapp/{instance}")
async def wa_instance_webhook(instance: str, request: Request, t: str = ""):
    """Evolution → us, one URL per instance (set by EvolutionClient.set_webhook).

    The shared secret is checked BEFORE the body is read, and an unset secret refuses
    everything (never an open door). `payload.instance` is never trusted over the path."""
    secret = os.getenv("WA_WEBHOOK_SECRET", "")
    if not secret or not hmac.compare_digest(str(t or "").encode(), secret.encode()):
        raise HTTPException(status_code=401, detail="bad webhook secret")
    try:
        payload = await request.json()
    except Exception:
        return {"ok": True, "ignored": "bad_json"}
    if not isinstance(payload, dict):
        return {"ok": True, "ignored": "bad_json"}
    claimed = payload.get("instance")
    if claimed and claimed != instance:
        raise HTTPException(status_code=401, detail="instance mismatch")
    inst = await db.wa_instances.find_one({"instance_name": instance}, {"_id": 0})
    if not inst:
        # Acknowledge so Evolution stops retrying; write nothing (RF1).
        log.warning("[wa-webhook] event for unknown instance %r ignored", instance[:60])
        return {"ok": True, "ignored": "unknown_instance"}
    event = _event_name(payload.get("event"))
    await db.wa_instances.update_one({"instance_name": instance}, {"$set": {"last_seen_at": _now_iso()}})
    handler = _HANDLERS.get(event)
    if not handler:
        return {"ok": True, "ignored": event or "no_event"}
    await handler(inst, payload.get("data"))
    return {"ok": True}


async def _on_connection_update(inst: dict, data) -> None:
    data = data if isinstance(data, dict) else {}
    state = str(data.get("state") or "").lower()
    name = inst["instance_name"]
    now = _now_iso()
    if state == "open":
        jid = str(data.get("wuid") or "")
        if not jid:
            try:
                jid = str((await evolution.fetch_instance(name)).get("ownerJid") or "")
            except Exception as e:
                log.warning("[wa-webhook] could not read the owner of %s: %s", name, str(e)[:120])
        phone = jid.split("@")[0].split(":")[0]
        if phone:
            clash = await db.wa_instances.find_one(
                {"phone_e164": phone, "instance_name": {"$ne": name},
                 "state": {"$in": ["connected", "paused", "disconnected"]}}, {"_id": 0})
            if clash:                                                    # RF2: one SIM, one instance
                try:
                    await evolution.logout(name, token=inst.get("instance_token") or None)
                except Exception as e:
                    log.warning("[wa-webhook] logout of duplicate %s failed: %s", name, str(e)[:120])
                other = clash.get("label") or clash["instance_name"]
                await db.wa_instances.update_one({"instance_name": name}, {"$set": {
                    "state": "unlinked", "state_at": now, "qr_base64": "",
                    "paused_reason": f"+{phone} is already linked as {other}. Link a different company SIM."}})
                await wa_send.alert(
                    db, emails=[inst.get("owner_email"), clash.get("owner_email")] + await wa_send.admin_emails(db),
                    title="WhatsApp number already linked",
                    body=(f"+{phone} was scanned on {inst.get('label') or name}, but it is already linked as "
                          f"{other}. The new link was undone — one number can be linked only once."),
                    dedup_key=f"wa_dup:{name}:{phone}", ref_id=name)
                return
        sets = {"state": "paused" if inst.get("state") == "paused" else "connected", "state_at": now,
                "qr_base64": "", "evolution_state": "open"}
        if phone:
            sets.update({"phone_e164": phone, "jid": f"{phone}@s.whatsapp.net"})
            if phone != inst.get("phone_e164") or not inst.get("warmup_started_at"):
                sets["warmup_started_at"] = now          # a new SIM starts its own warm-up (D5)
        await db.wa_instances.update_one({"instance_name": name}, {"$set": sets})
        return

    if state == "close":
        if inst.get("state") == "unlinked":
            return
        raw = str(data.get("statusReason") or "0")
        code = int(raw) if raw.isdigit() else 0
        terminal = code in _TERMINAL_CLOSE
        sets = {"state": "paused" if (terminal or inst.get("state") == "paused") else "disconnected",
                "state_at": now, "evolution_state": "close"}
        if terminal:
            sets["paused_reason"] = _TERMINAL_CLOSE[code]
        await db.wa_instances.update_one({"instance_name": name}, {"$set": sets})
        if inst.get("state") in ("connected", "paused") or terminal:
            company = inst.get("kind") == "company"
            title = "Company WhatsApp disconnected" if company else "A WhatsApp number disconnected"
            body = (("The company WhatsApp number" if company
                     else f"{inst.get('label') or inst.get('owner_email') or name}'s WhatsApp number")
                    + f" (+{inst.get('phone_e164') or '?'}) disconnected"
                    + (f": {_TERMINAL_CLOSE[code]}" if terminal else ".")
                    + (" Messages for unowned records are held until it is relinked." if company
                       else " Its messages go from the company number until it is relinked on My WhatsApp."))
            await wa_send.alert(db, emails=([] if company else [inst.get("owner_email")]) + await wa_send.admin_emails(db),
                                title=title, body=body,
                                dedup_key=f"wa_close:{name}:{wa_send.ist_day(wa_send._now())}", ref_id=name)
        return

    # "connecting": Baileys is dialling — not a state change for us.
    await db.wa_instances.update_one({"instance_name": name}, {"$set": {"evolution_state": state or "unknown"}})


async def _on_qrcode_updated(inst: dict, data) -> None:
    data = data if isinstance(data, dict) else {}
    qr = data.get("qrcode") if isinstance(data.get("qrcode"), dict) else data
    b64 = str(qr.get("base64") or "")
    if not b64:
        return
    now = _now_iso()
    sets = {"qr_base64": b64, "qr_at": now}
    if inst.get("state") not in ("connected", "paused"):
        sets.update({"state": "qr", "state_at": now})
    await db.wa_instances.update_one({"instance_name": inst["instance_name"]}, {"$set": sets})


def _ack_status(raw) -> str:
    if isinstance(raw, int) or (isinstance(raw, str) and raw.isdigit()):
        raw = _ACK_BY_INT.get(int(raw), "")
    return _ACK_TO_STATUS.get(str(raw or "").upper(), "")


async def _on_messages_update(inst: dict, data) -> None:
    items = data if isinstance(data, list) else ([data] if isinstance(data, dict) else [])
    name = inst["instance_name"]
    now = _now_iso()
    for item in items:
        if not isinstance(item, dict):
            continue
        # 2.3.x: {keyId, status}; older: {key: {id}, update: {status}}. `messageId` is
        # Evolution's own DB id, not WhatsApp's — never used as the key.
        pmid = str(item.get("keyId") or (item.get("key") or {}).get("id") or "")
        raw = item.get("status") if item.get("status") is not None else (item.get("update") or {}).get("status")
        new = _ack_status(raw)
        if not pmid or not new:
            continue
        row = await db.wa_messages.find_one({"instance_name": name, "provider_msg_id": pmid},
                                            {"_id": 0, "status": 1, "message_id": 1})
        if row:
            cur = row.get("status")
            forward = ((new == "failed" and cur in ("queued", "sending", "sent"))
                       or _STATUS_RANK.get(new, -1) > _STATUS_RANK.get(cur, -1))
            if forward:
                await db.wa_messages.update_one({"message_id": row["message_id"]}, {
                    "$set": {"status": new},
                    "$push": {"status_history": {"status": new, "at": now, "reason": "receipt"}}})
        # Campaign rows sent before W1 carry the provider id on whatsapp_scheduled.
        await db.whatsapp_scheduled.update_many({"wa_message_id": pmid},
                                                {"$set": {"status": new, "updated_at": now}})


def _text_of(message) -> str:
    m = message if isinstance(message, dict) else {}
    return str(m.get("conversation")
               or (m.get("extendedTextMessage") or {}).get("text")
               or (m.get("imageMessage") or {}).get("caption")
               or (m.get("videoMessage") or {}).get("caption")
               or (m.get("documentMessage") or {}).get("caption") or "")


async def _on_send_message(inst: dict, data) -> None:
    """A message this number sent. Our own API sends already have their row (wa_send._finish
    replaces this placeholder if the webhook wins the race); a message typed on the phone gets
    one `source: "phone"` row, keyed by provider id (D9). W2 fills contact/lead/school."""
    d = data if isinstance(data, dict) else {}
    key = d.get("key") or {}
    pmid = str(key.get("id") or "")
    if not pmid:
        return
    name = inst["instance_name"]
    if await db.wa_messages.find_one({"instance_name": name, "provider_msg_id": pmid}, {"_id": 1}):
        return
    remote = str(key.get("remoteJid") or "")
    now = wa_send._now()
    await db.wa_messages.update_one({"instance_name": name, "provider_msg_id": pmid}, {"$setOnInsert": {
        "message_id": f"wam_{uuid.uuid4().hex[:16]}", "instance_name": name, "provider_msg_id": pmid,
        "chat_id": f"{name}:{remote}", "direction": "out", "from_jid": inst.get("jid") or "",
        "to_jid": remote, "to_e164": remote.split("@")[0] if remote.endswith("@s.whatsapp.net") else "",
        "contact_id": "", "lead_id": "", "school_id": "", "kind": "chat", "ref": {},
        "text": _text_of(d.get("message")), "media": None, "quoted_provider_msg_id": None,
        "typed_by": None, "owner_email": inst.get("owner_email") or "",
        "sent_via_owner_email": inst.get("owner_email") or "", "sender_kind": inst.get("kind") or "",
        "provider": "evolution", "status": "sent",
        "status_history": [{"status": "sent", "at": wa_send._iso(now), "reason": "sent from the phone"}],
        "fail_reason": "", "source": "phone", "created_at": wa_send._iso(now), "sent_at": wa_send._iso(now),
        "sent_day": wa_send.ist_day(now), "provider_ts": d.get("messageTimestamp")}}, upsert=True)


async def _on_messages_upsert(inst: dict, data) -> None:
    """W1 STUB. Inbound messages are only KEPT here, raw, for W2's ingest (spec W2 "Ingest"),
    which replaces this handler in _HANDLERS and back-fills from wa_events_raw."""
    await db.wa_events_raw.insert_one({"instance_name": inst["instance_name"], "event": "MESSAGES_UPSERT",
                                       "data": data, "received_at": _now_iso(), "processed": False})


_HANDLERS = {
    "CONNECTION_UPDATE": _on_connection_update,
    "QRCODE_UPDATED": _on_qrcode_updated,
    "MESSAGES_UPDATE": _on_messages_update,
    "SEND_MESSAGE": _on_send_message,
    "MESSAGES_UPSERT": _on_messages_upsert,
}
```

In `backend/routes/whatsapp_routes.py` delete the whole block from the comment
`# ── Evolution API webhook (no auth — called by Evolution API server) ───────────` (`:948`) through the end of `wa_webhook`
(`:992`). `JSONResponse` (`:2`) is then unused — remove it from the import if `grep -n JSONResponse` shows no other use.

In `backend/main.py` add next to the other route imports (after `:59`):

```python
from routes.wa_routes import router as wa_router
```

and register it **before** `whatsapp_router` (insert above `:112`):

```python
app.include_router(wa_router, prefix="/api")
```

**4. Run — expect pass.**

```bash
cd backend && DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 python -m pytest tests/test_wa_webhook.py tests/test_wa_send.py -q
cd backend && python -c "import main; print([r.path for r in main.app.routes if 'webhooks/whatsapp' in getattr(r, 'path', '')])"
```

Expected second line: `['/api/webhooks/whatsapp/{instance}']`.

**5. Commit**

```bash
git add backend/routes/wa_routes.py backend/routes/whatsapp_routes.py backend/main.py
git add -f backend/tests/test_wa_webhook.py
git commit -m "feat(wa): secret-checked per-instance webhook - connection, QR, receipts, phone-sent messages; raw inbound kept for W2

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 7 — Routes: `/wa/me*`, admin `/wa/instances*`, `/wa/settings`, `/whatsapp/proxy-config`; remove the old instance routes

### Files

| Action | Path | Current refs |
|---|---|---|
| modify | `backend/routes/wa_routes.py` | from Task 6 — append the route block |
| modify | `backend/services/wa_config.py` | add `RAM_HEADROOM_MIN_MB = 500` |
| modify | `backend/routes/whatsapp_routes.py` | delete `:717-890` (`/whatsapp/instance/create`, `/qr`, `/logout`, `/whatsapp/instances*` ×5, `/whatsapp/proxy/{name}` GET/POST); replace `/whatsapp/instance/status` (`:746-755`) with a read-only company-state route |
| create | `backend/tests/test_wa_routes.py` | new |

RBAC reference: the admin test used everywhere else — `crm_routes._is_admin` (`crm_routes.py:8320-8321`):
`get_team(user) == "admin" or user.get("role") == "admin"`; `get_team` is `rbac.py:58`.

### Interfaces

**Produces** (all under `/api`, all `get_current_user`-authenticated)

| Route | Who | Request | Response |
|---|---|---|---|
| `GET /wa/me` | any staff user | – | unlinked: `{linked:false, state:"unlinked", notice, slots_full, paused_reason}`; linked: `{linked:true, instance_name, kind, state, phone_e164, state_at, last_seen_at, paused_reason, warmup:{day, of, today_sent, today_cap}, daily_cap_override, proxy:{host,port,protocol,username,has_password}, notice_accepted_at, notice, looks_personal, qr_base64?}` (`qr_base64` only in state `qr`, refreshed from Evolution when older than 20 s) |
| `POST /wa/me/link` | any staff user | `{notice_accepted: true, label?}` | `{instance_name: "rep_<user_id>", state: "qr", qr_base64}`; 400 no notice; 409 already linked / slots full; 500 secret unset; 502 Evolution |
| `POST /wa/me/relink` | own number | – | `{instance_name, state:"qr", qr_base64}`; 409 when an admin paused it |
| `POST /wa/me/unlink` | own number | – | `{instance_name, state:"unlinked"}` |
| `GET /wa/instances` | admin | – | `{instances:[view + owner_name], max_instances, used, company_instance, health:{mem_available_mb, mem_total_mb, evolution_mem_mb, at, headroom_ok, min_headroom_mb}, settings}` |
| `POST /wa/instances/company` | admin | `{notice_accepted: true}` | adopts an already-open company instance → `{instance_name, state:"connected", phone_e164}`; else as link |
| `POST /wa/instances/{name}/pause` | admin | `{reason?}` | `{instance_name, state:"paused"}` |
| `POST /wa/instances/{name}/resume` | admin | – | `{instance_name, state:"connected"\|"disconnected"}` (failure streak reset) |
| `POST /wa/instances/{name}/unlink` | admin | – | `{instance_name, state:"unlinked"}` |
| `PUT /wa/instances/{name}/proxy` | admin | `{host, port, protocol, username, password?}` (blank password keeps the saved one; blank host disables) | `{instance_name, proxy (masked)}` |
| `PUT /wa/instances/{name}` | admin | `{label?, daily_cap_override?: int\|null}` | view |
| `GET /wa/settings` / `PUT /wa/settings` | admin | `WA_DEFAULTS` keys | merged settings; 400 `WaSettingsError` text |
| `GET /whatsapp/proxy-config` / `POST /whatsapp/proxy-config` | admin | `{enabled, host, port, protocol, username, password?}` | `{enabled, host, port, protocol, username, has_password}` — the default proxy applied to a newly linked number (the route the old Settings form called and that 404'd on main) |
| `GET /whatsapp/instance/status` (kept, rewritten) | any staff user | – | `{state: "open"\|"connecting"\|"close", connected, instance}` from the company row (MarketingHub's badge) |

"Admin" = `get_team(user) == "admin" or user.get("role") == "admin"` — the owner's account (`role: "admin"`, no
`module_permissions`) passes. A rep reaches only their own number through `/wa/me*`; every `/wa/instances*`,
`/wa/settings`, `/whatsapp/proxy-config` call from a non-admin is 403.

**Removed:** `POST /whatsapp/instance/create`, `GET /whatsapp/instance/qr`, `DELETE /whatsapp/instance/logout`,
`GET /whatsapp/instances`, `POST|DELETE /whatsapp/instances/{name}`, `GET /whatsapp/instances/{name}/qr|status`,
`GET|POST /whatsapp/proxy/{name}` — each let any logged-in user create, delete or log out any number (spec problem 7).

**Consumes:** `wa_send.daily_cap`, `warmup_day`, `ist_day`, `_now`, `_iso`, `_parse` (Tasks 4–5); `wa_config.*` (Task 3);
`evolution.create_instance / set_webhook / set_proxy / get_qr / connection_state / fetch_instance / logout`, `instance_token`,
`EvolutionError` (Task 2); `settings{type:"wa_health"}` (written by Task 8's host script).

### Steps

**1. Failing test** — `backend/tests/test_wa_routes.py`:

```python
"""/wa routes: a rep links and manages only their own number; admins manage every number, the
caps and the default proxy; the owner (role admin, no module_permissions) always passes.

Run:
    DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 \
    python -m pytest tests/test_wa_routes.py -q
"""
import asyncio
import os
from datetime import timedelta

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest
from fastapi import HTTPException

import routes.wa_routes as wr
import routes.whatsapp_routes as old
from services.wa_send import send_whatsapp
from wa_fixtures import COMPANY, seed_instance, seed_user, seed_wa

OWNER = {"email": "info@smartshape.in", "name": "Owner", "role": "admin"}          # no module_permissions
MULTI_ADMIN = {"email": "ops@smartshape.in", "name": "Ops", "role": "sales_person", "roles": ["sales_person", "admin"]}
PARUL = {"email": "parul@smartshape.in", "name": "Parul", "role": "sales_person", "user_id": "user_parul",
         "module_permissions": {"leads": {"level": "read_write", "scope": "own"}}}
KALPANA = {"email": "kalpana@smartshape.in", "name": "Kalpana", "role": "sales_person", "user_id": "user_kalpana"}


class FakeRequest:
    def __init__(self, body=None):
        self._body = body or {}
        self.query_params = {}

    async def json(self):
        return self._body


@pytest.fixture()
def env(wa_env, monkeypatch):
    monkeypatch.setattr(wr, "db", wa_env.db)
    monkeypatch.setattr(old, "db", wa_env.db)
    monkeypatch.setenv("WA_WEBHOOK_SECRET", "s3cret")
    return wa_env


def _as(user, monkeypatch):
    async def _me(_request):
        return user
    monkeypatch.setattr(wr, "get_current_user", _me)
    monkeypatch.setattr(old, "get_current_user", _me)


def _run(coro):
    return asyncio.run(coro)


def _status(coro):
    with pytest.raises(HTTPException) as e:
        _run(coro)
    return e.value.status_code


# ── My WhatsApp ──────────────────────────────────────────────────────────────

def test_wa_me_unlinked_shows_the_notice(env, monkeypatch):
    _as(PARUL, monkeypatch)
    out = _run(wr.wa_me(FakeRequest()))
    assert out["linked"] is False and out["state"] == "unlinked"
    assert out["notice"].startswith("Every message this number sends or receives is visible to managers")


def test_link_requires_the_notice(env, monkeypatch):
    _as(PARUL, monkeypatch)
    assert _status(wr.wa_me_link(FakeRequest({}))) == 400
    assert env.evo.calls == []


def test_link_refuses_without_a_webhook_secret(env, monkeypatch):
    _as(PARUL, monkeypatch)
    monkeypatch.delenv("WA_WEBHOOK_SECRET")
    assert _status(wr.wa_me_link(FakeRequest({"notice_accepted": True}))) == 500


def test_rep_link_creates_the_instance_sets_webhook_and_default_proxy_and_returns_qr(env, monkeypatch):
    db = env.db
    _as(PARUL, monkeypatch)

    async def go():
        await seed_user(db, PARUL["email"], user_id="user_parul")
        await db.settings.insert_one({"type": "wa_proxy_default", "enabled": True, "host": "gate.decodo.com",
                                      "port": 10001, "protocol": "socks5", "username": "u", "password": "p"})
        out = await wr.wa_me_link(FakeRequest({"notice_accepted": True}))
        assert out == {"instance_name": "rep_user_parul", "state": "qr", "qr_base64": "data:image/png;base64,QR"}
        paths = [c["path"] for c in env.evo.calls]
        assert paths == ["/instance/create", "/webhook/set/rep_user_parul", "/proxy/set/rep_user_parul",
                         "/instance/connect/rep_user_parul"]
        hook = env.evo.calls[1]["json"]["webhook"]
        assert hook["url"].endswith("/api/webhooks/whatsapp/rep_user_parul?t=s3cret")
        assert env.evo.calls[2]["json"]["host"] == "gate.decodo.com"
        inst = await db.wa_instances.find_one({"instance_name": "rep_user_parul"}, {"_id": 0})
        assert inst["kind"] == "rep" and inst["owner_email"] == PARUL["email"] and inst["state"] == "qr"
        assert inst["instance_token"] == "tok_rep_user_parul" and inst["notice_accepted_at"]
        assert (await db.users.find_one({"email": PARUL["email"]}))["wa_instance_name"] == "rep_user_parul"
    _run(go())


def test_link_reuses_an_evolution_instance_that_already_exists(env, monkeypatch):
    _as(PARUL, monkeypatch)
    env.evo.create_status = 403                                  # "This name is already in use."
    out = _run(wr.wa_me_link(FakeRequest({"notice_accepted": True})))
    assert out["state"] == "qr"


def test_capacity_counts_the_company_and_unlinked_numbers_free_their_slot(env, monkeypatch):
    db = env.db
    _as(PARUL, monkeypatch)

    async def go():
        await seed_wa(db, reps={KALPANA["email"]: "connected"}, settings={"max_instances": 2})
        with pytest.raises(HTTPException) as e:
            await wr.wa_me_link(FakeRequest({"notice_accepted": True}))
        assert e.value.status_code == 409 and "2 WhatsApp slots" in e.value.detail
        await db.wa_instances.update_one({"instance_name": "rep_kalpana"}, {"$set": {"state": "unlinked"}})
        assert (await wr.wa_me_link(FakeRequest({"notice_accepted": True})))["state"] == "qr"
    _run(go())


def test_wa_me_shows_warmup_today_and_refreshes_a_stale_qr(env, monkeypatch):
    db = env.db
    _as(PARUL, monkeypatch)

    async def go():
        now = env.clock["now"]
        await seed_instance(db, "rep_parul", owner_email=PARUL["email"], state="connected",
                            phone="919000000111", warmup_started_at=(now - timedelta(days=3)).isoformat())
        await send_whatsapp(db, to="9811111111", text="x", kind="chat", channel="rep_parul", typed_by=PARUL["email"])
        out = await wr.wa_me(FakeRequest())
        assert out["warmup"] == {"day": 4, "of": 14, "today_sent": 1, "today_cap": 40}
        await db.wa_instances.update_one({"instance_name": "rep_parul"}, {"$set": {
            "state": "qr", "qr_base64": "OLD", "qr_at": (now - timedelta(seconds=30)).isoformat()}})
        out = await wr.wa_me(FakeRequest())
        assert out["qr_base64"] == "data:image/png;base64,QR"
    _run(go())


def test_wa_me_warns_when_the_number_looks_personal(env, monkeypatch):
    db = env.db
    _as(PARUL, monkeypatch)

    async def go():
        await seed_user(db, PARUL["email"], phone="98111 11111")
        await seed_instance(db, "rep_parul", owner_email=PARUL["email"], phone="919811111111")
        assert (await wr.wa_me(FakeRequest()))["looks_personal"] is True
    _run(go())


def test_a_rep_relinks_and_unlinks_only_their_own_number(env, monkeypatch):
    db = env.db
    _as(PARUL, monkeypatch)

    async def go():
        await seed_instance(db, "rep_parul", owner_email=PARUL["email"], phone="919000000111")
        await seed_instance(db, "rep_kalpana", owner_email=KALPANA["email"], phone="919000000112")
        assert (await wr.wa_me_relink(FakeRequest()))["state"] == "qr"
        assert (await wr.wa_me_unlink(FakeRequest()))["state"] == "unlinked"
        logouts = [c["path"] for c in env.evo.calls if c["path"].startswith("/instance/logout/")]
        assert logouts == ["/instance/logout/rep_parul", "/instance/logout/rep_parul"]
        assert (await db.wa_instances.find_one({"instance_name": "rep_kalpana"}))["state"] == "connected"
    _run(go())


def test_a_rep_cannot_relink_past_an_admin_pause(env, monkeypatch):
    db = env.db
    _as(PARUL, monkeypatch)

    async def go():
        await seed_instance(db, "rep_parul", owner_email=PARUL["email"], state="paused", paused_by=OWNER["email"])
        with pytest.raises(HTTPException) as e:
            await wr.wa_me_relink(FakeRequest())
        assert e.value.status_code == 409
    _run(go())


# ── Admin gate ───────────────────────────────────────────────────────────────

def test_a_rep_is_refused_every_admin_route(env, monkeypatch):
    _as(PARUL, monkeypatch)
    calls = [
        wr.wa_instances_list(FakeRequest()),
        wr.wa_link_company(FakeRequest({"notice_accepted": True})),
        wr.wa_instance_pause("rep_kalpana", FakeRequest()),
        wr.wa_instance_resume("rep_kalpana", FakeRequest()),
        wr.wa_instance_unlink("rep_kalpana", FakeRequest()),
        wr.wa_instance_proxy("rep_kalpana", FakeRequest({"host": "h", "port": 1})),
        wr.wa_instance_update("rep_kalpana", FakeRequest({"daily_cap_override": 500})),
        wr.wa_settings_get(FakeRequest()),
        wr.wa_settings_put(FakeRequest({"hourly_cap": 500})),
        wr.wa_proxy_config_get(FakeRequest()),
        wr.wa_proxy_config_save(FakeRequest({"host": "h", "port": 1})),
    ]
    for c in calls:
        assert _status(c) == 403


@pytest.mark.parametrize("user", [OWNER, MULTI_ADMIN])
def test_the_owner_and_a_multi_role_admin_pass(env, monkeypatch, user):
    _as(user, monkeypatch)
    out = _run(wr.wa_instances_list(FakeRequest()))
    assert out["max_instances"] == 4 and out["instances"] == []


def test_admin_list_shows_numbers_ram_and_capacity(env, monkeypatch):
    db = env.db
    _as(OWNER, monkeypatch)

    async def go():
        await seed_user(db, PARUL["email"])
        await seed_wa(db, reps={PARUL["email"]: "connected"})
        await db.settings.insert_one({"type": "wa_health", "mem_available_mb": 420, "mem_total_mb": 3900,
                                      "evolution_mem_mb": 900, "at": env.clock["now"].isoformat()})
        out = await wr.wa_instances_list(FakeRequest())
        assert out["used"] == 2 and out["company_instance"] == COMPANY
        assert {i["instance_name"] for i in out["instances"]} == {COMPANY, "rep_parul"}
        assert out["health"]["headroom_ok"] is False and out["health"]["min_headroom_mb"] == 500
        assert "instance_token" not in out["instances"][0]
    _run(go())


def test_pause_routes_around_the_number_and_resume_resets_the_streak(env, monkeypatch):
    db = env.db
    _as(OWNER, monkeypatch)

    async def go():
        await seed_wa(db, reps={PARUL["email"]: "connected"})
        await db.wa_instances.update_one({"instance_name": "rep_parul"}, {"$set": {"consecutive_failures": 3}})
        await wr.wa_instance_pause("rep_parul", FakeRequest({"reason": "Complaint from a school"}))
        res = await send_whatsapp(db, to="9811111111", text="x", kind="dispatch", owner_email=PARUL["email"])
        assert res["instance_name"] == COMPANY
        env.evo.state["rep_parul"] = "open"
        assert (await wr.wa_instance_resume("rep_parul", FakeRequest()))["state"] == "connected"
        inst = await db.wa_instances.find_one({"instance_name": "rep_parul"}, {"_id": 0})
        assert inst["consecutive_failures"] == 0 and inst["paused_reason"] == ""
    _run(go())


def test_proxy_update_keeps_the_saved_password_when_blank(env, monkeypatch):
    db = env.db
    _as(OWNER, monkeypatch)

    async def go():
        await seed_instance(db, "rep_parul", owner_email=PARUL["email"],
                            proxy={"host": "old", "port": 1, "protocol": "socks5", "username": "u", "password": "keep"})
        out = await wr.wa_instance_proxy("rep_parul", FakeRequest({"host": "gate.decodo.com", "port": "10001",
                                                                   "protocol": "socks5", "username": "u2", "password": ""}))
        assert out["proxy"] == {"host": "gate.decodo.com", "port": 10001, "protocol": "socks5",
                                "username": "u2", "has_password": True}
        assert env.evo.calls[-1]["json"]["password"] == "keep"
        with pytest.raises(HTTPException):
            await wr.wa_instance_proxy("rep_parul", FakeRequest({"host": "h", "port": "99999"}))
    _run(go())


def test_daily_cap_override_can_be_set_and_cleared(env, monkeypatch):
    db = env.db
    _as(OWNER, monkeypatch)

    async def go():
        await seed_wa(db)
        v = await wr.wa_instance_update(COMPANY, FakeRequest({"daily_cap_override": 150, "label": "Company"}))
        assert v["daily_cap_override"] == 150 and v["warmup"]["today_cap"] == 150
        v = await wr.wa_instance_update(COMPANY, FakeRequest({"daily_cap_override": None}))
        assert v["daily_cap_override"] is None
    _run(go())


def test_settings_put_validates_and_saves(env, monkeypatch):
    _as(OWNER, monkeypatch)
    assert _status(wr.wa_settings_put(FakeRequest({"hourly_cap": 0}))) == 400
    out = _run(wr.wa_settings_put(FakeRequest({"hourly_cap": 20, "fallback_provider": "autosender"})))
    assert out["hourly_cap"] == 20 and out["fallback_provider"] == "autosender"
    assert _run(wr.wa_settings_get(FakeRequest()))["hourly_cap"] == 20


def test_proxy_config_saves_and_masks_the_password(env, monkeypatch):
    _as(OWNER, monkeypatch)
    out = _run(wr.wa_proxy_config_save(FakeRequest({"enabled": True, "host": "gate.decodo.com", "port": 10001,
                                                    "protocol": "socks5", "username": "u", "password": "p"})))
    assert out == {"enabled": True, "host": "gate.decodo.com", "port": 10001, "protocol": "socks5",
                   "username": "u", "has_password": True}
    assert "password" not in _run(wr.wa_proxy_config_get(FakeRequest()))


def test_company_link_adopts_an_instance_that_is_already_open(env, monkeypatch):
    db = env.db
    _as(OWNER, monkeypatch)
    env.evo.state[COMPANY] = "open"
    env.evo.owner_jid[COMPANY] = "919818950815@s.whatsapp.net"

    async def go():
        out = await wr.wa_link_company(FakeRequest({"notice_accepted": True}))
        assert out == {"instance_name": COMPANY, "state": "connected", "phone_e164": "919818950815"}
        assert not any(c["path"] == "/instance/create" for c in env.evo.calls)
        assert any(c["path"] == f"/webhook/set/{COMPANY}" for c in env.evo.calls)
        inst = await db.wa_instances.find_one({"instance_name": COMPANY}, {"_id": 0})
        assert inst["kind"] == "company" and inst["state"] == "connected"
    _run(go())


# ── Old routes ───────────────────────────────────────────────────────────────

def test_the_old_admin_agnostic_instance_routes_are_gone():
    paths = {(getattr(r, "path", ""), tuple(sorted(getattr(r, "methods", []) or []))) for r in old.router.routes}
    flat = {p for p, _ in paths}
    assert not [p for p in flat if p.startswith("/whatsapp/instances") or p.startswith("/whatsapp/proxy/")]
    for gone in ("/whatsapp/instance/create", "/whatsapp/instance/qr", "/whatsapp/instance/logout"):
        assert gone not in flat
    assert "/whatsapp/instance/status" in flat


def test_legacy_status_reads_the_company_row(env, monkeypatch):
    db = env.db
    _as(PARUL, monkeypatch)

    async def go():
        await seed_wa(db)
        assert await old.wa_instance_status(FakeRequest()) == {"state": "open", "connected": True,
                                                               "instance": COMPANY}
    _run(go())
```

**2. Run — expect failure** (`AttributeError: module 'routes.wa_routes' has no attribute 'wa_me'`).

```bash
cd backend && DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 python -m pytest tests/test_wa_routes.py -q
```

**3. Implement.**

(a) `backend/services/wa_config.py` — add below `INSTANCE_STATES`:

```python
# D7: below this much free server memory, do not link another number (admin page + health alert).
RAM_HEADROOM_MIN_MB = 500
```

(b) `backend/routes/wa_routes.py` — extend the import block:

```python
from services.wa_config import (COMPANY_INSTANCE, PRIVACY_NOTICE, RAM_HEADROOM_MIN_MB, WaSettingsError,
                                get_wa_settings, rep_instance_name, save_wa_settings)
```

and append:

```python
# ══ /wa routes ════════════════════════════════════════════════════════════════

QR_REFRESH_SECONDS = 20
_PROXY_PROTOCOLS = ("http", "https", "socks4", "socks5")


def _is_admin(user: dict) -> bool:
    # The same admin test used everywhere else (crm_routes._is_admin): the owner's account
    # (role "admin", no module_permissions) always passes.
    return get_team(user) == "admin" or user.get("role") == "admin"


def _require_admin(user: dict) -> None:
    if not _is_admin(user):
        raise HTTPException(status_code=403, detail="Only an admin can manage WhatsApp numbers")


async def _body(request: Request) -> dict:
    try:
        b = await request.json()
    except Exception:
        b = {}
    return b if isinstance(b, dict) else {}


def _mask_proxy(p) -> dict:
    p = p or {}
    return {"host": p.get("host", ""), "port": p.get("port", ""), "protocol": p.get("protocol") or "socks5",
            "username": p.get("username", ""), "has_password": bool(p.get("password"))}


def _clean_proxy(body: dict, saved) -> dict:
    host = str(body.get("host") or "").strip()
    if not host:
        return {}
    proto = str(body.get("protocol") or "socks5").lower()
    if proto not in _PROXY_PROTOCOLS:
        raise HTTPException(400, "protocol must be http, https, socks4 or socks5")
    try:
        port = int(body.get("port"))
    except (TypeError, ValueError):
        port = 0
    if not 1 <= port <= 65535:
        raise HTTPException(400, "port must be a number from 1 to 65535")
    return {"host": host, "port": port, "protocol": proto, "username": str(body.get("username") or "").strip(),
            "password": str(body.get("password") or "") or (saved or {}).get("password", "")}


async def _my_instance(email: str):
    u = await db.users.find_one({"email": email}, {"_id": 0, "wa_instance_name": 1}) or {}
    if not u.get("wa_instance_name"):
        return None
    return await db.wa_instances.find_one({"instance_name": u["wa_instance_name"]}, {"_id": 0})


async def _instance_or_404(name: str) -> dict:
    inst = await db.wa_instances.find_one({"instance_name": name}, {"_id": 0})
    if not inst:
        raise HTTPException(404, "No such WhatsApp number")
    return inst


async def _used_slots() -> int:
    return await db.wa_instances.count_documents({"state": {"$ne": "unlinked"}})


async def _view(inst: dict, cfg: dict) -> dict:
    now = wa_send._now()
    led = await db.wa_send_ledger.find_one(
        {"instance_name": inst["instance_name"], "day": wa_send.ist_day(now)}, {"_id": 0}) or {}
    return {
        "instance_name": inst["instance_name"], "kind": inst.get("kind"), "owner_email": inst.get("owner_email") or "",
        "label": inst.get("label") or "", "phone_e164": inst.get("phone_e164") or "", "state": inst.get("state"),
        "state_at": inst.get("state_at"), "last_seen_at": inst.get("last_seen_at"),
        "paused_reason": inst.get("paused_reason") or "",
        "warmup": {"day": wa_send.warmup_day(inst, now), "of": int(cfg["warmup_days"]),
                   "today_sent": int(led.get("sent_count", 0)), "today_cap": wa_send.daily_cap(inst, cfg, now)},
        "daily_cap_override": inst.get("daily_cap_override"),
        "proxy": _mask_proxy(inst.get("proxy")),
        "notice_accepted_at": inst.get("notice_accepted_at"),
    }


async def _looks_personal(inst: dict, email: str) -> bool:
    """D1: warn (never block) when the linked number is the rep's own phone on their profile."""
    linked = (inst.get("phone_e164") or "")[-10:]
    if not linked:
        return False
    u = await db.users.find_one({"email": email}, {"_id": 0, "phone": 1, "calling_number": 1}) or {}
    mine = {re.sub(r"\D", "", str(u.get(k) or ""))[-10:] for k in ("phone", "calling_number")}
    return linked in mine


async def _fresh_qr(inst: dict) -> str:
    at = inst.get("qr_at")
    if inst.get("qr_base64") and at and wa_send._parse(at) > wa_send._now() - timedelta(seconds=QR_REFRESH_SECONDS):
        return inst["qr_base64"]
    try:
        qr = await evolution.get_qr(inst["instance_name"], token=inst.get("instance_token") or None)
    except Exception as e:
        log.warning("[wa] QR refresh for %s failed: %s", inst["instance_name"], str(e)[:120])
        return inst.get("qr_base64") or ""
    b64 = str((qr or {}).get("base64") or "")
    if b64:
        await db.wa_instances.update_one({"instance_name": inst["instance_name"]},
                                         {"$set": {"qr_base64": b64, "qr_at": _now_iso()}})
    return b64 or inst.get("qr_base64") or ""


async def _default_proxy() -> dict:
    d = await db.settings.find_one({"type": "wa_proxy_default"}, {"_id": 0}) or {}
    if not (d.get("enabled") and d.get("host")):
        return {}
    return {k: d.get(k, "") for k in ("host", "port", "protocol", "username", "password")}


async def _provision(name: str, *, kind: str, owner_email: str, label: str, accepted_by: str) -> dict:
    """Create (or reuse) the Evolution instance, point its webhook at us, apply its proxy, and
    return a QR to scan. The number becomes `connected` when CONNECTION_UPDATE: open arrives."""
    if not os.getenv("WA_WEBHOOK_SECRET"):
        raise HTTPException(500, "WA_WEBHOOK_SECRET is not set on the server, so replies and receipts "
                                 "would be refused. Finish the WhatsApp setup runbook first.")
    existing = await db.wa_instances.find_one({"instance_name": name}, {"_id": 0}) or {}
    token = existing.get("instance_token") or ""
    try:
        token = instance_token(await evolution.create_instance(name)) or token
    except EvolutionError as e:
        if e.status_code not in (403, 409):                 # 403/409 = the name already exists: reuse it
            raise HTTPException(502, f"The WhatsApp server refused to create the number: {e}")
    except Exception as e:
        raise HTTPException(502, f"The WhatsApp server is not answering: {str(e)[:120]}")
    proxy = existing.get("proxy") or {}
    if not proxy.get("host"):
        proxy = await _default_proxy()
    try:
        await evolution.set_webhook(name)
        if proxy.get("host"):
            await evolution.set_proxy(name, proxy)
        qr = await evolution.get_qr(name)
    except Exception as e:
        raise HTTPException(502, f"The WhatsApp server could not prepare the QR code: {str(e)[:120]}")
    now = _now_iso()
    await db.wa_instances.update_one({"instance_name": name}, {
        "$set": {"kind": kind, "owner_email": owner_email, "label": label, "state": "qr", "state_at": now,
                 "qr_base64": str(qr.get("base64") or ""), "qr_at": now, "instance_token": token,
                 "proxy": proxy, "paused_reason": "", "notice_accepted_at": now,
                 "notice_accepted_by": accepted_by},
        "$setOnInsert": {"instance_name": name, "phone_e164": "", "jid": "", "warmup_started_at": None,
                         "daily_cap_override": None, "consecutive_failures": 0, "last_seen_at": None,
                         "created_at": now}}, upsert=True)
    if kind == "rep":
        await db.users.update_one({"email": owner_email}, {"$set": {"wa_instance_name": name}})
    return {"instance_name": name, "state": "qr", "qr_base64": str(qr.get("base64") or "")}


async def _relink(inst: dict) -> dict:
    name, tok = inst["instance_name"], inst.get("instance_token") or None
    try:
        await evolution.logout(name, token=tok)
    except Exception:
        pass                                               # already logged out
    try:
        qr = await evolution.get_qr(name, token=tok)
    except Exception as e:
        raise HTTPException(502, f"The WhatsApp server could not prepare the QR code: {str(e)[:120]}")
    now = _now_iso()
    await db.wa_instances.update_one({"instance_name": name}, {"$set": {
        "state": "qr", "state_at": now, "qr_base64": str(qr.get("base64") or ""), "qr_at": now,
        "paused_reason": ""}})
    return {"instance_name": name, "state": "qr", "qr_base64": str(qr.get("base64") or "")}


async def _unlink(inst: dict, by: str) -> dict:
    name = inst["instance_name"]
    try:
        await evolution.logout(name, token=inst.get("instance_token") or None)
    except Exception:
        pass
    await db.wa_instances.update_one({"instance_name": name}, {"$set": {
        "state": "unlinked", "state_at": _now_iso(), "qr_base64": "", "paused_reason": "", "unlinked_by": by}})
    return {"instance_name": name, "state": "unlinked"}


# ── My WhatsApp ──────────────────────────────────────────────────────────────

@router.get("/wa/me")
async def wa_me(request: Request):
    user = await get_current_user(request)
    cfg = await get_wa_settings(db)
    inst = await _my_instance(user["email"])
    if not inst or inst.get("state") == "unlinked":
        return {"linked": False, "state": "unlinked", "notice": PRIVACY_NOTICE,
                "slots_full": await _used_slots() >= int(cfg["max_instances"]),
                "paused_reason": (inst or {}).get("paused_reason", "")}
    out = {"linked": True, **await _view(inst, cfg), "notice": PRIVACY_NOTICE,
           "looks_personal": await _looks_personal(inst, user["email"])}
    if inst.get("state") == "qr":
        out["qr_base64"] = await _fresh_qr(inst)
    return out


@router.post("/wa/me/link")
async def wa_me_link(request: Request):
    user = await get_current_user(request)
    body = await _body(request)
    if not body.get("notice_accepted"):
        raise HTTPException(400, "Read and accept the notice before linking a number.")
    cfg = await get_wa_settings(db)
    inst = await _my_instance(user["email"])
    if inst and inst.get("state") in ("connected", "paused"):
        raise HTTPException(409, "Your number is already linked. Use Relink to scan again.")
    if (not inst or inst.get("state") == "unlinked") and await _used_slots() >= int(cfg["max_instances"]):
        raise HTTPException(409, f"All {cfg['max_instances']} WhatsApp slots on this server are in use. "
                                 "Ask an admin — more numbers need a bigger server.")
    name = inst["instance_name"] if inst else rep_instance_name(user)
    return await _provision(name, kind="rep", owner_email=user["email"],
                            label=str(body.get("label") or user.get("name") or user["email"])[:60],
                            accepted_by=user["email"])


@router.post("/wa/me/relink")
async def wa_me_relink(request: Request):
    user = await get_current_user(request)
    inst = await _my_instance(user["email"])
    if not inst:
        raise HTTPException(404, "You have no linked number yet.")
    if inst.get("state") == "paused" and inst.get("paused_by") not in (None, "", "system"):
        raise HTTPException(409, "An admin paused this number. Ask them to resume it.")
    return await _relink(inst)


@router.post("/wa/me/unlink")
async def wa_me_unlink(request: Request):
    user = await get_current_user(request)
    inst = await _my_instance(user["email"])
    if not inst:
        raise HTTPException(404, "You have no linked number.")
    return await _unlink(inst, user["email"])


# ── Admin: every number ──────────────────────────────────────────────────────

@router.get("/wa/instances")
async def wa_instances_list(request: Request):
    user = await get_current_user(request)
    _require_admin(user)
    cfg = await get_wa_settings(db)
    rows = await db.wa_instances.find({}, {"_id": 0}).sort("created_at", 1).to_list(100)
    names = {u["email"]: u.get("name", "") async for u in db.users.find({}, {"_id": 0, "email": 1, "name": 1})}
    views = []
    for inst in rows:
        v = await _view(inst, cfg)
        v["owner_name"] = names.get(inst.get("owner_email") or "", "")
        views.append(v)
    health = await db.settings.find_one({"type": "wa_health"}, {"_id": 0}) or {}
    health.pop("type", None)
    avail = health.get("mem_available_mb")
    return {"instances": views, "max_instances": int(cfg["max_instances"]),
            "used": sum(1 for i in rows if i.get("state") != "unlinked"), "company_instance": COMPANY_INSTANCE,
            "health": {**health, "headroom_ok": avail is None or int(avail) >= RAM_HEADROOM_MIN_MB,
                       "min_headroom_mb": RAM_HEADROOM_MIN_MB},
            "settings": cfg}


@router.post("/wa/instances/company")
async def wa_link_company(request: Request):
    user = await get_current_user(request)
    _require_admin(user)
    body = await _body(request)
    if not body.get("notice_accepted"):
        raise HTTPException(400, "Read and accept the notice before linking a number.")
    cfg = await get_wa_settings(db)
    name = COMPANY_INSTANCE
    existing = await db.wa_instances.find_one({"instance_name": name}, {"_id": 0})
    if (not existing or existing.get("state") == "unlinked") and await _used_slots() >= int(cfg["max_instances"]):
        raise HTTPException(409, f"All {cfg['max_instances']} WhatsApp slots on this server are in use.")
    try:
        state = await evolution.connection_state(name)
    except Exception:
        state = "close"
    if state == "open":
        # The number linked before the upgrade survives it: adopt it, no new QR.
        try:
            jid = str((await evolution.fetch_instance(name)).get("ownerJid") or "")
        except Exception:
            jid = ""
        phone = jid.split("@")[0].split(":")[0]
        try:
            await evolution.set_webhook(name)
        except Exception as e:
            raise HTTPException(502, f"Could not point the company number's webhook at the app: {str(e)[:120]}")
        now = _now_iso()
        await db.wa_instances.update_one({"instance_name": name}, {
            "$set": {"kind": "company", "owner_email": "", "label": "Company", "state": "connected", "state_at": now,
                     "phone_e164": phone, "jid": f"{phone}@s.whatsapp.net" if phone else "", "qr_base64": "",
                     "paused_reason": "", "notice_accepted_at": now, "notice_accepted_by": user["email"]},
            "$setOnInsert": {"instance_name": name, "instance_token": "", "proxy": {}, "warmup_started_at": now,
                             "daily_cap_override": None, "consecutive_failures": 0, "created_at": now}},
            upsert=True)
        return {"instance_name": name, "state": "connected", "phone_e164": phone}
    return await _provision(name, kind="company", owner_email="", label="Company", accepted_by=user["email"])


@router.post("/wa/instances/{name}/pause")
async def wa_instance_pause(name: str, request: Request):
    user = await get_current_user(request)
    _require_admin(user)
    inst = await _instance_or_404(name)
    reason = str((await _body(request)).get("reason") or f"Paused by {user.get('name') or user['email']}")[:200]
    await db.wa_instances.update_one({"instance_name": name}, {"$set": {
        "state": "paused", "state_at": _now_iso(), "paused_reason": reason, "paused_by": user["email"]}})
    return {"instance_name": inst["instance_name"], "state": "paused"}


@router.post("/wa/instances/{name}/resume")
async def wa_instance_resume(name: str, request: Request):
    user = await get_current_user(request)
    _require_admin(user)
    inst = await _instance_or_404(name)
    try:
        st = await evolution.connection_state(name, token=inst.get("instance_token") or None)
    except Exception:
        st = "close"
    new = "connected" if st == "open" else "disconnected"
    await db.wa_instances.update_one({"instance_name": name}, {"$set": {
        "state": new, "state_at": _now_iso(), "consecutive_failures": 0, "paused_reason": "",
        "paused_by": "", "resumed_by": user["email"]}})
    return {"instance_name": name, "state": new}


@router.post("/wa/instances/{name}/unlink")
async def wa_instance_unlink(name: str, request: Request):
    user = await get_current_user(request)
    _require_admin(user)
    return await _unlink(await _instance_or_404(name), user["email"])


@router.put("/wa/instances/{name}/proxy")
async def wa_instance_proxy(name: str, request: Request):
    user = await get_current_user(request)
    _require_admin(user)
    inst = await _instance_or_404(name)
    proxy = _clean_proxy(await _body(request), inst.get("proxy"))
    try:
        await evolution.set_proxy(name, proxy or None, token=inst.get("instance_token") or None)
    except Exception as e:
        raise HTTPException(502, f"The WhatsApp server refused the proxy: {str(e)[:120]}")
    await db.wa_instances.update_one({"instance_name": name}, {"$set": {"proxy": proxy}})
    return {"instance_name": name, "proxy": _mask_proxy(proxy)}


@router.put("/wa/instances/{name}")
async def wa_instance_update(name: str, request: Request):
    user = await get_current_user(request)
    _require_admin(user)
    await _instance_or_404(name)
    body = await _body(request)
    sets = {}
    if "label" in body:
        sets["label"] = str(body.get("label") or "")[:60]
    if "daily_cap_override" in body:
        v = body.get("daily_cap_override")
        if v in (None, ""):
            sets["daily_cap_override"] = None
        else:
            try:
                iv = int(v)
            except (TypeError, ValueError):
                iv = 0
            if not 1 <= iv <= 2000:
                raise HTTPException(400, "daily_cap_override must be 1-2000, or empty for the warm-up ramp")
            sets["daily_cap_override"] = iv
    if sets:
        await db.wa_instances.update_one({"instance_name": name}, {"$set": sets})
    return await _view(await _instance_or_404(name), await get_wa_settings(db))


@router.get("/wa/settings")
async def wa_settings_get(request: Request):
    user = await get_current_user(request)
    _require_admin(user)
    return await get_wa_settings(db)


@router.put("/wa/settings")
async def wa_settings_put(request: Request):
    user = await get_current_user(request)
    _require_admin(user)
    try:
        return await save_wa_settings(db, await _body(request), by=user["email"])
    except WaSettingsError as e:
        raise HTTPException(400, str(e))


# ── Default proxy (the endpoint the old Settings form called; it 404'd on main) ──

@router.get("/whatsapp/proxy-config")
async def wa_proxy_config_get(request: Request):
    user = await get_current_user(request)
    _require_admin(user)
    doc = await db.settings.find_one({"type": "wa_proxy_default"}, {"_id": 0}) or {}
    return {"enabled": bool(doc.get("enabled")), **_mask_proxy(doc)}


@router.post("/whatsapp/proxy-config")
async def wa_proxy_config_save(request: Request):
    user = await get_current_user(request)
    _require_admin(user)
    body = await _body(request)
    saved = await db.settings.find_one({"type": "wa_proxy_default"}, {"_id": 0}) or {}
    proxy = _clean_proxy(body, saved)
    doc = {"type": "wa_proxy_default", "enabled": bool(body.get("enabled", True)) and bool(proxy),
           **(proxy or {"host": "", "port": "", "protocol": "socks5", "username": "", "password": ""}),
           "updated_by": user["email"], "updated_at": _now_iso()}
    await db.settings.update_one({"type": "wa_proxy_default"}, {"$set": doc}, upsert=True)
    return {"enabled": doc["enabled"], **_mask_proxy(doc)}
```

(c) `backend/routes/whatsapp_routes.py` — delete `:717-890` (from `# ── Evolution API — Instance management ───` through the
end of `wa_set_proxy`) and put in its place:

```python
# ── Company number state (read-only) ──────────────────────────────────────────
# Instance management moved to routes/wa_routes.py (/wa/me*, /wa/instances*), which is
# owner/admin-gated. This read-only route stays for MarketingHub's connection badge.

@router.get("/whatsapp/instance/status")
async def wa_instance_status(request: Request):
    await get_current_user(request)
    inst = await db.wa_instances.find_one({"kind": "company"}, {"_id": 0, "instance_name": 1, "state": 1}) or {}
    state = {"connected": "open", "qr": "connecting"}.get(inst.get("state"), "close")
    return {"state": state, "connected": state == "open", "instance": inst.get("instance_name", "")}
```

Then `grep -n "httpx" backend/routes/whatsapp_routes.py` — if the only hit is the import at `:9`, delete that import.

**4. Run — expect pass.**

```bash
cd backend && DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 python -m pytest tests/test_wa_routes.py tests/test_wa_webhook.py tests/test_wa_config.py -q
```

**5. Commit**

```bash
git add backend/routes/wa_routes.py backend/routes/whatsapp_routes.py backend/services/wa_config.py
git add -f backend/tests/test_wa_routes.py
git commit -m "feat(wa): My WhatsApp and admin number routes with owner/admin RBAC and capacity; drop the ungated instance routes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## Task 8 — Health: hourly `connectionState` sweep + alerts, and the host RAM probe `scripts/ss-wa-health.sh`

### Files

| Action | Path | Current refs |
|---|---|---|
| create | `backend/services/wa_health.py` | new |
| create | `scripts/ss-wa-health.sh` | new (next to `scripts/build-frontend.sh`) |
| modify | `backend/scheduler.py` | loop runners `:815-866`; `start_scheduler()` `:2025-2036` |
| create | `backend/tests/test_wa_health.py` | new |

Why a host script: the backend container's `/proc/meminfo` is the container cgroup's view, not the VPS's; the spec asks for
a `docker stats`-equivalent from the host, written to `settings{type:"wa_health"}`.

### Interfaces

**Produces**
- `async def record_host_health(db, mem_available_mb: int, mem_total_mb: int, evolution_mem_mb: int, *, at: str | None = None) -> dict`
  → upserts `settings{type:"wa_health", mem_available_mb, mem_total_mb, evolution_mem_mb, at}`.
- `async def run_wa_health_pass(db) -> dict` → `{checked, changed, unreachable, ram_low, health_stale}`:
  - each non-`unlinked` instance: `connectionState`; `open` → `connected` (from `disconnected`/`qr`), not-open while
    `connected` → `disconnected` + alert (owner for a rep number, every admin always; dedup `wa_close:<name>:<IST day>` — the
    same key the webhook uses, so one bell per number per day); `paused` never changes here; `last_checked_at`,
    `evolution_state` stamped;
  - every instance unreachable → one "WhatsApp server not answering" admin alert per day;
  - `wa_health.mem_available_mb < RAM_HEADROOM_MIN_MB` (500) on a fresh (< 3 h) reading → one "Server memory is low" admin
    alert per day; a stale reading raises nothing (reported as `health_stale`).
- `scheduler.wa_health_loop()` — hourly.
- `scripts/ss-wa-health.sh` — host cron, hourly at :07; exits 0 even when Evolution is down (writes `evolution_mem_mb: 0`).

**Consumes:** `wa_send.alert/admin_emails/_now/_iso/_parse/ist_day`, `evolution.connection_state`, `RAM_HEADROOM_MIN_MB`.

### Steps

**1. Failing test** — `backend/tests/test_wa_health.py`:

```python
"""The hourly WhatsApp health sweep and the host RAM reading.

Run:
    DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 \
    python -m pytest tests/test_wa_health.py -q
"""
import asyncio
import os
from datetime import timedelta

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

from services import evolution_client as ec
from services import wa_health as wh
from wa_fixtures import COMPANY, seed_instance, seed_user, seed_wa

PARUL = "parul@smartshape.in"
OWNER = "info@smartshape.in"


def _run(coro):
    return asyncio.run(coro)


async def _state(db, name):
    return (await db.wa_instances.find_one({"instance_name": name}, {"_id": 0}))["state"]


def test_a_connected_number_that_is_closed_becomes_disconnected_and_alerts_once(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db, reps={PARUL: "connected"})
        wa_env.evo.state.update({COMPANY: "open", "rep_parul": "close"})
        out = await wh.run_wa_health_pass(db)
        assert out["checked"] == 2 and out["changed"] == 1
        assert await _state(db, "rep_parul") == "disconnected" and await _state(db, COMPANY) == "connected"
        await db.wa_instances.update_one({"instance_name": "rep_parul"}, {"$set": {"state": "connected"}})
        await wh.run_wa_health_pass(db)                          # same day: no second bell or push
        assert await db.notifications.count_documents({"assigned_to": PARUL}) == 1
        assert [p["email"] for p in wa_env.pushes].count(PARUL) == 1
    _run(go())


def test_health_sweep_marks_company_disconnected_and_alerts(wa_env):                  # RF3
    db = wa_env.db

    async def go():
        await seed_user(db, "bde@smartshape.in", role="admin")
        await seed_wa(db)
        wa_env.evo.state[COMPANY] = "connecting"
        await wh.run_wa_health_pass(db)
        assert await _state(db, COMPANY) == "disconnected"
        assert {n["assigned_to"] for n in await db.notifications.find({}, {"_id": 0}).to_list(None)} == \
            {OWNER, "bde@smartshape.in"}
    _run(go())


def test_a_reconnected_number_comes_back_without_an_alert(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db, company="disconnected")
        wa_env.evo.state[COMPANY] = "open"
        await wh.run_wa_health_pass(db)
        assert await _state(db, COMPANY) == "connected"
        assert await db.notifications.count_documents({}) == 0
    _run(go())


def test_paused_and_unlinked_numbers_are_left_alone(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db, reps={PARUL: "paused"})
        await seed_instance(db, "rep_old", state="unlinked")
        wa_env.evo.state.update({COMPANY: "open", "rep_parul": "open"})
        out = await wh.run_wa_health_pass(db)
        assert out["checked"] == 2 and await _state(db, "rep_parul") == "paused"
        assert not any(c["path"].endswith("/rep_old") for c in wa_env.evo.calls)
    _run(go())


def test_evolution_down_keeps_states_and_raises_one_alert(wa_env, monkeypatch):
    db = wa_env.db

    async def _down(self, instance=None, *, token=None):
        raise ec.EvolutionError(502, "bad gateway")
    monkeypatch.setattr(ec.EvolutionClient, "connection_state", _down)

    async def go():
        await seed_wa(db, reps={PARUL: "connected"})
        out = await wh.run_wa_health_pass(db)
        assert out["unreachable"] == 2 and await _state(db, "rep_parul") == "connected"
        notes = await db.notifications.find({}, {"_id": 0}).to_list(None)
        assert [n["title"] for n in notes] == ["WhatsApp server not answering"]
    _run(go())


def test_low_ram_alerts_admins_once_a_day_and_a_stale_reading_is_ignored(wa_env):
    db = wa_env.db

    async def go():
        await seed_wa(db)
        wa_env.evo.state[COMPANY] = "open"
        await wh.record_host_health(db, 420, 3900, 1100)
        doc = await db.settings.find_one({"type": "wa_health"}, {"_id": 0})
        assert doc["mem_available_mb"] == 420 and doc["at"] == wa_env.clock["now"].isoformat()
        assert (await wh.run_wa_health_pass(db))["ram_low"] is True
        await wh.run_wa_health_pass(db)
        assert await db.notifications.count_documents({"title": "Server memory is low"}) == 1
        wa_env.clock["now"] += timedelta(hours=4)
        out = await wh.run_wa_health_pass(db)
        assert out["health_stale"] is True and out["ram_low"] is False
    _run(go())
```

**2. Run — expect failure** (`ModuleNotFoundError: services.wa_health`).

```bash
cd backend && DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 python -m pytest tests/test_wa_health.py -q
```

**3. Implement** — create `backend/services/wa_health.py`:

```python
"""WhatsApp health (spec 2026-09-24, W1 → Infrastructure → Health).

Two halves:
  * run_wa_health_pass (hourly, scheduler.wa_health_loop): ask Evolution for every number's
    connection state, correct wa_instances.state, and tell people when a number drops.
  * record_host_health: written by scripts/ss-wa-health.sh from the HOST (the container
    cannot see the VPS's real free memory) into settings{type:"wa_health"}; read here and by
    the admin page (D7 RAM headroom).
"""
import logging
from datetime import timedelta
from typing import Optional

from services import wa_send
from services.evolution_client import evolution
from services.wa_config import RAM_HEADROOM_MIN_MB

log = logging.getLogger("wa_health")
HEALTH_STALE_HOURS = 3


async def record_host_health(db, mem_available_mb: int, mem_total_mb: int, evolution_mem_mb: int,
                             *, at: Optional[str] = None) -> dict:
    doc = {"type": "wa_health", "mem_available_mb": int(mem_available_mb), "mem_total_mb": int(mem_total_mb),
           "evolution_mem_mb": int(evolution_mem_mb), "at": at or wa_send._iso(wa_send._now())}
    await db.settings.update_one({"type": "wa_health"}, {"$set": doc}, upsert=True)
    return doc


async def run_wa_health_pass(db) -> dict:
    now = wa_send._now()
    now_iso = wa_send._iso(now)
    day = wa_send.ist_day(now)
    admins = await wa_send.admin_emails(db)
    rows = await db.wa_instances.find({"state": {"$in": ["qr", "connected", "disconnected", "paused"]}},
                                      {"_id": 0}).to_list(100)
    checked = changed = unreachable = 0
    for inst in rows:
        name = inst["instance_name"]
        checked += 1
        try:
            st = await evolution.connection_state(name, token=inst.get("instance_token") or None)
        except Exception as e:
            unreachable += 1
            log.warning("[wa-health] %s: %s", name, str(e)[:120])
            await db.wa_instances.update_one({"instance_name": name}, {"$set": {
                "last_checked_at": now_iso, "evolution_state": "unreachable"}})
            continue
        cur = inst.get("state")
        new = cur
        if st == "open" and cur in ("disconnected", "qr"):
            new = "connected"
        elif st != "open" and cur == "connected":
            new = "disconnected"
        sets = {"last_checked_at": now_iso, "evolution_state": st}
        if new != cur:
            sets.update({"state": new, "state_at": now_iso})
            changed += 1
        await db.wa_instances.update_one({"instance_name": name}, {"$set": sets})
        if cur == "connected" and new == "disconnected":
            company = inst.get("kind") == "company"
            who = "The company WhatsApp number" if company else \
                f"{inst.get('label') or inst.get('owner_email') or name}'s WhatsApp number"
            await wa_send.alert(
                db, emails=([] if company else [inst.get("owner_email")]) + admins,
                title="Company WhatsApp disconnected" if company else "A WhatsApp number disconnected",
                body=(f"{who} (+{inst.get('phone_e164') or '?'}) is no longer connected (hourly check). "
                      + ("Messages for unowned records are held until it is relinked in Settings → WhatsApp."
                         if company else "Relink it on My WhatsApp; until then the company number sends.")),
                dedup_key=f"wa_close:{name}:{day}", ref_id=name)
    if rows and unreachable == len(rows):
        await wa_send.alert(
            db, emails=admins, title="WhatsApp server not answering",
            body=("The WhatsApp (Evolution) server did not answer the hourly check for any number, so nothing "
                  "can be sent. On the server: `docker ps --filter name=smartshape_evolution` and "
                  "`docker logs --tail 100 smartshape_evolution`."),
            dedup_key=f"wa_down:{day}")
    health = await db.settings.find_one({"type": "wa_health"}, {"_id": 0}) or {}
    stale = (not health.get("at")) or wa_send._parse(health["at"]) < now - timedelta(hours=HEALTH_STALE_HOURS)
    low = (not stale) and int(health.get("mem_available_mb") or 0) < RAM_HEADROOM_MIN_MB
    if low:
        await wa_send.alert(
            db, emails=admins, title="Server memory is low",
            body=(f"Only {health['mem_available_mb']} MB of memory is free on the server (WhatsApp uses "
                  f"{health.get('evolution_mem_mb', '?')} MB). Do not link another WhatsApp number until the server "
                  "is upgraded."),
            dedup_key=f"wa_ram:{day}")
    return {"checked": checked, "changed": changed, "unreachable": unreachable, "ram_low": low,
            "health_stale": stale}
```

`backend/scheduler.py` — add after `wa_queue_loop` (Task 5):

```python
async def wa_health_loop():
    """Hourly: every linked WhatsApp number's real state, plus the host RAM reading."""
    log.info("[scheduler] WhatsApp health check started (every hour)")
    from services.wa_health import run_wa_health_pass
    while True:
        await asyncio.sleep(3600)            # first check an hour after boot; webhooks cover the meantime
        try:
            out = await run_wa_health_pass(db)
            if out.get("changed") or out.get("unreachable") or out.get("ram_low"):
                log.warning(f"[wa-health] {out}")
        except Exception as exc:
            log.error(f"[wa-health] {exc}")
```

and in `start_scheduler()` add `asyncio.create_task(wa_health_loop())` after the `wa_queue_loop` line.

Create `scripts/ss-wa-health.sh`:

```bash
#!/usr/bin/env bash
# Hourly host-side WhatsApp health probe (spec 2026-09-24, W1 Health).
#
# The backend container cannot see the VPS's real free memory, so the HOST reads it and hands
# it to the backend, which stores settings{type:"wa_health"} (read by Settings → WhatsApp and
# by the hourly alert in services/wa_health.py).
#
# Install (once, as root on the VPS):
#   chmod +x /var/www/smartshape/scripts/ss-wa-health.sh
#   echo '7 * * * * root /var/www/smartshape/scripts/ss-wa-health.sh >> /var/log/ss-wa-health.log 2>&1' \
#     > /etc/cron.d/ss-wa-health
set -uo pipefail

BACKEND="${BACKEND_CONTAINER:-smartshape-backend}"
EVOLUTION="${EVOLUTION_CONTAINER:-smartshape_evolution}"

AVAIL_MB=$(awk '/^MemAvailable:/ {printf "%d", $2/1024}' /proc/meminfo)
TOTAL_MB=$(awk '/^MemTotal:/ {printf "%d", $2/1024}' /proc/meminfo)

# docker stats prints e.g. "412.3MiB / 3.84GiB"; take the first figure and convert to MB.
RAW=$(docker stats --no-stream --format '{{.MemUsage}}' "$EVOLUTION" 2>/dev/null | awk '{print $1}')
to_mb() {
  local v="$1"
  case "$v" in
    *GiB) awk -v x="${v%GiB}" 'BEGIN { printf "%d", x * 1024 }' ;;
    *MiB) awk -v x="${v%MiB}" 'BEGIN { printf "%d", x }' ;;
    *KiB) awk -v x="${v%KiB}" 'BEGIN { printf "%d", x / 1024 }' ;;
    *)    echo 0 ;;
  esac
}
EVO_MB=$(to_mb "${RAW:-}")

docker exec "$BACKEND" python -c "
import asyncio, sys
import database
from services.wa_health import record_host_health
asyncio.run(record_host_health(database.db, int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3])))
" "$AVAIL_MB" "$TOTAL_MB" "$EVO_MB" \
  && echo "$(date -Is) wa_health avail=${AVAIL_MB}MB total=${TOTAL_MB}MB evolution=${EVO_MB}MB" \
  || echo "$(date -Is) wa_health: could not write through $BACKEND"
exit 0
```

**4. Run — expect pass**, plus a syntax check of the script and a dry parse of its converter:

```bash
cd backend && DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 python -m pytest tests/test_wa_health.py -q
bash -n scripts/ss-wa-health.sh && echo "script syntax ok"
bash -c 'source <(sed -n "/^to_mb()/,/^}/p" scripts/ss-wa-health.sh); to_mb 412.3MiB; echo; to_mb 1.5GiB; echo'
```

Expected converter output: `412` and `1536`.

**5. Commit**

```bash
git update-index --add --chmod=+x scripts/ss-wa-health.sh 2>/dev/null || true
git add backend/services/wa_health.py backend/scheduler.py scripts/ss-wa-health.sh
git add -f backend/tests/test_wa_health.py
git commit -m "feat(wa): hourly number health sweep with alerts, and the host RAM probe script

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 9 — Migrate every caller to `send_whatsapp`; delete WABA `_send_wa` and the AutoSender copies

### Files

| Action | Path | Current refs (re-grep; Tasks 5 and 8 added lines to `scheduler.py`) |
|---|---|---|
| modify | `backend/scheduler.py` | import `:30`; `_wa_cfg` `:54-58`; WABA senders + `_send_wa` `:164-224`; `process_wa_queue` `:320-373`; `_wa_consent_ok` `:380-400`; drip pass `:486`, claim `:532-539`, WA branch `:580-593`, ledger write `:632-649`; `run_greeting_sender` `:741-812`; `_fms_send_wa` `:1082-1092`; `_fms_notify` `:1157`; `run_crm_digest` `:1361,1375`; `_cert_send_one` `:1521-1542` |
| modify | `backend/routes/admin_routes.py` | scheduled-WA drain `:1522-1560`; festival greetings `:1573-1576`; birthday greeting rule `:1650-1653` |
| modify | `backend/routes/crm_routes.py` | `_send_demo_wa` `:408-431` (call `:7654`); `_send_intro_wa` `:436-458` (call `:6463`); `_wa_notify` `:3284-3294`; dispatch auto-WA `:8462-8509` |
| modify | `backend/routes/school_routes.py` | `_wa_send` `:518-532`; `_wa_school` `:543-548` |
| modify | `backend/routes/fms_routes.py` | `:543-548` |
| modify | `backend/fms_actions.py` | `:78-90` |
| modify | `backend/routes/settings_routes.py` | integrations status `:431`; `/whatsapp/send` `:518-543`; `/whatsapp/send-file` `:546-569`; `/whatsapp/send-via-template` `:777-800`; tag-broadcast audience projection `:924-925`; `_send_wa_autosender` `:960-971` (delete); `/whatsapp/broadcast-by-tag` `:997-1046` |
| modify | `backend/routes/whatsapp_routes.py` | import `:13`; `launch_campaign` `:555-566`; `_send_campaign_background` `:571-666` |
| modify (tests) | `backend/tests/test_contact_drip_executor.py` (fixture `:44-81`, `_providers` `:96-98`), `test_drip_executor_concurrency.py` (fixture `:45-82`, `_seed` `:88-89`), `test_to_post_linking.py` (`:43-47`), `test_wa_tag_broadcast.py` (`sender` `:70-78`, `_seed_common` `:91-97`, assertions `:133,136,144,248`), `test_tag_scope.py` (`:395-418`), `test_auto_reminders_no_drip.py` (`:119-141`) | |
| create | `backend/tests/test_wa_callers.py` | new |
| create | `frontend/src/lib/waStatus.js`, `frontend/src/lib/__tests__/waStatus.test.js` | new |
| modify | `frontend/src/components/WhatsAppSendDialog.jsx` (`:79-82`), `frontend/src/hooks/useCRMMasters.js` (`:296-299`) | |

### Interfaces

**Caller → call** (every caller loses its own HTTP code; "queued" counts as accepted everywhere a caller reports success):

| Caller | `kind` | sender | consent | ref / notes |
|---|---|---|---|---|
| drip WhatsApp step | `drip` | `owner_email=recipient.assigned_to` → company | enforced | `{sequence_id, enrollment_id, step_number, dedup_key:"drip:<enr>:<step>"}`; `sent`/`queued` → step sent; `skipped` → step skipped (no retry); `failed` → existing retry → pause after 3. **Held** (not claimed, `next_step_at` +1 h) while `wa.drip_wa_enabled` is false. |
| `process_wa_queue` (digest, orders report, delegation reminders, form/webinar stages) | `digest` / `alert` / `form` / `scheduled` by `campaign_id` | company for `digest`/`alert`, else owner → company | off | only rows with `scheduled_id`, not `type:"campaign"`, and due (`scheduled_at` absent or ≤ now) — fixes the `KeyError` on `schedule_id` rows and the early fire of future rows; per-row claim `pending → sending` |
| admin scheduled-WA + queued greetings (`run_auto_reminders`) | `scheduled` / `greeting` (row has `rule_id`) | creator's number → company / owner → company | greeting: enforced | only rows with `schedule_id`; claim `pending → sending`; `greeting_logs.status` follows the result; greeting queueing gated on `wa.greetings_enabled` |
| 9 am greeting sender (`run_greeting_sender`) | `greeting` | owner → company | enforced | gated on `wa.greetings_enabled`; email fallback unchanged |
| `_fms_send_wa(phone, text, *, kind="alert", owner_email=None)` | `alert` (staff) / `digest` / `fms` (customer) | company for alert/digest | off | returns `(ok, err)` as before |
| certificates `_cert_send_one` | `certificate` | company | off | media = the PDF |
| demo link / lead intro | `demo` / `intro` | lead owner → company | off | `whatsapp_logs` status is the real result |
| mailer-QR rep alert `_wa_notify` | `alert` | company | off | |
| dispatch auto-WA → new `_send_dispatch_wa(lead_doc, doc, dispatch_id)` | `dispatch` | lead owner → company | off | `dedup_key:"dispatch:<id>"` |
| school-portal `_wa_send(phone, message, *, school_id="")` | `portal` | school owner → company | off | |
| `/whatsapp/send`, `/whatsapp/send-file` (Settings test message) | `chat` | company | – | `typed_by=user` |
| `/whatsapp/send-via-template` (`send_mode=api`) | `chat` | the sender's own number → company | – | `whatsapp_logs.status` = `sent`/`queued`/`failed`/`skipped:<reason>`, + `wa_message_id`, `instance_name` |
| `/whatsapp/broadcast-by-tag` | `broadcast` | each deal's owner → company | enforced (D10) | response adds `queued`, `skipped_policy`; `sent` = actually sent |
| WA campaigns `_send_campaign_background` | `campaign` | contact owner → school owner → company (young rep numbers → company) | enforced | `whatsapp_scheduled` row gets `status`, `wa_msg_id` (our id); campaign doc gets `sent_count`, `queued_count`, `skipped_count`, `failed_count` |

**Deleted:** `scheduler._send_via_gupshup/_send_via_360dialog/_send_via_meta/_send_wa`, `scheduler._wa_consent_ok`, the six
AutoSender copies (`settings_routes.py:533,566,788`, `admin_routes.py:1539`, `crm_routes.py:422,449,8489`, `school_routes.py:528`)
and `settings_routes._send_wa_autosender` (its one remaining call now lives in `wa_send._send_via_autosender`, used only when
`wa.fallback_provider == "autosender"`). `scheduler._wa_cfg` is kept as a shim (truthy when `wa_available(db)`), because
`admin_routes.py:2195` and the digest/orders-report gates (`scheduler.py:971,1046`) call it. `/whatsapp/provider` routes stay
until W4's cleanup (they no longer drive any send).

**Frontend (`frontend/src/lib/waStatus.js`):** `describeSkip(reason) -> string`, `describeSendResult(status) -> {level:
"success"|"warning"|"error", text}`, `describeBroadcastResult(d) -> string`.

### Steps

**1. Failing tests.**

(a) Create `backend/tests/test_wa_callers.py`:

```python
"""Every caller goes through send_whatsapp (D3) with the right kind, sender and consent rule.

Run:
    DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 \
    python -m pytest tests/test_wa_callers.py -q
"""
import asyncio
import os
from datetime import datetime, timedelta, timezone

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "smartshape_test")

import pytest

import rbac
import routes.crm_routes as crm
import routes.school_routes as school
import routes.settings_routes as settings_mod
import routes.whatsapp_routes as wroutes
import scheduler as sched
from wa_fixtures import COMPANY, seed_wa

PARUL = "parul@smartshape.in"
ADMIN = {"email": "info@smartshape.in", "name": "Owner", "role": "admin"}
PAST = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()


class FakeRequest:
    def __init__(self, body=None):
        self._body = body or {}
        self.query_params = {}

    async def json(self):
        return self._body


@pytest.fixture()
def env(wa_env, monkeypatch):
    for mod in (crm, school, settings_mod, wroutes, sched):
        monkeypatch.setattr(mod, "db", wa_env.db, raising=False)
    monkeypatch.setattr(rbac, "MODULE_RBAC_MODE", "enforce", raising=False)

    async def _me(_r):
        return ADMIN
    monkeypatch.setattr(settings_mod, "get_current_user", _me)
    return wa_env


def _run(coro):
    return asyncio.run(coro)


async def _kinds(db):
    return [(r["kind"], r["instance_name"], r["status"])
            for r in await db.wa_messages.find({}, {"_id": 0}).sort("created_at", 1).to_list(None)]


def test_the_queue_drains_only_due_scheduled_id_rows_with_the_right_kinds(env):
    db = env.db

    async def go():
        await seed_wa(db, reps={PARUL: "connected"})
        future = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
        await db.whatsapp_scheduled.insert_many([
            {"scheduled_id": "q1", "campaign_id": "daily_digest", "status": "pending", "phone": "9811111111", "message": "digest"},
            {"scheduled_id": "q2", "campaign_id": "reminder", "status": "pending", "phone": "9822222222", "message": "remind"},
            {"scheduled_id": "q3", "campaign_id": "form_f1", "status": "pending", "phone": "9833333333", "message": "form"},
            {"scheduled_id": "q4", "campaign_id": "daily_digest", "status": "pending", "phone": "9844444444",
             "message": "later", "scheduled_at": future},
            {"scheduled_id": "q5", "campaign_id": "camp_1", "type": "campaign", "status": "pending", "phone": "9855555555", "message": ""},
            {"schedule_id": "g1", "status": "pending", "phone": "9866666666", "message": "greeting", "scheduled_at": PAST},
        ])
        await sched.process_wa_queue()
        assert await _kinds(db) == [("digest", COMPANY, "sent"), ("alert", COMPANY, "sent"), ("form", COMPANY, "sent")]
        st = {r.get("scheduled_id") or r.get("schedule_id"): r["status"]
              for r in await db.whatsapp_scheduled.find({}, {"_id": 0}).to_list(None)}
        assert st == {"q1": "sent", "q2": "sent", "q3": "sent", "q4": "pending", "q5": "pending", "g1": "pending"}
    _run(go())


def test_whatsapp_drip_steps_are_held_while_the_setting_is_off(env):
    db = env.db

    async def go():
        await seed_wa(db)                                   # drip_wa_enabled defaults to False
        await db.schools.insert_one({"school_id": "s1", "school_name": "DPS", "wa_consent": True, "is_deleted": False})
        await db.contacts.insert_one({"contact_id": "c1", "name": "Ritu", "phone": "9811111111", "school_id": "s1",
                                      "is_deleted": False})
        await db.drip_sequences.insert_one({"sequence_id": "seq1", "name": "S", "is_active": True, "steps": [
            {"step_number": 1, "delay_days": 0, "message_type": "whatsapp", "message_template": "Hi"}]})
        await db.drip_enrollments.insert_one({"enrollment_id": "e1", "sequence_id": "seq1", "contact_id": "c1",
                                              "lead_id": None, "school_id": "s1", "current_step": 0,
                                              "status": "active", "enrolled_at": PAST, "next_step_at": PAST})
        await sched.run_drip_executor()
        enr = await db.drip_enrollments.find_one({"enrollment_id": "e1"}, {"_id": 0})
        assert enr["current_step"] == 0 and enr["status"] == "active" and enr["next_step_at"] > PAST
        assert env.evo.sends == [] and await db.drip_step_logs.count_documents({}) == 0
    _run(go())


def test_fms_helper_reports_queued_as_accepted_and_keeps_its_signature(env):
    db = env.db

    async def go():
        await seed_wa(db)
        env.clock["now"] = datetime(2026, 9, 24, 15, 0, tzinfo=timezone.utc)      # 20:30 IST
        assert await sched._fms_send_wa("9811111111", "Stage done", kind="fms") == (True, "")
        assert await sched._fms_send_wa("9822222222", "Your task is overdue") == (True, "")
        assert await sched._fms_send_wa("011 2345 6789", "x") == (False, "bad_phone")
        assert [(k, s) for k, _, s in await _kinds(db)] == [("fms", "queued"), ("alert", "sent"), ("alert", "skipped")]
    _run(go())


def test_a_certificate_goes_as_a_pdf_from_the_company_number(env):
    db = env.db

    async def go():
        await seed_wa(db)
        ok, err = await sched._cert_send_one("whatsapp", {"item_id": "i1", "name": "Ritu", "phone": "9811111111",
                                                          "pdf_url": "/uploads/certificates/i1.pdf"},
                                             {"batch_id": "b1", "shared_values": {}})
        assert (ok, err) == (True, None)
        s = env.evo.sends[-1]
        assert s["instance"] == COMPANY and s["mediatype"] == "document" and s["media"].endswith("/uploads/certificates/i1.pdf")
    _run(go())


def test_intro_and_demo_go_from_the_lead_owner_and_log_the_real_result(env):
    db = env.db

    async def go():
        await seed_wa(db, reps={PARUL: "connected"})
        lead = {"lead_id": "L1", "school_id": "s1", "assigned_to": PARUL, "contact_phone": "9811111111"}
        assert await crm._send_intro_wa("9811111111", "Hello from SmartShape", lead=lead) is True
        assert await crm._send_demo_wa("9811111111", "Join here", lead=lead) is True
        assert [(k, i) for k, i, _ in await _kinds(db)] == [("intro", "rep_parul"), ("demo", "rep_parul")]
        logs = await db.whatsapp_logs.find({}, {"_id": 0}).to_list(None)
        assert [l["status"] for l in logs] == ["sent", "sent"] and all(l["wa_message_id"] for l in logs)
    _run(go())


def test_dispatch_whatsapp_goes_through_the_service(env):
    db = env.db

    async def go():
        await seed_wa(db, reps={PARUL: "connected"})
        lead = {"lead_id": "L1", "school_id": "s1", "assigned_to": PARUL, "contact_phone": "9811111111",
                "contact_name": "Ritu"}
        await crm._send_dispatch_wa(lead, {"courier_name": "Delhivery", "tracking_number": "T1",
                                           "material_type": "brochure"}, "disp1")
        row = await db.wa_messages.find_one({}, {"_id": 0})
        assert row["kind"] == "dispatch" and row["instance_name"] == "rep_parul"
        assert "delhivery.com/track/package/T1" in row["text"] and row["ref"]["dedup_key"] == "dispatch:disp1"
    _run(go())


def test_mailer_qr_alert_and_school_portal(env):
    db = env.db

    async def go():
        await seed_wa(db, reps={PARUL: "connected"})
        await db.schools.insert_one({"school_id": "s1", "school_name": "DPS", "phone": "9822222222",
                                     "assigned_to": PARUL, "is_deleted": False})
        await db.settings.insert_one({"type": "school_portal", "notify_whatsapp": True})
        await crm._wa_notify("9811111111", "New mailer lead")
        await school._wa_school("s1", "Your order shipped")
        assert [(k, i) for k, i, _ in await _kinds(db)] == [("alert", COMPANY), ("portal", "rep_parul")]
    _run(go())


def test_send_via_template_records_status_and_the_sender(env):
    db = env.db

    async def go():
        await seed_wa(db, settings={"hourly_cap": 1})
        a = await settings_mod.send_via_template(FakeRequest({"phone": "9811111111", "body": "Hi", "send_mode": "api"}))
        b = await settings_mod.send_via_template(FakeRequest({"phone": "9822222222", "body": "Hi", "send_mode": "api"}))
        assert (a["status"], a["instance_name"], b["status"]) == ("sent", COMPANY, "queued")
        assert a["wa_message_id"] and a["sent_by"] == ADMIN["email"]
    _run(go())


def test_tag_broadcast_needs_consent_and_reports_every_outcome(env):
    db = env.db

    async def go():
        await seed_wa(db)
        await db.tags.insert_one({"tag_id": "t1", "name": "GSLC"})
        await db.schools.insert_one({"school_id": "s1", "school_name": "DPS", "tag_ids": ["t1"], "wa_consent": False,
                                     "is_deleted": False})
        await db.leads.insert_one({"lead_id": "L1", "school_id": "s1", "contact_name": "A", "contact_phone": "9811111111",
                                   "tag_ids": ["t1"], "is_deleted": False, "created_at": "2026-09-01"})
        out = await settings_mod.whatsapp_broadcast_by_tag(FakeRequest({"tag_id": "t1", "message": "Hi {contact_name}"}))
        assert (out["sent"], out["queued"], out["skipped_policy"], out["failed"]) == (0, 0, 1, 0)
        assert (await db.wa_messages.find_one({}, {"_id": 0}))["fail_reason"] == "no_consent"
    _run(go())


def test_campaign_sends_each_contact_from_its_owner(env, monkeypatch):
    db = env.db

    async def _same(template, contact, campaign_name, ai_enabled):
        return template
    monkeypatch.setattr(wroutes, "personalize_message", _same)

    async def go():
        await seed_wa(db, reps={PARUL: "connected"})
        await db.settings.insert_one({"type": "notifications", "require_wa_consent": False})
        await db.contacts.insert_many([
            {"contact_id": "c1", "name": "A", "phone": "9811111111", "assigned_to": PARUL},
            {"contact_id": "c2", "name": "B", "phone": "9822222222", "assigned_to": ""}])
        await db.whatsapp_campaigns.insert_one({"campaign_id": "camp1", "name": "Diwali", "status": "queued"})
        for sid, cid, ph in (("s1", "c1", "9811111111"), ("s2", "c2", "9822222222")):
            await db.whatsapp_scheduled.insert_one({"scheduled_id": sid, "campaign_id": "camp1", "contact_id": cid,
                                                    "phone": ph, "status": "pending", "type": "campaign",
                                                    "contact_snapshot": {}})
        await wroutes._send_campaign_background(campaign_id="camp1", sched_ids=["s1", "s2"], template="Happy Diwali",
                                                attachment_doc=None, ai_enabled=False)
        assert [(k, i) for k, i, _ in await _kinds(db)] == [("campaign", "rep_parul"), ("campaign", COMPANY)]
        camp = await db.whatsapp_campaigns.find_one({"campaign_id": "camp1"}, {"_id": 0})
        assert camp["sent_count"] == 2 and camp["status"] == "sent"
    _run(go())


def test_the_greeting_sender_does_not_whatsapp_while_greetings_are_off(env):
    db = env.db

    async def go():
        await seed_wa(db)
        today = datetime.now(sched.IST).strftime("%m-%d")
        await db.greeting_rules.insert_one({"rule_id": "gr1", "name": "Fest", "trigger": "fixed_date",
                                            "fixed_date": today, "is_active": True, "template_body": "Hi {name}"})
        await db.contacts.insert_one({"contact_id": "c1", "name": "Ritu", "phone": "9811111111"})
        await sched.run_greeting_sender()
        assert env.evo.sends == [] and await db.wa_messages.count_documents({}) == 0
    _run(go())


def test_the_old_senders_are_gone():
    for mod, names in ((sched, ("_send_wa", "_send_via_gupshup", "_send_via_360dialog", "_send_via_meta", "_wa_consent_ok")),
                       (settings_mod, ("_send_wa_autosender",))):
        for n in names:
            assert not hasattr(mod, n), f"{mod.__name__}.{n} still exists"
    import inspect
    for mod in (sched, settings_mod, crm, school, wroutes):
        assert "messageautosender.com" not in inspect.getsource(mod), mod.__name__
```

(b) Frontend — create `frontend/src/lib/__tests__/waStatus.test.js`:

```js
import { describeSkip, describeSendResult, describeBroadcastResult } from '../waStatus';

test('a skip reason reads in plain words', () => {
  expect(describeSkip('no_consent')).toBe('no WhatsApp consent on record for this school');
  expect(describeSkip('something_new')).toBe('something_new');
});

test('send results map to a toast level and text', () => {
  expect(describeSendResult('sent')).toEqual({ level: 'success', text: 'WhatsApp sent' });
  expect(describeSendResult('queued').level).toBe('success');
  expect(describeSendResult('queued').text).toMatch(/business hours/);
  expect(describeSendResult('skipped:opt_out')).toEqual({ level: 'warning', text: 'Not sent: this person opted out of WhatsApp' });
  expect(describeSendResult('failed').level).toBe('error');
});

test('a broadcast result names every outcome it has', () => {
  const s = describeBroadcastResult({ sent: 3, queued: 2, skipped_policy: 4, failed: 1, skipped_no_phone: 1,
    capped_at: null, over_cap: 0 });
  expect(s).toBe('Broadcast: 3 sent, 2 queued for business hours / limits, 4 not sent (opted out, no consent or '
    + 'not on WhatsApp), 1 failed, 1 deal(s) with no usable phone');
  expect(describeBroadcastResult({ sent: 0 })).toBe('Broadcast: 0 sent');
});
```

**2. Run — expect failure.**

```bash
cd backend && DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 python -m pytest tests/test_wa_callers.py -q
cd frontend && npx craco test --watchAll=false --testPathPattern "waStatus"
```

**3. Implement — backend.**

**`backend/scheduler.py`**

- Replace `from services.evolution_client import evolution` (`:30`) with:

```python
from services.wa_send import send_whatsapp, wa_available
from services.wa_config import get_wa_settings
```

- Replace `_wa_cfg` (`:54-58`):

```python
async def _wa_cfg():
    """Truthy when WhatsApp can send right now (a connected number, or the AutoSender fallback).
    Kept under its old name for the digest / orders-report gates and admin_routes' digest test
    route. The WABA provider document it used to read no longer drives any send (W1, D3)."""
    return {"provider": "evolution"} if await wa_available(db) else None
```

- Delete the whole `# WA PROVIDER DISPATCH` section (`:164-224`: `_send_via_gupshup`, `_send_via_360dialog`, `_send_via_meta`, `_send_wa`).

- Replace `process_wa_queue` (`:320-373`):

```python
_QUEUE_KIND = {"daily_digest": "digest", "daily_orders_report": "digest", "reminder": "alert"}


def _queue_kind(row: dict) -> str:
    cid = str(row.get("campaign_id") or "")
    if cid in _QUEUE_KIND:
        return _QUEUE_KIND[cid]
    if cid.startswith("form_"):
        return "form"
    return "scheduled"


async def process_wa_queue():
    """Hand queued rows (daily digest, orders report, delegation reminders, form/webinar stages) to
    send_whatsapp. Campaign rows are sent by their own background task and schedule_id rows by
    run_auto_reminders — neither is touched here (a schedule_id row used to raise KeyError and
    abort the cycle). A row scheduled for later now waits for its time (it used to fire early)."""
    now_iso = datetime.now(timezone.utc).isoformat()
    rows = await db.whatsapp_scheduled.find({
        "status": "pending", "scheduled_id": {"$exists": True}, "type": {"$ne": "campaign"},
        "$or": [{"scheduled_at": {"$exists": False}}, {"scheduled_at": None}, {"scheduled_at": {"$lte": now_iso}}],
    }, {"_id": 0}).limit(50).to_list(50)
    for msg in rows:
        claim = await db.whatsapp_scheduled.update_one(
            {"scheduled_id": msg["scheduled_id"], "status": "pending"},
            {"$set": {"status": "sending", "claimed_at": now_iso}})
        if getattr(claim, "modified_count", 0) != 1:
            continue
        kind = _queue_kind(msg)
        try:
            res = await send_whatsapp(
                db, to=(msg.get("phone") or msg.get("to_phone") or ""), text=msg.get("message", ""), kind=kind,
                ref={"scheduled_id": msg["scheduled_id"], "campaign_id": msg.get("campaign_id")},
                channel="company" if kind in ("digest", "alert") else "auto",
                contact_id=msg.get("contact_id") or "", enforce_consent=False)
        except Exception as exc:
            res = {"status": "failed", "message_id": "", "reason": str(exc)[:200]}
        await db.whatsapp_scheduled.update_one({"scheduled_id": msg["scheduled_id"]}, {"$set": {
            "status": res["status"], "wa_msg_id": res.get("message_id", ""), "error": res.get("reason", ""),
            "sent_at": now_iso}})
```

- Delete `_wa_consent_ok` (`:380-400`) — the rule now lives in `wa_send.consent_ok` (D10).

- In `_drip_executor_pass`: replace `wa_cfg = await _wa_cfg()` (`:486`) with `wa_settings = await get_wa_settings(db)`; insert
  directly after `fire_idx, step = step_to_fire` (`:532`), before the claim:

```python
            # Rollout step 2: WhatsApp drip steps are HELD — not failed, not skipped — until the owner
            # turns them on in Settings -> WhatsApp. Pushed an hour so held rows do not crowd the
            # 500-row window; nothing else about the enrolment changes.
            if step.get("message_type", "whatsapp") == "whatsapp" and not wa_settings.get("drip_wa_enabled"):
                await db.drip_enrollments.update_one(
                    {"enrollment_id": enr["enrollment_id"], "next_step_at": enr.get("next_step_at")},
                    {"$set": {"next_step_at": (now + timedelta(hours=1)).isoformat()}})
                continue
```

  and replace the WhatsApp branch (`:580-593`) with:

```python
            elif msg_type == "whatsapp":
                res = await send_whatsapp(
                    db, to=lead.get("contact_phone", ""), text=text, kind="drip",
                    ref={"sequence_id": enr["sequence_id"], "enrollment_id": enr["enrollment_id"],
                         "step_number": step["step_number"],
                         "dedup_key": f"drip:{enr['enrollment_id']}:{step['step_number']}"},
                    owner_email=lead.get("assigned_to") or None,
                    contact_id=lead.get("contact_id") or "", lead_id=enr.get("lead_id") or "",
                    school_id=lead.get("school_id") or "")
                if res["status"] in ("sent", "queued"):
                    sent = True                      # queued = accepted; the drainer sends it in hours
                elif res["status"] == "skipped":
                    # A refusal (consent, opt-out, not on WhatsApp, no number) is not a failure:
                    # retrying would stall the school on a step that cannot send (spec W3).
                    skipped = True
                    err_detail = _WA_SKIP_TEXT.get(res["reason"], res["reason"])
                else:
                    err_detail = res.get("reason") or "WhatsApp send failed"
```

  with, above `run_drip_executor` (module level):

```python
_WA_SKIP_TEXT = {
    "no_consent": "no WhatsApp consent on record for this school",
    "opt_out": "this person opted out of WhatsApp",
    "not_on_whatsapp": "this number is not on WhatsApp",
    "no_sender": "no WhatsApp number is connected (owner's or company)",
    "bad_phone": "no usable mobile number",
    "empty_message": "the step has no message",
    "number_warming_up": "the sending number is still warming up",
}
```

  and change the ledger guard `if sent:` (`:634`) to `if sent and msg_type != "whatsapp":` — the service writes the
  WhatsApp event itself, on the actual send, under the same `drip:<enr>:<step>` dedup key.

- In `run_greeting_sender` (`:741-812`): replace `wa_cfg = await _wa_cfg()` with
  `wa_on = (await get_wa_settings(db)).get("greetings_enabled")`; add `"contact_id": 1` to the contacts projection; and
  replace the `if wa_cfg and contact.get("phone"):` block with:

```python
            if wa_on and contact.get("phone"):
                res = await send_whatsapp(
                    db, to=contact["phone"], text=text, kind="greeting",
                    ref={"rule_id": rule_id,
                         "dedup_key": f"greet:{rule_id}:{today_key}:{contact.get('contact_id', '')}"},
                    contact_id=contact.get("contact_id") or "")
                if res["status"] in ("sent", "queued"):
                    sent_count += 1
                    delivered = True
```

- Replace `_fms_send_wa` (`:1082-1092`):

```python
async def _fms_send_wa(phone: str, text: str, *, kind: str = "alert",
                       owner_email: str | None = None) -> tuple[bool, str]:
    """FMS / digest WhatsApp through the one door. `alert`/`digest` (our staff) go from the company
    number; `fms` (a customer) from the record owner's. Queued counts as accepted."""
    if not phone:
        return False, "no_phone"
    if FMS_DRY_RUN:
        log.info(f"[fms][dry] WA -> {phone}: {text[:60]}")
        return True, ""
    res = await send_whatsapp(db, to=phone, text=text, kind=kind, owner_email=owner_email,
                              channel="company" if kind in ("alert", "digest") else "auto",
                              enforce_consent=False)
    if res["status"] in ("sent", "queued"):
        return True, ""
    return False, res.get("reason") or res["status"]
```

- In `run_crm_digest`: `await _fms_send_wa(recipient.get("phone", ""), text, kind="digest")` (`:1361`) and
  `await _fms_send_wa(r.get("phone", ""), summary, kind="digest")` (`:1375`). `_fms_notify` (`:1157`) keeps the default `alert`.

- In `_cert_send_one` replace the `try:` block (`:1537-1542`):

```python
        full_url = f"{_PUBLIC_BASE}{pdf_url}" if _PUBLIC_BASE else pdf_url
        res = await send_whatsapp(
            db, to=it["phone"], text=caption, kind="certificate", channel="company", enforce_consent=False,
            media={"type": "document", "url": full_url, "filename": fname, "mime": "application/pdf"},
            ref={"cert_batch_id": batch.get("batch_id"), "item_id": it.get("item_id")})
        if res["status"] in ("sent", "queued"):
            return True, None
        if res["status"] == "skipped":
            return None, res["reason"]
        return False, res["reason"]
```

**`backend/routes/admin_routes.py`** — replace the scheduled-WA block (`:1522-1560`) with:

```python
            # ── Scheduled WhatsApp messages (+ greetings queued below) ───
            # Through the one door (W1, D3). Only schedule_id rows are ours; scheduled_id rows
            # belong to scheduler.process_wa_queue. Claimed pending -> sending before sending.
            from services.wa_send import send_whatsapp as _send_wa_one
            now_iso_full = datetime.now(timezone.utc).isoformat()
            due_scheduled = await db.whatsapp_scheduled.find(
                {"status": "pending", "schedule_id": {"$exists": True}, "scheduled_at": {"$lte": now_iso_full}},
                {"_id": 0}).to_list(100)
            for sched in due_scheduled:
                claimed = await db.whatsapp_scheduled.update_one(
                    {"schedule_id": sched["schedule_id"], "status": "pending"}, {"$set": {"status": "sending"}})
                if getattr(claimed, "modified_count", 0) != 1:
                    continue
                phone = sched.get("phone", "")
                message = sched.get("message", "")
                is_greeting = bool(sched.get("rule_id"))
                try:
                    res = await _send_wa_one(
                        db, to=phone, text=message, kind="greeting" if is_greeting else "scheduled",
                        ref={"schedule_id": sched["schedule_id"], "rule_id": sched.get("rule_id")},
                        owner_email=None if is_greeting else (sched.get("created_by") or None),
                        typed_by=None if is_greeting else sched.get("created_by"),
                        contact_id=sched.get("contact_id") or "", lead_id=sched.get("lead_id") or "",
                        enforce_consent=is_greeting)
                except Exception as exc:
                    res = {"status": "failed", "message_id": "", "reason": str(exc)[:200]}
                new_status = res["status"]
                await db.whatsapp_scheduled.update_one(
                    {"schedule_id": sched["schedule_id"]},
                    {"$set": {"status": new_status, "sent_at": now_iso_full, "wa_msg_id": res.get("message_id", ""),
                              "error": res.get("reason", "")}})
                if is_greeting:
                    await db.greeting_logs.update_one(
                        {"rule_id": sched["rule_id"], "contact_id": sched.get("contact_id"),
                         "year": int(now_iso_full[:4])},
                        {"$set": {"status": new_status, "wa_msg_id": res.get("message_id", "")}})
                await db.whatsapp_logs.insert_one({
                    "log_id": f"wal_{uuid.uuid4().hex[:10]}", "template_id": sched.get("template_id"),
                    "phone": phone, "body": message, "lead_id": sched.get("lead_id"), "send_mode": "scheduled",
                    "status": new_status, "wa_message_id": res.get("message_id", ""),
                    "sent_by": sched.get("created_by", "system"), "sent_at": now_iso_full})
```

  In the greeting block, directly after `this_year = int(today[:4])` (`:1574`):

```python
            # Rollout step 2: greetings stay off WhatsApp until W3's single engine; the owner can
            # switch them on in Settings -> WhatsApp (wa.greetings_enabled).
            from services.wa_config import get_wa_settings as _wa_settings
            greetings_on = (await _wa_settings(db)).get("greetings_enabled")
```

  then guard the festival query (`:1576`) — `active_greeting_rules = (await db.greeting_rules.find(...).to_list(10)) if greetings_on else []`
  — and the birthday rule lookup (`:1651`) — `bday_grule = (await db.greeting_rules.find_one(...)) if greetings_on else None`.

**`backend/routes/crm_routes.py`**

- Replace `_send_demo_wa` (`:408-431`) and `_send_intro_wa` (`:436-458`):

```python
async def _send_lead_wa(phone: str, message: str, *, kind: str, send_mode: str,
                        lead: Optional[dict] = None) -> bool:
    """Lead-facing WhatsApp (demo link, intro) through the one door (W1, D3), from the lead
    owner's number (else the company's). The log records the real outcome."""
    from services.wa_send import send_whatsapp
    lead = lead or {}
    res = await send_whatsapp(db, to=phone, text=message, kind=kind, enforce_consent=False,
                              owner_email=lead.get("assigned_to") or None, lead_id=lead.get("lead_id") or "",
                              contact_id=lead.get("contact_id") or "", school_id=lead.get("school_id") or "",
                              ref={"purpose": send_mode})
    await db.whatsapp_logs.insert_one({
        "log_id": f"wal_{uuid.uuid4().hex[:10]}", "phone": phone, "body": message, "lead_id": lead.get("lead_id"),
        "send_mode": send_mode, "status": res["status"], "wa_message_id": res["message_id"],
        "instance_name": res["instance_name"], "sent_by": "system",
        "sent_at": datetime.now(timezone.utc).isoformat()})
    return res["status"] in ("sent", "queued")


async def _send_demo_wa(phone: str, message: str, *, lead: Optional[dict] = None) -> bool:
    if not phone:
        return False
    if DEMO_WA_DRY_RUN:
        logging.getLogger("crm").info(f"[demo][dry] WA -> {phone}: {message[:60]}")
        return True
    return await _send_lead_wa(phone, message, kind="demo", send_mode="demo_link", lead=lead)


INTRO_WA_DRY_RUN = _os.getenv("INTRO_WA_DRY_RUN", "0") == "1"


async def _send_intro_wa(phone: str, message: str, *, lead: Optional[dict] = None) -> bool:
    if not phone or not message:
        return False
    if INTRO_WA_DRY_RUN:
        logging.getLogger("crm").info(f"[intro][dry] WA -> {phone}: {message[:60]}")
        return True
    return await _send_lead_wa(phone, message, kind="intro", send_mode="lead_intro", lead=lead)
```

  and update the two call sites: `:6463` → `await _send_intro_wa(lead_doc.get("contact_phone", ""), intro, lead=lead_doc)`;
  `:7654` → `sent = await _send_demo_wa(lead.get("contact_phone", ""), msg, lead=lead)`.

- Replace `_wa_notify` body (`:3284-3294`):

```python
async def _wa_notify(phone, message):
    """Internal WhatsApp alert to a rep, from the company number. Never raises into the caller."""
    if not (phone or "").strip():
        return
    try:
        from services.wa_send import send_whatsapp
        await send_whatsapp(db, to=phone, text=message, kind="alert", channel="company", enforce_consent=False)
    except Exception:
        pass
```

- Dispatch (`:8462-8509`): replace the whole `# Auto-WhatsApp …` `try:` block with
  `await _send_dispatch_wa(lead_doc, doc, dispatch_id)` inside `try/except Exception: pass`, after
  `lead_doc = await db.leads.find_one({"lead_id": body["lead_id"]}, {"_id": 0})`:

```python
    # Auto-WhatsApp: tracking notification to the lead contact (non-blocking)
    try:
        lead_doc = await db.leads.find_one({"lead_id": body["lead_id"]}, {"_id": 0})
        if lead_doc and lead_doc.get("contact_phone"):
            await _send_dispatch_wa(lead_doc, doc, dispatch_id)
    except Exception:
        pass  # Dispatch is already saved — WA failure is non-blocking
```

  and add the helper at module level (next to `_send_lead_wa`):

```python
_COURIER_TRACK = {
    "delhivery": "https://www.delhivery.com/track/package/{tn}",
    "blue dart": "https://bluedart.com/track-consignment?trackFor=0&HAWB={tn}",
    "bluedart": "https://bluedart.com/track-consignment?trackFor=0&HAWB={tn}",
    "dtdc": "https://tracking.dtdc.com/ctbs-tracking/customerInterface.tr?submitName=showCustInter&cType=Consignment&cnNo={tn}",
}


async def _send_dispatch_wa(lead_doc: dict, doc: dict, dispatch_id: str) -> dict:
    from services.wa_send import send_whatsapp
    tn = doc.get("tracking_number", "")
    url = _COURIER_TRACK.get(doc.get("courier_name", "").lower().strip(), "").format(tn=tn)
    message = (f"Dear {lead_doc.get('contact_name', 'Sir/Madam')}, your {doc.get('material_type', 'material')} "
               f"from SmartShape has been dispatched!\nCourier: {doc.get('courier_name', 'courier')}"
               f"{(' | Tracking: ' + tn) if tn else ''}{chr(10) + 'Track here: ' + url if url else ''}")
    res = await send_whatsapp(db, to=lead_doc["contact_phone"], text=message, kind="dispatch",
                              enforce_consent=False, owner_email=lead_doc.get("assigned_to") or None,
                              lead_id=lead_doc.get("lead_id") or "", school_id=lead_doc.get("school_id") or "",
                              ref={"dispatch_id": dispatch_id, "dedup_key": f"dispatch:{dispatch_id}"})
    await db.whatsapp_logs.insert_one({
        "log_id": f"wal_{uuid.uuid4().hex[:10]}", "template_id": None, "phone": lead_doc["contact_phone"],
        "body": message, "lead_id": lead_doc.get("lead_id"), "send_mode": "auto_dispatch",
        "status": res["status"], "wa_message_id": res["message_id"], "sent_by": "system",
        "sent_at": datetime.now(timezone.utc).isoformat()})
    return res
```

  (The old block logged `status: "sent"` even when the HTTP call failed — spec research table row 12.)

**`backend/routes/school_routes.py`** — replace `_wa_send` (`:518-532`) and pass the school in `_wa_school` (`:548`):

```python
async def _wa_send(phone: str, message: str, *, school_id: str = ""):
    """School-portal WhatsApp through the one door (W1, D3). Never raises into the caller."""
    phone = (phone or "").strip()
    if not phone:
        return
    try:
        from services.wa_send import send_whatsapp
        await send_whatsapp(db, to=phone, text=message, kind="portal", school_id=school_id, enforce_consent=False)
    except Exception:
        pass
```

and in `_wa_school`: `await _wa_send(s["phone"], message, school_id=school_id)`.

**`backend/routes/fms_routes.py`** `:545`: `ok, err = await _fms_send_wa(flow["customer_phone"], text, kind="fms")`.

**`backend/fms_actions.py`** `:90`: `ok, _ = await _fms_send_wa(phone, text, kind="alert" if to == "staff" else "fms"); results.append(ok)`.

**`backend/routes/settings_routes.py`**

- `integrations_status` (`:431`):

```python
        "whatsapp":   {"configured": bool(await db.wa_instances.find_one({"kind": "company", "state": "connected"}, {"_id": 1}))
                       or _has(wa, "username", "password")},
```

- Replace `/whatsapp/send` and `/whatsapp/send-file` (`:518-569`):

```python
@router.post("/whatsapp/send")
async def send_whatsapp_message(request: Request):
    """A one-off message typed in the app (Settings → test message), from the company number."""
    user = await get_current_user(request)
    body = await request.json()
    phone, message = body.get("phone", ""), body.get("message", "")
    if not phone or not message:
        raise HTTPException(status_code=400, detail="phone and message required")
    from services.wa_send import send_whatsapp
    res = await send_whatsapp(db, to=phone, text=message, kind="chat", channel="company", typed_by=user["email"])
    return {"success": res["status"] in ("sent", "queued"), **res,
            "error": "" if res["status"] in ("sent", "queued") else res["reason"]}


_WA_IMAGE_EXT = ("jpg", "jpeg", "png", "webp", "gif")
_WA_VIDEO_EXT = ("mp4", "mov", "webm")


@router.post("/whatsapp/send-file")
async def send_whatsapp_file(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    phone, message, file_url = body.get("phone", ""), body.get("message", ""), body.get("file_url", "")
    if not phone:
        raise HTTPException(status_code=400, detail="phone required")
    media = None
    if file_url:
        ext = file_url.rsplit(".", 1)[-1].lower() if "." in file_url else ""
        media = {"type": "image" if ext in _WA_IMAGE_EXT else "video" if ext in _WA_VIDEO_EXT else "document",
                 "url": file_url, "filename": file_url.rsplit("/", 1)[-1]}
    from services.wa_send import send_whatsapp
    res = await send_whatsapp(db, to=phone, text=message, media=media, kind="chat", channel="company",
                              typed_by=user["email"])
    return {"success": res["status"] in ("sent", "queued"), **res,
            "error": "" if res["status"] in ("sent", "queued") else res["reason"]}
```

- In `send_via_template`, replace the `else:` API branch (`:779-800`):

```python
    else:
        from services.wa_send import send_whatsapp
        res = await send_whatsapp(
            db, to=phone, text=msg, kind="chat", owner_email=user["email"], typed_by=user["email"],
            lead_id=body.get("lead_id") or "", contact_id=body.get("contact_id") or "",
            school_id=body.get("school_id") or "",
            ref={"template_id": body.get("template_id"), "order_id": body.get("order_id")})
        log_doc["status"] = res["status"] if res["status"] != "skipped" else f"skipped:{res['reason']}"
        log_doc["response"] = res["reason"] or None
        log_doc["wa_message_id"] = res["message_id"]
        log_doc["instance_name"] = res["instance_name"]
```

- In `_tag_broadcast_audience` projection (`:924-925`) add `"assigned_to": 1, "school_id": 1`.
- Delete `_send_wa_autosender` (`:960-971`).
- In `whatsapp_broadcast_by_tag`, replace the `wa_settings` check (`:997-999`) with:

```python
    from services.wa_send import send_whatsapp, wa_available
    if not await wa_available(db):
        raise HTTPException(status_code=400, detail="WhatsApp is not connected — link the company number in Settings → WhatsApp")
```

  and the send loop + return (`:1014-1046`) with:

```python
    counts = {"sent": 0, "queued": 0, "skipped": 0, "failed": 0}
    now_iso = datetime.now(timezone.utc).isoformat()
    for person in aud["recipients"]:
        lead = person["lead"]
        phone = person["phone"]
        school = lead.get("company_name") or lead.get("school_name") or ""
        msg = template_body.replace("{contact_name}", lead.get("contact_name") or "").replace("{school_name}", school)
        try:
            res = await send_whatsapp(
                db, to=phone, text=msg, kind="broadcast", owner_email=lead.get("assigned_to") or None,
                lead_id=lead.get("lead_id") or "", school_id=lead.get("school_id") or "", typed_by=user["email"],
                ref={"tag_id": tag_id, "lead_ids": person["lead_ids"], "template_id": template_id})
        except Exception as exc:
            res = {"status": "failed", "message_id": "", "reason": str(exc)[:200]}
        counts[res["status"]] = counts.get(res["status"], 0) + 1
        await db.whatsapp_logs.insert_one({
            "log_id": f"wal_{uuid.uuid4().hex[:10]}", "template_id": template_id, "phone": phone, "body": msg,
            "lead_id": lead.get("lead_id"), "lead_ids": person["lead_ids"], "send_mode": "broadcast_tag",
            "status": res["status"], "wa_message_id": res.get("message_id", ""), "reason": res.get("reason", ""),
            "sent_by": user["email"], "sent_at": now_iso})
    # `skipped` and `total` keep their old meanings for older callers: deals with no usable phone,
    # and deals considered. `skipped_policy` = refused by consent / opt-out / not on WhatsApp.
    return {"sent": counts["sent"], "queued": counts["queued"], "skipped_policy": counts["skipped"],
            "failed": counts["failed"], "skipped": aud["skipped_no_phone"], "total": aud["deals"],
            **_audience_counts(aud)}
```

**`backend/routes/whatsapp_routes.py`**

- Delete `from services.evolution_client import evolution` (`:13`); add `from services.wa_send import send_whatsapp`.
- In `launch_campaign` delete `send_delay = …` (`:557`) and the `send_delay=send_delay,` kwarg (`:565`).
- Replace `_send_campaign_background` (`:571-666`):

```python
async def _send_campaign_background(campaign_id: str, sched_ids: list, template: str,
                                    attachment_doc: Optional[dict], ai_enabled: bool):
    """AI-personalise each message, then hand it to send_whatsapp (W1, D3): each contact is sent
    from its owner's number (else the company's), with consent, caps and business hours enforced
    by the service — which also paces the sends, so there is no fixed delay here any more."""
    counts = {"sent": 0, "queued": 0, "skipped": 0, "failed": 0}
    for sched_id in sched_ids:
        doc = await db.whatsapp_scheduled.find_one({"scheduled_id": sched_id}, {"_id": 0})
        if not doc:
            continue
        try:
            personalised_msg = await personalize_message(template=template, contact=doc.get("contact_snapshot", {}),
                                                         campaign_name=doc.get("campaign_name", ""),
                                                         ai_enabled=ai_enabled)
        except Exception as exc:
            logger.error(f"Personalisation error for {sched_id}: {exc}")
            personalised_msg = template
        try:
            res = await send_whatsapp(db, to=doc["phone"], text=personalised_msg, media=attachment_doc, kind="campaign",
                                      contact_id=doc.get("contact_id") or "",
                                      ref={"campaign_id": campaign_id, "scheduled_id": sched_id,
                                           "dedup_key": f"camp:{campaign_id}:{sched_id}"})
        except Exception as exc:
            res = {"status": "failed", "message_id": "", "reason": str(exc)[:200]}
        counts[res["status"]] = counts.get(res["status"], 0) + 1
        await db.whatsapp_scheduled.update_one({"scheduled_id": sched_id}, {"$set": {
            "message": personalised_msg, "status": res["status"], "wa_msg_id": res.get("message_id", ""),
            "error": res.get("reason", ""), "sent_at": datetime.now(timezone.utc).isoformat()}})
    delivered = counts["sent"] + counts["queued"]
    final_status = "sent" if delivered else ("failed" if counts["failed"] else "queued")
    await db.whatsapp_campaigns.update_one({"campaign_id": campaign_id}, {"$set": {
        "status": final_status, "sent_count": delivered, "queued_count": counts["queued"],
        "skipped_count": counts["skipped"], "failed_count": counts["failed"],
        "updated_at": datetime.now(timezone.utc).isoformat()}})
    logger.info(f"Campaign {campaign_id} complete — {counts}")
```

**3b. Update the existing tests that stubbed the old helpers** (all under `backend/tests/`, all `git add -f`):

| File | Change |
|---|---|
| `test_contact_drip_executor.py` | fixture `env(monkeypatch)` → `env(monkeypatch, fake_evolution)`; delete `_fake_wa` and `monkeypatch.setattr(sched, "_send_wa", _fake_wa)`; add after the `for mod in …` loop: `from wa_fixtures import wire_wa` / `wire_wa(monkeypatch, d, fake_evolution)`; then `async def _rec(s): sent["wa"].append({"to": s["number"][2:], "text": s["text"]})` / `fake_evolution.on_send = _rec` / `fake_evolution.fail_if = lambda: bool(sent.get("wa_raises"))`. In `_providers` replace the `whatsapp_provider` insert with `from wa_fixtures import seed_wa` / `await seed_wa(db, settings={"drip_wa_enabled": True})`. Test bodies unchanged (`sent["wa"]` still holds 10-digit numbers; `sent["wa_raises"]` still makes the provider fail). |
| `test_drip_executor_concurrency.py` | fixture gains `fake_evolution`; delete `_fake_wa` + its `setattr`; add `wire_wa(monkeypatch, d, fake_evolution)` and `async def _rec(s): num = s["number"][2:]; sent["wa"].append(num); (await sent["on_send"](num)) if sent["on_send"] else None; await asyncio.sleep(0)` / `fake_evolution.on_send = _rec` (a raising `sent["on_send"]` — `boom` at `:182` — now propagates as the provider error, exactly as before). In `_seed` (`:89`) replace the `whatsapp_provider` insert with `await seed_wa(db, settings={"drip_wa_enabled": True})`. |
| `test_to_post_linking.py` | `:46` → `monkeypatch.setattr(sched, "send_whatsapp", _no_wa)` (no `raising=False`: the name must exist). |
| `test_wa_tag_broadcast.py` | `sender` fixture (`:70-78`) → `def sender(monkeypatch, db, fake_evolution):` `wire_wa(monkeypatch, db, fake_evolution)`; `calls = []`; `async def _rec(s): calls.append({"phone": s["number"], "message": s["text"]})`; `fake_evolution.on_send = _rec`; `return calls`. `_seed_common` (`:92`): replace the AutoSender settings insert with `await seed_wa(db)` + `await db.settings.insert_one({"type": "notifications", "require_wa_consent": False})`. Assertions: `:136` → `["919123456789", "919876543210"]`; `:248` → `["919000000001"]`. The `whatsapp_logs` assertions keep the raw phone (the log stores what the deal had). Add `from wa_fixtures import seed_wa, wire_wa`; update the docstring's "No real sends" paragraph to name `fake_evolution`. |
| `test_tag_scope.py` | `test_whatsapp_tag_broadcast_reaches_the_lead_at_a_school_surfaced_by_a_tagged_contact` (`:395`): signature adds `fake_evolution`; drop the `_FakeHttpClient` lines (`:397-398`); add `wire_wa(monkeypatch, db, fake_evolution)`; seed `await seed_wa(db)` + notifications `require_wa_consent: False` instead of the AutoSender settings (`:401`); expected dict gains `"queued": 0` is **not** asserted (keys unchanged); final assertion → `assert [s["number"] for s in fake_evolution.sends] == ["919222222222"]`. Delete `_FakeHttpClient` (`:374-392`) if nothing else uses it. |
| `test_auto_reminders_no_drip.py` | in `test_greetings_and_delegation_alerts_still_fire`, seed `await db.settings.insert_one({"type": "wa", "greetings_enabled": True})` before `_run_one_iteration`; after the two existing greeting assertions add `row = await db.whatsapp_scheduled.find_one({"rule_id": "gr1"}, {"_id": 0})` / `assert row["status"] == "skipped"` (no number linked → refused, never sent). |

**3c. Frontend** — create `frontend/src/lib/waStatus.js`:

```js
// Plain-words results of a WhatsApp send (statuses from backend services/wa_send.py).
const SKIP_REASONS = {
  opt_out: 'this person opted out of WhatsApp',
  no_consent: 'no WhatsApp consent on record for this school',
  not_on_whatsapp: 'this number is not on WhatsApp',
  no_sender: 'no WhatsApp number is connected (yours or the company’s)',
  bad_phone: 'this is not a mobile number',
  empty_message: 'the message is empty',
  sender_not_connected: 'that WhatsApp number is not connected',
  number_warming_up: 'the number is still warming up',
};

export function describeSkip(reason) {
  return SKIP_REASONS[reason] || reason || 'not sent';
}

export function describeSendResult(status) {
  if (status === 'sent') return { level: 'success', text: 'WhatsApp sent' };
  if (status === 'queued') {
    return { level: 'success', text: 'Queued — it goes out within business hours and the number’s limits' };
  }
  if (String(status || '').startsWith('skipped:')) {
    return { level: 'warning', text: `Not sent: ${describeSkip(String(status).slice(8))}` };
  }
  return { level: 'error', text: `Send failed${status && status !== 'failed' ? ` (${status})` : ''}` };
}

export function describeBroadcastResult(d) {
  const parts = [`${d.sent || 0} sent`];
  if (d.queued) parts.push(`${d.queued} queued for business hours / limits`);
  if (d.skipped_policy) parts.push(`${d.skipped_policy} not sent (opted out, no consent or not on WhatsApp)`);
  if (d.failed) parts.push(`${d.failed} failed`);
  let s = `Broadcast: ${parts.join(', ')}`;
  if (d.skipped_no_phone) s += `, ${d.skipped_no_phone} deal(s) with no usable phone`;
  if (d.capped_at) s += ` — capped at ${d.capped_at}, ${d.over_cap} not messaged`;
  return s;
}
```

`frontend/src/components/WhatsAppSendDialog.jsx` — add `import { describeSendResult } from '../lib/waStatus';` and replace
`:79-82` with:

```js
      const r = describeSendResult(res.data?.status);
      (toast[r.level] || toast)(r.text);
```

`frontend/src/hooks/useCRMMasters.js` — add `import { describeBroadcastResult } from '../lib/waStatus';` and replace the
`toast.success(\`Campaign sent: …\`)` statement (`:297-299`) with `toast.success(describeBroadcastResult(res.data));`.

**4. Run — expect pass** (every file this task touched, plus the W1 suites):

```bash
cd backend && DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 python -m pytest tests/test_wa_callers.py tests/test_contact_drip_executor.py tests/test_drip_executor_concurrency.py tests/test_to_post_linking.py tests/test_wa_tag_broadcast.py tests/test_tag_scope.py tests/test_auto_reminders_no_drip.py tests/test_drip_resume_guard.py tests/test_drip_physical_mailer.py tests/test_drip_to_offline_mail_chain.py tests/test_forms_reminders.py tests/test_webinar_loop.py tests/test_wa_send.py tests/test_wa_send_caps.py tests/test_wa_webhook.py tests/test_wa_routes.py tests/test_wa_health.py -q
cd backend && python -c "import main; print('app imports')"
cd frontend && npx craco test --watchAll=false --testPathPattern "waStatus|useCRMMasters"
```

Then prove nothing else sends: `grep -rn "messageautosender.com" backend --include=*.py | grep -v tests` must print only
`services/wa_send.py` (`AUTOSENDER_URL`), and `grep -rn "evolution\.send_\|_send_wa(" backend --include=*.py | grep -v tests`
must print nothing.

**5. Commit**

```bash
git add backend/scheduler.py backend/routes/admin_routes.py backend/routes/crm_routes.py backend/routes/school_routes.py backend/routes/fms_routes.py backend/fms_actions.py backend/routes/settings_routes.py backend/routes/whatsapp_routes.py frontend/src/lib/waStatus.js frontend/src/components/WhatsAppSendDialog.jsx frontend/src/hooks/useCRMMasters.js frontend/src/lib/__tests__/waStatus.test.js
git add -f backend/tests/test_wa_callers.py backend/tests/test_contact_drip_executor.py backend/tests/test_drip_executor_concurrency.py backend/tests/test_to_post_linking.py backend/tests/test_wa_tag_broadcast.py backend/tests/test_tag_scope.py backend/tests/test_auto_reminders_no_drip.py
git commit -m "refactor(wa): every WhatsApp send goes through send_whatsapp; WABA sender and six AutoSender copies removed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## Task 10 — Frontend: `waNumbers` API, `useMyWhatsApp`, the **My WhatsApp** page, nav entry, privacy notice

### Files

| Action | Path | Current refs |
|---|---|---|
| modify | `frontend/src/lib/api.js` | `whatsApp` export `:491-535` — add a new `waNumbers` export directly after it (`:536`) |
| create | `frontend/src/hooks/useMyWhatsApp.js` | new |
| create | `frontend/src/pages/MyWhatsApp.js` | new |
| create | `frontend/src/pages/__tests__/MyWhatsApp.test.js` | new |
| modify | `frontend/src/App.js` | lazy imports `:46-130`; routes (the `/today` route is at `:237`) |
| modify | `frontend/src/components/layouts/AdminSidebar.js` | icon import `:3`; user footer `:179-198` |
| modify | `frontend/src/components/layouts/SalesLayout.js` | icon import `:5`; header buttons `:78-90` |

`/me/whatsapp` is deliberately absent from `ProtectedRoute`'s `ROUTE_MODULE_MAP` (`components/ProtectedRoute.js:5-51`): like
`/today`, every logged-in staff user may open it.

### Interfaces

**Produces**
- `frontend/src/lib/api.js`: `export const waNumbers = { me, link(data), relink, unlink, instances, linkCompany(data),
  pause(name, reason), resume(name), unlinkInstance(name), setProxy(name, data), updateInstance(name, data), getSettings,
  saveSettings(data), getDefaultProxy, saveDefaultProxy(data) }` → the Task 7 routes.
- `frontend/src/hooks/useMyWhatsApp.js`: default `useMyWhatsApp({ pollMs = QR_POLL_MS }) -> { data, loading, busy, error,
  reload, link(label?), relink(), unlink() }` (polls `GET /wa/me` every 20 s while `state === "qr"`); named
  `QR_POLL_MS = 20000`, `warmupText(warmup) -> string` ("Day 4 of 14 — today 40 of 60"), `formatPhone(e164) -> "+91 98111 11111"`.
- `frontend/src/pages/MyWhatsApp.js` at `/me/whatsapp` — state badge, the privacy notice (always visible, and an "I understand"
  tick is required before linking), personal-number warning (D1: warns, never blocks), QR with 20-s refresh, "Connected as …",
  warm-up progress, Relink / Unlink.
- Nav: a "My WhatsApp" icon link in the admin sidebar's user footer and in the sales header (`data-testid="my-whatsapp-link"`).

**Consumes:** `GET /api/wa/me`, `POST /api/wa/me/link|relink|unlink` (Task 7).

### Steps

**1. Failing test** — `frontend/src/pages/__tests__/MyWhatsApp.test.js`:

```js
// My WhatsApp: the notice must be accepted before linking; the QR refreshes every 20 s; a linked
// number shows who it is and how far through warm-up it is. Rendered via react-dom/client.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import MyWhatsApp from '../MyWhatsApp';
import { waNumbers } from '../../lib/api';

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('../../components/layouts/AdminLayout', () => ({ children }) => <div>{children}</div>);
jest.mock('../../lib/api', () => ({
  waNumbers: { me: jest.fn(), link: jest.fn(), relink: jest.fn(), unlink: jest.fn() },
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const NOTICE = 'Every message this number sends or receives is visible to managers in the app. '
  + 'Link a company number, not your personal one.';

async function render() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => { root.render(<MyWhatsApp />); });
  await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
  const q = (id) => el.querySelector(`[data-testid="${id}"]`);
  return { el, q, root };
}

const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });

beforeEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = '';
});

test('linking needs the notice ticked, then asks the server to link', async () => {
  waNumbers.me.mockResolvedValue({ data: { linked: false, state: 'unlinked', notice: NOTICE, slots_full: false } });
  waNumbers.link.mockResolvedValue({ data: { state: 'qr', qr_base64: 'data:QR' } });
  const v = await render();
  expect(v.q('wa-notice').textContent).toBe(NOTICE);
  expect(v.q('wa-state').textContent).toBe('Not linked');
  expect(v.q('wa-link').disabled).toBe(true);
  act(() => { v.q('wa-accept').click(); });
  expect(v.q('wa-link').disabled).toBe(false);
  await act(async () => { v.q('wa-link').click(); });
  await flush();
  expect(waNumbers.link).toHaveBeenCalledWith({ notice_accepted: true, label: undefined });
  expect(waNumbers.me).toHaveBeenCalledTimes(2);          // reloads after linking
});

test('when every slot is taken the button says so and stays off', async () => {
  waNumbers.me.mockResolvedValue({ data: { linked: false, state: 'unlinked', notice: NOTICE, slots_full: true } });
  const v = await render();
  act(() => { v.q('wa-accept').click(); });
  expect(v.q('wa-slots-full')).not.toBeNull();
  expect(v.q('wa-link').disabled).toBe(true);
});

test('the QR is shown and re-fetched every 20 seconds while waiting for the scan', async () => {
  jest.useFakeTimers();
  waNumbers.me.mockResolvedValue({ data: { linked: true, state: 'qr', qr_base64: 'data:image/png;base64,QR',
    notice: NOTICE, warmup: { day: 1, of: 14, today_sent: 0, today_cap: 20 } } });
  const v = await render();
  expect(v.q('wa-qr').getAttribute('src')).toBe('data:image/png;base64,QR');
  expect(waNumbers.me).toHaveBeenCalledTimes(1);
  await act(async () => { jest.advanceTimersByTime(20000); });
  await flush();
  expect(waNumbers.me).toHaveBeenCalledTimes(2);
  jest.useRealTimers();
});

test('a connected number shows who it is and its warm-up', async () => {
  waNumbers.me.mockResolvedValue({ data: { linked: true, state: 'connected', phone_e164: '919811111111',
    notice: NOTICE, looks_personal: false, warmup: { day: 4, of: 14, today_sent: 40, today_cap: 60 } } });
  const v = await render();
  expect(v.q('wa-state').textContent).toBe('Connected');
  expect(v.q('wa-connected-as').textContent).toBe('Connected as +91 98111 11111');
  expect(v.q('wa-warmup').textContent).toBe('Day 4 of 14 — today 40 of 60');
  expect(v.q('wa-personal-warning')).toBeNull();
  expect(v.q('wa-relink')).not.toBeNull();
});

test('a personal-looking number is warned about, not blocked', async () => {
  waNumbers.me.mockResolvedValue({ data: { linked: true, state: 'connected', phone_e164: '919811111111',
    notice: NOTICE, looks_personal: true, warmup: { day: 20, of: 14, today_sent: 3, today_cap: 200 } } });
  const v = await render();
  expect(v.q('wa-personal-warning').textContent).toMatch(/personal number/);
  expect(v.q('wa-warmup').textContent).toBe('Warm-up done — today 3 of 200');
});

test('unlink asks first', async () => {
  window.confirm = jest.fn(() => false);
  waNumbers.me.mockResolvedValue({ data: { linked: true, state: 'connected', phone_e164: '919811111111',
    notice: NOTICE, warmup: { day: 4, of: 14, today_sent: 0, today_cap: 40 } } });
  const v = await render();
  await act(async () => { v.q('wa-unlink').click(); });
  expect(window.confirm).toHaveBeenCalled();
  expect(waNumbers.unlink).not.toHaveBeenCalled();
});
```

**2. Run — expect failure** (`Cannot find module '../MyWhatsApp'`).

```bash
cd frontend && npx craco test --watchAll=false --testPathPattern "MyWhatsApp"
```

**3. Implement.**

`frontend/src/lib/api.js` — after the closing `};` of `whatsApp` (`:535`):

```js
// WhatsApp team numbers (spec 2026-09-24, W1): my own number, and admin control of every number.
export const waNumbers = {
  me:              ()             => API.get('/wa/me'),
  link:            (data)         => API.post('/wa/me/link', data),
  relink:          ()             => API.post('/wa/me/relink'),
  unlink:          ()             => API.post('/wa/me/unlink'),
  instances:       ()             => API.get('/wa/instances'),
  linkCompany:     (data)         => API.post('/wa/instances/company', data),
  pause:           (name, reason) => API.post(`/wa/instances/${encodeURIComponent(name)}/pause`, { reason }),
  resume:          (name)         => API.post(`/wa/instances/${encodeURIComponent(name)}/resume`),
  unlinkInstance:  (name)         => API.post(`/wa/instances/${encodeURIComponent(name)}/unlink`),
  setProxy:        (name, data)   => API.put(`/wa/instances/${encodeURIComponent(name)}/proxy`, data),
  updateInstance:  (name, data)   => API.put(`/wa/instances/${encodeURIComponent(name)}`, data),
  getSettings:     ()             => API.get('/wa/settings'),
  saveSettings:    (data)         => API.put('/wa/settings', data),
  getDefaultProxy: ()             => API.get('/whatsapp/proxy-config'),
  saveDefaultProxy:(data)         => API.post('/whatsapp/proxy-config', data),
};
```

`frontend/src/hooks/useMyWhatsApp.js`:

```js
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { waNumbers } from '../lib/api';

// The QR WhatsApp shows rotates; the server refreshes ours when it is older than 20 s.
export const QR_POLL_MS = 20000;

export function warmupText(w) {
  if (!w) return '';
  if (w.of && w.day > w.of) return `Warm-up done — today ${w.today_sent} of ${w.today_cap}`;
  return `Day ${w.day} of ${w.of} — today ${w.today_sent} of ${w.today_cap}`;
}

export function formatPhone(e164) {
  const d = String(e164 || '');
  if (d.length === 12 && d.startsWith('91')) return `+91 ${d.slice(2, 7)} ${d.slice(7)}`;
  return d ? `+${d}` : '';
}

export default function useMyWhatsApp({ pollMs = QR_POLL_MS } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await waNumbers.me();
      setData(r.data);
      setError('');
    } catch (e) {
      setError(e?.response?.data?.detail || 'Could not load your WhatsApp status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const state = data?.state;
  useEffect(() => {
    if (state !== 'qr') return undefined;              // poll only while waiting for the scan
    const iv = setInterval(load, pollMs);
    return () => clearInterval(iv);
  }, [state, load, pollMs]);

  const run = useCallback(async (fn, okText) => {
    setBusy(true);
    try {
      await fn();
      if (okText) toast.success(okText);
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }, [load]);

  return {
    data, loading, busy, error, reload: load,
    link: (label) => run(() => waNumbers.link({ notice_accepted: true, label }),
      'Now scan the QR code with the company phone'),
    relink: () => run(() => waNumbers.relink(), 'Scan the new QR code'),
    unlink: () => run(() => waNumbers.unlink(), 'Number unlinked'),
  };
}
```

`frontend/src/pages/MyWhatsApp.js`:

```jsx
import React, { useState } from 'react';
import AdminLayout from '../components/layouts/AdminLayout';
import useMyWhatsApp, { warmupText, formatPhone } from '../hooks/useMyWhatsApp';

const NOTICE_FALLBACK = 'Every message this number sends or receives is visible to managers in the app. '
  + 'Link a company number, not your personal one.';
const STATE_LABEL = { unlinked: 'Not linked', qr: 'Waiting for scan', connected: 'Connected',
  disconnected: 'Disconnected', paused: 'Paused' };
const STATE_TONE = {
  connected: 'bg-green-500/15 text-green-600', qr: 'bg-amber-500/15 text-amber-600',
  disconnected: 'bg-red-500/15 text-red-600', paused: 'bg-red-500/15 text-red-600', unlinked: 'bg-gray-500/15 text-gray-500',
};
const BTN = 'px-3 py-2 rounded-lg text-sm font-medium border border-[var(--border-color)] '
  + 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50';

export default function MyWhatsApp() {
  const wa = useMyWhatsApp();
  const [accepted, setAccepted] = useState(false);
  const d = wa.data || {};
  const state = d.state || 'unlinked';

  const unlink = () => {
    if (window.confirm('Unlink this number? Your automated messages will go from the company number until you link again.')) {
      wa.unlink();
    }
  };

  return (
    <AdminLayout>
      <div className="max-w-xl mx-auto p-4 space-y-4" data-testid="my-whatsapp">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">My WhatsApp</h1>
          <span data-testid="wa-state" className={`text-xs px-2.5 py-1 rounded-full font-medium ${STATE_TONE[state] || ''}`}>
            {STATE_LABEL[state] || state}
          </span>
        </div>

        {wa.loading && <p className="text-sm text-[var(--text-muted)]">Loading…</p>}
        {wa.error && <p className="text-sm text-red-500">{wa.error}</p>}

        <div data-testid="wa-notice"
          className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-[var(--text-primary)]">
          {d.notice || NOTICE_FALLBACK}
        </div>

        {d.looks_personal && (
          <div data-testid="wa-personal-warning"
            className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600">
            This looks like your personal number (it matches the phone on your profile). If WhatsApp ever bans it,
            you lose your own WhatsApp too. Please link a company SIM instead.
          </div>
        )}
        {d.paused_reason && <p data-testid="wa-paused-reason" className="text-sm text-red-500">{d.paused_reason}</p>}

        {!wa.loading && state === 'unlinked' && (
          <div className="space-y-3">
            {d.slots_full && (
              <p data-testid="wa-slots-full" className="text-sm text-red-500">
                Every WhatsApp slot on the server is in use. Ask an admin before linking.
              </p>
            )}
            <label className="flex items-start gap-2 text-sm text-[var(--text-primary)]">
              <input type="checkbox" data-testid="wa-accept" checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)} className="mt-0.5" />
              I understand, and I am linking a company SIM.
            </label>
            <button type="button" data-testid="wa-link" className={BTN}
              disabled={!accepted || wa.busy || !!d.slots_full} onClick={() => wa.link()}>
              Link a WhatsApp number
            </button>
          </div>
        )}

        {state === 'qr' && (
          <div className="space-y-2 text-center">
            {d.qr_base64
              ? <img data-testid="wa-qr" src={d.qr_base64} alt="WhatsApp QR code" className="mx-auto w-64 h-64 bg-white p-2 rounded-xl" />
              : <p className="text-sm text-[var(--text-muted)]">Preparing the QR code…</p>}
            <p className="text-xs text-[var(--text-muted)]">
              On the company phone open WhatsApp → Settings → Linked devices → Link a device, and scan this code.
              It refreshes every 20 seconds.
            </p>
          </div>
        )}

        {['connected', 'paused', 'disconnected'].includes(state) && (
          <div className="space-y-1">
            {d.phone_e164 && (
              <p data-testid="wa-connected-as" className="text-sm text-[var(--text-primary)]">
                {state === 'connected' ? 'Connected as' : 'Linked number'} {formatPhone(d.phone_e164)}
              </p>
            )}
            <p data-testid="wa-warmup" className="text-sm text-[var(--text-muted)]">{warmupText(d.warmup)}</p>
          </div>
        )}

        {!wa.loading && state !== 'unlinked' && (
          <div className="flex gap-2">
            <button type="button" data-testid="wa-relink" className={BTN} disabled={wa.busy} onClick={wa.relink}>Relink</button>
            <button type="button" data-testid="wa-unlink" className={BTN} disabled={wa.busy} onClick={unlink}>Unlink</button>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
```

`frontend/src/App.js` — add with the other lazy pages: `const MyWhatsApp = lazyRoute(() => import('./pages/MyWhatsApp'));`
and next to the `/today` route: `<Route path="/me/whatsapp" element={<ProtectedRoute><MyWhatsApp /></ProtectedRoute>} />`.

`frontend/src/components/layouts/AdminSidebar.js` — import: `import { Sun, Moon, X, LogOut, CalendarDays, ChevronDown, MessageCircle } from 'lucide-react';`
and in the user footer, directly before the logout `<button onClick={onLogout} …>`:

```jsx
          <Link
            to="/me/whatsapp"
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-green-600 hover:bg-green-50 transition-colors flex-shrink-0"
            title="My WhatsApp"
            data-testid="my-whatsapp-link"
          >
            <MessageCircle className="h-3.5 w-3.5" />
          </Link>
```

`frontend/src/components/layouts/SalesLayout.js` — add `MessageCircle` to the lucide import (`:5`) and, before the logout
button (`:85`):

```jsx
            <Link to="/me/whatsapp"
              className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-green-50 text-[var(--text-muted)] hover:text-green-600 transition-colors"
              title="My WhatsApp"
              data-testid="my-whatsapp-link">
              <MessageCircle className="h-4 w-4" />
            </Link>
```

**4. Run — expect pass.**

```bash
cd frontend && npx craco test --watchAll=false --testPathPattern "MyWhatsApp|waStatus"
```

**5. Commit**

```bash
git add frontend/src/lib/api.js frontend/src/hooks/useMyWhatsApp.js frontend/src/pages/MyWhatsApp.js frontend/src/pages/__tests__/MyWhatsApp.test.js frontend/src/App.js frontend/src/components/layouts/AdminSidebar.js frontend/src/components/layouts/SalesLayout.js
git commit -m "feat(wa): My WhatsApp page - link a company SIM by QR, privacy notice, warm-up progress, relink/unlink

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 11 — Frontend: admin **Settings → WhatsApp** replaces `WhatsAppConnectionSection` and the Setup provider form

### Files

| Action | Path | Current refs |
|---|---|---|
| create | `frontend/src/components/settings/WhatsAppNumbersSection.js` | new |
| create | `frontend/src/components/settings/__tests__/WhatsAppNumbersSection.test.js` | new (directory exists: `RecentlyDeleted.test.js`) |
| modify | `frontend/src/pages/admin/AppSettings.js` | import `:19`; whatsapp tab `:145-149` |
| modify | `frontend/src/hooks/useAppSettings.js` | `const [activeTab, setActiveTab] = useState('company');` `:10` |
| delete | `frontend/src/components/settings/WhatsAppConnectionSection.js` | 399 lines; only importer is `AppSettings.js:19` |
| modify | `frontend/src/components/marketing/SetupTab.js` | imports `:1-11`; provider form + instance list `:13-242`; blueprint `:243-274` kept |
| modify | `frontend/src/pages/admin/MarketingHub.js` | QR state `:44-47`; `openQrDialog`/`refreshQr`/poll effect `:74-118`; QR `<Dialog>` `:209-278` |
| modify | `frontend/src/lib/api.js` | remove `instanceConnect`, `instanceQR`, `instanceLogout`, `listInstances`, `createInstance`, `deleteInstance`, `instanceQRFor`, `instanceStatusFor`, `getProxy`, `setProxy`, `getProxyConfig`, `saveProxyConfig` (`:510-525`); keep `instanceStatus` |

### Interfaces

**Produces**
- `WhatsAppNumbersSection` (default export, no props): instance table (who, number, state, sent today / cap, last seen,
  proxy host, Pause/Resume/Unlink/Cap/Proxy), "Link company number" (notice + QR with 20-s status poll), free-RAM line with
  the D7 warning and `used / max_instances`, caps & business-hours form (every `wa.*` key), opt-out keywords, fallback
  provider (`none` / `autosender`), the two Rollout switches (`drip_wa_enabled`, `greetings_enabled`), and the default
  proxy form. All `data-testid`s prefixed `wa-admin-`.
- `useAppSettings` opens the tab named in `?tab=` (so alerts and MarketingHub can deep-link `/app-settings?tab=whatsapp`).
- `SetupTab` keeps its props (`tk, waConnected, setWaConnected, evolutionState, openQrDialog`) and the Blueprint; the WABA
  provider form, the wrong webhook URL (`/api/whatsapp/webhook`) and the second instance list are gone.
- `MarketingHub.openQrDialog()` navigates to `/app-settings?tab=whatsapp`.

**Consumes:** `waNumbers.*` (Task 10) → Task 7 routes.

### Steps

**1. Failing test** — `frontend/src/components/settings/__tests__/WhatsAppNumbersSection.test.js`:

```js
// Settings → WhatsApp: every number, its state and cap, RAM headroom, and the wa.* settings.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import WhatsAppNumbersSection from '../WhatsAppNumbersSection';
import { waNumbers } from '../../../lib/api';

global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('../../../lib/api', () => ({
  waNumbers: {
    instances: jest.fn(), getDefaultProxy: jest.fn(), linkCompany: jest.fn(), pause: jest.fn(), resume: jest.fn(),
    unlinkInstance: jest.fn(), updateInstance: jest.fn(), setProxy: jest.fn(), saveSettings: jest.fn(),
    saveDefaultProxy: jest.fn(),
  },
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const SETTINGS = {
  warmup_start_cap: 20, warmup_double_every_days: 3, warmup_days: 14, daily_cap: 200, hourly_cap: 30,
  gap_min_s: 8, gap_max_s: 25, business_start: '09:00', business_end: '19:00', per_contact_per_day: 1,
  failure_pause_after: 5, number_check_ttl_days: 30, opt_out_keywords: ['STOP', 'UNSUBSCRIBE'],
  fallback_provider: 'none', max_instances: 4, drip_wa_enabled: false, greetings_enabled: false,
};
const LIST = {
  instances: [
    { instance_name: 'smartshape', kind: 'company', label: 'Company', owner_name: '', phone_e164: '919000000001',
      state: 'connected', warmup: { day: 30, of: 14, today_sent: 12, today_cap: 200 }, proxy: { host: '' },
      last_seen_at: '2026-09-24T05:00:00+00:00' },
    { instance_name: 'rep_parul', kind: 'rep', label: 'Parul', owner_name: 'Parul', phone_e164: '919000000111',
      state: 'paused', paused_reason: '5 sends in a row failed.', warmup: { day: 4, of: 14, today_sent: 12, today_cap: 40 },
      proxy: { host: 'gate.decodo.com' }, last_seen_at: null },
  ],
  max_instances: 4, used: 2, company_instance: 'smartshape',
  health: { mem_available_mb: 420, mem_total_mb: 3900, evolution_mem_mb: 1100, headroom_ok: false, min_headroom_mb: 500 },
  settings: SETTINGS,
};

async function render() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  await act(async () => { createRoot(el).render(<WhatsAppNumbersSection />); });
  await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
  return { el, q: (id) => el.querySelector(`[data-testid="${id}"]`) };
}
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });

beforeEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = '';
  waNumbers.instances.mockResolvedValue({ data: LIST });
  waNumbers.getDefaultProxy.mockResolvedValue({ data: { enabled: false, host: '', port: '', protocol: 'socks5',
    username: '', has_password: false } });
  waNumbers.saveSettings.mockResolvedValue({ data: SETTINGS });
  waNumbers.pause.mockResolvedValue({ data: {} });
  waNumbers.resume.mockResolvedValue({ data: {} });
});

test('each number shows who, state and today against its cap', async () => {
  const v = await render();
  expect(v.q('wa-admin-row-rep_parul').textContent).toMatch(/Parul/);
  expect(v.q('wa-admin-row-rep_parul').textContent).toMatch(/Paused/);
  expect(v.q('wa-admin-today-rep_parul').textContent).toBe('12 / 40');
  expect(v.q('wa-admin-today-smartshape').textContent).toBe('12 / 200');
  expect(v.q('wa-admin-slots').textContent).toBe('2 of 4 WhatsApp slots in use');
});

test('low server memory is spelled out', async () => {
  const v = await render();
  expect(v.q('wa-admin-ram').textContent).toMatch(/420 MB free of 3900 MB/);
  expect(v.q('wa-admin-ram-warning')).not.toBeNull();
});

test('a paused number offers Resume, a connected one Pause with a reason', async () => {
  window.prompt = jest.fn(() => 'Complaint from a school');
  const v = await render();
  await act(async () => { v.q('wa-admin-resume-rep_parul').click(); });
  expect(waNumbers.resume).toHaveBeenCalledWith('rep_parul');
  await act(async () => { v.q('wa-admin-pause-smartshape').click(); });
  expect(waNumbers.pause).toHaveBeenCalledWith('smartshape', 'Complaint from a school');
});

test('saving settings sends numbers as numbers and keywords as a list', async () => {
  const v = await render();
  const hourly = v.q('wa-admin-set-hourly_cap');
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(hourly, '20');
    hourly.dispatchEvent(new Event('input', { bubbles: true }));
    const kw = v.q('wa-admin-set-keywords');
    setter.call(kw, 'STOP, बंद , ');
    kw.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => { v.q('wa-admin-save-settings').click(); });
  const body = waNumbers.saveSettings.mock.calls[0][0];
  expect(body.hourly_cap).toBe(20);
  expect(body.opt_out_keywords).toEqual(['STOP', 'बंद']);
  expect(body.drip_wa_enabled).toBe(false);
});

test('linking the company number needs the notice and then shows its QR', async () => {
  waNumbers.linkCompany.mockResolvedValue({ data: { instance_name: 'smartshape', state: 'qr', qr_base64: 'data:QR' } });
  const v = await render();
  expect(v.q('wa-admin-link-company').disabled).toBe(true);
  act(() => { v.q('wa-admin-accept').click(); });
  await act(async () => { v.q('wa-admin-link-company').click(); });
  await flush();
  expect(waNumbers.linkCompany).toHaveBeenCalledWith({ notice_accepted: true });
  expect(v.q('wa-admin-company-qr').getAttribute('src')).toBe('data:QR');
});
```

**2. Run — expect failure.**

```bash
cd frontend && npx craco test --watchAll=false --testPathPattern "WhatsAppNumbersSection"
```

**3. Implement.**

`frontend/src/components/settings/WhatsAppNumbersSection.js`:

```jsx
import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { waNumbers } from '../../lib/api';

const NOTICE = 'Every message this number sends or receives is visible to managers in the app. '
  + 'Link a company number, not your personal one.';
const STATE_LABEL = { unlinked: 'Unlinked', qr: 'Waiting for scan', connected: 'Connected',
  disconnected: 'Disconnected', paused: 'Paused' };
const NUMERIC = ['warmup_start_cap', 'warmup_double_every_days', 'warmup_days', 'daily_cap', 'hourly_cap', 'gap_min_s',
  'gap_max_s', 'per_contact_per_day', 'failure_pause_after', 'number_check_ttl_days', 'max_instances'];
const FIELDS = [
  ['hourly_cap', 'Messages per hour, per number'],
  ['daily_cap', 'Messages per day, per number (after warm-up)'],
  ['warmup_start_cap', 'Warm-up: first-day limit'],
  ['warmup_double_every_days', 'Warm-up: double every N days'],
  ['warmup_days', 'Warm-up length (days) — no campaigns before this'],
  ['gap_min_s', 'Shortest gap between automated sends (seconds)'],
  ['gap_max_s', 'Longest gap between automated sends (seconds)'],
  ['per_contact_per_day', 'Marketing messages per person per day'],
  ['failure_pause_after', 'Pause a number after this many failures in a row'],
  ['number_check_ttl_days', 'Re-check "is this number on WhatsApp" after (days)'],
  ['max_instances', 'Most numbers this server may hold (D7)'],
];
const BTN = 'px-2.5 py-1.5 rounded-lg text-xs font-medium border border-[var(--border-color)] '
  + 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50';
const INPUT = 'w-full px-2 py-1.5 rounded-lg text-sm bg-[var(--bg-primary)] border border-[var(--border-color)] '
  + 'text-[var(--text-primary)]';

const fmtPhone = (e) => (e && e.length === 12 && e.startsWith('91') ? `+91 ${e.slice(2, 7)} ${e.slice(7)}` : (e ? `+${e}` : '—'));
const fmtWhen = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : '—');

export default function WhatsAppNumbersSection() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [keywords, setKeywords] = useState('');
  const [proxy, setProxy] = useState({ enabled: false, host: '', port: '', protocol: 'socks5', username: '', password: '' });
  const [accepted, setAccepted] = useState(false);
  const [companyQr, setCompanyQr] = useState('');
  const [editProxy, setEditProxy] = useState(null);   // {name, host, port, protocol, username, password}
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [list, dp] = await Promise.all([waNumbers.instances(), waNumbers.getDefaultProxy()]);
    setData(list.data);
    setForm(list.data.settings);
    setKeywords((list.data.settings.opt_out_keywords || []).join(', '));
    setProxy({ ...dp.data, password: '' });
    return list.data;
  }, []);

  useEffect(() => { load().catch((e) => toast.error(e?.response?.data?.detail || 'Could not load WhatsApp numbers')); }, [load]);

  useEffect(() => {                                   // while the company QR is up, watch for the scan
    if (!companyQr) return undefined;
    const iv = setInterval(async () => {
      const d = await load();
      const c = (d.instances || []).find((i) => i.kind === 'company');
      if (c && c.state === 'connected') { setCompanyQr(''); toast.success('Company number connected'); }
    }, 20000);
    return () => clearInterval(iv);
  }, [companyQr, load]);

  const act = async (fn, okText) => {
    setBusy(true);
    try { const r = await fn(); if (okText) toast.success(okText); await load(); return r; }
    catch (e) { toast.error(e?.response?.data?.detail || 'Something went wrong'); return null; }
    finally { setBusy(false); }
  };

  const linkCompany = async () => {
    const r = await act(() => waNumbers.linkCompany({ notice_accepted: true }));
    if (r?.data?.qr_base64) setCompanyQr(r.data.qr_base64);
    else if (r?.data?.state === 'connected') toast.success('Company number connected');
  };
  const pause = (name) => {
    const reason = window.prompt('Why pause this number? (shown to its owner)');
    if (reason === null) return;
    act(() => waNumbers.pause(name, reason), 'Number paused');
  };
  const setCap = (inst) => {
    const v = window.prompt('Daily limit for this number (empty = follow the warm-up ramp)', inst.daily_cap_override ?? '');
    if (v === null) return;
    act(() => waNumbers.updateInstance(inst.instance_name, { daily_cap_override: v.trim() === '' ? null : Number(v) }), 'Limit saved');
  };
  const saveSettings = () => {
    const body = { ...form };
    NUMERIC.forEach((k) => { body[k] = Number(body[k]); });
    body.opt_out_keywords = keywords.split(',').map((s) => s.trim()).filter(Boolean);
    act(() => waNumbers.saveSettings(body), 'WhatsApp settings saved');
  };

  if (!data || !form) return <p className="text-sm text-[var(--text-muted)]">Loading WhatsApp numbers…</p>;
  const h = data.health || {};
  const company = (data.instances || []).find((i) => i.kind === 'company');

  return (
    <div className="space-y-5" data-testid="wa-admin">
      {/* Capacity and memory (D7) */}
      <div className="rounded-xl border border-[var(--border-color)] p-4 space-y-1">
        <p data-testid="wa-admin-slots" className="text-sm font-semibold text-[var(--text-primary)]">
          {data.used} of {data.max_instances} WhatsApp slots in use
        </p>
        <p data-testid="wa-admin-ram" className="text-xs text-[var(--text-muted)]">
          {h.mem_available_mb != null
            ? `Server memory: ${h.mem_available_mb} MB free of ${h.mem_total_mb} MB · WhatsApp uses ${h.evolution_mem_mb} MB · checked ${fmtWhen(h.at)}`
            : 'Server memory: not reported yet (the hourly host check has not run).'}
        </p>
        {h.headroom_ok === false && (
          <p data-testid="wa-admin-ram-warning" className="text-xs text-red-500">
            Less than {h.min_headroom_mb} MB free — do not link another number until the server is upgraded.
          </p>
        )}
      </div>

      {/* Every number */}
      <div className="rounded-xl border border-[var(--border-color)] overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-[var(--text-muted)]">
              <th className="p-2">Who</th><th className="p-2">Number</th><th className="p-2">State</th>
              <th className="p-2">Today / limit</th><th className="p-2">Last seen</th><th className="p-2">Proxy</th><th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {(data.instances || []).map((i) => (
              <tr key={i.instance_name} data-testid={`wa-admin-row-${i.instance_name}`} className="border-t border-[var(--border-color)]">
                <td className="p-2">{i.kind === 'company' ? 'Company' : (i.owner_name || i.label || i.owner_email)}</td>
                <td className="p-2">{fmtPhone(i.phone_e164)}</td>
                <td className="p-2" title={i.paused_reason || ''}>{STATE_LABEL[i.state] || i.state}</td>
                <td className="p-2" data-testid={`wa-admin-today-${i.instance_name}`}>{i.warmup.today_sent} / {i.warmup.today_cap}</td>
                <td className="p-2">{fmtWhen(i.last_seen_at)}</td>
                <td className="p-2">{(i.proxy && i.proxy.host) || '—'}</td>
                <td className="p-2 whitespace-nowrap space-x-1">
                  {i.state === 'paused'
                    ? <button type="button" className={BTN} disabled={busy} data-testid={`wa-admin-resume-${i.instance_name}`}
                        onClick={() => act(() => waNumbers.resume(i.instance_name), 'Number resumed')}>Resume</button>
                    : <button type="button" className={BTN} disabled={busy || i.state === 'unlinked'} data-testid={`wa-admin-pause-${i.instance_name}`}
                        onClick={() => pause(i.instance_name)}>Pause</button>}
                  <button type="button" className={BTN} disabled={busy} onClick={() => setCap(i)}>Limit</button>
                  <button type="button" className={BTN} disabled={busy}
                    onClick={() => setEditProxy({ name: i.instance_name, host: i.proxy?.host || '', port: i.proxy?.port || '',
                      protocol: i.proxy?.protocol || 'socks5', username: i.proxy?.username || '', password: '' })}>Proxy</button>
                  <button type="button" className={BTN} disabled={busy || i.state === 'unlinked'}
                    onClick={() => { if (window.confirm(`Unlink ${fmtPhone(i.phone_e164)}?`)) act(() => waNumbers.unlinkInstance(i.instance_name), 'Unlinked'); }}>Unlink</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editProxy && (
        <div className="rounded-xl border border-[var(--border-color)] p-4 grid grid-cols-2 gap-2" data-testid="wa-admin-proxy-editor">
          <p className="col-span-2 text-sm font-semibold text-[var(--text-primary)]">Proxy for {editProxy.name} (leave host empty to turn it off)</p>
          {['host', 'port', 'username', 'password'].map((k) => (
            <input key={k} className={INPUT} placeholder={k === 'password' ? 'password (empty = keep)' : k}
              type={k === 'password' ? 'password' : 'text'} value={editProxy[k]}
              onChange={(e) => setEditProxy({ ...editProxy, [k]: e.target.value })} />
          ))}
          <select className={INPUT} value={editProxy.protocol} onChange={(e) => setEditProxy({ ...editProxy, protocol: e.target.value })}>
            {['socks5', 'socks4', 'http', 'https'].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <div className="flex gap-2">
            <button type="button" className={BTN} disabled={busy}
              onClick={async () => { const { name, ...body } = editProxy; await act(() => waNumbers.setProxy(name, body), 'Proxy saved'); setEditProxy(null); }}>Save</button>
            <button type="button" className={BTN} onClick={() => setEditProxy(null)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Company number */}
      <div className="rounded-xl border border-[var(--border-color)] p-4 space-y-2">
        <p className="text-sm font-semibold text-[var(--text-primary)]">Company number</p>
        <p className="text-xs text-[var(--text-muted)]">
          {company ? `${fmtPhone(company.phone_e164)} — ${STATE_LABEL[company.state] || company.state}` : 'Not linked yet.'}
          {' '}It sends for every record whose owner has no connected number.
        </p>
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-[var(--text-primary)]">{NOTICE}</div>
        <label className="flex items-center gap-2 text-xs text-[var(--text-primary)]">
          <input type="checkbox" data-testid="wa-admin-accept" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
          I understand.
        </label>
        <button type="button" className={BTN} data-testid="wa-admin-link-company" disabled={!accepted || busy} onClick={linkCompany}>
          {company && company.state !== 'unlinked' ? 'Relink company number' : 'Link company number'}
        </button>
        {companyQr && (
          <div className="text-center space-y-1">
            <img data-testid="wa-admin-company-qr" src={companyQr} alt="Company WhatsApp QR code" className="mx-auto w-56 h-56 bg-white p-2 rounded-xl" />
            <p className="text-xs text-[var(--text-muted)]">Scan with the company phone: WhatsApp → Linked devices → Link a device.</p>
          </div>
        )}
      </div>

      {/* Limits, business hours, keywords, fallback, rollout switches */}
      <div className="rounded-xl border border-[var(--border-color)] p-4 space-y-3">
        <p className="text-sm font-semibold text-[var(--text-primary)]">Sending rules (every number)</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {FIELDS.map(([k, label]) => (
            <label key={k} className="text-xs text-[var(--text-muted)] space-y-1">
              <span>{label}</span>
              <input className={INPUT} data-testid={`wa-admin-set-${k}`} type="number" value={form[k]}
                onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            </label>
          ))}
          {[['business_start', 'Automations start (IST)'], ['business_end', 'Automations stop (IST)']].map(([k, label]) => (
            <label key={k} className="text-xs text-[var(--text-muted)] space-y-1">
              <span>{label}</span>
              <input className={INPUT} data-testid={`wa-admin-set-${k}`} type="time" value={form[k]}
                onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            </label>
          ))}
        </div>
        <label className="block text-xs text-[var(--text-muted)] space-y-1">
          <span>Opt-out words (comma separated) — a reply with one of these stops automated messages</span>
          <input className={INPUT} data-testid="wa-admin-set-keywords" value={keywords} onChange={(e) => setKeywords(e.target.value)} />
        </label>
        <label className="block text-xs text-[var(--text-muted)] space-y-1">
          <span>If no WhatsApp number can send</span>
          <select className={INPUT} data-testid="wa-admin-set-fallback" value={form.fallback_provider}
            onChange={(e) => setForm({ ...form, fallback_provider: e.target.value })}>
            <option value="none">Do not send (recommended)</option>
            <option value="autosender">Use MessageAutoSender (emergency, needs its login in Settings → WhatsApp below)</option>
          </select>
        </label>
        {[['drip_wa_enabled', 'Send WhatsApp drip steps (off = held, not skipped)'],
          ['greetings_enabled', 'Send greeting WhatsApps (festival / birthday)']].map(([k, label]) => (
          <label key={k} className="flex items-center gap-2 text-xs text-[var(--text-primary)]">
            <input type="checkbox" data-testid={`wa-admin-set-${k}`} checked={!!form[k]}
              onChange={(e) => setForm({ ...form, [k]: e.target.checked })} />
            {label}
          </label>
        ))}
        <button type="button" className={BTN} data-testid="wa-admin-save-settings" disabled={busy} onClick={saveSettings}>Save sending rules</button>
      </div>

      {/* Default proxy for newly linked numbers */}
      <div className="rounded-xl border border-[var(--border-color)] p-4 grid grid-cols-2 gap-2">
        <p className="col-span-2 text-sm font-semibold text-[var(--text-primary)]">Default proxy for newly linked numbers</p>
        {['host', 'port', 'username', 'password'].map((k) => (
          <input key={k} className={INPUT} placeholder={k === 'password' ? (proxy.has_password ? 'password (saved — empty keeps it)' : 'password') : k}
            type={k === 'password' ? 'password' : 'text'} value={proxy[k] ?? ''}
            onChange={(e) => setProxy({ ...proxy, [k]: e.target.value })} />
        ))}
        <select className={INPUT} value={proxy.protocol || 'socks5'} onChange={(e) => setProxy({ ...proxy, protocol: e.target.value })}>
          {['socks5', 'socks4', 'http', 'https'].map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <button type="button" className={BTN} disabled={busy}
          onClick={() => act(() => waNumbers.saveDefaultProxy({ ...proxy, enabled: !!proxy.host }), 'Default proxy saved')}>Save proxy</button>
      </div>
    </div>
  );
}
```

`frontend/src/pages/admin/AppSettings.js` — `:19` becomes
`import WhatsAppNumbersSection from '../../components/settings/WhatsAppNumbersSection';` and `:147`
`<WhatsAppConnectionSection />` becomes `<WhatsAppNumbersSection />`. (The `SecuritySection` below it stays: it holds the
MessageAutoSender login the fallback needs and the "send a test message" box, which now goes through `/whatsapp/send` →
company number.)

`frontend/src/hooks/useAppSettings.js` `:10`:

```js
  const [activeTab, setActiveTab] = useState(() => {
    try { return new URLSearchParams(window.location.search).get('tab') || 'company'; } catch { return 'company'; }
  });
```

Delete `frontend/src/components/settings/WhatsAppConnectionSection.js` (`git rm`).

`frontend/src/components/marketing/SetupTab.js` — replace `:1-11` (imports) with:

```js
import React from 'react';
import { Wifi, WifiOff, Target, Users, MessageSquare, FileText, Gift, RefreshCw, Smartphone as PhoneIcon } from 'lucide-react';
```

and replace `:13-242` (from `export default function SetupTab(` through the line before `{/* Expert marketing plan summary */}`) with:

```jsx
export default function SetupTab({ tk, waConnected, openQrDialog }) {
  return (
    <div className="space-y-5">
      {/* Status bar — the company number (spec 2026-09-24, W1) */}
      <div className={`${tk.card} border ${waConnected ? 'border-green-500/30' : 'border-[var(--border-color)]'} rounded-xl p-4`}>
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${waConnected ? 'bg-green-500/15' : 'bg-[var(--bg-primary)]'}`}>
            {waConnected ? <Wifi className="h-5 w-5 text-green-500" /> : <WifiOff className="h-5 w-5 text-gray-400" />}
          </div>
          <div className="flex-1">
            <p className={`text-sm font-semibold ${tk.t1}`}>{waConnected ? 'Company WhatsApp connected' : 'Company WhatsApp not connected'}</p>
            <p className={`text-xs ${tk.tm} mt-0.5`}>
              Campaigns go from each contact owner's own number, or the company number when the owner has none.
            </p>
          </div>
        </div>
      </div>

      {/* Numbers are managed in one place now */}
      <div className={`${tk.card} border ${tk.bdr} rounded-xl p-4 flex items-center gap-3`}>
        <PhoneIcon className={`h-4 w-4 ${tk.tm}`} />
        <p className={`text-sm ${tk.t1} flex-1`}>
          WhatsApp numbers, limits and business hours are managed in Settings → WhatsApp. Each salesperson links their
          company SIM on My WhatsApp.
        </p>
        <button type="button" onClick={openQrDialog} data-testid="setup-open-wa-settings"
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--border-color)] ${tk.t1}`}>
          Open Settings → WhatsApp
        </button>
      </div>

```

(the replaced text ends right before the unchanged `{/* Expert marketing plan summary */}` block, whose closing `</div>`s
and `);}` close the new `return`).

`frontend/src/pages/admin/MarketingHub.js` — delete `qrDialog`, `qrData`, `qrLoading` state (`:45-47`), `openQrDialog`,
`refreshQr` and the poll effect (`:74-118`), and the QR `<Dialog>` block (`:209-278`); add:

```js
  // Numbers are linked in Settings → WhatsApp now (W1); every "Connect" button goes there.
  const openQrDialog = () => { window.location.assign('/app-settings?tab=whatsapp'); };
```

Remove the now-unused `Dialog…` import (`:8`) and any icon imports only the dialog used (`grep -n "RefreshCw\|QrCode" MarketingHub.js`).

`frontend/src/lib/api.js` — delete the `whatsApp` entries listed in Files (`:510-525`), keeping `instanceStatus`. Then:

```bash
cd frontend && grep -rn "instanceConnect\|instanceQR\|instanceLogout\|listInstances\|createInstance\|deleteInstance\|instanceStatusFor\|getProxyConfig\|saveProxyConfig\|waApi.getProxy\|waApi.setProxy\|WhatsAppConnectionSection" src --include=*.js --include=*.jsx | grep -v __tests__
```

must print nothing.

**4. Run — expect pass** (and the suites that render these screens' neighbours):

```bash
cd frontend && npx craco test --watchAll=false --testPathPattern "WhatsAppNumbersSection|MyWhatsApp|RecentlyDeleted|waStatus|useCRMMasters"
```

**5. Commit**

```bash
git rm frontend/src/components/settings/WhatsAppConnectionSection.js
git add frontend/src/components/settings/WhatsAppNumbersSection.js frontend/src/components/settings/__tests__/WhatsAppNumbersSection.test.js frontend/src/pages/admin/AppSettings.js frontend/src/hooks/useAppSettings.js frontend/src/components/marketing/SetupTab.js frontend/src/pages/admin/MarketingHub.js frontend/src/lib/api.js
git commit -m "feat(wa): Settings -> WhatsApp admin page (numbers, limits, RAM, fallback, proxy); retire the old connection form and Setup provider form

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## Task 12 — OPERATIONAL: Evolution upgrade runbook (owner present), new compose + env files

This task changes four files in the repo (two commits) and then runs a **runbook on the VPS with the owner present**. It is
not app code, and it is not done by pushing the app to `main`.

### Files

| Action | Path | Current refs |
|---|---|---|
| modify (rewrite) | `docker-compose.evolution.yml` | `:1-140` — pins `atendai/evolution-api:v2.2.3` (`:70`), `warp` (`:23-40`), `tor-sidecar` (`:44-66`), public `8080:8080` (`:74`), own `redis` (`:95-108`) |
| modify (rewrite) | `.env.evolution.example` | `:1-102` — `MESSAGES_UPSERT=false` (`:66`), global webhook to the public IP (`:58`) |
| modify | `backend/.env.example` | append the WhatsApp block |
| modify | `docker-compose.prod.yml` | backend `environment:` `:11-17` — **separate commit, shipped with the code in Task 13** |

`Dockerfile.redsocks` becomes unused; it is deleted in W4's cleanup, not here (the runbook's rollback may still need it).

### Interfaces

**Produces**
- Evolution at `http://smartshape_evolution:8080` on the app's docker network; `127.0.0.1:8080` on the host (SSH tunnel for
  the Manager UI); nothing on the public IP.
- Backend env: `EVOLUTION_API_URL=http://smartshape_evolution:8080`, `EVOLUTION_API_KEY` (= Evolution's
  `AUTHENTICATION_API_KEY`), `WHATSAPP_INSTANCE=smartshape` (the company number), `WA_WEBHOOK_SECRET` (random, per
  deployment), `WA_WEBHOOK_BASE=https://app.smartshape.in`.
- Backups: `/var/backups/evolution-<date>.dump` (+ `.sql`), `/var/backups/evolution-instances-<date>.tgz`,
  `/root/docker-compose.evolution.yml.bak.<date>`, `/root/.env.evolution.bak.<date>`, `/root/backend.env.bak.<date>`.

**Consumes:** nothing from the app. Tasks 2/6/7 read the env names above.

### Steps

**1. Commit A (ops files only)** — rewrite `docker-compose.evolution.yml`:

```yaml
# SmartShape — Evolution API (WhatsApp) stack. Spec 2026-09-24, W1 / D6.
#
# The image is PINNED to evoapicloud/evolution-api:v2.3.7 so a redeploy from this file can never
# bring back atendai v2.2.3 (the build whose instances stuck at "connecting").
#
# Run from /var/www/smartshape, with the SAME compose project the running stack already uses, so
# the Postgres and session volumes are the SAME volumes (see the runbook, step 1):
#   export APP_NETWORK=<the backend's network>  EVO_PROJECT=<the evolution containers' project>
#   docker compose -p "$EVO_PROJECT" -f docker-compose.evolution.yml up -d
# NEVER pass --remove-orphans: the app's own containers can share the project name.
#
# Changed from the old file: no warp / tor-sidecar (they routed WhatsApp through a blocked IP);
# no Redis of its own (reuses smartshape-redis, db 6); port 8080 bound to 127.0.0.1 only; Evolution
# also joins the app's network, so the backend reaches it as http://smartshape_evolution:8080.

services:

  evolution-api:
    image: evoapicloud/evolution-api:v2.3.7
    container_name: smartshape_evolution
    restart: unless-stopped
    ports:
      - "127.0.0.1:8080:8080"
    env_file:
      - .env.evolution
    volumes:
      - evolution_instances:/evolution/instances
      - evolution_store:/evolution/store
    depends_on:
      postgres:
        condition: service_healthy
    networks:
      - smartshape_net
      - app
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:8080"]
      interval: 30s
      timeout: 10s
      retries: 5
      start_period: 30s

  postgres:
    image: postgres:15-alpine
    container_name: smartshape_postgres_wa
    restart: unless-stopped
    env_file:
      - .env.evolution          # POSTGRES_PASSWORD comes from here (only read when the volume is empty)
    environment:
      POSTGRES_DB: evolution
      POSTGRES_USER: evolution
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - smartshape_net
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U evolution"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  evolution_instances:
  evolution_store:
  postgres_data:

networks:
  smartshape_net:
    name: smartshape_net
    driver: bridge
  app:
    name: ${APP_NETWORK:-smartshape_default}
    external: true
```

Rewrite `.env.evolution.example`:

```bash
# ── Copy to .env.evolution and fill in. NEVER commit .env.evolution. ─────────────────────────
# Spec 2026-09-24 W1 / D6. Evolution is private: only the backend (same docker network) and an
# SSH tunnel to 127.0.0.1:8080 can reach it.

# ── PostgreSQL ────────────────────────────────────────────────────────────────
POSTGRES_PASSWORD=change_me_strong_password

# ── Evolution API ─────────────────────────────────────────────────────────────
SERVER_URL=http://smartshape_evolution:8080
AUTHENTICATION_TYPE=apikey
# Put the SAME value in backend/.env as EVOLUTION_API_KEY. Only the backend holds it.
AUTHENTICATION_API_KEY=CHANGE_ME_openssl_rand_hex_32
AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=false

# ── Database ──────────────────────────────────────────────────────────────────
DATABASE_ENABLED=true
DATABASE_PROVIDER=postgresql
DATABASE_CONNECTION_URI=postgresql://evolution:change_me_strong_password@postgres:5432/evolution
DATABASE_CONNECTION_CLIENT_NAME=evolution_api
DATABASE_SAVE_DATA_INSTANCE=true
DATABASE_SAVE_DATA_NEW_MESSAGE=true
DATABASE_SAVE_MESSAGE_UPDATE=true
DATABASE_SAVE_DATA_CONTACTS=true
DATABASE_SAVE_DATA_CHATS=true
DATABASE_SAVE_DATA_HISTORIC=true

# ── Cache: the app's Redis (smartshape-redis), its own db index ───────────────
CACHE_REDIS_ENABLED=true
CACHE_REDIS_URI=redis://smartshape-redis:6379/6
CACHE_REDIS_TTL=604800
CACHE_REDIS_PREFIX_KEY=evolution
CACHE_REDIS_SAVE_INSTANCES=false
CACHE_LOCAL_ENABLED=false

# ── Sessions and history ──────────────────────────────────────────────────────
# CONFIG_SESSION_PHONE_VERSION is deliberately ABSENT (removed upstream in 2.3.1; a stale pin
# breaks sending). The app also sets syncFullHistory on every instance it creates.
SYNC_FULL_HISTORY=true
QRCODE_LIMIT=30
QRCODE_COLOR=#128c7e

# ── Events: per-instance webhooks only (the app sets them, with a secret) ─────
WEBHOOK_GLOBAL_ENABLED=false
WEBHOOK_GLOBAL_URL=
WEBHOOK_EVENTS_MESSAGES_UPSERT=true
WEBHOOK_EVENTS_MESSAGES_UPDATE=true
WEBHOOK_EVENTS_CONNECTION_UPDATE=true
WEBHOOK_EVENTS_QRCODE_UPDATED=true
WEBHOOK_EVENTS_SEND_MESSAGE=true
WEBSOCKET_ENABLED=false
RABBITMQ_ENABLED=false
SQS_ENABLED=false
CHATWOOT_ENABLED=false

# ── Runtime ───────────────────────────────────────────────────────────────────
DEL_INSTANCE=false
LOG_LEVEL=ERROR,WARN
LOG_COLOR=false
LOG_BAILEYS=error
NODE_ENV=production

# Proxies are per number, set from the app (Settings → WhatsApp), never here.
```

Append to `backend/.env.example`:

```bash
# ── WhatsApp team numbers (spec 2026-09-24 W1) ────────────────────────────────
# Evolution on the docker network — never the public IP.
EVOLUTION_API_URL=http://smartshape_evolution:8080
# = AUTHENTICATION_API_KEY in .env.evolution
EVOLUTION_API_KEY=
# The company number's Evolution instance
WHATSAPP_INSTANCE=smartshape
# Webhook shared secret: openssl rand -hex 24. Unset = every webhook is refused.
WA_WEBHOOK_SECRET=
WA_WEBHOOK_BASE=https://app.smartshape.in
```

Validate and commit:

```bash
APP_NETWORK=smartshape_default docker compose -f docker-compose.evolution.yml config -q 2>/dev/null && echo "compose ok" || python -c "import yaml,sys; yaml.safe_load(open('docker-compose.evolution.yml')); print('yaml ok')"
git add docker-compose.evolution.yml .env.evolution.example backend/.env.example
git commit -m "ops(wa): pin Evolution v2.3.7, private port, no warp/tor, per-instance webhooks, shared Redis

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**2. Commit B (ships with the code in Task 13)** — `docker-compose.prod.yml`, backend `environment:` (after `REDIS_PORT` `:17`):

```yaml
      # Evolution (WhatsApp) on the shared docker network — never the public IP (spec 2026-09-24, D6).
      - EVOLUTION_API_URL=http://smartshape_evolution:8080
```

```bash
git add docker-compose.prod.yml
git commit -m "ops(wa): backend reaches Evolution on the docker network

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**3. The runbook — W1a, owner present, ~30 min of WhatsApp downtime (the rest of the app stays up).** SSH to the VPS as root
(`vps_credentials` memory), `cd /var/www/smartshape`. Keep this shell open; every step prints what to check. Stop at the
first check that fails and use **Rollback** below.

*Step 0 — before commit A reaches `main`: make sure the auto-deploy can pull.* The VPS copy of `docker-compose.evolution.yml`
was hand-edited on 2026-06-11. A local edit can make the auto-deploy's pull fail and strand every later deploy.

```bash
git -C /var/www/smartshape status --short
D=$(date +%F)
cp docker-compose.evolution.yml /root/docker-compose.evolution.yml.bak.$D
cp .env.evolution /root/.env.evolution.bak.$D
cp backend/.env /root/backend.env.bak.$D
git checkout -- docker-compose.evolution.yml .env.evolution.example 2>/dev/null; git status --short
```

Only now push commit A to `main` (Task 13 step 3). Wait for the auto-deploy (≈2 min; `tail -f /var/log/ss-autodeploy.log`) and
check `git log -1 --oneline` shows commit A. Running containers are not touched by it.

*Step 1 — record what is running (the spec says v2.2.3; memory says it was hand-bumped to v2.3.7 in June — believe this output).*

```bash
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' | tee /root/wa-before-$D.txt
docker inspect smartshape_evolution --format 'image={{.Config.Image}} project={{index .Config.Labels "com.docker.compose.project"}}'
docker inspect smartshape_evolution --format '{{range .Mounts}}{{.Name}} -> {{.Destination}}{{"\n"}}{{end}}'
docker inspect smartshape-backend --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}'
free -m
KEY=$(grep '^AUTHENTICATION_API_KEY=' .env.evolution | cut -d= -f2-)
curl -s -H "apikey: $KEY" http://127.0.0.1:8080/instance/fetchInstances | python3 -m json.tool | grep -E '"name"|connectionStatus|ownerJid|profileName'
curl -s -H "apikey: $KEY" http://127.0.0.1:8080/proxy/find/smartshape; echo
```

Write down: `EVO_PROJECT` (the `project=` value), the three volume names, `APP_NETWORK` (the backend's network, expected
`smartshape_default`), and the `ownerJid` of `smartshape`. **Ask the owner whether that number is the company SIM** (memory:
919818950815, profile "Tours And Travel"). If it is not, it will be logged out in step 6.

```bash
export EVO_PROJECT=<project from above> APP_NETWORK=<backend network from above>
```

*Step 2 — back up (before touching the image).*

```bash
mkdir -p /var/backups
docker exec smartshape_postgres_wa pg_dump -U evolution -d evolution -Fc > /var/backups/evolution-$D.dump
docker exec smartshape_postgres_wa pg_dump -U evolution -d evolution > /var/backups/evolution-$D.sql
INST_VOL=<the volume mounted on /evolution/instances>
docker run --rm -v "$INST_VOL":/src:ro -v /var/backups:/dst alpine tar czf /dst/evolution-instances-$D.tgz -C /src .
ls -lh /var/backups/evolution-*$D*
```

Check: the `.dump` is larger than 0 bytes and `pg_restore -l /var/backups/evolution-$D.dump | head` (run via
`docker exec -i smartshape_postgres_wa pg_restore -l < /var/backups/evolution-$D.dump | head`) lists tables such as `"Instance"`.

*Step 3 — the new env file (keep the secrets, drop the pin, turn global webhooks off).*

```bash
setenv() { grep -q "^$1=" .env.evolution && sed -i "s|^$1=.*|$1=$2|" .env.evolution || echo "$1=$2" >> .env.evolution; }
sed -i '/^CONFIG_SESSION_PHONE_VERSION=/d;/^PROXY_HOST=/d;/^PROXY_PORT=/d;/^PROXY_USER=/d;/^PROXY_PASS=/d' .env.evolution
setenv SERVER_URL http://smartshape_evolution:8080
setenv AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES false
setenv CACHE_REDIS_URI redis://smartshape-redis:6379/6
setenv DATABASE_SAVE_DATA_HISTORIC true
setenv SYNC_FULL_HISTORY true
setenv QRCODE_LIMIT 30
setenv WEBHOOK_GLOBAL_ENABLED false
setenv WEBHOOK_GLOBAL_URL ""
setenv WEBHOOK_EVENTS_MESSAGES_UPSERT true
setenv WEBSOCKET_ENABLED false
setenv DEL_INSTANCE false
grep -E 'CONFIG_SESSION_PHONE_VERSION|WEBHOOK_GLOBAL_ENABLED|WEBSOCKET_ENABLED|SYNC_FULL_HISTORY|CACHE_REDIS_URI|SERVER_URL' .env.evolution
```

Check: no `CONFIG_SESSION_PHONE_VERSION` line; `WEBHOOK_GLOBAL_ENABLED=false`; `WEBSOCKET_ENABLED=false`. `AUTHENTICATION_API_KEY`,
`POSTGRES_PASSWORD` and `DATABASE_CONNECTION_URI` are untouched.

*Step 4 — swap the stack (WhatsApp goes down here).*

```bash
docker stop smartshape_tor_sidecar smartshape_warp 2>/dev/null; docker rm smartshape_tor_sidecar smartshape_warp 2>/dev/null
docker compose -p "$EVO_PROJECT" -f docker-compose.evolution.yml config -q && echo "config ok"
docker compose -p "$EVO_PROJECT" -f docker-compose.evolution.yml pull evolution-api
docker compose -p "$EVO_PROJECT" -f docker-compose.evolution.yml up -d postgres evolution-api
sleep 45; docker ps --filter name=smartshape_evolution --format '{{.Image}} {{.Status}} {{.Ports}}'
```

Check: `evoapicloud/evolution-api:v2.3.7 Up … (healthy) 127.0.0.1:8080->8080/tcp`. `docker volume ls` shows no new
`*_postgres_data` / `*_evolution_instances` volume (a new one means the project name was wrong — **stop, Rollback**).

*Step 5 — verify.*

```bash
curl -s http://127.0.0.1:8080/ | python3 -m json.tool | grep -i version          # "version": "2.3.7"
PUB=$(curl -s -m 5 ifconfig.me); curl -s -m 5 "http://$PUB:8080/" ; echo "public exit=$?"   # must FAIL (exit 7/28)
docker exec smartshape-backend python -c "import httpx; print(httpx.get('http://smartshape_evolution:8080/', timeout=5).json().get('version'))"
docker logs --since 5m smartshape_evolution 2>&1 | grep -iE 'error|decodeFrame|migrat|redis' | tail -20
curl -s -H "apikey: $KEY" http://127.0.0.1:8080/instance/fetchInstances | python3 -m json.tool | grep -E '"name"|connectionStatus|ownerJid'
free -m
docker stop smartshape_redis_wa 2>/dev/null; docker rm smartshape_redis_wa 2>/dev/null   # old Evolution-only Redis (volume kept)
```

Check: `2.3.7` twice (host and from inside the backend container); the public curl fails; no `decodeFrame`; `smartshape` is
listed (its session survived); Redis errors absent.

*Step 6 — link the company number (owner scans).* Open an SSH tunnel **from the owner's laptop**:
`ssh -L 8080:127.0.0.1:8080 root@srv1667373.hstgr.cloud`, then browse `http://localhost:8080/manager`, log in with the API key.

- If `smartshape` is **open** and step 1's `ownerJid` is the company SIM: nothing to scan.
- If it is open on the **wrong** number: in the Manager press Logout on `smartshape` (or
  `curl -s -X DELETE -H "apikey: $KEY" http://127.0.0.1:8080/instance/logout/smartshape`), then Connect → scan with the company SIM.
- If it is closed/connecting: Connect → scan with the company SIM (WhatsApp → Settings → Linked devices → Link a device).

The in-app Decodo proxy lives in Evolution's database and survives the image swap — step 1 printed it; if it is empty and the
QR never connects, set it: `curl -s -X POST -H "apikey: $KEY" -H 'Content-Type: application/json' http://127.0.0.1:8080/proxy/set/smartshape -d '{"enabled":true,"host":"gate.decodo.com","port":"10001","protocol":"socks5","username":"<u>","password":"<p>"}'`.

```bash
curl -s -H "apikey: $KEY" http://127.0.0.1:8080/instance/connectionState/smartshape; echo       # "state":"open"
```

*Step 7 — one test message to the owner's phone.*

```bash
OWNER_PHONE=91XXXXXXXXXX   # the owner's own mobile, as the owner dictates it
curl -s -X POST -H "apikey: $KEY" -H 'Content-Type: application/json' \
  http://127.0.0.1:8080/message/sendText/smartshape \
  -d "{\"number\":\"$OWNER_PHONE\",\"text\":\"SmartShape WhatsApp upgrade test $(date +%H:%M)\"}" | python3 -m json.tool | head -20
```

Check: the owner confirms the message arrived from the company number.

*Step 8 — backend env for W1b (applied now, harmless to the current code, which reads the same `EVOLUTION_API_URL`).*

```bash
BE=backend/.env
setbe() { grep -q "^$1=" $BE && sed -i "s|^$1=.*|$1=$2|" $BE || echo "$1=$2" >> $BE; }
setbe EVOLUTION_API_URL http://smartshape_evolution:8080
setbe EVOLUTION_API_KEY "$KEY"
setbe WHATSAPP_INSTANCE smartshape
setbe WA_WEBHOOK_SECRET "$(openssl rand -hex 24)"
setbe WA_WEBHOOK_BASE https://app.smartshape.in
docker compose -f docker-compose.prod.yml up -d backend        # recreate with the new env, no rebuild
sleep 20; curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' -d '{}' https://app.smartshape.in/api/auth/login   # 422
grep -E '^(EVOLUTION_API_URL|WHATSAPP_INSTANCE|WA_WEBHOOK_BASE)=' $BE
```

Caps are set in the app right after W1b is live (Task 13 step 6) — the app has no settings screen before then, and the
service's defaults (warm-up, 30/hour, 09:00–19:00 IST) are already the safe values.

**Rollback** (any failed check; WhatsApp only — the app is unaffected):

```bash
docker compose -p "$EVO_PROJECT" -f docker-compose.evolution.yml down          # NO -v: volumes stay
cp /root/docker-compose.evolution.yml.bak.$D docker-compose.evolution.yml
cp /root/.env.evolution.bak.$D .env.evolution
cp /root/backend.env.bak.$D backend/.env
docker compose -p "$EVO_PROJECT" -f docker-compose.evolution.yml up -d          # the previous image and services
# Only if the previous image will not start because 2.3.7 migrated the schema:
docker exec -i smartshape_postgres_wa psql -U evolution -d postgres -c 'DROP DATABASE evolution;' -c 'CREATE DATABASE evolution OWNER evolution;'
docker exec -i smartshape_postgres_wa pg_restore -U evolution -d evolution < /var/backups/evolution-$D.dump
docker run --rm -v "$INST_VOL":/dst -v /var/backups:/src alpine sh -c "rm -rf /dst/* && tar xzf /src/evolution-instances-$D.tgz -C /dst"
docker restart smartshape_evolution
docker compose -f docker-compose.prod.yml up -d backend
git checkout -- docker-compose.evolution.yml       # leave the tracked file clean for the auto-deploy
```

Then `curl -s http://127.0.0.1:8080/` (or the public IP, if the old file bound it publicly) reports the old version, and
`fetchInstances` lists `smartshape` as before.

---

## Task 13 — Deployment: tests, bundle, order of operations

### Steps

**1. Full backend verification** (named files only):

```bash
cd backend && DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 python -m pytest \
  tests/test_no_send_guard.py tests/test_evolution_client.py tests/test_wa_config.py tests/test_wa_send.py \
  tests/test_wa_send_caps.py tests/test_wa_webhook.py tests/test_wa_routes.py tests/test_wa_health.py \
  tests/test_wa_callers.py tests/test_contact_drip_executor.py tests/test_drip_executor_concurrency.py \
  tests/test_to_post_linking.py tests/test_wa_tag_broadcast.py tests/test_tag_scope.py \
  tests/test_auto_reminders_no_drip.py tests/test_drip_resume_guard.py tests/test_drip_physical_mailer.py \
  tests/test_drip_to_offline_mail_chain.py tests/test_forms_reminders.py tests/test_forms_confirm.py \
  tests/test_webinar_loop.py tests/test_admin_roles.py tests/test_rbac_module.py tests/test_owner_scoping.py \
  tests/test_contacts_bulk.py tests/test_marketing_sent_report.py tests/test_db_startup_ready_wait.py -q
cd backend && python -c "import main; print('app imports')"
```

All green. Any red is fixed on the branch before going on.

**2. Frontend tests and the bundle.**

```bash
cd frontend && npx craco test --watchAll=false --testPathPattern "MyWhatsApp|WhatsAppNumbersSection|waStatus|useCRMMasters|RecentlyDeleted|ContactsTab"
cd .. && bash scripts/build-frontend.sh
grep -l "My WhatsApp" frontend/build/static/js/*.js | head -3        # the new page is in a chunk
grep -c "localhost:8000" frontend/build/static/js/main.*.js           # must be 0
git add frontend/build
git commit -m "chore(frontend): rebuild bundle for My WhatsApp and Settings -> WhatsApp

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**3. Ship commit A alone (ops files; no code).** After runbook **Step 0** on the VPS:

```bash
git fetch origin
git checkout -b deploy/wa-ops origin/main
git cherry-pick <commit A sha>                      # "ops(wa): pin Evolution v2.3.7 …"
git push origin deploy/wa-ops:main
git checkout feat/whatsapp-team
```

Watch the VPS auto-deploy finish; `curl … /api/auth/login` → `422`.

**4. Run the Task 12 runbook, steps 1–8, with the owner.** (W1a, Rollout step 1.)

**5. Ship W1b (code + commit B + bundle).** (Rollout step 2.)

```bash
git fetch origin
git merge origin/main                                # brings commit A back in; resolve nothing expected
git push origin feat/whatsapp-team
git push origin feat/whatsapp-team:main
git branch -a --contains HEAD | grep -q "remotes/origin/main" && echo "on origin/main"
```

Verify on the live server (≈2–5 min after the push):

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://app.smartshape.in/api/wa/me                                # 401 (not 404)
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://app.smartshape.in/api/webhooks/whatsapp/smartshape   # 401
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' -d '{}' https://app.smartshape.in/api/auth/login   # 422
curl -s https://app.smartshape.in/ | grep -o 'main\.[a-f0-9]*\.js'                                           # the new bundle hash
```

On the VPS: `docker logs smartshape-backend 2>&1 | grep -iE "index skipped.*wa_|field_definitions seed FAILED|Traceback" | tail`
must print nothing new. If the API returns 502: `git push origin <previous origin/main sha>:main --force-with-lease` and
investigate (memory `reference_deploy_mechanism`).

**6. In the app, as the owner (info@smartshape.in):**

1. Settings → WhatsApp → tick the notice → **Link company number**. The already-open `smartshape` instance is adopted
   (no QR) and shows **Connected** with the company number. The webhook is now registered — confirm on the VPS:
   `curl -s -H "apikey: $KEY" http://127.0.0.1:8080/webhook/find/smartshape` shows `…/api/webhooks/whatsapp/smartshape?t=…`
   and all five events.
2. The company number has sent for months: press **Limit** on it and set `150` (its ramp would otherwise restart at 20/day
   from today). Leave rep numbers on the ramp.
3. Sending rules: keep the defaults; confirm 09:00–19:00. **Fallback:** choose MessageAutoSender only if its login is saved
   below (Security section) — Rollout step 2 says ON for one week; set a reminder to switch it back to "Do not send" on day 7.
   Leave **WhatsApp drip steps** and **greetings** OFF (they switch on in W3).
4. Settings → WhatsApp → test message box (Security section) → the owner's phone. It must arrive; then
   `docker exec smartshape-backend python -c "import asyncio,database; print(asyncio.run(database.db.wa_messages.find_one(sort=[('created_at',-1)],projection={'_id':0,'status':1,'status_history':1,'instance_name':1})))"`
   shows `instance_name: smartshape` and, within a minute, `delivered`/`read` in `status_history` (the webhook works).

**7. Install the host health probe.**

```bash
chmod +x /var/www/smartshape/scripts/ss-wa-health.sh
/var/www/smartshape/scripts/ss-wa-health.sh                     # prints avail/total/evolution MB
echo '7 * * * * root /var/www/smartshape/scripts/ss-wa-health.sh >> /var/log/ss-wa-health.log 2>&1' > /etc/cron.d/ss-wa-health
```

Settings → WhatsApp now shows "Server memory: … MB free".

**8. Reps link one at a time (Rollout step 3).** For each of at most 3 reps, on the day they have their company SIM:
the rep opens **My WhatsApp** (icon next to Logout), reads and ticks the notice, presses **Link**, scans with the company SIM.
The admin watches Settings → WhatsApp until the row is **Connected**, then re-runs `ss-wa-health.sh` and checks free memory
stays ≥ 500 MB before the next rep. Each number starts its own 14-day warm-up; the service already refuses campaigns from it
until day 15 (they go from the company number instead). A 4th rep number needs a VPS upgrade first (D7).

**9. After W1b is live:** W2 (inbox) starts from `wa_events_raw` (inbound messages kept since the webhook went live).

---

## Self-review

### Spec W1 coverage

| Spec W1 item | Where |
|---|---|
| Backup `smartshape_postgres_wa` (`pg_dump`) to `/var/backups/evolution-<date>` before the image | Task 12 runbook step 2 |
| New `docker-compose.evolution.yml`: v2.3.7, Postgres 15, reuse `smartshape-redis`, `127.0.0.1:8080`, `.env.evolution`, `WEBHOOK_GLOBAL_ENABLED=false`, `WEBSOCKET_ENABLED=false`, `SYNC_FULL_HISTORY=true`, no `CONFIG_SESSION_PHONE_VERSION`, `DEL_INSTANCE=false`, `QRCODE_LIMIT=30`, no warp/tor | Task 12 commit A + runbook steps 3–4 |
| Backend reaches `http://smartshape_evolution:8080`; public URL gone | Task 12 (compose `app` network, commit B, runbook steps 5 and 8) |
| Per-instance webhook `/webhook/set/{instance}` → `…/api/webhooks/whatsapp/{instance}?t=<secret>`, five events | Task 2 `set_webhook`/`webhook_url`; Task 7 `_provision` and company adopt |
| `WA_WEBHOOK_SECRET`; 401 on wrong/missing; never trust `payload.instance` | Task 6 |
| Hourly `connectionState` sweep, owner/admin alerts, RAM < 500 MB via host script → `settings{type:"wa_health"}` | Task 8 |
| `send_whatsapp(...)` exact signature and return shape | Task 4 |
| Resolution order (`channel=="company"` → owner's connected → company → `skipped(no_sender)`) | Task 4 `resolve_sender` |
| opt-out → consent (automations) → quiet hours → caps → number-exists (30-day cache) → jittered delay → send → ledger → row → event | Tasks 4 (`_policy`, `_number_exists`, `_deliver`, `_finish`, `_log_event`) and 5 (`_policy` hours/caps/gap, `_record_success`) |
| `queued` rows drained per instance every minute, oldest first, same caps | Task 5 `run_wa_queue_pass` + `scheduler.wa_queue_loop` |
| Five consecutive failures pause + alert | Task 5 `_record_failure` / `pause_instance` |
| Callers migrated: drip, dispatch, intro, demo, mailer-QR, portal, FMS, digest, scheduled-WA, tag broadcast, manual/template send, campaigns | Task 9 table |
| WABA `_send_wa` + six AutoSender copies deleted; `_send_wa_autosender` only behind `wa.fallback_provider` | Task 9 (AutoSender call now `wa_send._send_via_autosender`, used only when `fallback_provider == "autosender"`) |
| `GET /wa/me`, `POST /wa/me/link|relink|unlink` | Task 7 |
| Admin `GET /wa/instances` (+RAM, `max_instances`), `POST /wa/instances/company`, `pause|resume|unlink`, `PUT …/proxy`, `PUT /wa/settings` | Task 7 |
| Old `/whatsapp/instances*` removed; `/whatsapp/proxy-config` implemented | Task 7 |
| Webhook dispatch: `CONNECTION_UPDATE`, `QRCODE_UPDATED`, `MESSAGES_UPDATE`, `MESSAGES_UPSERT` (→ W2), `SEND_MESSAGE` | Task 6 (W2 stub stores raw in `wa_events_raw`) |
| My WhatsApp page `/me/whatsapp`, nav under the user menu, state badge, QR 20-s refresh, "Connected as", warm-up progress, Relink/Unlink, privacy notice | Task 10 |
| Settings → WhatsApp admin page, replaces `WhatsAppConnectionSection` and the Setup provider form | Task 11 |
| Security: Evolution private; global key only in backend env; instance tokens for instance-scoped calls | Task 12; Tasks 2/4/7 pass `instance_token` |
| Security: RBAC — reps own instance; admin any; owner with no `module_permissions` passes | Task 7 tests `test_a_rep_is_refused_every_admin_route`, `test_the_owner_and_a_multi_role_admin_pass` |
| Security: privacy notice shown before linking and stored as `notice_accepted_at` | Tasks 7 (400 without it; stored) and 10/11 (tick required) |
| Security: media URLs through the app, never Evolution's | W2 (inbound media). W1 sends only app-hosted URLs (`whatsapp_attachments.url`, certificate PDFs). |
| Testing → global no-send guard | Task 1 (+ Task 2 `fake_evolution`) |
| Testing → W1 list: resolution order; caps (hourly, daily, warm-up, per-contact-per-day); quiet hours queue + drain; opt-out/consent skips; number-exists cache; five failures pause + alert; webhook 401; per-event handlers; RBAC incl. owner | Tasks 4, 5, 6, 7 test files |
| Data model + indexes (`_i()`) | Task 3 |
| Rollout 1 (W1a infra), 2 (W1b code, fallback ON one week, drips/greetings paused), 3 (reps one at a time, 14-day warm-up, no campaigns from young numbers) | Tasks 12, 13; switches in Task 3/11; young-number rule in Task 5 |
| "Each step needs a frontend bundle rebuild before merge" | Task 13 step 2 |

### Placeholder scan

Searched the plan for `TBD`, `TODO`, `…later`, "similar to", "add appropriate", "handle errors": none in code. The only
angle-bracket values are operator inputs in the runbook (`<project from above>`, `<commit A sha>`, `<u>`/`<p>` proxy login,
`91XXXXXXXXXX`), each with the command that produces it; `.env` examples use `CHANGE_ME` values by design.

### Type / name consistency

- `send_whatsapp` keyword names identical in Task 4 (definition), Task 9 (every caller) and the spec.
- Status strings `sent|queued|skipped|failed` everywhere; the drainer's transient `sending` never leaves `wa_send.py`.
- Instance states `unlinked|qr|connected|disconnected|paused` (Task 3 `INSTANCE_STATES`) — used by Tasks 4 (`state == "connected"`),
  6, 7, 8, 10 (`STATE_LABEL`), 11.
- Setting keys (`hourly_cap`, `gap_min_s`, `drip_wa_enabled`, …) identical in `WA_DEFAULTS` (Task 3), `_policy` (Task 5), the
  drip hold / greeting gates (Task 9) and `NUMERIC`/`FIELDS` (Task 11).
- `COMPANY_INSTANCE == WHATSAPP_INSTANCE == "smartshape"` == `wa_fixtures.COMPANY` == the runbook's instance.
- Engagement dedup keys: `drip:<enr>:<step>` (Task 9, matches the executor's existing key), `dispatch:<id>`,
  `camp:<campaign>:<sched>`, `greet:<rule>:<day>:<contact>`, default `wa:<message_id>`.
- Alert dedup keys: `wa_paused:<name>`, `wa_close:<name>:<IST day>` (shared by Task 6 webhook and Task 8 sweep, so one
  bell per number per day), `wa_dup:<name>:<phone>`, `wa_down:<day>`, `wa_ram:<day>`.
- Frontend `waNumbers.*` method names match Task 7 route table one-to-one; `data-testid`s in the tests match the JSX.
- `FakeEvolution` knobs used by later tasks (`fail_sends`, `fail_if`, `on_send(rec)`, `not_on_whatsapp`, `check_raises`,
  `state`, `owner_jid`, `create_status`) are all defined in Task 2.

### Review Focus pinning

| RF | Test(s) | Task |
|---|---|---|
| RF1 unknown instance / forged instance | `test_unknown_instance_is_acknowledged_and_ignored`, `test_payload_instance_must_match_the_path`, `test_secret_is_checked_before_the_body_is_read`, `test_no_secret_configured_refuses_everything` | 6 |
| RF2 same SIM on two instances | `test_open_on_a_number_already_linked_elsewhere_unlinks_the_newcomer` | 6 |
| RF3 company number down | `test_company_down_and_no_owner_number_is_skipped_no_sender_not_failed` (4), `test_company_close_alerts_every_admin` (6), `test_health_sweep_marks_company_disconnected_and_alerts` (8) | 4, 6, 8 |
| RF4 phone spellings / landline | `test_phone_forms_normalise_to_one_e164`, `test_non_mobile_numbers_normalise_to_empty`, `test_a_landline_is_skipped_bad_phone_with_a_row`; broadcast merge `test_deals_sharing_a_phone_get_one_message_and_bad_phones_are_skipped` (updated in 9) | 4, 9 |
| RF5 IST vs UTC | `test_ledger_day_is_the_ist_date_at_2330_and_0001_ist`, `test_quiet_hours_queue_until_0900_ist_next_day`, `test_before_0900_ist_queues_for_the_same_morning` | 5 |
