-- Migración 016: Índices de rendimiento para acelerar consultas críticas y carga de datos en Radar 3.0
-- Evita escaneos de tabla completa (Full Table Scans) y 'Using filesort' en pedidos, clientes y reclamos

-- 1. Tabla orders:
-- Acelera el endpoint principal GET /api/orders (WHERE deleted_at IS NULL ORDER BY created_at DESC)
ALTER TABLE orders ADD INDEX IF NOT EXISTS idx_orders_deleted_created (deleted_at, created_at);

-- Acelera las uniones con clientes y estadísticas de clientes por customer_id
ALTER TABLE orders ADD INDEX IF NOT EXISTS idx_orders_customer_deleted (customer_id, deleted_at);

-- Acelera el filtrado por estado de pedido (panoramas operativos, status tabs)
ALTER TABLE orders ADD INDEX IF NOT EXISTS idx_orders_status_deleted (status, deleted_at);

-- 2. Tabla customers:
-- Acelera el listado de clientes ordenado por fecha de creación
ALTER TABLE customers ADD INDEX IF NOT EXISTS idx_customers_deleted_created (deleted_at, created_at);

-- Acelera la búsqueda de clientes por teléfono
ALTER TABLE customers ADD INDEX IF NOT EXISTS idx_customers_phone (phone);

-- 3. Tabla claims:
-- Acelera el listado de reclamos por fecha
ALTER TABLE claims ADD INDEX IF NOT EXISTS idx_claims_deleted_created (deleted_at, created_at);
