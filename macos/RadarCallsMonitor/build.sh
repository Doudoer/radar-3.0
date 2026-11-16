#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

APP_DIR="build/RadarCallsMonitor.app"
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources"
cp Info.plist "$APP_DIR/Contents/Info.plist"

swiftc \
  -O \
  -parse-as-library \
  -framework SwiftUI \
  -framework AppKit \
  RadarCallsMonitor.swift \
  -o "$APP_DIR/Contents/MacOS/RadarCallsMonitor"

codesign --force --deep --sign - "$APP_DIR"
echo "Built: $(pwd)/$APP_DIR"
