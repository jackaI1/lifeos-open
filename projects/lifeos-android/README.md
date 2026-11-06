# lifeos-android

I built a phone companion for LifeOS to learn how the underlying idea works. This is a learning project.

## Run it

I use Android Studio, Google's app development program, with Java 17 and the Android 35 SDK, the tools for building Android apps. In Android Studio I open this folder, let it finish setting up, select the **app** configuration and an Android 8.0 or newer device or emulator, then press **Run**. An emulator is a simulated phone on my computer. The app downloads its first copy automatically.

From the terminal, with Java 17 and the Android SDK installed:

```sh
brew install openjdk@17 # macOS; install a JDK 17 package on Linux
export JAVA_HOME="$(brew --prefix openjdk@17)/libexec/openjdk.jdk/Contents/Home" # use your JDK path on Linux
export ANDROID_HOME="$HOME/Library/Android/sdk" # macOS default
./gradlew :app:assembleDebug
"$ANDROID_HOME/platform-tools/adb" install -r app/build/outputs/apk/debug/app-debug.apk
"$ANDROID_HOME/platform-tools/adb" shell am start -n ca.jacklai.lifeos/.MainActivity
```

I can also download the debug APK, the installable Android app, from a successful [Actions run](https://github.com/jackaI1/lifeos-android/actions/workflows/android.yml) under **build-and-unit-results**. This is a test build, with no Play Store release.

To try offline use, I download once, close the app, turn off both Wi-Fi and mobile data, and reopen it. The saved schedule remains visible. If there is no saved copy, **Try again** lets me retry once connected. If the phone cannot save a new download, I see a warning that this copy may not survive a restart.

## How I put it together

I put the feed and date logic in **core**, a Kotlin module that runs without a phone. It turns the feed's day offsets and local clock times into fixed dates using the feed's time zone. It rejects invalid dates and clock times, including times skipped when clocks move forward. A failed download or invalid feed keeps the previous snapshot.

The Android app saves a snapshot, a complete local copy of the resolved data, with **AtomicFile**. That Android helper finishes the whole replacement before making it the saved copy. An interrupted write leaves the old complete copy available. Downloads and file access run away from the screen's main thread so the interface stays responsive. The [design notes](docs/design.md) cover validation, storage and the test boundaries.

This version is read-only. It has no private workspace connection, editing, notifications or background sync.

## Tests and limits

There are 1 test source files in this copy. No test pass count is claimed here: I have not re-run the project suite as part of this move. This is a source snapshot, and running it on a new machine may need environment-specific setup.


Project checks run from this directory through the path-filtered hub workflows: `lifeos-android-android.yml`.
