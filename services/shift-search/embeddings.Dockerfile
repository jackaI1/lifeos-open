FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY tools/retrieval-download.mjs tools/shift-embeddings.mjs ./tools/
COPY src/local/retrieval-model.mjs ./src/local/
RUN node tools/retrieval-download.mjs && chown -R node:node /app/.cache
USER node
CMD ["node", "tools/shift-embeddings.mjs"]
