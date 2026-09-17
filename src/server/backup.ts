import { RowDataPacket } from 'mysql2/promise';
import { pool } from './config';

const escapeIdentifier = (value: string) => `\`${value.replace(/`/g, '``')}\``;

const escapeValue = (value: unknown) => {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';

  const text = Buffer.isBuffer(value)
    ? `x'${value.toString('hex')}'`
    : String(value)
      .replace(/\\/g, '\\\\')
      .replace(/\0/g, '\\0')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/'/g, "\\'")
      .replace(/\x1a/g, '\\Z');

  return Buffer.isBuffer(value) ? text : `'${text}'`;
};

const getTableName = (row: RowDataPacket) => String(row[Object.keys(row)[0]]);

export const createDatabaseBackup = async () => {
  const [tableRows] = await pool.query<RowDataPacket[]>('SHOW FULL TABLES WHERE Table_type = \'BASE TABLE\'');
  const chunks = [
    '-- Radar 3.0 database backup\n',
    `-- Generated: ${new Date().toISOString()}\n`,
    'SET FOREIGN_KEY_CHECKS=0;\nSET SQL_MODE=\'NO_AUTO_VALUE_ON_ZERO\';\n\n',
  ];

  for (const tableRow of tableRows) {
    const tableName = getTableName(tableRow);
    const identifier = escapeIdentifier(tableName);
    const [createRows] = await pool.query<RowDataPacket[]>(`SHOW CREATE TABLE ${identifier}`);
    const createStatement = String(createRows[0]?.['Create Table'] || '').replace(/;?$/, ';');
    if (!createStatement) continue;

    chunks.push(`DROP TABLE IF EXISTS ${identifier};\n${createStatement}\n\n`);
    const [dataRows] = await pool.query<RowDataPacket[]>(`SELECT * FROM ${identifier}`);
    const columns = dataRows[0] ? Object.keys(dataRows[0]).map(escapeIdentifier).join(', ') : '';

    if (columns && dataRows.length > 0) {
      for (const row of dataRows) {
        const values = Object.keys(row).map((column) => escapeValue(row[column])).join(', ');
        chunks.push(`INSERT INTO ${identifier} (${columns}) VALUES (${values});\n`);
      }
      chunks.push('\n');
    }
  }

  chunks.push('SET FOREIGN_KEY_CHECKS=1;\n');
  return chunks.join('');
};
