-- Migration 042: Employee commissions with 12h yard availability check, carryover debt and call penalties
CREATE TABLE IF NOT EXISTS employee_commissions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  order_id INT UNSIGNED NOT NULL,
  type ENUM('downpayment_sale', 'delivered_closed') NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  status ENUM('pending_yard_check', 'earned', 'voided_availability', 'paid') NOT NULL DEFAULT 'pending_yard_check',
  available_at DATETIME NOT NULL,
  earned_at DATETIME NULL,
  voided_at DATETIME NULL,
  notes VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_commission_order_type (order_id, type),
  INDEX idx_commissions_user_status (user_id, status),
  INDEX idx_commissions_available (available_at, status),
  INDEX idx_commissions_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS employee_penalty_carryover (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  period_end VARCHAR(32) NOT NULL,
  carryover_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  covered_amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  status ENUM('pending', 'cleared') NOT NULL DEFAULT 'pending',
  notes VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_period (user_id, period_end),
  INDEX idx_user_carryover (user_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
