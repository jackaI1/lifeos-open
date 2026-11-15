-- Version 3: row-level security on records, so a workspace can only read and write its own rows.
-- The active workspace comes from the transaction setting app.workspace_id, which the application
-- sets with set_config(..., true). With no setting, rows belong to the default workspace 'owner',
-- so single-workspace installs keep working. FORCE applies the policy to the table owner too.
-- Superusers and roles with BYPASSRLS still skip it, so the application must connect as a plain role.
CREATE OR REPLACE FUNCTION lifeos_current_workspace() RETURNS TEXT
LANGUAGE SQL STABLE PARALLEL SAFE AS $$
 SELECT COALESCE(NULLIF(current_setting('app.workspace_id', true), ''), 'owner')
$$;
ALTER TABLE records ADD COLUMN IF NOT EXISTS workspace_id TEXT NOT NULL DEFAULT lifeos_current_workspace();
ALTER TABLE records DROP CONSTRAINT IF EXISTS records_pkey;
ALTER TABLE records ADD CONSTRAINT records_pkey PRIMARY KEY (workspace_id, kind, id);
ALTER TABLE records ENABLE ROW LEVEL SECURITY;
ALTER TABLE records FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS records_workspace_isolation ON records;
CREATE POLICY records_workspace_isolation ON records
 USING (workspace_id = lifeos_current_workspace())
 WITH CHECK (workspace_id = lifeos_current_workspace());
