import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildWalletSafetyAuditReport } from '../../../../src/services/walletSafetyAudit/analyzer';
import { provenAuditSnapshot } from '../../../fixtures/walletSafetyAuditFixture';

const fs = vi.hoisted(() => ({
  open: vi.fn(),
  rename: vi.fn(),
  unlink: vi.fn(),
}));

vi.mock('node:fs/promises', () => fs);

import { writeSensitiveAuditReport } from '../../../../src/services/walletSafetyAudit/reportWriter';

const report = buildWalletSafetyAuditReport(
  provenAuditSnapshot(),
  new Date('2026-08-09T12:00:00.000Z'),
);

describe('wallet safety audit report cleanup failures', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('closes an open temporary file and suppresses cleanup errors after a write failure', async () => {
    const writeFailure = new Error('write failed');
    const file = {
      writeFile: vi.fn().mockRejectedValue(writeFailure),
      chmod: vi.fn(),
      sync: vi.fn(),
      close: vi.fn().mockRejectedValue(new Error('close failed')),
    };
    fs.open.mockResolvedValue(file);
    fs.unlink.mockRejectedValue(new Error('unlink failed'));

    await expect(writeSensitiveAuditReport('/tmp/report.json', report)).rejects.toBe(writeFailure);

    expect(file.close).toHaveBeenCalledOnce();
    expect(fs.unlink).toHaveBeenCalledOnce();
  });

  it('preserves an open failure when no temporary file handle exists', async () => {
    const openFailure = new Error('open failed');
    fs.open.mockRejectedValue(openFailure);
    fs.unlink.mockResolvedValue(undefined);

    await expect(writeSensitiveAuditReport('/tmp/report.json', report)).rejects.toBe(openFailure);

    expect(fs.unlink).toHaveBeenCalledOnce();
  });
});
