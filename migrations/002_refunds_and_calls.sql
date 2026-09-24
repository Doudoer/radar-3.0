CREATE TABLE IF NOT EXISTS refund_requests (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  amount_type VARCHAR(40) NOT NULL DEFAULT 'downpayment',
  payment_method VARCHAR(40) NOT NULL DEFAULT 'Zelle',
  payment_details TEXT NULL,
  reason VARCHAR(255) NOT NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'pending',
  completed_by VARCHAR(200) NULL,
  completed_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL DEFAULT NULL,
  INDEX refund_requests_order (order_id),
  INDEX refund_requests_status (status, created_at),
  INDEX refund_requests_deleted (deleted_at),
  CONSTRAINT refund_requests_order_fk FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

