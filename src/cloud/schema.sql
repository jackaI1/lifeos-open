CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL CHECK(json_valid(data)),version INTEGER NOT NULL CHECK(version>0),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(kind,id));
CREATE INDEX IF NOT EXISTS record_kind_updated ON records(kind,updated_at DESC,id);
CREATE INDEX IF NOT EXISTS calendar_record_source ON records(kind,json_extract(data,'$.calendarId'));
CREATE TABLE IF NOT EXISTS calendar_seen(calendar_id TEXT NOT NULL,record_id TEXT NOT NULL,run_id TEXT NOT NULL,PRIMARY KEY(calendar_id,record_id));
CREATE TABLE IF NOT EXISTS kind_revisions(kind TEXT PRIMARY KEY,version INTEGER NOT NULL);
CREATE TRIGGER IF NOT EXISTS record_insert_revision AFTER INSERT ON records BEGIN INSERT INTO kind_revisions VALUES(NEW.kind,1) ON CONFLICT(kind) DO UPDATE SET version=version+1; END;
CREATE TRIGGER IF NOT EXISTS record_update_revision AFTER UPDATE ON records BEGIN INSERT INTO kind_revisions VALUES(NEW.kind,1) ON CONFLICT(kind) DO UPDATE SET version=version+1; END;
CREATE TABLE IF NOT EXISTS audit(id TEXT PRIMARY KEY,kind TEXT NOT NULL,record_id TEXT NOT NULL,before_json TEXT,after_json TEXT,created_at TEXT NOT NULL,actor TEXT NOT NULL,undo_of TEXT UNIQUE);
CREATE INDEX IF NOT EXISTS audit_created ON audit(created_at DESC);
CREATE INDEX IF NOT EXISTS audit_record_version ON audit(kind,record_id,CAST(json_extract(after_json,'$.version') AS INTEGER) DESC);
CREATE TABLE IF NOT EXISTS mutations(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,result TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS assertions(id TEXT PRIMARY KEY,ok INTEGER NOT NULL CHECK(ok=1));
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,csrf TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS session_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS oauth_logins(state_hash TEXT PRIMARY KEY,nonce TEXT NOT NULL,verifier TEXT NOT NULL,expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,type TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL,priority INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,max_attempts INTEGER NOT NULL DEFAULT 3,available_at INTEGER NOT NULL,lease_until INTEGER,lease_owner TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,result TEXT,error TEXT,progress TEXT,cancel_requested INTEGER NOT NULL DEFAULT 0,authority TEXT NOT NULL,dedupe_key TEXT UNIQUE,component TEXT NOT NULL DEFAULT 'ai');
CREATE INDEX IF NOT EXISTS job_claim ON jobs(component,status,available_at,priority);
CREATE INDEX IF NOT EXISTS job_lease ON jobs(status,lease_until);
CREATE INDEX IF NOT EXISTS job_created ON jobs(created_at DESC);
CREATE TABLE IF NOT EXISTS chunks(session_id TEXT NOT NULL,chunk_index INTEGER NOT NULL,sha256 TEXT NOT NULL,drive_id TEXT NOT NULL,size INTEGER NOT NULL,mime_type TEXT NOT NULL,PRIMARY KEY(session_id,chunk_index));
CREATE TABLE IF NOT EXISTS upload_pending(session_id TEXT NOT NULL,chunk_index INTEGER NOT NULL,sha256 TEXT NOT NULL,drive_id TEXT NOT NULL,size INTEGER NOT NULL,mime_type TEXT NOT NULL,capability TEXT,lease_owner TEXT,lease_until INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(session_id,chunk_index));
CREATE TABLE IF NOT EXISTS heartbeats(name TEXT PRIMARY KEY,at INTEGER NOT NULL,last_success INTEGER,details TEXT);
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS worker_credentials(token_hash TEXT PRIMARY KEY,component TEXT NOT NULL,expires_at INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS presence_devices(id TEXT PRIMARY KEY,label TEXT NOT NULL,token_hash TEXT UNIQUE NOT NULL,created_at TEXT NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS source_catalogue(id TEXT PRIMARY KEY,url TEXT NOT NULL,title TEXT NOT NULL,status TEXT NOT NULL,content_hash TEXT,checked_at INTEGER,last_success INTEGER,interpreted_at INTEGER,cursor TEXT,data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS source_status ON source_catalogue(status,checked_at);
CREATE TABLE IF NOT EXISTS ai_reservations(id TEXT PRIMARY KEY,category TEXT NOT NULL,model TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,budget TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ai_reservation_expiry ON ai_reservations(expires_at);
CREATE TABLE IF NOT EXISTS ai_usage(id TEXT PRIMARY KEY,category TEXT NOT NULL,model TEXT NOT NULL,started_at INTEGER NOT NULL,ended_at INTEGER,before_json TEXT NOT NULL,after_json TEXT,result TEXT);
CREATE TABLE IF NOT EXISTS backup_rows(snapshot TEXT NOT NULL,sequence INTEGER PRIMARY KEY AUTOINCREMENT,table_name TEXT NOT NULL,value TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS backup_page ON backup_rows(snapshot,sequence);
CREATE TABLE IF NOT EXISTS backup_files(snapshot TEXT NOT NULL,page INTEGER NOT NULL,drive_id TEXT NOT NULL,sha256 TEXT NOT NULL,last_sequence INTEGER NOT NULL,verified INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(snapshot,page));
CREATE TABLE IF NOT EXISTS trusted_document_reads(document_id TEXT PRIMARY KEY,revision_id TEXT NOT NULL,content TEXT NOT NULL,fingerprint TEXT NOT NULL,read_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS private_objects(object_key TEXT PRIMARY KEY,drive_id TEXT NOT NULL,sha256 TEXT NOT NULL,size INTEGER NOT NULL,mime_type TEXT NOT NULL,folder_id TEXT NOT NULL,verified INTEGER NOT NULL DEFAULT 0);

CREATE INDEX IF NOT EXISTS routine_spiritual_date ON records(kind,json_extract(data,'$.date'));
CREATE INDEX IF NOT EXISTS routine_task_status ON records(kind,json_extract(data,'$.status'));
CREATE INDEX IF NOT EXISTS routine_calendar_start ON records(kind,COALESCE(json_extract(data,'$.start.dateTime'),json_extract(data,'$.start.date')));
CREATE TABLE IF NOT EXISTS trusted_document_parts(document_id TEXT NOT NULL,revision_id TEXT NOT NULL,part_index INTEGER NOT NULL,content TEXT NOT NULL,PRIMARY KEY(document_id,part_index));
CREATE TABLE IF NOT EXISTS file_assembly(session_id TEXT PRIMARY KEY,drive_id TEXT NOT NULL,total_size INTEGER NOT NULL,chunk_count INTEGER NOT NULL,mime_type TEXT NOT NULL,state TEXT NOT NULL,capability TEXT,uploaded_offset INTEGER NOT NULL DEFAULT 0,next_chunk INTEGER NOT NULL DEFAULT 0,carry TEXT,pending_end INTEGER,pending_state TEXT,verify_index INTEGER NOT NULL DEFAULT 0,verify_offset INTEGER NOT NULL DEFAULT 0,CHECK(length(carry)<349528));

CREATE INDEX IF NOT EXISTS devotional_history_day ON records(COALESCE(json_extract(data,'$.displayOverrides.date'),json_extract(data,'$.sourceUpdateDay'),json_extract(data,'$.historyReconciliation.devotionalDate'),json_extract(data,'$.date'))) WHERE kind='devotional-import';

CREATE INDEX IF NOT EXISTS assistant_thread_scope ON records(json_extract(data,'$.scope'),updated_at) WHERE kind='support-thread';
CREATE INDEX IF NOT EXISTS assistant_message_thread ON records(json_extract(data,'$.threadId'),created_at) WHERE kind='support-message';
CREATE INDEX IF NOT EXISTS assistant_proposal_thread ON records(json_extract(data,'$.threadId'),created_at) WHERE kind='assistant-proposal';

CREATE INDEX IF NOT EXISTS finance_record_day ON records(json_extract(data,'$.date') DESC,id) WHERE kind='finance-transaction';
CREATE TABLE IF NOT EXISTS ai_reply_stream(job_id TEXT PRIMARY KEY,thread_id TEXT NOT NULL,lease_owner TEXT NOT NULL,sequence INTEGER NOT NULL,reply TEXT NOT NULL,updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS assistant_lecture_thread ON records(json_extract(data,'$.lectureId'),updated_at DESC) WHERE kind='support-thread' AND json_extract(data,'$.scope')='lecture';
CREATE INDEX IF NOT EXISTS inspire_task_job ON jobs(json_extract(payload,'$.taskId'),created_at DESC) WHERE type='inspire';

CREATE INDEX IF NOT EXISTS lecture_study_due ON records(json_extract(data,'$.courseId'),json_extract(data,'$.dueDay')) WHERE kind='lecture-study-item' AND json_extract(data,'$.type')='review';
CREATE INDEX IF NOT EXISTS lecture_study_job ON jobs(json_extract(payload,'$.lectureId'),created_at DESC) WHERE type='lecture-study';

CREATE TABLE IF NOT EXISTS d1_operation_usage(day TEXT NOT NULL,operation TEXT NOT NULL,rows_read INTEGER NOT NULL DEFAULT 0,rows_written INTEGER NOT NULL DEFAULT 0,calls INTEGER NOT NULL DEFAULT 0,blocked INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL,PRIMARY KEY(day,operation));

CREATE TABLE IF NOT EXISTS notification_receipts(id TEXT PRIMARY KEY,notice TEXT NOT NULL,route TEXT NOT NULL,reason TEXT NOT NULL,stage TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS notification_receipt_time ON notification_receipts(created_at DESC);

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
