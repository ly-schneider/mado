-- Re-applied after every migration. The app role can never hard delete core data:
-- soft-deleted rows are purged only by the purge job, which connects as mado_purge.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'mado_app') THEN
    CREATE ROLE mado_app LOGIN PASSWORD 'mado';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'mado_purge') THEN
    CREATE ROLE mado_purge LOGIN PASSWORD 'mado';
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO mado_app, mado_purge;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mado_app, mado_purge;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM mado_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO mado_app;

-- Link and session tables are rebuilt or expire, so the app may delete rows there.
GRANT DELETE ON
  sessions, memberships, task_labels, task_docs, refs, favorites, agent_grant_projects, oauth_codes
TO mado_app;

-- Revisions and the audit log are append-only. The audit log keeps one exception: the
-- reverted_at marker set when an agent session is reverted.
REVOKE UPDATE ON revisions, audit_log FROM mado_app;
GRANT UPDATE (reverted_at) ON audit_log TO mado_app;

GRANT SELECT, DELETE ON ALL TABLES IN SCHEMA public TO mado_purge;
GRANT UPDATE ON tasks, docs, projects TO mado_purge;

-- pg-boss creates its own schema at runtime as the app role.
GRANT CREATE ON DATABASE mado TO mado_app;
