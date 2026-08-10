import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { RawAuditDatabaseClient } from '../../../../src/repositories/walletSafetyAuditRepository';
import { runWalletSafetyAudit } from '../../../../src/services/walletSafetyAudit';
import type { WalletSafetyRawSnapshot } from '../../../../src/services/walletSafetyAudit';
import { provenAuditSnapshot } from '../../../fixtures/walletSafetyAuditFixture';

function auditClient(snapshot: WalletSafetyRawSnapshot): RawAuditDatabaseClient {
  return {
    $transaction: async (callback) => {
      let queryIndex = 0;
      return callback({
        $executeRawUnsafe: async () => 0,
        $queryRawUnsafe: async <T>() => {
          const rows = [snapshot.wallets, snapshot.addresses, snapshot.signers][queryIndex++];
          return rows as T;
        },
      });
    },
  };
}

describe('runWalletSafetyAudit', () => {
  it('uses the secure report writer when no writer override is supplied', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'wallet-safety-run-'));
    const outputPath = join(directory, 'report.json');

    await expect(runWalletSafetyAudit({
      outputPath,
      client: auditClient(provenAuditSnapshot()),
      generatedAt: new Date('2026-08-09T12:00:00.000Z'),
    })).resolves.toMatchObject({ exitCode: 0 });

    await expect(readFile(outputPath, 'utf8')).resolves.toContain(
      'sanctuary.wallet-safety-audit.v1',
    );
  });

  it('returns stable clean and findings exit codes after publishing the report', async () => {
    const writeReport = vi.fn().mockResolvedValue(undefined);
    const cleanSnapshot = provenAuditSnapshot();
    await expect(runWalletSafetyAudit({
      outputPath: 'clean.json',
      client: auditClient(cleanSnapshot),
      generatedAt: new Date('2026-08-09T12:00:00.000Z'),
      writeReport,
    })).resolves.toMatchObject({ exitCode: 0 });

    const findingSnapshot = provenAuditSnapshot();
    findingSnapshot.addresses = [];
    await expect(runWalletSafetyAudit({
      outputPath: 'findings.json',
      client: auditClient(findingSnapshot),
      generatedAt: new Date('2026-08-09T12:00:00.000Z'),
      writeReport,
    })).resolves.toMatchObject({ exitCode: 2 });
    expect(writeReport).toHaveBeenCalledTimes(2);
  });
});
