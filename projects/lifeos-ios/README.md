# lifeos-ios

I built this to explore lifeos ios. This is a learning project.

## Overview

I built a phone companion for LifeOS because I wanted to check my next class and coursework deadlines without opening the whole workspace. I can see today's commitments, their times and locations, and unfinished deadlines in one screen. After the first download, I can reopen the saved copy without an internet connection.

This is my personal project. The app starts with fictional examples from a [public demo feed](https://raw.githubusercontent.com/jackaI1/lifeos-ios/main/demo-api/today.json), with no account or private records. I can tap **Refresh** or pull down the list to download again. The screen tells me when it was last updated and when it is showing a saved copy.

The feed is a small text file hosted in this repository that the app can read over the internet. LifeOS's [browser demo](https://lifeos.jacklai.ca) keeps its data inside the browser, so this companion uses a separate demo feed. Browser edits do not sync to the phone. Each download places the examples around the current day in Toronto; offline copies keep their original dates, and old copies are labelled.

## Run it

I need a Mac with Xcode 16 or newer and an iOS 17 or newer simulator. I install XcodeGen, a tool that creates the Xcode project, then run:

```sh
brew install xcodegen
xcodegen generate
open LifeOSCompanion.xcodeproj
```

In Xcode, I select the **LifeOSCompanion** scheme, choose an iPhone simulator, and press **Run**. No account, key or signing setup is needed for the simulator. To try offline use, I download once, quit the app, disconnect the Mac from the internet and launch again. The last download remains visible. If I have never downloaded anything, the app explains that I need a connection first.

## How I put it together

I used SwiftUI, Apple's interface framework, for the phone screen. The shared Swift code reads the feed, turns example times into dates, and writes the last successful download to a file on the device. A failed refresh keeps the previous copy; a failed save is shown separately so I know it may not survive a restart.

I keep the network and storage code separate from the screen so I can test offline behavior without turning off the network. The [design notes](docs/design.md) explain the feed, cache and date handling in more detail.

## Tests and limits

There are 0 test source files in this copy. No test pass count is claimed here: I have not re-run the project suite as part of this move. This is a source snapshot, and running it on a new machine may need environment-specific setup.


Project checks run from this directory through the path-filtered hub workflows: `lifeos-ios-ios.yml`.
