import { describe, expect, it, vi } from 'vitest';
import {
  clearDatabaseExceptUsers,
  fetchCurrentUsers,
  restorePreservedUsers,
} from '../src/server/backup';

describe('Database Restore & Table Clearing Logic', () => {
  it('clears all database tables except the users table', async () => {
    const executedQueries: string[] = [];

    const mockConnection = {
      query: vi.fn(async (sql: string) => {
        executedQueries.push(sql);
        if (sql.includes('SHOW FULL TABLES')) {
          return [
            [
              { Tables_in_radar_v3: 'users', Table_type: 'BASE TABLE' },
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

    // Verify 'users' was NOT cleared
    expect(clearedTables).toEqual(['orders', 'customers', 'claims', 'status_orders']);
    expect(clearedTables).not.toContain('users');

    // Verify TRUNCATE TABLE was called for other tables and NOT for users
    expect(executedQueries).toContain('TRUNCATE TABLE `orders`');
    expect(executedQueries).toContain('TRUNCATE TABLE `customers`');
    expect(executedQueries).toContain('TRUNCATE TABLE `claims`');
    expect(executedQueries).toContain('TRUNCATE TABLE `status_orders`');
    expect(executedQueries).not.toContain('TRUNCATE TABLE `users`');
    expect(executedQueries).not.toContain('DELETE FROM `users`');
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

  it('handles empty preserved users list gracefully', async () => {
    const mockConnection = {
      query: vi.fn(),
    };

    const count = await restorePreservedUsers(mockConnection as any, []);
    expect(count).toBe(0);
    expect(mockConnection.query).not.toHaveBeenCalled();
  });
});
