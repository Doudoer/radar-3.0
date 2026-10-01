SET @add_sold_at = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'inventory_parts' AND column_name = 'sold_at') = 0,
  'ALTER TABLE inventory_parts ADD COLUMN sold_at TIMESTAMP NULL DEFAULT NULL AFTER updated_at',
  'SELECT 1'
);
PREPARE statement FROM @add_sold_at;
EXECUTE statement;
DEALLOCATE PREPARE statement;
