# Hosting a call

I run the local demo on `http://localhost:4173`. Localhost is a special browser exception for camera permissions; `http://192.168.x.x` is not. Two tabs test the complete call path without a relay.

For two computers, run `npm ci`, `npm run setup:models`, and `npm run build` on the host, then start with `HOST=0.0.0.0 PORT=4173 npm start`. Put the process behind an HTTPS reverse proxy that forwards `/signal` WebSocket upgrades as well as ordinary HTTP requests. Preserve the original Host and Origin, and set proxy WebSocket idle timeouts above 30 seconds. The app uses relative paths, so it expects to be served from the origin root, not a subdirectory.

I configure network traversal before starting the process:

```sh
export ICE_SERVERS_JSON='[{"urls":"stun:stun.example.org:3478"},{"urls":"turn:turn.example.org:3478","username":"temporary-user","credential":"temporary-password"}]'
HOST=0.0.0.0 PORT=4173 npm start
```

These are placeholders. Replace them with the STUN/TURN service you operate. Credentials must be available to a browser to use TURN; use short-lived credentials and do not place a permanent relay password in the repository. `/config.json` is returned without caching. The server does not read `.env` automatically. It only reads exported process environment variables. If two computers connect locally but fail on different networks, check the relay and firewall rules, not just whether the web page loads.

The model setup downloads about 44 MB of model/tokenizer files plus the ONNX browser runtime from the installed package. The manifest pins a Hugging Face revision and SHA-256 hashes. The setup command verifies cached files too. Run it before each production build so Vite copies assets into `dist`. Serve model files as static assets; a missing model path should return 404, never the HTML shell. No Hugging Face token is required for this public model. Check its Apache-2.0 license before redistributing model assets.

There are no accounts, room passwords or server-side call recordings. HTTPS protects signalling in transit; WebRTC protects media and data in transit. The server still sees room membership, SDP and candidate addresses. A malicious host could alter the app or negotiation, and a participant could record a call. I would add authentication, expiring invites and operational rate limiting before exposing it as a public service. The current limits and same-host Origin check are a local project's safeguards, not a complete abuse-prevention system.

Use the server's printed PID and `kill -TERM <pid>` command to stop your own instance. Tests manage their server automatically and deliberately refuse to reuse an existing server on port 4173.
