import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/services/walletSafetyAudit/descriptorEvidence', () => ({
  inspectDescriptorEvidence: vi.fn(() => ({
    findings: ['policy.ordered_multisig_unsupported'],
    receive: null,
    change: null,
  })),
}));
vi.mock('../../../../src/services/walletSafetyAudit/addressEvidence', () => ({
  inspectAddressEvidence: vi.fn(() => []),
}));
vi.mock('../../../../src/services/walletSafetyAudit/signerEvidence', () => ({
  inspectSignerEvidence: vi.fn(() => []),
}));

import {
  buildWalletSafetyAuditReport,
  reportHasFindings,
} from '../../../../src/services/walletSafetyAudit/analyzer';
import { provenAuditSnapshot } from '../../../fixtures/walletSafetyAuditFixture';

describe('wallet safety audit classification boundaries', () => {
  it('classifies a policy-only unsupported finding as recoverable', () => {
    const report = buildWalletSafetyAuditReport(
      provenAuditSnapshot(),
      new Date('2026-08-10T00:00:00.000Z'),
    );

    expect(report.wallets[0].classification).toBe('unsupported_but_recoverable');
    expect(reportHasFindings(report)).toBe(true);
  });
});
