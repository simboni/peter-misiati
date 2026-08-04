# Riziki POS — production image.
#
# Plain `next start`, not standalone output: the server reads src/lib/schema.sql
# from disk at runtime, which output tracing would silently drop. The deps are
# only next/react, so the image stays small anyway.
#
# node:22 is a floor, not a preference — the database is Node's built-in
# node:sqlite, which does not exist before 22.

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

# Production dependencies only — Tailwind and friends were build-time.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.ts ./
# schema.sql (and the seed it feeds) are read from here at runtime.
COPY --from=build /app/src ./src
COPY --from=build /app/scripts ./scripts

# The shop's entire database lives in this one directory. Mount it.
VOLUME /app/data
EXPOSE 3100

HEALTHCHECK --interval=60s --timeout=5s --start-period=15s \
  CMD wget -qO /dev/null http://127.0.0.1:3100/login || exit 1

CMD ["npx", "next", "start", "--port", "3100"]
