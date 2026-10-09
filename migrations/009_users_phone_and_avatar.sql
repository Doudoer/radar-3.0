-- Migration: 009_users_phone_and_avatar.sql
-- Description: Ensure phone and avatar_url columns exist in users table for complete profile management

-- Add phone if not present
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'users'
  AND COLUMN_NAME = 'phone';

SET @sql = IF(@col_exists = 0, 'ALTER TABLE users ADD COLUMN phone VARCHAR(50) NULL AFTER email', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add avatar_url if not present
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'users'
  AND COLUMN_NAME = 'avatar_url';

SET @sql = IF(@col_exists = 0, 'ALTER TABLE users ADD COLUMN avatar_url TEXT NULL AFTER phone', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
