-- Version 3: workspace isolation enforced by PostgreSQL row-level security.
-- Each row in records and audit names its workspace. PostgresDatabase sets
-- lifeos.workspace_id on every connection, and the policies show and change only rows
-- for that workspace. A connection with no workspace sees nothing and writes nothing.
-- FORCE applies the rule to the table owner as well. Superusers and roles with BYPASSRLS
-- still skip it, so the application should connect as an ordinary role.
ALTER TABLE records ADD COLUMN IF NOT EXISTS workspace_id TEXT;
UPDATE records SET workspace_id=COALESCE(NULLIF(current_setting('lifeos.workspace_id',true),''),'default') WHERE workspace_id IS NULL;
ALTER TABLE records ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE records ALTER COLUMN workspace_id SET DEFAULT current_setting('lifeos.workspace_id',true);
CREATE INDEX IF NOT EXISTS record_workspace_kind ON records(workspace_id,kind,updated_at DESC,id);
ALTER TABLE records ENABLE ROW LEVEL SECURITY;
ALTER TABLE records FORCE ROW LEVEL SECURITY;
CREATE POLICY records_workspace ON records
  USING (workspace_id=current_setting('lifeos.workspace_id',true))
  WITH CHECK (workspace_id=current_setting('lifeos.workspace_id',true));

ALTER TABLE audit ADD COLUMN IF NOT EXISTS workspace_id TEXT;
UPDATE audit SET workspace_id=COALESCE(NULLIF(current_setting('lifeos.workspace_id',true),''),'default') WHERE workspace_id IS NULL;
ALTER TABLE audit ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE audit ALTER COLUMN workspace_id SET DEFAULT current_setting('lifeos.workspace_id',true);
ALTER TABLE audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_workspace ON audit
  USING (workspace_id=current_setting('lifeos.workspace_id',true))
  WITH CHECK (workspace_id=current_setting('lifeos.workspace_id',true));
