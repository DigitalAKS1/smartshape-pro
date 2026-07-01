# HTML Email Engine + Reusable Composer + Dynamic Zoom Webinar Lifecycle — Design

**Date:** 2026-07-01
**Owner:** SmartShape Pro (info@smartshape.in)
**Author:** Vikram (CEO) + Nikhil (marketing strategy, appendix)
**Status:** Design — pending owner review, then `writing-plans`

---

## 1. Problem & goal

Today the "Send"/"Notify" buttons on **Customer Engagement** (Training Sessions, Offers, Announcements) fire a **naive plain-text blast to every quotation-customer**, bypassing the real email engine ([training_routes.py:74](../../../backend/routes/training_routes.py#L74)). Separately, the **Marketing Hub** (`/marketing`) has a genuine campaign engine — templates, tag/role/city/board audience targeting, a queue, analytics — but **it too only sends plain text** (`MIMEText(body, "plain")` at [scheduler.py:63](../../../backend/scheduler.py#L63)). And although the app **creates** Zoom meeting links for training sessions and **imports** attendees afterward ([crm_zoom_routes.py](../../../backend/routes/crm_zoom_routes.py)), it sends **no invite / reminder / follow-up emails** around a webinar at all.

**Goal:** one unified, HTML-capable email engine; a reusable **Email Composer** used by every Send button; and an automated **Zoom webinar email lifecycle** (invite → reminders → follow-up) that keys dynamically off the session and its Zoom link.

### Owner decisions (locked)
1. **Unify** — upgrade the single email engine to HTML; every send path uses it.
2. **Composer** — rich-text editor (**react-quill**) + a **paste-raw-HTML** toggle; load/save templates.
3. **Recipients** — **manual multi-select from CRM contacts-with-email**, PLUS quick filters (tag/role/city/board) + "select all N matching".
4. **Guardrails** — live preview, send-test-to-self, confirm-recipient-count.
5. Send button creates a **tracked campaign** under the hood (shows in Marketing analytics).

---

## 2. Architecture at a glance

```
CustomerEngagement / MarketingHub
        │  (Send / Notify)
        ▼
  <EmailComposerDialog>  ──uses──►  <RecipientPicker> (reused from EmailHubTab)
        │  subject + body_html + recipients + source
        ▼
  POST /email/send-now  ──►  creates email_campaign (source-tagged)
        │                     + enqueues personalized rows into email_scheduled (with body_html)
        ▼
  scheduler.process_email_queue (every 2 min)  ──►  _smtp_send(..., body_html)  ──►  Gmail SMTP (multipart plain+HTML)

  webinar_scheduler_loop (every ~10 min)  ──►  computes due reminders per published session w/ Zoom link
        │                                        enqueues HTML stage-emails to registrants
        ▼                                        (reuses the same queue + templates)
  Zoom attendee import (existing)  ──►  marks attended vs no-show  ──►  fires follow-up stages
```

**Design principle:** no parallel email stack. Everything funnels through `email_scheduled` → `process_email_queue` → `_smtp_send`, so throttling, analytics, and failure tracking are shared.

---

## 3. Part 1 — HTML email engine (foundation)

The smallest, highest-leverage change. Turn the existing plain-text pipe into a plain+HTML multipart pipe.

### 3.1 Send primitive — [scheduler.py:58](../../../backend/scheduler.py#L58)
```python
def _smtp_send(sender_email, app_password, sender_name, to_email, subject, body, body_html=None):
    msg = MIMEMultipart("alternative")          # already the case
    msg["From"] = f"{sender_name} <{sender_email}>"
    msg["To"] = to_email
    msg["Subject"] = subject
    msg["List-Unsubscribe"] = f"<mailto:{sender_email}?subject=unsubscribe>"   # deliverability
    msg.attach(MIMEText(body or _html_to_text(body_html), "plain", "utf-8"))   # plain fallback FIRST
    if body_html:
        msg.attach(MIMEText(body_html, "html", "utf-8"))                        # HTML SECOND (preferred)
    ...
```
- multipart/alternative: plain part first, HTML second (clients render the last supported part).
- `List-Unsubscribe` header improves Gmail deliverability and is basic compliance.
- Backward compatible: existing callers pass no `body_html` → identical plain-text behavior.
- `.ics` calendar attachment: generalize `_smtp_send_attachment` ([scheduler.py:69](../../../backend/scheduler.py#L69)) to accept a mimetype + optional `body_html` (used by webinar invite/confirmation).

### 3.2 Queue processor — [scheduler.py:156](../../../backend/scheduler.py#L156)
Pass `body_html=msg.get("body_html")` into `_smtp_send`. Nothing else changes; the 0.5s inter-send sleep and 30-per-run limit already throttle Gmail.

### 3.3 Data model additions (additive, no migration)
| Collection | New field | Purpose |
|---|---|---|
| `email_templates` | `body_html` (str, optional) | HTML version of a saved template |
| `email_campaigns` | `body_html` (str, optional), `source` (str), `source_id` (str) | HTML campaign body + provenance (`training_session`/`promo`/`announcement`/`manual`/`webinar`) |
| `email_scheduled` | `body_html` (str, optional) | personalized HTML per recipient |

### 3.4 Personalization
`launch_email_campaign` / send-now replace `{name}` and `{school_name}` in **both** `message` (plain) and `body_html` ([email_routes.py:602](../../../backend/routes/email_routes.py#L602)). Extend the token set for webinars (see §5). Unknown tokens are left blank, never crash.

### 3.5 Security — HTML sanitization
- **Backend:** sanitize `body_html` with `bleach` (allow-list tags/attrs/styles; **strip `<script>`, `on*` handlers, `javascript:` URLs**) on template save, campaign save, and send-now. Prevents stored XSS reaching recipients/preview.
- **Frontend preview:** render inside a **sandboxed `<iframe sandbox>`** (no script execution) — defense in depth.
- **Authz:** send endpoints require an authenticated admin/marketing user (reuse `get_current_user` + module check). No change to who can send.

### 3.6 Email-safe base layout
Rich-text (Quill) output and pasted fragments are wrapped in a shared **600px, table-based, inline-styled** shell (SmartShape accent `#e94560`, logo header, footer with address + unsubscribe line). Pasted *full* HTML documents (contain `<html>`/`<body>`) are used as-is (only sanitized). This keeps Gmail/Outlook rendering predictable without forcing the user to write email HTML.

---

## 4. Part 2 — Reusable Email Composer (frontend)

A single `<EmailComposerDialog>` component, opened by every Send button. Props: `{ open, onClose, source, sourceId, initialSubject, initialHtml, presetRecipients }`.

### 4.1 Sections
1. **Content** — toggle **[✍ Rich text | </> Paste HTML]**.
   - Rich text: **react-quill** (new dep; none exists today — verified) with bold/italic/lists/link/image/button + an **"Insert field"** menu (`{name}`, `{school_name}`, and webinar tokens when `source=webinar`).
   - Paste HTML: raw `<textarea>`; its value feeds the same `body_html`.
2. **Template** — "Load template" dropdown (`GET /email/templates`) loads subject + body_html; **"Save as template"** persists the current draft (`POST /email/templates`).
3. **Recipients** — reuse the picker already in [EmailHubTab.js](../../../frontend/src/components/marketing/EmailHubTab.js) (`eFilteredContactsForPicker`): search box + filter chips (**tag / role / city / board**) + checkbox list from `GET /contacts` (contacts-with-email) + **"Select all N matching"** + live selected count.
4. **Guardrails** — **Preview** (sandboxed iframe render), **Send test to me** (`POST /email/send-test`), and a final **"Send to N recipients?"** confirm dialog showing the exact count.

### 4.2 New / reused endpoints
| Method | Path | Purpose |
|---|---|---|
| GET | `/contacts` (existing, [crm_routes.py:1541](../../../backend/routes/crm_routes.py#L1541)) | recipient list source (has `email`, `tag_ids`, `designation`, `city`, `board`) |
| POST | `/email/send-test` | send one HTML copy to the current user, immediately (bypass queue) |
| POST | `/email/send-now` | create source-tagged campaign + enqueue personalized HTML to selected `recipient_ids` |

`send-now` body: `{ subject, body_html, body_text?, recipient_ids[], source, source_id, template_id? }`. It validates (≥1 recipient, non-empty subject + body, email configured), creates the campaign, resolves `recipient_ids` → contacts, personalizes, enqueues, returns `{ queued, campaign_id }`.

### 4.3 Wiring the three Send buttons ([CustomerEngagement.js](../../../frontend/src/pages/admin/CustomerEngagement.js))
- Training **Send** (currently `notifySession`) → open composer prefilled with the **Webinar Invite** template + session tokens.
- Offer **Notify** → prefilled from the promo.
- Announcement **Notify All** → prefilled from the announcement.

**Retire both rogue blast paths:** the training `notify_session` ([training_routes.py:74](../../../backend/routes/training_routes.py#L74)) **and** the second inline-SMTP blast at [customer_routes.py:664](../../../backend/routes/customer_routes.py#L664) both hand-roll SMTP outside the engine and send synchronously in-request with no throttle. Both must route through the composer → `email_scheduled` queue instead. Leave the endpoints as thin shims or remove their callers; do not leave two competing email systems.

---

## 5. Part 3 — Dynamic Zoom webinar email lifecycle

The centerpiece. Automate invite → reminders → live → follow-up around any training session that has a Zoom link, reusing the queue and the attendee-import that already exist.

### 5.1 Lifecycle stages (draft — Nikhil finalizes timings/copy in the appendix)
| # | Stage | Trigger (dynamic) | Audience | Channel | One job |
|---|---|---|---|---|---|
| 1 | Invite | on publish / manual Send | chosen segment | Email (+WA later) | register — hero + Add-to-Calendar |
| 2 | Registration confirmation | instantly on register | the registrant | Email | lock it in + `.ics` + `{join_url}` |
| 3 | Reminder −24h | `session_dt − 24h` | registrants | Email | resurface join link |
| 4 | Reminder −1h | `session_dt − 1h` | registrants | Email (+WA) | "starting soon", one-tap join |
| 5 | We're live | at `session_dt` | registered, not-yet-joined | Email/WA | last-chance join |
| 6 | No-show follow-up | `session_dt + 24h`, not in attendee list | no-shows | Email | recording + rebook |
| 7 | Attended follow-up | `session_dt + 24h`, attended | attendees | Email | convert → demo / quotation |

### 5.2 Merge tokens for webinar templates
`{name}`, `{school_name}`, `{session_title}`, `{session_date}`, `{session_time}`, `{platform}`, `{join_url}`, `{add_to_calendar_url}` (Google Calendar link), `{host_name}`, `{recording_url}` (stages 6–7).

### 5.3 Mechanism (engineering)
- **Session config:** `training_sessions` gains `webinar_emails` (bool map of enabled stages, default sensible) + `host_name` + `recording_url`. No migration (defaults applied at read).
- **`session_registrations`** gains `sent_stages` (list) + `attended` (bool, set by import) so each stage fires **once** per registrant (idempotent).
- **New `webinar_scheduler_loop()`** (~every 10 min, registered beside the others at [scheduler.py:1376](../../../backend/scheduler.py#L1376)):
  1. Load published sessions with a `meeting_link` and a future-or-recent `date`/`time`.
  2. For each enabled stage whose due-time has passed, find registrants missing that stage in `sent_stages`.
  3. Render the stage's HTML template with tokens → enqueue into `email_scheduled` (source `webinar`) → mark the stage sent. The existing queue loop delivers it (throttled).
- **`.ics` / Add-to-Calendar:** **reuse the existing production-grade VEVENT builder** in [delegation_routes.py](../../../backend/routes/delegation_routes.py) (~L1890-1960: `_build_vevent`/`_ics_fold`/`_ics_escape`, `Asia/Kolkata` TZID, `CONFERENCE`/`URL` props) — point it at a `training_sessions` doc, don't rebuild. Attach to stages 1–2; expose it via a small `GET /training/sessions/{id}/ics` endpoint so `{add_to_calendar_url}` works as both an attachment and a click-to-add link.
- **Attended vs no-show:** reuse the Zoom attendee import ([crm_zoom_routes.py](../../../backend/routes/crm_zoom_routes.py)); match attendees to registrants by email → set `attended` → stages 6/7 branch on it. If import hasn't run, stage 6/7 hold (don't guess).
- **Manual override:** admin can still fire any stage on demand from the composer; auto-fire is per-stage toggithable per session.

### 5.4 Deliverability & scale (Gmail SMTP)
- The queue's 30/run + 0.5s sleep + 2-min cadence already throttles. Add a **daily send-cap** guard (config, default ~450 consumer Gmail / higher for Workspace) so a large blast can't trip Gmail limits — overflow stays `pending` and drains next day.
- **`List-Unsubscribe` header + footer unsubscribe + a suppression-list check are v1 non-negotiables** (§3.1, §3.6), per Nikhil: Gmail/Yahoo bulk-sender rules will spam-folder HTML volume without one-click unsubscribe. Transactional confirmations (stage 2) may be exempt. Build a `db.email_suppressions` check into the send path from day one.
- **ESP-migration trigger (concrete):** move to a real ESP (Amazon SES / Postmark / Brevo) the moment **any** of: (a) a single segment > ~400 recipients, (b) sustained aggregate > ~350/day for a week, or (c) bounce rate > 3% over two sends. Your first "all Teachers" segment (~1,500 contacts) crosses (a) immediately — flag to owner. The send transport is designed as a **one-file swap** so this isn't a rewrite.

---

## 6. Part 4 — Expert template library

Built as **email-safe HTML files** seeded into `email_templates` (like the existing 15). Full list, subject-line variants, tokens, and content blocks come from **Nikhil's audit (Appendix A)** — target ~8–12 templates including the full webinar set (§5.1) plus refreshed evergreens (new-die announcement, offer/promo, re-engagement). Each template: preheader, logo header, hero, body, **bulletproof CTA button**, footer (address + unsubscribe).

---

## 7. Testing (⚠ never against live DB)

Per standing rule + [memory](../../..): the repo's tests can hit the **production** DB. **All tests MUST force a test database** (`DB_NAME=*_test`) and mock SMTP — no real email, no prod writes.
- **Backend:** `_smtp_send` builds correct multipart (plain+HTML) when `body_html` present, plain-only when absent; send-now enqueues rows with `body_html` + correct source; token personalization in HTML; `webinar_scheduler_loop` fires each stage exactly once (idempotency) and respects due-times; bleach strips `<script>`/`on*`.
- **Frontend:** composer opens prefilled; template load populates editor; recipient "select all" selects all filtered; preview renders sanitized HTML; send posts correct payload; confirm shows exact count.

---

## 8. YAGNI — cut from v1 (easy to add later on this foundation)
Scheduled-send-for-later, open/click tracking pixels, WhatsApp arm of the webinar lifecycle (stages note "+WA later"), attachments beyond `.ics`, drag-drop email builder, full ESP migration.

---

## 9. Build sequence & owners

**Phase v1 (Now) — HTML engine + composer + rewire:**
1. **Arjun (backend):** HTML multipart (`_smtp_send`, queue pass-through), `body_html` on templates/campaigns/scheduled, bleach sanitize, `List-Unsubscribe` header + `db.email_suppressions` check, `/email/send-now` + `/email/send-test`, retire both rogue blast paths (`training_routes.py:74`, `customer_routes.py:664`) onto the queue.
2. **Rohan (frontend):** `<EmailComposerDialog>` (react-quill + paste-HTML + template load/save + preview + test-send), extract/reuse `<RecipientPicker>`, wire the 3 Send buttons.
3. **Kavya + design:** author the evergreen HTML templates (Appendix A.4 non-webinar) on the shared shell.

**Phase Next — webinar lifecycle:**
4. **Arjun:** `session_registrations` status fields + `/training/sessions/{id}/register`, `webinar_scheduler_loop`, `.ics` reuse from `delegation_routes.py` + `GET /.../ics`, attendee reconciliation extension to `/crm-zoom/import`, `session_id` audience filter.
5. **Kavya + design:** the 7 webinar templates (Appendix A.4).

**Throughout:**
6. **Meera (UX):** polish picker/preview, empty/loading/error states, mobile.
7. **Vivek (QA):** the §7 suite, **test DB only**, evidence required.

---

## Appendix A — Nikhil's marketing audit & template library

### A.1 `/marketing` gap analysis (ranked by revenue impact)
1. **Plain-text-only email** — no branding/CTA/tracking; a ₹2–5L capital pitch in unstyled text reads as spam-adjacent. (`scheduler.py:63`)
2. **No webinar/training lifecycle** — one blast button, no confirm/reminder/no-show/attended follow-up; webinars are the best top-of-funnel motion and leak both attendance and post-event conversion.
3. **Customer Engagement bypasses the engine** — Training/Offers/Announcements each hand-roll SMTP to all quotation-customers (no segmentation, no shared unsubscribe/analytics). (`training_routes.py:74`, `customer_routes.py:664`)
4. **No compliance/unsubscribe layer** — no unsubscribe, no `List-Unsubscribe`, no suppression list → Gmail/Yahoo deliverability time-bomb.
5. **WhatsApp + Email are silos** — only greetings have WA→email fallback; campaigns/drip don't interleave channels (the highest-converting pattern for Indian B2B).
6. **Analytics = send/fail only** — no opens/clicks, no join to lead-stage change.
7. **No "send to session registrants/attendees"** — `_resolve_audience()` has no `session_id` filter (the missing link for the webinar lifecycle).

### A.2 Webinar lifecycle — status flow & attendance truth
- `session_registrations` status flow: `registered → reminded_1d → reminded_1h → attended | no_show → followed_up`.
- **Manual:** Stage 1 (invite) — human picks segment + approves (honors standing rules). **Auto:** Stages 2–7 (time/registration-triggered, idempotent via per-stage flags — reuse the `low_stock_email_{today}` / `greeting_fire_log` defensive pattern).
- **Attendance truth:** extend `/crm-zoom/import` to match imported attendees ↔ `session_registrations` by email (fuzzy-name fallback via existing `crm_zoom.suggest_rows`) → set `attended`; leftover `registered` → `no_show`. No new attendance system.
- **Stage 4/5 channel:** WhatsApp primary at −1h/live (email open-in-time is poor at that urgency); email fallback templates kept ready.
- **Bug to fix:** today's `notify_session()` sends **inline in the request handler** with no throttle — webinar bursts must go through the queue, never a synchronous loop.

### A.3 Deliverability thresholds (Gmail SMTP)
- Daily cap ~500 consumer / ~2,000 Workspace; existing 30/2-min batching self-throttles — add a daily-count gate that pauses at ~90% of plan limit.
- `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click` on all bulk sends (transactional exempt).
- Verify DMARC/DKIM alignment for `smartshape.in` (`dig txt smartshape.in`) — invisible until spam-foldering starts.
- ESP migration triggers: segment > ~400, or sustained > ~350/day for a week, or bounce > 3% over two sends.

### A.4 Template library (~11, email-safe HTML — one shared shell: hero / body / CTA button / footer+unsubscribe)
| Template | Category | Trigger | Subject A / B | Key tokens |
|---|---|---|---|---|
| Webinar Invite | webinar | Stage 1, manual | "You're Invited: {session_title} — Live Demo for Schools" / "750+ Schools Already Use This — See It Live" | name, school_name, session_title, session_date, session_time, host_name, register_url |
| Webinar Registration Confirmation | webinar | Stage 2, auto on register | "You're Registered: {session_title}" / "Confirmed — See You on {session_date}" | name, session_title, session_date, session_time, join_url, add_to_calendar_url, host_name |
| Webinar Reminder (1-day) | webinar | Stage 3, auto T-24h | "Tomorrow: {session_title} at {session_time}" / "Don't Miss It — Tomorrow's Session" | name, session_title, session_time, join_url, add_to_calendar_url |
| Webinar Reminder (1-hour) | webinar | Stage 4, auto T-1h (WA primary) | "Starting in 1 Hour: {session_title}" / "We Go Live Soon — Here's Your Link" | name, session_title, session_time, join_url |
| Webinar Live Now | webinar | Stage 5, auto at start (WA-only, email fallback) | "We're Live Now — Join: {session_title}" / "{session_title} Has Started" | name, join_url |
| Webinar No-show Recovery | webinar | Stage 6a, auto T+2h no_show | "Sorry We Missed You — {session_title} Recording Inside" / "Couldn't Join? Let's Fix That" | name, session_title, recording_url, book_demo_url, host_name |
| Webinar Attended Follow-up | webinar | Stage 6b, auto T+2h attended | "Thanks for Joining {session_title} — Your Next Step" / "Loved the Demo? Here's Your ROI Sheet" | name, school_name, session_title, book_demo_url, quotation_request_url, host_name |
| New Die Collection Announcement | offer/seasonal | Manual, quarterly launch | "80+ New Die Designs Just Landed" / "New for {academic_year}: Festive, STEM & Regional Dies" | name, school_name, new_die_count, catalogue_url |
| Seasonal Offer / Promo | offer | Manual, session-start windows | "New Session Early Bird: Free 50-Die Starter Pack" / "Limited Slots — Priority Installation" | name, school_name, offer_deadline, book_demo_url |
| Re-engagement / Cold Lead Revival | reengagement | Manual or drip on stale stage | "It's Been a While — Big Updates at SmartShape" / "New Dies + Better EMI Since We Last Spoke" | name, school_name, new_die_count, book_demo_url |
| Post-Demo / Post-Quotation Follow-up | followup | Manual/drip after demo/quote | "Thank You for the Demo — Quotation & ROI Attached" / "Following Up on Your Quotation" | name, school_name, quotation_url, roi_pdf_url |

### A.5 Roadmap (Now / Next / Later)
- **Now (v1, with composer):** HTML multipart; composer (react-quill + paste-HTML + template load/save); manual multi-select + filters + select-all; guardrails; **rewire Training/Offers/Announcements through the one queue**; `List-Unsubscribe` + suppression check.
- **Next:** webinar lifecycle stages 2–6b (`webinar_scheduler_loop` + `session_registrations` fields + `/training/sessions/{id}/register`); `.ics` reuse; attendee reconciliation; `session_id` audience filter; basic open/click tracking.
- **Later:** cross-channel (email+WA) orchestration; full funnel attribution (email events ↔ lead stage); daily send-cap auto-pause; ESP migration; self-service unsubscribe/preference center.

### A.6 KPIs (outcomes, not vanity)
Webinar: registration rate, **show-rate** (#1), no-show recovery, attended→demo, attended→quotation (joinable via `session_registrations.contact_id → leads.stage`). Engine: send-success > 97%, bounce (early warning), unsubscribe rate, and **campaign→lead-stage-advance** rate. Escalate dashboard wiring to `analytics-expert`.
