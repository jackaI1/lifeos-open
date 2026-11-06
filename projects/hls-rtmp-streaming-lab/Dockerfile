FROM node:22-bookworm-slim AS player
WORKDIR /assets
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM debian:bookworm-slim@sha256:734a72b3d6142a71993b4bc580ca01d8ca687f77a2c422d96a961d3376b179bc
RUN apt-get update && apt-get install -y --no-install-recommends \
    nginx libnginx-mod-rtmp ffmpeg python3 ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY stream /app/stream
COPY scripts/publish.sh /app/scripts/publish.sh
COPY captions /app/captions
COPY web /app/web
COPY --from=player /assets/node_modules/hls.js/dist/hls.min.js /app/web/vendor/hls.min.js
COPY --from=player /assets/node_modules/hls.js/LICENSE /app/web/vendor/hls.js.LICENSE
RUN mkdir -p /var/www/hls && chmod +x /app/scripts/publish.sh
EXPOSE 8080 1935
STOPSIGNAL SIGTERM
CMD ["nginx", "-g", "daemon off;"]
