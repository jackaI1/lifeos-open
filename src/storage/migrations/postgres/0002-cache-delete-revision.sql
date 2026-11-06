-- Raw deletes (including workers) must invalidate record lists and detail caches.
CREATE OR REPLACE FUNCTION lifeos_record_delete_revision() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO kind_revisions VALUES(OLD.kind,1) ON CONFLICT(kind) DO UPDATE SET version=kind_revisions.version+1;
 RETURN OLD;
END $$;
CREATE TRIGGER record_delete_revision AFTER DELETE ON records FOR EACH ROW EXECUTE FUNCTION lifeos_record_delete_revision();
