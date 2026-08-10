import { describe, expect, it, vi } from 'vitest';
import {
  parseAuditCliArguments,
  runWalletSafetyAuditCli,
} from '../../../../src/services/walletSafetyAudit/cli';
import { buildWalletSafetyAuditReport } from '../../../../src/services/walletSafetyAudit';
import { provenAuditSnapshot } from '../../../fixtures/walletSafetyAuditFixture';

describe('wallet safety audit CLI', () => {
  it.each([
    { arguments_: [] },
    { arguments_: ['--output'] },
    { arguments_: ['--wrong', 'report.json'] },
    { arguments_: ['--output', '   '] },
  ])('rejects invalid argument shape %#', ({ arguments_ }) => {
    expect(() => parseAuditCliArguments(arguments_)).toThrow('invalid arguments');
  });

  it('supports help and failure output through the default process streams', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await expect(runWalletSafetyAuditCli(['--help'])).resolves.toBe(0);
    await expect(runWalletSafetyAuditCli([])).resolves.toBe(1);

    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('Wallet safety audit failed.'));
  });

  it('prints only aggregate redacted output and preserves the clean exit code', async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();
    const report = buildWalletSafetyAuditReport(
      provenAuditSnapshot(),
      new Date('2026-08-09T12:00:00.000Z'),
    );
    const executeAudit = vi.fn().mockResolvedValue({ exitCode: 0 as const, report });

    await expect(runWalletSafetyAuditCli(
      ['--output', '/sensitive/report.json'],
      { stdout, stderr },
      executeAudit,
    )).resolves.toBe(0);

    const output = stdout.mock.calls.join('\n');
    expect(output).toContain('wallets=1');
    expect(output).not.toContain(report.wallets[0].evidence.wallet.descriptor);
    expect(output).not.toContain(report.wallets[0].evidence.addresses[0].address);
    expect(output).not.toContain(report.wallets[0].evidence.signers[0].signerXpub);
    expect(output).not.toContain('/sensitive/report.json');
    expect(stderr).not.toHaveBeenCalled();
  });

  it('uses stable findings and error exit codes without echoing sensitive errors', async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();
    const failingAudit = vi.fn().mockRejectedValue(new Error('xpub-secret descriptor-secret'));
    await expect(runWalletSafetyAuditCli(
      ['--output', '/sensitive/report.json'],
      { stdout, stderr },
      failingAudit,
    )).resolves.toBe(1);
    expect(stderr.mock.calls.join('\n')).not.toMatch(/xpub-secret|descriptor-secret|\/sensitive/);

    const report = buildWalletSafetyAuditReport({ wallets: [], addresses: [], signers: [] });
    const findingReport = {
      ...report,
      summary: { ...report.summary, findingCount: 1, manualInvestigation: 1 },
    };
    const findingAudit = vi.fn().mockResolvedValue({ exitCode: 2 as const, report: findingReport });
    await expect(runWalletSafetyAuditCli(
      ['--output', 'report.json'],
      { stdout, stderr },
      findingAudit,
    )).resolves.toBe(2);
  });
});
