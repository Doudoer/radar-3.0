import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const mysql = createRequire('/app/package.json')('mysql2/promise');
const db = await mysql.createConnection({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, timezone: 'Z',
});
const [, , mode, manifest] = process.argv;
assert.ok(['before', 'after'].includes(mode));
const identifier = value => {
  assert.match(value, /^[a-zA-Z0-9_]+$/);
  return `\`${value}\``;
};
try {
  const state = mode === 'before' ? {} : JSON.parse(await readFile(manifest, 'utf8'));
  if (mode === 'before') {
    const [tables] = await db.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_TYPE='BASE TABLE' AND TABLE_NAME<>'schema_migrations'", [process.env.DB_NAME]);
    for (const { name } of tables) {
      const [columns] = await db.query(`SHOW COLUMNS FROM ${identifier(name)}`);
      state[name] = { columns: columns.map(column => column.Field) };
    }
  }
  for (const [table, item] of Object.entries(state)) {
    const [rows] = await db.query(`SELECT ${item.columns.map(identifier).join(',')} FROM ${identifier(table)}`);
    const hash = createHash('sha256').update(rows.map(row => JSON.stringify(row)).sort().join('\n')).digest('hex');
    if (mode === 'before') { item.hash = hash; item.count = rows.length; }
    else {
      assert.equal(hash, item.hash, `${table}: original values changed`);
      assert.equal(rows.length, item.count, `${table}: record count changed`);
    }
  }
  if (mode === 'before') await writeFile(manifest, JSON.stringify(state), { mode: 0o600 });
  console.log(mode === 'before' ? 'Original values fingerprinted' : 'Original values and counts preserved');
} finally { await db.end(); }
