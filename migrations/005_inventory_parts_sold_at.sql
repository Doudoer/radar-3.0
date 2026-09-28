ALTER TABLE inventory_parts 
  ADD COLUMN sold_at TIMESTAMP NULL DEFAULT NULL AFTER updated_at;
