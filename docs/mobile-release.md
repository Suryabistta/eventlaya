# Mobile app releases (Android) — signing, first upload, CI/CD

App: **Eventlaya** — package `com.eventlaya.eventlaya`, code in `scanner_app/`. Same Google Play developer
account as Flapmo. iOS comes later (needs an Apple Developer account and `GoogleService-Info.plist`).

## 1. Release signing (once, on your machine)

```bash
cd scanner_app
./tool/make_upload_keystore.sh
```

- Asks for a password (12+ characters). Save it in your password manager **before** typing it.
- Creates `~/eventlaya-upload.jks` and `scanner_app/android/key.properties` (gitignored, chmod 600).
- Prints the key's **SHA-1** and **SHA-256** fingerprints.
- **Back up** the keystore: copy `~/eventlaya-upload.jks` to `~/.eventlaya-deploy/`. Every future update must be
  signed with the same key (Play App Signing can reset a lost upload key, but it takes days).

How signing works (`android/app/build.gradle.kts`): release builds use `key.properties`, or the
`ANDROID_KEYSTORE_*` environment variables in CI. With neither, release builds are **unsigned** on purpose
(never the shared debug key, which Play refuses).

## 2. Build a release

```bash
cd scanner_app
./tool/build_release.sh          # bumps the build number: 1.0.1+2 → 1.0.1+3
./tool/build_release.sh 1.1.0    # new version name too:   → 1.1.0+3
```

Output in `~/Desktop/eventlaya-releases/`: `eventlaya-<version>-<build>.aab` (upload this) and
`symbols-<version>-<build>.zip` (keep it; it makes obfuscated crash reports readable). Commit the `pubspec.yaml`
version bump.

## 3. First upload (by hand — Play requires it for a new app)

1. Play Console (the Flapmo account) → **Create app** → name "Eventlaya", default language, App, Free.
2. **Testing → Internal testing → Create new release** → accept **Play App Signing** → upload the `.aab`
   → add yourself as a tester → roll out.
3. Fill in App content and Data safety from `docs/play-store.md`.
4. **Fingerprints for Google sign-in** — Play Console → **Test and release → App integrity → App signing**:
   copy the **SHA-1 of the app signing key** (Play's) and of the **upload key** (yours). Add **both** in
   Firebase → Project settings → Your apps → Android app `com.eventlaya.eventlaya` → **Add fingerprint**.
   Download the updated `google-services.json` into `scanner_app/android/app/`. Without this, Google sign-in
   fails in Play builds.

## 4. CI/CD (GitHub Actions)

After the first manual upload, builds can go to Play automatically.

### One-time setup

**Google Play service account** (lets GitHub upload; the same one can serve Flapmo):
1. Google Cloud console (project linked to the Play account) → IAM & Admin → **Service accounts** → Create,
   e.g. `play-publisher` → no roles needed → **Keys → Add key → JSON** → download.
2. Play Console → **Users and permissions → Invite new users** → the service account's email → App permissions:
   Eventlaya → **Release to testing tracks** (and production if you want CI to promote) → Invite.

**GitHub secrets** (repo → Settings → Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 ~/eventlaya-upload.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | the keystore password |
| `ANDROID_KEY_ALIAS` | `upload` |
| `PLAY_SERVICE_ACCOUNT_JSON` | the whole JSON key file |
| `GOOGLE_SERVICES_JSON_BASE64` | `base64 -w0 scanner_app/android/app/google-services.json` (gitignored, so CI needs it) |

### Workflows (`.github/workflows/`)

- `mobile-ci.yml` — on push to main / PR touching `scanner_app/`: `flutter analyze` and `flutter test`.
- `mobile-release.yml` — on a tag `app-v1.2.0` (or by hand from the Actions tab): tests, builds the signed `.aab`
  (version name from the tag, build number = 100 + run number), checks it is signed with the upload key, uploads
  it to **Play internal testing**, keeps the `.aab` + symbols as a run artifact and attaches them to a GitHub
  Release. Promote internal → production in Play Console.

Release: `git tag app-v1.0.2 && git push origin app-v1.0.2`.

Tag builds go straight out to internal testers (status `completed`; choose `draft` when running it by hand to
review first). Production is always promoted by hand in Play Console.

## 5. iOS (later)

Needs: Apple Developer account, the iOS app in Firebase (`GoogleService-Info.plist` for bundle
`com.eventlaya.eventlayaScanner`), an App Store Connect API key, and a macOS runner. Then a matching
`ios-release.yml` uploads to TestFlight.
