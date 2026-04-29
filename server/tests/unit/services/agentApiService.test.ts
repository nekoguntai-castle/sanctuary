import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictError, InvalidInputError } from '../../../src/errors/ApiError';

const mocks = vi.hoisted(() => ({
  createFundingAttempt: vi.fn(),
  evaluateRejectedFundingAttemptAlert: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock('../../../src/repositories', () => ({
  agentRepository: {
    createFundingAttempt: mocks.createFundingAttempt,
  },
  utxoRepository: {},
  walletRepository: {},
}));

vi.mock('../../../src/services/agentMonitoringService', () => ({
  evaluateRejectedFundingAttemptAlert:
    mocks.evaluateRejectedFundingAttemptAlert,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: mocks.logWarn,
    error: vi.fn(),
  }),
}));

import { recordAgentFundingAttempt } from '../../../src/services/agentApiService';

describe('agentApiService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createFundingAttempt.mockResolvedValue({ id: 'attempt-1' });
    mocks.evaluateRejectedFundingAttemptAlert.mockResolvedValue(undefined);
  });

  it('records rejected attempts with null amount for unsupported amount inputs', async () => {
    await recordAgentFundingAttempt({
      agentId: 'agent-1',
      keyId: 'key-1',
      keyPrefix: 'agt_prefix',
      fundingWalletId: 'funding-wallet',
      status: 'rejected',
      error: new ConflictError('wallet locked'),
      amount: { sats: '1000' },
      feeRate: '3.5',
      recipient: 12345,
    });

    expect(mocks.createFundingAttempt).toHaveBeenCalledWith({
      agentId: 'agent-1',
      keyId: 'key-1',
      keyPrefix: 'agt_prefix',
      fundingWalletId: 'funding-wallet',
      operationalWalletId: null,
      draftId: null,
      status: 'rejected',
      reasonCode: 'utxo_locked',
      reasonMessage: 'wallet locked',
      amount: null,
      feeRate: 3.5,
      recipient: null,
      ipAddress: null,
      userAgent: null,
    });
    expect(mocks.evaluateRejectedFundingAttemptAlert).toHaveBeenCalledWith(
      'agent-1',
      'utxo_locked',
    );
  });

  it('prefers structured attempt reason codes before legacy message matching', async () => {
    await recordAgentFundingAttempt({
      agentId: 'agent-1',
      keyId: 'key-1',
      keyPrefix: 'agt_prefix',
      fundingWalletId: 'funding-wallet',
      status: 'rejected',
      error: new InvalidInputError('generic validation failure', undefined, {
        reasonCode: 'policy_weekly_limit',
      }),
    });

    expect(mocks.createFundingAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        reasonCode: 'policy_weekly_limit',
        reasonMessage: 'generic validation failure',
      }),
    );
    expect(mocks.evaluateRejectedFundingAttemptAlert).toHaveBeenCalledWith(
      'agent-1',
      'policy_weekly_limit',
    );
  });
});
