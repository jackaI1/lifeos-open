-- Raw deletes (including workers) must invalidate record lists and detail caches.
CREATE TRIGGER IF NOT EXISTS record_delete_revision AFTER DELETE ON records BEGIN
 INSERT INTO kind_revisions VALUES(OLD.kind,1) ON CONFLICT(kind) DO UPDATE SET version=version+1;
END;
-- Updates already bump NEW.kind; a move must also invalidate the previous kind.
CREATE TRIGGER IF NOT EXISTS record_move_revision AFTER UPDATE OF kind ON records
WHEN OLD.kind<>NEW.kind BEGIN
 INSERT INTO kind_revisions VALUES(OLD.kind,1) ON CONFLICT(kind) DO UPDATE SET version=version+1;
END;
