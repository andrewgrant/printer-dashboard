# syntax=docker/dockerfile:1.7

# ---------- deps ----------
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++ libc6-compat
COPY package.json package-lock.json* ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --include=dev

# ---------- build ----------
FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++ libc6-compat
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm --workspace apps/web run build \
 && npm --workspace apps/server run build \
 && mkdir -p apps/server/dist/public \
 && cp -r apps/web/dist/* apps/server/dist/public/

# ---------- prune (production-only deps, re-resolved from scratch) ----------
FROM node:22-alpine AS prod-deps
WORKDIR /app
RUN apk add --no-cache python3 make g++ libc6-compat
COPY package.json package-lock.json* ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --workspace apps/server --include-workspace-root

# ---------- runtime ----------
FROM node:22-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache tini wget
COPY --from=build /app/apps/server/dist ./dist
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/apps/server/package.json ./package.json
ENV NODE_ENV=production
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
EXPOSE 3101
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3101/api/health || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
