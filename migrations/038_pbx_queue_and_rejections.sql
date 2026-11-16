ALTER TABLE pbx_call_logs
  ADD COLUMN queue_name VARCHAR(32) NULL AFTER destination,
  ADD COLUMN ivr_language VARCHAR(24) NULL AFTER caller_name,
  ADD COLUMN rejected_by_exts VARCHAR(255) NULL AFTER answered_by_ext;

UPDATE pbx_call_logs
SET status = 'ended',
    ended_at = COALESCE(ended_at, answered_at, started_at)
WHERE status = 'answered'
  AND started_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 2 HOUR);

UPDATE pbx_call_logs
SET status = 'missed',
    answered_by_ext = NULL,
    ended_at = COALESCE(ended_at, started_at)
WHERE status = 'ringing'
  AND started_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 5 MINUTE);
