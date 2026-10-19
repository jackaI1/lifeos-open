CREATE INDEX IF NOT EXISTS assistant_thread_scope ON records(json_extract(data,'$.scope'),updated_at) WHERE kind='support-thread';
CREATE INDEX IF NOT EXISTS assistant_message_thread ON records(json_extract(data,'$.threadId'),created_at) WHERE kind='support-message';
CREATE INDEX IF NOT EXISTS assistant_proposal_thread ON records(json_extract(data,'$.threadId'),created_at) WHERE kind='assistant-proposal';
