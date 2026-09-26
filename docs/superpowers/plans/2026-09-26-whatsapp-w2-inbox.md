# WhatsApp W2 — Team inbox — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal.** Every WhatsApp message a linked number sends or receives lands in the app as one `wa_messages` row inside one `wa_chats` conversation, matched to the contact/school/lead by phone; reps chat with schools from the app on their own number; managers open any conversation, read it, and reply as the rep (attributed); the page updates live over Server-Sent Events; the contact panel and school profile show the recent WhatsApp exchange.

**Architecture.** The W1 webhook already receives `MESSAGES_UPSERT` (kept raw in `wa_events_raw`) and `SEND_MESSAGE` (one `source: phone` row). W2 adds `backend/services/wa_inbox.py` — a normaliser (`normalise_upsert`) that turns one Evolution event into our row shape, an idempotent `ingest_message` that inserts the row (unique `(instance_name, provider_msg_id)`), downloads media through `EvolutionClient.get_media_base64` into `services/storage.py`, matches the record by the last 10 digits, upserts `wa_chats`, writes the engagement event, and publishes an event on a tiny bus (`backend/services/wa_events.py`: Redis pub/sub via the existing `cache.redis_client`, with an in-process fallback). `routes/wa_inbox_routes.py` exposes `/wa/chats*`, `/wa/stream` (SSE) and `/wa/unread-count`, all scoped by one helper `chat_scope(user)`; a reply is `send_whatsapp(kind="chat", channel=<the chat's instance>, typed_by=<me>)`, so every W1 rule (hourly cap, gap, opt-out, audit row) still applies. The React page `/whatsapp` is a two-pane inbox fed by `hooks/useWaInbox.js` + `hooks/useWaStream.js`.

**Tech stack.** FastAPI + Motor, Starlette `StreamingResponse` for SSE (no new dependency), `redis.asyncio` (already imported by `backend/cache.py`), Evolution API v2.3.7 (live since 2026-09-26), React 19 + craco/Jest (`react-dom/client` `createRoot` + `act`, `jest.mock`, no testing-library), pytest + `mongomock_motor` + the W1 `wa_env` / `fake_evolution` fixtures.

**Spec (binding):** `docs/superpowers/specs/2026-09-24-whatsapp-team-numbers-inbox-design.md` — this plan covers **Sub-project W2 only** (Ingest, Routes, Frontend `/whatsapp`, the W2 line of Testing, Security). Opt-out keyword handling, manager filters beyond mine/unassigned/all, reports and retention are **W4** and are not built here (the inbox only *shows* an existing `wa_opt_out` flag).

**Branch / worktree.** `feat/whatsapp-inbox` in `F:\ss-wa`, cut from `origin/main` `58aefe0` (W1 live). `node_modules` in `F:\ss-wa` is a junction to the main tree — never delete or recurse it. Line numbers below were read on `58aefe0`; re-grep before each edit.

---

## Global Constraints

### Decisions (copied verbatim from the spec)

- **D4 — Managers read and reply as the rep.** A manager/admin can open any conversation and send from the rep's number. The message
  row records `typed_by` (the manager) and `sent_via` (the rep's number); the school sees the rep. Reps see only their own numbers'
  chats plus company-number chats for records they own.
- **D5 (the part that binds chat)** — Manual chat replies bypass the daily cap but not the hourly rate.
- **D8 — Build a thin inbox; do not adopt Chatwoot.** … Our inbox is one `wa_messages` collection + one `wa_chats` collection + a React
  page, fed by the webhook, pushed to browsers over Server-Sent Events from FastAPI.
- **D9 — Every message is stored once, keyed by (instance, provider message id).** Webhook deliveries are idempotent; duplicates are
  dropped. Inbound media is downloaded via `getBase64FromMediaMessage` and stored through `services/storage.py` (Cloudinary when
  configured, else local `uploads/whatsapp/`), never left as an encrypted WhatsApp reference.
- **Security:** RBAC: reps ↔ own instance and own chats; managers (`get_team(user) == "admin" or role == "admin"` — the same admin test used
  everywhere else, so the owner's account with no `module_permissions` keeps passing) see all. Every manager reply is attributed.
  Media URLs are served through the app (`/uploads/whatsapp/…` behind auth or Cloudinary signed URLs), never Evolution's.

### Rules that bind every task

1. **One door.** The only way a W2 route sends is `services.wa_send.send_whatsapp(db, ..., kind="chat", typed_by=<email>, channel=<instance_name>)`. No route calls `EvolutionClient.send_*` directly.
2. **Idempotent ingest.** A `wa_messages` row is created with `update_one(..., {"$setOnInsert": …}, upsert=True)` on `(instance_name, provider_msg_id)`; `DuplicateKeyError` is swallowed; a second delivery of the same event changes nothing (row count, unread count, engagement events).
3. **Every row we create carries `message_id: f"wam_{uuid4().hex[:16]}"`** and the full W1 row shape (see `_on_send_message` in `routes/wa_routes.py:344-381`); readers never depend on a field being absent.
4. **Scope is one helper.** `chat_scope(user) -> dict | None` (None = everything) is the only place the rep/manager rule lives; every list, read, send, stream and unread count goes through it. Manager test: `_is_admin(user) or sees_all(user, "leads")`.
5. **Tests never send or reach the network** (conftest guard). Every Evolution call in a test goes through `fake_evolution`; extend `FakeEvolution.request` for the new paths in Task 1 rather than mocking per test.
6. **No new top-level third-party backend import.** SSE = Starlette `StreamingResponse`; pub/sub = `redis.asyncio` from `cache.py`.
7. **Run tests only as** `cd backend && DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 python -m pytest <named files> -q -p no:cacheprovider`. Never bare `pytest`. `python`, never `python3`. Frontend: `cd frontend && CI=true npx craco test --watchAll=false --testPathPattern "<pattern>"`.
8. **Git:** stage explicit file names (never `git add -A`); `git add -f` for new files under `backend/tests/`; commit trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; never push.
9. **Frontend conventions:** pages wrap in `AppShell`; tokens `text-[var(--text-primary)]` etc. as in `pages/MyWhatsApp.js`; 44 px touch targets; API methods live in `lib/api.js`; hooks in `hooks/`; every new component/hook has a Jest test.
10. **Group chats (`@g.us`), `status@broadcast` and newsletters are ingested only as a row with `hidden: true` and never create a visible chat.**

---

## File map

| File | Responsibility |
|---|---|
| `backend/services/evolution_client.py` (modify) | `mark_read`, `get_media_base64`, `find_chats`, `find_messages` |
| `backend/tests/conftest.py` (modify `FakeEvolution.request`) | fake answers for the four new paths |
| `backend/services/wa_inbox.py` (create) | `normalise_upsert`, `match_record`, `upsert_chat`, `ingest_message`, `store_media`, `backfill_raw_events`, `sync_history` |
| `backend/services/wa_events.py` (create) | `publish(event)`, `subscribe()`; Redis channel `wa:events`, local fallback |
| `backend/routes/wa_routes.py` (modify) | `_on_messages_upsert` → ingest; `_on_send_message` → chat upsert + publish; `_on_open` → start history sync |
| `backend/routes/wa_inbox_routes.py` (create) | `chat_scope`, `/wa/chats*`, `/wa/messages`, `/wa/stream`, `/wa/unread-count` |
| `backend/main.py` (modify) | include the new router; startup backfill of unprocessed `wa_events_raw` |
| `backend/database.py` (modify `ensure_wa_indexes`) | `wa_chats.chat_id` unique; `(status, last_message_at)`; `assignee_email`; `school_id`; `wa_events_raw.processed` |
| `backend/tests/test_wa_inbox_ingest.py`, `test_wa_inbox_routes.py`, `test_wa_events.py`, `test_wa_history_sync.py` (create) | the W2 test line of the spec |
| `frontend/src/lib/api.js` (modify) | `waInbox` API block |
| `frontend/src/hooks/useWaStream.js`, `useWaInbox.js` (create + tests) | live stream + list/conversation state |
| `frontend/src/components/whatsapp/ChatList.js`, `ChatView.js`, `Composer.js`, `ChatRail.js`, `RecentWhatsApp.js` (create + tests) | the inbox UI pieces |
| `frontend/src/pages/WhatsAppInbox.js` (create + test) | `/whatsapp` two-pane page |
| `frontend/src/App.js`, `components/layouts/AdminNavItems.js`, `SalesLayout.js`, `AppShellNav.js`, `AppShell.js` (modify) | route, nav entries, unread badge |
| `frontend/src/components/crm/ContactDetailPanel.js`, `pages/admin/SchoolProfile.js` (modify) | WhatsApp tab / card |
| `nginx-vps.conf` (modify) + runbook note | `/api/wa/stream` unbuffered |

---

### Task 1: Evolution client — the four W2 calls, and their fakes

**Files:**
- Modify: `backend/services/evolution_client.py` (after `check_numbers`, ~line 193)
- Modify: `backend/tests/conftest.py` (`FakeEvolution.request`, lines 79–116)
- Test: `backend/tests/test_evolution_client.py` (append)

**Interfaces:**
- Produces:
  - `EvolutionClient.mark_read(instance, keys: list[dict], *, token=None) -> dict` → `POST /chat/markMessageAsRead/{instance}` body `{"readMessages": [{"remoteJid", "fromMe", "id"}, …]}`
  - `EvolutionClient.get_media_base64(instance, message_key_id: str, *, convert_to_mp4=False, token=None) -> dict` → `POST /chat/getBase64FromMediaMessage/{instance}` body `{"message": {"key": {"id": message_key_id}}, "convertToMp4": convert_to_mp4}`; returns `{"mediaType", "fileName", "mimetype", "base64", "size"}` (whatever Evolution returns, passed through); timeout `_TIMEOUT_SEND`
  - `EvolutionClient.find_chats(instance, *, token=None) -> list` → `POST /chat/findChats/{instance}` body `{}`; a dict answer with `records`/`chats` is unwrapped to the list
  - `EvolutionClient.find_messages(instance, remote_jid: str, *, page=1, offset=50, token=None) -> dict` → `POST /chat/findMessages/{instance}` body `{"where": {"key": {"remoteJid": remote_jid}}, "page": page, "offset": offset}`; returns `{"records": [...], "total": n, "pages": n}` — normalise: if the answer is a list, wrap as `{"records": list, "total": len, "pages": 1}`; if it has `messages`, use `messages`.
- FakeEvolution knobs (Task 2+ rely on them): `fake.media[key_id] = {"mediaType","fileName","mimetype","base64"}` (missing id → `EvolutionError(404, "media not found")`), `fake.read_marks: list` (every markMessageAsRead body), `fake.chats[instance] = [...]`, `fake.messages[(instance, remote_jid)] = [...]` (paged 50 at a time; `total`/`pages` computed), `fake.media_raises: bool`.

- [ ] **Step 1: failing tests** — append to `backend/tests/test_evolution_client.py`:

```python
def test_mark_read_posts_the_keys(fake_evolution):
    c = _ec.EvolutionClient(base="http://evo", key="k")
    asyncio.run(c.mark_read("rep_parul", [{"remoteJid": "919800000001@s.whatsapp.net", "fromMe": False, "id": "IN1"}], token="tok"))
    call = fake_evolution.calls[-1]
    assert call["path"] == "/chat/markMessageAsRead/rep_parul" and call["token"] == "tok"
    assert call["json"] == {"readMessages": [{"remoteJid": "919800000001@s.whatsapp.net", "fromMe": False, "id": "IN1"}]}
    assert fake_evolution.read_marks == [call["json"]]

def test_get_media_base64_returns_the_fake_media_or_404(fake_evolution):
    c = _ec.EvolutionClient(base="http://evo", key="k")
    fake_evolution.media["IN2"] = {"mediaType": "image", "fileName": "a.jpg", "mimetype": "image/jpeg", "base64": "QUJD"}
    out = asyncio.run(c.get_media_base64("rep_parul", "IN2"))
    assert out["base64"] == "QUJD" and fake_evolution.calls[-1]["json"] == {"message": {"key": {"id": "IN2"}}, "convertToMp4": False}
    with pytest.raises(_ec.EvolutionError) as e:
        asyncio.run(c.get_media_base64("rep_parul", "missing"))
    assert e.value.status_code == 404

def test_find_messages_pages_the_fake(fake_evolution):
    c = _ec.EvolutionClient(base="http://evo", key="k")
    fake_evolution.messages[("rep_parul", "919800000001@s.whatsapp.net")] = [{"key": {"id": f"M{i}"}} for i in range(120)]
    p1 = asyncio.run(c.find_messages("rep_parul", "919800000001@s.whatsapp.net", page=1))
    p3 = asyncio.run(c.find_messages("rep_parul", "919800000001@s.whatsapp.net", page=3))
    assert p1["total"] == 120 and p1["pages"] == 3 and len(p1["records"]) == 50 and len(p3["records"]) == 20
    assert fake_evolution.calls[-1]["json"]["where"] == {"key": {"remoteJid": "919800000001@s.whatsapp.net"}}

def test_find_chats_unwraps_a_dict_answer(fake_evolution):
    c = _ec.EvolutionClient(base="http://evo", key="k")
    fake_evolution.chats["rep_parul"] = [{"remoteJid": "919800000001@s.whatsapp.net", "name": "Sunita"}]
    assert asyncio.run(c.find_chats("rep_parul"))[0]["name"] == "Sunita"
```

- [ ] **Step 2: run** `python -m pytest tests/test_evolution_client.py -q -p no:cacheprovider` (guarded prefix) — expect the four to FAIL (`AttributeError` / fake returns `{}`).
- [ ] **Step 3: implement** the four methods in `evolution_client.py` exactly as the Interfaces block says, each through `self._request`; add to `FakeEvolution.__init__`: `self.media = {}; self.read_marks = []; self.chats = {}; self.messages = {}; self.media_raises = False`, and to `request`:

```python
        if path.startswith("/chat/markMessageAsRead/"):
            self.read_marks.append(json); return {"read": "success"}
        if path.startswith("/chat/getBase64FromMediaMessage/"):
            if self.media_raises: raise _ec.EvolutionError(500, "media download failed")
            mid = ((json or {}).get("message") or {}).get("key", {}).get("id")
            if mid not in self.media: raise _ec.EvolutionError(404, "media not found")
            return dict(self.media[mid])
        if path.startswith("/chat/findChats/"):
            return list(self.chats.get(tail, []))
        if path.startswith("/chat/findMessages/"):
            jid = (((json or {}).get("where") or {}).get("key") or {}).get("remoteJid", "")
            allm = self.messages.get((tail, jid), []); page = int((json or {}).get("page") or 1); off = int((json or {}).get("offset") or 50)
            return {"messages": {"records": allm[(page - 1) * off: page * off], "total": len(allm),
                                 "pages": max(1, -(-len(allm) // off))}}
```

- [ ] **Step 4: run** the same file — all pass; also run `tests/test_wa_send.py tests/test_wa_webhook.py -q` (unchanged behaviour).
- [ ] **Step 5: commit** `feat(wa): Evolution client read/media/history calls + fakes (W2 task 1)`.

---

### Task 2: `services/wa_inbox.py` — normalise, match, chat upsert, ingest

**Files:**
- Create: `backend/services/wa_inbox.py`
- Modify: `backend/database.py` `ensure_wa_indexes` (lines 120–152): add `wa_chats.create_index("chat_id", unique=True)`, `wa_chats [("status",1),("last_message_at",-1)]`, `wa_chats "assignee_email"`, `wa_chats "school_id"`, `wa_chats "lead_id"`, `wa_events_raw [("processed",1),("received_at",1)]`
- Test: `backend/tests/test_wa_inbox_ingest.py`

**Interfaces:**
- Consumes: `services.wa_send` (`_now`, `_iso`, `ist_day`, `to_e164`, `jid_for`, `_client`), `services.storage.save_upload(path, data, content_type) -> url`, `services.engagement.log_engagement_event`, `crm_routes._norm_phone` (re-implement locally as `norm10(phone)` — last 10 digits — to avoid importing the route module).
- Produces:
  - `normalise_upsert(inst: dict, data: dict) -> dict | None` — pure; returns the row-to-be (no db) or None when the event carries no key id. Fields: `provider_msg_id`, `direction` (`"in"` when `key.fromMe` is falsy else `"out"`), `remote_jid` (= `key.remoteJid`; when it ends with `@lid` and `data.remoteJidAlt` or `key.remoteJidAlt` exists, use that), `hidden` (True for `@g.us`, `status@broadcast`, `@newsletter`), `phone_e164` (`to_e164(remote_jid.split("@")[0])` when `@s.whatsapp.net`, else `""`), `push_name`, `text` (via the same `_text_of` rule as `wa_routes._text_of` — move that function here and import it back in wa_routes), `media_ref` (`{"type": image|document|audio|video|sticker, "mime", "filename", "caption"}` or None; keys `imageMessage`, `documentMessage`, `audioMessage`, `videoMessage`, `stickerMessage`; `documentWithCaptionMessage.message.documentMessage` too), `quoted_provider_msg_id` (`message.<any>.contextInfo.stanzaId`), `provider_ts` (`messageTimestamp`, int seconds → ISO), `raw_type` (`messageType`).
  - `match_record(db, phone_e164: str) -> dict` → `{"contact_id","lead_id","school_id","display_name"}` by `norm10`: first a non-deleted contact whose `phone`/`mobile`/`whatsapp` last-10 matches (prefer `assigned_to` set), then a lead (`phone`/`contact_phone`), then a school (`phone`/`contact_phone`); a contact match fills `school_id` from the contact; a lead match fills `contact_id`/`school_id` from the lead. Scans use `{"$regex": f"{norm10}$"}` on the phone fields (the collections are small; add no new index).
  - `upsert_chat(db, inst, row: dict, *, inbound: bool, match: dict) -> dict` — `chat_id = f"{inst['instance_name']}:{remote_jid}"`; `$setOnInsert` {chat_id, instance_name, remote_jid, phone_e164, created_at, status:"open", unread_count:0, assignee_email: inst.owner_email or "", notes: []}; `$set` {last_message_at, last_message_preview (text[:120] or "📎 <type>"), last_direction, display_name (push_name if no record name), contact_id/lead_id/school_id (only when the chat has none yet — never overwrite a manual link), hidden}; `$inc unread_count` by 1 when inbound; a resolved chat that receives an inbound message goes back to `status: "open"`.
  - `store_media(inst, provider_msg_id, media_ref) -> dict | None` — calls `EvolutionClient.get_media_base64(instance, id, convert_to_mp4=(type=="audio"), token=inst.instance_token)`, decodes, `save_upload(f"whatsapp/in/{instance}/{provider_msg_id}.{ext}", data, mime)`, returns `{"type","url","mime","filename","size","caption"}`; on any exception logs and returns `{"type", "caption", "url": "", "pending": True, "error": <short>}` (the row is still stored — D9 says never leave the encrypted reference, so `url` is our own or empty).
  - `ingest_message(db, inst: dict, data: dict) -> dict | None` — the one entry point: normalise → if None return None → build the full row (all W1 fields as in `_on_send_message`, plus `direction`, `from_jid`/`to_jid` per direction, `contact_id/lead_id/school_id` from `match_record`, `status: "delivered"` for inbound / `"sent"` for outbound-from-phone, `source: "phone"` for outbound, `"webhook"` for inbound, `hidden`) → `update_one($setOnInsert, upsert=True)` keyed `(instance_name, provider_msg_id)`; if `upserted_id` is None → return `{"duplicate": True}` and do nothing else → media → `$set media` on the row → `upsert_chat` (skip when hidden) → engagement event (inbound only, `direction="in"`, `kind="WhatsApp · reply"`, `dedup_key=f"wa:{message_id}"`, `by=push_name or phone`) → `wa_events.publish({"type":"message_new", …})` → return the row.
  - `backfill_raw_events(db, *, limit=500) -> int` — processes `wa_events_raw` with `processed: {"$ne": True}` and `event == "MESSAGES_UPSERT"` oldest first through `ingest_message`, marks each `processed: True, processed_at`; returns the count; errors on one event mark it `processed: True, error: <short>` so the backfill never loops on a bad event.

- [ ] **Step 1: failing tests** — `backend/tests/test_wa_inbox_ingest.py` (use `wa_env`, `seed_wa`, `seed_user`, `seed_instance`; one helper `inbound(pmid, phone, text, **extra)` builds a 2.3.x-shaped event: `{"key": {"remoteJid": f"{phone}@s.whatsapp.net", "fromMe": False, "id": pmid}, "pushName": "Sunita", "message": {"conversation": text}, "messageType": "conversation", "messageTimestamp": 1790400000}`). Tests (each a separate function, names exactly):
  - `test_an_inbound_text_creates_one_row_one_chat_and_one_engagement_event` — contact with phone `98000 00001` assigned to parul exists; ingest on `rep_parul`; row `direction=="in"`, `contact_id`, `school_id` filled, `status=="delivered"`, `message_id.startswith("wam_")`; chat `unread_count==1`, `last_direction=="in"`, `display_name` is the contact's name; `engagement_events` count 1 with `direction=="in"`.
  - `test_the_same_provider_id_twice_changes_nothing` — ingest twice → 1 row, unread 1, 1 event, second call returns `{"duplicate": True}`.
  - `test_lid_jid_is_mapped_through_remote_jid_alt` — key.remoteJid `123@lid`, `remoteJidAlt` `919800000001@s.whatsapp.net` → `phone_e164 == "919800000001"`, chat id uses the `@s.whatsapp.net` jid.
  - `test_group_and_status_messages_are_stored_hidden_and_make_no_chat` — `@g.us` and `status@broadcast` → rows with `hidden True`, `wa_chats` count 0, no engagement event.
  - `test_an_image_is_downloaded_and_stored_through_storage` — `fake.media["IN3"] = {...base64 of b"abc"...}`; monkeypatch `services.storage.save_upload` to record `(path, data, content_type)` and return `"https://cdn/x.jpg"`; row `media == {"type":"image","url":"https://cdn/x.jpg","mime":"image/jpeg","filename":"IN3.jpg","size":3,"caption":"look"}`; chat preview starts with `"📎"`.
  - `test_media_download_failure_still_stores_the_row` — `fake.media_raises = True` → row exists, `media.pending is True`, `media.url == ""`.
  - `test_quoted_message_id_is_kept` — `extendedTextMessage.contextInfo.stanzaId == "Q1"` → `quoted_provider_msg_id == "Q1"`.
  - `test_unknown_number_gets_a_chat_named_by_push_name` — no record → `contact_id == ""`, `display_name == "Sunita"`, no engagement event (nothing to attach it to).
  - `test_a_message_typed_on_the_phone_is_out_and_does_not_bump_unread` — `fromMe True` → `direction "out"`, `status "sent"`, `source "phone"`, chat `unread_count 0`, `last_direction "out"`.
  - `test_a_resolved_chat_reopens_on_an_inbound_message` — seed chat `status resolved` → after ingest `open`.
  - `test_backfill_processes_raw_events_once_and_marks_bad_ones` — 3 raw events (one malformed `data: "x"`) → 2 rows, all 3 `processed True`, the bad one has `error`; a second backfill returns 0.
  - `test_manual_record_link_is_never_overwritten_by_a_later_match` — chat has `contact_id "c_manual"`; a new inbound whose phone matches contact `c_auto` keeps `c_manual`.

- [ ] **Step 2: run** `python -m pytest tests/test_wa_inbox_ingest.py -q -p no:cacheprovider` → FAIL (`ModuleNotFoundError: services.wa_inbox`).
- [ ] **Step 3: implement** `backend/services/wa_inbox.py` per Interfaces. Skeleton:

```python
"""W2 ingest: one Evolution MESSAGES_UPSERT event -> one wa_messages row, one wa_chats upsert (spec W2 Ingest, D9)."""
import base64, logging, mimetypes, re, uuid
from datetime import datetime, timezone
from typing import Optional
from pymongo.errors import DuplicateKeyError
from services import wa_send
from services import wa_events

log = logging.getLogger("wa_inbox")
HIDDEN_SUFFIXES = ("@g.us", "@newsletter", "@broadcast")
_MEDIA_KEYS = (("imageMessage", "image"), ("videoMessage", "video"), ("audioMessage", "audio"),
               ("documentMessage", "document"), ("stickerMessage", "sticker"))
_EXT = {"image": "jpg", "video": "mp4", "audio": "mp3", "document": "bin", "sticker": "webp"}

def norm10(phone) -> str: ...
def _text_of(message) -> str: ...        # moved verbatim from routes/wa_routes.py
def _media_ref(message) -> Optional[dict]: ...
def _quoted(message) -> Optional[str]: ...
def normalise_upsert(inst: dict, data: dict) -> Optional[dict]: ...
async def match_record(db, phone_e164: str) -> dict: ...
async def upsert_chat(db, inst: dict, row: dict, *, inbound: bool, match: dict) -> dict: ...
async def store_media(inst: dict, provider_msg_id: str, media_ref: dict) -> Optional[dict]: ...
async def ingest_message(db, inst: dict, data: dict) -> Optional[dict]: ...
async def backfill_raw_events(db, *, limit: int = 500) -> int: ...
```

  `ingest_message` row shape (copy the field list of `_on_send_message` and add): `"direction"`, `"hidden"`, `"push_name"`, `"from_jid"` (remote for in / inst.jid for out), `"to_jid"`, `"to_e164"` (the phone either way), `"status"` (`"delivered"` in / `"sent"` out), `"status_history": [{"status": <same>, "at", "reason": "received" | "sent from the phone"}]`, `"source"` (`"webhook"` / `"phone"`), `"provider": "evolution"`, `"sent_at"`/`"sent_day"` for out, `"received_at"` for in. The engagement event and the publish happen AFTER the chat upsert; each is wrapped so a failure logs and does not undo the row.

- [ ] **Step 4: run** the file → all pass. Also `tests/test_wa_webhook.py` (the `_text_of` move must keep it green — `wa_routes` imports `_text_of` from `services.wa_inbox`).
- [ ] **Step 5: commit** `feat(wa): inbox ingest service — normalise, match, chat upsert, media, backfill (W2 task 2)`.

---

### Task 3: `services/wa_events.py` — the event bus, and wiring the webhook to ingest

**Files:**
- Create: `backend/services/wa_events.py`
- Modify: `backend/routes/wa_routes.py`: `_on_messages_upsert` (384–393) → `await wa_inbox.ingest_message(db, inst, data)` (a list `data` is iterated); `_on_send_message` (344–381) → after its own insert, call `wa_inbox.upsert_chat` + `match_record` fill (`$set` contact/lead/school on the row when empty) + `wa_events.publish`; `_on_open` (144–203) → at the end, when `inst.get("history_synced_at")` is falsy, `asyncio.create_task(wa_inbox.sync_history(db, inst))` (Task 5 implements `sync_history`; for now import lazily and guard with `hasattr`, so this task stays green — Task 5 removes the guard); `_on_messages_update` → after a receipt is applied, `wa_events.publish({"type": "message_status", ...})`.
- Modify: `backend/services/wa_send.py` `_finish` (798–833): after a `sent`/`queued`/`failed` write of a `kind == "chat"` row (or any row with `chat_id`), `wa_events.publish({"type": "message_new" if status in ("sent","queued") else "message_status", ...})` and `wa_inbox.upsert_chat`-style `$set` of `last_message_*` on the chat (call a small `wa_inbox.touch_chat_after_send(db, row)`; import lazily inside the function to avoid a cycle).
- Modify: `backend/main.py` startup (after `install_access_log_mask()`, line ~220): `asyncio.create_task(_wa_backfill())` where `_wa_backfill` awaits `wa_inbox.backfill_raw_events(db)` once and logs the count.
- Test: `backend/tests/test_wa_events.py`; extend `backend/tests/test_wa_webhook.py`

**Interfaces:**
- Produces:
  - `wa_events.publish(event: dict) -> None` — never raises; adds `"at"`; JSON-encodes; `await cache.redis_client.publish("wa:events", payload)` inside try/except (ConnectionError/TimeoutError/anything → log once per minute); then `_fan_out_local(event)` (puts on every registered local queue; a full queue (maxsize 200) drops the oldest).
  - `wa_events.subscribe() -> AsyncIterator[dict]` — registers a local `asyncio.Queue`, lazily starts (once per process) `_redis_listener()` which `pubsub.subscribe("wa:events")` and pushes decoded events into every local queue **except when the event carries `"_local_origin": <this process id>`** (so a locally published event is delivered once, not twice); yields events; on cancellation unregisters. If Redis is unavailable the listener retries every 15 s; local fan-out alone still works (one backend process in prod).
  - Event shapes (every one carries the scope fields for filtering): `{"type": "message_new"|"message_status"|"chat_updated"|"instance_state", "instance_name", "chat_id", "contact_id", "lead_id", "school_id", "message_id"?, "status"?, "direction"?, "preview"?, "unread_count"?, "at"}`.
  - `wa_events.PROCESS_ID = uuid4().hex`.

- [ ] **Step 1: failing tests** — `tests/test_wa_events.py`:
  - `test_publish_reaches_a_local_subscriber_without_redis` — monkeypatch `cache.redis_client.publish` to raise `ConnectionError`; subscribe, publish `{"type":"message_new","chat_id":"c1"}`, `asyncio.wait_for(agen.__anext__(), 1)` returns it with `at` set.
  - `test_a_redis_echo_of_our_own_event_is_not_delivered_twice` — feed `_handle_redis_message(json.dumps({**ev, "_local_origin": wa_events.PROCESS_ID}))` after a local publish → the subscriber sees exactly one event.
  - `test_a_full_queue_drops_the_oldest_not_the_newest` — publish 205 events without reading → the first read is event #5.
  - `test_unsubscribe_on_cancel` — cancel the consumer task → `len(wa_events._queues) == 0`.
  - In `test_wa_webhook.py`: `test_messages_upsert_now_ingests_instead_of_parking` (raw stub removed: a valid inbound → 1 `wa_messages` row, 1 chat, 0 unprocessed `wa_events_raw`), `test_a_phone_typed_message_fills_the_chat_and_record` (`SEND_MESSAGE` for a known contact → chat exists with `contact_id`, `last_direction "out"`), `test_receipt_publishes_a_status_event` (subscribe, apply a `MESSAGES_UPDATE` for one of our rows → a `message_status` event with the new status).
- [ ] **Step 2: run** → FAIL. **Step 3: implement.** **Step 4: run** `tests/test_wa_events.py tests/test_wa_webhook.py tests/test_wa_send.py tests/test_wa_inbox_ingest.py` → green. **Step 5: commit** `feat(wa): event bus (Redis pub/sub + local) and webhook → ingest wiring (W2 task 3)`.

---

### Task 4: Inbox routes — scope, list, messages, send, read, resolve/reopen, assign, notes, link, unread, stream

**Files:**
- Create: `backend/routes/wa_inbox_routes.py` (`router = APIRouter()`, same imports/auth style as `wa_routes.py`: `from auth_utils import get_current_user`, `from database import db`, `from rbac import get_team, sees_all`)
- Modify: `backend/main.py` — `from routes.wa_inbox_routes import router as wa_inbox_router` and `app.include_router(wa_inbox_router, prefix="/api")` next to `wa_router`
- Test: `backend/tests/test_wa_inbox_routes.py`

**Interfaces:**
- Consumes: `crm_routes._contacts_visibility_or(email)`, `crm_routes._owned_school_ids(email)`, `crm_routes._owner_clause(email)` (import the module; tests monkeypatch `crm_routes.db` like other tests do), `wa_routes._is_admin`, `wa_routes._my_instance`, `wa_send.send_whatsapp`, `wa_inbox`, `wa_events`, `settings_routes.render_template` logic (re-use by calling `db.whatsapp_templates` + the same `{contact_name} {school_name} {my_name} {my_phone}` replacement; `my_phone` = the sending instance's `phone_e164`).
- Produces:
  - `is_manager(user) -> bool` = `_is_admin(user) or sees_all(user, "leads")`.
  - `async chat_scope(user) -> dict | None` — None for managers; for a rep: `{"$or": [{"instance_name": {"$in": <my instance names>}}, {"$and": [{"instance_name": <company instance name>}, {"$or": [{"contact_id": {"$in": visible_contact_ids}}, {"school_id": {"$in": owned_school_ids}}, {"lead_id": {"$in": my_lead_ids}}]}]}]}` where visible contacts = `db.contacts.find({"$or": await _contacts_visibility_or(email)}, {"contact_id":1})`, my leads = `db.leads.find(_owner_clause(email), {"lead_id":1})`. Hidden chats are excluded everywhere (`"hidden": {"$ne": True}`).
  - `async def _chat_or_403(chat_id, user) -> dict` — 404 when missing, 403 when outside scope.
  - Routes (all `await get_current_user(request)` first):
    - `GET /wa/chats?scope=mine|unassigned|all&status=open|resolved|all&instance=&q=&page=1&page_size=50` → `{"items": [chat + {"instance_label", "owner_email", "contact_name", "school_name", "opted_out": bool}], "total", "page", "unread_total"}`. `scope=mine` = `assignee_email == me` OR `instance_name` in my instances; `unassigned` = `assignee_email == ""`; `all` = everything in scope (for a rep this equals their scope). `q` matches `display_name`, `phone_e164`, `contact_name` (regex, case-insensitive). Sorted `last_message_at` desc.
    - `GET /wa/chats/{chat_id}/messages?before=<iso>&limit=50` → `{"items": [...oldest→newest...], "has_more": bool}`; rows never include `instance_token`; media `url` passed through as stored.
    - `POST /wa/chats/{chat_id}/send` body `{text?, attachment_id?, template_id?, quoted_provider_msg_id?}` → rules: text or attachment required (400); the chat's instance must exist and be `connected` (409 `"<label> is not connected"`); a rep may send when the instance is one of theirs, or it is the company instance and the chat is in scope; a manager may send on any instance; `template_id` → render with the chat's contact/school and `my_name = user.name`, `my_phone = instance.phone_e164`; `attachment_id` → `db.whatsapp_attachments` doc → `media = {"type": attachment_type, "url", "filename", "mime": content_type}`; call `send_whatsapp(db, to=chat.phone_e164, text=..., media=..., kind="chat", typed_by=user["email"], channel=chat["instance_name"], contact_id=chat.contact_id, lead_id=..., school_id=..., enforce_consent=False)`; `quoted_provider_msg_id` is stored on the row (`$set` after the send) — Evolution quoting is out of scope (spec says stored/shown, not sent quoted); response `{"status", "message_id", "reason", "message": <the row>}`; on `skipped`/`failed` return 200 with the reason (the UI shows it inline), never 500.
    - `POST /wa/chats/{chat_id}/read` → `$set unread_count 0`, collect up to 50 inbound rows with `read_at` absent → `$set read_at`, then best-effort `EvolutionClient.mark_read(instance, keys, token)` (exception → logged), publish `chat_updated`.
    - `POST .../resolve`, `POST .../reopen` → status; publish `chat_updated`.
    - `POST .../assign` body `{email}` → managers only (403 otherwise); `email` must be an active user; publish.
    - `POST .../notes` body `{text}` → `$push notes {by, text, at}` (max 2000 chars); `GET` not needed (notes come with the chat).
    - `POST .../link` body `{contact_id?} | {school_id?} | {create_contact: {name, school_id?}}` → sets the record ids on the chat and on every row of the chat that has none; `create_contact` inserts a contact `{contact_id: f"con_{uuid}", name, phone: phone_e164, school_id, assigned_to: <instance owner or me>, created_by: me, created_at, source: "whatsapp"}`; a rep may link only to a record they can see (403).
    - `GET /wa/messages?contact_id=|school_id=|lead_id=&limit=20` → the latest rows for that record (scoped like chats: a rep gets them only if the chat they belong to is in scope), newest first, plus `chat_id` per row for "Open chat".
    - `GET /wa/unread-count` → `{"unread": <sum unread_count over in-scope open chats>}`.
    - `GET /wa/stream` → `StreamingResponse(_events(user), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"})`; `_events` yields `": connected\n\n"`, then every bus event that passes `_event_in_scope(event, scope)` as `f"event: {type}\ndata: {json}\n\n"`, and `": ping\n\n"` every 25 s of silence; the scope is recomputed every 300 s. `_event_in_scope(event, scope)`: None → True; else instance in my instances, or (instance == company and any of contact/school/lead ids in my id sets). For `instance_state` events: in scope when the instance is mine or I am a manager.
- [ ] **Step 1: failing tests** — `tests/test_wa_inbox_routes.py` (pattern of `test_wa_routes.py`: `_as(user, monkeypatch)` patches `get_current_user` on the new module; `FakeRequest(body, query_params)`; `monkeypatch.setattr(crm_routes, "db", env.db)` as well). Seed: company connected; reps parul (`rep_parul`, connected) and kalpana (`rep_kalpana`); contacts A (assigned parul, school S1 owned by parul), B (assigned kalpana), C unassigned at school S2; chats: `rep_parul:A`, `rep_kalpana:B`, `smartshape:A` (company chat with A), `smartshape:C`, and a hidden group chat. Tests:
  - `test_rep_sees_own_instance_chats_and_company_chats_for_own_records_only` — parul lists → `rep_parul:A`, `smartshape:A`; not `rep_kalpana:B`, `smartshape:C`, not the group.
  - `test_manager_sees_everything_including_the_owner_with_no_module_permissions` — OWNER and MULTI_ADMIN list 4 chats (group hidden).
  - `test_scope_filters_mine_unassigned_and_status` — manager `scope=mine` (assignee == manager) → 0; `unassigned` after clearing `assignee_email` on one chat → 1; `status=resolved` → only resolved.
  - `test_search_matches_name_and_phone`.
  - `test_messages_are_paged_oldest_to_newest_with_before_cursor` — 70 rows → first page 50 newest (returned ascending), `has_more True`; `before=<oldest.created_at>` → 20.
  - `test_rep_cannot_read_or_send_on_another_reps_chat` — kalpana on `rep_parul:A` → 403 for messages and send.
  - `test_manager_reply_goes_out_from_the_reps_number_and_is_attributed` — OWNER sends on `rep_parul:A` → `fake.sends[-1]["instance"] == "rep_parul"`; row `typed_by == OWNER.email`, `sent_via_owner_email == parul`, `kind == "chat"`; chat `last_direction "out"`, preview text; a `message_new` event was published (subscribe before sending).
  - `test_rep_reply_on_company_chat_for_own_record_is_allowed_but_not_for_others` — parul on `smartshape:A` → sent; parul on `smartshape:C` → 403.
  - `test_send_on_a_disconnected_number_is_409` — set `rep_parul.state = "disconnected"` → 409, `fake.sends == []`.
  - `test_send_with_template_renders_contact_and_my_phone` — template `"Hi {contact_name} from {my_name} {my_phone}"` → text uses contact A's name, user name, instance phone.
  - `test_send_with_attachment_uses_the_stored_url` — attachment doc → `fake.sends[-1]["media"] == url`, `mediatype == "document"`.
  - `test_chat_reply_bypasses_the_daily_cap_but_not_the_hourly` — ledger `sent_count` at the daily cap → still sent; hour bucket at `hourly_cap` → `queued`, response 200 with `status "queued"` (the row exists).
  - `test_read_marks_locally_and_calls_evolution` — 3 inbound unread → `unread_count 0`, `read_at` set, `fake.read_marks[-1]["readMessages"]` has 3 keys with `fromMe False`.
  - `test_resolve_reopen_assign_notes` — assign by a rep → 403; by manager → ok; notes appended with `by`.
  - `test_link_sets_record_on_chat_and_rows_and_create_contact_makes_one` — `create_contact` → contact with `phone == chat.phone_e164`, `source "whatsapp"`; rows updated.
  - `test_unread_count_is_scoped` — parul sees only her chats' unread.
  - `test_messages_by_record_is_scoped` — `GET /wa/messages?contact_id=A` for parul (in scope) returns rows; for kalpana → empty.
  - `test_stream_filters_events_by_scope_and_pings` — call `_events(user, ping_s=0.05)` for parul; publish one event on `rep_kalpana:B` and one on `rep_parul:A`; read the generator up to 1 s: the yielded frames contain `chat_id "rep_parul:A"` once, never `rep_kalpana:B`, and at least one `: ping`.
- [ ] **Step 2: run** → FAIL. **Step 3: implement** `routes/wa_inbox_routes.py` + `main.py` include. **Step 4: run** the file + `tests/test_wa_routes.py tests/test_wa_send_caps.py` → green; `python -c "import main"` imports. **Step 5: commit** `feat(wa): inbox routes — scoped chats, messages, attributed send, read/resolve/assign/notes/link, SSE stream, unread (W2 task 4)`.

---

### Task 5: History sync on first link

**Files:**
- Modify: `backend/services/wa_inbox.py` — add `sync_history(db, inst, *, days=90, max_chats=200, max_messages=5000) -> dict`
- Modify: `backend/routes/wa_routes.py` `_on_open` — replace the Task 3 `hasattr` guard with the real call; also `POST /wa/instances/{name}/resync-history` (admin) that clears `history_synced_at` and starts the task (for a retry).
- Test: `backend/tests/test_wa_history_sync.py`

**Interfaces:**
- `sync_history`: `find_chats` → keep chats whose jid ends `@s.whatsapp.net` (skip groups/newsletters), newest first, up to `max_chats`; for each, `find_messages(page=1..pages)` until a record older than `now - days` or `max_messages` total; each record goes through `ingest_message(db, inst, record)` (idempotent, so a webhook that already delivered a message is a no-op); **no engagement events and no bus events during history sync** (pass `quiet=True` to `ingest_message`; add that keyword in this task) and unread counts are NOT bumped for history (`upsert_chat(..., inbound=False)` path for history rows — pass `history=True`); finally `$set history_synced_at, history_stats {chats, messages, truncated}` on the instance; every Evolution error is caught per chat and counted; the function never raises.
- [ ] **Step 1: failing tests** — `test_wa_history_sync.py`: `test_first_open_starts_a_sync_and_marks_the_instance` (webhook `CONNECTION_UPDATE open` on an instance without `history_synced_at` → after `await asyncio.sleep(0)` loops / awaiting the created task, `history_synced_at` set, rows ingested from `fake.chats`/`fake.messages`, `unread_count 0`, `engagement_events` count 0); `test_a_second_open_does_not_resync`; `test_sync_stops_at_the_day_window_and_the_message_cap`; `test_one_bad_chat_does_not_stop_the_others` (`fake.messages` for one jid raises via a knob `fake.fail_find_for = {jid}` — add it to the fake); `test_admin_resync_route_clears_and_restarts`.
- [ ] **Steps 2–5** as before; commit `feat(wa): history sync on first link, admin resync (W2 task 5)`.

---

### Task 6: Frontend API + hooks (`useWaStream`, `useWaInbox`)

**Files:**
- Modify: `frontend/src/lib/api.js` — after `waNumbers` (line ~540):

```js
export const waInbox = {
  chats:        (params)            => API.get('/wa/chats', { params }),
  messages:     (chatId, params)    => API.get(`/wa/chats/${encodeURIComponent(chatId)}/messages`, { params }),
  send:         (chatId, data)      => API.post(`/wa/chats/${encodeURIComponent(chatId)}/send`, data),
  read:         (chatId)            => API.post(`/wa/chats/${encodeURIComponent(chatId)}/read`),
  resolve:      (chatId)            => API.post(`/wa/chats/${encodeURIComponent(chatId)}/resolve`),
  reopen:       (chatId)            => API.post(`/wa/chats/${encodeURIComponent(chatId)}/reopen`),
  assign:       (chatId, email)     => API.post(`/wa/chats/${encodeURIComponent(chatId)}/assign`, { email }),
  addNote:      (chatId, text)      => API.post(`/wa/chats/${encodeURIComponent(chatId)}/notes`, { text }),
  link:         (chatId, data)      => API.post(`/wa/chats/${encodeURIComponent(chatId)}/link`, data),
  byRecord:     (params)            => API.get('/wa/messages', { params }),
  unreadCount:  ()                  => API.get('/wa/unread-count'),
  streamUrl:    ()                  => `${BACKEND_URL}/api/wa/stream`,
  templates:    ()                  => API.get('/whatsapp-templates'),
  uploadAttachment: (file) => { const fd = new FormData(); fd.append('file', file);
    return API.post('/whatsapp/attachments/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } }); },
};
```

- Create: `frontend/src/hooks/useWaStream.js` — `useWaStream(onEvent, { enabled = true })`: opens `new EventSource(waInbox.streamUrl(), { withCredentials: true })`, listens for `message_new`, `message_status`, `chat_updated`, `instance_state` (`addEventListener` per type; parse JSON; call `onEvent(type, data)`), closes on unmount, exposes `{ connected, lastError }`; on `error` sets `connected false` (the browser reconnects itself) and after 3 consecutive errors switches to a 30 s polling flag `degraded true` that the inbox hook uses to refetch.
- Create: `frontend/src/hooks/useWaInbox.js` — state: `filters {scope:'mine'|'unassigned'|'all', status:'open', instance:'', q:''}`, `chats`, `total`, `unreadTotal`, `selectedId`, `messages`, `hasMore`, `loading`, `sending`; actions: `setFilters`, `select(chatId)` (loads messages, calls `read` when `unread_count > 0`, optimistic unread 0), `loadOlder()`, `send({text, attachment_id, template_id})` (optimistic pending bubble with `message_id: 'tmp_…'`, replaced by the server row; on `status !== 'sent' && !== 'queued'` the bubble shows the reason), `resolve/reopen/assign/addNote/link`; stream handling: `message_new` for the selected chat appends (dedupe by `message_id`), for any chat updates that chat's preview/unread and moves it to the top (insert if unknown and in the current filter), `message_status` updates the bubble ticks, `chat_updated` merges; when `degraded`, refetch list every 30 s. Managers get `isManager` from `useAuth()` (`user.role === 'admin'` or `user.roles?.includes('admin')`) — the server is the real gate.
- Test: `frontend/src/hooks/__tests__/useWaStream.test.js`, `useWaInbox.test.js` (mock `EventSource` on `global` with a controllable fake: `instances[]`, `emit(type, data)`, `error()`; mock `../../lib/api`).
- [ ] **Step 1: failing tests** — `useWaStream`: opens once with the stream URL, dispatches parsed events by type, closes on unmount, `degraded` after 3 errors. `useWaInbox`: initial load calls `waInbox.chats` with `{scope:'mine', status:'open', page:1}`; `select` loads messages ascending and calls `read` when unread; `send` inserts an optimistic bubble then replaces it with the server row; a `message_new` stream event for another chat moves it to the top with `unread_count` from the event; a `message_status` event updates the bubble; `send` with a `skipped` answer keeps the bubble with `fail_reason`.
- [ ] **Steps 2–5** — run `CI=true npx craco test --watchAll=false --testPathPattern "useWaStream|useWaInbox"`, implement, green, commit `feat(wa): inbox API, stream hook and inbox state hook (W2 task 6)`.

---

### Task 7: The `/whatsapp` page — list, conversation, composer, rail, nav, badge

**Files:**
- Create: `frontend/src/components/whatsapp/ChatList.js` (rows: initials avatar, name (contact → school line), preview, relative time, unread badge, instance chip `via <label>` for managers, filters bar: scope tabs mine/unassigned/all, status toggle open/resolved, rep select (managers), search box), `ChatView.js` (header with name/phone/instance/`Resolve|Reopen`, message bubbles: out right / in left, ticks by status (`queued` clock, `sent` ✓, `delivered` ✓✓, `read` ✓✓ blue, `failed`/`skipped` red with reason), media inline (image, video, audio `<audio controls>`, document link with filename), quoted context line, "sent by <typed_by name> via <label>" tag when `typed_by !== sent_via_owner_email`, yellow internal-note bubbles, date separators, "History before <date> may be incomplete" banner when `instance.history_synced_at` exists, opt-out banner when `chat.opted_out`, "Load older" at the top), `Composer.js` (textarea, Enter sends / Shift+Enter newline, attachment button → `uploadAttachment`, template picker → inserts rendered text by calling `send` with `template_id` OR pre-fills (choose: **pre-fill the textarea** via `POST /whatsapp/render-template` so the rep can edit before sending), disabled with reason when the instance is not connected), `ChatRail.js` (linked contact/school card with "Open in CRM" (`/schools/<id>` / contact panel), "Link to a record" (search contacts by name/phone; "Create contact" form), assignee select (managers), private notes list + add).
- Create: `frontend/src/pages/WhatsAppInbox.js` — `AppShell` wrapper; desktop: 3 columns (list 320 px / conversation flex / rail 280 px, rail collapsible); mobile (< md): list OR conversation (back button), rail as a bottom sheet; `?chat=<id>` query param selects a chat (deep link from the CRM).
- Modify: `frontend/src/App.js` — `const WhatsAppInbox = lazyRoute(() => import('./pages/WhatsAppInbox'));` + `<Route path="/whatsapp" element={<ProtectedRoute><WhatsAppInbox /></ProtectedRoute>} />` next to `/me/whatsapp`.
- Modify: `components/layouts/AdminNavItems.js` — add `{ path: '/whatsapp', icon: MessageCircle, label: 'WhatsApp Inbox' }` right after `'/marketing'` (line ~52) and the title mapping (line ~146); `SalesLayout.js` — nav item `{ path: '/whatsapp', icon: MessageCircle, label: 'Chats', perm: null }` after Quotes (line ~14); `AppShellNav.js` — sales list: replace nothing, add `{ path: '/whatsapp', icon: MessageCircle, label: 'Chats' }` after Quotes (keep ≤ 5 items: drop `Leave` from the mobile sales tabs — it remains reachable from the menu); admin list: replace `Mktg` with `{ path: '/whatsapp', icon: MessageCircle, label: 'Chats' }`.
- Modify: `components/layouts/AppShell.js` — poll `waInbox.unreadCount()` every 60 s (and on a `message_new` event when `useWaStream` is mounted on the page) and pass `waUnread` to the nav components so the Chats item shows a badge (same style as the notification badge).
- Tests: `pages/__tests__/WhatsAppInbox.test.js` (mock `useWaInbox` → renders list + selected conversation; clicking a row calls `select`; sending calls `send`; manager sees the instance chip and assign select; mobile viewport shows one pane), `components/whatsapp/__tests__/ChatView.test.js` (ticks per status, attribution tag, media kinds, note bubble), `Composer.test.js` (Enter sends, Shift+Enter does not, disabled when not connected, template pre-fill), `ChatList.test.js` (filters emit, unread badge, search debounce 300 ms).
- [ ] **Step 1: failing tests** for the four files above. **Step 2: run** `--testPathPattern "WhatsAppInbox|ChatView|Composer|ChatList"` → FAIL. **Step 3: implement** (follow `MyWhatsApp.js` tokens; `lucide-react` icons `MessageCircle, Send, Paperclip, Check, CheckCheck, Clock, AlertCircle, StickyNote, Link2, UserPlus, ArrowLeft`). **Step 4: green** + `--testPathPattern "MyWhatsApp|AppShell|SalesLayout"` still green. **Step 5: commit** `feat(wa): /whatsapp team inbox page, nav entries, unread badge (W2 task 7)`.

---

### Task 8: WhatsApp on the contact panel and the school profile

**Files:**
- Create: `frontend/src/components/whatsapp/RecentWhatsApp.js` — props `{contactId?, schoolId?, leadId?, limit=20}`; loads `waInbox.byRecord`; renders the last 20 messages (compact bubbles, direction, time, status tick) and an **Open chat** link to `/whatsapp?chat=<chat_id>`; empty state "No WhatsApp messages yet"; when the record has a phone but no chat: "Start a chat" → `POST /wa/chats/start` … **(ruling: not built — the rep opens the inbox and searches; keep the component read-only)**.
- Modify: `components/crm/ContactDetailPanel.js` — `TABS` gets `{ id: 'whatsapp', label: 'WhatsApp' }` after `call`; tab body `<RecentWhatsApp contactId={detailContact.contact_id} />`.
- Modify: `pages/admin/SchoolProfile.js` — a `RecentWhatsApp` card (`schoolId`) placed under `SchoolActivitiesCard` in the right column (re-grep where that card renders).
- Tests: `components/whatsapp/__tests__/RecentWhatsApp.test.js`; extend `components/crm/__tests__/ContactDetailPanel.test.js` if it exists (else create a minimal one: the tab renders).
- [ ] Steps 1–5; commit `feat(wa): recent WhatsApp on contact panel and school profile (W2 task 8)`.

---

### Task 9: Deployment — tests, bundle, SSE through nginx, push, live checks

- [ ] **1. Backend:** `python -m pytest tests/test_evolution_client.py tests/test_wa_inbox_ingest.py tests/test_wa_events.py tests/test_wa_inbox_routes.py tests/test_wa_history_sync.py tests/test_wa_webhook.py tests/test_wa_send.py tests/test_wa_send_caps.py tests/test_wa_routes.py tests/test_wa_callers.py tests/test_wa_health.py -q -p no:cacheprovider` (guarded) → green; then the whole suite the guarded way with `--ignore` for the seven legacy live-server files main carries (`test_import_performance.py`, `test_performance_benchmarks.py`, `test_iteration22–26_*.py`) → no new failures vs main; `python -c "import main"`.
- [ ] **2. Frontend:** `CI=true npx craco test --watchAll=false` (whole suite) → green; `bash scripts/build-frontend.sh`; `grep -c "localhost:8000" frontend/build/static/js/main.*.js` → 0; `grep -l "WhatsApp Inbox" frontend/build/static/js/*.js | head -1` non-empty; `git add frontend/build`; commit `chore(frontend): rebuild bundle for the WhatsApp inbox`.
- [ ] **3. nginx (VPS, host nginx that fronts `/api/`):** add inside `location /api/` (or a dedicated `location /api/wa/stream`): `proxy_buffering off; proxy_cache off; proxy_read_timeout 3600s; proxy_http_version 1.1; proxy_set_header Connection "";` — mirror the change in the repo's `nginx-vps.conf` (commit `ops(nginx): unbuffered /api/wa/stream for SSE`), then on the VPS: `nginx -t && systemctl reload nginx`.
- [ ] **4. Merge + push** (owner's go-ahead per session rules): `git fetch origin && git merge origin/main` (rebuild the bundle if `frontend/build` conflicts), push the branch, open the PR, fast-forward main; watch `/var/log/ss-autodeploy.log` for `deploy OK`.
- [ ] **5. Live checks:** `curl -s -o /dev/null -w '%{http_code}' https://app.smartshape.in/api/wa/chats` → 401; `curl -N -s -m 5 -o /dev/null -w '%{http_code}' https://app.smartshape.in/api/wa/stream` → 401; after login in the browser: `/whatsapp` renders; the backend log shows `[wa] backfill: N raw events ingested`; send a WhatsApp from the owner's phone to the company number → the chat appears within 2 s without refresh; reply from the app → it arrives on the phone; `docker logs --since 10m smartshape-backend | grep -ciE "traceback"` → 0.
- [ ] **6.** Memory + ledger updated; PR body lists what W2 shipped and what W4 still owes (opt-out keywords, filters, reports, retention).

---

## Self-review

### Spec W2 coverage

| Spec W2 item | Task |
|---|---|
| Normalise `MESSAGES_UPSERT`/`SEND_MESSAGE` to `wa_messages` (direction, `@lid` via `remoteJidAlt`, groups stored hidden, text, media via `getBase64FromMediaMessage` + `services/storage.py`, caption, quoted id) | 2 (+1 for the client call) |
| Upsert `wa_chats` (unread +1 inbound, last_*), match contact/lead/school by last-10 digits, unknown → `display_name = pushName` | 2 |
| Every inbound writes an engagement event (`direction: in`) | 2 |
| History on first link (`findChats` + `findMessages`, 90 days, `history_synced_at`, "may be incomplete" banner) | 5 (banner: 7) |
| `GET /wa/chats` scoped (reps: own instances + company chats for owned records; managers: all), unread counts, assignee | 4 |
| `GET /wa/chats/{id}/messages` paginated | 4 |
| `POST /wa/chats/{id}/send` → `send_whatsapp(kind="chat", typed_by, channel=instance)`; manager allowed + recorded; rep 403 on another rep's instance | 4 |
| read (local + `markMessageAsRead`), resolve, reopen, assign, notes, link | 4 (+1) |
| `GET /wa/stream` SSE scoped, Redis pub/sub between ingest and connections; `GET /wa/unread-count` | 3, 4 |
| `/whatsapp` two-pane page, list/filters/instance chip, bubbles with ticks, media, quoted, attribution tag, composer (attachment, template, Enter), opt-out banner, rail with CRM card, notes, live updates | 6, 7 |
| Contact and school panels: last 20 messages + Open chat | 8 |
| Testing → W2 line | 2, 3, 4, 5, 6, 7 |
| Security: media through the app, RBAC, attribution | 2, 4 |

### Placeholder scan
No "TBD/TODO/later" in steps. One explicit non-build ruling (Task 8 "Start a chat") is stated as a ruling, not a placeholder.

### Name consistency
`chat_id = f"{instance_name}:{remote_jid}"` (W1 `_stamp_sender` and `_on_send_message` already use exactly this) — Tasks 2, 4, 6, 7. Event types `message_new | message_status | chat_updated | instance_state` — Tasks 3, 4, 6. API method names in `waInbox` ↔ routes in Task 4 one-to-one. `is_manager` ↔ `_is_admin or sees_all(user, "leads")` — Tasks 4, 6 (client-side hint only).
