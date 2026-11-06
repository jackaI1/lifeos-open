FROM node:22-bookworm-slim AS build
WORKDIR /repo/integrations/azure-feed
COPY integrations/azure-feed/package*.json ./
RUN npm ci
COPY integrations/azure-feed/build.mjs ./
COPY integrations/azure-feed/src ./src
COPY src/shared /repo/src/shared
COPY src/domain/time.mjs /repo/src/domain/time.mjs
COPY public/lifeos-day.js /repo/public/lifeos-day.js
RUN npm run build && npm prune --omit=dev

FROM mcr.microsoft.com/azure-functions/node:4-node22
ENV AzureWebJobsScriptRoot=/home/site/wwwroot \
    AzureFunctionsJobHost__Logging__Console__IsEnabled=true \
    FUNCTIONS_WORKER_RUNTIME=node \
    FUNCTIONS_NODE_BLOCK_ON_ENTRY_POINT_ERROR=true
WORKDIR /home/site/wwwroot
COPY --from=build /repo/integrations/azure-feed/node_modules ./node_modules
COPY --from=build /repo/integrations/azure-feed/dist ./dist
COPY integrations/azure-feed/package.json integrations/azure-feed/host.json ./
EXPOSE 80
