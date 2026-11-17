#!/usr/bin/env bash
#
# Builds a signed Play release (.aab) of the Eventlaya app and puts it, with its debug symbols, in
# ~/Desktop/eventlaya-releases/. Bumps the build number in pubspec.yaml first (Play needs a higher one each upload).
#
#   ./tool/build_release.sh              # 1.0.1+2  → 1.0.1+3
#   ./tool/build_release.sh 1.1.0        # 1.0.1+2  → 1.1.0+3   (new version name, build number still +1)
#
# Needs android/key.properties (tool/make_upload_keystore.sh) or ANDROID_KEYSTORE_* variables.
set -euo pipefail

APP="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${OUT:-$HOME/Desktop/eventlaya-releases}"
cd "$APP"

if [[ ! -f android/key.properties && -z "${ANDROID_KEYSTORE_PATH:-}" ]]; then
  echo "No signing key: run ./tool/make_upload_keystore.sh first (or set ANDROID_KEYSTORE_* variables)."
  exit 1
fi

current=$(grep -E '^version:' pubspec.yaml | awk '{print $2}')
name="${current%%+*}"
build="${current##*+}"
new_name="${1:-$name}"
new_build=$((build + 1))
sed -i -E "s/^version: .*/version: ${new_name}+${new_build}/" pubspec.yaml
echo "Version: ${current} → ${new_name}+${new_build}"

flutter pub get
flutter build appbundle --release \
  --obfuscate --split-debug-info="build/symbols/${new_name}-${new_build}"

mkdir -p "$OUT"
cp build/app/outputs/bundle/release/app-release.aab "$OUT/eventlaya-${new_name}-${new_build}.aab"
(cd "build/symbols/${new_name}-${new_build}" && zip -qr "$OUT/symbols-${new_name}-${new_build}.zip" .)

echo
echo "Ready in $OUT:"
echo "  eventlaya-${new_name}-${new_build}.aab      → upload in Play Console (Internal testing first)"
echo "  symbols-${new_name}-${new_build}.zip        → keep it: it turns obfuscated crash reports back into readable ones"
echo
echo "Commit the version bump in pubspec.yaml."
