#!/bin/sh
# Runs once, on the first start with an empty volume. roles.sql (applied after every migration)
# only creates these roles if they are missing, so the passwords set here stick.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_pw="$MADO_APP_PASSWORD" -v purge_pw="$MADO_PURGE_PASSWORD" <<'SQL'
CREATE ROLE mado_app LOGIN PASSWORD :'app_pw';
CREATE ROLE mado_purge LOGIN PASSWORD :'purge_pw';
SQL
