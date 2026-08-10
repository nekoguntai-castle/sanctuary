import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildWalletSafetyAuditReport,
  walletSafetyAuditReportSchema,
  writeSensitiveAuditReport,
} from '../../../../src/services/walletSafetyAudit';
import { provenAuditSnapshot } from '../../../fixtures/walletSafetyAuditFixture';

describe('wallet safety audit sensitive report writer', () => {
  it('publishes valid JSON atomically with owner-only permissions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'wallet-safety-audit-'));
    const outputPath = join(directory, 'report.json');
    const report = buildWalletSafetyAuditReport(
      provenAuditSnapshot(),
      new Date('2026-08-09T12:00:00.000Z'),
    );

    await writeSensitiveAuditReport(outputPath, report);

    const file = await stat(outputPath);
    expect(file.mode & 0o777).toBe(0o600);
    const parsed = JSON.parse(await readFile(outputPath, 'utf8'));
    expect(walletSafetyAuditReportSchema.parse(parsed)).toEqual(report);
    await expect((await import('node:fs/promises')).readdir(directory)).resolves.toEqual(['report.json']);
  });
});
