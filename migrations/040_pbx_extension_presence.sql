CREATE TABLE IF NOT EXISTS pbx_extension_presence_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  extension VARCHAR(16) NOT NULL,
  status ENUM('online', 'offline') NOT NULL,
  reason VARCHAR(64) NULL,
  occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pbx_presence_ext_time (extension, occurred_at),
  INDEX idx_pbx_presence_time (occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
