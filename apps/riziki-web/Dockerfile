# Riziki Industrial Chemicals — the public website, as an image.
#
# Why this file exists at all: the site is a static export, and for a while the
# deploy mounted the host's `out/` directory into Caddy. `out/` is a build
# artefact, so it is not in git — which meant `git pull && docker compose up`
# updated the shop system and left the website frozen at whatever was built the
# day the server was first set up. New pages, new pictures and new copy simply
# never arrived, and the drift was invisible until someone opened the site.
#
# Building it here removes that whole class of mistake: the files are baked into
# an image, so one `docker compose up -d --build` rebuilds the website from the
# commit that is actually checked out — or fails loudly, which is the other
# thing a silent bind mount could never do.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx next build

# Caddy, not nginx: the edge proxy in front of this is already Caddy, so this
# is one image to pull instead of two, and one config syntax to know.
FROM caddy:2-alpine
COPY deploy/site.Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/out /srv/site

# Fails the container if the homepage is missing — i.e. if a build ever produces
# an empty export, the deploy says so instead of serving 404s.
HEALTHCHECK --interval=60s --timeout=5s --start-period=5s \
  CMD wget -qO /dev/null http://127.0.0.1/ || exit 1
