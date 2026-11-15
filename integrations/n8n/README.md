# Deadline reminders with n8n

I built a small reminder workflow in n8n, a self-hosted automation tool, because
I want a reminder for a deadline that is less than a day away, even when LifeOS is
closed. LifeOS signs each event, and n8n accepts only the events that check out.

## How it works

1. LifeOS (`send.mjs`) finds deadlines due within 24 hours and calendar items that
   changed since its last run. Each event gets a timestamp and an HMAC signature, a
   fingerprint made with a shared secret.
2. The n8n webhook receives the raw bytes. It checks the timestamp is within five
   minutes, checks the signature in constant time, parses the event and refuses a
   repeated event ID for 24 hours.
3. The reminder goes to the notification URL. A failed attempt is retried after 0.5,
   1 and 2 seconds. Client errors are not retried.
4. The result is written to the workflow's log, and the webhook replies with 202,
   409 (replay), 401 (bad signature), 422 (bad event) or 502 (delivery failed).

## Try it

```sh
cd integrations/n8n
export LIFEOS_WEBHOOK_SECRET="$(openssl rand -hex 24)"
export LIFEOS_NOTIFY_TOKEN="$(openssl rand -hex 24)"
export N8N_ENCRYPTION_KEY="$(openssl rand -hex 24)"
docker compose up -d
cd ../..
LIFEOS_WEBHOOK_SECRET="$LIFEOS_WEBHOOK_SECRET" node integrations/n8n/send.mjs \
  --url http://127.0.0.1:5678/webhook/lifeos/deadlines
```

Open http://127.0.0.1:8080/deliveries to see what the notification stand-in received.
Stop the stack with `docker compose down --volumes`.

## What is in this folder

- `lib/webhook-guard.mjs` holds the checks. It has no imports, because the build
  step copies its source into the n8n Code node.
- `build-workflow.mjs` writes `workflows/deadline-reminders.json`. Run it with
  `--check` to confirm the committed JSON matches the source.
- `send.mjs` is the sender, with its calendar state kept in `.lifeos/n8n-state.json`.
- `sink/server.mjs` is a stand-in notification endpoint for the sample stack. It
  keeps deliveries in memory only.
- `compose.yaml` runs n8n (pinned to 2.47.7) and the stand-in on 127.0.0.1 only.

## Limits

The sample stack sends reminders to the stand-in, not to a phone. LifeOS's own
notification route is web push (`src/server/push.mjs`), which needs device
subscriptions. Pointing `LIFEOS_NOTIFY_URL` at a route that calls it is the last step.
Date-only deadlines are not sent, because they have no time to count down from.

## Tests

- `node --test test/n8n-webhook-guard.test.mjs test/n8n-workflow.test.mjs test/n8n-sender.test.mjs`
  runs the checks, including the exact Code node text with n8n's inputs faked.
- `test/n8n-compose.integration.test.mjs` sends signed, replayed and forged events
  to a running stack. It is skipped unless `LIFEOS_N8N_URL` is set, and CI sets it.
