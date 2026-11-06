-- Raw deletes (including workers) must invalidate record lists and detail caches.
CREATE OR REPLACE FUNCTION lifeos_record_delete_revision() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO kind_revisions VALUES(OLD.kind,1) ON CONFLICT(kind) DO UPDATE SET version=kind_revisions.version+1;
 RETURN OLD;
END $$;
CREATE TRIGGER record_delete_revision AFTER DELETE ON records FOR EACH ROW EXECUTE FUNCTION lifeos_record_delete_revision();
-- The existing update trigger bumps NEW.kind. Reuse the OLD.kind bump on moves.
CREATE TRIGGER record_move_revision AFTER UPDATE OF kind ON records FOR EACH ROW
WHEN (OLD.kind IS DISTINCT FROM NEW.kind) EXECUTE FUNCTION lifeos_record_delete_revision();
