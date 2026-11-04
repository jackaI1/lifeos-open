# syntax=docker/dockerfile:1.7
# Multi-stage image for the standalone LifeOS Open workspace (Node + SQLite).
#   docker build --target runtime -t lifeos-open .
# Stages: deps (production modules) -> build (esbuild bundle) -> runtime (slim, non-root).
# Other deployment targets (e.g. a static public demo) may be appended after `runtime`;
# always pass --target runtime when you want the workspace server.

ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --ignore-scripts

FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=8787 \
    LIFEOS_BIND_HOST=0.0.0.0 \
    LIFEOS_DATABASE=/data/workspace.sqlite
# AUTH_MODE, DEMO_SEED, LLM_MODE and GOOGLE_MODE are left at the application defaults
# (demo, seeded, mock replies, local files); override them at run time.
WORKDIR /app
# The server needs only the node binary: drop the package managers bundled in the base
# image (npm, npx, corepack) to shrink the image and its scannable attack surface.
# /data is the only writable location; a named volume mounted here inherits this ownership.
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn* \
 && mkdir -p /data && chown node:node /data
COPY --from=deps --chown=root:root /app/node_modules ./node_modules
COPY --from=build --chown=root:root /app/package.json ./package.json
COPY --from=build --chown=root:root /app/build ./build
COPY --from=build --chown=root:root /app/public ./public
COPY --from=build --chown=root:root /app/src/cloud/schema.sql ./src/cloud/schema.sql
COPY --from=build --chown=root:root /app/src/storage/migrations ./src/storage/migrations
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "build/server.mjs"]
