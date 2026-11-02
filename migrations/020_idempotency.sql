CREATE TABLE IF NOT EXISTS api_idempotency (
  operation VARCHAR(40) NOT NULL,
  request_key VARCHAR(100) NOT NULL,
  user_id INT NOT NULL,
  request_hash CHAR(64) NOT NULL,
  resource_id INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (operation, request_key)
) ENGINE=InnoDB;
