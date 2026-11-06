# hls-rtmp-streaming-lab

I built a small video broadcast lab to learn how the underlying idea works. This is a learning project.

## Try a broadcast

I use Docker with the Compose plugin. Nothing needs a camera or a cloud account.

```sh
docker compose up -d --build
docker compose run --rm publisher
```

Open **http://localhost:8080**, choose **Load broadcast**, then press play. The test runs for 16 seconds. During a broadcast, the first picture takes roughly six seconds to arrive. The finished recording stays available. Choose 360p, 480p or 720p under Picture quality, and turn captions on in the video's caption menu.

To check the recording, start another broadcast, or stop everything:

```sh
# Check playlists and the actual video pieces.
docker compose run --rm validator

# Start a new recording, replacing the previous one.
docker compose restart packager
docker compose run --rm publisher

# Remove the lab's containers, network and recording.
docker compose down -v --remove-orphans
```

If either port is busy, prefix commands with `HTTP_PORT=8081 RTMP_PORT=1936` and open http://localhost:8081. Keep the same values for subsequent commands. Both ports listen only on this computer.

## What happens to the video

RTMP is the connection an encoder uses to send a broadcast to a server. nginx accepts it at `rtmp://localhost:1935/live/demo`. FFmpeg, a video conversion tool, reads that broadcast and creates three picture sizes. HLS is the browser delivery format: a small text playlist tells the player which short video pieces to fetch.

```text
Test picture + sound -> RTMP server -> FFmpeg -> HLS playlists + video pieces
                                               + WebVTT captions
                                                        |
                                                   browser player
```

The player uses the same caption track at all three qualities. WebVTT is a readable text format with a start and end time for each caption. I edit [captions/demo.vtt](captions/demo.vtt) before restarting the packager. These are prepared captions for the test, not automatic speech transcription. For a different recording, I supply its transcript with times measured from the start of that recording.

I can also publish my own file with a host installation of FFmpeg:

```sh
docker compose restart packager
ffmpeg -re -i my-recording.mp4 -c:v libx264 -pix_fmt yuv420p \
  -preset veryfast -g 48 -bf 0 -c:a aac -ar 48000 -ac 2 \
  -f flv rtmp://localhost:1935/live/demo
```

The input must have both video and audio. This lab handles one broadcast named `demo` at a time. It keeps a whole event for replay, so disk use grows during long broadcasts. I use it locally; authentication, encryption, public hosting and recovery from a dropped connection would need more work before an internet deployment. Safari's native fallback chooses quality automatically.

## Tests and limits

There are 4 test source files in this copy. No test pass count is claimed here: I have not re-run the project suite as part of this move. This is a source snapshot, and running it on a new machine may need environment-specific setup.


Project checks run from this directory through the path-filtered hub workflows: (removed workflow).

The relocated workflow did not complete successfully within the migration batch. Local test sources remain available.
