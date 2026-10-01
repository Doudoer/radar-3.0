SET @add_caller_name = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'call_register' AND column_name = 'caller_name') = 0,
  'ALTER TABLE call_register ADD COLUMN caller_name VARCHAR(200) NULL AFTER claim_id',
  'SELECT 1'
);
PREPARE statement FROM @add_caller_name;
EXECUTE statement;
DEALLOCATE PREPARE statement;

SET @add_caller_phone = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'call_register' AND column_name = 'caller_phone') = 0,
  'ALTER TABLE call_register ADD COLUMN caller_phone VARCHAR(40) NULL AFTER caller_name',
  'SELECT 1'
);
PREPARE statement FROM @add_caller_phone;
EXECUTE statement;
DEALLOCATE PREPARE statement;

SET @add_attended_by = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'call_register' AND column_name = 'attended_by') = 0,
  'ALTER TABLE call_register ADD COLUMN attended_by VARCHAR(200) NULL AFTER caller_phone',
  'SELECT 1'
);
PREPARE statement FROM @add_attended_by;
EXECUTE statement;
DEALLOCATE PREPARE statement;

SET @add_conversation_summary = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'call_register' AND column_name = 'conversation_summary') = 0,
  'ALTER TABLE call_register ADD COLUMN conversation_summary TEXT NULL AFTER attended_by',
  'SELECT 1'
);
PREPARE statement FROM @add_conversation_summary;
EXECUTE statement;
DEALLOCATE PREPARE statement;

SET @add_whatsapp_dispatched = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'call_register' AND column_name = 'whatsapp_dispatched') = 0,
  'ALTER TABLE call_register ADD COLUMN whatsapp_dispatched TINYINT(1) NOT NULL DEFAULT 0 AFTER conversation_summary',
  'SELECT 1'
);
PREPARE statement FROM @add_whatsapp_dispatched;
EXECUTE statement;
DEALLOCATE PREPARE statement;

SET @add_whatsapp_message = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'call_register' AND column_name = 'whatsapp_message') = 0,
  'ALTER TABLE call_register ADD COLUMN whatsapp_message TEXT NULL AFTER whatsapp_dispatched',
  'SELECT 1'
);
PREPARE statement FROM @add_whatsapp_message;
EXECUTE statement;
DEALLOCATE PREPARE statement;

SET @backfill_legacy_calls = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'call_register' AND column_name = 'contact_name') > 0,
  'UPDATE call_register SET caller_name = COALESCE(caller_name, contact_name), caller_phone = COALESCE(caller_phone, phone), conversation_summary = COALESCE(conversation_summary, description)',
  'SELECT 1'
);
PREPARE statement FROM @backfill_legacy_calls;
EXECUTE statement;
DEALLOCATE PREPARE statement;