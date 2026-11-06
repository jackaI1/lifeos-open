#!/usr/bin/env bash
# Own one temporary AVD and one fixed emulator serial; never touch an existing device.
set -euo pipefail
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
port="${LIFEOS_EMULATOR_PORT:-5580}"
adb_port=$((port + 1))
serial="emulator-$port"
adb="$ANDROID_HOME/platform-tools/adb"
emulator="$ANDROID_HOME/emulator/emulator"
if lsof -nP -iTCP:"$port" -iTCP:"$adb_port" -sTCP:LISTEN >/dev/null 2>&1 || "$adb" devices | rg -q "^$serial[[:space:]]"; then
  echo "Port or device $serial is already in use; select another LIFEOS_EMULATOR_PORT." >&2
  exit 1
fi
mkdir -p test-output
export ANDROID_AVD_HOME
ANDROID_AVD_HOME="$(mktemp -d "${TMPDIR:-/tmp}/lifeos-android-avd.XXXXXX")"
emulator_pid=""
cleanup() {
  if [[ -n "$emulator_pid" ]]; then
    "$adb" -s "$serial" emu kill >/dev/null 2>&1 || true
    for attempt in {1..20}; do
      if ! kill -0 "$emulator_pid" 2>/dev/null; then break; fi
      sleep 1
    done
    if kill -0 "$emulator_pid" 2>/dev/null; then kill -TERM "$emulator_pid"; fi
    wait "$emulator_pid" 2>/dev/null || true
  fi
  rm -rf "$ANDROID_AVD_HOME"
  echo "Cleanup verification for owned PID ${emulator_pid:-none}, port $port:"
  if [[ -n "$emulator_pid" ]]; then ps -p "$emulator_pid" -o pid,lstart,command || true; fi
  lsof -nP -iTCP:"$port" -iTCP:"$adb_port" -sTCP:LISTEN || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
echo no | "$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager" create avd --force --name lifeos-test --device pixel_2 --package 'system-images;android-35;google_apis;arm64-v8a' >test-output/avd.log 2>&1
"$emulator" -avd lifeos-test -port "$port" -no-window -no-snapshot -noaudio -no-boot-anim -gpu swiftshader_indirect -memory 1536 -cores 2 >test-output/emulator.log 2>&1 &
emulator_pid=$!
echo "Owned temporary LifeOS emulator, PID/start time:"
ps -p "$emulator_pid" -o pid,lstart,command
echo "Port $port; cleanup: $adb -s $serial emu kill; then wait $emulator_pid"
booted=false
for attempt in {1..120}; do
  if ! kill -0 "$emulator_pid" 2>/dev/null; then tail -25 test-output/emulator.log; exit 1; fi
  if [[ "$("$adb" -s "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == 1 ]]; then booted=true; break; fi
  sleep 2
done
if [[ "$booted" != true ]]; then echo "Emulator boot timed out"; exit 1; fi
"$adb" -s "$serial" shell settings put global window_animation_scale 0
"$adb" -s "$serial" shell settings put global transition_animation_scale 0
"$adb" -s "$serial" shell settings put global animator_duration_scale 0
ANDROID_SERIAL="$serial" ./gradlew :app:connectedDebugAndroidTest
"$adb" -s "$serial" install -r app/build/outputs/apk/debug/app-debug.apk
"$adb" -s "$serial" shell am start -W -n ca.jacklai.lifeos/.MainActivity
for attempt in {1..20}; do
  "$adb" -s "$serial" shell uiautomator dump /sdcard/lifeos-window.xml >/dev/null
  "$adb" -s "$serial" pull /sdcard/lifeos-window.xml test-output/live-window.xml >/dev/null 2>&1
  if rg -q 'Demo updated and saved on this phone' test-output/live-window.xml; then break; fi
  sleep 2
done
rg -q 'Demo updated and saved on this phone' test-output/live-window.xml
"$adb" -s "$serial" exec-out screencap -p >test-output/live.png
"$adb" -s "$serial" shell am force-stop ca.jacklai.lifeos
"$adb" -s "$serial" shell svc wifi disable
"$adb" -s "$serial" shell svc data disable
"$adb" -s "$serial" shell am start -W -n ca.jacklai.lifeos/.MainActivity
for attempt in {1..25}; do
  "$adb" -s "$serial" shell uiautomator dump /sdcard/lifeos-window.xml >/dev/null
  "$adb" -s "$serial" pull /sdcard/lifeos-window.xml test-output/offline-window.xml >/dev/null 2>&1
  if rg -q 'Could not refresh. Showing the saved copy.' test-output/offline-window.xml; then break; fi
  sleep 2
done
rg -q 'Could not refresh. Showing the saved copy.' test-output/offline-window.xml
rg -q 'Materials lecture' test-output/offline-window.xml
"$adb" -s "$serial" exec-out screencap -p >test-output/offline.png
echo "Production app downloaded the public feed and reopened offline with its saved schedule."
