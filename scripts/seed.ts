import bcrypt from 'bcryptjs';
import mysql from 'mysql2/promise';

const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;
const name = process.env.ADMIN_NAME?.trim() || 'Administrador Radar';

if (!email || !password) {
  console.error('ADMIN_EMAIL and ADMIN_PASSWORD are required');
  process.exit(1);
}

if (password.length < 12) {
  console.error('ADMIN_PASSWORD must contain at least 12 characters');
  process.exit(1);
}

const run = async () => {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'radar_app',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'radar_v3',
  });

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const [result] = await connection.execute<mysql.ResultSetHeader>(
      `INSERT IGNORE INTO users (name, email, password, role, permissions, active)
       VALUES (?, ?, ?, 'admin', ?, 1)`,
      [name, email, passwordHash, JSON.stringify(['*'])],
    );
    console.log(result.affectedRows === 1 ? `Created administrator ${email}` : `Administrator ${email} already exists; no changes made`);
  } finally {
    await connection.end();
  }
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
