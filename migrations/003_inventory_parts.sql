CREATE TABLE IF NOT EXISTS inventory_parts (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  year VARCHAR(50) NOT NULL,
  brand VARCHAR(100) NOT NULL,
  model VARCHAR(100) NOT NULL,
  part_type VARCHAR(50) NOT NULL DEFAULT 'Motor', -- Motor o Transmisión
  vin VARCHAR(50) NULL,
  pallet_number VARCHAR(50) NULL,
  tag_code VARCHAR(80) NULL,
  engine_specs VARCHAR(150) NULL,
  held_for VARCHAR(200) NULL,
  held_by VARCHAR(150) NULL,
  hold_until DATE NULL,
  tag_date VARCHAR(50) NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'disponible',
  price DECIMAL(12,2) NOT NULL DEFAULT 0,
  cost DECIMAL(12,2) NOT NULL DEFAULT 0,
  location VARCHAR(150) NULL,
  photo_url TEXT NULL,
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL DEFAULT NULL,
  INDEX inventory_parts_status (status),
  INDEX inventory_parts_brand_model (brand, model),
  INDEX inventory_parts_vin (vin),
  INDEX inventory_parts_pallet (pallet_number),
  INDEX inventory_parts_deleted (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO inventory_parts (year, brand, model, part_type, vin, pallet_number, status, notes)
VALUES 
('2017', 'Chevrolet', 'Malibu', 'Motor', '1G1BE5SM8H7123456', 'PAL-104', 'disponible', '1.5 Turbo'),
('2019', 'Ford', 'F-150', 'Transmisión', '1FTFW1E84KFB12345', 'PAL-108', 'disponible', '5.0L 4x4'),
('2021', 'Toyota', 'Tacoma', 'Motor', '3TMJU4GN9MM123456', 'PAL-210', 'disponible', '3.5L V6'),
('2018', 'Honda', 'Civic', 'Motor', '19XFC2F59JE123456', 'PAL-305', 'disponible', '2.0L'),
('2016', 'Jeep', 'Grand Cherokee', 'Transmisión', '1C4RJFBG7GC123456', 'PAL-412', 'disponible', '3.6L')
ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP;
