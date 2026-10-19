CREATE TABLE IF NOT EXISTS deleted_entries(id TEXT PRIMARY KEY,kind TEXT NOT NULL,record_id TEXT NOT NULL,label TEXT NOT NULL,deleted_at TEXT NOT NULL,files TEXT NOT NULL,state TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS deleted_records(entry_id TEXT NOT NULL,kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,version INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(kind,id));
CREATE INDEX IF NOT EXISTS deleted_by_entry ON deleted_records(entry_id);
CREATE TABLE IF NOT EXISTS retired_records(kind TEXT NOT NULL,id TEXT NOT NULL,deletion_id TEXT NOT NULL,PRIMARY KEY(kind,id));
CREATE TRIGGER IF NOT EXISTS block_retired_insert BEFORE INSERT ON records WHEN EXISTS(SELECT 1 FROM retired_records WHERE kind=NEW.kind AND id=NEW.id) BEGIN SELECT RAISE(ABORT,'entry_deleted'); END;
CREATE TRIGGER IF NOT EXISTS block_retired_update BEFORE UPDATE ON records WHEN EXISTS(SELECT 1 FROM retired_records WHERE kind=NEW.kind AND id=NEW.id) BEGIN SELECT RAISE(ABORT,'entry_deleted'); END;

CREATE TRIGGER IF NOT EXISTS block_deleted_parent BEFORE INSERT ON records WHEN EXISTS(SELECT 1 FROM retired_records WHERE (kind='lecture' AND id=json_extract(NEW.data,'$.lectureId')) OR (kind='support-thread' AND id=json_extract(NEW.data,'$.threadId')) OR (kind='prayer-session' AND id=json_extract(NEW.data,'$.sessionId'))) BEGIN SELECT RAISE(ABORT,'entry_deleted'); END;
CREATE INDEX IF NOT EXISTS private_object_drive_id ON private_objects(drive_id);
CREATE INDEX IF NOT EXISTS chunk_drive_id ON chunks(drive_id);
CREATE INDEX IF NOT EXISTS pending_drive_id ON upload_pending(drive_id);
CREATE INDEX IF NOT EXISTS assembly_drive_id ON file_assembly(drive_id);
CREATE INDEX IF NOT EXISTS deleted_entry_order ON deleted_entries(deleted_at DESC,id DESC);
