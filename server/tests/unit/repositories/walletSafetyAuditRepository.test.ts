import { describe, expect, it, vi } from 'vitest';
import {
  loadWalletSafetyRawSnapshot,
  walletSafetyAuditSql,
  type RawAuditDatabaseClient,
} from '../../../src/repositories/walletSafetyAuditRepository';

describe('walletSafetyAuditRepository', () => {
  it('uses one repeatable-read, read-only transaction with explicit-column queries', async () => {
    const events: string[] = [];
    const transaction = {
      $executeRawUnsafe: vi.fn(async (query: string) => {
        events.push(query);
        return 0;
      }),
      $queryRawUnsafe: vi.fn(async (query: string) => {
        events.push(query);
        return [];
      }),
    };
    const client: RawAuditDatabaseClient = {
      $transaction: vi.fn(async (callback, options) => {
        expect(options).toEqual({
          isolationLevel: 'RepeatableRead',
          maxWait: 10_000,
          timeout: 300_000,
        });
        return callback(transaction);
      }),
    };

    await expect(loadWalletSafetyRawSnapshot(client)).resolves.toEqual({
      wallets: [],
      addresses: [],
      signers: [],
    });
    expect(events).toEqual([
      'SET TRANSACTION READ ONLY',
      walletSafetyAuditSql.wallets,
      walletSafetyAuditSql.addresses,
      walletSafetyAuditSql.signers,
    ]);
  });

  it('does not select user-facing names or secret-bearing columns', () => {
    const sql = Object.values(walletSafetyAuditSql).join('\n').toLowerCase();
    expect(sql).not.toMatch(/\bselect\s+\*/);
    expect(sql).not.toContain('"name"');
    expect(sql).not.toContain('"label"');
    expect(sql).not.toMatch(/seed|mnemonic|privatekey|xprv/);
  });
});
