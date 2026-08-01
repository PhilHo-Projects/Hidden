# syntax=docker/dockerfile:1

FROM node:24-alpine AS dependencies
WORKDIR /build
COPY package.json package-lock.json ./
COPY web/package.json ./web/package.json
COPY server/package.json ./server/package.json
COPY packages/game-core/package.json ./packages/game-core/package.json
RUN npm ci

FROM dependencies AS build
COPY web/ ./web/
COPY server/ ./server/
COPY packages/game-core/ ./packages/game-core/
RUN npm run build:core
RUN npm run build:web
RUN npm run build:server

FROM build AS production-dependencies
RUN npm prune --omit=dev

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=8080
ENV STATIC_ROOT=/app/public
WORKDIR /app
COPY --from=production-dependencies --chown=node:node /build/node_modules ./node_modules
COPY --from=build --chown=node:node /build/server/dist ./server/dist
COPY --from=build --chown=node:node /build/server/migrations ./server/migrations
COPY --from=build --chown=node:node /build/web/dist ./public
COPY --from=build --chown=node:node /build/packages/game-core/package.json ./packages/game-core/package.json
COPY --from=build --chown=node:node /build/packages/game-core/dist ./packages/game-core/dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server/dist/server.js"]
