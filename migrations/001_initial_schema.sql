CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  email VARCHAR(254) NOT NULL,
  password VARCHAR(255) NOT NULL,
  role VARCHAR(40) NOT NULL DEFAULT 'operator',
  permissions JSON NULL,
  theme VARCHAR(40) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL DEFAULT NULL,
  UNIQUE KEY users_email_unique (email),
  INDEX users_active_deleted (active, deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customers (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  first_name VARCHAR(120) NOT NULL,
  last_name VARCHAR(120) NULL,
  phone VARCHAR(40) NULL,
  whatsapp VARCHAR(40) NULL,
  email VARCHAR(254) NULL,
  address_shipping VARCHAR(500) NULL,
  zip_code VARCHAR(20) NULL,
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL DEFAULT NULL,
  INDEX customers_name (first_name, last_name),
  INDEX customers_phone (phone),
  INDEX customers_deleted (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS orders (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_code VARCHAR(80) NOT NULL,
  customer_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NULL,
  vin_nr VARCHAR(40) NULL,
  brand VARCHAR(100) NULL,
  model VARCHAR(100) NULL,
  sub_model VARCHAR(100) NULL,
  year SMALLINT UNSIGNED NULL,
  color VARCHAR(80) NULL,
  product_type VARCHAR(200) NOT NULL,
  transmission_type VARCHAR(100) NULL,
  product_specs TEXT NULL,
  stock_nr VARCHAR(120) NULL,
  price DECIMAL(12,2) NOT NULL DEFAULT 0,
  core_fee DECIMAL(12,2) NOT NULL DEFAULT 0,
  down_payment DECIMAL(12,2) NOT NULL DEFAULT 0,
  shipping_toggle TINYINT(1) NOT NULL DEFAULT 0,
  shipping_address VARCHAR(500) NULL,
  shipping_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
  warranty_days INT UNSIGNED NOT NULL DEFAULT 60,
  status VARCHAR(80) NOT NULL DEFAULT 'Cotización',
  workflow_step TINYINT UNSIGNED NOT NULL DEFAULT 1,
  scheduled_pickup_at DATETIME NULL,
  delivered_at DATETIME NULL,
  warranty_started TINYINT(1) NOT NULL DEFAULT 0,
  description TEXT NULL,
  claim_reason TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL DEFAULT NULL,
  UNIQUE KEY orders_code_unique (order_code),
  INDEX orders_status_created (status, created_at),
  INDEX orders_customer (customer_id),
  INDEX orders_user (user_id),
  INDEX orders_deleted (deleted_at),
  CONSTRAINT orders_customer_fk FOREIGN KEY (customer_id) REFERENCES customers (id),
  CONSTRAINT orders_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS status_orders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_id INT UNSIGNED NOT NULL,
  status VARCHAR(80) NOT NULL,
  description TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX status_orders_order_created (order_id, created_at),
  CONSTRAINT status_orders_order_fk FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS claims (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_id INT UNSIGNED NOT NULL,
  description TEXT NOT NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'Pending',
  assigned_user_id INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL DEFAULT NULL,
  INDEX claims_order (order_id),
  INDEX claims_status_created (status, created_at),
  INDEX claims_assigned_user (assigned_user_id),
  CONSTRAINT claims_order_fk FOREIGN KEY (order_id) REFERENCES orders (id),
  CONSTRAINT claims_user_fk FOREIGN KEY (assigned_user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS call_register (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_id INT UNSIGNED NOT NULL,
  claim_id INT UNSIGNED NULL,
  caller_name VARCHAR(200) NULL,
  caller_phone VARCHAR(40) NULL,
  attended_by VARCHAR(200) NULL,
  conversation_summary TEXT NULL,
  whatsapp_dispatched TINYINT(1) NOT NULL DEFAULT 0,
  whatsapp_message TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX call_register_order_created (order_id, created_at),
  INDEX call_register_claim (claim_id),
  CONSTRAINT call_register_order_fk FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,
  CONSTRAINT call_register_claim_fk FOREIGN KEY (claim_id) REFERENCES claims (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS logistics_lists (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS logistics_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  list_id INT UNSIGNED NULL,
  order_id INT UNSIGNED NULL,
  status VARCHAR(80) NULL,
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX logistics_items_list (list_id),
  INDEX logistics_items_order (order_id),
  CONSTRAINT logistics_items_list_fk FOREIGN KEY (list_id) REFERENCES logistics_lists (id) ON DELETE SET NULL,
  CONSTRAINT logistics_items_order_fk FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS personal_notes (
  user_id INT NOT NULL PRIMARY KEY,
  content LONGTEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX personal_notes_updated_at (updated_at),
  CONSTRAINT personal_notes_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS personal_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  sender_id INT NOT NULL,
  recipient_id INT NOT NULL,
  subject VARCHAR(160) NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  read_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX personal_messages_recipient (recipient_id, created_at),
  INDEX personal_messages_sender (sender_id, created_at),
  CONSTRAINT personal_messages_sender_fk FOREIGN KEY (sender_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT personal_messages_recipient_fk FOREIGN KEY (recipient_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
