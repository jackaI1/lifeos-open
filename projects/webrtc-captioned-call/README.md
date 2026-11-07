# webrtc-captioned-call

I built a video call app with live captions to learn how the underlying idea works. This is a learning project.

## Try a call

You need Node.js 24 or newer and a recent desktop Chrome or Edge browser. Start on one computer with two tabs and headphones:

```sh
npm ci
npm run setup:models
npm run dev
```

1. Open **http://localhost:4173** in both tabs.
2. Copy the room code from the first tab into the second. Click **Join call** in each and allow camera and microphone access.
3. Click **Enable my captions** in either tab, then speak in English. After a short model load, that person's words appear in both tabs. Each person enables their own captions separately.
4. Use **Mute microphone**, **Turn camera off**, or **Leave call** as needed. Leaving stops the camera, microphone and caption worker and clears the visible transcript.

The first setup downloads the speech model and its browser runtime. Later calls use those local files. You can copy the invite link for a partner, but a localhost link only reaches your own computer. For separate devices, see [calling across networks](#calling-across-networks).

## What I can see during a call

The video is accompanied by the most recent 50 caption lines, labelled **You** or **Partner**. Captions arrive in roughly four-second chunks plus the time needed to process them. I skip silent chunks and drop old chunks if the computer cannot keep up, instead of letting an ever-longer queue build up. Short chunks can split words, and the small English model can make mistakes, especially with noise, names or accents. This is a conversation aid, not an accurate meeting record.

**Connection details** shows whether the peer connection and caption channel are open, how many video bytes have arrived, missing packets, and the round-trip delay when the browser reports it. A call that cannot connect gives a message with a next step. If one person leaves, both can join again for a fresh call.

## How the call gets connected

I use **WebRTC**, the browser's built-in system for sending real-time audio, video and data to another browser. Before a call can start, the two browsers need to exchange instructions about their media and possible network routes. My small **WebSocket signalling server**, a server that keeps a message connection open to each browser, passes those instructions between the two people in a room.

The first person creates an **offer**, which describes what their browser can send. The second sends an **answer** describing what it accepts. Both exchange **ICE candidates**, possible routes between their computers. The server only relays these setup messages. Once connected, the browsers carry audio and video over WebRTC, directly when possible or through a configured relay.

For captions, an **AudioWorklet**, a browser audio processor, collects microphone samples. A separate **Web Worker**, a background task that keeps heavy work off the interface, runs Whisper through Transformers.js and WebAssembly. Whisper is a speech-to-text model. I send its resulting text over an **RTCDataChannel**, WebRTC's encrypted data connection, and display it at the other end. Captions do not pass through the signalling server.

[The design notes](docs/design.md) cover message shapes, ordering, audio processing and resource cleanup.

## Calling across networks

The default setup uses local network routes and is intended for a same-computer demo. To host calls between computers:

- Serve the app and WebSocket endpoint from the same **HTTPS** origin, a secure web address. Browsers only allow camera and microphone access on HTTPS or localhost.
- Set `HOST=0.0.0.0` behind your HTTPS reverse proxy, and forward WebSocket upgrades for `/signal`.
- Set `ICE_SERVERS_JSON` to your own **STUN** service, which helps find a network route, and **TURN** service, which relays traffic when a direct route is blocked. The default is an empty list. See [.env.example](.env.example) and [deployment notes](docs/deployment.md) for the format.

To serve a production build:

```sh
npm run setup:models
npm run build
npm start
```

I have not added user accounts, room passwords or a hosted TURN service. Treat the generated room code as a private invite and use short-lived TURN credentials for a public deployment. The signalling server sees room codes and connection metadata, including candidate addresses. Browser-to-browser media and data are encrypted in transit. This project does not authenticate a partner's identity. I store neither captions nor audio on the server, though the two participants can still copy or record what they receive.

## Tests and limits

There are 3 test source files in this copy. That source count does not establish an execution result. This is a source snapshot, and running it on a new machine may need environment-specific setup.



Retained project workflows: `webrtc-captioned-call-ci.yml`. Their commands use this folder and their triggers use its paths.
