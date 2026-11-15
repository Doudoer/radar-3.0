ALTER TABLE users ADD COLUMN IF NOT EXISTS weekly_salary DECIMAL(10,2) NULL AFTER pin_hash;
ALTER TABLE users ADD COLUMN IF NOT EXISTS hired_on DATE NULL AFTER weekly_salary;
ALTER TABLE users ADD COLUMN IF NOT EXISTS address VARCHAR(255) NULL AFTER hired_on;
ALTER TABLE users ADD COLUMN IF NOT EXISTS emergency_contact_name VARCHAR(160) NULL AFTER address;
ALTER TABLE users ADD COLUMN IF NOT EXISTS emergency_contact_phone VARCHAR(40) NULL AFTER emergency_contact_name;

CREATE TABLE IF NOT EXISTS fault_catalog (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(255) NULL,
  points INT NOT NULL DEFAULT 0,
  amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS employee_faults (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  catalog_id INT NULL,
  fault_type VARCHAR(120) NOT NULL,
  points INT NOT NULL DEFAULT 0,
  amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  fault_date DATE NOT NULL,
  notes VARCHAR(500) NULL,
  status ENUM('activa', 'anulada') NOT NULL DEFAULT 'activa',
  created_by INT NULL,
  annulled_by INT NULL,
  annulled_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT employee_faults_catalog_fk FOREIGN KEY (catalog_id) REFERENCES fault_catalog (id) ON DELETE SET NULL,
  INDEX employee_faults_user_date (user_id, fault_date),
  INDEX employee_faults_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fault_appeals (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  fault_id INT NOT NULL,
  user_id INT NOT NULL,
  message VARCHAR(500) NOT NULL,
  status ENUM('pendiente', 'aceptada', 'rechazada') NOT NULL DEFAULT 'pendiente',
  resolution_note VARCHAR(500) NULL,
  resolved_by INT NULL,
  resolved_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fault_appeals_fault_fk FOREIGN KEY (fault_id) REFERENCES employee_faults (id) ON DELETE CASCADE,
  UNIQUE KEY fault_appeals_fault_unique (fault_id),
  INDEX fault_appeals_user_idx (user_id),
  INDEX fault_appeals_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
