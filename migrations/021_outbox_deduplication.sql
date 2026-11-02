ALTER TABLE notification_outbox ADD COLUMN IF NOT EXISTS dedupe_key VARCHAR(191) NULL;
CREATE UNIQUE INDEX IF NOT EXISTS outbox_dedupe ON notification_outbox (dedupe_key);
