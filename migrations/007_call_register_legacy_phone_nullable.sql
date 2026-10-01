SET @make_legacy_phone_nullable = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'call_register' AND column_name = 'phone') > 0,
  'ALTER TABLE call_register MODIFY COLUMN phone VARCHAR(20) NULL',
  'SELECT 1'
);
PREPARE statement FROM @make_legacy_phone_nullable;
EXECUTE statement;
DEALLOCATE PREPARE statement;