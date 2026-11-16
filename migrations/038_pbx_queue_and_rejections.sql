ALTER TABLE pbx_call_logs ADD COLUMN IF NOT EXISTS queue_name VARCHAR(32) NULL AFTER destination;
ALTER TABLE pbx_call_logs ADD COLUMN IF NOT EXISTS ivr_language VARCHAR(24) NULL AFTER caller_name;
ALTER TABLE pbx_call_logs ADD COLUMN IF NOT EXISTS rejected_by_exts VARCHAR(255) NULL AFTER answered_by_ext;
