-- Migration 031: Add yard compatibility column to orders
ALTER TABLE orders ADD COLUMN IF NOT EXISTS yard_compatibility JSON NULL;

