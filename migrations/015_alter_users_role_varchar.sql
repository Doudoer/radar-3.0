-- Migration 015: Ensure users.role column is VARCHAR(40) to support all roles including vendedor_yarda
-- RADAR V3

ALTER TABLE users MODIFY COLUMN role VARCHAR(40) NOT NULL DEFAULT 'operator';
