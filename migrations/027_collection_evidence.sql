ALTER TABLE finance_movements ADD COLUMN IF NOT EXISTS payment_receipt VARCHAR(255) NULL;
ALTER TABLE finance_movements ADD COLUMN IF NOT EXISTS payment_received_by VARCHAR(200) NULL;
