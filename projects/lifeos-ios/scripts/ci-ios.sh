#!/bin/bash
set -euo pipefail
xcodegen generate
# Own just this simulator. Never shut down another simulator or the owner's apps.
runtime=$(xcrun simctl list runtimes -j | python3 -c 'import json,sys; print(next(x["identifier"] for x in json.load(sys.stdin)["runtimes"] if x["isAvailable"] and "iOS" in x["name"]))')
device=$(xcrun simctl list devicetypes -j | python3 -c 'import json,sys; print(next(x["identifier"] for x in json.load(sys.stdin)["devicetypes"] if x["name"].startswith("iPhone 16")))')
simulator=$(xcrun simctl create "LifeOS CI ${GITHUB_RUN_ID:-local}" "$device" "$runtime")
cleanup() {
  xcrun simctl shutdown "$simulator" >/dev/null 2>&1 || true
  xcrun simctl delete "$simulator"
  if xcrun simctl list devices -j | python3 -c 'import json,sys; uid=sys.argv[1]; sys.exit(0 if any(d["udid"] == uid for ds in json.load(sys.stdin)["devices"].values() for d in ds) else 1)' "$simulator"; then
    echo "Owned simulator cleanup failed" >&2
    return 1
  fi
}
trap cleanup EXIT
xcodebuild -project LifeOSCompanion.xcodeproj -scheme LifeOSCompanion \
  -destination "platform=iOS Simulator,id=$simulator" -parallel-testing-enabled NO \
  -derivedDataPath DerivedData -resultBundlePath TestResults.xcresult \
  CODE_SIGNING_ALLOWED=NO test
xcodebuild -project LifeOSCompanion.xcodeproj -scheme LifeOSCompanion \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath DerivedData \
  CODE_SIGNING_ALLOWED=NO build
# Launch the actual app as well as testing its core. Keep a reviewable screen image.
xcrun simctl bootstatus "$simulator" -b
xcrun simctl install "$simulator" DerivedData/Build/Products/Debug-iphonesimulator/LifeOSCompanion.app
xcrun simctl launch "$simulator" ca.jacklai.lifeos.companion
sleep 8
xcrun simctl io "$simulator" screenshot Companion.png
