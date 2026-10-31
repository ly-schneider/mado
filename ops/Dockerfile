# syntax=docker/dockerfile:1.28.0@sha256:bb22d9815c728170f72750f4e5b0d672e06176142e1d602c7e66c050100b7e5b
# One image: the NestJS API on Bun, serving the built SPA. Build from the repo root:
#   docker build -f ops/Dockerfile -t mado .
FROM oven/bun:1.4.4@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d AS manifests
WORKDIR /app
COPY package.json bun.lock tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/desktop/package.json apps/desktop/
COPY packages/contract/package.json packages/contract/
COPY packages/db/package.json packages/db/
COPY packages/ui/package.json packages/ui/

FROM manifests AS build
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile
COPY packages packages
COPY apps/web apps/web
RUN cd apps/web && bunx vite build

FROM manifests AS prod-deps
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile --production

FROM oven/bun:1.4.4-slim@sha256:1846adf22496bd711036aae8be147e57bdebbaea2e5264e3e0b5af1db187d9a4 AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=4100 \
    WEB_DIST=/app/apps/web/dist
COPY --from=prod-deps /app ./
COPY packages/contract packages/contract
COPY packages/db packages/db
COPY apps/api apps/api
COPY --from=build /app/apps/web/dist apps/web/dist
COPY ops/entrypoint.sh /usr/local/bin/mado-entrypoint
# Last, so a new version only changes this layer.
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
USER bun
EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD bun -e "fetch('http://127.0.0.1:' + (process.env.PORT || 4100) + '/manifest.webmanifest').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
ENTRYPOINT ["/usr/local/bin/mado-entrypoint"]
