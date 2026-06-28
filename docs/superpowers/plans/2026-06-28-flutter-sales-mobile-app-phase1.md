# SmartShape Sales Mobile App (Flutter) — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a native iOS + Android Flutter app for the SmartShape sales team — login, dashboard, GPS attendance/visits, leads (add/status/call/follow-up), and FCM push — against the existing FastAPI backend, plus the minimal additive backend changes mobile needs.

**Architecture:** Feature-first Flutter app using Riverpod (state), dio (HTTP with an auth interceptor that auto-refreshes on 401), go_router (navigation + auth guard), and flutter_secure_storage (JWT). Push via Firebase Cloud Messaging. The backend gains three additive, backwards-compatible changes (JWT in login/refresh body, FCM token registration, FCM send path) — the existing web app is unaffected.

**Tech Stack:** Flutter (Dart 3), flutter_riverpod, dio, go_router, flutter_secure_storage, firebase_core, firebase_messaging, flutter_local_notifications, geolocator, permission_handler, url_launcher, device_info_plus. Backend: FastAPI, motor (MongoDB), firebase-admin, pytest.

## Global Constraints

- **Backend route prefix:** every backend endpoint is mounted under `/api` (see `backend/main.py`). All mobile requests target `https://<host>/api/...`.
- **Auth:** backend `get_current_user` accepts `Authorization: Bearer <access_token>`. The app uses header auth, never cookies.
- **Backend changes must be additive and backwards-compatible** — never remove or rename existing fields/cookies; the production web app depends on them.
- **Brand colors:** navy `#123c69`, accent red `#e94560` (match existing web app).
- **JWT lifetimes (existing):** access token 24h, refresh token 30d. Do not change.
- **Secrets:** never commit `google-services.json`, `GoogleService-Info.plist`, or the FCM service-account JSON. API base URL is injected via `--dart-define=API_BASE_URL=...`.
- **Backend test caveat:** `backend/tests` is gitignored and runs against prod data. New backend tests MUST be read-only or use isolated/mocked fixtures — never mutate prod collections.
- **App folder:** all Flutter code lives under `mobile/` at the repo root.
- **Python interpreter on this machine:** use `python` (not `python3`).
- **Dart formatting/lint:** run `dart format .` and `flutter analyze` clean before each commit in `mobile/`.

---

## Milestone A — Backend additions (FastAPI)

### Task 1: Return JWTs in the login & refresh response body

**Files:**
- Modify: `backend/routes/auth_routes.py` (login `~285-308`, refresh `~380-386`)
- Test: `backend/tests/test_mobile_auth_body.py`

**Interfaces:**
- Produces: `POST /api/auth/login` and `POST /api/auth/refresh` JSON responses now include `access_token: str` and `refresh_token: str` in addition to existing fields and cookies.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_mobile_auth_body.py
import os, jwt, pytest
from httpx import AsyncClient, ASGITransport

# Read-only: uses an existing seeded admin; does NOT create/mutate data.
from backend.main import app  # adjust import to how main exposes `app`

ADMIN_EMAIL = os.environ["TEST_ADMIN_EMAIL"]
ADMIN_PASSWORD = os.environ["TEST_ADMIN_PASSWORD"]
JWT_SECRET = os.environ["JWT_SECRET"]

@pytest.mark.asyncio
async def test_login_returns_tokens_in_body():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post("/api/auth/login",
                          json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200
    data = r.json()
    assert "access_token" in data and "refresh_token" in data
    payload = jwt.decode(data["access_token"], JWT_SECRET, algorithms=["HS256"])
    assert payload["type"] == "access"
    assert payload["email"] == ADMIN_EMAIL.lower()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_mobile_auth_body.py -v`
Expected: FAIL — `KeyError`/assert on `"access_token" in data` (body has no tokens yet).

- [ ] **Step 3: Add tokens to the login response body**

In `backend/routes/auth_routes.py`, in `login(...)`, after the cookies are set and `user_data` is fetched (around line 291), attach the tokens to the returned dict:

```python
    user_data = await db.users.find_one({"email": email}, {"_id": 0, "password_hash": 0})

    # Mobile (Bearer auth) reads tokens from the body; web ignores these and uses cookies.
    user_data["access_token"] = access_token
    user_data["refresh_token"] = refresh_token
```

(The existing `login_logs.insert_one(...)` and `return user_data` stay as-is below.)

- [ ] **Step 4: Add tokens to the refresh response body**

In `refresh_tokens(...)` (around line 380-386), after creating `access_token` and `new_refresh_token` and setting cookies, change the return:

```python
        response.set_cookie(key="refresh_token", value=new_refresh_token, max_age=2592000, **_COOKIE_KWARGS)

        user["access_token"] = access_token
        user["refresh_token"] = new_refresh_token
        return user
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_mobile_auth_body.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/routes/auth_routes.py backend/tests/test_mobile_auth_body.py
git commit -m "feat(auth): return JWT access/refresh tokens in login & refresh body for mobile"
```

---

### Task 2: FCM token registration endpoints

**Files:**
- Modify: `backend/routes/push_routes.py` (add endpoints near existing push endpoints)
- Test: `backend/tests/test_fcm_register.py`

**Interfaces:**
- Consumes: `get_current_user` (existing), `db.fcm_tokens` (new collection, created on first upsert).
- Produces:
  - `POST /api/push/fcm/register` body `{fcm_token: str, platform: "ios"|"android"}` → `{"ok": true}`; upserts `{email, fcm_token, platform, name, updated_at}` keyed by `(email, fcm_token)`.
  - `DELETE /api/push/fcm/unregister` body `{fcm_token: str}` → `{"ok": true}`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_fcm_register.py
import os, pytest
from httpx import AsyncClient, ASGITransport
from backend.main import app
from backend.database import db

ADMIN_EMAIL = os.environ["TEST_ADMIN_EMAIL"]
ADMIN_PASSWORD = os.environ["TEST_ADMIN_PASSWORD"]
FAKE_TOKEN = "test-fcm-token-DO-NOT-SEND-0001"

async def _login_token(ac):
    r = await ac.post("/api/auth/login",
                      json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    return r.json()["access_token"]

@pytest.mark.asyncio
async def test_register_and_unregister_fcm_token():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        tok = await _login_token(ac)
        h = {"Authorization": f"Bearer {tok}"}
        r = await ac.post("/api/push/fcm/register",
                          json={"fcm_token": FAKE_TOKEN, "platform": "android"}, headers=h)
        assert r.status_code == 200 and r.json()["ok"] is True
        assert await db.fcm_tokens.find_one({"fcm_token": FAKE_TOKEN}) is not None
        r2 = await ac.request("DELETE", "/api/push/fcm/unregister",
                              json={"fcm_token": FAKE_TOKEN}, headers=h)
        assert r2.status_code == 200
        assert await db.fcm_tokens.find_one({"fcm_token": FAKE_TOKEN}) is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_fcm_register.py -v`
Expected: FAIL — 404 (routes don't exist yet).

- [ ] **Step 3: Implement the endpoints**

Add to `backend/routes/push_routes.py` (after the existing `/push/test` endpoint):

```python
@router.post("/push/fcm/register")
async def register_fcm_token(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    fcm_token = body.get("fcm_token")
    platform = body.get("platform", "")
    if not fcm_token:
        raise HTTPException(400, "fcm_token required")
    await db.fcm_tokens.update_one(
        {"email": user["email"], "fcm_token": fcm_token},
        {"$set": {
            "email": user["email"],
            "name": user.get("name", ""),
            "role": user.get("role", ""),
            "fcm_token": fcm_token,
            "platform": platform,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True,
    )
    logger.info(f"[fcm] registered token for {user['email']} ({platform})")
    return {"ok": True}


@router.delete("/push/fcm/unregister")
async def unregister_fcm_token(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    fcm_token = body.get("fcm_token")
    if fcm_token:
        await db.fcm_tokens.delete_many({"email": user["email"], "fcm_token": fcm_token})
    else:
        await db.fcm_tokens.delete_many({"email": user["email"]})
    return {"ok": True}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_fcm_register.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/push_routes.py backend/tests/test_fcm_register.py
git commit -m "feat(push): add FCM token register/unregister endpoints for mobile"
```

---

### Task 3: FCM send helper + wire into notification triggers

**Files:**
- Modify: `backend/routes/push_routes.py` (add `send_fcm_to_user`)
- Modify: `backend/requirements.txt` (add `firebase-admin`)
- Test: `backend/tests/test_fcm_send.py`

**Interfaces:**
- Consumes: `db.fcm_tokens`, env `FCM_SERVICE_ACCOUNT_JSON` (path or JSON string of a Firebase service account).
- Produces: `async def send_fcm_to_user(email: str, title: str, body: str, data: dict | None = None) -> int` — returns count of successful sends; never raises; deletes tokens FCM reports as `UNREGISTERED`.

- [ ] **Step 1: Add the dependency**

Append to `backend/requirements.txt`:

```
firebase-admin>=6.5.0
```

Run: `cd backend && python -m pip install "firebase-admin>=6.5.0"`
Expected: installs cleanly.

- [ ] **Step 2: Write the failing test (mocked — never hits real FCM)**

```python
# backend/tests/test_fcm_send.py
import pytest
from unittest.mock import patch, MagicMock
import backend.routes.push_routes as pr

@pytest.mark.asyncio
async def test_send_fcm_to_user_counts_successes(monkeypatch):
    # Two fake tokens for a fake user; no DB writes.
    async def fake_find(*a, **k):
        class C:
            async def to_list(self, n): return [
                {"fcm_token": "t1"}, {"fcm_token": "t2"}]
        return C()
    monkeypatch.setattr(pr.db.fcm_tokens, "find", lambda *a, **k: fake_find().__await__().__next__() if False else _FakeCursor())
    with patch.object(pr, "_fcm_app", MagicMock()), \
         patch("firebase_admin.messaging.send", return_value="ok") as send:
        sent = await pr.send_fcm_to_user("x@y.com", "Title", "Body", {"k": "v"})
    assert sent == 2
    assert send.call_count == 2

class _FakeCursor:
    async def to_list(self, n):
        return [{"fcm_token": "t1"}, {"fcm_token": "t2"}]
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_fcm_send.py -v`
Expected: FAIL — `send_fcm_to_user`/`_fcm_app` not defined.

- [ ] **Step 4: Implement the helper**

Add to the top of `backend/routes/push_routes.py` (after existing imports):

```python
import os

_fcm_app = None

def _ensure_fcm_app():
    """Initialise the Firebase Admin app once from FCM_SERVICE_ACCOUNT_JSON.
    Value may be a path to the JSON file or the raw JSON string."""
    global _fcm_app
    if _fcm_app is not None:
        return _fcm_app
    raw = os.environ.get("FCM_SERVICE_ACCOUNT_JSON")
    if not raw:
        return None
    import firebase_admin
    from firebase_admin import credentials
    if os.path.exists(raw):
        cred = credentials.Certificate(raw)
    else:
        cred = credentials.Certificate(json.loads(raw))
    _fcm_app = firebase_admin.initialize_app(cred, name="smartshape-fcm")
    return _fcm_app
```

Then add the send helper (near `send_push_to_user`):

```python
async def send_fcm_to_user(email: str, title: str, body: str, data: dict | None = None) -> int:
    """Send a native FCM push to every device token for `email`. Never raises."""
    try:
        if _ensure_fcm_app() is None:
            return 0
        from firebase_admin import messaging
        tokens = await db.fcm_tokens.find({"email": email}).to_list(20)
        if not tokens:
            return 0
        sent, dead = 0, []
        str_data = {k: str(v) for k, v in (data or {}).items()}
        for t in tokens:
            try:
                msg = messaging.Message(
                    notification=messaging.Notification(title=title, body=body),
                    data=str_data,
                    token=t["fcm_token"],
                )
                await asyncio.get_event_loop().run_in_executor(
                    None, lambda m=msg: messaging.send(m, app=_fcm_app))
                sent += 1
            except messaging.UnregisteredError:
                dead.append(t["fcm_token"])
            except Exception as exc:
                logger.warning(f"[fcm] send failed for {email}: {exc}")
        if dead:
            await db.fcm_tokens.delete_many({"fcm_token": {"$in": dead}})
        return sent
    except Exception as exc:
        logger.warning(f"[fcm] send_fcm_to_user error ({email}): {exc}")
        return 0
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_fcm_send.py -v`
Expected: PASS (mocked).

- [ ] **Step 6: Wire FCM alongside existing web push**

Find every call site of `send_push_to_user(` outside `push_routes.py`:

Run: `grep -rn "send_push_to_user(" backend --include=*.py | grep -v push_routes.py`

For each call site (e.g. lead-assignment, follow-up-due, delegation reminders), add a parallel FCM send so phones get the same alert. Example pattern at each site:

```python
from routes.push_routes import send_push_to_user, send_fcm_to_user
await send_push_to_user(email, title, body, url, tag)
await send_fcm_to_user(email, title, body, {"url": url, "tag": tag})
```

- [ ] **Step 7: Commit**

```bash
git add backend/routes/push_routes.py backend/requirements.txt backend/tests/test_fcm_send.py
git commit -m "feat(push): add FCM send path and fan out alerts to mobile devices"
```

---

## Milestone B — Flutter foundation

### Task 4: Scaffold the Flutter project

**Files:**
- Create: `mobile/` (via `flutter create`), `mobile/pubspec.yaml`, `mobile/lib/main.dart`, `mobile/lib/app.dart`, `mobile/lib/core/config/app_config.dart`, `mobile/lib/core/theme/app_theme.dart`, `mobile/README.md`
- Test: `mobile/test/smoke_test.dart`

**Interfaces:**
- Produces: `AppConfig.apiBaseUrl` (String, from `--dart-define=API_BASE_URL`, default `http://10.0.2.2:8000`); `AppTheme.light` (ThemeData); `SmartShapeApp` (root widget).

- [ ] **Step 1: Create the project**

Run:
```bash
cd "f:/SMARTSHAPE APP" && flutter create --org in.smartshape --project-name smartshape_sales --platforms ios,android mobile
```
Expected: `mobile/` created.

- [ ] **Step 2: Add dependencies**

Replace `mobile/pubspec.yaml` dependencies block with:

```yaml
dependencies:
  flutter:
    sdk: flutter
  flutter_riverpod: ^2.5.1
  dio: ^5.4.0
  go_router: ^14.0.0
  flutter_secure_storage: ^9.0.0
  geolocator: ^11.0.0
  permission_handler: ^11.3.0
  url_launcher: ^6.2.0
  device_info_plus: ^10.0.0
  firebase_core: ^3.0.0
  firebase_messaging: ^15.0.0
  flutter_local_notifications: ^17.0.0
  intl: ^0.19.0

dev_dependencies:
  flutter_test:
    sdk: flutter
  flutter_lints: ^4.0.0
  mocktail: ^1.0.0
```

Run: `cd mobile && flutter pub get`
Expected: resolves successfully.

- [ ] **Step 3: Write config + theme + app shell**

`mobile/lib/core/config/app_config.dart`:
```dart
class AppConfig {
  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://10.0.2.2:8000',
  );
  static String get apiPrefix => '$apiBaseUrl/api';
}
```

`mobile/lib/core/theme/app_theme.dart`:
```dart
import 'package:flutter/material.dart';

class AppTheme {
  static const navy = Color(0xFF123C69);
  static const accent = Color(0xFFE94560);

  static ThemeData get light => ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(seedColor: navy, primary: navy, secondary: accent),
        appBarTheme: const AppBarTheme(backgroundColor: navy, foregroundColor: Colors.white),
      );
}
```

`mobile/lib/app.dart`:
```dart
import 'package:flutter/material.dart';
import 'core/theme/app_theme.dart';

class SmartShapeApp extends StatelessWidget {
  const SmartShapeApp({super.key});
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'SmartShape Sales',
      theme: AppTheme.light,
      home: const Scaffold(body: Center(child: Text('SmartShape Sales'))),
    );
  }
}
```

`mobile/lib/main.dart`:
```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'app.dart';

void main() {
  runApp(const ProviderScope(child: SmartShapeApp()));
}
```

- [ ] **Step 4: Write the smoke test**

`mobile/test/smoke_test.dart`:
```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:smartshape_sales/app.dart';

void main() {
  testWidgets('app boots and shows title', (tester) async {
    await tester.pumpWidget(const ProviderScope(child: SmartShapeApp()));
    expect(find.text('SmartShape Sales'), findsOneWidget);
  });
}
```

- [ ] **Step 5: Run analyze + test**

Run: `cd mobile && flutter analyze && flutter test`
Expected: analyze clean, smoke test PASSES.

- [ ] **Step 6: Write README**

`mobile/README.md` — document: prerequisites (Flutter SDK), run command with `--dart-define=API_BASE_URL=http://<LAN-IP>:8000`, Android emulator note (`10.0.2.2`), and a placeholder Firebase setup section (filled in Task 13).

- [ ] **Step 7: Commit**

```bash
git add mobile
git commit -m "feat(mobile): scaffold Flutter app with config, theme, deps"
```

---

### Task 5: Secure token storage + stable device id

**Files:**
- Create: `mobile/lib/core/auth/token_store.dart`, `mobile/lib/core/auth/device_identity.dart`
- Test: `mobile/test/core/token_store_test.dart`

**Interfaces:**
- Produces:
  - `TokenStore` with `Future<void> save({required String access, required String refresh})`, `Future<String?> get accessToken`, `Future<String?> get refreshToken`, `Future<void> clear()`. Constructor takes `FlutterSecureStorage storage` (injectable for tests).
  - `DeviceIdentity.getOrCreateDeviceToken(TokenStore-like storage)` → `Future<String>` (persisted UUID); `DeviceIdentity.deviceInfo()` → `Future<Map<String,dynamic>>` `{label, platform, screen, timezone, language}`.

- [ ] **Step 1: Write the failing test (in-memory fake storage)**

```dart
// mobile/test/core/token_store_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:smartshape_sales/core/auth/token_store.dart';
import 'package:mocktail/mocktail.dart';

class _FakeStorage extends Mock implements FlutterSecureStorage {}

void main() {
  late _FakeStorage storage;
  late TokenStore store;
  final mem = <String, String>{};

  setUp(() {
    storage = _FakeStorage();
    mem.clear();
    when(() => storage.write(key: any(named: 'key'), value: any(named: 'value')))
        .thenAnswer((i) async => mem[i.namedArguments[#key]] = i.namedArguments[#value]);
    when(() => storage.read(key: any(named: 'key')))
        .thenAnswer((i) async => mem[i.namedArguments[#key]]);
    when(() => storage.delete(key: any(named: 'key')))
        .thenAnswer((i) async => mem.remove(i.namedArguments[#key]));
    store = TokenStore(storage);
  });

  test('saves and reads tokens', () async {
    await store.save(access: 'a1', refresh: 'r1');
    expect(await store.accessToken, 'a1');
    expect(await store.refreshToken, 'r1');
  });

  test('clear removes tokens', () async {
    await store.save(access: 'a1', refresh: 'r1');
    await store.clear();
    expect(await store.accessToken, isNull);
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && flutter test test/core/token_store_test.dart`
Expected: FAIL — `TokenStore` undefined.

- [ ] **Step 3: Implement TokenStore**

`mobile/lib/core/auth/token_store.dart`:
```dart
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class TokenStore {
  TokenStore(this._s);
  final FlutterSecureStorage _s;
  static const _kAccess = 'access_token';
  static const _kRefresh = 'refresh_token';

  Future<void> save({required String access, required String refresh}) async {
    await _s.write(key: _kAccess, value: access);
    await _s.write(key: _kRefresh, value: refresh);
  }

  Future<String?> get accessToken => _s.read(key: _kAccess);
  Future<String?> get refreshToken => _s.read(key: _kRefresh);

  Future<void> clear() async {
    await _s.delete(key: _kAccess);
    await _s.delete(key: _kRefresh);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && flutter test test/core/token_store_test.dart`
Expected: PASS.

- [ ] **Step 5: Implement DeviceIdentity**

`mobile/lib/core/auth/device_identity.dart`:
```dart
import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:device_info_plus/device_info_plus.dart';

class DeviceIdentity {
  DeviceIdentity(this._s);
  final FlutterSecureStorage _s;
  static const _kDeviceToken = 'device_token';

  Future<String> getOrCreateDeviceToken() async {
    final existing = await _s.read(key: _kDeviceToken);
    if (existing != null) return existing;
    // UUID v4 without an extra dependency.
    final r = DateTime.now().microsecondsSinceEpoch;
    final token = 'dev-${r.toRadixString(16)}-${identityHashCode(this).toRadixString(16)}';
    await _s.write(key: _kDeviceToken, value: token);
    return token;
  }

  Future<Map<String, dynamic>> deviceInfo() async {
    final info = DeviceInfoPlugin();
    String label = 'Mobile';
    final platform = Platform.isIOS ? 'ios' : 'android';
    if (Platform.isAndroid) {
      final a = await info.androidInfo;
      label = '${a.manufacturer} ${a.model}';
    } else if (Platform.isIOS) {
      final i = await info.iosInfo;
      label = '${i.name} (${i.model})';
    }
    final size = ui.window.physicalSize;
    return {
      'label': label,
      'platform': platform,
      'screen': '${size.width.toInt()}x${size.height.toInt()}',
      'timezone': DateTime.now().timeZoneName,
      'language': ui.window.locale.languageCode,
    };
  }
}
```

- [ ] **Step 6: Run analyze**

Run: `cd mobile && flutter analyze`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add mobile/lib/core/auth mobile/test/core/token_store_test.dart
git commit -m "feat(mobile): secure token store + stable device identity"
```

---

### Task 6: dio client + auth interceptor (auto-refresh on 401)

**Files:**
- Create: `mobile/lib/core/api/api_client.dart`, `mobile/lib/core/api/endpoints.dart`, `mobile/lib/core/error/api_failure.dart`
- Test: `mobile/test/core/auth_interceptor_test.dart`

**Interfaces:**
- Consumes: `TokenStore`, `AppConfig.apiPrefix`.
- Produces:
  - `Endpoints` constants (e.g. `Endpoints.login = '/auth/login'`, etc.).
  - `ApiClient` exposing `Dio dio`, built with base URL `AppConfig.apiPrefix`, an interceptor that adds `Authorization: Bearer <access>` and, on 401, calls `POST /auth/refresh` with `{refresh_token}`, stores new tokens, retries once; on refresh failure clears tokens and rethrows a `SessionExpired` failure. Constructor: `ApiClient(this.tokenStore, {Dio? dio, void Function()? onSessionExpired})`.
  - `ApiFailure` (message, statusCode, code) + `SessionExpired extends ApiFailure`.

- [ ] **Step 1: Write the failing test**

```dart
// mobile/test/core/auth_interceptor_test.dart
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:smartshape_sales/core/api/api_client.dart';
import 'package:smartshape_sales/core/auth/token_store.dart';
import 'package:smartshape_sales/core/api/endpoints.dart';
import 'package:mocktail/mocktail.dart';

class _MemTokenStore implements TokenStore {
  String? a = 'old-access', r = 'refresh-1';
  @override Future<String?> get accessToken async => a;
  @override Future<String?> get refreshToken async => r;
  @override Future<void> save({required String access, required String refresh}) async { a = access; r = refresh; }
  @override Future<void> clear() async { a = null; r = null; }
}

void main() {
  test('on 401 it refreshes, stores new token, and retries', () async {
    final dio = Dio(BaseOptions(baseUrl: 'http://test/api'));
    final store = _MemTokenStore();
    var protectedCalls = 0;

    final adapter = _StubAdapter((opts) {
      if (opts.path.endsWith(Endpoints.refresh)) {
        return _resp(opts, 200, {'access_token': 'new-access', 'refresh_token': 'refresh-2'});
      }
      if (opts.path.endsWith('/protected')) {
        protectedCalls++;
        final token = opts.headers['Authorization'];
        if (token == 'Bearer old-access') return _resp(opts, 401, {'detail': 'Token expired'});
        return _resp(opts, 200, {'ok': true});
      }
      return _resp(opts, 404, {});
    });
    dio.httpClientAdapter = adapter;

    final client = ApiClient(store, dio: dio);
    final res = await client.dio.get('/protected');
    expect(res.statusCode, 200);
    expect(await store.accessToken, 'new-access');
    expect(protectedCalls, 2); // first 401, then retry 200
  });
}

ResponseBody _bodyOf(Map m) => ResponseBody.fromString(
    '{"x":0}', 200); // placeholder, replaced by helper below
```

> Note: implement `_StubAdapter` and `_resp(...)` helpers at the bottom of the test using `HttpClientAdapter` returning `ResponseBody.fromString(jsonEncode(data), status)`. Keep them in the test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && flutter test test/core/auth_interceptor_test.dart`
Expected: FAIL — `ApiClient`/`Endpoints` undefined.

- [ ] **Step 3: Implement endpoints + failure types**

`mobile/lib/core/api/endpoints.dart`:
```dart
class Endpoints {
  static const login = '/auth/login';
  static const refresh = '/auth/refresh';
  static const logout = '/auth/logout';
  static const me = '/auth/me';
  static const attendanceToday = '/sales/attendance/today';
  static const attendanceCheckIn = '/sales/attendance/check-in';
  static const attendanceCheckOut = '/sales/attendance/check-out';
  static const visits = '/sales/visits';
  static const targetsProgress = '/sales/targets/progress';
  static const leads = '/leads';
  static const leadsSearch = '/leads/search';
  static const leadsNeedsAttention = '/leads/needs-attention';
  static const followups = '/followups';
  static const crmNotifications = '/crm/notifications';
  static const fcmRegister = '/push/fcm/register';
  static const fcmUnregister = '/push/fcm/unregister';
  static String leadNotes(String id) => '/leads/$id/notes';
  static String lead(String id) => '/leads/$id';
  static String crmNotifRead(String id) => '/crm/notifications/$id/read';
}
```

`mobile/lib/core/error/api_failure.dart`:
```dart
class ApiFailure implements Exception {
  ApiFailure(this.message, {this.statusCode, this.code});
  final String message;
  final int? statusCode;
  final String? code;
  @override String toString() => message;
}

class SessionExpired extends ApiFailure {
  SessionExpired() : super('Your session has expired. Please log in again.', statusCode: 401);
}
```

- [ ] **Step 4: Implement ApiClient**

`mobile/lib/core/api/api_client.dart`:
```dart
import 'package:dio/dio.dart';
import '../auth/token_store.dart';
import '../config/app_config.dart';
import '../error/api_failure.dart';
import 'endpoints.dart';

class ApiClient {
  ApiClient(this.tokenStore, {Dio? dio, this.onSessionExpired})
      : dio = dio ?? Dio() {
    this.dio.options.baseUrl = AppConfig.apiPrefix;
    this.dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) async {
        final t = await tokenStore.accessToken;
        if (t != null) options.headers['Authorization'] = 'Bearer $t';
        handler.next(options);
      },
      onError: (e, handler) async {
        final is401 = e.response?.statusCode == 401;
        final isRefreshCall = e.requestOptions.path.contains(Endpoints.refresh);
        if (is401 && !isRefreshCall) {
          try {
            final ok = await _refresh();
            if (ok) {
              final clone = await _retry(e.requestOptions);
              return handler.resolve(clone);
            }
          } catch (_) {/* fall through */}
          await tokenStore.clear();
          onSessionExpired?.call();
          return handler.reject(DioException(
            requestOptions: e.requestOptions, error: SessionExpired()));
        }
        handler.next(e);
      },
    ));
  }

  final TokenStore tokenStore;
  final Dio dio;
  final void Function()? onSessionExpired;

  Future<bool> _refresh() async {
    final rt = await tokenStore.refreshToken;
    if (rt == null) return false;
    final r = await dio.post(Endpoints.refresh, data: {'refresh_token': rt});
    final data = r.data as Map;
    if (data['access_token'] == null) return false;
    await tokenStore.save(
      access: data['access_token'], refresh: data['refresh_token']);
    return true;
  }

  Future<Response<dynamic>> _retry(RequestOptions o) async {
    final t = await tokenStore.accessToken;
    return dio.request(
      o.path,
      data: o.data,
      queryParameters: o.queryParameters,
      options: Options(method: o.method, headers: {...o.headers, 'Authorization': 'Bearer $t'}),
    );
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd mobile && flutter test test/core/auth_interceptor_test.dart`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add mobile/lib/core/api mobile/lib/core/error mobile/test/core/auth_interceptor_test.dart
git commit -m "feat(mobile): dio client with bearer auth + 401 auto-refresh"
```

---

### Task 7: Auth repository, state, and providers

**Files:**
- Create: `mobile/lib/features/login/data/auth_repository.dart`, `mobile/lib/core/auth/auth_state.dart`, `mobile/lib/core/auth/auth_providers.dart`, `mobile/lib/features/login/data/user_model.dart`
- Test: `mobile/test/features/auth_repository_test.dart`

**Interfaces:**
- Consumes: `ApiClient`, `TokenStore`, `DeviceIdentity`, `Endpoints`, `ApiFailure`.
- Produces:
  - `UserModel` (`email`, `name`, `role`, `assignedModules: List<String>`) with `fromJson`.
  - `AuthRepository` with `Future<UserModel> login(String email, String password)` (sends `{email, password, device_token, device_info}`, saves tokens, returns user; maps device/lockout errors to `ApiFailure` with `code`), `Future<void> logout()`, `Future<UserModel?> currentUser()`.
  - `authControllerProvider` (`StateNotifierProvider<AuthController, AuthState>`); `AuthState` = `{status: unknown|authenticated|unauthenticated, user, errorMessage, errorCode}`.

- [ ] **Step 1: Write the failing test**

```dart
// mobile/test/features/auth_repository_test.dart
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:smartshape_sales/features/login/data/auth_repository.dart';
import 'package:smartshape_sales/core/api/api_client.dart';
import 'package:smartshape_sales/core/error/api_failure.dart';
// reuse _MemTokenStore + stub adapter helpers (copy into this file)

void main() {
  test('login stores tokens and returns user', () async {
    // stub adapter: POST /auth/login -> 200 {access_token, refresh_token, email, name, role, assigned_modules}
    // build ApiClient + AuthRepository, call login, assert tokens saved + user.email correct
  });

  test('device pending maps to ApiFailure with code DEVICE_PENDING', () async {
    // stub adapter: POST /auth/login -> 403 {"detail":{"code":"DEVICE_PENDING","message":"..."}}
    // expect login throws ApiFailure with code == 'DEVICE_PENDING'
  });
}
```

> Fill the two test bodies with the same stub-adapter pattern from Task 6 (return the JSON described in the comments). Assert `await store.accessToken` is set and `user.email` matches; for the second, `expect(() => repo.login(...), throwsA(isA<ApiFailure>().having((e)=>e.code,'code','DEVICE_PENDING')))`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && flutter test test/features/auth_repository_test.dart`
Expected: FAIL — `AuthRepository` undefined.

- [ ] **Step 3: Implement UserModel**

`mobile/lib/features/login/data/user_model.dart`:
```dart
class UserModel {
  UserModel({required this.email, required this.name, required this.role, required this.assignedModules});
  final String email;
  final String name;
  final String role;
  final List<String> assignedModules;

  factory UserModel.fromJson(Map<String, dynamic> j) => UserModel(
        email: j['email'] ?? '',
        name: j['name'] ?? '',
        role: j['role'] ?? '',
        assignedModules: (j['assigned_modules'] as List?)?.map((e) => '$e').toList() ?? const [],
      );
}
```

- [ ] **Step 4: Implement AuthRepository**

`mobile/lib/features/login/data/auth_repository.dart`:
```dart
import 'package:dio/dio.dart';
import '../../../core/api/api_client.dart';
import '../../../core/api/endpoints.dart';
import '../../../core/auth/token_store.dart';
import '../../../core/auth/device_identity.dart';
import '../../../core/error/api_failure.dart';
import 'user_model.dart';

class AuthRepository {
  AuthRepository(this._api, this._tokens, this._device);
  final ApiClient _api;
  final TokenStore _tokens;
  final DeviceIdentity _device;

  Future<UserModel> login(String email, String password) async {
    try {
      final deviceToken = await _device.getOrCreateDeviceToken();
      final info = await _device.deviceInfo();
      final r = await _api.dio.post(Endpoints.login, data: {
        'email': email, 'password': password,
        'device_token': deviceToken, 'device_info': info,
      });
      final data = Map<String, dynamic>.from(r.data as Map);
      await _tokens.save(access: data['access_token'], refresh: data['refresh_token']);
      return UserModel.fromJson(data);
    } on DioException catch (e) {
      throw _mapError(e);
    }
  }

  Future<void> logout() async {
    try { await _api.dio.post(Endpoints.logout); } catch (_) {}
    await _tokens.clear();
  }

  Future<UserModel?> currentUser() async {
    if (await _tokens.accessToken == null) return null;
    try {
      final r = await _api.dio.get(Endpoints.me);
      return UserModel.fromJson(Map<String, dynamic>.from(r.data as Map));
    } catch (_) { return null; }
  }

  ApiFailure _mapError(DioException e) {
    final status = e.response?.statusCode;
    final detail = e.response?.data is Map ? (e.response!.data as Map)['detail'] : null;
    if (detail is Map) {
      return ApiFailure('${detail['message'] ?? 'Login failed'}',
          statusCode: status, code: '${detail['code'] ?? ''}');
    }
    final msg = detail is String ? detail
        : (status == 401 ? 'Invalid email or password' : 'Login failed. Please try again.');
    return ApiFailure(msg, statusCode: status);
  }
}
```

- [ ] **Step 5: Implement AuthState + providers**

`mobile/lib/core/auth/auth_state.dart`:
```dart
import '../../features/login/data/user_model.dart';

enum AuthStatus { unknown, authenticated, unauthenticated }

class AuthState {
  const AuthState({this.status = AuthStatus.unknown, this.user, this.errorMessage, this.errorCode});
  final AuthStatus status;
  final UserModel? user;
  final String? errorMessage;
  final String? errorCode;

  AuthState copyWith({AuthStatus? status, UserModel? user, String? errorMessage, String? errorCode}) =>
      AuthState(status: status ?? this.status, user: user ?? this.user,
                errorMessage: errorMessage, errorCode: errorCode);
}
```

`mobile/lib/core/auth/auth_providers.dart`:
```dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'auth_state.dart';
import 'token_store.dart';
import 'device_identity.dart';
import '../api/api_client.dart';
import '../../features/login/data/auth_repository.dart';

final secureStorageProvider = Provider((_) => const FlutterSecureStorage());
final tokenStoreProvider = Provider((ref) => TokenStore(ref.read(secureStorageProvider)));
final deviceIdentityProvider = Provider((ref) => DeviceIdentity(ref.read(secureStorageProvider)));
final apiClientProvider = Provider((ref) {
  final client = ApiClient(ref.read(tokenStoreProvider),
      onSessionExpired: () => ref.read(authControllerProvider.notifier).onSessionExpired());
  return client;
});
final authRepositoryProvider = Provider((ref) => AuthRepository(
    ref.read(apiClientProvider), ref.read(tokenStoreProvider), ref.read(deviceIdentityProvider)));

final authControllerProvider = StateNotifierProvider<AuthController, AuthState>(
    (ref) => AuthController(ref.read(authRepositoryProvider)));

class AuthController extends StateNotifier<AuthState> {
  AuthController(this._repo) : super(const AuthState());
  final AuthRepository _repo;

  Future<void> bootstrap() async {
    final user = await _repo.currentUser();
    state = AuthState(
        status: user == null ? AuthStatus.unauthenticated : AuthStatus.authenticated, user: user);
  }

  Future<bool> login(String email, String password) async {
    try {
      final user = await _repo.login(email, password);
      state = AuthState(status: AuthStatus.authenticated, user: user);
      return true;
    } on Object catch (e) {
      String code = '', msg = '$e';
      if (e is Exception && e.toString().isNotEmpty) msg = e.toString();
      // ApiFailure carries code/message
      try { final f = e as dynamic; code = f.code ?? ''; msg = f.message ?? msg; } catch (_) {}
      state = AuthState(status: AuthStatus.unauthenticated, errorMessage: msg, errorCode: code);
      return false;
    }
  }

  Future<void> logout() async {
    await _repo.logout();
    state = const AuthState(status: AuthStatus.unauthenticated);
  }

  void onSessionExpired() => state = const AuthState(status: AuthStatus.unauthenticated);
}
```

- [ ] **Step 6: Run tests + analyze**

Run: `cd mobile && flutter test test/features/auth_repository_test.dart && flutter analyze`
Expected: PASS + clean.

- [ ] **Step 7: Commit**

```bash
git add mobile/lib/features/login/data mobile/lib/core/auth mobile/test/features/auth_repository_test.dart
git commit -m "feat(mobile): auth repository, state, and riverpod providers"
```

---

### Task 8: Router with auth guard + app shell

**Files:**
- Create: `mobile/lib/core/router/app_router.dart`, `mobile/lib/features/dashboard/presentation/home_shell.dart`
- Modify: `mobile/lib/app.dart`, `mobile/lib/main.dart`
- Test: `mobile/test/core/router_redirect_test.dart`

**Interfaces:**
- Consumes: `authControllerProvider`, `AuthStatus`.
- Produces: `appRouterProvider` (`Provider<GoRouter>`) routing `/login`, `/dashboard`, `/leads`, `/attendance`, `/notifications`; redirect: unauthenticated → `/login`, authenticated on `/login` → `/dashboard`. `HomeShell` (bottom-nav scaffold hosting the 4 tabs).

- [ ] **Step 1: Write the failing test**

```dart
// mobile/test/core/router_redirect_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:smartshape_sales/core/auth/auth_state.dart';
import 'package:smartshape_sales/core/router/app_router.dart';

void main() {
  test('redirect sends unauthenticated to /login', () {
    expect(computeRedirect(AuthStatus.unauthenticated, '/dashboard'), '/login');
  });
  test('redirect sends authenticated away from /login', () {
    expect(computeRedirect(AuthStatus.authenticated, '/login'), '/dashboard');
  });
  test('redirect leaves valid authed route alone', () {
    expect(computeRedirect(AuthStatus.authenticated, '/leads'), isNull);
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && flutter test test/core/router_redirect_test.dart`
Expected: FAIL — `computeRedirect` undefined.

- [ ] **Step 3: Implement router (pure redirect fn + GoRouter)**

`mobile/lib/core/router/app_router.dart`:
```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../auth/auth_providers.dart';
import '../auth/auth_state.dart';
import '../../features/login/presentation/login_screen.dart';
import '../../features/dashboard/presentation/home_shell.dart';

String? computeRedirect(AuthStatus status, String location) {
  if (status == AuthStatus.unknown) return null;
  final loggingIn = location == '/login';
  if (status == AuthStatus.unauthenticated) return loggingIn ? null : '/login';
  if (loggingIn) return '/dashboard';
  return null;
}

final appRouterProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    initialLocation: '/dashboard',
    redirect: (context, state) =>
        computeRedirect(ref.read(authControllerProvider).status, state.matchedLocation),
    refreshListenable: _AuthListenable(ref),
    routes: [
      GoRoute(path: '/login', builder: (_, __) => const LoginScreen()),
      GoRoute(path: '/dashboard', builder: (_, __) => const HomeShell(tab: 0)),
      GoRoute(path: '/leads', builder: (_, __) => const HomeShell(tab: 1)),
      GoRoute(path: '/attendance', builder: (_, __) => const HomeShell(tab: 2)),
      GoRoute(path: '/notifications', builder: (_, __) => const HomeShell(tab: 3)),
    ],
  );
});

class _AuthListenable extends ChangeNotifier {
  _AuthListenable(Ref ref) {
    ref.listen(authControllerProvider, (_, __) => notifyListeners());
  }
}
```

`mobile/lib/features/dashboard/presentation/home_shell.dart` — a `StatefulWidget`/`ConsumerWidget` with a `BottomNavigationBar` (Dashboard, Leads, Attendance, Notifications) showing the corresponding screen for `tab`. (Stub the four bodies with `Center(child: Text(...))` for now; later tasks fill them.)

- [ ] **Step 4: Wire app.dart + main.dart**

Update `mobile/lib/app.dart` to a `ConsumerWidget` using `MaterialApp.router(routerConfig: ref.watch(appRouterProvider), theme: AppTheme.light)`. Update `main.dart` to call `await container bootstrap` — simplest: in `SmartShapeApp` build, trigger `ref.read(authControllerProvider.notifier).bootstrap()` once via a `useEffect`-style guard (or call bootstrap in `main()` before `runApp` using a `ProviderContainer`). Create the `LoginScreen` placeholder (`mobile/lib/features/login/presentation/login_screen.dart`) so imports resolve (filled in Task 9).

- [ ] **Step 5: Run test + analyze**

Run: `cd mobile && flutter test test/core/router_redirect_test.dart && flutter analyze`
Expected: PASS + clean.

- [ ] **Step 6: Commit**

```bash
git add mobile/lib/core/router mobile/lib/features/dashboard mobile/lib/app.dart mobile/lib/main.dart mobile/lib/features/login/presentation/login_screen.dart mobile/test/core/router_redirect_test.dart
git commit -m "feat(mobile): go_router with auth-guard redirect + home shell"
```

---

### Task 9: Login screen with error states

**Files:**
- Modify: `mobile/lib/features/login/presentation/login_screen.dart`
- Test: `mobile/test/features/login_screen_test.dart`

**Interfaces:**
- Consumes: `authControllerProvider`.
- Produces: `LoginScreen` — email + password fields, submit, loading spinner, and an error banner that renders `authState.errorMessage` (covers DEVICE_PENDING/REVOKED/LIMIT, 429 lockout, invalid creds).

- [ ] **Step 1: Write the failing widget test**

```dart
// mobile/test/features/login_screen_test.dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:smartshape_sales/features/login/presentation/login_screen.dart';
import 'package:smartshape_sales/core/auth/auth_providers.dart';
import 'package:smartshape_sales/core/auth/auth_state.dart';

void main() {
  testWidgets('shows validation error when fields empty', (tester) async {
    await tester.pumpWidget(const ProviderScope(
        child: MaterialApp(home: LoginScreen())));
    await tester.tap(find.byKey(const Key('login_submit')));
    await tester.pump();
    expect(find.text('Email is required'), findsOneWidget);
  });

  testWidgets('renders auth error banner', (tester) async {
    final container = ProviderContainer(overrides: [
      authControllerProvider.overrideWith((ref) =>
          _StubAuth(const AuthState(status: AuthStatus.unauthenticated, errorMessage: 'Account disabled'))),
    ]);
    await tester.pumpWidget(UncontrolledProviderScope(
        container: container, child: const MaterialApp(home: LoginScreen())));
    await tester.pump();
    expect(find.text('Account disabled'), findsOneWidget);
  });
}
// _StubAuth extends StateNotifier<AuthState> returning the given state.
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && flutter test test/features/login_screen_test.dart`
Expected: FAIL — placeholder LoginScreen has no fields.

- [ ] **Step 3: Implement LoginScreen**

Build a `ConsumerStatefulWidget` with a `Form`, email + password `TextFormField`s (validators: "Email is required", "Password is required"), a submit `ElevatedButton` with `key: Key('login_submit')` that calls `ref.read(authControllerProvider.notifier).login(...)`, a `CircularProgressIndicator` while awaiting, and a red banner (`Container` with `AppTheme.accent`) showing `errorMessage` when present. Brand the top with the navy color + "SmartShape Sales".

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && flutter test test/features/login_screen_test.dart`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/features/login/presentation/login_screen.dart mobile/test/features/login_screen_test.dart
git commit -m "feat(mobile): login screen with validation and error states"
```

---

## Milestone C — Feature screens

### Task 10: Dashboard screen

**Files:**
- Create: `mobile/lib/features/dashboard/data/dashboard_repository.dart`, `mobile/lib/features/dashboard/application/dashboard_providers.dart`, `mobile/lib/features/dashboard/presentation/dashboard_screen.dart`
- Modify: `mobile/lib/features/dashboard/presentation/home_shell.dart` (use real `DashboardScreen`)
- Test: `mobile/test/features/dashboard_repository_test.dart`

**Interfaces:**
- Consumes: `apiClientProvider`, `Endpoints`.
- Produces:
  - `DashboardRepository` with `Future<DashboardSummary> load()` calling `GET /sales/attendance/today`, `GET /sales/targets/progress`, `GET /leads/needs-attention`, `GET /followups` and combining results. Tolerates a null today-attendance (`GET` returns `null` when not checked in).
  - `DashboardSummary` (`attendanceToday: Map?`, `targetProgress: Map`, `needsAttentionCount: int`, `todayFollowups: List`).
  - `dashboardProvider` (`FutureProvider<DashboardSummary>`).

- [ ] **Step 1: Write the failing test**

```dart
// mobile/test/features/dashboard_repository_test.dart
// Stub adapter returns: attendance/today -> null; targets/progress -> {"achieved":3,"target":10};
// leads/needs-attention -> [ {...}, {...} ] (len 2); followups -> [ {...} ] (len 1).
// Assert summary.needsAttentionCount == 2 and summary.attendanceToday == null.
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && flutter test test/features/dashboard_repository_test.dart`
Expected: FAIL — `DashboardRepository` undefined.

- [ ] **Step 3: Implement repository**

```dart
// dashboard_repository.dart
import '../../../core/api/api_client.dart';
import '../../../core/api/endpoints.dart';

class DashboardSummary {
  DashboardSummary({this.attendanceToday, required this.targetProgress,
      required this.needsAttentionCount, required this.todayFollowups});
  final Map<String, dynamic>? attendanceToday;
  final Map<String, dynamic> targetProgress;
  final int needsAttentionCount;
  final List todayFollowups;
}

class DashboardRepository {
  DashboardRepository(this._api);
  final ApiClient _api;

  Future<DashboardSummary> load() async {
    final results = await Future.wait([
      _api.dio.get(Endpoints.attendanceToday),
      _api.dio.get(Endpoints.targetsProgress),
      _api.dio.get(Endpoints.leadsNeedsAttention),
      _api.dio.get(Endpoints.followups),
    ]);
    return DashboardSummary(
      attendanceToday: results[0].data is Map ? Map<String, dynamic>.from(results[0].data) : null,
      targetProgress: results[1].data is Map ? Map<String, dynamic>.from(results[1].data) : {},
      needsAttentionCount: results[2].data is List ? (results[2].data as List).length : 0,
      todayFollowups: results[3].data is List ? results[3].data as List : const [],
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && flutter test test/features/dashboard_repository_test.dart`
Expected: PASS.

- [ ] **Step 5: Implement provider + screen**

`dashboard_providers.dart`: `final dashboardRepositoryProvider = Provider((ref)=>DashboardRepository(ref.read(apiClientProvider)));` and `final dashboardProvider = FutureProvider((ref)=>ref.read(dashboardRepositoryProvider).load());`

`dashboard_screen.dart`: `ConsumerWidget` watching `dashboardProvider`; render `.when(data/loading/error)`. Cards: attendance status + Check-in/Check-out button (navigates to `/attendance`), target progress (achieved/target), needs-attention count, today's follow-ups list. Pull-to-refresh invalidates `dashboardProvider`.

- [ ] **Step 6: Wire into HomeShell + analyze**

Replace the dashboard stub in `home_shell.dart` with `DashboardScreen()`.
Run: `cd mobile && flutter analyze && flutter test`
Expected: clean + all pass.

- [ ] **Step 7: Commit**

```bash
git add mobile/lib/features/dashboard mobile/test/features/dashboard_repository_test.dart
git commit -m "feat(mobile): dashboard screen with attendance/targets/leads summary"
```

---

### Task 11: Attendance check-in/out with GPS

**Files:**
- Create: `mobile/lib/core/location/location_service.dart`, `mobile/lib/features/attendance/data/attendance_repository.dart`, `mobile/lib/features/attendance/application/attendance_providers.dart`, `mobile/lib/features/attendance/presentation/attendance_screen.dart`
- Test: `mobile/test/features/attendance_repository_test.dart`

**Interfaces:**
- Consumes: `apiClientProvider`, `Endpoints`, `geolocator`, `permission_handler`.
- Produces:
  - `LocationService.current()` → `Future<({double lat, double lng})>` (requests permission; throws `ApiFailure('Location permission denied')` if denied).
  - `AttendanceRepository`:
    - `Future<Map> checkIn({required String workType, double? lat, double? lng})` → `POST /sales/attendance/check-in` body `{work_type, lat, lng}`.
    - `Future<void> checkOut({required double lat, required double lng})` → `POST /sales/attendance/check-out?lat=<>&lng=<>` (**lat/lng are query params**, per backend signature).
    - `Future<Map?> today()` → `GET /sales/attendance/today`.

- [ ] **Step 1: Write the failing test**

```dart
// mobile/test/features/attendance_repository_test.dart
// Stub adapter:
//  - POST /sales/attendance/check-in : assert request body has work_type=='field', lat, lng -> return 200 {attendance_id:'att_1'}
//  - POST /sales/attendance/check-out : assert query has lat & lng -> 200 {"message":"Checked out successfully"}
// Assert checkIn returns map with attendance_id, and checkOut completes without throwing.
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && flutter test test/features/attendance_repository_test.dart`
Expected: FAIL — `AttendanceRepository` undefined.

- [ ] **Step 3: Implement repository**

```dart
// attendance_repository.dart
import '../../../core/api/api_client.dart';
import '../../../core/api/endpoints.dart';

class AttendanceRepository {
  AttendanceRepository(this._api);
  final ApiClient _api;

  Future<Map<String, dynamic>> checkIn({required String workType, double? lat, double? lng}) async {
    final r = await _api.dio.post(Endpoints.attendanceCheckIn,
        data: {'work_type': workType, 'lat': lat, 'lng': lng});
    return Map<String, dynamic>.from(r.data as Map);
  }

  Future<void> checkOut({required double lat, required double lng}) async {
    // Backend reads lat/lng from query params, not body.
    await _api.dio.post(Endpoints.attendanceCheckOut, queryParameters: {'lat': lat, 'lng': lng});
  }

  Future<Map<String, dynamic>?> today() async {
    final r = await _api.dio.get(Endpoints.attendanceToday);
    return r.data is Map ? Map<String, dynamic>.from(r.data) : null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && flutter test test/features/attendance_repository_test.dart`
Expected: PASS.

- [ ] **Step 5: Implement LocationService + screen + platform permissions**

`location_service.dart`: use `Geolocator.checkPermission/requestPermission`; on denied throw `ApiFailure`; else return `Geolocator.getCurrentPosition()`.

`attendance_screen.dart`: shows today's status; buttons "Check in (Office)", "Check in (Field)", "Check in (WFH)", and "Check out". Field/office fetch GPS via `LocationService`; WFH sends null lat/lng. After action, invalidate `dashboardProvider` and re-fetch `today()`. Surface backend `geofence_warning` if present.

Add platform permission strings:
- `mobile/android/app/src/main/AndroidManifest.xml`: `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `INTERNET`.
- `mobile/ios/Runner/Info.plist`: `NSLocationWhenInUseUsageDescription`.

- [ ] **Step 6: Wire into HomeShell + analyze + test**

Replace attendance stub in `home_shell.dart`.
Run: `cd mobile && flutter analyze && flutter test`
Expected: clean + all pass.

- [ ] **Step 7: Commit**

```bash
git add mobile/lib/core/location mobile/lib/features/attendance mobile/android mobile/ios mobile/test/features/attendance_repository_test.dart
git commit -m "feat(mobile): GPS attendance check-in/out with geofence warning"
```

---

### Task 12: Field visit logging

**Files:**
- Create: `mobile/lib/features/attendance/data/visit_repository.dart`, `mobile/lib/features/attendance/presentation/field_visit_sheet.dart`
- Modify: `mobile/lib/features/attendance/presentation/attendance_screen.dart` (add "Log field visit")
- Test: `mobile/test/features/visit_repository_test.dart`

**Interfaces:**
- Consumes: `apiClientProvider`, `Endpoints.visits`, `LocationService`.
- Produces: `VisitRepository.createVisit({required String schoolId, String? leadId, required double lat, required double lng, String notes})` → `POST /sales/visits`; `VisitRepository.listVisits()` → `GET /sales/visits`. (Confirm `POST /sales/visits` body fields against `FieldVisitCreate` in `field_routes.py` before implementing — use `school_id`, `lead_id`, `lat`, `lng`, `notes`.)

- [ ] **Step 1: Confirm the backend visit model**

Run: `grep -n "class FieldVisitCreate" -A 12 backend/routes/field_routes.py`
Use the actual field names in the request body.

- [ ] **Step 2: Write the failing test**

```dart
// mobile/test/features/visit_repository_test.dart
// Stub adapter: POST /sales/visits -> assert body has school_id + lat/lng -> 200 {visit_id:'v_1'}
// Assert createVisit returns a map with visit_id.
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd mobile && flutter test test/features/visit_repository_test.dart`
Expected: FAIL.

- [ ] **Step 4: Implement repository + UI sheet**

`visit_repository.dart` posts the confirmed body shape. `field_visit_sheet.dart` is a modal bottom sheet: pick school/lead (reuse a lead search call `GET /leads/search?q=`), capture GPS, optional notes, submit. On success show a snackbar.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd mobile && flutter test test/features/visit_repository_test.dart`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add mobile/lib/features/attendance mobile/test/features/visit_repository_test.dart
git commit -m "feat(mobile): field visit logging with GPS + school picker"
```

---

### Task 13: Leads list + search

**Files:**
- Create: `mobile/lib/features/leads/data/lead_model.dart`, `mobile/lib/features/leads/data/leads_repository.dart`, `mobile/lib/features/leads/application/leads_providers.dart`, `mobile/lib/features/leads/presentation/leads_list_screen.dart`
- Modify: `mobile/lib/features/dashboard/presentation/home_shell.dart`
- Test: `mobile/test/features/leads_repository_test.dart`

**Interfaces:**
- Consumes: `apiClientProvider`, `Endpoints`.
- Produces:
  - `LeadModel` (`leadId`, `companyName`, `contactName`, `contactPhone`, `stage`, `schoolName`) `fromJson` (handle `lead_id`, `company_name` fallback to `school_name`, `contact_phone`, `stage`).
  - `LeadsRepository.list()` → `GET /leads`; `LeadsRepository.search(String q)` → `GET /leads/search?q=` returning `List<LeadModel>` from `{leads: [...]}`.
  - `leadsListProvider` (`FutureProvider<List<LeadModel>>`).

- [ ] **Step 1: Write the failing test**

```dart
// mobile/test/features/leads_repository_test.dart
// Stub: GET /leads -> [ {lead_id:'l1', company_name:'ABC School', contact_phone:'9..', stage:'New'} ]
// Assert list().first.companyName == 'ABC School' and contactPhone == '9..'.
// Stub: GET /leads/search?q=ab -> {leads:[{lead_id:'l1', school_name:'ABC'}]}
// Assert search('ab').first.companyName == 'ABC' (falls back to school_name).
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && flutter test test/features/leads_repository_test.dart`
Expected: FAIL.

- [ ] **Step 3: Implement model + repository**

```dart
// lead_model.dart
class LeadModel {
  LeadModel({required this.leadId, required this.companyName, required this.contactName,
      required this.contactPhone, required this.stage, required this.schoolName});
  final String leadId, companyName, contactName, contactPhone, stage, schoolName;
  factory LeadModel.fromJson(Map<String, dynamic> j) {
    final school = j['school_name'] ?? '';
    return LeadModel(
      leadId: j['lead_id'] ?? '',
      companyName: (j['company_name'] ?? '').toString().isNotEmpty ? j['company_name'] : school,
      contactName: j['contact_name'] ?? '',
      contactPhone: j['contact_phone'] ?? '',
      stage: j['stage'] ?? '',
      schoolName: school,
    );
  }
}
```

```dart
// leads_repository.dart
import '../../../core/api/api_client.dart';
import '../../../core/api/endpoints.dart';
import 'lead_model.dart';

class LeadsRepository {
  LeadsRepository(this._api);
  final ApiClient _api;

  Future<List<LeadModel>> list() async {
    final r = await _api.dio.get(Endpoints.leads);
    final items = r.data is List ? r.data as List : const [];
    return items.map((e) => LeadModel.fromJson(Map<String, dynamic>.from(e))).toList();
  }

  Future<List<LeadModel>> search(String q) async {
    final r = await _api.dio.get(Endpoints.leadsSearch, queryParameters: {'q': q});
    final items = (r.data is Map ? (r.data['leads'] as List?) : null) ?? const [];
    return items.map((e) => LeadModel.fromJson(Map<String, dynamic>.from(e))).toList();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && flutter test test/features/leads_repository_test.dart`
Expected: PASS.

- [ ] **Step 5: Implement providers + list screen**

`leads_providers.dart`: repo provider + `leadsListProvider`. `leads_list_screen.dart`: search box (debounced → `search`), `ListView` of leads (company, phone, stage chip), tap → lead detail route (Task 14), FAB → add lead (Task 14). Pull-to-refresh.

- [ ] **Step 6: Wire HomeShell + analyze + test**

Run: `cd mobile && flutter analyze && flutter test`
Expected: clean + pass.

- [ ] **Step 7: Commit**

```bash
git add mobile/lib/features/leads mobile/test/features/leads_repository_test.dart mobile/lib/features/dashboard/presentation/home_shell.dart
git commit -m "feat(mobile): leads list with search"
```

---

### Task 14: Add lead, lead detail, status update, notes, follow-up, tap-to-call

**Files:**
- Modify: `mobile/lib/features/leads/data/leads_repository.dart` (add create/update/notes/followup)
- Create: `mobile/lib/features/leads/presentation/add_lead_screen.dart`, `mobile/lib/features/leads/presentation/lead_detail_screen.dart`, `mobile/lib/core/util/dialer.dart`
- Modify: `mobile/lib/core/router/app_router.dart` (routes `/leads/add`, `/leads/:id`)
- Test: `mobile/test/features/leads_mutations_test.dart`

**Interfaces:**
- Consumes: `Endpoints.leads`, `Endpoints.lead(id)`, `Endpoints.leadNotes(id)`, `Endpoints.followups`, `url_launcher`.
- Produces (on `LeadsRepository`):
  - `Future<String> create({required String contactName, required String contactPhone, String? schoolId, Map<String,dynamic>? newSchool})` → `POST /leads`, returns new `lead_id`.
  - `Future<void> updateStage(String leadId, String stage)` → `PUT /leads/{id}` body `{stage}`.
  - `Future<List> notes(String leadId)` → `GET /leads/{id}/notes`; `Future<void> addNote(String leadId, String text)` → `POST /leads/{id}/notes` body `{note: text}` (confirm body key against backend).
  - `Future<void> addFollowup({required String leadId, required String date, String time, String type, String notes})` → `POST /followups` body `{lead_id, followup_date, followup_time, followup_type, notes}`.
  - `Dialer.call(String phone)` → launches `tel:` URI.

- [ ] **Step 1: Confirm backend bodies**

Run: `grep -n "@router.post(\"/leads/{lead_id}/notes\")" -A 15 backend/routes/crm_routes.py`
Confirm the note body key (use that exact key). Follow-up body keys are already known (Task source): `followup_date`, `followup_time`, `followup_type`, `notes`, `lead_id`.

- [ ] **Step 2: Write the failing test**

```dart
// mobile/test/features/leads_mutations_test.dart
// Stub adapter:
//  POST /leads -> assert body has contact_name + contact_phone -> 200 {lead_id:'l9'}
//  PUT /leads/l9 -> assert body {stage:'Qualified'} -> 200 {lead_id:'l9', stage:'Qualified'}
//  POST /followups -> assert body has lead_id + followup_date -> 200 {followup_id:'fu_1'}
// Assert create returns 'l9'; updateStage + addFollowup complete without throwing.
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd mobile && flutter test test/features/leads_mutations_test.dart`
Expected: FAIL.

- [ ] **Step 4: Implement repository methods**

```dart
// add to LeadsRepository
Future<String> create({required String contactName, required String contactPhone,
    String? schoolId, Map<String, dynamic>? newSchool}) async {
  final body = <String, dynamic>{'contact_name': contactName, 'contact_phone': contactPhone};
  if (schoolId != null) body['school_id'] = schoolId;
  if (newSchool != null) body['new_school'] = newSchool;
  final r = await _api.dio.post(Endpoints.leads, data: body);
  return (r.data as Map)['lead_id'] as String;
}

Future<void> updateStage(String leadId, String stage) =>
    _api.dio.put(Endpoints.lead(leadId), data: {'stage': stage});

Future<List> notes(String leadId) async {
  final r = await _api.dio.get(Endpoints.leadNotes(leadId));
  return r.data is List ? r.data as List : const [];
}

Future<void> addNote(String leadId, String text) =>
    _api.dio.post(Endpoints.leadNotes(leadId), data: {'note': text}); // confirm key in Step 1

Future<void> addFollowup({required String leadId, required String date,
    String time = '', String type = 'call', String notes = ''}) =>
    _api.dio.post(Endpoints.followups, data: {
      'lead_id': leadId, 'followup_date': date, 'followup_time': time,
      'followup_type': type, 'notes': notes,
    });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd mobile && flutter test test/features/leads_mutations_test.dart`
Expected: PASS.

- [ ] **Step 6: Implement dialer + screens + routes**

`dialer.dart`: `launchUrl(Uri.parse('tel:$phone'))`. `add_lead_screen.dart`: form (contact name, phone, school search OR new-school fields), submit → `create` → pop + refresh list. `lead_detail_screen.dart`: shows lead, a stage dropdown (`updateStage`), a "Call" button (`Dialer.call`) that on return shows a "Log this call?" dialog (adds a note + optional follow-up), notes list (`notes`/`addNote`), "Add follow-up" action. Add `/leads/add` and `/leads/:id` routes.

- [ ] **Step 7: Run analyze + full test**

Run: `cd mobile && flutter analyze && flutter test`
Expected: clean + all pass.

- [ ] **Step 8: Commit**

```bash
git add mobile/lib/features/leads mobile/lib/core/util/dialer.dart mobile/lib/core/router/app_router.dart mobile/test/features/leads_mutations_test.dart
git commit -m "feat(mobile): add lead, detail, stage update, notes, follow-up, tap-to-call"
```

---

### Task 15: In-app notifications screen

**Files:**
- Create: `mobile/lib/features/notifications/data/notifications_repository.dart`, `mobile/lib/features/notifications/application/notifications_providers.dart`, `mobile/lib/features/notifications/presentation/notifications_screen.dart`
- Modify: `mobile/lib/features/dashboard/presentation/home_shell.dart`
- Test: `mobile/test/features/notifications_repository_test.dart`

**Interfaces:**
- Consumes: `apiClientProvider`, `Endpoints.crmNotifications`, `Endpoints.crmNotifRead(id)`.
- Produces: `NotificationsRepository.list()` → `GET /crm/notifications`; `markRead(String id)` → `POST /crm/notifications/{id}/read`; `markAllRead()` → `POST /crm/notifications/read-all`. `notificationsProvider` (`FutureProvider<List>`).

- [ ] **Step 1: Write the failing test**

```dart
// mobile/test/features/notifications_repository_test.dart
// Stub: GET /crm/notifications -> [ {notif_id:'n1', title:'New lead', is_read:false} ]
// Assert list().length == 1; POST /crm/notifications/n1/read -> 200 {} ; markRead completes.
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && flutter test test/features/notifications_repository_test.dart`
Expected: FAIL.

- [ ] **Step 3: Implement repository**

```dart
import '../../../core/api/api_client.dart';
import '../../../core/api/endpoints.dart';

class NotificationsRepository {
  NotificationsRepository(this._api);
  final ApiClient _api;
  Future<List> list() async {
    final r = await _api.dio.get(Endpoints.crmNotifications);
    return r.data is List ? r.data as List : const [];
  }
  Future<void> markRead(String id) => _api.dio.post(Endpoints.crmNotifRead(id));
  Future<void> markAllRead() => _api.dio.post('${Endpoints.crmNotifications}/read-all');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && flutter test test/features/notifications_repository_test.dart`
Expected: PASS.

- [ ] **Step 5: Implement provider + screen + wire HomeShell**

`notifications_screen.dart`: list with read/unread styling, tap → mark read + deep-link to entity if `lead_id` present, "Mark all read" app-bar action. Wire into `home_shell.dart` tab 3.

- [ ] **Step 6: Analyze + test + commit**

```bash
cd mobile && flutter analyze && flutter test
git add mobile/lib/features/notifications mobile/test/features/notifications_repository_test.dart mobile/lib/features/dashboard/presentation/home_shell.dart
git commit -m "feat(mobile): in-app notifications screen"
```

---

## Milestone D — Push notifications (FCM)

### Task 16: Firebase project + platform config

**Files:**
- Create: `mobile/android/app/google-services.json` (gitignored), `mobile/ios/Runner/GoogleService-Info.plist` (gitignored), `mobile/lib/firebase_options.dart` (via FlutterFire CLI)
- Modify: `mobile/android/build.gradle`, `mobile/android/app/build.gradle` (google-services plugin), `mobile/.gitignore`, `mobile/README.md`

**Interfaces:**
- Produces: a configured Firebase project usable by `firebase_core` on both platforms; `DefaultFirebaseOptions` available to `Firebase.initializeApp`.

- [ ] **Step 1: Create Firebase project + register apps**

Create a free Firebase project (console). Register Android app id `in.smartshape.smartshape_sales` and iOS bundle id matching `mobile/ios`. Download `google-services.json` → `mobile/android/app/`, `GoogleService-Info.plist` → `mobile/ios/Runner/`.

- [ ] **Step 2: Run FlutterFire configure**

Run: `cd mobile && dart pub global activate flutterfire_cli && flutterfire configure`
Expected: generates `lib/firebase_options.dart`.

- [ ] **Step 3: Add Android Gradle plugin**

In `mobile/android/build.gradle` add `classpath 'com.google.gms:google-services:4.4.2'`; in `mobile/android/app/build.gradle` add `apply plugin: 'com.google.gms.google-services'` (or the declarative `plugins {}` equivalent). Set `minSdkVersion 21` minimum.

- [ ] **Step 4: Gitignore secrets**

Append to `mobile/.gitignore`:
```
android/app/google-services.json
ios/Runner/GoogleService-Info.plist
```

- [ ] **Step 5: Verify build**

Run: `cd mobile && flutter build apk --debug --dart-define=API_BASE_URL=http://10.0.2.2:8000`
Expected: builds successfully.

- [ ] **Step 6: Commit (config only, not secrets)**

```bash
git add mobile/android mobile/ios mobile/.gitignore mobile/lib/firebase_options.dart mobile/README.md
git commit -m "chore(mobile): firebase platform config (secrets gitignored)"
```

---

### Task 17: FCM client integration — token registration, handlers, local notifications

**Files:**
- Create: `mobile/lib/core/push/push_service.dart`, `mobile/lib/core/push/push_providers.dart`
- Modify: `mobile/lib/main.dart` (Firebase init + background handler), `mobile/lib/core/auth/auth_providers.dart` (register token on login, unregister on logout), `mobile/lib/features/login/data/auth_repository.dart` (unregister hook)
- Test: `mobile/test/core/push_service_test.dart`

**Interfaces:**
- Consumes: `firebase_messaging`, `flutter_local_notifications`, `ApiClient`, `Endpoints.fcmRegister`, `Endpoints.fcmUnregister`.
- Produces:
  - `PushService` with `Future<void> init()` (request permission, set up foreground + tap handlers, render foreground messages via local notifications), `Future<void> registerToken()` (get FCM token, `POST /push/fcm/register {fcm_token, platform}`), `Future<void> unregisterToken()` (`DELETE /push/fcm/unregister`). Constructor injects `ApiClient` + `FirebaseMessaging` (mockable).
  - A top-level `firebaseMessagingBackgroundHandler` in `main.dart`.

- [ ] **Step 1: Write the failing test (token registration body)**

```dart
// mobile/test/core/push_service_test.dart
// Inject a fake FirebaseMessaging returning getToken()=>'fcm-xyz' and a stub dio adapter.
// Stub: POST /push/fcm/register -> assert body {fcm_token:'fcm-xyz', platform: <ios|android>} -> 200 {ok:true}
// Call pushService.registerToken(); assert the register endpoint was hit with the token.
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && flutter test test/core/push_service_test.dart`
Expected: FAIL — `PushService` undefined.

- [ ] **Step 3: Implement PushService**

```dart
// push_service.dart
import 'dart:io';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import '../api/api_client.dart';
import '../api/endpoints.dart';

class PushService {
  PushService(this._api, {FirebaseMessaging? messaging, FlutterLocalNotificationsPlugin? local})
      : _fm = messaging ?? FirebaseMessaging.instance,
        _local = local ?? FlutterLocalNotificationsPlugin();
  final ApiClient _api;
  final FirebaseMessaging _fm;
  final FlutterLocalNotificationsPlugin _local;

  Future<void> init() async {
    await _fm.requestPermission();
    const android = AndroidInitializationSettings('@mipmap/ic_launcher');
    const ios = DarwinInitializationSettings();
    await _local.initialize(const InitializationSettings(android: android, iOS: ios));
    FirebaseMessaging.onMessage.listen(_showForeground);
  }

  Future<void> _showForeground(RemoteMessage m) async {
    final n = m.notification;
    if (n == null) return;
    const details = NotificationDetails(
      android: AndroidNotificationDetails('default', 'General', importance: Importance.high),
      iOS: DarwinNotificationDetails(),
    );
    await _local.show(n.hashCode, n.title, n.body, details);
  }

  Future<void> registerToken() async {
    final token = await _fm.getToken();
    if (token == null) return;
    await _api.dio.post(Endpoints.fcmRegister,
        data: {'fcm_token': token, 'platform': Platform.isIOS ? 'ios' : 'android'});
  }

  Future<void> unregisterToken() async {
    final token = await _fm.getToken();
    if (token == null) return;
    await _api.dio.delete(Endpoints.fcmUnregister, data: {'fcm_token': token});
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && flutter test test/core/push_service_test.dart`
Expected: PASS.

- [ ] **Step 5: Wire Firebase init + background handler in main.dart**

```dart
// main.dart additions
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'firebase_options.dart';

@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  // No-op: the OS displays the notification tray entry for data+notification messages.
}

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
  FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);
  runApp(const ProviderScope(child: SmartShapeApp()));
}
```

- [ ] **Step 6: Register on login, unregister on logout**

Add `pushServiceProvider` to `push_providers.dart`. In `AuthController.login` success path call `ref`-resolved `PushService.init()` + `registerToken()`; in `logout` call `unregisterToken()` before clearing. (Pass `Ref` into `AuthController` or expose a callback; keep token registration best-effort — wrap in try/catch so push failures never block auth.)

- [ ] **Step 7: Add iOS push capability + APNs note**

In Xcode enable Push Notifications + Background Modes (Remote notifications) for `Runner`. Document in `mobile/README.md` that real iOS delivery needs an APNs auth key uploaded to Firebase (Apple Developer account).

- [ ] **Step 8: Backend env note**

Document in `mobile/README.md` (and `backend` deploy notes): set `FCM_SERVICE_ACCOUNT_JSON` on the server to enable `send_fcm_to_user`.

- [ ] **Step 9: Analyze + test + commit**

```bash
cd mobile && flutter analyze && flutter test
git add mobile/lib/core/push mobile/lib/main.dart mobile/lib/core/auth/auth_providers.dart mobile/lib/features/login/data/auth_repository.dart mobile/test/core/push_service_test.dart mobile/README.md
git commit -m "feat(mobile): FCM client — register token, foreground + background handlers"
```

---

## Milestone E — End-to-end verification

### Task 18: Manual smoke test against staging

**Files:** none (manual). Record results in `mobile/README.md` under "Verified".

- [ ] **Step 1: Run the app against the real backend**

Run: `cd mobile && flutter run --dart-define=API_BASE_URL=http://<LAN-IP>:8000` (or staging HTTPS URL).

- [ ] **Step 2: Execute the smoke checklist** (check each):
- [ ] Login with a real sales account succeeds; invalid password shows the error banner.
- [ ] Dashboard loads attendance/targets/needs-attention/follow-ups without crashing on empty data.
- [ ] Check-in (Field) captures GPS and succeeds; check-out succeeds; geofence warning surfaces if applicable.
- [ ] Log a field visit against a searched school.
- [ ] Leads list loads + search works; add a lead; open detail; change stage; tap-to-call; add a note + follow-up.
- [ ] Notifications list loads; mark read works.
- [ ] Receive a push (trigger via an existing notification event or a temporary `send_fcm_to_user` call) with the app foregrounded, backgrounded, and closed.
- [ ] Logout clears session and returns to login; token no longer works.

- [ ] **Step 3: Record results + commit**

```bash
git add mobile/README.md
git commit -m "docs(mobile): record Phase 1 smoke-test verification"
```

---

## Plan self-review

**Spec coverage:**
- §4 Auth → Tasks 1, 5–9, 17 (logout/unregister). ✓
- §5.2 Dashboard → Task 10. ✓
- §5.3 Attendance & field visit → Tasks 11, 12. ✓
- §5.4 Leads (list/add/detail/status/call/follow-up) → Tasks 13, 14. ✓
- §5.5 Notifications (in-app) → Task 15; (push) → Tasks 16, 17. ✓
- §6.1 JWT in body → Task 1. ✓ §6.2 FCM register → Task 2. ✓ §6.3 FCM send + wiring → Task 3. ✓
- §7 error handling/config/security → Tasks 4, 6, 9. ✓
- §8 Firebase setup → Task 16. ✓ §9 testing → per-task TDD + Task 18. ✓

**Placeholder scan:** UI-only screens (login layout, dashboard cards, list/detail screens) are described with exact widgets/keys/endpoints rather than full pixel-level code, which is appropriate; all data/logic layers have complete code + tests. Two backend body shapes (lead note key, `FieldVisitCreate`) are explicitly gated behind a "confirm via grep" step before coding, not left vague.

**Type consistency:** `ApiClient.dio`, `TokenStore` (`save/accessToken/refreshToken/clear`), `Endpoints.*`, `AuthRepository.login/logout/currentUser`, `LeadModel.fromJson`, repository method names are referenced identically across tasks. Attendance check-out uses query params consistently (Task 11) matching the backend signature.

**Open items carried from spec:** API base URL/`/api` confirmed (`/api` verified in `main.py`); iOS APNs requires Apple Developer account (flagged in Tasks 16–17); backend tests must stay read-only (Global Constraints + Task 1–3 notes).
