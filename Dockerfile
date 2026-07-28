# syntax=docker/dockerfile:1

FROM node:24-alpine AS web-dependencies
WORKDIR /build/web
COPY web/package.json web/package-lock.json ./
RUN npm ci

FROM web-dependencies AS web-build
COPY web/ ./
RUN npm run build

FROM node:24-alpine AS server-dependencies
WORKDIR /build/server
COPY server/package.json server/package-lock.json ./
RUN npm ci

FROM server-dependencies AS server-build
COPY server/ ./
RUN npm run build

FROM node:24-alpine AS server-production-dependencies
WORKDIR /build/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=8080
ENV STATIC_ROOT=/app/public
WORKDIR /app
COPY --from=server-production-dependencies --chown=node:node /build/server/node_modules ./node_modules
COPY --from=server-build --chown=node:node /build/server/dist ./server/dist
COPY --from=web-build --chown=node:node /build/web/dist ./public
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server/dist/server.js"]
