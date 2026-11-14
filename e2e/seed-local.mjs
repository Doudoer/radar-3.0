import { execFileSync } from 'node:child_process';
import bcrypt from 'bcryptjs';

const DB = {
  container: process.env.E2E_DB_CONTAINER || 'radar-desktop-db-1',
  user: process.env.E2E_DB_USER || 'radar_local',
  password: process.env.E2E_DB_PASSWORD || 'radar_desktop_only',
  name: process.env.E2E_DB_NAME || 'radar_v3',
};

function assertLocalStack() {
  if (!/^radar-desktop-db-\d+$/.test(DB.container)) {
    throw new Error(
      `E2E_DB_CONTAINER="${DB.container}" no pertenece al stack local. El arnés solo siembra usuarios en contenedores radar-desktop-db-*.`
    );
  }
}

function query(sql) {
  assertLocalStack();
  execFileSync(
    'docker',
    ['exec', '-i', '-e', `MYSQL_PWD=${DB.password}`, DB.container, 'mariadb', '-u', DB.user, DB.name],
    { input: sql, stdio: ['pipe', 'pipe', 'pipe'] }
  );
}

const quote = (value) => value.replace(/'/g, "''");

export function seedLocalUser({
  email,
  password,
  role = 'vendedor_yarda',
  name = 'Yard E2E',
  theme = 'light',
}) {
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+$/i.test(email)) {
    throw new Error(`E2E_EMAIL inválido: ${email}`);
  }
  if (!['admin', 'operator', 'vendedor_yarda'].includes(role)) {
    throw new Error(`Rol E2E no permitido: ${role}`);
  }
  const hash = bcrypt.hashSync(password, 10);
  query(`
    INSERT INTO users (name, email, password, role, active, theme)
    VALUES ('${quote(name)}', '${quote(email)}', '${quote(hash)}', '${quote(role)}', 1, '${quote(theme)}')
    ON DUPLICATE KEY UPDATE
      name = VALUES(name),
      password = VALUES(password),
      role = VALUES(role),
      active = 1,
      deleted_at = NULL,
      theme = VALUES(theme),
      session_version = session_version + 1;
  `);
}

export function removeLocalUser(email) {
  query(`DELETE FROM users WHERE email = '${quote(email)}';`);
}
