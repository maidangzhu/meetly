#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
DMG_PATH=${1:-}

if [[ -z "$DMG_PATH" ]]; then
  DMG_PATH=$(find "$ROOT_DIR/src-tauri/target/release/bundle/dmg" -name '*.dmg' -type f | head -n 1)
fi

if [[ -z "$DMG_PATH" || ! -f "$DMG_PATH" ]]; then
  echo "macOS test DMG not found." >&2
  exit 1
fi

TEMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/meetly-test-bundle.XXXXXX")
MOUNT_DIR="$TEMP_DIR/mount"
mkdir -p "$MOUNT_DIR"

cleanup() {
  hdiutil detach "$MOUNT_DIR" >/dev/null 2>&1 || true
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

hdiutil verify "$DMG_PATH" >/dev/null
hdiutil attach -readonly -nobrowse -mountpoint "$MOUNT_DIR" "$DMG_PATH" >/dev/null

APP_PATH=$(find "$MOUNT_DIR" -maxdepth 2 -name '*.app' -type d | head -n 1)
if [[ -z "$APP_PATH" ]]; then
  echo "No app bundle found in $DMG_PATH." >&2
  exit 1
fi

SIGNATURE=$(codesign -dv --verbose=4 "$APP_PATH" 2>&1)

if ! grep -q 'linker-signed' <<<"$SIGNATURE"; then
  echo "Expected a linker-signed test bundle, matching the Percent package." >&2
  exit 1
fi

if grep -q 'runtime' <<<"$SIGNATURE"; then
  echo "Unexpected hardened-runtime signature in the unsigned test bundle." >&2
  exit 1
fi

if [[ -e "$APP_PATH/Contents/_CodeSignature/CodeResources" ]]; then
  echo "Unexpected full app-bundle signature in the unsigned test bundle." >&2
  exit 1
fi

if codesign --verify --deep --strict "$APP_PATH" >/dev/null 2>&1; then
  echo "Unexpected fully sealed signature in the unsigned test bundle." >&2
  exit 1
fi

echo "Verified Percent-style macOS test bundle: $DMG_PATH"
echo "Signature mode: linker-signed only; no hardened runtime or sealed resources."
