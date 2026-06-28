# SmartShape Sales Mobile App (Flutter) — Design Spec

**Date:** 2026-06-28
**Status:** Approved design, pending implementation plan
**Author:** brainstorming session
**Phase:** Phase 1 (foundation + core sales daily loop)

## 1. Summary

A native iOS + Android mobile app, built in Flutter, for the SmartShape **sales team**.
It authenticates against the existing FastAPI REST backend and delivers the core
field-sales daily loop: log in, see a role-aware dashboard, check in/out with GPS, run
field visits, manage leads (add / update status / call / follow-up), and receive
real-time push notifications ("like WhatsApp").

The app is **online-first** and consumes the backend's existing endpoints wherever
possible. A small set of **additive, backwards-compatible** backend changes are made to
support mobile (JWT in the login response body, FCM token registration, an FCM send
path). The existing web app is unaffected.

### Scope decisions (from brainstorming)
- **Target users:** sales reps (`sales_person` role) primarily; the app respects the
  existing module-based RBAC, so other roles can log in but Phase 1 screens are
  sales-focused.
- **Build sequencing:** phased. This spec is **Phase 1**.
- **Push:** native FCM (Firebase Cloud Messaging), relaying to APNs on iOS.
- **Backend edits:** allowed, kept minimal and backwards-compatible.
- **State management:** Riverpod + dio + go_router (Option A).

### Phase 1 (this spec)
Login · Dashboard · Attendance (check-in/out) · Field Visit · Leads (list/add/detail/
status/call/follow-up) · In-app + push Notifications.

### Phase 2 (later, separate spec — out of scope here)
Create Quotation from mobile · My Tasks / Delegation submit flow (Done/Not-Done/Partial)
· advanced recurring reminders · richer analytics · offline caching.

## 2. Goals & non-goals

**Goals**
- A production-quality Flutter app skeleton the team can install and use daily.
- Rock-solid auth: Bearer-token login, secure storage, auto-refresh, device-trust,
  brute-force lockout messaging.
- Core sales loop usable in the field (GPS attendance + visits + leads + calls).
- Real-time push on both platforms via FCM, reusing existing notification triggers.
- Clean, feature-first architecture that Phase 2 can extend without rework.

**Non-goals (Phase 1)**
- Offline-first / local DB sync (online-first only; clear offline error states).
- Quotation creation, delegation submit flow, recurring reminders (Phase 2).
- Admin/accounts/store-specific mobile screens (web remains the tool for those).
- Tablet-optimized layouts (phone-first; must not break on tablet, but not optimized).

## 3. Architecture

### 3.1 Location in repo
New top-level folder **`mobile/`**, alongside `backend/` and `frontend/`. One repo, one
git history.

### 3.2 Stack
- `flutter_riverpod` — state management & dependency injection
- `dio` — HTTP client with interceptors
- `go_router` — declarative navigation + auth-guard redirect
- `flutter_secure_storage` — JWT storage (Keychain / Keystore)
- `firebase_core`, `firebase_messaging` — push
- `flutter_local_notifications` — render notifications in foreground
- `geolocator` — GPS for attendance / visits
- `url_launcher` — tap-to-call
- `device_info_plus` — device-trust label/platform
- `permission_handler` — location/notification permission flows

### 3.3 Folder structure
```
mobile/
├── lib/
│   ├── main.dart                 # Firebase init, ProviderScope, runApp
│   ├── app.dart                  # MaterialApp.router, theme, router
│   ├── core/
│   │   ├── api/                  # dio client, auth interceptor, endpoint constants
│   │   ├── config/               # base URL via --dart-define, constants
│   │   ├── auth/                 # auth state (Riverpod), token storage, device id
│   │   ├── push/                 # FCM init, token registration, message handlers
│   │   ├── location/             # geolocator helpers + permission flow
│   │   ├── error/                # error mapping, failure types
│   │   └── theme/                # brand colors (#123c69 navy / #e94560 red)
│   └── features/
│       ├── login/                # data/ application/ presentation/
│       ├── dashboard/
│       ├── attendance/           # check-in/out + field visit
│       ├── leads/                # list, add, detail, status, call, follow-up
│       └── notifications/        # in-app list + bell
└── test/                         # unit + widget tests
```
Each feature folder is self-contained — `data/` (models + repository), `application/`
(Riverpod providers), `presentation/` (screens + widgets) — so it can be understood and
tested in isolation.

### 3.4 Navigation & guard
`go_router` with a redirect that reads auth state: no valid token → `/login`; valid →
requested route (default `/dashboard`). Push taps deep-link to a target route.

## 4. Authentication

### 4.1 Flow
1. **Login screen** posts `POST /api/auth/login` with
   `{ email, password, device_token, device_info }`.
   - `device_token`: a UUID generated once on first launch, persisted in secure storage
     (drives the existing device-trust system).
   - `device_info`: `{ label, platform: "ios"|"android", screen, timezone, language }`
     via `device_info_plus`.
2. On success: store `access_token` + `refresh_token` in `flutter_secure_storage`; load
   the returned user object into auth state; route to `/dashboard`.
3. **dio auth interceptor** attaches `Authorization: Bearer <access_token>` to every
   request. On `401`: call `POST /api/auth/refresh` **once**, store new tokens, retry the
   original request; if refresh fails, clear storage and route to `/login`.
4. **Logout**: `POST /api/auth/logout`, unregister FCM token, clear secure storage, route
   to `/login`.

### 4.2 Backend special cases handled in UI
- `403 DEVICE_PENDING` → "Awaiting admin approval" screen.
- `403 DEVICE_REVOKED` → "Device revoked, contact admin" screen.
- `403 DEVICE_LIMIT_REACHED` → explain limit, contact admin.
- `429` brute-force lockout → show minutes-left message from backend detail.
- `403 Account disabled` → clear message.

### 4.3 Token handling note
`get_current_user` in `backend/auth_utils.py` already accepts
`Authorization: Bearer <token>`, so the app uses header auth. The only gap is that
`/api/auth/login` and `/api/auth/refresh` currently set tokens **only as cookies**;
see §6.1 for the additive fix to also return them in the JSON body.

## 5. Phase 1 screens

### 5.1 Login
Email/password form, validation, the device-trust + lockout error states above, a loading
state, and "forgot password" deferred (admin-managed accounts; show contact-admin hint).

### 5.2 Dashboard (`/dashboard`)
Role-aware landing screen composed from existing endpoints:
- Today's attendance status + prominent **Check-in / Check-out** action
  (`GET /api/sales/attendance/today`).
- **Target progress** card (`GET /api/sales/targets/progress`).
- **Leads needing attention** count (`GET /api/leads/needs-attention`).
- **Today's follow-ups** list (`GET /api/followups`).
- Bottom navigation: Dashboard · Leads · Attendance · Notifications.

### 5.3 Attendance & Field Visit (`/attendance`)
- **Check-in / check-out** with GPS via `geolocator`:
  `POST /api/sales/attendance/check-in`, `POST /api/sales/attendance/check-out`
  (sends lat/lng; backend classifies office vs. WFH/field via geofence settings).
- **Field visit**: select a school/lead → `POST /api/sales/visits`, then on-site
  `POST /api/sales/visits/{visit_id}/check-in` (logs visit + location). History via
  `GET /api/sales/visits`.
- Location permission flow: if denied, show a clear prompt with a settings deep-link;
  never silently fail.

### 5.4 Leads / CRM (`/leads`)
- **List** with search/filter: `GET /api/leads`, `GET /api/leads/search`.
- **Add lead**: `POST /api/leads` (backend auto-creates/links a Contact, deduped by
  phone within school).
- **Lead detail**: status, notes (`GET/POST /api/leads/{id}/notes`), follow-ups.
- **Update status**: `PUT /api/leads/{id}` with stage selection.
- **Tap-to-call**: `url_launcher` dials the lead's number; on return, prompt to log the
  call as a note and/or schedule a follow-up.
- **Add follow-up / reminder**: `POST /api/followups`.

### 5.5 Notifications (`/notifications`)
- In-app list from `GET /api/crm/notifications`; mark read via
  `POST /api/crm/notifications/{id}/read` and `/read-all`.
- Push arrivals surface here too; tapping a push deep-links to the relevant entity.

## 6. Backend additions (additive, backwards-compatible)

The web app continues to work unchanged. All additions are new fields/endpoints/helpers.

### 6.1 Return JWTs in login/refresh response body
`POST /api/auth/login` and `POST /api/auth/refresh` continue to set cookies **and** also
include `access_token` + `refresh_token` in the JSON response body. The web app ignores
the new fields; the mobile app reads them. This avoids fragile Set-Cookie header scraping.

### 6.2 FCM token registration
- `POST /api/push/fcm/register` — body `{ fcm_token, platform }`, authenticated; upsert
  into a new `fcm_tokens` collection keyed by `(email, fcm_token)`.
- `DELETE /api/push/fcm/unregister` — body `{ fcm_token }`; remove on logout/expiry.
- Parallel to the existing web `push_subscriptions`; does not modify web push.

### 6.3 FCM send path
- New helper `send_fcm_to_user(email, title, body, data)` (mirrors the existing
  `send_push_to_user` in `push_routes.py`), using the Firebase Admin SDK with a
  service-account key from an env var (e.g. `FCM_SERVICE_ACCOUNT_JSON`).
- Wire it into existing notification trigger points (new lead assigned, follow-up due,
  task/delegation reminders) so a phone receives the same alerts the web already
  generates. Sends fan out to **both** web push and FCM.
- Stale-token cleanup: delete tokens FCM reports as unregistered (404/`UNREGISTERED`).

### 6.4 Tests
New backend endpoints/helpers get pytest coverage matching the existing `backend/tests`
style (note: that directory is gitignored and hits prod data — tests must be read-only or
use isolated fixtures, per project conventions).

## 7. Cross-cutting concerns

### 7.1 Error handling
Central error mapping in the dio interceptor → typed failures → friendly UI messages:
- 401 → silent refresh+retry, else logout.
- 403 → device/permission/disabled messages (see §4.2).
- 429 → lockout message.
- Network/timeout → non-blocking "no connection" banner + retry affordance.

### 7.2 Configuration
- API base URL via `--dart-define=API_BASE_URL=...`.
  - Android emulator dev: `http://10.0.2.2:8000`; physical device: LAN IP.
  - Prod: `https://app.smartshape.in` (confirm the `/api` prefix at build time).
- No secrets committed. `google-services.json` / `GoogleService-Info.plist` handled per
  platform; backend FCM service-account via env var only.

### 7.3 Security
- JWTs stored only in `flutter_secure_storage`; never in shared prefs, never logged.
- HTTPS enforced in prod builds.
- Device-trust token persisted securely; respects backend approval policy.

### 7.4 Offline
Phase 1 is online-first. Show clear offline states; no local persistence of business data
beyond tokens (deliberate YAGNI; revisit in Phase 2).

## 8. Push setup checklist (Firebase)
- Create a free Firebase project for SmartShape.
- Android app registration → `google-services.json` into `mobile/android/app/`.
- iOS app registration → `GoogleService-Info.plist` into `mobile/ios/Runner/`; upload an
  **APNs auth key** (requires Apple Developer account, $99/yr) to Firebase.
- Backend: add a service-account key (env var) for the Firebase Admin SDK.

## 9. Testing strategy
- **Unit:** token/auth logic; dio interceptor (mock 401 → refresh → retry → success and
  → failure→logout); repositories with mocked dio.
- **Widget:** login form validation + each error state; dashboard composition; lead
  add/update flows.
- **Manual smoke checklist:** real login against staging; GPS check-in; add + call a
  lead + log it; receive a `POST /api/push/test`-equivalent FCM test push; logout clears
  state.
- **Backend:** pytest for the new endpoints/helpers.

## 10. Risks & open items
- **iOS push requires a paid Apple Developer account** for real APNs delivery — confirm
  availability before the iOS push milestone.
- **API base URL / `/api` prefix** must be confirmed against the deployed backend at build
  time.
- **Backend deploy:** the additive backend changes ship through the existing
  origin/main auto-deploy; coordinate with the documented deploy/rollback procedure.
- **Backend test directory hits prod data** — new tests must avoid mutating prod.

## 11. Deliverables (Phase 1)
1. `mobile/` Flutter project (iOS + Android) implementing §5 screens.
2. Auth foundation (§4) with secure storage + auto-refresh + device-trust.
3. FCM push end-to-end (§6.2, §6.3, §8) on both platforms.
4. Additive backend changes (§6) with tests.
5. README in `mobile/` covering setup, `--dart-define` config, and Firebase setup.
