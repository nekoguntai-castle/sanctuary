import { afterEach, describe, expect, it, vi } from 'vitest';

const dependencies = vi.hoisted(() => ({
  disconnect: vi.fn(),
  runWalletSafetyAuditCli: vi.fn(),
}));

vi.mock('../../../../src/models/prisma', () => ({
  disconnect: dependencies.disconnect,
}));

vi.mock('../../../../src/services/walletSafetyAudit/cli', () => ({
  runWalletSafetyAuditCli: dependencies.runWalletSafetyAuditCli,
}));

import { runWalletSafetyAuditScript } from '../../../../scripts/audit-wallet-safety';

describe('wallet safety audit script defaults', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('redacts a CLI failure before disconnecting the database', async () => {
    dependencies.runWalletSafetyAuditCli.mockRejectedValueOnce(new Error('descriptor-secret'));
    dependencies.disconnect.mockResolvedValueOnce(undefined);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await expect(runWalletSafetyAuditScript()).resolves.toBe(1);

    expect(stderr).toHaveBeenCalledWith('Wallet safety audit failed before execution.\n');
    expect(stderr.mock.calls.join('\n')).not.toContain('descriptor-secret');
    expect(dependencies.disconnect).toHaveBeenCalledOnce();
  });

  it('returns the CLI result after disconnecting the database', async () => {
    dependencies.runWalletSafetyAuditCli.mockResolvedValueOnce(2);
    dependencies.disconnect.mockResolvedValueOnce(undefined);

    await expect(runWalletSafetyAuditScript()).resolves.toBe(2);

    expect(dependencies.runWalletSafetyAuditCli).toHaveBeenCalledOnce();
    expect(dependencies.disconnect).toHaveBeenCalledOnce();
  });
});
