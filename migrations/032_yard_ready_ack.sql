ALTER TABLE orders
  ADD COLUMN yard_piece_ready_ack_at DATETIME NULL DEFAULT NULL,
  ADD COLUMN yard_piece_ready_ack_by INT NULL DEFAULT NULL;
