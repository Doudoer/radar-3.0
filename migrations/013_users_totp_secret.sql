-- Migration 013: Add totp_secret column to users table for Google Authenticator (RFC 6238 TOTP) backup 2FA
ALTER TABLE users ADD COLUMN totp_secret VARCHAR(128) NULL AFTER phone;
