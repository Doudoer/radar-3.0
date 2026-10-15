-- Migration 014: Add backup_codes column to users table for 2FA emergency backup codes
ALTER TABLE users ADD COLUMN backup_codes TEXT NULL AFTER totp_secret;
