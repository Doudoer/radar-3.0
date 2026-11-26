-- Migración 043: Notas y seguimiento de conversaciones con clientes
-- Permite que todos los empleados dejen constancia de acuerdos, notas y seguimiento
-- para que cualquier compañero conozca el contexto completo del cliente.

CREATE TABLE IF NOT EXISTS customer_conversation_notes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT NOT NULL,
  order_id INT NULL,
  user_id INT NULL,
  author_name VARCHAR(120) NOT NULL,
  note_type VARCHAR(30) NOT NULL DEFAULT 'nota',
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ccn_customer (customer_id, created_at),
  INDEX idx_ccn_order (order_id),
  CONSTRAINT fk_ccn_customer FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
