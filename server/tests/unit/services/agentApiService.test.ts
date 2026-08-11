import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConflictError,
  ForbiddenError,
  InvalidInputError,
} from '../../../src/errors/ApiError';
import type { AgentRequestContext } from '../../../src/agent/auth';

const mocks = vi.hoisted(() => ({
  createFundingAttempt: vi.fn(),
  createDraft: vi.fn(),
  createTransaction: vi.fn(),
  enforceAgentFundingPolicy: vi.fn(),
  evaluateRejectedFundingAttemptAlert: vi.fn(),
  evaluatePolicies: vi.fn(),
  logWarn: vi.fn(),
  markAgentFundingDraftCreated: vi.fn(),
  markFundingOverrideUsed: vi.fn(),
  requireAgentFundingDraftAccess: vi.fn(),
  runDraftCreatedSideEffects: vi.fn(),
  verifyOperationalReceiveAddress: vi.fn(),
  findWalletByIdWithDevices: vi.fn(),
  findNetwork: vi.fn(),
  createSigningIntent: vi.fn(),
  withAgentFundingLock: vi.fn(),
  withAgentFundingTransaction: vi.fn(),
}));

vi.mock('../../../src/agent/auth', () => ({
  requireAgentFundingDraftAccess: mocks.requireAgentFundingDraftAccess,
}));

vi.mock('../../../src/repositories', () => ({
  agentRepository: {
    createFundingAttempt: mocks.createFundingAttempt,
    markAgentFundingDraftCreated: mocks.markAgentFundingDraftCreated,
    markFundingOverrideUsed: mocks.markFundingOverrideUsed,
    withAgentFundingLock: mocks.withAgentFundingLock,
    withAgentFundingTransaction: mocks.withAgentFundingTransaction,
  },
  utxoRepository: {},
  walletRepository: {
    findByIdWithDevices: mocks.findWalletByIdWithDevices,
    findNetwork: mocks.findNetwork,
  },
}));

vi.mock('../../../src/services/agentFundingPolicy', () => ({
  enforceAgentFundingPolicy: mocks.enforceAgentFundingPolicy,
}));

vi.mock('../../../src/services/agentMonitoringService', () => ({
  evaluateRejectedFundingAttemptAlert:
    mocks.evaluateRejectedFundingAttemptAlert,
}));

vi.mock('../../../src/services/agentOperationalAddressService', () => ({
  verifyOperationalReceiveAddress: mocks.verifyOperationalReceiveAddress,
}));

vi.mock('../../../src/services/bitcoin/transactionService', () => ({
  createTransaction: mocks.createTransaction,
}));
vi.mock('../../../src/services/bitcoin/signingIntent', () => ({
  createSigningIntent: mocks.createSigningIntent,
}));

vi.mock('../../../src/services/draftService', () => ({
  draftService: {
    createDraft: mocks.createDraft,
    runDraftCreatedSideEffects: mocks.runDraftCreatedSideEffects,
  },
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: mocks.logWarn,
    error: vi.fn(),
  }),
}));

vi.mock('../../../src/services/vaultPolicy', () => ({
  policyEvaluationEngine: {
    evaluatePolicies: mocks.evaluatePolicies,
  },
}));

import {
  recordAgentFundingAttempt,
  submitAgentFundingDraft,
} from '../../../src/services/agentApiService';

const agentContext: AgentRequestContext = {
  keyId: 'key-1',
  keyPrefix: 'agt_prefix',
  userId: 'user-1',
  username: 'alice',
  agentId: 'agent-1',
  agentName: 'Treasury Agent',
  agentStatus: 'active',
  fundingWalletId: 'funding-wallet',
  operationalWalletId: 'operational-wallet',
  signerDeviceId: null,
  scope: { allowedActions: ['create_funding_draft'] },
};

const baseFundingDraftBody = {
  operationalWalletId: 'operational-wallet',
  recipient: 'tb1qrecipient',
  amount: 1000,
  feeRate: 5,
};

const makeTransactionData = (
  overrides: Partial<Awaited<ReturnType<typeof mocks.createTransaction>>> = {},
) => ({
  psbtBase64: 'cHNi',
  fee: 100,
  totalInput: 1100,
  totalOutput: 1000,
  changeAmount: 0,
  changeAddress: undefined,
  effectiveAmount: 1000,
  inputPaths: ["m/84'/1'/0'/0/0"],
  utxos: [{ txid: 'txid', vout: 0 }],
  decoyOutputs: undefined,
  ...overrides,
});

describe('agentApiService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createFundingAttempt.mockResolvedValue({ id: 'attempt-1' });
    mocks.createDraft.mockResolvedValue({ id: 'draft-1' });
    mocks.createTransaction.mockResolvedValue(makeTransactionData());
    mocks.findNetwork.mockResolvedValue('testnet3');
    mocks.createSigningIntent.mockResolvedValue({
      intentId: 'intent-1',
      intentDigest: 'a'.repeat(64),
    });
    mocks.enforceAgentFundingPolicy.mockResolvedValue({ overrideId: null });
    mocks.evaluateRejectedFundingAttemptAlert.mockResolvedValue(undefined);
    mocks.evaluatePolicies.mockResolvedValue({ allowed: true, triggered: [] });
    mocks.markAgentFundingDraftCreated.mockResolvedValue(undefined);
    mocks.markFundingOverrideUsed.mockResolvedValue(undefined);
    mocks.requireAgentFundingDraftAccess.mockReturnValue(undefined);
    mocks.runDraftCreatedSideEffects.mockResolvedValue(undefined);
    mocks.verifyOperationalReceiveAddress.mockResolvedValue({ verified: true });
    mocks.findWalletByIdWithDevices.mockResolvedValue({
      id: 'funding-wallet',
      devices: [{ device: { type: 'coldcard', model: null } }],
    });
    mocks.withAgentFundingLock.mockImplementation(async (_agentId, fn) => fn());
    mocks.withAgentFundingTransaction.mockImplementation(async (_agentId, fn) => fn({ tx: true }));
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

  it('keeps legacy lock-message fallback for non-domain errors', async () => {
    await recordAgentFundingAttempt({
      agentId: 'agent-1',
      keyId: 'key-1',
      keyPrefix: 'agt_prefix',
      fundingWalletId: 'funding-wallet',
      status: 'rejected',
      error: new Error('selected input is locked by another draft'),
    });

    expect(mocks.createFundingAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        reasonCode: 'utxo_locked',
        reasonMessage: 'selected input is locked by another draft',
      }),
    );
    expect(mocks.evaluateRejectedFundingAttemptAlert).toHaveBeenCalledWith(
      'agent-1',
      'utxo_locked',
    );
  });

  it('records accepted attempts without rejected-attempt alerting', async () => {
    await recordAgentFundingAttempt({
      agentId: 'agent-1',
      keyId: 'key-1',
      keyPrefix: 'agt_prefix',
      fundingWalletId: 'funding-wallet',
      operationalWalletId: 'operational-wallet',
      draftId: 'draft-1',
      status: 'accepted',
      amount: ' 1234 ',
      feeRate: 2,
      recipient: 'tb1q'.padEnd(240, 'a'),
      ipAddress: '203.0.113.10',
      userAgent: 'agent-client/1.0',
    });

    expect(mocks.createFundingAttempt).toHaveBeenCalledWith({
      agentId: 'agent-1',
      keyId: 'key-1',
      keyPrefix: 'agt_prefix',
      fundingWalletId: 'funding-wallet',
      operationalWalletId: 'operational-wallet',
      draftId: 'draft-1',
      status: 'accepted',
      reasonCode: null,
      reasonMessage: null,
      amount: 1234n,
      feeRate: 2,
      recipient: 'tb1q'.padEnd(200, 'a'),
      ipAddress: '203.0.113.10',
      userAgent: 'agent-client/1.0',
    });
    expect(mocks.evaluateRejectedFundingAttemptAlert).not.toHaveBeenCalled();
  });

  it('rejects unsafe numeric draft amounts before creating a transaction', async () => {
    await expect(
      submitAgentFundingDraft({
        context: agentContext,
        fundingWalletId: 'funding-wallet',
        body: {
          ...baseFundingDraftBody,
          amount: Number.MAX_SAFE_INTEGER + 1,
        },
      }),
    ).rejects.toThrow(InvalidInputError);

    expect(mocks.createTransaction).not.toHaveBeenCalled();
    expect(mocks.createFundingAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'rejected',
        reasonCode: 'invalid_amount',
        amount: null,
      }),
    );
  });

  it.each([
    ['Ledger', 'ledger', 'ledger-nano-x'],
    ['Jade Plus', 'jade', 'jade-plus'],
    ['Trezor', 'trezor', 'trezor-safe-5'],
    ['descriptor-only recovery', 'watch_only', null],
  ])('blocks %s agent funding before transaction construction', async (_name, type, modelSlug) => {
    mocks.findWalletByIdWithDevices.mockResolvedValue({
      id: 'funding-wallet',
      devices: [{
        device: {
          type,
          model: modelSlug ? { slug: modelSlug, name: modelSlug } : null,
        },
      }],
    });

    await expect(
      submitAgentFundingDraft({
        context: agentContext,
        fundingWalletId: 'funding-wallet',
        body: baseFundingDraftBody,
      }),
    ).rejects.toThrow(ForbiddenError);

    expect(mocks.createTransaction).not.toHaveBeenCalled();
    expect(mocks.createDraft).not.toHaveBeenCalled();
  });

  it('rejects unsafe effective transaction amounts before draft creation', async () => {
    mocks.createTransaction.mockResolvedValueOnce(
      makeTransactionData({ effectiveAmount: Number.MAX_SAFE_INTEGER + 1 }),
    );

    await expect(
      submitAgentFundingDraft({
        context: agentContext,
        fundingWalletId: 'funding-wallet',
        body: baseFundingDraftBody,
      }),
    ).rejects.toThrow(InvalidInputError);

    expect(mocks.createDraft).not.toHaveBeenCalled();
    expect(mocks.createFundingAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'rejected',
        reasonCode: 'invalid_amount',
        amount: 1000n,
      }),
    );
  });

  it('creates draft metadata for decoys, input defaults, and vault policy hits', async () => {
    const policyEvaluation = {
      allowed: true,
      triggered: [{ policyId: 'policy-1', severity: 'warn' }],
    };
    mocks.evaluatePolicies.mockResolvedValueOnce(policyEvaluation);
    mocks.createTransaction.mockResolvedValueOnce(
      makeTransactionData({
        changeAddress: 'tb1qchange',
        changeAmount: 300,
        decoyOutputs: [{ address: 'tb1qdecoy', amount: 200 }],
      }),
    );

    await expect(
      submitAgentFundingDraft({
        context: agentContext,
        fundingWalletId: 'funding-wallet',
        body: baseFundingDraftBody,
      }),
    ).resolves.toEqual({ draft: { id: 'draft-1' }, usedOverrideId: null });

    expect(mocks.createDraft).toHaveBeenCalledWith(
      'funding-wallet',
      'user-1',
      expect.objectContaining({
        decoyOutputs: [{ address: 'tb1qdecoy', amount: 200 }],
        inputs: [{ txid: 'txid', vout: 0, address: '', amount: 0 }],
        outputs: [
          {
            address: 'tb1qrecipient',
            amount: 1000,
            outputType: 'recipient',
            isOurs: true,
          },
          {
            address: 'tb1qchange',
            amount: 300,
            outputType: 'change',
            isOurs: true,
          },
          {
            address: 'tb1qdecoy',
            amount: 200,
            outputType: 'decoy',
            isOurs: true,
          },
        ],
        policyEvaluation,
      }),
      expect.objectContaining({
        client: expect.any(Object),
        runSideEffects: false,
      }),
    );
    expect(mocks.createFundingAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'accepted', amount: 1000n }),
      expect.any(Object),
    );
    expect(mocks.runDraftCreatedSideEffects).toHaveBeenCalledWith(
      'funding-wallet',
      'user-1',
      { id: 'draft-1' },
      expect.objectContaining({ policyEvaluation }),
    );
  });

  it('rolls back agent draft acceptance when accepted attempt recording fails', async () => {
    mocks.createFundingAttempt.mockRejectedValueOnce(new Error('attempt store unavailable'));

    await expect(
      submitAgentFundingDraft({
        context: agentContext,
        fundingWalletId: 'funding-wallet',
        body: baseFundingDraftBody,
      }),
    ).rejects.toThrow('attempt store unavailable');

    expect(mocks.createDraft).toHaveBeenCalledWith(
      'funding-wallet',
      'user-1',
      expect.any(Object),
      expect.objectContaining({ runSideEffects: false }),
    );
    expect(mocks.runDraftCreatedSideEffects).not.toHaveBeenCalled();
    expect(mocks.createFundingAttempt).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: 'rejected',
        reasonCode: 'unexpected_error',
      }),
    );
  });

  it('returns transaction results that do not carry deferred draft side effects', async () => {
    mocks.withAgentFundingTransaction.mockResolvedValueOnce({
      draft: { id: 'draft-without-side-effects' },
      usedOverrideId: null,
      sideEffects: null,
    });

    await expect(
      submitAgentFundingDraft({
        context: agentContext,
        fundingWalletId: 'funding-wallet',
        body: baseFundingDraftBody,
      }),
    ).resolves.toEqual({
      draft: { id: 'draft-without-side-effects' },
      usedOverrideId: null,
    });

    expect(mocks.runDraftCreatedSideEffects).not.toHaveBeenCalled();
  });

  it('rejects vault policy blocks before draft creation', async () => {
    mocks.evaluatePolicies.mockResolvedValueOnce({
      allowed: false,
      triggered: [{ policyId: 'policy-1', severity: 'block' }],
    });

    await expect(
      submitAgentFundingDraft({
        context: agentContext,
        fundingWalletId: 'funding-wallet',
        body: baseFundingDraftBody,
      }),
    ).rejects.toThrow(ForbiddenError);

    expect(mocks.createDraft).not.toHaveBeenCalled();
    expect(mocks.createFundingAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'rejected',
        reasonCode: 'forbidden_scope',
        amount: 1000n,
      }),
    );
  });

  it('rejects when the funding wallet network cannot be authenticated', async () => {
    mocks.findNetwork.mockResolvedValueOnce(null);
    await expect(submitAgentFundingDraft({
      context: agentContext,
      fundingWalletId: 'funding-wallet',
      body: baseFundingDraftBody,
    })).rejects.toThrow('Funding wallet not found');
    expect(mocks.createSigningIntent).not.toHaveBeenCalled();
    expect(mocks.createDraft).not.toHaveBeenCalled();
  });
});
