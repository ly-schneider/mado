#!/bin/sh
# One-time upgrade for databases created before the role split, where Postgres' bootstrap superuser was
# named mado_owner and the app ran its migrations as a superuser. Postgres won't take SUPERUSER away from
# the bootstrap user, so this renames it to $PGUSER (postgres), creates a new mado_owner without SUPERUSER
# or CREATEDB, and hands it mado's database, schemas and tables. All in one transaction.
#   upgrade-roles               run it, or say there is nothing to do
#   upgrade-roles --if-needed   quiet when there is nothing to do (the backup container runs this on start)
set -eu

DB="${PGDATABASE:-mado}"
SUPER="${PGUSER:-postgres}"
# Before the upgrade this is mado_owner's password, after it the renamed superuser's.
SUPER_PW="$PGPASSWORD"
quiet=false
[ "${1:-}" = "--if-needed" ] && quiet=true

q() { PGOPTIONS="-c client_min_messages=warning" psql -v ON_ERROR_STOP=1 -X -q -At "$@"; }

legacy="$(PGUSER=mado_owner PGPASSWORD="$SUPER_PW" q -d postgres -c "SELECT rolsuper FROM pg_roles WHERE rolname = current_user" 2>/dev/null || true)"
if [ "$legacy" != "t" ]; then
  $quiet || echo "upgrade-roles: nothing to do, mado_owner is not a superuser"
  exit 0
fi
: "${MADO_OWNER_PASSWORD:?upgrade-roles: set MADO_OWNER_PASSWORD in .env first}"
echo "upgrade-roles: mado_owner is the bootstrap superuser; moving mado to a non-superuser owner"

# The rename needs a second superuser session: a role can't rename itself.
tmp_pw="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')"
PGUSER=mado_owner PGPASSWORD="$SUPER_PW" q -d postgres -v pw="$tmp_pw" <<'SQL'
DROP ROLE IF EXISTS mado_upgrade;
CREATE ROLE mado_upgrade LOGIN SUPERUSER PASSWORD :'pw';
SQL
cleanup() {
  for user in "$SUPER" mado_owner; do
    PGUSER="$user" PGPASSWORD="$SUPER_PW" q -d postgres -c "DROP ROLE IF EXISTS mado_upgrade" 2>/dev/null && return
  done
}
trap cleanup EXIT

PGUSER=mado_upgrade PGPASSWORD="$tmp_pw" q -d "$DB" -v super="$SUPER" -v superpw="$SUPER_PW" -v ownerpw="$MADO_OWNER_PASSWORD" -v db="$DB" <<'SQL'
BEGIN;
ALTER ROLE mado_owner RENAME TO :"super";
-- MD5 passwords are salted with the role name, so a rename can clear it. Set it again either way.
ALTER ROLE :"super" PASSWORD :'superpw';
CREATE ROLE mado_owner LOGIN NOSUPERUSER NOCREATEDB CREATEROLE PASSWORD :'ownerpw';
-- roles.sql sets these roles' passwords and grants on every start, which needs ADMIN on them.
GRANT mado_app, mado_purge TO mado_owner WITH ADMIN TRUE, INHERIT FALSE, SET FALSE;
SET LOCAL mado.super TO :'super';

DO $$
DECLARE
  boot oid := (SELECT oid FROM pg_roles WHERE rolname = current_setting('mado.super'));
  r record;
BEGIN
  -- pg-boss' schema belongs to the app role, which creates it at runtime.
  CREATE TEMP TABLE targets ON COMMIT DROP AS
    SELECT nspname, CASE WHEN nspname = 'pgboss' THEN 'mado_app' ELSE 'mado_owner' END AS owner
    FROM pg_namespace WHERE nspname IN ('public', 'drizzle', 'pgboss');

  FOR r IN
    SELECT n.nspname, c.relname, t.owner,
      CASE c.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'f' THEN 'FOREIGN TABLE' WHEN 'S' THEN 'SEQUENCE' ELSE 'TABLE' END AS kind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN targets t ON t.nspname = n.nspname
    WHERE c.relowner = boot
      AND (c.relkind IN ('r', 'p', 'v', 'm', 'f')
        -- Sequences owned by a column move with their table.
        OR (c.relkind = 'S' AND NOT EXISTS (
          SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype IN ('a', 'i'))))
  LOOP
    EXECUTE format('ALTER %s %I.%I OWNER TO %I', r.kind, r.nspname, r.relname, r.owner);
  END LOOP;

  FOR r IN
    SELECT n.nspname, ty.typname, t.owner
    FROM pg_type ty
    JOIN pg_namespace n ON n.oid = ty.typnamespace
    JOIN targets t ON t.nspname = n.nspname
    WHERE ty.typowner = boot
      AND (ty.typtype IN ('e', 'd') OR (ty.typtype = 'c' AND (SELECT relkind FROM pg_class WHERE oid = ty.typrelid) = 'c'))
  LOOP
    EXECUTE format('ALTER TYPE %I.%I OWNER TO %I', r.nspname, r.typname, r.owner);
  END LOOP;

  FOR r IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args, t.owner
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN targets t ON t.nspname = n.nspname
    WHERE p.proowner = boot
  LOOP
    EXECUTE format('ALTER ROUTINE %I.%I(%s) OWNER TO %I', r.nspname, r.proname, r.args, r.owner);
  END LOOP;

  FOR r IN SELECT n.nspname, t.owner FROM pg_namespace n JOIN targets t ON t.nspname = n.nspname WHERE n.nspowner = boot LOOP
    EXECUTE format('ALTER SCHEMA %I OWNER TO %I', r.nspname, r.owner);
  END LOOP;
END $$;

ALTER DATABASE :"db" OWNER TO mado_owner;
COMMIT;
SQL

echo "upgrade-roles: done. The superuser is now '$SUPER' (password POSTGRES_PASSWORD); mado_owner uses MADO_OWNER_PASSWORD."
