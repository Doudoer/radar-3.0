-- Migration 045: Support voided_refund in employee_commissions status enum
-- RADAR V3

ALTER TABLE employee_commissions
  MODIFY COLUMN status ENUM('pending_yard_check', 'earned', 'voided_availability', 'voided_refund', 'paid')
  NOT NULL DEFAULT 'pending_yard_check';
