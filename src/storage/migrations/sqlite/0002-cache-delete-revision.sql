-- Raw deletes (including workers) must invalidate record lists and detail caches.
CREATE TRIGGER IF NOT EXISTS record_delete_revision AFTER DELETE ON records BEGIN
 INSERT INTO kind_revisions VALUES(OLD.kind,1) ON CONFLICT(kind) DO UPDATE SET version=version+1;
END;
