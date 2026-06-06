# Certificate Pipeline (Phase A) — Design Spec

**Date:** 2026-06-04
**Author:** Aman Shrivastava (with Claude)
**Status:** Approved for planning
**Scope:** Generate personalized certificates (one PDF per attendee) from a designer-made PNG template, and deliver each via WhatsApp + email, exactly once per channel. Standalone module; FMS coupling is Phase B.

---

## 1. Background & roadmap context

This is **Phase A** of a three-phase program the user calls an "n8n-like" automation capability:
- **Phase A (this spec):** Certificate pipeline — the concrete, shippable win. Becomes a reusable "action".
- **Phase B:** FMS action-nodes + flow-to-flow linking (an FMS stage can fire `generate_certificate`, `send_reminder`, `start_flow`).
- **Phase C:** Visual drag-and-drop builder (canvas + execution engine) orchestrating forms/actions/flows.

Building A first delivers value in ~1 week and de-risks B and C by establishing the certificate + delivery + idempotency primitives.

## 2. Research basis (deep-research, 2026-06-04)

110-agent research, 21 verified claims. Key conclusions applied here:
- **Generation engine = Pillow overlay on a designer PNG** (chosen by user). Rationale: non-technical staff design in Canva → export PNG → position fields in an admin UI; reuses Pillow + ReportLab fonts already in the stack; no external dependency (vs Google Docs quotas) and no new system libs (vs WeasyPrint Pango/Cairo).
- **Indian names:** Latin/transliterated names render with no extra libs. Native Devanagari would require `libraqm` (HarfBuzz/FriBiDi) — a Windows footgun, easy on the Linux VPS — deferred until needed.
- **WhatsApp delivery:** Evolution API `sendMedia` with `mediatype: document`, `mimetype: application/pdf`, media as a **hosted URL** (preferred for files > ~3 MB). The app already wraps this as `evolution.send_document(...)`.
- **Email delivery:** attach the PDF; current `_smtp_send` is text-only and must be extended for attachments.
- **Idempotency:** persist a per-attendee, per-channel status and check-before-send → exactly one effect under retries. This is the same pattern already implemented for `fms_notifications`.
- **Refuted / do not rely on:** specific India WhatsApp per-message prices (confirm with BSP); "ReportLab best for complex docs" and "WeasyPrint reliably Unicode" (host-library-dependent).

## 3. Goals

1. Admin designs a reusable certificate **template**: upload a PNG background and position text fields (`name`, `date`, `theme`, `expert`) with font/size/color.
2. Create a certificate **batch**: attendees from either an existing Training Session's registrations **or** a manual/CSV list; set shared values (date/theme/expert); choose channels.
3. **Generate** one personalized PDF per attendee (Pillow → PDF), reviewable before sending.
4. **Deliver** each PDF via WhatsApp and/or email, **exactly once per channel**, with per-attendee status and retry of failures.

## 4. Non-goals (Phase A)

- No FMS coupling / stage actions (Phase B).
- No visual node canvas / form builder (Phase C).
- No native-script (Devanagari) shaping — Latin/transliterated names only for now.
- No Google Docs / WeasyPrint / Playwright engines.
- No Zoom integration (separate, later) — though "import from Session" future-proofs it.

## 5. Architecture

Reuses existing infrastructure:
- **PDF fonts:** `reportlab.pdfbase.pdfmetrics` + `TTFont` registration pattern from `backend/routes/procurement_pdf.py`.
- **Image overlay:** Pillow (`PIL.Image`, `ImageDraw`, `ImageFont`) — already a dependency.
- **WhatsApp:** `backend/services/evolution_client.py` → `evolution.send_document(phone, url, filename, caption)`.
- **Email:** `backend/scheduler.py` `_smtp_send` / `_email_cfg` — extend for attachments.
- **Static hosting:** add an `/uploads/certificates` static mount alongside the existing `/uploads/whatsapp` mount in `backend/main.py`, so Evolution can fetch PDFs by URL.
- **Background processing:** a new `cert_loop` in `backend/scheduler.py`, same idiom as the email/WA/FMS loops (poll → process pending items → idempotent updates).
- **Idempotency:** per-`cert_item` per-channel `delivery` status, mirroring `fms_notifications` dedupe.

### 5.1 Data model (new collections)

`cert_templates`:
```
{ template_id, name, background_url, orientation: "landscape"|"portrait",
  width_px, height_px,                      # of the uploaded PNG (for coordinate mapping)
  fields: [ { key, label, x, y, font, size, color, align } ],  # key in: name|date|theme|expert
  is_active, created_by, created_at }
```

`cert_batches`:
```
{ batch_id, title, template_id,
  source: "session"|"manual", session_id?,
  shared_values: { date, theme, expert },
  channels: ["whatsapp","email"],
  status: "draft"|"generating"|"ready"|"sending"|"done",
  counts: { total, generated, sent_whatsapp, sent_email, failed },
  created_by, created_at }
```

`cert_items` (one per attendee):
```
{ item_id, batch_id, name, phone, email,
  pdf_url, gen_status: "pending"|"generated"|"failed", gen_error,
  delivery: {
    whatsapp: { status: "pending"|"sent"|"failed"|"skipped", at, error },
    email:    { status: "pending"|"sent"|"failed"|"skipped", at, error }
  },
  created_at }
```
Indexes: `cert_items` on `{batch_id, gen_status}` and `{batch_id}`; `cert_templates` on `{is_active}`.

### 5.2 Backend — new `backend/routes/cert_routes.py` (prefix `/certs`)

Templates:
- `GET /certs/templates` — list.
- `POST /certs/templates` — create (name, background_url, orientation, width/height, fields).
- `PUT /certs/templates/{id}` — update fields/name.
- `DELETE /certs/templates/{id}` — soft or hard delete.
- Background image upload reuses the existing upload endpoint (`/api/upload`); the returned URL is stored as `background_url`.

Batches:
- `POST /certs/batches` — create (template_id, source, shared_values, channels). If `source=="session"`, copy `session_registrations` (name/email/phone) into `cert_items`. If `source=="manual"`, accept an attendees array.
- `POST /certs/batches/{id}/attendees` — add manual/CSV attendees to an existing batch.
- `GET /certs/batches` / `GET /certs/batches/{id}` — list/detail (detail includes items).
- `POST /certs/batches/{id}/generate` — mark batch `generating`; enqueue per-item generation (the `cert_loop` does the work). Returns immediately.
- `POST /certs/batches/{id}/send` — mark batch `sending`; enqueue per-item delivery on the batch's channels.
- `GET /certs/items/{id}/preview` — render and return a single certificate (PNG or PDF) for on-screen preview without sending.

RBAC: admin (and an optional `marketing`/`training` role if present) can manage; reuse `rbac.get_team` / `require_admin`.

### 5.3 Generation (Pillow → PDF)

For each `cert_item`:
1. Open `template.background_url` PNG via Pillow.
2. For each template field, resolve its value: `name` from the item; `date`/`theme`/`expert` from `batch.shared_values`.
3. Draw text with a registered TTF at `(x, y)`, honoring `font/size/color/align` (center/left/right via text-width measurement).
4. Save the composed image as a single-page **PDF** to `backend/uploads/certificates/{item_id}.pdf` (Pillow `Image.save(..., "PDF")`).
5. Set `pdf_url = {PUBLIC_BASE}/uploads/certificates/{item_id}.pdf`, `gen_status="generated"`. On error, `gen_status="failed"` + `gen_error`.

`PUBLIC_BASE` comes from an env/setting (the externally reachable base URL) so Evolution can fetch the PDF. Document this as a deployment requirement.

### 5.4 Delivery (idempotent)

The `cert_loop` (or the `send` handler enqueuing to it) processes items whose `gen_status=="generated"` for each enabled channel where `delivery[channel].status in ("pending", "failed")`:
- **WhatsApp:** `await evolution.send_document(item.phone, item.pdf_url, f"certificate_{name}.pdf", caption=...)` → set `delivery.whatsapp.status="sent"` (or `failed`+error).
- **Email:** extend the SMTP helper to attach the PDF (`MIMEApplication` part) → set `delivery.email.status`.
- A channel with no contact value is `skipped` (e.g., no phone → whatsapp skipped).
- `status=="sent"` items are never re-sent → exactly-once effect under retries.
- Honor `FMS_NOTIFY_DRY_RUN`-style dry-run (a `CERT_DRY_RUN` flag) so tests never fire real sends.

### 5.5 Email attachment helper

Add `_smtp_send_attachment(sender, pw, sender_name, to, subject, body, file_path, filename)` in `scheduler.py` (or a small `cert_delivery.py`) using `email.mime.multipart` + `MIMEApplication`. Keep the existing text-only `_smtp_send` intact.

### 5.6 Frontend — new "Certificates" page

1. **Template designer:** upload PNG → it renders in a fixed-width canvas; draggable markers for `name/date/theme/expert` capture `(x, y)` in image pixel coordinates (scale-aware); per-field font/size/color/align controls; save.
2. **Batch creator:** pick template → choose source (Training Session dropdown that loads its registrations, or a paste/CSV textarea parsed to name/phone/email) → set date/theme/expert → choose channels.
3. **Generate → preview grid** (thumbnail per attendee via the preview endpoint) → **Send** → per-attendee status table (generated/sent-WA/sent-email/failed) with a retry-failed action.

Follow existing frontend patterns (a page under `frontend/src/pages/admin/`, a `useCertificates` hook, components under `frontend/src/components/certs/`, API client additions in `frontend/src/lib/api.js`).

## 6. Testing

- **Unit (pure):** field-value resolution (name vs shared), text alignment/width math, idempotency guard (a `sent` item is not re-sent; a `failed` item is retried), filename sanitization.
- **Generation:** generate a cert from a small test PNG + template; assert a valid PDF (`%PDF` header) is written and `pdf_url` set.
- **Integration (HTTP, against the test backend, `CERT_DRY_RUN=1`):** create template → create batch (manual attendees) → generate → assert items `generated` → send → assert each `(item, channel)` recorded `sent` exactly once across two send passes (dedupe). Session-import path: seed a `session_registrations` doc, import, assert items created.
- Tests are local-only per repo convention (`tests/` is gitignored); commit implementation only.

## 7. Deployment / ops requirements

- `PUBLIC_BASE` (externally reachable HTTPS base URL) must be set so Evolution can fetch certificate PDFs by URL.
- `backend/uploads/certificates/` must be writable and served via the static mount; ensure it is gitignored.
- The `cert_loop`, like the other scheduler loops, must run in a **single** backend process (multi-worker would double-process) — same constraint already noted for the FMS SLA loop.
- Confirm current WhatsApp BSP/Evolution document-send limits and India deliverability before bulk sends (research refuted stale price figures).

## 8. Risks / open items

- **Field positioning UX** is the main frontend effort (drag-on-image with correct pixel↔display scaling). Keep MVP simple: absolute-positioned draggable markers over the scaled image.
- **Large batches:** generation/delivery throughput on the VPS for hundreds of attendees — background loop with per-item status handles correctness; measure throughput, add concurrency later if needed.
- **PDF size vs WhatsApp:** prefer URL delivery (already chosen) to avoid base64 limits.
- **Native-script names:** out of scope now; add `libraqm` on the VPS + an Indic font if required later.
