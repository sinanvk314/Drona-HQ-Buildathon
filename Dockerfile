# One container serves the API, the autonomous scheduler and the built UI on a single port.
# Works on any host that runs Docker (Render, Railway, Fly.io, a VPS).
#
# Mount a persistent volume at /data: the datastore, LLM usage counters and the embedding-model cache live
# there, so campaigns survive a restart or redeploy. Without a volume the app still runs but reseeds each time.

FROM node:20-slim AS ui
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Debian-based (not alpine): the ONNX runtime used for local embeddings needs glibc.
FROM node:20-slim
WORKDIR /app
COPY backend/package*.json backend/
RUN npm --prefix backend ci --omit=dev
COPY backend/ backend/
COPY --from=ui /app/frontend/dist frontend/dist

ENV NODE_ENV=production \
    DATA_FILE=/data/state.json \
    USAGE_FILE=/data/usage.json \
    EMBEDDING_CACHE_DIR=/data/.embedding-cache
VOLUME /data
EXPOSE 8080
CMD ["node", "backend/src/server.js"]
