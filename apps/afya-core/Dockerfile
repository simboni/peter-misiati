# Afya Core — production image.
#
# Plain `next start`, not standalone output: src/lib/schema.sql is read from
# disk at runtime and output tracing would silently drop it. The runtime deps
# are only next/react, so the image stays small anyway.
#
# node:22 is a floor, not a preference — the database is Node's built-in
# node:sqlite, which does not exist before 22.6.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx next build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1

# Production dependencies only — Tailwind and TypeScript were build-time.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/.next ./.next
COPY --from=build /app/next.config.ts ./
# No public/ — this app ships no static files, and COPYing a directory that is
# not there fails the build rather than being quietly skipped.
# schema.sql, the seed, and the scripts update.sh runs inside this container.
COPY --from=build /app/src ./src
COPY --from=build /app/scripts ./scripts

# The facility's entire record is in this one directory: the database, its
# snapshots, and the sync folder batches are written to and read from. Mount it.
VOLUME /app/data
EXPOSE 3200

HEALTHCHECK --interval=60s --timeout=5s --start-period=20s \
  CMD wget -qO /dev/null http://127.0.0.1:3200/sign-in || exit 1

CMD ["npx", "next", "start", "--port", "3200"]
