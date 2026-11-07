# Speech fixture

`speech.wav` contains synthetic English speech, not a recording of a person or a real call. I generated it with macOS `say` (Samantha, 145 words per minute), then converted it to 48 kHz mono PCM with FFmpeg.

Text: "Hello, the captions are working. This is a video call. Hello, the captions are working. This is a video call."

The browser test uses Chromium's fake microphone with this file. The application still captures the audio through `getUserMedia` and an AudioWorklet, runs the real Whisper worker, and sends the resulting text over its real WebRTC data channel. The test contains no fixed transcript injection.

To recreate on macOS:

```sh
say -v Samantha -r 145 -o /tmp/caption-speech.aiff 'Hello, the captions are working. This is a video call. Hello, the captions are working. This is a video call.'
ffmpeg -i /tmp/caption-speech.aiff -ar 48000 -ac 1 -c:a pcm_s16le tests/fixtures/speech.wav
rm /tmp/caption-speech.aiff
```
