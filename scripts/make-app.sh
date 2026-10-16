#!/bin/bash
# Erzeugt Englischkartei.app als Starter für dieses Projekt (ohne Terminal startbar).
# Die App enthält keinen Code und keine Daten: Sie startet das Electron aus diesem Projektordner,
# deshalb bleibt data/database.json die einzige Datenbank.
set -euo pipefail

PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
ELECTRON="$PROJECT/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
[ -x "$ELECTRON" ] || { echo "Electron fehlt – bitte zuerst 'npm install' ausführen." >&2; exit 1; }

BUILD="$(mktemp -d)/Englischkartei.app"
mkdir -p "$BUILD/Contents/MacOS" "$BUILD/Contents/Resources"

cat > "$BUILD/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Englischkartei</string>
  <key>CFBundleDisplayName</key><string>Englischkartei</string>
  <key>CFBundleIdentifier</key><string>de.arda.englischkartei.launcher</string>
  <key>CFBundleExecutable</key><string>Englischkartei</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST

# macOS (Launch Services) startet nur echte Mach-O-Programme als App – deshalb ein winziger C-Starter,
# der das Electron aus dem Projektordner per exec übernimmt.
CSRC="$(mktemp -d)/launcher.c"
cat > "$CSRC" <<CEOF
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <sys/stat.h>

#define PROJECT "$PROJECT"
#define ELECTRON PROJECT "/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"

int main(int argc, char **argv) {
  struct stat st;
  if (stat(ELECTRON, &st) != 0) {
    execl("/usr/bin/osascript", "osascript", "-e",
          "display alert \\"Englischkartei kann nicht starten\\" message \\"Projektordner oder node_modules nicht gefunden:\\\\n" PROJECT "\\\\n\\\\nBitte dort einmal npm install ausführen.\\"",
          (char *)NULL);
    return 1;
  }
  unsetenv("ELECTRON_RUN_AS_NODE");
  if (chdir(PROJECT) != 0) perror("chdir");
  execl(ELECTRON, ELECTRON, PROJECT, (char *)NULL);
  perror("exec");
  return 1;
}
CEOF
clang -O2 -arch arm64 -arch x86_64 -o "$BUILD/Contents/MacOS/Englischkartei" "$CSRC" 2>/dev/null \
  || clang -O2 -o "$BUILD/Contents/MacOS/Englischkartei" "$CSRC"
chmod +x "$BUILD/Contents/MacOS/Englischkartei"

# Icon: einfache Karteikarte, aus einem SVG über qlmanage/sips/iconutil erzeugt
ICONSET="$(mktemp -d)/AppIcon.iconset"; mkdir -p "$ICONSET"
SVG="$(mktemp -d)/icon.svg"
cat > "$SVG" <<'SVGEOF'
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect x="64" y="64" width="896" height="896" rx="200" fill="#1c1c1b"/>
  <rect x="172" y="250" width="680" height="480" rx="48" fill="#3987e5" opacity="0.35" transform="rotate(-6 512 490)"/>
  <rect x="172" y="270" width="680" height="480" rx="48" fill="#f0efec"/>
  <rect x="236" y="350" width="552" height="36" rx="18" fill="#3987e5"/>
  <rect x="236" y="440" width="420" height="24" rx="12" fill="#8d8c85"/>
  <rect x="236" y="500" width="500" height="24" rx="12" fill="#8d8c85"/>
  <text x="236" y="680" font-family="Helvetica Neue, Arial" font-weight="700" font-size="120" fill="#1c1c1b">EN</text>
</svg>
SVGEOF
if qlmanage -t -s 1024 -o "$(dirname "$SVG")" "$SVG" >/dev/null 2>&1 && [ -f "$SVG.png" ]; then
  for s in 16 32 128 256 512; do
    sips -z $s $s "$SVG.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
    sips -z $((s*2)) $((s*2)) "$SVG.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
  done
  iconutil -c icns "$ICONSET" -o "$BUILD/Contents/Resources/AppIcon.icns" || true
fi

install_to() {
  local dest="$1"
  rm -rf "$dest/Englischkartei.app"
  cp -R "$BUILD" "$dest/Englischkartei.app"
  xattr -cr "$dest/Englischkartei.app" 2>/dev/null || true
  codesign --force --sign - "$dest/Englischkartei.app" >/dev/null 2>&1 || true
  echo "Installiert: $dest/Englischkartei.app"
}

install_to "$HOME/Desktop"
install_to "/Applications" || echo "Konnte /Applications nicht beschreiben." >&2
touch "$HOME/Desktop/Englischkartei.app" /Applications/Englischkartei.app 2>/dev/null || true
