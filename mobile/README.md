# SmartShape Sales — Mobile App (Flutter)

Native iOS + Android app for the SmartShape sales team. Talks to the existing
FastAPI backend (`/api`) using Bearer-token auth.

**Phase 1 features:** login (device-trust + lockout aware) · dashboard ·
GPS attendance (office/field/WFH) · field-visit logging · leads
(list/search/add/detail/stage/notes/follow-up/tap-to-call) · in-app
notifications · FCM push.

---

## 1. Prerequisites (one-time machine setup)

This repo currently has **no Flutter toolchain installed**. Install:

1. **Flutter SDK** (stable) — https://docs.flutter.dev/get-started/install
   Add `flutter/bin` to PATH; run `flutter doctor` until green.
2. **JDK 17+** (Android Gradle needs it; the machine currently has Java 8).
3. **Android Studio** (Android SDK + an emulator) and/or **Xcode** (iOS, macOS only).

## 2. Bootstrap the project

The `lib/`, `test/`, and `pubspec.yaml` are committed. Generate the native
iOS/Android folders (not committed) and fetch packages:

```bash
cd mobile
# Generates android/ + ios/ around the existing lib/ (keeps your Dart code):
flutter create . --org in.smartshape --project-name smartshape_sales --platforms ios,android
flutter pub get
```

Then re-apply the platform bits below (they live in generated files):

- **Android** `android/app/src/main/AndroidManifest.xml` — add inside `<manifest>`:
  ```xml
  <uses-permission android:name="android.permission.INTERNET"/>
  <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"/>
  <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION"/>
  <uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>
  ```
  Set `minSdkVersion 21` (or higher) in `android/app/build.gradle`.
- **iOS** `ios/Runner/Info.plist` — add:
  ```xml
  <key>NSLocationWhenInUseUsageDescription</key>
  <string>Used to record your attendance and field visits.</string>
  ```

## 3. Run

```bash
# Android emulator reaches your host backend at 10.0.2.2:
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:8000

# Physical device on the same Wi‑Fi — use your machine's LAN IP:
flutter run --dart-define=API_BASE_URL=http://192.168.1.50:8000

# Production:
flutter run --dart-define=API_BASE_URL=https://app.smartshape.in
```

`API_BASE_URL` is the host only — the app appends `/api`.

## 4. Tests

```bash
cd mobile
flutter analyze
flutter test
```

Unit/widget tests cover the token store, the dio auth interceptor (401 →
refresh → retry), and the leads / attendance / dashboard repositories using a
stubbed HTTP adapter (no network).

## 5. Firebase / push setup (FCM)

Push is optional — the app runs without it (login/attendance/leads all work);
`main.dart` skips Firebase init until configured.

1. Create a free Firebase project; register the Android app id
   `in.smartshape.smartshape_sales` and the iOS bundle id.
2. Install the CLI and configure:
   ```bash
   dart pub global activate flutterfire_cli
   cd mobile && flutterfire configure
   ```
   This **overwrites** the placeholder `lib/firebase_options.dart` and drops
   `google-services.json` / `GoogleService-Info.plist` into the platform folders
   (both are git-ignored).
3. **Android:** add the Google services Gradle plugin
   (`com.google.gms:google-services`) per FlutterFire docs.
4. **iOS:** in Xcode enable *Push Notifications* + *Background Modes → Remote
   notifications*. Real delivery needs an **APNs auth key** uploaded to Firebase
   (requires an Apple Developer account).
5. **Backend:** set `FCM_SERVICE_ACCOUNT_JSON` on the server (path to, or the raw
   JSON of, a Firebase service-account key). Then `send_fcm_to_user` /
   `notify_user` deliver to devices. Test endpoint: `POST /api/push/fcm/test`.

## 6. Architecture

- **State:** Riverpod. **HTTP:** dio with a Bearer interceptor that refreshes on
  401 and retries once. **Nav:** go_router with an auth-guard redirect.
  **Storage:** flutter_secure_storage (JWTs + device token).
- **Layout:** `lib/core/**` (config, api, auth, push, location, router, theme)
  and `lib/features/<feature>/{data,application,presentation}`.

## 7. Verified

On **Flutter 3.44.4 / Dart 3.12.2** (Windows, JDK 17, Android SDK 35+36):

- `flutter analyze` → **No issues found**
- `flutter test` → **16/16 passing**
- `flutter build web` → **success**
- `flutter build apk --debug` → **success** (`build/app/outputs/flutter-apk/app-debug.apk`, ~151 MB debug)

### Toolchain on this machine
Flutter is at `C:\flutter`, Android SDK at `C:\Android` (`ANDROID_HOME`), JDK 17 at
`C:\Program Files\Microsoft\jdk-17.0.19.10-hotspot` (`JAVA_HOME`). All added to the
user PATH. `flutter doctor`: Android toolchain ✓, Chrome ✓ (Visual Studio C++ is the
only red item — irrelevant unless you build the Windows desktop target).

### Android build notes (already applied in `android/`)
This box has ~8 GB RAM, so `android/gradle.properties` caps the Gradle heap at
`-Xmx1536m` (the default 8 GB OOM-crashes the daemon) and sets `kotlin.incremental=false`
(a Windows incremental-cache file-lock under a path containing spaces). `app/build.gradle.kts`
enables core-library desugaring (required by `flutter_local_notifications`).

> Still pending: the manual on-device smoke checklist in
> `docs/superpowers/plans/2026-06-28-flutter-sales-mobile-app-phase1.md` (Task 18) —
> needs a running backend + a device/emulator.
