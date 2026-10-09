import { describe, expect, it, vi } from 'vitest';
import {
  acquireBackupLock,
  clearDatabaseExceptPreserved,
  clearDatabaseExceptUsers,
  fetchCurrentInventoryParts,
  fetchCurrentUsers,
  isBackupLocked,
  releaseBackupLock,
  restorePreservedInventoryParts,
  restorePreservedUsers,
} from '../src/server/backup';

describe('Database Restore & Table Clearing Logic', () => {
  it('clears all database tables except users and inventory_parts', async () => {
    const executedQueries: string[] = [];

    const mockConnection = {
      query: vi.fn(async (sql: string) => {
        executedQueries.push(sql);
        if (sql.includes('SHOW FULL TABLES')) {
          return [
            [
              { Tables_in_radar_v3: 'users', Table_type: 'BASE TABLE' },
              { Tables_in_radar_v3: 'inventory_parts', Table_type: 'BASE TABLE' },
              { Tables_in_radar_v3: 'orders', Table_type: 'BASE TABLE' },
              { Tables_in_radar_v3: 'customers', Table_type: 'BASE TABLE' },
              { Tables_in_radar_v3: 'claims', Table_type: 'BASE TABLE' },
              { Tables_in_radar_v3: 'status_orders', Table_type: 'BASE TABLE' },
            ],
            null,
          ];
        }
        return [{ affectedRows: 0 }, null];
      }),
    };

    const clearedTables = await clearDatabaseExceptUsers(mockConnection as any);

    // Verify 'users' and 'inventory_parts' were NOT cleared
    expect(clearedTables).toEqual(['orders', 'customers', 'claims', 'status_orders']);
    expect(clearedTables).not.toContain('users');
    expect(clearedTables).not.toContain('inventory_parts');

    // Verify TRUNCATE TABLE was called for other tables and NOT for users or inventory_parts
    expect(executedQueries).toContain('TRUNCATE TABLE `orders`');
    expect(executedQueries).toContain('TRUNCATE TABLE `customers`');
    expect(executedQueries).toContain('TRUNCATE TABLE `claims`');
    expect(executedQueries).toContain('TRUNCATE TABLE `status_orders`');
    expect(executedQueries).not.toContain('TRUNCATE TABLE `users`');
    expect(executedQueries).not.toContain('DELETE FROM `users`');
    expect(executedQueries).not.toContain('TRUNCATE TABLE `inventory_parts`');
    expect(executedQueries).not.toContain('DELETE FROM `inventory_parts`');
  });

  it('fetches current users safely', async () => {
    const mockUsers = [
      { id: 1, name: 'Super Admin', email: 'admin@radar.local', role: 'admin' },
      { id: 2, name: 'Operador Uno', email: 'operador@radar.local', role: 'operator' },
    ];

    const mockConnection = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('SELECT * FROM `users`')) {
          return [mockUsers, null];
        }
        return [[], null];
      }),
    };

    const users = await fetchCurrentUsers(mockConnection as any);
    expect(users).toHaveLength(2);
    expect(users[0].email).toBe('admin@radar.local');
  });

  it('fetches current inventory parts safely', async () => {
    const mockParts = [
      { id: 1, brand: 'Toyota', model: 'Corolla', year: '2020', status: 'disponible', price: 1200 },
      { id: 2, brand: 'Ford', model: 'F-150', year: '2019', status: 'vendido', price: 2500 },
    ];

    const mockConnection = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("SHOW TABLES LIKE 'inventory_parts'")) {
          return [[{ Tables_in_radar_v3: 'inventory_parts' }], null];
        }
        if (sql.includes('SELECT * FROM `inventory_parts`')) {
          return [mockParts, null];
        }
        return [[], null];
      }),
    };

    const parts = await fetchCurrentInventoryParts(mockConnection as any);
    expect(parts).toHaveLength(2);
    expect(parts[0].brand).toBe('Toyota');
    expect(parts[1].status).toBe('vendido');
  });

  it('re-inserts preserved users with ON DUPLICATE KEY UPDATE to maintain login continuity', async () => {
    const executedQueries: string[] = [];

    const mockPreservedUsers: any[] = [
      {
        id: 1,
        name: 'Super Admin',
        email: 'admin@radar.local',
        password: '$argon2id$hashedpassword',
        role: 'admin',
        active: 1,
      },
    ];

    const mockConnection = {
      query: vi.fn(async (sql: string) => {
        executedQueries.push(sql);
        if (sql.includes("SHOW TABLES LIKE 'users'")) {
          return [[{ Tables_in_radar_v3: 'users' }], null];
        }
        return [{ affectedRows: 1 }, null];
      }),
    };

    const count = await restorePreservedUsers(mockConnection as any, mockPreservedUsers);
    expect(count).toBe(1);

    const insertQuery = executedQueries.find((q) => q.startsWith('INSERT INTO `users`'));
    expect(insertQuery).toBeDefined();
    expect(insertQuery).toContain('admin@radar.local');
    expect(insertQuery).toContain('ON DUPLICATE KEY UPDATE');
    expect(insertQuery).toContain('`password` = VALUES(`password`)');
    expect(insertQuery).toContain('`role` = VALUES(`role`)');
  });

  it('re-inserts preserved inventory parts with ON DUPLICATE KEY UPDATE to prevent inventory loss', async () => {
    const executedQueries: string[] = [];

    const mockPreservedParts: any[] = [
      {
        id: 10,
        year: '2022',
        year_from: '2020',
        year_to: '2024',
        is_exact_year_only: 0,
        brand: 'Honda',
        model: 'Civic',
        part_type: 'Motor',
        vin: '1HGCR2F83HA000000',
        pallet_number: 'PAL-99',
        tag_code: 'TAG-1234',
        engine_specs: '2.0L Turbo',
        held_for: null,
        held_by: null,
        hold_until: null,
        tag_date: '2026-09-28',
        status: 'disponible',
        price: 1500,
        cost: 800,
        location: 'Pasillo 4',
        photo_url: null,
        notes: 'En excelente estado',
        created_at: '2026-09-28 10:00:00',
        updated_at: '2026-09-28 10:00:00',
        sold_at: null,
        deleted_at: null,
      },
    ];

    const mockConnection = {
      query: vi.fn(async (sql: string) => {
        executedQueries.push(sql);
        if (sql.includes("SHOW TABLES LIKE 'inventory_parts'")) {
          return [[{ Tables_in_radar_v3: 'inventory_parts' }], null];
        }
        if (sql.includes('SHOW COLUMNS FROM `inventory_parts`')) {
          return [[{ Field: 'year_from' }], null];
        }
        return [{ affectedRows: 1 }, null];
      }),
    };

    const count = await restorePreservedInventoryParts(mockConnection as any, mockPreservedParts);
    expect(count).toBe(1);

    const insertQuery = executedQueries.find((q) => q.startsWith('INSERT INTO `inventory_parts`'));
    expect(insertQuery).toBeDefined();
    expect(insertQuery).toContain('Honda');
    expect(insertQuery).toContain('Civic');
    expect(insertQuery).toContain('1HGCR2F83HA000000');
    expect(insertQuery).toContain('ON DUPLICATE KEY UPDATE');
    expect(insertQuery).toContain('`brand` = VALUES(`brand`)');
    expect(insertQuery).toContain('`model` = VALUES(`model`)');
    expect(insertQuery).toContain('`price` = VALUES(`price`)');
  });

  it('handles empty preserved users and inventory gracefully', async () => {
    const mockConnection = {
      query: vi.fn(),
    };

    const usersCount = await restorePreservedUsers(mockConnection as any, []);
    expect(usersCount).toBe(0);

    const partsCount = await restorePreservedInventoryParts(mockConnection as any, []);
    expect(partsCount).toBe(0);
    expect(mockConnection.query).not.toHaveBeenCalled();
  });

  it('enforces single-execution mutex lock for backup/restore operations', () => {
    // Ensure clean initial state
    releaseBackupLock();
    expect(isBackupLocked()).toBe(false);

    // First acquire should succeed
    const firstLock = acquireBackupLock();
    expect(firstLock).toBe(true);
    expect(isBackupLocked()).toBe(true);

    // Concurrent second acquire should be rejected
    const secondLock = acquireBackupLock();
    expect(secondLock).toBe(false);
    expect(isBackupLocked()).toBe(true);

    // After release, should be available again
    releaseBackupLock();
    expect(isBackupLocked()).toBe(false);

    const reacquired = acquireBackupLock();
    expect(reacquired).toBe(true);
    releaseBackupLock();
    expect(isBackupLocked()).toBe(false);
  });
});

describe('Backup Integrity Verification Tests', () => {
  it('identifies valid and complete SQL backup files', async () => {
    const { parseSqlIntegrity } = await import('../scripts/verify-backup-integrity');
    const validSql = `
      -- Radar 3.0 backup
      SET FOREIGN_KEY_CHECKS=0;
      CREATE TABLE IF NOT EXISTS \`users\` (id int);
      INSERT INTO \`users\` (id) VALUES (1);
      CREATE TABLE IF NOT EXISTS \`orders\` (id int);
      INSERT INTO \`orders\` (id) VALUES (10);
      CREATE TABLE IF NOT EXISTS \`customers\` (id int);
      INSERT INTO \`customers\` (id) VALUES (100);
      CREATE TABLE IF NOT EXISTS \`claims\` (id int);
      CREATE TABLE IF NOT EXISTS \`inventory_parts\` (id int);
      SET FOREIGN_KEY_CHECKS=1;
    `;

    const report = parseSqlIntegrity(validSql, 'backup_test_valid.sql', 1024);

    expect(report.ok).toBe(true);
    expect(report.hasForeignKeysHandling).toBe(true);
    expect(report.tablesFound).toContain('users');
    expect(report.tablesFound).toContain('orders');
    expect(report.tablesFound).toContain('customers');
    expect(report.tablesFound).toContain('claims');
    expect(report.tablesFound).toContain('inventory_parts');
    expect(report.missingTables).toHaveLength(0);
    expect(report.insertStatementsCount).toBe(3);
  });

  it('detects missing critical tables or empty backup files', async () => {
    const { parseSqlIntegrity } = await import('../scripts/verify-backup-integrity');
    
    // Empty backup
    const emptyReport = parseSqlIntegrity('', 'empty_backup.sql', 0);
    expect(emptyReport.ok).toBe(false);
    expect(emptyReport.issues).toContain('El archivo de respaldo está vacío (0 bytes).');

    // Incomplete backup (missing inventory_parts and claims)
    const incompleteSql = `
      SET FOREIGN_KEY_CHECKS=0;
      CREATE TABLE \`users\` (id int);
      CREATE TABLE \`orders\` (id int);
      CREATE TABLE \`customers\` (id int);
    `;
    const incompleteReport = parseSqlIntegrity(incompleteSql, 'incomplete.sql', 500);
    expect(incompleteReport.ok).toBe(false);
    expect(incompleteReport.missingTables).toContain('claims');
    expect(incompleteReport.missingTables).toContain('inventory_parts');
  });
});
