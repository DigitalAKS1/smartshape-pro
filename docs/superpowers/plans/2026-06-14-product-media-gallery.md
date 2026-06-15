# Product Media Gallery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add up to 5 photos, a YouTube video link, and a gated description to each die/product, with a full-screen zoom lightbox, surfaced across admin Inventory and the customer catalogue/order views.

**Architecture:** Extend the die document in-place (`images[]`, `video_url`, `show_video`, `show_description`; `image_url` mirrored to `images[0]` for back-compat). Security-critical logic (YouTube id parsing, image normalization, customer-payload gating) lives in a small pure module `backend/media_utils.py` covered by DB-free unit tests. New backend image endpoints handle multi-upload/delete/reorder. Frontend gets three reusable components (`Lightbox`, `MediaGallery`, `VideoModal`) consumed by `DieCard`, the Edit dialog, `CataloguePage`, and `PortalOrderCard`.

**Tech Stack:** FastAPI + Motor (MongoDB), local-disk uploads; React (CRA), Tailwind, lucide-react, sonner, existing Radix Dialog + Embla carousel.

**Testing note:** The repo's `backend/tests/*` are HTTP integration tests against a live (production) `BASE_URL` — DO NOT run them as part of this work. This plan adds `backend/tests/test_media_utils.py` as pure unit tests (no DB, no network). Endpoint and UI behavior are verified manually per the checklists in Task 12.

---

## File Structure

**Backend**
- Create: `backend/media_utils.py` — pure helpers: `youtube_id`, `normalize_images`, `gate_die_for_customer`, `MAX_DIE_IMAGES`.
- Create: `backend/tests/test_media_utils.py` — unit tests for the above.
- Modify: `backend/routes/inventory_routes.py` — new image endpoints; create/update handle new fields + video validation; GET normalizes images.
- Modify: `backend/routes/quotation_routes.py:1527` — gate dies in the public catalogue payload.

**Frontend**
- Create: `frontend/src/lib/youtube.js` — `youtubeId`, `youtubeEmbedUrl`.
- Create: `frontend/src/lib/youtube.test.js` — unit tests.
- Create: `frontend/src/components/media/VideoModal.js` — shared YouTube modal.
- Create: `frontend/src/components/media/Lightbox.js` — full-screen zoom/swipe viewer.
- Create: `frontend/src/components/media/MediaGallery.js` — primary image + thumbnails, opens Lightbox.
- Create: `frontend/src/components/media/MediaGallery.test.js` — render test.
- Modify: `frontend/src/lib/api.js` — `dies.uploadImages/deleteImage/reorderImages`.
- Modify: `frontend/src/components/inventory/DieCard.js` — gallery + video + description.
- Modify: `frontend/src/components/inventory/DieFormDialog.js` — Edit media manager; Create video/description/toggles.
- Modify: `frontend/src/hooks/useInventory.js` — media handlers/state.
- Modify: `frontend/src/pages/CataloguePage.js` — gallery + expand-to-zoom + gated video/description.
- Modify: `frontend/src/components/portal/PortalOrderCard.js` — read-only gallery.

---

## Task 1: Backend pure media helpers (TDD)

**Files:**
- Create: `backend/media_utils.py`
- Test: `backend/tests/test_media_utils.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_media_utils.py`:

```python
import media_utils as m


class TestYoutubeId:
    def test_watch_url(self):
        assert m.youtube_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ") == "dQw4w9WgXcQ"

    def test_short_url(self):
        assert m.youtube_id("https://youtu.be/dQw4w9WgXcQ") == "dQw4w9WgXcQ"

    def test_shorts_url(self):
        assert m.youtube_id("https://www.youtube.com/shorts/dQw4w9WgXcQ") == "dQw4w9WgXcQ"

    def test_embed_url(self):
        assert m.youtube_id("https://www.youtube.com/embed/dQw4w9WgXcQ") == "dQw4w9WgXcQ"

    def test_extra_query_params(self):
        assert m.youtube_id("https://youtu.be/dQw4w9WgXcQ?t=42") == "dQw4w9WgXcQ"

    def test_invalid(self):
        assert m.youtube_id("https://vimeo.com/12345") is None
        assert m.youtube_id("") is None
        assert m.youtube_id(None) is None


class TestNormalizeImages:
    def test_uses_images_when_present(self):
        die = {"images": ["/api/files/a.jpg", "/api/files/b.jpg"], "image_url": "/api/files/a.jpg"}
        assert m.normalize_images(die) == ["/api/files/a.jpg", "/api/files/b.jpg"]

    def test_falls_back_to_image_url(self):
        die = {"image_url": "/api/files/old.jpg"}
        assert m.normalize_images(die) == ["/api/files/old.jpg"]

    def test_empty_when_nothing(self):
        assert m.normalize_images({}) == []
        assert m.normalize_images({"image_url": None}) == []

    def test_caps_at_max(self):
        die = {"images": [f"/api/files/{i}.jpg" for i in range(10)]}
        assert len(m.normalize_images(die)) == m.MAX_DIE_IMAGES


class TestGateDieForCustomer:
    def _die(self, **over):
        d = {
            "die_id": "die_1", "code": "X-1", "name": "Rose", "type": "standard",
            "category": "flowers", "image_url": "/api/files/a.jpg",
            "images": ["/api/files/a.jpg"], "video_url": "https://youtu.be/dQw4w9WgXcQ",
            "description": "secret notes", "show_video": False, "show_description": False,
        }
        d.update(over)
        return d

    def test_hides_video_and_description_by_default(self):
        out = m.gate_die_for_customer(self._die())
        assert "video_url" not in out
        assert "description" not in out
        assert out["images"] == ["/api/files/a.jpg"]

    def test_shows_video_when_enabled(self):
        out = m.gate_die_for_customer(self._die(show_video=True))
        assert out["video_url"] == "https://youtu.be/dQw4w9WgXcQ"
        assert "description" not in out

    def test_shows_description_when_enabled(self):
        out = m.gate_die_for_customer(self._die(show_description=True))
        assert out["description"] == "secret notes"
        assert "video_url" not in out

    def test_never_leaks_show_flags(self):
        out = m.gate_die_for_customer(self._die(show_video=True, show_description=True))
        assert "show_video" not in out
        assert "show_description" not in out

    def test_normalizes_legacy_image_only_die(self):
        out = m.gate_die_for_customer({
            "die_id": "d2", "code": "Y", "name": "Leaf", "type": "standard",
            "image_url": "/api/files/leaf.jpg",
        })
        assert out["images"] == ["/api/files/leaf.jpg"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_media_utils.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'media_utils'`.

- [ ] **Step 3: Write minimal implementation**

Create `backend/media_utils.py`:

```python
"""Pure, DB-free helpers for die/product media (photos, video, customer gating).

Kept separate from route modules so the security-critical gating logic is unit
tested without a database or running server.
"""
import re
from typing import Any, Dict, List, Optional

MAX_DIE_IMAGES = 5

_YT_PATTERNS = [
    re.compile(r"(?:youtube\.com/watch\?(?:.*&)?v=)([A-Za-z0-9_-]{11})"),
    re.compile(r"(?:youtu\.be/)([A-Za-z0-9_-]{11})"),
    re.compile(r"(?:youtube\.com/shorts/)([A-Za-z0-9_-]{11})"),
    re.compile(r"(?:youtube\.com/embed/)([A-Za-z0-9_-]{11})"),
]


def youtube_id(url: Optional[str]) -> Optional[str]:
    """Extract the 11-char YouTube id from common URL forms, else None."""
    if not url or not isinstance(url, str):
        return None
    for pat in _YT_PATTERNS:
        match = pat.search(url)
        if match:
            return match.group(1)
    return None


def normalize_images(die: Dict[str, Any]) -> List[str]:
    """Return the die's gallery as a list, capped at MAX_DIE_IMAGES.

    Falls back to a single-element list from the legacy `image_url` when an
    `images` array is absent, so old dies render without a data migration.
    """
    images = die.get("images")
    if isinstance(images, list) and images:
        clean = [u for u in images if u]
    else:
        single = die.get("image_url")
        clean = [single] if single else []
    return clean[:MAX_DIE_IMAGES]


def gate_die_for_customer(die: Dict[str, Any]) -> Dict[str, Any]:
    """Project a die for a customer-facing payload.

    Always includes normalized `images`. Includes `video_url` only when
    `show_video` is true and `description` only when `show_description` is true.
    Never leaks the `show_*` flags. Enforced server-side so unpublished media
    never reaches the client.
    """
    out = {k: v for k, v in die.items()
           if k not in ("show_video", "show_description", "video_url", "description", "images", "_id")}
    out["images"] = normalize_images(die)
    out["image_url"] = out.get("image_url") or (out["images"][0] if out["images"] else None)
    if die.get("show_video") and die.get("video_url"):
        out["video_url"] = die["video_url"]
    if die.get("show_description") and die.get("description"):
        out["description"] = die["description"]
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_media_utils.py -v`
Expected: PASS (all tests green).

- [ ] **Step 5: Commit**

```bash
git add backend/media_utils.py backend/tests/test_media_utils.py
git commit -m "feat(media): pure helpers for youtube id, image normalize, customer gate"
```

---

## Task 2: Backend image endpoints + new die fields

**Files:**
- Modify: `backend/routes/inventory_routes.py` (imports near line 14; `get_dies` 77-82; `create_die` 85-108; `update_die` 111-127; `upload_die_image` 171-186; add new endpoints after line 186)

- [ ] **Step 1: Import the helpers**

In `backend/routes/inventory_routes.py`, after the existing `from rbac import get_team, require_teams` (line 14), add:

```python
from media_utils import youtube_id, normalize_images, MAX_DIE_IMAGES
```

- [ ] **Step 2: Normalize images on read in `get_dies`**

Replace the body of `get_dies` (lines 77-82) with:

```python
@router.get("/dies")
async def get_dies(request: Request, include_archived: bool = False):
    await get_current_user(request)
    query = {} if include_archived else {"is_active": {"$ne": False}}
    dies = await db.dies.find(query, {"_id": 0}).to_list(1000)
    for d in dies:
        d["images"] = normalize_images(d)
    return dies
```

- [ ] **Step 3: Initialize new fields on create**

In `create_die`, change the `die_doc` literal (lines 99-106) to seed the media fields:

```python
    die_doc = {
        "die_id": die_id,
        **data,
        "stock_qty": max(0, initial_qty),
        "reserved_qty": 0,
        "image_url": None,
        "images": [],
        "video_url": data.get("video_url"),
        "show_video": bool(data.get("show_video", False)),
        "show_description": bool(data.get("show_description", False)),
        "is_active": True,
    }
```

Also extend the `DieCreate` model (lines 32-39) to accept the optional fields:

```python
class DieCreate(BaseModel):
    code: str
    name: str
    type: str
    category: Optional[str] = "decorative"
    min_level: int = 5
    description: Optional[str] = None
    stock_qty: int = 0
    video_url: Optional[str] = None
    show_video: bool = False
    show_description: bool = False
```

And in `create_die`, validate the video link right after `data = die_input.model_dump()` (line 90):

```python
    if data.get("video_url") and not youtube_id(data["video_url"]):
        raise HTTPException(status_code=400, detail="Video link must be a valid YouTube URL")
```

- [ ] **Step 4: Validate video + protect `images` in `update_die`**

In `update_die`, after computing `safe` (line 116), add:

```python
    safe.pop("images", None)          # images are managed only via the image endpoints
    safe.pop("image_url", None)       # primary is derived from images[]
    if "video_url" in safe and safe["video_url"]:
        if not youtube_id(safe["video_url"]):
            raise HTTPException(status_code=400, detail="Video link must be a valid YouTube URL")
    if "show_video" in safe:
        safe["show_video"] = bool(safe["show_video"])
    if "show_description" in safe:
        safe["show_description"] = bool(safe["show_description"])
```

- [ ] **Step 5: Add a shared mirror helper and the image endpoints**

Replace `upload_die_image` (lines 171-186) with the version below and append the three new endpoints immediately after it:

```python
async def _set_images(die_id: str, images: list) -> dict:
    """Persist the capped gallery and mirror the primary into image_url."""
    images = [u for u in images if u][:MAX_DIE_IMAGES]
    primary = images[0] if images else None
    await db.dies.update_one(
        {"die_id": die_id},
        {"$set": {"images": images, "image_url": primary}},
    )
    return await db.dies.find_one({"die_id": die_id}, {"_id": 0})


@router.post("/dies/{die_id}/upload-image")
async def upload_die_image(die_id: str, request: Request, file: UploadFile = File(...)):
    user = await get_current_user(request)
    require_teams(user, "admin", "store")
    die = await db.dies.find_one({"die_id": die_id}, {"_id": 0})
    if not die:
        raise HTTPException(status_code=404, detail="Die not found")
    current = normalize_images(die)
    if len(current) >= MAX_DIE_IMAGES:
        raise HTTPException(status_code=400, detail=f"A product can have at most {MAX_DIE_IMAGES} photos")
    ext = file.filename.split(".")[-1] if "." in file.filename else "bin"
    path = f"dies/{die_id}/{uuid.uuid4()}.{ext}"
    save_file(path, await file.read())
    image_url = f"/api/files/{path}"
    updated = await _set_images(die_id, current + [image_url])
    return {"image_url": image_url, "images": updated.get("images", [])}


@router.post("/dies/{die_id}/images")
async def add_die_images(die_id: str, request: Request, files: List[UploadFile] = File(...)):
    user = await get_current_user(request)
    require_teams(user, "admin", "store")
    die = await db.dies.find_one({"die_id": die_id}, {"_id": 0})
    if not die:
        raise HTTPException(status_code=404, detail="Die not found")
    current = normalize_images(die)
    if len(current) + len(files) > MAX_DIE_IMAGES:
        raise HTTPException(
            status_code=400,
            detail=f"A product can have at most {MAX_DIE_IMAGES} photos (have {len(current)}, adding {len(files)})",
        )
    added = []
    for f in files:
        ext = f.filename.split(".")[-1] if "." in f.filename else "bin"
        path = f"dies/{die_id}/{uuid.uuid4()}.{ext}"
        save_file(path, await f.read())
        added.append(f"/api/files/{path}")
    updated = await _set_images(die_id, current + added)
    return {"images": updated.get("images", [])}


@router.delete("/dies/{die_id}/images")
async def delete_die_image(die_id: str, url: str, request: Request):
    user = await get_current_user(request)
    require_teams(user, "admin", "store")
    die = await db.dies.find_one({"die_id": die_id}, {"_id": 0})
    if not die:
        raise HTTPException(status_code=404, detail="Die not found")
    current = normalize_images(die)
    if url not in current:
        raise HTTPException(status_code=404, detail="Photo not found on this product")
    remaining = [u for u in current if u != url]
    updated = await _set_images(die_id, remaining)
    # Best-effort local file cleanup (url form: /api/files/<path>)
    try:
        if url.startswith("/api/files/"):
            rel = url[len("/api/files/"):]
            fp = os.path.realpath(os.path.join(UPLOADS_DIR, rel))
            if fp.startswith(os.path.realpath(UPLOADS_DIR)) and os.path.isfile(fp):
                os.remove(fp)
    except OSError:
        pass
    return {"images": updated.get("images", [])}


class ReorderImagesInput(BaseModel):
    urls: List[str]


@router.put("/dies/{die_id}/images/reorder")
async def reorder_die_images(die_id: str, payload: ReorderImagesInput, request: Request):
    user = await get_current_user(request)
    require_teams(user, "admin", "store")
    die = await db.dies.find_one({"die_id": die_id}, {"_id": 0})
    if not die:
        raise HTTPException(status_code=404, detail="Die not found")
    current = normalize_images(die)
    if sorted(payload.urls) != sorted(current):
        raise HTTPException(status_code=400, detail="Reorder list must contain exactly the product's current photos")
    updated = await _set_images(die_id, payload.urls)
    return {"images": updated.get("images", [])}
```

- [ ] **Step 6: Verify import + app boot (no DB writes)**

Run: `cd backend && python -c "import routes.inventory_routes"`
Expected: no error (imports resolve; `media_utils` found).

- [ ] **Step 7: Re-run the unit tests (still green)**

Run: `cd backend && python -m pytest tests/test_media_utils.py -v`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/routes/inventory_routes.py
git commit -m "feat(inventory): multi-photo endpoints + video/description gate fields on dies"
```

---

## Task 3: Gate dies in the public catalogue payload

**Files:**
- Modify: `backend/routes/quotation_routes.py` (`get_catalogue` around lines 1508-1535)

- [ ] **Step 1: Import the gate**

Near the top of `backend/routes/quotation_routes.py` (with the other imports), add:

```python
from media_utils import gate_die_for_customer
```

- [ ] **Step 2: Apply the gate to the dies list**

In `get_catalogue`, replace the dies fetch + return (lines 1527 and 1535) so dies are gated:

```python
    dies = await db.dies.find({"is_active": True}, {"_id": 0}).to_list(1000)
    dies = [gate_die_for_customer(d) for d in dies]
```

(The `return {"quotation": quot, "package": package, "dies": dies, "logo_url": logo_url}` line stays as-is.)

- [ ] **Step 3: Verify import**

Run: `cd backend && python -c "import routes.quotation_routes"`
Expected: no error.

- [ ] **Step 4: Manual verification (after local run or deploy)**

With a catalogue token whose dies have `show_video=false`/`show_description=false`, GET `/api/catalogue/<token>` and confirm each die has `images[]` but **no** `video_url` and **no** `description`. Flip the flags via the Edit dialog (Task 9) and confirm they appear. Record the result in Task 12's checklist.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/quotation_routes.py
git commit -m "feat(catalogue): gate video/description per product in customer payload"
```

---

## Task 4: Frontend API methods

**Files:**
- Modify: `frontend/src/lib/api.js` (`dies` object, lines ~90-109)

- [ ] **Step 1: Add the media methods**

In the `dies` object in `frontend/src/lib/api.js`, after the existing `uploadImage` method, add:

```javascript
  uploadImages: (id, files) => {
    const formData = new FormData();
    Array.from(files).forEach(f => formData.append('files', f));
    return API.post(`/dies/${id}/images`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  deleteImage: (id, url) => API.delete(`/dies/${id}/images`, { params: { url } }),
  reorderImages: (id, urls) => API.put(`/dies/${id}/images/reorder`, { urls }),
```

- [ ] **Step 2: Verify (lint/parse via build later in Task 12). Commit**

```bash
git add frontend/src/lib/api.js
git commit -m "feat(api): dies uploadImages/deleteImage/reorderImages"
```

---

## Task 5: YouTube util + shared VideoModal (TDD on the util)

**Files:**
- Create: `frontend/src/lib/youtube.js`
- Test: `frontend/src/lib/youtube.test.js`
- Create: `frontend/src/components/media/VideoModal.js`

- [ ] **Step 1: Write the failing util test**

Create `frontend/src/lib/youtube.test.js`:

```javascript
import { youtubeId, youtubeEmbedUrl } from './youtube';

test('parses watch URLs', () => {
  expect(youtubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
});
test('parses youtu.be URLs with params', () => {
  expect(youtubeId('https://youtu.be/dQw4w9WgXcQ?t=10')).toBe('dQw4w9WgXcQ');
});
test('parses shorts and embed', () => {
  expect(youtubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  expect(youtubeId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
});
test('returns null for non-youtube', () => {
  expect(youtubeId('https://vimeo.com/1')).toBeNull();
  expect(youtubeId('')).toBeNull();
});
test('builds embed url', () => {
  expect(youtubeEmbedUrl('https://youtu.be/dQw4w9WgXcQ')).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ');
  expect(youtubeEmbedUrl('bad')).toBeNull();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && CI=true npx react-scripts test src/lib/youtube.test.js --watchAll=false`
Expected: FAIL — cannot find module `./youtube`.

- [ ] **Step 3: Implement the util**

Create `frontend/src/lib/youtube.js`:

```javascript
const PATTERNS = [
  /(?:youtube\.com\/watch\?(?:.*&)?v=)([A-Za-z0-9_-]{11})/,
  /(?:youtu\.be\/)([A-Za-z0-9_-]{11})/,
  /(?:youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/,
  /(?:youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/,
];

export function youtubeId(url) {
  if (!url || typeof url !== 'string') return null;
  for (const re of PATTERNS) {
    const m = url.match(re);
    if (m) return m[1];
  }
  return null;
}

export function youtubeEmbedUrl(url) {
  const id = youtubeId(url);
  return id ? `https://www.youtube.com/embed/${id}` : null;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd frontend && CI=true npx react-scripts test src/lib/youtube.test.js --watchAll=false`
Expected: PASS.

- [ ] **Step 5: Implement the shared VideoModal**

Create `frontend/src/components/media/VideoModal.js`:

```javascript
import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { youtubeEmbedUrl } from '../../lib/youtube';

export default function VideoModal({ url, title, open, onClose }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const embed = youtubeEmbedUrl(url);

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4" onClick={onClose}>
      <div className="relative w-full max-w-3xl" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute -top-10 right-0 text-white/80 hover:text-white" aria-label="Close video">
          <X className="h-6 w-6" />
        </button>
        {title && <p className="text-white/90 text-sm mb-2 font-medium">{title}</p>}
        <div className="relative w-full rounded-xl overflow-hidden bg-black" style={{ paddingTop: '56.25%' }}>
          {embed
            ? <iframe className="absolute inset-0 w-full h-full" src={embed} title={title || 'Product video'}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen />
            : <div className="absolute inset-0 flex items-center justify-center text-white/70 text-sm">Invalid video link</div>}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/youtube.js frontend/src/lib/youtube.test.js frontend/src/components/media/VideoModal.js
git commit -m "feat(media): youtube util (tested) + shared VideoModal"
```

---

## Task 6: Lightbox component

**Files:**
- Create: `frontend/src/components/media/Lightbox.js`

- [ ] **Step 1: Implement the Lightbox**

Create `frontend/src/components/media/Lightbox.js`:

```javascript
import React, { useState, useEffect, useCallback } from 'react';
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react';

const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.5;

export default function Lightbox({ images, index = 0, onClose, backendUrl = '', alt = '' }) {
  const [i, setI] = useState(index);
  const [zoom, setZoom] = useState(1);
  const touchX = React.useRef(null);

  const total = images?.length || 0;
  const clamp = useCallback((n) => (n + total) % total, [total]);
  const go = useCallback((n) => { setI(clamp(n)); setZoom(1); }, [clamp]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') go(i + 1);
      else if (e.key === 'ArrowLeft') go(i - 1);
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prevOverflow; };
  }, [i, go, onClose]);

  if (!total) return null;
  const src = `${backendUrl}${images[i]}`;
  const zoomBy = (d) => setZoom(z => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +(z + d).toFixed(2))));

  return (
    <div className="fixed inset-0 z-[100] bg-black/90 flex flex-col" onClick={onClose}>
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 text-white/80" onClick={e => e.stopPropagation()}>
        <span className="text-sm font-mono">{i + 1} / {total}</span>
        <button onClick={onClose} aria-label="Close"><X className="h-6 w-6 hover:text-white" /></button>
      </div>

      {/* Stage */}
      <div className="flex-1 flex items-center justify-center relative overflow-hidden"
        onClick={e => e.stopPropagation()}
        onWheel={e => zoomBy(e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP)}
        onTouchStart={e => { touchX.current = e.touches[0].clientX; }}
        onTouchEnd={e => {
          if (touchX.current == null || zoom !== 1) return;
          const dx = e.changedTouches[0].clientX - touchX.current;
          if (Math.abs(dx) > 50) go(dx < 0 ? i + 1 : i - 1);
          touchX.current = null;
        }}>
        {total > 1 && (
          <button onClick={() => go(i - 1)} className="absolute left-2 sm:left-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white" aria-label="Previous">
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}
        <img src={src} alt={alt} draggable={false}
          className="max-h-full max-w-full object-contain transition-transform duration-150 select-none"
          style={{ transform: `scale(${zoom})` }} />
        {total > 1 && (
          <button onClick={() => go(i + 1)} className="absolute right-2 sm:right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white" aria-label="Next">
            <ChevronRight className="h-6 w-6" />
          </button>
        )}
      </div>

      {/* Zoom controls */}
      <div className="flex items-center justify-center gap-3 py-2 text-white/80" onClick={e => e.stopPropagation()}>
        <button onClick={() => zoomBy(-ZOOM_STEP)} disabled={zoom <= ZOOM_MIN} className="p-2 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30" aria-label="Zoom out"><ZoomOut className="h-5 w-5" /></button>
        <span className="text-xs font-mono w-12 text-center">{Math.round(zoom * 100)}%</span>
        <button onClick={() => zoomBy(ZOOM_STEP)} disabled={zoom >= ZOOM_MAX} className="p-2 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30" aria-label="Zoom in"><ZoomIn className="h-5 w-5" /></button>
      </div>

      {/* Thumbnail strip */}
      {total > 1 && (
        <div className="flex items-center justify-center gap-2 px-4 pb-4 overflow-x-auto no-scrollbar" onClick={e => e.stopPropagation()}>
          {images.map((u, idx) => (
            <button key={u} onClick={() => go(idx)}
              className={`shrink-0 w-12 h-12 rounded-md overflow-hidden border-2 ${idx === i ? 'border-[#e94560]' : 'border-transparent opacity-60 hover:opacity-100'}`}>
              <img src={`${backendUrl}${u}`} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/media/Lightbox.js
git commit -m "feat(media): full-screen Lightbox with zoom/swipe/thumbnails"
```

---

## Task 7: MediaGallery component (TDD render)

**Files:**
- Create: `frontend/src/components/media/MediaGallery.js`
- Test: `frontend/src/components/media/MediaGallery.test.js`

- [ ] **Step 1: Write the failing render test**

Create `frontend/src/components/media/MediaGallery.test.js`:

```javascript
import React from 'react';
import { render, screen } from '@testing-library/react';
import MediaGallery from './MediaGallery';

test('renders primary image and a +N badge for extra photos', () => {
  render(<MediaGallery images={['/api/files/a.jpg', '/api/files/b.jpg', '/api/files/c.jpg']} alt="Rose" backendUrl="" />);
  const img = screen.getByAltText('Rose');
  expect(img).toHaveAttribute('src', '/api/files/a.jpg');
  expect(screen.getByText('+2')).toBeInTheDocument();
});

test('renders a placeholder when there are no images', () => {
  const { container } = render(<MediaGallery images={[]} alt="Empty" backendUrl="" />);
  expect(screen.queryByAltText('Empty')).toBeNull();
  expect(container.querySelector('svg')).toBeInTheDocument(); // Scissors placeholder
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && CI=true npx react-scripts test src/components/media/MediaGallery.test.js --watchAll=false`
Expected: FAIL — cannot find module `./MediaGallery`.

- [ ] **Step 3: Implement MediaGallery**

Create `frontend/src/components/media/MediaGallery.js`:

```javascript
import React, { useState } from 'react';
import { Scissors, Expand } from 'lucide-react';
import Lightbox from './Lightbox';

export default function MediaGallery({ images = [], alt = '', backendUrl = '', className = '' }) {
  const [open, setOpen] = useState(false);
  const list = (images || []).filter(Boolean);
  const primary = list[0];
  const extra = list.length - 1;

  return (
    <>
      <div className={`relative w-full h-full ${className}`}>
        {primary ? (
          <button type="button" onClick={() => setOpen(true)} className="group block w-full h-full" aria-label="View photos">
            <img src={`${backendUrl}${primary}`} alt={alt} className="w-full h-full object-contain p-2" />
            <span className="absolute top-1.5 right-1.5 p-1 rounded-md bg-black/40 text-white opacity-0 group-hover:opacity-100 transition-opacity">
              <Expand className="h-3.5 w-3.5" />
            </span>
            {extra > 0 && (
              <span className="absolute bottom-1.5 right-1.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-black/55 text-white">+{extra}</span>
            )}
          </button>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[var(--text-muted)]">
            <Scissors className="h-6 w-6 opacity-20" />
          </div>
        )}
      </div>
      {open && <Lightbox images={list} index={0} backendUrl={backendUrl} alt={alt} onClose={() => setOpen(false)} />}
    </>
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd frontend && CI=true npx react-scripts test src/components/media/MediaGallery.test.js --watchAll=false`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/media/MediaGallery.js frontend/src/components/media/MediaGallery.test.js
git commit -m "feat(media): MediaGallery primary+badge, opens Lightbox"
```

---

## Task 8: Wire DieCard (admin Inventory)

**Files:**
- Modify: `frontend/src/components/inventory/DieCard.js`

- [ ] **Step 1: Import the media components**

At the top of `frontend/src/components/inventory/DieCard.js`, add:

```javascript
import MediaGallery from '../media/MediaGallery';
import VideoModal from '../media/VideoModal';
import { PlayCircle } from 'lucide-react';
```

- [ ] **Step 2: Replace the single image block with the gallery + video badge**

Find the image container (DieCard.js ~lines 26-43, the `<img src={die.image_url}...>` with Scissors fallback). Replace its inner image rendering with:

```jsx
<MediaGallery images={die.images} alt={die.name} backendUrl={backendUrl} />
{die.video_url && (
  <button type="button" onClick={(e) => { e.stopPropagation(); setVideoOpen(true); }}
    className="absolute bottom-1.5 left-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-black/55 text-white text-[10px] font-medium"
    title="Play video">
    <PlayCircle className="h-3.5 w-3.5" /> Video
  </button>
)}
```

Keep the existing camera/upload hover button as-is (admin still uploads from here; it appends via the existing `onUpload` → `uploadImage`).

- [ ] **Step 3: Add local video state + render the modal**

At the top of the `DieCard` function body add:

```javascript
const [videoOpen, setVideoOpen] = useState(false);
```

(import `useState` from React if not already imported), and before the component's closing tag add:

```jsx
<VideoModal url={die.video_url} title={die.name} open={videoOpen} onClose={() => setVideoOpen(false)} />
```

- [ ] **Step 4: Show description under the name (admin always sees it)**

Under the existing name/code line in DieCard, add:

```jsx
{die.description && <p className={`text-[11px] ${textMuted} mt-0.5 line-clamp-2`}>{die.description}</p>}
```

- [ ] **Step 5: Verify build (deferred to Task 12). Commit**

```bash
git add frontend/src/components/inventory/DieCard.js
git commit -m "feat(inventory): DieCard gallery + video badge + description"
```

---

## Task 9: Edit dialog media manager + Create fields + hook handlers

**Files:**
- Modify: `frontend/src/hooks/useInventory.js`
- Modify: `frontend/src/components/inventory/DieFormDialog.js`

- [ ] **Step 1: Add media handlers to useInventory**

In `frontend/src/hooks/useInventory.js`, add these handlers (near the other die handlers) and export them:

```javascript
const handleUploadImages = async (dieId, files) => {
  if (!files || !files.length) return;
  for (const f of files) {
    if (f.size > 5 * 1024 * 1024) { toast.error(`${f.name} is over 5 MB`); return; }
  }
  setUploading(dieId);
  try { await diesApi.uploadImages(dieId, files); toast.success('Photos added'); await fetchDies(); }
  catch (err) { toast.error(err.response?.data?.detail ? formatApiErrorDetail(err.response.data.detail) : 'Upload failed'); }
  finally { setUploading(null); }
};

const handleDeleteImage = async (dieId, url) => {
  try { await diesApi.deleteImage(dieId, url); toast.success('Photo removed'); await fetchDies(); }
  catch (err) { toast.error(err.response?.data?.detail ? formatApiErrorDetail(err.response.data.detail) : 'Failed'); }
};

const handleReorderImages = async (dieId, urls) => {
  try { await diesApi.reorderImages(dieId, urls); await fetchDies(); }
  catch (err) { toast.error(err.response?.data?.detail ? formatApiErrorDetail(err.response.data.detail) : 'Failed'); }
};
```

Add `handleUploadImages, handleDeleteImage, handleReorderImages` to the hook's returned object.

- [ ] **Step 2: Carry the new fields in openEdit / editForm**

In `useInventory.js` `openEdit` (lines ~120-129), extend `setEditForm({...})` to include the media fields:

```javascript
    setEditForm({
      code: die.code, name: die.name, type: die.type || 'standard',
      category: die.category || 'decorative', min_level: die.min_level ?? 5,
      description: die.description || '',
      video_url: die.video_url || '',
      show_video: !!die.show_video,
      show_description: !!die.show_description,
    });
```

`handleSaveEdit` already sends the whole `editForm` via `diesApi.update`, so `video_url`/`show_video`/`show_description`/`description` persist. Extend `BLANK_DIE` (line 18) to include `video_url:'', show_video:false, show_description:false` so Create posts them too.

- [ ] **Step 3: Pass editTarget media + handlers into EditDieDialog**

In `frontend/src/pages/admin/Inventory.js`, the `<EditDieDialog .../>` already receives `editTarget`, `editForm`, `setEditForm`. Add these props:

```jsx
  onUploadImages={inv.handleUploadImages}
  onDeleteImage={inv.handleDeleteImage}
  onReorderImages={inv.handleReorderImages}
  uploading={inv.uploading}
  backendUrl={backendUrl}
```

- [ ] **Step 4: Build the media manager UI in EditDieDialog**

In `frontend/src/components/inventory/DieFormDialog.js`, add to the `EditDieDialog` signature the new props `onUploadImages, onDeleteImage, onReorderImages, uploading, backendUrl`. Replace the single-photo block with a multi-photo manager and add the video + toggle fields. Insert this block (uses `editTarget.images`):

```jsx
{/* Photos (up to 5) */}
<div>
  <label className={`block text-xs font-medium mb-1.5 ${textSec}`}>Photos ({(editTarget?.images || []).length}/5)</label>
  <div className="grid grid-cols-5 gap-2">
    {(editTarget?.images || []).map((url, idx) => (
      <div key={url} className="relative group aspect-square rounded-md overflow-hidden border border-[var(--border-color)]">
        <img src={`${backendUrl}${url}`} alt="" className="w-full h-full object-cover" />
        {idx === 0 && <span className="absolute top-0.5 left-0.5 text-[8px] px-1 rounded bg-[#e94560] text-white">Main</span>}
        <div className="absolute inset-x-0 bottom-0 flex justify-center gap-0.5 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity">
          {idx > 0 && (
            <button type="button" title="Make main"
              onClick={() => onReorderImages(editTarget.die_id, [url, ...(editTarget.images || []).filter(u => u !== url)])}
              className="text-white text-[9px] px-1 py-0.5 hover:text-[#e94560]">★</button>
          )}
          <button type="button" title="Remove"
            onClick={() => onDeleteImage(editTarget.die_id, url)}
            className="text-white text-[9px] px-1 py-0.5 hover:text-red-400">✕</button>
        </div>
      </div>
    ))}
    {(editTarget?.images || []).length < 5 && (
      <label className={`aspect-square rounded-md border border-dashed border-[var(--border-color)] flex items-center justify-center cursor-pointer ${textMuted} hover:border-[#e94560]`}>
        {uploading === editTarget?.die_id ? '…' : '+'}
        <input type="file" accept="image/*" multiple className="hidden"
          onChange={e => { if (e.target.files?.length) onUploadImages(editTarget.die_id, e.target.files); e.target.value = ''; }} />
      </label>
    )}
  </div>
  <p className={`text-[10px] ${textMuted} mt-1`}>First photo is the main image. Max 5, 5 MB each.</p>
</div>

{/* Video link */}
<div>
  <label className={`block text-xs font-medium mb-1.5 ${textSec}`}>YouTube video link</label>
  <input value={editForm.video_url || ''} onChange={e => setEditForm({ ...editForm, video_url: e.target.value })}
    placeholder="https://youtu.be/…" className={`w-full h-9 px-2 rounded-md text-sm ${inputCls}`} />
</div>

{/* Publish toggles */}
<div className="flex flex-col gap-2">
  <label className="flex items-center gap-2 text-sm cursor-pointer">
    <input type="checkbox" checked={!!editForm.show_video} onChange={e => setEditForm({ ...editForm, show_video: e.target.checked })} />
    <span className={textSec}>Show video to customers</span>
  </label>
  <label className="flex items-center gap-2 text-sm cursor-pointer">
    <input type="checkbox" checked={!!editForm.show_description} onChange={e => setEditForm({ ...editForm, show_description: e.target.checked })} />
    <span className={textSec}>Show description to customers</span>
  </label>
</div>
```

- [ ] **Step 5: Add Create-dialog fields (video + toggles)**

In `CreateDieDialog` (same file), after the description field, add the same Video link input and the two toggles, bound to `newDie`/`setNewDie`:

```jsx
<div>
  <label className={`block text-xs font-medium mb-1.5 ${textSec}`}>YouTube video link (optional)</label>
  <input value={newDie.video_url || ''} onChange={e => setNewDie({ ...newDie, video_url: e.target.value })}
    placeholder="https://youtu.be/…" className={`w-full h-9 px-2 rounded-md text-sm ${inputCls}`} />
</div>
<div className="flex flex-col gap-2">
  <label className="flex items-center gap-2 text-sm cursor-pointer">
    <input type="checkbox" checked={!!newDie.show_video} onChange={e => setNewDie({ ...newDie, show_video: e.target.checked })} />
    <span className={textSec}>Show video to customers</span>
  </label>
  <label className="flex items-center gap-2 text-sm cursor-pointer">
    <input type="checkbox" checked={!!newDie.show_description} onChange={e => setNewDie({ ...newDie, show_description: e.target.checked })} />
    <span className={textSec}>Show description to customers</span>
  </label>
</div>
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/hooks/useInventory.js frontend/src/components/inventory/DieFormDialog.js frontend/src/pages/admin/Inventory.js
git commit -m "feat(inventory): edit-dialog photo manager + video link + publish toggles"
```

---

## Task 10: Wire the customer CataloguePage

**Files:**
- Modify: `frontend/src/pages/CataloguePage.js`

- [ ] **Step 1: Import media components**

At the top of `frontend/src/pages/CataloguePage.js` add:

```javascript
import MediaGallery from '../components/media/MediaGallery';
import VideoModal from '../components/media/VideoModal';
import { PlayCircle } from 'lucide-react';
```

Add page-level state for the active video:

```javascript
const [videoDie, setVideoDie] = useState(null);
```

- [ ] **Step 2: Replace the per-die image with the gallery (keep select on the card body)**

In the die card (CataloguePage.js ~lines 142-195), replace the single `<img>` (lines ~154-161) with the gallery, and add a video badge when present. The gallery's own expand button opens the lightbox; the surrounding card keeps its existing select toggle:

```jsx
<div className="relative aspect-square bg-white rounded-lg overflow-hidden">
  <MediaGallery images={die.images} alt={die.name} backendUrl={backendUrl} />
  {die.video_url && (
    <button type="button" onClick={(e) => { e.stopPropagation(); setVideoDie(die); }}
      className="absolute bottom-1.5 left-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-black/55 text-white text-[10px] font-medium">
      <PlayCircle className="h-3.5 w-3.5" /> Video
    </button>
  )}
</div>
```

(`backendUrl` in this page = `process.env.REACT_APP_BACKEND_URL || ''`; add that const if not already present.)

- [ ] **Step 3: Show gated description**

Under the die name/type text, add:

```jsx
{die.description && <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-2">{die.description}</p>}
```

(`video_url`/`description` are only present when the server published them — Task 3 — so no extra flag check is needed here.)

- [ ] **Step 4: Render the VideoModal once at page root**

Before the page's closing tag:

```jsx
<VideoModal url={videoDie?.video_url} title={videoDie?.name} open={!!videoDie} onClose={() => setVideoDie(null)} />
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/CataloguePage.js
git commit -m "feat(catalogue): customer gallery + zoom + gated video/description"
```

---

## Task 11: Wire the customer order view (PortalOrderCard)

**Files:**
- Modify: `frontend/src/components/portal/PortalOrderCard.js`

- [ ] **Step 1: Use a read-only gallery for line-item images**

In `frontend/src/components/portal/PortalOrderCard.js`, import the gallery:

```javascript
import MediaGallery from '../media/MediaGallery';
```

In the inner `DieCard` (lines ~9-34), replace the single `<img src={item.die_image_url}>` with:

```jsx
<MediaGallery images={item.die_images && item.die_images.length ? item.die_images : (item.die_image_url ? [item.die_image_url] : [])}
  alt={item.die_name} backendUrl={backendUrl} className="aspect-square" />
```

(Line-items currently carry only `die_image_url`; the gallery shows that single photo and still gives click-to-zoom. If `die_images` is added to line-items later, it lights up automatically. `backendUrl` const: `process.env.REACT_APP_BACKEND_URL || ''`.)

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/portal/PortalOrderCard.js
git commit -m "feat(portal): read-only zoom gallery on order line-items"
```

---

## Task 12: Full verification + QA

**Files:** none (verification only)

- [ ] **Step 1: Backend unit tests pass**

Run: `cd backend && python -m pytest tests/test_media_utils.py -v`
Expected: PASS.

- [ ] **Step 2: Frontend unit tests pass**

Run: `cd frontend && CI=true npx react-scripts test src/lib/youtube.test.js src/components/media/MediaGallery.test.js --watchAll=false`
Expected: PASS.

- [ ] **Step 3: Frontend build compiles**

Run: `cd frontend && DISABLE_ESLINT_PLUGIN=true CI=false NODE_OPTIONS=--max_old_space_size=4096 npx --no-install react-scripts build`
Expected: `Compiled successfully.`

- [ ] **Step 4: Manual QA checklist (local run or staging)**

Verify each:
1. Admin → Inventory → Edit a die → add 3 photos; first shows "Main"; "★" promotes another to main; "✕" removes one. Refresh persists order.
2. DieCard shows the gallery; clicking opens the lightbox; arrows/swipe move between photos; scroll and `−/+` zoom 100%→400%; Esc closes.
3. Add a YouTube link; with **Show video** OFF the customer catalogue shows **no** Video badge; turn it ON → badge appears and plays in the modal.
4. With **Show description** OFF the catalogue shows no description; ON → it appears.
5. `GET /api/catalogue/<token>` payload contains `images[]` always, and `video_url`/`description` only when their flags are ON (server gate).
6. Place/approve an order with a multi-photo die → order line-items still render the primary image (back-compat) and the portal order view zooms.
7. Try to add a 6th photo → blocked with the max-5 message. Paste a non-YouTube link → rejected with a clear toast.

- [ ] **Step 5: Final commit (if any QA fixes)**

```bash
git add -A
git commit -m "fix(media): QA pass adjustments"
```

---

## Self-Review

**Spec coverage:** images[] ≤5 (Tasks 2,7,9) ✓ · video_url + YouTube validation (Tasks 1,2,5) ✓ · reused description (Tasks 2,8,10) ✓ · separate show_video/show_description gates, server-enforced (Tasks 1,3,9) ✓ · image_url mirrors images[0] (Task 2 `_set_images`) ✓ · back-compat normalize (Task 1) ✓ · Lightbox zoom/swipe (Task 6) ✓ · MediaGallery (Task 7) ✓ · shared VideoModal (Task 5) ✓ · admin DieCard + Edit manager + Create fields (Tasks 8,9) ✓ · CataloguePage (Task 10) ✓ · PortalOrderCard (Task 11) ✓ · move/set-primary reorder (Task 9) ✓ · error handling: max-5, ≤5MB, invalid-URL, delete-primary promote (Tasks 2,9) ✓ · tests: pure helpers + render + gate (Tasks 1,5,7,12) ✓.

**Placeholder scan:** No TBD/TODO; every code step shows complete code.

**Type consistency:** `youtube_id`/`normalize_images`/`gate_die_for_customer`/`MAX_DIE_IMAGES` (backend) and `youtubeId`/`youtubeEmbedUrl` (frontend) names match across tasks; API methods `uploadImages`/`deleteImage`/`reorderImages` consistent between Task 4 and Task 9; `_set_images` used by all three backend write paths.
