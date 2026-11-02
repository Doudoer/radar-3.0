ALTER TABLE customers ADD COLUMN IF NOT EXISTS company VARCHAR(150) NULL;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS type VARCHAR(50) NOT NULL DEFAULT 'Particular';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(100) NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS inventory_part_id INT UNSIGNED NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_zip_code VARCHAR(20) NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS contact_name VARCHAR(200) NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(40) NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS contact_email VARCHAR(254) NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS workflow_data JSON NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS auction_search_active TINYINT NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS orders_idempotency ON orders (idempotency_key);
CREATE INDEX IF NOT EXISTS orders_inventory ON orders (inventory_part_id);
ALTER TABLE claims ADD COLUMN IF NOT EXISTS previous_order_status VARCHAR(100) NULL;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS resolution_notes TEXT NULL;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS resolved_by INT NULL;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS resolved_at DATETIME NULL;
ALTER TABLE status_orders ADD COLUMN IF NOT EXISTS user_id INT NULL;
ALTER TABLE call_register ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;
ALTER TABLE refund_requests MODIFY COLUMN payment_method VARCHAR(40) NOT NULL;
ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS payment_contact TEXT NULL;
ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS previous_order_status VARCHAR(100) NULL;
ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(100) NULL;
ALTER TABLE refund_requests ADD COLUMN IF NOT EXISTS requested_by INT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS refunds_idempotency ON refund_requests (idempotency_key);

CREATE TABLE IF NOT EXISTS finance_state (
  id INT NOT NULL PRIMARY KEY,
  version INT NOT NULL DEFAULT 1,
  payload JSON NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;
INSERT IGNORE INTO finance_state (id, payload)
VALUES (1, '{"employees":[],"recurringExpenses":[],"otherExpenses":[]}');

CREATE TABLE IF NOT EXISTS finance_movements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  kind VARCHAR(20) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  effective_at DATETIME NULL,
  source VARCHAR(40) NOT NULL,
  reference_key VARCHAR(150) NOT NULL UNIQUE,
  user_id INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX finance_movements_order (order_id, kind),
  INDEX finance_movements_date (effective_at)
) ENGINE=InnoDB;
-- Preserve recorded advances without inventing their historical payment date.
INSERT IGNORE INTO finance_movements (order_id, kind, amount, source, reference_key)
SELECT id, 'payment', down_payment, 'legacy_baseline', CONCAT('legacy-payment-', id)
FROM orders WHERE down_payment > 0;
INSERT IGNORE INTO finance_movements (order_id, kind, amount, effective_at, source, reference_key)
SELECT order_id, 'refund', amount, completed_at, 'legacy_baseline', CONCAT('legacy-refund-', id)
FROM refund_requests WHERE status = 'completed';

CREATE TABLE IF NOT EXISTS finance_closures (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  week_start DATE NOT NULL UNIQUE,
  summary JSON NOT NULL,
  created_by INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS notification_outbox (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  payload JSON NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  available_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX outbox_pending (status, available_at)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS order_auction_links (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  url VARCHAR(1000) NOT NULL,
  auction_date DATE NULL,
  auction_type VARCHAR(40) NOT NULL DEFAULT 'Copart',
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX auction_order (order_id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS uploaded_files (
  filename VARCHAR(255) NOT NULL PRIMARY KEY,
  original_name VARCHAR(255) NOT NULL,
  content_type VARCHAR(100) NOT NULL,
  size_bytes BIGINT NOT NULL,
  user_id INT NOT NULL,
  order_id INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
