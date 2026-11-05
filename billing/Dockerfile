# syntax=docker/dockerfile:1
#
# TallyPay — self-hosted image for the Contabo box.
#
# Build context is this `billing/` directory:
#     docker build -t tallypay:local /srv/tallypay/repo/billing
#
# Two stages: a full build, then a runtime image that carries only Next's
# standalone output. No host ports are exposed here — edge-caddy terminates
# TLS and reverse-proxies to this container on the shared `edge` network.

# ----------------------------------------------------------------- build ----
FROM node:22-alpine AS build
WORKDIR /app

# Dependencies first so a source-only change reuses the install layer.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# --------------------------------------------------------------- runtime ----
FROM node:22-alpine AS runtime
WORKDIR /app

# Chromium backs server-side PDF export (src/app/d/[token]/pdf/route.ts).
# Without the font packages Chromium starts but renders invoices blank.
# tini reaps the zombie Chromium processes a crashed render can leave behind.
RUN apk add --no-cache \
      chromium nss freetype harfbuzz ca-certificates ttf-freefont tini

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    CHROMIUM_PATH=/usr/bin/chromium-browser

# Next's standalone output bundles its own traced node_modules — @libsql/client
# and its native binding included — so there is no second npm install here.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

# The migration runner is not part of the traced bundle; the entrypoint runs it
# against the mounted volume before the server starts.
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/docker-entrypoint.sh ./docker-entrypoint.sh

# /data holds the SQLite database and is a named volume in compose.
RUN chmod +x /app/docker-entrypoint.sh \
    && mkdir -p /data \
    && chown -R node:node /data /app

USER node
EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--", "/app/docker-entrypoint.sh"]
