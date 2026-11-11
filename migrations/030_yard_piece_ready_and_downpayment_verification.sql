-- Migration 030: Add yard piece ready flag and downpayment verification tracking
ALTER TABLE orders ADD COLUMN IF NOT EXISTS yard_piece_ready TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS yard_piece_ready_at DATETIME NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS yard_piece_ready_by BIGINT UNSIGNED NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS downpayment_verified TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS downpayment_verified_at DATETIME NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS downpayment_verified_by BIGINT UNSIGNED NULL;

