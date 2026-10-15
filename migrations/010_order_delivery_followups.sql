-- Migration: 010_order_delivery_followups.sql
-- Description: Create table for tracking 14-day post-delivery customer calls and warranty early check-ins

CREATE TABLE IF NOT EXISTS order_delivery_followups (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  operator_name VARCHAR(200) NOT NULL,
  contact_channel VARCHAR(20) NOT NULL DEFAULT 'call',
  call_result VARCHAR(50) NOT NULL DEFAULT 'answered',
  part_status VARCHAR(50) NOT NULL DEFAULT 'not_installed',
  warranty_warning_given TINYINT(1) NOT NULL DEFAULT 0,
  promised_install_date DATE NULL,
  notes TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_odf_order (order_id),
  INDEX idx_odf_operator (operator_name),
  INDEX idx_odf_created (created_at),
  CONSTRAINT fk_odf_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
