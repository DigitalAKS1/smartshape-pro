# Product Media: Multi-Photo Gallery, Video & Gated Description

**Date:** 2026-06-14
**Status:** Approved design — ready for implementation plan
**Approach:** A (extend the die in-place + reusable gallery/lightbox/video components)

## Goal

Let admins/store heads attach **up to 5 photos**, a **YouTube video link**, and a **description** to
each die/product, with **per-product visibility gates** so customers only see the video and/or
description when explicitly published. Customers (and admins) get an **expert image experience**:
click a photo to open a full-screen lightbox with swipe-between-photos and zoom in/out, plus a video
play option when published. This surfaces across both the **admin Inventory** and the
**customer-facing catalogue / order views**.

## Decisions (locked)

- **Surfaces:** Both admin (Inventory `DieCard`, Edit dialog) and customer (`CataloguePage`,
  `CustomerPortal` order view).
- **Visibility gate:** **Separate** per-product toggles — `show_video` and `show_description`,
  both default **OFF**. Settable only by admin/store. Off ⇒ customer sees photos only.
- **Max photos:** 5 per product.
- **Zoom viewer:** Full-screen lightbox — swipe/arrows between photos, scroll/pinch + `−/+` buttons
  to zoom, thumbnail strip, `n/5` counter, Esc/✕ to close.
- **Reorder UX:** move + "set as primary" buttons (reliable on mobile), not drag-and-drop.
- **Order view gallery:** included (read-only) for already-selected items.

## Data model (die document additions)

| Field | Type | Default | Notes |
|---|---|---|---|
| `images` | `string[]` (≤5) | `[]` | Gallery URLs (`/api/files/...`). `images[0]` = primary. |
| `image_url` | string \| null | `null` | **Kept.** Always mirrors `images[0]`. Preserves order/quotation line-items that copy `die_image_url`. |
| `video_url` | string \| null | `null` | Raw YouTube link (watch / `youtu.be` / shorts / embed accepted). |
| `description` | string \| null | existing | Reused, no change. |
| `show_video` | bool | `false` | Customer-visibility gate for the video. |
| `show_description` | bool | `false` | Customer-visibility gate for the description. |

**Back-compat (no data migration required):** on read, normalize
`images = die.images or ([die.image_url] if die.image_url else [])`. Existing dies with a single
`image_url` show that one photo in the gallery automatically. An optional one-time backfill script
(`images` from `image_url`) is a nice-to-have, not required.

## Backend (backend/routes/inventory_routes.py)

New endpoints (all **admin/store** only, reuse existing `require_team`/role guard + `save_file`):

- `POST /api/dies/{die_id}/images` — multipart, append one or more files. **Rejects if it would
  exceed 5 total** (413/400 with clear detail). Stores under existing
  `{UPLOADS_DIR}/dies/{die_id}/{uuid}.{ext}`. Re-mirrors `image_url = images[0]`. Returns updated
  `images[]`.
- `DELETE /api/dies/{die_id}/images?url=<encoded>` — removes that photo from `images[]`
  (and best-effort deletes the file). Re-mirrors `image_url` (promotes new primary; clears if empty).
- `PUT /api/dies/{die_id}/images/reorder` — body `{ "urls": [...] }`. Validates the set equals the
  die's current `images` (no foreign/duplicate URLs). Sets new order + primary.

Existing endpoints:

- `POST /api/dies/{die_id}/upload-image` (single) — **kept working**; now also appends into
  `images[]` (subject to the 5 cap) and mirrors primary. Used by the existing card camera button.
- `PUT /api/dies/{die_id}` — already accepts arbitrary fields; carries `video_url`, `show_video`,
  `show_description`, `description`. **Add validation:** `video_url`, if non-empty, must parse to a
  YouTube video id (helper `_youtube_id(url)`), else 400. `images` not settable through this path
  (only via the image endpoints) to keep one writer.
- `GET /api/dies` — returns the new fields via the existing full projection; apply the read-time
  `images` normalization.

**Server-side gate on the public catalogue** (`GET /api/catalogue/{token}` in
`quotation_routes.py` / wherever the public payload is built):

- Always include `images[]` (normalized) per die.
- Include `video_url` **only if** `show_video` is true; include `description` **only if**
  `show_description` is true. Unpublished media is **omitted from the payload entirely** — enforced
  on the server, not merely hidden in the UI. Admin-authenticated reads return everything.

## YouTube parsing

Shared helper extracts the 11-char video id from `watch?v=`, `youtu.be/`, `shorts/`, and `embed/`
forms; the embed URL is `https://www.youtube.com/embed/<id>`. Backend uses it for validation;
frontend `VideoModal` uses it for the iframe `src`.

## Frontend — new reusable components

- **`components/media/Lightbox.js`** — props `{ images, index, onClose, title }`. Full-screen overlay;
  left/right arrows + touch swipe; scroll-wheel / pinch / `−`/`+` buttons for zoom (CSS transform
  scale + pan); thumbnail strip; `n/total` counter; keyboard (←/→/Esc); body-scroll lock.
- **`components/media/MediaGallery.js`** — props `{ images, alt, backendUrl, onOpen }`. Renders the
  primary image with an expand icon and a "+N" badge when multiple; opens `Lightbox`. Falls back to
  the Scissors placeholder when empty.
- **`components/media/VideoModal.js`** — extracted/generalized from `CustomerPortal`'s existing
  YouTube modal. Props `{ url, title, open, onClose }`; renders a responsive 16:9 iframe via the
  parsed embed URL.

## Frontend — API (frontend/src/lib/api.js, `dies`)

- `uploadImages(id, files)` → `POST /dies/{id}/images` (multipart, multiple `file` entries).
- `deleteImage(id, url)` → `DELETE /dies/{id}/images?url=`.
- `reorderImages(id, urls)` → `PUT /dies/{id}/images/reorder`.
- `update(id, data)` already covers `video_url` / `show_video` / `show_description` / `description`.

## Frontend — page wiring

1. **`components/inventory/DieCard.js`** — swap the single `<img>` for `MediaGallery` + `Lightbox`;
   show a ▶ video badge and the description (admin always sees, ungated).
2. **`components/inventory/DieFormDialog.js`**
   - `EditDieDialog`: new **Media** section — multi-photo grid (each tile: set-primary, move,
     delete; "Add photos" disabled at 5), a **Video link** input, and two **"Publish to customers"**
     toggles (`show_video`, `show_description`). Wires to the new API methods.
   - `CreateDieDialog`: add `video_url`, `description`, and the two toggles. Multi-photo management
     happens after create (needs `die_id`); the existing single first-photo upload flow is retained.
3. **`hooks/useInventory.js`** — handlers/state: `handleUploadImages`, `handleDeleteImage`,
   `handleReorderImages`, primary mirroring reflected after `fetchDies()`.
4. **`pages/CataloguePage.js`** — each die uses `MediaGallery`; a dedicated **expand icon** opens the
   lightbox (card body still toggles selection, so view ≠ select); ▶ shown only when `video_url`
   present in the (already server-gated) payload; description shown only when present.
5. **`components/portal/PortalOrderCard.js`** (CustomerPortal order view) — read-only `MediaGallery`
   + `Lightbox` for selected items. (Line-items still carry the primary `die_image_url`; the card
   fetches the die's `images[]`/gating from the catalogue payload it already loads, or shows the
   primary alone if unavailable.)

## Error handling

- Max 5 enforced backend (authoritative) and frontend (disable "Add photos" at 5).
- `image/*`, ≤5 MB each — existing rule reused; oversize/invalid type rejected with toast.
- Invalid YouTube URL → 400 + toast; not saved.
- Delete primary ⇒ next photo becomes primary; delete last ⇒ `image_url` cleared, gallery shows
  placeholder.
- Reorder rejects URL sets that don't match the die's photos.
- Path-traversal on file serving already guarded (existing `realpath` check) — unchanged.

## Testing

- **Backend pytest:** add (incl. the 5-cap rejection), delete (primary re-mirror + last-clears),
  reorder (valid + foreign-URL rejection), `video_url` validation, and **catalogue gate** —
  `show_video=false` omits `video_url`, `show_description=false` omits `description`; both true
  include them; `image_url` always mirrors `images[0]`.
- **Frontend:** render test for `MediaGallery` (primary + badge + empty fallback); manual pass on
  lightbox swipe/zoom/keyboard, the publish toggles end-to-end, and the catalogue expand-vs-select
  separation.

## Out of scope (YAGNI)

- Cloudinary/CDN migration and server-side thumbnail generation (local disk is fine for ≤5 photos).
- Drag-and-drop reorder (move buttons chosen).
- Copying the full `images[]` into every order/quotation line-item (primary mirror is enough;
  galleries read from the die/catalogue payload).
- Non-YouTube video providers.

## Rollout

Frontend-and-backend change; ships via the standard `bash deploy.sh` rebuild on the VPS. New fields
are additive and default to safe/off, so existing dies and the live order flow are unaffected on
deploy.
