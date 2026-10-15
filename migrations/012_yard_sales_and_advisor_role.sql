-- Migración 012: Soporte para Vendedores de Yarda y Marcado de Ventas de Yarda
-- RADAR V3

SET @dbname = DATABASE();

-- 1. Asegurar tipo flexible para role en tabla users
ALTER TABLE users MODIFY COLUMN role VARCHAR(40) NOT NULL DEFAULT 'operator';

-- 2. orders.is_yard_sale
SET @tablename = "orders";
SET @columnname = "is_yard_sale";
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname
  ) > 0,
  "SELECT 1",
  "ALTER TABLE orders ADD COLUMN is_yard_sale TINYINT(1) NOT NULL DEFAULT 0 AFTER user_id"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- 3. Índice para acelerar filtros de ventas de yarda
SET @indexname = "orders_yard_sale";
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND INDEX_NAME = @indexname
  ) > 0,
  "SELECT 1",
  "ALTER TABLE orders ADD INDEX orders_yard_sale (is_yard_sale)"
));
PREPARE addIndexIfNotExists FROM @preparedStatement;
EXECUTE addIndexIfNotExists;
DEALLOCATE PREPARE addIndexIfNotExists;
