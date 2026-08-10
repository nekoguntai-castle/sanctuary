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

import { runWalletSafetyAuditProcess } from '../../../../src/services/walletSafetyAudit/processRunner';

describe('wallet safety audit process defaults', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('redacts a default CLI failure before disconnecting the database', async () => {
    dependencies.runWalletSafetyAuditCli.mockRejectedValueOnce(new Error('descriptor-secret'));
    dependencies.disconnect.mockResolvedValueOnce(undefined);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await expect(runWalletSafetyAuditProcess()).resolves.toBe(1);

    expect(stderr).toHaveBeenCalledWith('Wallet safety audit failed before execution.\n');
    expect(stderr.mock.calls.join('\n')).not.toContain('descriptor-secret');
    expect(dependencies.disconnect).toHaveBeenCalledOnce();
  });
});
