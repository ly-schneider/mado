#!/bin/sh
# Migrations run as the owner role; the API itself only ever connects as mado_app (and mado_purge for the purge job).
set -e
if [ -n "$DATABASE_OWNER_URL" ]; then
  bun packages/db/src/migrate.ts
else
  echo "DATABASE_OWNER_URL not set, skipping migrations" >&2
fi
# Bun reads decorator settings from the tsconfig in the working directory, so start from apps/api.
cd apps/api
exec bun src/main.ts
