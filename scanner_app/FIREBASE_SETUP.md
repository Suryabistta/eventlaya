# Firebase Cloud Messaging (FCM) Setup for Eventlaya Scanner

The scanner app is architected with complete push notification support for:
- 🎯 **Capacity Milestones**: Real-time push alerts to organizers and gate staff when venue reaches 50%, 80%, and 100% (Full).
- ⚠️ **Duplicate Scan Detection**: Instant security alert when a ticket is re-scanned at any gate while marked checked in.
- 📢 **Admin Announcements**: Broadcast messages from event organizers to stationed gate staff.

---

## 1. Firebase Console Project
1. Navigate to [console.firebase.google.com](https://console.firebase.google.com/).
2. Create or select project: `eventlaya-mobile` (or your existing project).

---

## 2. Android App Configuration
1. In Firebase Project Overview, click **Add App** → **Android**.
2. **Android package name**: `com.eventlaya.eventlaya_scanner` (must match `namespace` in `android/app/build.gradle.kts`).
3. App nickname: `Eventlaya Scanner`.
4. Download `google-services.json`.
5. Move the downloaded file to:
   ```bash
   scanner_app/android/app/google-services.json
   ```

---

## 3. iOS Configuration (Optional for iOS builds)
1. In Firebase Console, click **Add App** → **iOS**.
2. **Bundle ID**: `com.eventlaya.eventlayaScanner`.
3. Download `GoogleService-Info.plist`.
4. Move the file to:
   ```bash
   scanner_app/ios/Runner/GoogleService-Info.plist
   ```

---

## 4. Backend Service Account Setup (Django)
1. In Firebase Console → **Project Settings** → **Service accounts**.
2. Click **Generate new private key** (downloads a `.json` file).
3. Place this JSON file on your backend server or set the path in environment:
   ```bash
   export FIREBASE_CREDENTIALS_PATH="/path/to/firebase-credentials.json"
   ```
4. Install `firebase-admin` in the backend virtualenv:
   ```bash
   cd /home/surya/Desktop/personal/eventlays/backend
   source .venv/bin/activate
   pip install firebase-admin
   ```

---

## 5. Offline Fallback Note
- If `google-services.json` is not yet configured, the app will continue to run seamlessly using local notifications (`flutter_local_notifications`), offline queuing via Hive, and direct feedback overlays.
