#!/bin/sh
set -eu
# Real-time synthetic picture and sound, requiring no camera or copyrighted media.
exec ffmpeg -hide_banner -loglevel warning \
  -re -f lavfi -i 'testsrc2=size=1280x720:rate=24' \
  -f lavfi -i 'sine=frequency=440:sample_rate=48000' \
  -t "${STREAM_SECONDS:-16}" \
  -c:v libx264 -preset ultrafast -threads 2 -pix_fmt yuv420p \
  -b:v 2400k -g 48 -keyint_min 48 -sc_threshold 0 -bf 0 \
  -c:a aac -b:a 96k -ar 48000 -ac 2 \
  -f flv "${INGEST_URL:-rtmp://ingest:1935/live/demo}"
