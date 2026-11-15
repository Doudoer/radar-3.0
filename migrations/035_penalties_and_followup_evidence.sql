ALTER TABLE users ADD COLUMN IF NOT EXISTS salary_tier SMALLINT NULL AFTER weekly_salary;
ALTER TABLE users ADD COLUMN IF NOT EXISTS penalty_rate DECIMAL(6,4) NULL AFTER salary_tier;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS followup_closed_at DATETIME NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS followup_closed_by INT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS followup_closed_reason VARCHAR(200) NULL;
CREATE INDEX IF NOT EXISTS orders_followup_closed ON orders (followup_closed_at);

ALTER TABLE order_workflow_events ADD COLUMN IF NOT EXISTS extended_until DATE NULL;
CREATE INDEX IF NOT EXISTS idx_workflow_extended ON order_workflow_events (extended_until);

CREATE TABLE IF NOT EXISTS app_settings (
  setting_key VARCHAR(80) NOT NULL PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_by INT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS penalty_rate_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  previous_rate DECIMAL(6,4) NULL,
  new_rate DECIMAL(6,4) NULL,
  salary_tier SMALLINT NULL,
  changed_by INT UNSIGNED NULL,
  changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  note VARCHAR(300) NULL,
  INDEX penalty_rate_history_user (user_id, changed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS followup_evidence (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_id INT UNSIGNED NOT NULL,
  task VARCHAR(32) NOT NULL,
  event_id BIGINT UNSIGNED NULL,
  claim_id INT UNSIGNED NULL,
  channel ENUM('whatsapp','sms','call','visit') NOT NULL,
  kind ENUM('message_screenshot','call_screenshot','call_audio') NOT NULL,
  file_url VARCHAR(255) NOT NULL,
  duration_seconds INT NULL,
  called_at DATETIME NULL,
  status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  note VARCHAR(500) NULL,
  uploaded_by INT UNSIGNED NOT NULL,
  reviewed_by INT UNSIGNED NULL,
  reviewed_at DATETIME NULL,
  review_note VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX followup_evidence_order (order_id, task, status),
  INDEX followup_evidence_queue (status, created_at),
  INDEX followup_evidence_uploader (uploaded_by, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_penalties (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NULL,
  source VARCHAR(24) NOT NULL,
  reference_key VARCHAR(48) NOT NULL DEFAULT 'legacy',
  units INT NOT NULL DEFAULT 0,
  rate DECIMAL(6,4) NOT NULL,
  percent DECIMAL(6,2) NOT NULL,
  weekly_salary DECIMAL(10,2) NULL,
  amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  period_start DATETIME NOT NULL,
  period_end DATETIME NOT NULL,
  cutoff_at DATETIME NOT NULL,
  status ENUM('pending','verified','rejected','liquidated','void') NOT NULL DEFAULT 'pending',
  liquidated_at DATETIME NULL,
  evidence_id BIGINT UNSIGNED NULL,
  notes VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY order_penalties_period (order_id, reference_key, period_end),
  INDEX order_penalties_user_period (user_id, period_end),
  INDEX order_penalties_status (status, period_end),
  INDEX order_penalties_liquidated (liquidated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX IF NOT EXISTS claims_resolved ON claims (resolved_by, resolved_at);
CREATE INDEX IF NOT EXISTS status_orders_status_created ON status_orders (status, created_at);
