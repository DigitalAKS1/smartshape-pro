# SmartShape Pro — Mobile Apps (iOS + Android), Phase 1 Design

**Date:** 2026-06-04
**Status:** Approved design — ready for implementation planning
**Author:** Aman Shrivastava (with Claude)

---

## 1. Goal

Turn the existing SmartShape Pro React web app into **installable, self-updating native
apps for iPhone and Android**, for **internal staff only** (admin / accounts / store /
sales teams). Reuse the existing codebase — no rewrite.

This document covers **Phase 1 only**. Push notifications, native camera, and full
offline create-edit-sync are explicitly deferred to later phases (see §9).

### Phase 1 success criteria
1. Staff can install the app on Android (direct `.apk` link) and iPhone (TestFlight invite).
2. Login works inside the native app.
3. When a new web build is deployed, phones **auto-update over-the-air** on next launch — no reinstall, no app store.
4. Staff can **view recently-loaded data offline** (read-only) with a clear "offline" indicator.
5. The existing website continues to work unchanged in browsers.

---

## 2. Context (current state of the codebase)

- **Frontend:** React 19 + CRACO + Tailwind + shadcn/ui (Radix), `react-router-dom` v7,
  axios. Built with `craco build` → `frontend/build/`.
- **Backend:** Python / FastAPI on Hostinger VPS (`srv1667373.hstgr.cloud`,
  `/var/www/smartshape/`).
- **Existing PWA groundwork already present** (important — reduces Phase 1 work):
  - `frontend/public/sw.js` (service worker, cache version `ssp-v9`, offline-first shell).
  - `frontend/public/manifest.json` (standalone display, `start_url: /today`, icons, shortcuts).
  - `frontend/public/offline.html` (offline fallback page).
  - `frontend/src/lib/offlineQueue.js` (IndexedDB queue for offline POST/PUT/PATCH — dormant in Phase 1).
  - `frontend/src/lib/dataSync.js`, `frontend/src/utils/deviceService.js`.
- **API client:** `frontend/src/lib/api.js` — axios instance, `baseURL` from
  `process.env.REACT_APP_BACKEND_URL`, **`withCredentials: true` (cookie auth)**, with a
  401 auto-refresh interceptor.
- **Auth:** `frontend/src/contexts/AuthContext.js`, cookie-based.

---

## 3. Architecture

```
React app (unchanged)  ──craco build──▶  web bundle (frontend/build)
                                              │
            ┌─────────────────────────────────┼──────────────────────────────┐
            ▼                                 ▼                                ▼
     Browser (website)              Android shell (Capacitor)        iPhone shell (Capacitor)
            │                                 │                                │
            │                       loads web bundle locally,         loads web bundle locally,
            │                       OTA-updates from VPS              OTA-updates from VPS
            │                                 │                                │
            └────────────── all API calls ───▶  FastAPI backend on VPS  ◀──────┘
```

- Capacitor is added **inside the existing `frontend/`** project. The React source code
  is the single source of truth for web + both apps.
- The native shells bundle the compiled web app and load it locally (fast, works offline),
  while all data calls go to the VPS backend.
- The backend keeps serving the website and gains **two small additions**: token login
  (§4) and an OTA update endpoint (§5).

---

## 4. Authentication fix (first build task — everything depends on it)

**Problem:** The app authenticates with cookies (`withCredentials: true`). Cookies are
unreliable inside a Capacitor WebView calling a remote origin (cross-origin / `SameSite`
handling), which typically breaks login in the native app even though the website works.

**Decision:** Add **Bearer-token authentication** for native clients, alongside the
existing cookie auth for the website.

### Backend
- On successful login, also return a signed access token (JWT) and a refresh token in the
  JSON response body (in addition to setting the existing cookies).
- Accept `Authorization: Bearer <token>` on protected routes (in addition to cookies).
- Add a token-refresh endpoint that accepts the refresh token in the body.

### Frontend / native
- Detect native runtime via Capacitor (`Capacitor.isNativePlatform()`).
- When native: store tokens in **secure device storage** (`@capacitor/preferences`, or a
  secure-storage plugin), attach `Authorization: Bearer` on every request in the axios
  request interceptor, and drive the existing 401-refresh flow off the refresh token.
- When in a browser: behavior is unchanged (cookies).

**Non-goals:** No change to the website's existing cookie login. No change to user
accounts, roles, or RBAC.

---

## 5. Over-the-air (OTA) auto-update — self-hosted on the VPS

**Decision:** Use the open-source **`@capgo/capacitor-updater`** plugin in **self-hosted
mode**. No Capgo cloud account; the update server is our own FastAPI backend. Everything
stays on the user's VPS.

### How it works
1. On app launch, the plugin calls a **version-check endpoint** on the VPS, sending the
   currently installed bundle version.
2. The backend responds with the latest bundle version and a download URL (or "up to date").
3. If newer, the plugin downloads the new web bundle zip in the background and applies it
   on the next app open. The native shell is untouched.

### Backend additions
- `GET /api/app/updates/latest?platform=<ios|android>&current=<version>` → returns latest
  version metadata + signed download URL, or "no update".
- Serve the bundle zips from a folder on the VPS (e.g. `/var/www/smartshape/app-bundles/`),
  behind a stable URL.
- A **version manifest** file recording the current bundle version per platform.

### Deploy flow (what the owner does to ship an update)
1. `craco build` (produces `frontend/build/`).
2. Run a small **bundle-publish script** (added in this phase) that zips `frontend/build/`,
   uploads it to the VPS bundle folder, and bumps the version in the manifest.
3. Done — phones pick it up on next launch. (This step gets wired into the existing
   `deploy.sh` / `deploy-live.bat` flow.)

### When a full app-store rebuild IS still needed
Only when a **new native capability** is added (e.g. push or camera in later phases) or
Capacitor/native dependencies change. Routine feature/UI/bugfix changes ship via OTA.

---

## 6. Build & distribution

### Android (free, easy — done on the owner's Windows machine)
- Add Android platform via Capacitor, configure app id (e.g. `in.smartshape.app`), icon,
  splash, and signing keystore.
- Build a **signed `.apk`** (and `.aab` if ever needed).
- Host the `.apk` behind a simple **"Install SmartShape" link** (a page on the existing
  site, or a shared Google Drive link). Staff tap once and allow "install from this source".

### iPhone (requires Apple Developer account + cloud Mac build)
- **Apple Developer Program account (~$99/yr)** — required for any iOS distribution.
- ⚠️ **Windows constraint:** building an iOS app requires macOS. The owner is on Windows,
  so we use a **cloud Mac build service** — **Codemagic** or **EAS Build** (both have free
  tiers). No Mac purchase needed.
- Distribute via **TestFlight**: staff receive an email invite, install Apple's TestFlight
  app, then install SmartShape. (Internal testers — well within TestFlight limits.)

### App identity (shared)
- App name: **SmartShape Pro**; bundle/app id: `in.smartshape.app` (final value confirmed at build time).
- Reuse existing icons in `frontend/public/icons/` (generate the additional native icon/splash sizes Capacitor needs).

---

## 7. Offline viewing (read-only — the small, safe version)

Reuse the **existing service worker** rather than building new offline infrastructure.

- Cache GET responses for the primary screens: **Today (`/today`), Leads (`/leads`),
  Visits (`/visit-planning`), Quotations**.
- When offline, render the last-cached data and show a clear, dismissible **"You're
  offline — showing saved data"** banner.
- The existing IndexedDB write-queue (`offlineQueue.js`) stays **dormant** in Phase 1 —
  not wired into the UI — so we don't accidentally ship half of the (deferred) offline-edit
  feature. It must not break or silently queue writes that never sync.

**Non-goals (Phase 1):** No creating/editing offline. No conflict resolution. No sync engine.

---

## 8. Testing & verification

1. **Login (token):** log in inside a real Android device and iOS (Simulator or TestFlight);
   confirm protected screens load and token refresh works after expiry.
2. **OTA update:** deploy a visibly-changed build via the publish script; confirm both an
   Android device and an iPhone auto-apply it on next launch without reinstall.
3. **Offline viewing:** load each main screen, enable airplane mode, confirm cached data
   renders and the offline banner shows; confirm no broken white screen.
4. **Website regression:** confirm cookie login and all flows still work unchanged in a
   desktop/mobile browser.
5. **Fresh install:** install from the `.apk` link (Android) and TestFlight (iPhone) on a
   clean device; confirm first-run login → home works end to end.

---

## 9. Out of scope (future phases — each gets its own spec)

- **Phase 2 — Native camera:** in-app photo capture attached to leads/quotations.
- **Phase 3 — Push notifications:** FCM (Android) + APNs (iPhone) with backend triggers
  (e.g. lead assigned, quotation approved). Requires a native-shell re-release.
- **Phase 4 — Full offline create-edit-sync:** local database, sync engine, and conflict
  resolution; builds on the dormant `offlineQueue.js`. Largest and riskiest; to be
  validated against real staff usage of Phase 1 offline-viewing before committing.

---

## 10. Key risks & mitigations

| Risk | Mitigation |
|---|---|
| Cookie auth breaks in native WebView | Token (Bearer) auth added first; web cookies untouched (§4). |
| iOS build impossible on Windows | Cloud Mac build service (Codemagic / EAS) — no Mac needed (§6). |
| Owner is non-technical; updates must be simple | One publish script + existing deploy flow; phones self-update (§5). |
| Accidentally shipping half-built offline-edit | Write-queue kept dormant and explicitly verified inert (§7). |
| Apple yearly cost / account setup | Budgeted (~$99/yr); only blocker for iPhone, Android unaffected (§6). |
