ALTER TABLE pbx_call_logs ADD COLUMN IF NOT EXISTS queue_name VARCHAR(32) NULL AFTER destination;
ALTER TABLE pbx_call_logs ADD COLUMN IF NOT EXISTS ivr_language VARCHAR(24) NULL AFTER caller_name;
ALTER TABLE pbx_call_logs ADD COLUMN IF NOT EXISTS rejected_by_exts VARCHAR(255) NULL AFTER answered_by_ext;

UPDATE pbx_call_logs
SET status = 'ended',
    ended_at = COALESCE(ended_at, answered_at, started_at)
WHERE id > 0
  AND status = 'answered'
  AND started_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 2 HOUR);

UPDATE pbx_call_logs
SET status = 'missed',
    answered_by_ext = NULL,
    ended_at = COALESCE(ended_at, started_at)
WHERE id > 0
  AND status = 'ringing'
  AND started_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 5 MINUTE);
