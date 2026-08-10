import { describe, expect, it, vi } from 'vitest';
import { runWalletSafetyAuditProcess } from '../../../../src/services/walletSafetyAudit/processRunner';

function dependencies(exitCode = 0) {
  return {
    runCli: vi.fn().mockResolvedValue(exitCode),
    disconnectDatabase: vi.fn().mockResolvedValue(undefined),
    stderr: vi.fn(),
  };
}

describe('wallet safety audit process runner', () => {
  it('returns the audit exit code after closing the database pool', async () => {
    const deps = dependencies(2);

    await expect(runWalletSafetyAuditProcess(deps)).resolves.toBe(2);

    expect(deps.disconnectDatabase).toHaveBeenCalledOnce();
    expect(deps.stderr).not.toHaveBeenCalled();
  });

  it('closes the database pool after a pre-execution failure', async () => {
    const deps = dependencies();
    deps.runCli.mockRejectedValue(new Error('descriptor-secret'));

    await expect(runWalletSafetyAuditProcess(deps)).resolves.toBe(1);

    expect(deps.disconnectDatabase).toHaveBeenCalledOnce();
    expect(deps.stderr).toHaveBeenCalledWith('Wallet safety audit failed before execution.');
    expect(deps.stderr.mock.calls.join('\n')).not.toContain('descriptor-secret');
  });

  it('turns a clean audit into an error when database disconnect fails', async () => {
    const deps = dependencies();
    deps.disconnectDatabase.mockRejectedValue(new Error('connection-secret'));

    await expect(runWalletSafetyAuditProcess(deps)).resolves.toBe(1);

    expect(deps.stderr).toHaveBeenCalledWith('Wallet safety audit database disconnect failed.');
    expect(deps.stderr.mock.calls.join('\n')).not.toContain('connection-secret');
  });

  it('preserves a findings exit code when database disconnect also fails', async () => {
    const deps = dependencies(2);
    deps.disconnectDatabase.mockRejectedValue(new Error('connection-secret'));

    await expect(runWalletSafetyAuditProcess(deps)).resolves.toBe(2);
  });
});
