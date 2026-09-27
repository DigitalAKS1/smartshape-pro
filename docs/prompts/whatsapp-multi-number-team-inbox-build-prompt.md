# Build prompt — Multi-number WhatsApp (per-rep numbers + company number) with a team inbox

> Paste this whole file as the first message of a build session. It describes a system that is
> already live in SmartShape Pro (FastAPI + MongoDB + React, Evolution API). Rebuild it for the
> target product named in **Fill in first**. Follow the design rules exactly; they are the result
> of production incidents and review findings, not preferences.

## Fill in first

```
PRODUCT            = BizGuiders (multi-tenant SaaS)          # or another product
BACKEND            = FastAPI + Motor (MongoDB), one DB per tenant
FRONTEND           = React (Vite/CRA), Tailwind, cookie auth
TENANCY            = DB-per-tenant; tenant resolved from the request (subdomain / JWT claim)
WHATSAPP ENGINE    = Evolution API v2.3.7 (evoapicloud/evolution-api), Baileys, self-hosted
SERVER RAM         = <GB>   (each linked number costs ~300–500 MB; cap numbers accordingly)
PUBLIC APP URL     = https://<app-domain>            # webhooks and media URLs use it
OWNER/ADMIN ROLE   = <role names that count as "manager">
RECORD TYPES       = <contact / lead / customer / school ...>  (what a chat gets matched to)
ROLLOUT            = per tenant; nothing sends until an admin links a number
```

Process rules for the session: brainstorm → spec → plan → subagent-driven development with a
review after every task and one whole-branch review at the end. Tests never send anything real.
No new third-party backend dependency unless the production image can install it.

---

## 1. What the system does (one paragraph)

Each salesperson links a **company-owned SIM** to the app by scanning a QR; the company also has one
number. Every WhatsApp message the product sends (manual chats, drips, greetings, campaigns,
notifications) goes through **one send function** that picks the sender (the record owner's linked
number, else the company number), enforces consent/opt-out/business hours/per-number caps, sends
through Evolution, and writes one audit row. Every message a linked number sends or receives lands
in the app as one row inside one conversation, matched to the customer record by phone. Reps chat
from the app on their own number; managers open any conversation and reply **as the rep**
(attributed). A live inbox page updates over Server-Sent Events.

## 2. Binding design rules (D1–D11)

- **D1 Dedicated company SIM per rep.** A ban costs a SIM, not a personal WhatsApp. Warn (never
  block) when the linked number equals the rep's profile phone.
- **D2 Owner-routed sending with company fallback.** Sender = the record owner's connected number →
  else the company number; the log records `used_company_fallback` and why (`fallback_reason`).
- **D3 One door.** `services/wa_send.py: send_whatsapp(db, *, to, text, media, kind, ref,
  owner_email, contact_id, lead_id, school_id, typed_by, channel, enforce_consent) ->
  {status: sent|queued|skipped|failed, message_id, instance_name, reason}` is the only code that
  sends. Delete every other sending path. `channel` = `auto | rep | company | <instance_name> |
  official` (`official` reserved for a future BSP; returns `skipped(official_channel_not_configured)`).
- **D4 Managers read and reply as the rep.** A manager may send on any instance; the row records
  `typed_by` (manager) and `sent_via_owner_email` (the rep). Reps see only their own numbers' chats
  plus company-number chats for records they own; a rep never sends on another rep's instance.
- **D5 Ban protection per number, configurable, enforced in the door.** Defaults: warm-up 20/day
  doubling every 3 days to 200/day; ≤ 30/hour; random 8–25 s gap between automated sends from one
  number; automations only 09:00–19:00 local; max one automated message per contact per number per
  day; number-exists check before first contact (cache: false 7 d, true 30 d, unknown → send);
  auto-pause after 5 consecutive **instance-level** failures (transport, 5xx, 401/403/404) with an
  admin alert; any pause needs an admin resume. Manual chat replies bypass the daily cap but not
  the hourly cap or gap. Internal kinds (digest/alert to staff) bypass warm-up/daily cap only.
- **D6 Evolution pinned and private.** `evoapicloud/evolution-api:v2.3.7`, port bound to
  `127.0.0.1`, backend reaches it by container name, global API key only in backend env,
  per-instance tokens stored and used for instance-scoped calls, `SYNC_FULL_HISTORY=true`,
  websocket off (you fan out yourself), global webhook off (per-instance webhooks).
- **D7 Capacity is server-bound.** `max_instances` setting (default = what the RAM allows); refuse
  a new link when the host's free RAM (read by a cron script, stored in settings) is below 500 MB.
- **D8 Thin inbox, no Chatwoot.** `wa_messages` + `wa_chats` + one React page + SSE.
- **D9 Store every message once**, unique on `(instance_name, provider_msg_id)`; webhook deliveries
  are idempotent; inbound media downloaded via `getBase64FromMediaMessage` and stored by the app,
  never left as an Evolution reference; the row is written **before** the provider call
  (`status: sending`) so a crash mid-send never loses a row and never resends.
- **D10 Consent/opt-out enforced in the door.** Consent gates only automations (`drip`,
  `greeting`); opt-out (`wa_opt_out` on the record) blocks every automated kind; manual chat is
  allowed. Inbound STOP/UNSUBSCRIBE (+ local-language words) sets opt-out and replies once.
- **D11 BSP-ready.** The `channel` hint exists so an official API can be added without touching
  callers.

## 3. Data model (Mongo, per tenant DB)

```
wa_instances     {instance_name, kind: rep|company, owner_email, label, phone_e164, jid,
                  state: unlinked|qr|connected|disconnected|paused, state_at, last_seen_at,
                  instance_token, warmup_started_at, daily_cap_override, paused_reason, paused_by,
                  consecutive_failures, proxy{host,port,protocol,username,password},
                  notice_accepted_at, history_synced_at, history_stats, qr_base64, qr_at, created_at}
wa_messages      {message_id "wam_<16hex>", instance_name, provider_msg_id, chat_id, direction in|out,
                  from_jid, to_jid, to_e164, contact_id, lead_id, school_id, kind, ref{},
                  text, media{type,url,mime,filename,size,caption,pending?}, quoted_provider_msg_id,
                  typed_by, owner_email, sent_via_owner_email, sender_kind, used_company_fallback,
                  fallback_reason, provider, status queued|sending|sent|delivered|read|failed|skipped,
                  status_history[{status,at,reason}], fail_reason, send_after, queue_reason,
                  claim_token, claimed_at, sending_at, source app|phone|webhook, hidden, contentless,
                  push_name, lid, created_at, sent_at, sent_day, received_at, read_at, provider_ts}
wa_chats         {chat_id = f"{instance_name}:{remote_jid}", instance_name, remote_jid, phone_e164,
                  display_name, push_name, contact_id, lead_id, school_id, assignee_email,
                  status open|resolved, unread_count, last_message_at, last_message_preview,
                  last_direction, last_message_id, notes[{by,text,at}], hidden, lid, created_at, updated_at}
wa_send_ledger   {instance_name, day (local date), sent_count, hour_bucket{"09": n,...}, last_sent_at,
                  last_claim_at}   unique (instance_name, day)
wa_number_cache  {e164, exists, checked_at}
wa_receipts_pending {instance_name, provider_msg_id, status, at}   TTL 1 day
wa_events_raw    (only for a pre-inbox phase; TTL 30 d; processed flag)
settings {type:"wa"}         the D5 policy + drip_wa_enabled, greetings_enabled (default OFF),
                             fallback_provider, max_instances, opt_out_keywords
settings {type:"wa_health"}  {mem_available_mb, mem_total_mb, evolution_mem_mb, at}  (host cron)
users            + wa_instance_name
records          + wa_opt_out, wa_opt_out_at, wa_opt_out_source
```

Indexes (all created through a guarded helper that logs and continues on conflict):
`wa_messages (instance_name, provider_msg_id)` unique partial on provider_msg_id present;
`message_id` unique; `(chat_id, created_at)`; `(contact_id, created_at)`; `(school_id, created_at)`;
`(status, send_after)`; `(status, sending_at)`; `wa_chats.chat_id` unique; `(instance_name,
last_message_at)`; `(status, last_message_at)`; `assignee_email`; `contact_id`; `school_id`; `lead_id`;
`wa_send_ledger (instance_name, day)` unique; `wa_instances.owner_email`.

**Every update that can insert must keep `$set` and `$setOnInsert` disjoint** (real Mongo rejects
the overlap; mongomock hides it). Build the update through one helper that pops every `$set` key
from `$setOnInsert`, and test that invariant on every branch.

## 4. Backend components

### 4.1 `services/evolution_client.py`
One network chokepoint `_request(method, path, json, token, timeout)`; methods: `create_instance`
(`integration: WHATSAPP-BAILEYS, qrcode: true, syncFullHistory: true`), `get_qr`, `get_status`,
`connection_state`, `fetch_instance`, `logout`, `delete_instance`, `set_webhook` (per-instance URL +
a secret **header**, `byEvents: false`, `base64: false`, events `MESSAGES_UPSERT, MESSAGES_UPDATE,
CONNECTION_UPDATE, QRCODE_UPDATED, SEND_MESSAGE`), `set_proxy`/`find_proxy`, `check_numbers`,
`send_text`, `send_media`, `mark_read`, `get_media_base64`, `find_chats`, `find_messages`
(normalise every answer shape to `{records, total, pages}`). `EvolutionError(status_code, body)`.

### 4.2 `services/wa_send.py` (the door)
Order: validate kind → resolve owner (record's `assigned_to`; lead → contact → school) → build the
row → `bad_phone`/`empty_message` skips → policy (opt-out; consent for drip/greeting; quiet hours
→ queue to next open; per-contact-per-day: drip deferred to tomorrow, greeting **skipped**; hourly
cap → queue; daily/warm-up cap → queue; gap claim in the ledger) → resolve sender (explicit
instance must be `connected`, else `skipped(sender_not_connected)`; young rep numbers never send
campaigns/broadcasts) → number-exists check (not for chat/internal kinds) → `_mark_sending` →
provider call → classify errors (transport/5xx/401/403/404 count toward the pause and may fall
back to a configured emergency provider; other 4xx fail that message; a **timeout never falls back
and never resends**) → `_finish`: write row, apply parked receipts, engagement event, write back to
any legacy scheduled row, touch the chat, publish one bus event (never twice for the same
id/status). Queue drainer every minute per instance: claim with `claim_token`, requeue at most 3
times, sweep stale `sending` rows (no `sending_at` → back to queue; with `sending_at` → `sent` if
evidence exists else `failed(uncertain)`), hold rows whose sender is paused for up to 72 h.

### 4.3 Webhook `POST /api/webhooks/whatsapp/{instance}`
Secret checked from the header **before** the body is read (query fallback masked from access
logs); `payload.instance` must equal the path; unknown instance → 200 ignored; optional per-instance
apikey compare with an env switch; handlers: `CONNECTION_UPDATE` (open → `connected`, phone from
`wuid`; one phone per instance across the tenant; adopting an already-open company number counts
it as warmed; close → `disconnected` + one alert per day; start history sync once), `QRCODE_UPDATED`,
`MESSAGES_UPDATE` (receipts forward-only; park receipts for messages we do not hold yet, apply after
the send finishes), `SEND_MESSAGE` and `MESSAGES_UPSERT` → `wa_inbox.ingest_message`. Handlers never
raise (Evolution retries non-2xx forever).

### 4.4 `services/wa_inbox.py` (ingest)
`normalise_upsert` (direction from `fromMe`; `@lid` via `remoteJidAlt`/`senderPn`; groups, status
and newsletters `hidden`; reaction/protocol/poll/empty messages `contentless` — stored but never
create a chat, unread, engagement or event; text from `conversation`/`extendedTextMessage`/captions;
media type/mime/filename; quoted id; `messageTimestamp` int/float/str/ms) → early duplicate
`find_one` → atomic `$setOnInsert` upsert → media download only for visible live rows (history and
hidden rows get a `pending` stub) → `match_record` by the last 10 digits with a separator-tolerant
regex, contact → lead → record, never overwriting a manual link → `upsert_chat` (unread +1 only for
live inbound; resolved reopens on inbound; history rows move `last_message_*` only when newer) →
engagement event for inbound → publish. `sync_history(inst)`: first link only, 90 days, ≤ 200
chats / 5,000 messages, quiet, guarded against overlap, always stamps `history_synced_at`.
`backfill_raw_events` at startup, quiet, bounded.

### 4.5 `services/wa_events.py` (bus)
`publish(event)` never raises and never blocks > 0.5 s: Redis `PUBLISH` (with `_local_origin` =
process id) + local fan-out to subscriber queues (max 200, drop oldest). `subscribe()` async
generator; one Redis listener per process that retries every 15 s and skips its own echoes.

### 4.6 Routes
- Rep: `GET /wa/me`, `POST /wa/me/link` (privacy notice must be accepted; stores
  `notice_accepted_at`), `/relink`, `/unlink`.
- Admin: `GET /wa/instances` (+ RAM headroom, slots), `POST /wa/instances/company` (adopt/link),
  `pause`/`resume`/`unlink`/`rewebhook`/`resync-history`, `PUT /wa/instances/{name}` (cap
  override), `PUT /wa/instances/{name}/proxy`, `GET/PUT /wa/settings`.
- Inbox: `GET /wa/chats?scope=mine|unassigned|all&status=open|resolved|all&instance=&q=&page=`,
  `GET /wa/chats/{id}/messages?before=&before_id=&limit=50` (cursor on `(created_at, message_id)`),
  `POST /wa/chats/{id}/send {text|attachment_id|template_id}` (409 before the door when the
  instance is not connected; 200 with `status` even when skipped/failed), `/read` (local + phone),
  `/resolve`, `/reopen`, `/assign` (manager; assignee must be a manager or in scope), `/notes`,
  `/link {contact_id|school_id|create_contact}`, `GET /wa/messages?contact_id|school_id|lead_id`,
  `GET /wa/unread-count`, `GET /wa/stream` (SSE; `X-Accel-Buffering: no`; ping every 25 s; scope
  recomputed every 5 min; subscriber queue freed on disconnect).
- Scope: one helper `chat_scope(user)`; manager = admin role, or a CRM reader whose module scope is
  "all"; users with no CRM access get an **empty** scope; the owner account without granular
  permissions must still pass as manager. Hidden chats excluded everywhere. Inbound media served
  only to logged-in users; outbound attachments stay public (Evolution fetches them by URL).

### 4.7 Health
Hourly sweep of `connectionState` per instance (self-heal state, alert once per day per number,
`evolution_down` alert), host cron every 15 min writing free RAM into settings; link refused below
the headroom.

## 5. Frontend
- **My WhatsApp** (`/me/whatsapp`): notice tick → Link → QR refreshed every 20 s → Connected as
  +91 …, warm-up progress "Day 4 of 14 — today 40 of 60", Relink/Unlink, paused-by-admin notice.
- **Settings → WhatsApp** (admin): numbers table (state, owner, phone, today's count/cap, failures,
  memory headroom), Link company number, pause/resume/unlink/limit/proxy, sending-rule fields,
  fallback provider, test message.
- **Inbox** (`/whatsapp`): list (avatar, name → record line, preview, time, unread, instance chip
  for managers; filters mine/unassigned/all, open/resolved/all, rep, search 300 ms) / conversation
  (ticks queued ⏱ sent ✓ delivered ✓✓ read ✓✓ blue, failed with reason; image/video/audio/document
  inline, only http(s) or root-relative URLs become links; quoted line; "sent by X via Y" tag;
  notes as yellow bubbles; date separators; opt-out and 7-day history banners; Load older) / rail
  (record card, Open in CRM by role, link/create record, assignee, notes). Composer: Enter sends,
  Shift+Enter newline, IME-safe, attachment upload, template pre-fill with draft confirmation,
  disabled with reason when the instance is not connected. Mobile stacks with a back button.
  `?chat=<id>` deep link marks read once the list loads.
- Hooks: `useWaStream` (EventSource with cookie auth, `connected` on open, degraded → 30 s poll
  after 3 errors) and `useWaInbox` (optimistic `tmp_` bubble reconciled by id; `preview_only` stubs
  never overwrite full rows but may move status forward; merge fetched pages with stream appends;
  stale guards on select/loadOlder; unknown chat under a narrow filter → debounced refetch).
- Record pages: a "recent WhatsApp" block (last 20, ticks, attribution, Open chat).
- Nav: inbox entry for every role with an unread badge (poll 60 s; stop on 401/403).

## 6. Multi-tenant adaptation (BizGuiders)

1. **Instance naming**: `instance_name = f"{tenant_id}__{kind}_{slug}"` — Evolution is shared, so
   names must be globally unique; never let a tenant address another tenant's instance (every
   `/wa/*` route resolves the instance **inside the tenant DB** first, then calls Evolution).
2. **Webhook**: `POST /api/webhooks/whatsapp/{tenant_id}/{instance}` → resolve the tenant DB from
   the path, verify the secret (one secret per deployment is fine; per-tenant tokens stored on the
   instance are compared too), then the same handlers.
3. **Caps per tenant AND per server**: `max_instances` per tenant plus a global cap derived from
   RAM; the RAM cron writes one global reading; linking checks both.
4. **Storage**: media paths prefixed with the tenant id; serve inbound media only to a logged-in
   user of that tenant.
5. **Scheduler loops** (queue drainer, health sweep, greetings) iterate tenants; keep one in-process
   lock per tenant and a per-row claim token so overlapping passes never double-send.
6. **Bus**: Redis channel `wa:events:{tenant_id}` or one channel with `tenant_id` on every event;
   the SSE endpoint subscribes only to the caller's tenant.
7. **Settings and templates** live in the tenant DB; the D5 defaults are global constants.
8. **Rollout per tenant**: nothing sends until the tenant admin links a company number; drips and
   greetings default OFF; a new number warms up 14 days; campaigns from a young number are refused.
9. **Emergency fallback provider** per tenant, default none.

## 7. Ops
- Evolution compose: pinned image, `127.0.0.1:8080`, joins the app network, reuses the app Redis
  (own DB index), Postgres 15 with backup before any image bump; no warp/tor sidecars.
- nginx: `location = /api/wa/stream` with `proxy_buffering off; proxy_cache off;
  proxy_read_timeout 3600s; proxy_http_version 1.1; proxy_set_header Connection "";` and a
  location for the media path proxied to the backend (a SPA fallback silently returns
  `index.html` for it otherwise — this broke attachment links in SmartShape for months).
- Env: `EVOLUTION_API_URL` (container name), `EVOLUTION_API_KEY`, `WA_WEBHOOK_SECRET`,
  `WA_WEBHOOK_BASE` (public URL), `WA_WEBHOOK_APIKEY_CHECK=on|off`, `REDIS_HOST/PORT`.
- Runbook for any Evolution upgrade: backup Postgres + instance volume → rewrite env (drop
  `CONFIG_SESSION_PHONE_VERSION`) → swap image on the **same** volumes → verify version twice and
  that the public port is closed → link/adopt the company number → test message → repoint the
  backend only together with the code deploy that has the caps.

## 8. Tests that must exist (all offline)
- A conftest guard that blocks every real network call (httpx, requests, Evolution client) and a
  `FakeEvolution` recorder with knobs (`fail_sends`, `not_on_whatsapp`, `state`, `owner_jid`,
  `media`, `read_marks`, `chats`, `messages`, `fail_find_for`).
- Door: resolution order; each cap; quiet hours queue + drain; opt-out/consent skips; number
  cache; 5 failures pause + alert; timeout never falls back; row written before send; webhook
  race (send-first and webhook-first) leaves one row and one event.
- Webhook: secret before body; instance mismatch 400; unknown instance ignored; receipts forward-
  only and parked; one phone per instance.
- Ingest: idempotency; `@lid`; hidden/content-less; media stored / failure stub; record matching;
  manual link preserved; resolved reopens; `$set`/`$setOnInsert` disjoint on every branch.
- Routes: rep vs manager scope (incl. the owner account and users with no CRM access); rep cannot
  read/send on another rep's chat; manager reply attributed; 409 when not connected; cursor with
  equal timestamps; stream filters by scope and pings.
- History: first open only; window and cap; bad page count; overlap guard; newest last message wins.
- Frontend (Jest, `createRoot` + `act`, mocked API and a fake `EventSource`): stream lifecycle and
  degradation; inbox hook races; page, list, composer and view behaviours listed in §5.

## 9. Known gaps to schedule after the first release
Opt-out keyword auto-reply, manager filters (unanswered > 24 h), activity report, media retention,
merging a `@lid` chat into its phone chat, a record picker for linking, tab-visibility guard before
marking read, lazy media fetch for history rows, compare-and-set on the chat's `last_message_at`.
