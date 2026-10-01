SET @add_year_from = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'inventory_parts' AND column_name = 'year_from') = 0,
  'ALTER TABLE inventory_parts ADD COLUMN year_from VARCHAR(50) NULL AFTER year',
  'SELECT 1'
);
PREPARE statement FROM @add_year_from;
EXECUTE statement;
DEALLOCATE PREPARE statement;

SET @add_year_to = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'inventory_parts' AND column_name = 'year_to') = 0,
  'ALTER TABLE inventory_parts ADD COLUMN year_to VARCHAR(50) NULL AFTER year_from',
  'SELECT 1'
);
PREPARE statement FROM @add_year_to;
EXECUTE statement;
DEALLOCATE PREPARE statement;

SET @add_exact_year = IF(
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'inventory_parts' AND column_name = 'is_exact_year_only') = 0,
  'ALTER TABLE inventory_parts ADD COLUMN is_exact_year_only TINYINT(1) NOT NULL DEFAULT 0 AFTER year_to',
  'SELECT 1'
);
PREPARE statement FROM @add_exact_year;
EXECUTE statement;
DEALLOCATE PREPARE statement;
