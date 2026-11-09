#!/bin/bash
# package-mac-local.sh — assemble the macOS .app by hand, no electron-builder.
#
# electron-builder's app-builder helper hangs/returns empty plists on this
# machine (macOS 27), so the bundle is assembled directly: the stock Electron.app
# gets the app code at Contents/Resources/app, the studio engine at
# Contents/Resources/studio, the bundled runtimes at Resources/{bin,node}, a
# real icon, and an ad-hoc signature — everything the CI build has.
#
#   bash scripts/package-mac-local.sh        # → desktop/release/Video Studio.app
set -euo pipefail
cd "$(dirname "$0")/.."
DESK=desktop
OUT="$DESK/release"
APP="$OUT/Video Studio.app"

echo "── assemble $APP"
rm -rf "$OUT/Video Studio.app"
mkdir -p "$OUT"
cp -R "$DESK/node_modules/electron/dist/Electron.app" "$APP"

PLIST="$APP/Contents/Info.plist"
PB=/usr/libexec/PlistBuddy
"$PB" -c "Set :CFBundleIdentifier com.pedramgholizadeh.videostudio" "$PLIST"
"$PB" -c "Set :CFBundleName Video Studio" "$PLIST" 2>/dev/null || true
"$PB" -c "Add :CFBundleDisplayName string استودیوی ادیت ویدیو با هوش مصنوعی" "$PLIST" 2>/dev/null || \
  "$PB" -c "Set :CFBundleDisplayName استودیوی ادیت ویدیو با هوش مصنوعی" "$PLIST"

# the app code — Electron loads Resources/app when there is no asar
mkdir -p "$APP/Contents/Resources/app"
cp "$DESK/main.cjs" "$DESK/preload.cjs" "$DESK/package.json" "$APP/Contents/Resources/app/"

# the studio engine + panel
mkdir -p "$APP/Contents/Resources/studio"
for item in server.mjs cli.mjs package.json lib engine scripts templates tools ui AGENTS.md; do
  cp -R "$item" "$APP/Contents/Resources/studio/"
done
mkdir -p "$APP/Contents/Resources/studio/assets"
cp -R assets/overlay-template assets/templates "$APP/Contents/Resources/studio/assets/"

# the updater's runtime dependency tree (electron-builder bundles this
# automatically in CI; the manual build copies it by name — never .bin)
mkdir -p "$APP/Contents/Resources/app/node_modules"
for dep in electron-updater fs-extra graceful-fs jsonfile universalify js-yaml argparse lazy-val \
           lodash.escaperegexp lodash.isequal semver tiny-typed-emitter builder-util-runtime debug ms sax; do
  if [ -d "$DESK/node_modules/$dep" ]; then
    rm -rf "$APP/Contents/Resources/app/node_modules/$dep"
    cp -R "$DESK/node_modules/$dep" "$APP/Contents/Resources/app/node_modules/"
  fi
done

# bundled runtimes
mkdir -p "$APP/Contents/Resources/bin"
cp "$DESK/node_modules/ffmpeg-static/ffmpeg" "$APP/Contents/Resources/bin/ffmpeg"
cp "$DESK/node_modules/ffprobe-static/bin/darwin/arm64/ffprobe" "$APP/Contents/Resources/bin/ffprobe"
chmod +x "$APP/Contents/Resources/bin/"*
if [ -d "$DESK/node-runtime/bin" ] || [ -d "$DESK/node-runtime" ]; then
  rm -rf "$APP/Contents/Resources/node"
  cp -R "$DESK/node-runtime" "$APP/Contents/Resources/node"
fi

# the icon: png → iconset → icns
if [ ! -f "$DESK/build/icon.icns" ]; then
  ICONSET=/tmp/vs-icon.iconset
  rm -rf "$ICONSET" && mkdir -p "$ICONSET"
  for s in 16 32 128 256 512; do
    sips -z $s $s "$DESK/build/icon.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
    d=$((s * 2))
    sips -z $d $d "$DESK/build/icon.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
  done
  iconutil -c icns "$ICONSET" -o "$DESK/build/icon.icns"
fi
cp "$DESK/build/icon.icns" "$APP/Contents/Resources/electron.icns"

# ad-hoc signature — enough to launch without the «damaged» Gatekeeper wall
codesign --force --deep --sign - "$APP" 2>/dev/null || echo "⚠ codesign failed (continuing)"

echo "── done: $APP"
