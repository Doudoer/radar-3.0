ALTER TABLE order_workflow_events ADD COLUMN IF NOT EXISTS preparation_details JSON NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS preparation_details JSON NULL;
