# syntax=docker/dockerfile:1.7
# One image: the NestJS API on Bun, serving the built SPA. Build from the repo root:
#   docker build -f ops/Dockerfile -t mado .
ARG BUN_VERSION=1.3.11

FROM oven/bun:${BUN_VERSION} AS manifests
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

FROM oven/bun:${BUN_VERSION}-slim AS runtime
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
USER bun
EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD bun -e "fetch('http://127.0.0.1:' + (process.env.PORT || 4100) + '/manifest.webmanifest').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
ENTRYPOINT ["/usr/local/bin/mado-entrypoint"]
