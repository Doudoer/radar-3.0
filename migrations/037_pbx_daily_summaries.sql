CREATE TABLE IF NOT EXISTS pbx_daily_summaries (
  summary_date DATE NOT NULL PRIMARY KEY,
  total_calls INT NOT NULL DEFAULT 0,
  inbound_calls INT NOT NULL DEFAULT 0,
  outbound_calls INT NOT NULL DEFAULT 0,
  internal_calls INT NOT NULL DEFAULT 0,
  answered_calls INT NOT NULL DEFAULT 0,
  missed_calls INT NOT NULL DEFAULT 0,
  business_hours_calls INT NOT NULL DEFAULT 0,
  business_hours_answered INT NOT NULL DEFAULT 0,
  business_hours_missed INT NOT NULL DEFAULT 0,
  after_hours_calls INT NOT NULL DEFAULT 0,
  total_billsec_seconds INT NOT NULL DEFAULT 0,
  avg_billsec_seconds INT NOT NULL DEFAULT 0,
  closed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
