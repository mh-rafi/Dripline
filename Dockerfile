# syntax=docker/dockerfile:1

# One image serves the API, the background workers and the admin UI, so an
# install is a single container on a single origin -- which the tracking and
# unsubscribe links in outgoing mail depend on (see APP_URL in
# docs/self-hosting.md).

# TypeScript and the Vite bundle are platform-independent, so they are built
# on the builder's own architecture rather than under emulation.
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY tsconfig.base.json ./
COPY apps/api apps/api
COPY apps/web apps/web
RUN npm run build --workspace apps/web \
    && npm run build --workspace apps/api

FROM node:24-alpine AS runtime
WORKDIR /app
# Reported by /api/v1/meta, so a running instance can say which source it was
# built from -- part of the AGPL section 13 offer.
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION \
    NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    PATH=/app/node_modules/.bin:$PATH
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --omit=dev --workspace apps/api --include-workspace-root \
    && npm cache clean --force

COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/apps/web/dist apps/web/dist
COPY apps/api/migrations apps/api/migrations
COPY deploy/entrypoint.sh /usr/local/bin/entrypoint.sh
# Explicit, so a checkout that lost the executable bit still produces a
# working image.
RUN chmod 0755 /usr/local/bin/entrypoint.sh

USER node
WORKDIR /app/apps/api
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "dist/index.js"]
