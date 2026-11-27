-- Migration 044: Penalty Appeals system for automatic penalties
CREATE TABLE IF NOT EXISTS penalty_appeals (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  penalty_id BIGINT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  category VARCHAR(50) NOT NULL,
  reason TEXT NOT NULL,
  evidence_urls JSON NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  reviewed_by INT UNSIGNED NULL,
  reviewed_at DATETIME NULL,
  resolution_note VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_appeal_penalty (penalty_id),
  INDEX idx_appeal_user (user_id),
  INDEX idx_appeal_status (status)
);
