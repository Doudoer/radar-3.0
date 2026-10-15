-- Migración 017: Agregar columna password_changed_at en users para control de revocación de sesiones
-- Evita usar updated_at para revocar sesiones, permitiendo canjes de 2FA y ediciones de perfil sin desconectar al usuario

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP NULL DEFAULT NULL AFTER password;
