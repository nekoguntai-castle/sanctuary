import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ deriveIntentSpend: vi.fn(), findVerifiedReplacement: vi.fn() }));
vi.mock('../../../../src/services/bitcoin/signingIntent', () => ({ deriveIntentSpend: mocks.deriveIntentSpend }));
vi.mock('../../../../src/services/bitcoin/transactions/replacementLink', () => ({
  findVerifiedReplacement: mocks.findVerifiedReplacement,
}));

import {
  buildIntentPolicyInput,
  requiresEnforcedApproval,
} from '../../../../src/services/vaultPolicy/intentPolicyInput';

const intent = { snapshot: { network: 'testnet4' } } as Parameters<typeof buildIntentPolicyInput>[2];
const inputs = [{ txid: 'a'.repeat(64), vout: 0, address: 'tb1qwallet', amount: 60000 }];
const spend = (overrides: Record<string, unknown> = {}) => ({
  inputs,
  outputs: [],
  externalOutputs: [{ address: 'tb1qone', amount: 30000 }, { address: 'tb1qtwo', amount: 20000 }],
  amount: 50000,
  ...overrides,
});

describe('buildIntentPolicyInput', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findVerifiedReplacement.mockResolvedValue(null);
  });

  it('evaluates every external output of the intent at its full amount', async () => {
    mocks.deriveIntentSpend.mockResolvedValueOnce(spend());

    await expect(buildIntentPolicyInput('wallet-1', 'user-1', intent)).resolves.toEqual({
      walletId: 'wallet-1',
      userId: 'user-1',
      recipient: 'tb1qone',
      amount: BigInt(50000),
      outputs: [{ address: 'tb1qone', amount: 30000 }, { address: 'tb1qtwo', amount: 20000 }],
    });
    expect(mocks.deriveIntentSpend).toHaveBeenCalledWith('wallet-1', 'testnet4', intent.snapshot);
    expect(mocks.findVerifiedReplacement).not.toHaveBeenCalled();
  });

  it('returns null when nothing leaves the wallet', async () => {
    mocks.deriveIntentSpend.mockResolvedValueOnce(spend({ externalOutputs: [], amount: 0 }));
    await expect(buildIntentPolicyInput('wallet-1', 'user-1', intent)).resolves.toBeNull();
  });

  it('marks a verified replacement as a bump of the original amount', async () => {
    mocks.deriveIntentSpend.mockResolvedValueOnce(spend({ replacementTxid: 'c'.repeat(64) }));
    mocks.findVerifiedReplacement.mockResolvedValueOnce({ id: 'orig', label: null, amount: BigInt(45000) });

    await expect(buildIntentPolicyInput('wallet-1', 'user-1', intent)).resolves.toMatchObject({
      amount: BigInt(50000), replacedAmount: BigInt(45000), isReplacementBump: true,
    });
    expect(mocks.findVerifiedReplacement).toHaveBeenCalledWith('wallet-1', 'c'.repeat(64), inputs, undefined);
  });

  it('evaluates an unverifiable replacement as a fresh spend', async () => {
    mocks.deriveIntentSpend.mockResolvedValueOnce(spend({ replacementTxid: 'c'.repeat(64) }));

    const input = await buildIntentPolicyInput('wallet-1', 'user-1', intent);
    expect(input).not.toHaveProperty('isReplacementBump');
    expect(input).not.toHaveProperty('replacedAmount');
  });
});

describe('requiresEnforcedApproval', () => {
  const trigger = (action: 'approval_required' | 'monitored' | 'blocked') => ({
    policyId: 'p', policyName: 'P', type: 'approval_required' as const, action, reason: 'r',
  });

  it.each([
    [[trigger('approval_required')], true],
    [[trigger('monitored')], false],
    [[trigger('blocked')], false],
    [[], false],
    [undefined, false],
  ])('reads %j as %s', (triggered, expected) => {
    expect(requiresEnforcedApproval({ triggered } as Parameters<typeof requiresEnforcedApproval>[0])).toBe(expected);
  });
});
