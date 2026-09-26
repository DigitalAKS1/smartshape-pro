# WhatsApp: per-rep numbers, owner-routed automations, team inbox — Design

**Date:** 2026-09-24
**Status:** Design approved by owner in conversation ("enhance and complete as expert", 2026-09-24). Spec awaiting owner review before planning.
**Author:** Aman Shrivastava (owner) + Claude
**Depends on:** origin/main `b9151a3` (drip ↔ offline-mail A–D live; Redis cache fixed).
**Research (read-only, 2026-09-24):** session scratchpad `whatsapp-research.md` (code map with file:line) and
`evolution-deep-research.md` (external facts with URLs). Line numbers in this spec were taken on `f246cb7`; re-grep before editing.

## Problem

The owner wants WhatsApp to work the way the sales team already works: each salesperson messages schools from a number the school
recognises, the CRM's automations (drips, greetings, birthday/anniversary wishes, campaigns) go out from that same number, images can
be attached, replies come back into the app, and managers can open any conversation and reply as the rep.

What exists today (confirmed against code and the live server on 2026-09-24):

1. **Four separate WhatsApp sending stacks**, chosen per call site, none per user: Evolution API (one global instance, env
   `WHATSAPP_INSTANCE`), MessageAutoSender (six copied HTTP calls), WABA providers (Gupshup/360dialog/Meta — none configured), and
   a `wa.me` link (the only path that actually uses the rep's own phone).
2. **Nothing delivers.** The one Evolution instance is stuck at `connecting` on `atendai/evolution-api:v2.2.3` — a known upstream bug
   fixed in the 2.3.x line. Drip WhatsApp steps and the 9am greeting engine call `_send_wa`, which knows only WABA providers
   (`scheduler.py:215-224`); with none configured every WhatsApp drip step fails and the enrolment pauses after three tries.
3. **Images are lost.** A drip step's `attachment_id` is saved (`drip_routes.py:349-350`) and shown as "Attached", but the executor
   never sends it. Greeting rules have no media field. WABA `_send_wa` is text-only.
4. **Greetings are unreliable.** Two engines fire the same rules through different stacks (`scheduler.py:741-812` and
   `admin_routes.py:1573-1691`) with different dedupe, one uses the UTC date, one ignores audience, `greeting_logs.status` never
   leaves `queued`, and **anniversary is never sent** (rule seeded, no code fires it; contact anniversaries sit unread in
   `custom_fields.anniversary`).
5. **No inbound.** `MESSAGES_UPSERT` is disabled; there is no reply handler, no opt-out, no timeline entry. Delivery receipts exist
   only for campaign rows. The webhook (`/api/webhooks/whatsapp`) is unauthenticated and ignores which instance an event came from.
6. **No audit.** Automated sends log `sent_by: "system"` or nothing; no row records the sender number.
7. **Security:** Evolution's port 8080 is bound on `0.0.0.0` (public), any logged-in user can create/delete/log out any instance
   (`whatsapp_routes.py:769-849`), the Settings proxy form calls an endpoint that does not exist on main (404).
8. **Ban risk is real.** Evolution/Baileys is an unofficial client. Community experience: a new number sending bulk to strangers is
   banned within days; a ban on a personal number takes the rep's own WhatsApp with it.

## Decisions

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
- **D8 — Build a thin inbox; do not adopt Chatwoot.** Evolution's Chatwoot integration has open production bugs in 2.3.x, and a second
  stateful app would duplicate CRM ownership logic. Our inbox is one `wa_messages` collection + one `wa_chats` collection + a React
  page, fed by the webhook, pushed to browsers over Server-Sent Events from FastAPI.
- **D9 — Every message is stored once, keyed by (instance, provider message id).** Webhook deliveries are idempotent; duplicates are
  dropped. Inbound media is downloaded via `getBase64FromMediaMessage` and stored through `services/storage.py` (Cloudinary when
  configured, else local `uploads/whatsapp/`), never left as an encrypted WhatsApp reference.
- **D10 — Consent and opt-out are enforced in the service, not per caller.** `require_wa_consent` (existing setting) gates
  automations; a contact/school with `wa_opt_out: true` is never messaged by an automation and the inbox shows "opted out". Inbound
  `STOP`/`UNSUBSCRIBE`/`बंद`/`रोकें` (configurable list) sets opt-out and replies once with a confirmation.
- **D11 — Official WhatsApp Business API is out of scope now, designed-for later.** `send_whatsapp` takes a `channel` hint
  (`rep|company|official`) so a BSP channel can be added for bulk blasts without touching callers.

## Data model

```
wa_instances        {instance_name, kind: "rep"|"company", owner_email, label, phone_e164, jid, state:
                     "unlinked"|"qr"|"connected"|"disconnected"|"paused", state_at, last_seen_at, proxy: {host,port,protocol,user,pass},
                     instance_token, warmup_started_at, daily_cap_override, paused_reason, created_at}
wa_messages         {message_id (ours), instance_name, provider_msg_id, chat_id, direction: "in"|"out", from_jid, to_jid,
                     contact_id, lead_id, school_id, kind: "chat"|"drip"|"greeting"|"campaign"|"broadcast"|"dispatch"|"intro"|"form"|
                     "fms"|"digest"|"system", ref: {sequence_id, enrollment_id, step_number, rule_id, campaign_id, run_id, …},
                     text, media: {type, url, mime, filename, size, caption}, quoted_provider_msg_id, typed_by, sent_via_owner_email,
                     status: "queued"|"sent"|"delivered"|"read"|"failed"|"skipped", status_history: [{status, at, reason}],
                     fail_reason, created_at, provider_ts}
wa_chats            {chat_id = f"{instance_name}:{remote_jid}", instance_name, remote_jid, phone_e164, display_name,
                     contact_id, lead_id, school_id, assignee_email, status: "open"|"resolved", unread_count, last_message_at,
                     last_message_preview, last_direction, notes: [{by, text, at}], created_at}
wa_send_ledger      {instance_name, day (IST date), sent_count, hour_bucket: {"09": n, …}, last_sent_at, consecutive_failures}
wa_opt_outs         (denormalised onto contacts/schools as wa_opt_out, wa_opt_out_at, wa_opt_out_source; this collection is the log)
greeting_rules      + {media_attachment_id, sender: "owner"|"company", send_time: "09:00"} ; trigger "anniversary" now implemented
users               + {wa_instance_name} (one rep ↔ one instance; admins may hold several via wa_instances.owner_email)
contacts/schools    + {wa_opt_out, wa_opt_out_at, wa_number_checked_at, wa_number_exists}
```
Indexes (all via the guarded `_i()` helper, none unique except where stated): `wa_messages (instance_name, provider_msg_id)` **unique**,
`wa_messages (chat_id, created_at)`, `wa_messages (contact_id, created_at)`, `wa_messages (school_id, created_at)`,
`wa_chats (instance_name, last_message_at)`, `wa_chats (contact_id)`, `wa_send_ledger (instance_name, day)` unique,
`wa_instances (owner_email)`.

## Sub-project W1 — Foundation: Evolution upgrade, one sending service, "My WhatsApp"

### Infrastructure
- Backup `smartshape_postgres_wa` volume (`pg_dump`) to `/var/backups/evolution-<date>.sql` before touching the image.
- New `docker-compose.evolution.yml`: `evoapicloud/evolution-api:v2.3.7`, Postgres 15, Redis (reuse `smartshape-redis`),
  `ports: "127.0.0.1:8080:8080"`, env from `.env.evolution` (not the example file): `AUTHENTICATION_API_KEY`, `SERVER_URL`,
  `WEBHOOK_GLOBAL_ENABLED=false` (we set per-instance webhooks), `WEBSOCKET_ENABLED=false`, `SYNC_FULL_HISTORY=true`,
  `CONFIG_SESSION_PHONE_VERSION` **removed**, `DEL_INSTANCE=false`, `QRCODE_LIMIT=30`. No `warp`/`tor` services.
- The backend reaches Evolution at `http://smartshape_evolution:8080` on the shared docker network (`EVOLUTION_API_URL`); the
  public IP URL goes away.
- Per-instance webhook: `POST /webhook/set/{instance}` → `https://app.smartshape.in/api/webhooks/whatsapp/{instance}?t=<secret>`,
  events `MESSAGES_UPSERT, MESSAGES_UPDATE, CONNECTION_UPDATE, QRCODE_UPDATED, SEND_MESSAGE`. The secret is per deployment
  (`WA_WEBHOOK_SECRET` env); the receiver rejects a wrong or missing secret with 401 and never trusts `payload.instance` without it.
- Health: an hourly job calls `connectionState` for every `wa_instances` row, updates `state`, alerts the owner (bell + push) when a
  rep's number disconnects, and alerts admins when RAM headroom < 500 MB (`/proc/meminfo` via the backend container is not the
  host; use `docker stats`-equivalent from the host script `ss-wa-health.sh` invoked by cron, writing `settings{type:"wa_health"}`).

### Sending service — `backend/services/wa_send.py`
```python
async def send_whatsapp(db, *, to: str, text: str = "", media: dict | None = None, kind: str, ref: dict | None = None,
                        owner_email: str | None = None, contact_id: str = "", lead_id: str = "", school_id: str = "",
                        typed_by: str | None = None, channel: str = "auto", enforce_consent: bool = True) -> dict
# returns {"status": "sent"|"queued"|"skipped"|"failed", "message_id", "instance_name", "reason"}
```
Resolution order: `channel == "company"` → company instance; else owner's connected instance (`users.wa_instance_name` →
`wa_instances.state == "connected"`) → company instance → `skipped(no_sender)`. Then: opt-out check → consent check (automations
only) → quiet hours (automations only; if outside, `queued` with `send_after`) → per-number caps from `wa_send_ledger` (over cap →
`queued`) → number-exists check (cached 30 days on the contact; unknown → `skipped(not_on_whatsapp)`) → jittered delay →
`sendText`/`sendMedia` → ledger increment → `wa_messages` row → engagement event. A `queued` row is drained by a per-instance worker
in `scheduler.py` every minute, oldest first, honouring the same caps. All failures are recorded; five consecutive failures pause
the instance and alert.

Callers migrated in W1 (each becomes a one-line call and loses its own HTTP code): drip WhatsApp step (`scheduler.py:580-593`),
dispatch auto-WA, lead intro, demo link, mailer-QR rep alert, school-portal notify, FMS staff/customer messages, CRM digest,
scheduled-WA, tag broadcast, manual send/send-via-template (`send_mode=api`), campaigns. The WABA `_send_wa` and the six AutoSender
copies are deleted; `_send_wa_autosender` remains only behind `wa.fallback_provider`.

### Routes
- `GET /wa/me` — my instance (state, phone, QR when state is `qr`, warm-up day, today's sent/cap).
- `POST /wa/me/link` — creates the rep's instance (`{instance_name: "rep_<user_id>"}`, `integration: WHATSAPP-BAILEYS`), sets its
  webhook and proxy, returns the QR (base64). `POST /wa/me/relink`, `POST /wa/me/unlink` (Evolution `logout` + state).
- Admin: `GET /wa/instances` (all, with RAM headroom and `max_instances`), `POST /wa/instances/company` (link the company number),
  `POST /wa/instances/{name}/pause|resume|unlink`, `PUT /wa/instances/{name}/proxy`, `PUT /wa/settings` (caps, quiet hours,
  opt-out keywords, fallback provider, max_instances). All gated: reps only on their own instance; admin on any. The old
  admin-agnostic `/whatsapp/instances*` routes are removed; `/whatsapp/proxy-config` is implemented (it currently 404s).
- `POST /api/webhooks/whatsapp/{instance}?t=` — verifies secret, dispatches by event: `CONNECTION_UPDATE` → `wa_instances.state`;
  `QRCODE_UPDATED` → cached QR for `/wa/me`; `MESSAGES_UPDATE` → status history on the `wa_messages` row by `provider_msg_id`;
  `MESSAGES_UPSERT` → W2 ingest; `SEND_MESSAGE` → records `provider_msg_id` for messages sent from the phone.

### Frontend
- **My WhatsApp** page (`/me/whatsapp`, nav under the user menu): state badge, QR with 20-s refresh, "Connected as +91…", warm-up
  progress ("Day 4 of 14 — today 40 of 60"), Relink / Unlink, and the plain-words privacy notice: *"Every message this number sends
  or receives is visible to managers in the app. Link a company number, not your personal one."*
- **Settings → WhatsApp** (admin): instance table (rep, number, state, sent today/cap, last seen, proxy, pause/unlink), company number
  linking, caps and quiet-hours form, RAM headroom, fallback provider. Replaces `WhatsAppConnectionSection` and the Marketing Setup
  provider form.

## Sub-project W2 — Team inbox

### Ingest (webhook `MESSAGES_UPSERT` / `SEND_MESSAGE`)
Normalise to a `wa_messages` row: `direction` from `fromMe`; `remote_jid` → `phone_e164` (drop `@s.whatsapp.net`; `@lid` mapped via
`remoteJidAlt` when present; groups `@g.us` are stored but hidden from the inbox by default); text from `conversation` /
`extendedTextMessage.text`; media types (`imageMessage`, `documentMessage`, `audioMessage`, `videoMessage`, `stickerMessage`) → call
`getBase64FromMediaMessage` (audio with `convertToMp4`), store via `services/storage.py`, keep caption; quoted message →
`quoted_provider_msg_id`. Upsert `wa_chats` (unread +1 on inbound, `last_*`), match `contact_id/lead_id/school_id` by normalised phone
(`_norm_phone`, last 10 digits) against contacts, leads and schools; unknown numbers get a chat with `display_name = pushName`.
Every ingested inbound message writes an engagement event (`direction: in`) so it shows on the contact/school timeline.
History on first link: after `CONNECTION_UPDATE: open`, pull `findChats` + `findMessages` (paginated, last 90 days, best effort) once
and mark the instance `history_synced_at`; the UI shows "History before <date> may be incomplete".

### Routes
- `GET /wa/chats?instance=&scope=mine|unassigned|all&status=&q=&page=` — reps: their instances + company-number chats for records
  they own (`_contacts_visibility_or`); managers/admin: all. Returns unread counts and the assignee.
- `GET /wa/chats/{chat_id}/messages?before=&limit=50` — paginated, newest last.
- `POST /wa/chats/{chat_id}/send` `{text, attachment_id?, template_id?}` → `send_whatsapp(kind="chat", typed_by=me,
  channel=chat.instance)`; a manager sending on a rep's instance is allowed (D4) and recorded; a rep cannot send on another rep's
  instance (403).
- `POST /wa/chats/{chat_id}/read` (marks read locally and calls `markMessageAsRead` for the unread ids), `.../resolve`, `.../reopen`,
  `.../assign` (admin/manager), `.../notes` (private), `.../link` `{contact_id | school_id | create_contact:{…}}`.
- `GET /wa/stream` — Server-Sent Events; the backend fans out `chat_updated` / `message_new` / `instance_state` events scoped to what
  the caller may see. Redis pub/sub carries events between the request that ingests and the SSE connections.
- `GET /wa/unread-count` for the nav badge (also pushed on the stream).

### Frontend — `/whatsapp` page
Two-pane layout (chat list / conversation), mobile stacks. List: avatar/initials, name (contact → school), preview, time, unread
badge, instance chip (rep name) for managers, filters (mine / unassigned / all, open / resolved, rep, search). Conversation: bubbles
with ticks (sent/delivered/read), media inline (image, PDF link, audio player), quoted context, "sent by Aman via Parul's number" tag
on manager replies, composer with attachment (reuse `/whatsapp/attachments/upload`), template insert (existing `/whatsapp-templates`
with `{contact_name} {school_name} {my_name} {my_phone}`), Enter to send, opt-out banner, right rail with the linked contact/school card
and "Open in CRM". Private notes shown as yellow internal bubbles. Live updates via `EventSource('/api/wa/stream')`.
Contact and school detail panels gain a **WhatsApp** section listing the last 20 messages with "Open chat".

## Sub-project W3 — Automations from the right number, with media

- **Drip**: the WhatsApp step calls `send_whatsapp(owner_email=recipient.assigned_to, kind="drip", media=<attachment>)`; the
  attachment is loaded from `whatsapp_attachments` by `attachment_id` (finally sent). Email steps also attach it. The step editor
  shows a sender preview: *"Sends from Parul's WhatsApp (falls back to company)"*. `skipped(opt_out|not_on_whatsapp|no_sender)`
  is recorded on the step log and does NOT count as a failure (no pause); `failed` keeps the existing retry/pause behaviour.
- **Greetings — one engine** (`services/greetings.py`, replaces both loops): runs daily at `rule.send_time` IST (default 09:00),
  computes today's IST `MM-DD`, selects rules by trigger: `fixed_date` (festival), `birthday` (`contacts.birthday`), `anniversary`
  (`contacts.custom_fields.anniversary` **and** `schools.anniversary`, sent to the school's primary contact or all contacts per
  `audience`). Audience is honoured; dedupe per rule + recipient + year in `greeting_logs`, whose `status` now follows the message
  (`sent|delivered|read|skipped|failed`). Placeholders `{name} {school_name} {my_name}`; optional image (`media_attachment_id`) sent
  with the text as caption. Sender per rule: `owner` (default) or `company`. Consent and opt-out apply. The Greetings tab gains the
  image picker, sender choice, send time, and a per-rule preview of "who gets this today" before enabling.
- **Campaigns and tag broadcast**: audience grouped by owner; preview shows "N from Parul, M from Kalpana, K from company"; each
  group sends from its owner's number via the queue (never synchronously in the request); AI personalisation kept; media kept.
  Tag broadcast keeps its D3 audience but moves onto the same queue and caps.
- **Scheduled WA / dispatch / intro / demo / portal / FMS / digest**: `kind` set accordingly; sender = record owner where a record
  exists, else company.

## Sub-project W4 — Manager tools, opt-out, timeline, hygiene

- Manager filters on the inbox (by rep, unread only, unanswered > 24 h), assignment, resolve, notes (W2 routes wired to UI).
- Opt-out keyword handling on inbound (D10) with a one-time confirmation reply from the same number; admin-editable keyword list;
  "Opted out" badge on contact/school; automations skip.
- Timeline: `wa_messages` appear on contact/school/lead 360 communications; the old `whatsapp_logs` viewer reads `wa_messages`.
- Reports: "WhatsApp activity" in the Reports hub — per rep: sent/received/replied, reply rate, by kind; per number: cap usage,
  failures, pauses.
- Retention: media older than `wa.media_retention_days` (default 365) is deleted from storage, the row keeps the caption and a
  "media expired" marker. Messages are kept.
- Cleanup: remove `SetupTab` provider form's wrong webhook URL, delete dead WABA code, delete `warp`/`tor` docs.

## Security and privacy
- Evolution reachable only from the backend container; global apikey only in backend env; per-instance tokens stored in
  `wa_instances.instance_token` and used for instance-scoped calls.
- Webhook secret verified before parsing; payload `instance` must match the URL path.
- RBAC: reps ↔ own instance and own chats; managers (`get_team(user) == "admin" or role == "admin"` — the same admin test used
  everywhere else, so the owner's account with no `module_permissions` keeps passing) see all. Every manager reply is attributed.
- The privacy notice is shown before linking and stored as `wa_instances.notice_accepted_at`.
- Media URLs are served through the app (`/uploads/whatsapp/…` behind auth or Cloudinary signed URLs), never Evolution's.

## Testing
- **Global no-send guard:** a `tests/conftest.py` autouse fixture replaces `services.evolution_client.EvolutionClient` methods and
  `httpx.AsyncClient.post` with recorders that raise on any real network call; every WhatsApp test asserts on the recorder.
- W1: sender resolution order (owner connected / owner disconnected / no owner / company only); caps (hourly, daily, warm-up ramp,
  per-contact-per-day); quiet hours queue and drain; opt-out and consent skips; number-exists cache; five failures pause + alert;
  webhook secret 401; per-event handlers; RBAC on instance routes (rep vs admin, owner-with-no-module_permissions passes).
- W2: ingest idempotency (same provider id twice → one row); text/media/quoted normalisation; contact matching by phone incl. `@lid`;
  unread counts; chat scoping for rep vs manager; manager send attributed; SSE event scoping; history sync marks and pagination.
- W3: drip step sends media from the owner's number and falls back; skipped ≠ failed; greetings engine: birthday, contact anniversary,
  school anniversary, festival, audience, IST date, once per year, image caption, sender per rule; campaign grouping by owner.
- W4: opt-out keyword sets flag and replies once; retention job; reports totals reconcile with `wa_messages`.
- Fixture data mirrors production: 1,602 contacts (807 with phone), 409 unowned, 0 school consent, users bde@/smartshape001@/
  kalpana@/info@ shapes.
- Backend tests: `DB_NAME=smartshape_test MONGO_URL=mongodb://localhost:27017 python -m pytest <named files> -q`, never a bare
  `pytest tests/`. Frontend: Jest `createRoot`+`act`, `jest.mock`, no testing-library. No new top-level third-party backend import
  (SSE uses Starlette's `StreamingResponse`; Redis pub/sub uses the existing `redis.asyncio`).

## Rollout
1. **W1a infra** (owner present, ~30 min downtime for WhatsApp only): backup Postgres → new compose → verify `/` reports 2.3.7 →
   link the company number → send one test message to the owner's phone → set caps. Rollback: restore the image tag + volume.
2. **W1b** code deploy: sending service + My WhatsApp + admin page; AutoSender fallback ON for one week; drips/greetings still paused
   until W3.
3. Reps link company SIMs one at a time (3 max on the current VPS); warm-up runs 14 days per number with the ramp; no campaigns
   from a number younger than 14 days.
4. **W2** inbox; **W3** automations (greetings engine switched on rule-by-rule); **W4**.
5. VPS upgrade before the 4th rep number.
Each step needs a frontend bundle rebuild before merge; no data migration except `users.wa_instance_name` backfill (none exist).

## Out of scope
Official WhatsApp Business API / BSP (designed-for via `channel`, not built); group chats in the inbox (stored, hidden); voice
calling; message editing/deletion sync; AI auto-replies; per-rep proxy purchasing (admin enters proxy credentials per instance).
