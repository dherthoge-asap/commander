# Commander: one container serves the game page and the /ws game server on port 8080.
# Built by the CDK app in infra/ (linux/arm64 for Fargate Graviton).

FROM node:20-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# Empty means the page connects back to its own host (wss://<host>/ws)
ARG VITE_WS_URL=""
ENV VITE_WS_URL=$VITE_WS_URL
RUN npx vite build

FROM node:20-slim AS server
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/ ./
RUN npm run build && npm prune --omit=dev

FROM node:20-slim
ENV NODE_ENV=production PORT=8080 STATIC_DIR=/app/public
WORKDIR /app/server
COPY --from=server /app/server/node_modules ./node_modules
COPY --from=server /app/server/dist ./dist
COPY --from=server /app/server/package.json ./
COPY --from=frontend /app/frontend/dist /app/public
USER node
EXPOSE 8080
CMD ["node", "dist/movement-server.js"]
