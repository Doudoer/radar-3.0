-- Migration 045: Support multiple phone numbers and email addresses per customer
ALTER TABLE customers ADD COLUMN IF NOT EXISTS phones JSON NULL;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS emails JSON NULL;
