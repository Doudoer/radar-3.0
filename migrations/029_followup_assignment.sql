CREATE TABLE IF NOT EXISTS order_followup_assignments (
  order_id INT UNSIGNED NOT NULL PRIMARY KEY,
  advisor_id INT UNSIGNED NOT NULL,
  assigned_by INT UNSIGNED NOT NULL,
  assigned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_followup_advisor (advisor_id, order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
