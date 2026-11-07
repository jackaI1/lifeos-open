# lifeos-mobile-expo

I built a phone app for my daily schedule to learn how the underlying idea works. This is a learning project.

## Try it on your phone

Install [Node.js 24](https://nodejs.org/) on your computer and [Expo Go](https://expo.dev/go) on your phone. Expo Go opens the app while it runs from your computer.

```sh
npm ci
npm start
```

Keep the phone and computer on the same Wi-Fi. Scan the terminal's QR code with the iPhone Camera or the scanner in Expo Go on Android. Allow local network access if prompted. If your network blocks the connection, try `npx expo start --go --tunnel` and accept the tunnel helper installation.

This project uses Expo SDK 57. Use a compatible Expo Go version from the link above. If Expo Go reports a version mismatch, follow [Expo's version guide](https://docs.expo.dev/troubleshooting/expo-go-version-mismatch/). I pinned SDK 57 because [Expo's setup guide](https://docs.expo.dev/get-started/create-a-project/) recommends it for physical-device Expo Go during the SDK 58 transition.

To check the offline behavior:

1. Open the app online and wait for **Updated**.
2. Disable internet access on the phone, keeping the app open.
3. Tap **Refresh**. The saved schedule stays visible with a connection message.
4. Reconnect and tap **Retry**. The message clears when fresh data arrives.

The saved copy also survives restarting the app. Expo Go still needs access to the development bundle when it reloads; keeping data offline does not install the app itself. First use without internet shows an explanation and Retry because there is no saved copy yet.

For a browser preview, run `npm run web`. For an already configured simulator, run `npm run ios` or `npm run android`.

## What the dates mean

A fresh fetch gives the public examples dates relative to today, using the phone's local time zone. For example, the workshop starts at 10:45 today and the feedback-loop task is due two calendar days later. This keeps the example useful whenever I open it.

Once saved, those dates stay fixed. Yesterday's cached events do not become today's events while offline. The app checks the day again at midnight and when brought back to the foreground. It keeps overdue unfinished tasks visible, puts confirmed dates in order, and leaves missing dates marked **Date not confirmed**.

## Where the data comes from

The app fetches [the public mobile feed](https://raw.githubusercontent.com/jackaI1/lifeos-mobile-expo/main/public/lifeos-demo.json) from this repository. I adapted the fictional events and tasks from [LifeOS Open's public examples](https://github.com/jackaI1/lifeos-open/blob/main/demo/scenarios.mjs).

LifeOS Open's hosted demo stores each visitor's workspace inside their browser. It has no remote visitor API for this phone app to call, so I published this separate read-only feed. Edits made in the browser demo do not appear here. There are no logins, API keys, analytics, or private records in this app.

## How I put it together

I used React Native for the actual phone controls and Expo to run the same TypeScript app on iOS and Android. TypeScript checks the shapes of values before the app runs.

- `src/AgendaScreen.tsx` shows the agenda, native pull-to-refresh control, and loading, empty, saved-data, and retry states.
- `src/dates.ts` shares calendar calculations between the app and tests. Calendar days are calculated without assuming every day lasts 24 hours.
- `src/repository.ts` fetches and validates the feed, limits requests to ten seconds, and saves successful snapshots with AsyncStorage, the device's local app storage.
- `src/feed.ts` checks incoming data and saved copies before they reach the screen. A broken response cannot overwrite the last good copy.

If saving fails, the fresh schedule still appears with a warning that it is unavailable offline. Refreshes run one at a time, and leaving the screen cancels an active request. The app has a light appearance and scales text using the phone's font-size setting.

The [feed contract](docs/feed.md) explains the example data. The [design notes](docs/design.md) cover the main choices and limits.

## Tests and limits

There are 3 test source files in this copy. That source count does not establish an execution result. This is a source snapshot, and running it on a new machine may need environment-specific setup.



Contact email addresses in dependency notices or public-data fixtures were replaced with a fictional example address in this snapshot.

The relocated workflow did not complete successfully within the migration batch. Local test sources remain available.

No project-specific GitHub Actions workflow was retained. The local test sources remain in this folder.
